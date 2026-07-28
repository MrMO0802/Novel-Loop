import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProviderFactory, type ProviderName } from '../llm/ProviderFactory.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';
import { BuildBibleCacheReportSchema } from '../schemas/index.js';
import type { BuildBibleCacheReport } from '../schemas/index.js';

export type BuildBibleStage =
  | 'preparing'
  | 'story_bible'
  | 'genre_contract'
  | 'reader_promise'
  | 'style_guide'
  | 'finalizing'
  | 'completed';

export interface BuildBibleProgressEvent {
  stage: BuildBibleStage;
  state: 'started' | 'completed';
}

export interface BuildBibleInput {
  projectId: string;
  projectsRoot?: string;
  provider?: ProviderName;
  force?: boolean;
  promptRoot?: string;
  fixturesRoot?: string;
  runId?: string;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
  useCache?: boolean;
  forceRegenerate?: boolean;
  onProgress?: (event: BuildBibleProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
  resumeIncomplete?: boolean;
}

export interface BuildBibleResult {
  projectId: string;
  runId: string;
  artifacts: string[];
}

interface MarkdownPromptArtifact {
  promptId: string;
  stage: Exclude<BuildBibleStage, 'preparing' | 'finalizing' | 'completed'>;
  outputPath: string;
  relativeOutputPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_PROMPT_ROOT = path.join(PACKAGE_ROOT, 'prompts');
const DEFAULT_FIXTURES_ROOT = path.join(PACKAGE_ROOT, 'fixtures', 'llm');

const BUILD_BIBLE_PROMPTS: MarkdownPromptArtifact[] = [
  {
    promptId: 'strategy.build_story_bible',
    stage: 'story_bible',
    outputPath: 'story_bible.md',
    relativeOutputPath: 'strategy/story_bible.md'
  },
  {
    promptId: 'strategy.build_genre_contract',
    stage: 'genre_contract',
    outputPath: 'genre_contract.md',
    relativeOutputPath: 'strategy/genre_contract.md'
  },
  {
    promptId: 'strategy.build_reader_promise',
    stage: 'reader_promise',
    outputPath: 'reader_promise.md',
    relativeOutputPath: 'strategy/reader_promise.md'
  },
  {
    promptId: 'strategy.build_style_guide',
    stage: 'style_guide',
    outputPath: 'style_guide.md',
    relativeOutputPath: 'strategy/style_guide.md'
  }
];

export async function buildBible(input: BuildBibleInput, fileStore = new FileStore()): Promise<BuildBibleResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const provider = input.provider ?? 'mock';
  const runId = input.runId ?? createRunId();
  const runLogger = new RunLogger(paths, fileStore);
  const useCache = input.useCache === true;
  const forceRegenerate = input.forceRegenerate === true || input.force === true;

  await ensureProjectReady(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'build-bible',
    args: {
      provider,
      ...(input.codexProfile === undefined ? {} : { codexProfile: input.codexProfile }),
      useCache,
      forceRegenerate
    }
  });

  try {
    await reportProgress(input, { stage: 'preparing', state: 'started' });
    const brief = await fileStore.readText(paths.brief());
    const briefHash = sha256(brief);
    const cacheKey = buildBibleCacheKey(provider, briefHash);
    if (useCache && !forceRegenerate && (await strategyArtifactsExist(paths, fileStore))) {
      const latestCache = await readLatestCacheReport(paths, fileStore);
      if (latestCache?.cacheKey === cacheKey) {
        await reportProgress(input, { stage: 'preparing', state: 'completed' });
        await reportProgress(input, { stage: 'finalizing', state: 'started' });
        const artifacts = BUILD_BIBLE_PROMPTS.map((artifact) => artifact.relativeOutputPath);
        for (const artifact of artifacts) {
          await runLogger.recordArtifact(runId, artifact, {
            action: 'reused',
            provenanceNote: 'build-bible cache hit'
          });
        }
        const cacheReport = await writeCacheReport(paths, fileStore, {
          provider,
          briefHash,
          cacheKey,
          cacheHit: true,
          reusedArtifacts: artifacts,
          regeneratedArtifacts: [],
          reason: 'cache hit: brief hash and strategy artifacts match'
        });
        await runLogger.recordArtifact(runId, cacheReport.relativeJsonPath, {
          action: 'generated',
          stage: 'strategy',
          derivedFrom: artifacts,
          provenanceNote: 'build-bible cache report'
        });
        await runLogger.recordArtifact(runId, cacheReport.relativeMdPath, {
          action: 'generated',
          stage: 'strategy',
          derivedFrom: [cacheReport.relativeJsonPath],
          provenanceNote: 'build-bible cache markdown report'
        });
        await reportProgress(input, { stage: 'finalizing', state: 'completed' });
        await reportProgress(input, { stage: 'completed', state: 'completed' });
        await runLogger.endRun(runId, 'completed');
        return {
          projectId: paths.projectId,
          runId,
          artifacts: [...artifacts, cacheReport.relativeJsonPath, cacheReport.relativeMdPath]
        };
      }
    }

    await ensureCanWriteOutputs(paths, fileStore, forceRegenerate, input.resumeIncomplete);
    const promptService = new PromptService(input.promptRoot ?? DEFAULT_PROMPT_ROOT, fileStore);
    const llmClient = ProviderFactory.create({
      provider,
      projectsRoot: paths.projectsRoot,
      projectId: paths.projectId,
      ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
      ...(input.codexProfile === undefined ? {} : { codexProfile: input.codexProfile }),
      ...(input.codexJsonRetries === undefined ? {} : { codexJsonRetries: input.codexJsonRetries }),
      ...(input.codexJsonRepair === undefined ? {} : { codexJsonRepair: input.codexJsonRepair }),
      ...(input.codexJsonRepairRetries === undefined ? {} : { codexJsonRepairRetries: input.codexJsonRepairRetries }),
      ...(input.codexTimeoutMs === undefined ? {} : { codexTimeoutMs: input.codexTimeoutMs }),
      fixturesRoot: input.fixturesRoot ?? DEFAULT_FIXTURES_ROOT,
      telemetry: {
        paths,
        runId,
        fileStore
      }
    });
    const artifacts: string[] = [];

    await reportProgress(input, { stage: 'preparing', state: 'completed' });

    for (const promptArtifact of BUILD_BIBLE_PROMPTS) {
      if (await input.shouldStop?.()) {
        throw new AppError(
          'BUILD_BIBLE_CANCELLED',
          'Story Bible generation stopped before the next stage.',
          2
        );
      }
      await reportProgress(input, { stage: promptArtifact.stage, state: 'started' });
      const renderedPrompt = await promptService.renderPrompt(promptArtifact.promptId, {
        BRIEF: brief
      });
      const response = await llmClient.complete({
        promptId: promptArtifact.promptId,
        system: 'Novel Loop Engine strategy module',
        user: renderedPrompt,
        responseFormat: 'markdown'
      });
      const outputPath = path.join(paths.strategyDir(), promptArtifact.outputPath);

      await writePromptRunArtifacts(fileStore, paths, runId, promptArtifact.promptId, renderedPrompt, response.text);
      await fileStore.writeText(outputPath, response.text);
      await runLogger.recordArtifact(runId, promptArtifact.relativeOutputPath);
      artifacts.push(promptArtifact.relativeOutputPath);
      await reportProgress(input, { stage: promptArtifact.stage, state: 'completed' });
    }

    await reportProgress(input, { stage: 'finalizing', state: 'started' });
    if (useCache) {
      const cacheReport = await writeCacheReport(paths, fileStore, {
        provider,
        briefHash,
        cacheKey,
        cacheHit: false,
        reusedArtifacts: [],
        regeneratedArtifacts: artifacts,
        reason: forceRegenerate ? 'cache miss: forceRegenerate requested' : 'cache miss: no matching cache report or missing strategy artifacts'
      });
      await runLogger.recordArtifact(runId, cacheReport.relativeJsonPath, {
        action: 'generated',
        stage: 'strategy',
        derivedFrom: artifacts,
        provenanceNote: 'build-bible cache report'
      });
      await runLogger.recordArtifact(runId, cacheReport.relativeMdPath, {
        action: 'generated',
        stage: 'strategy',
        derivedFrom: [cacheReport.relativeJsonPath],
        provenanceNote: 'build-bible cache markdown report'
      });
      artifacts.push(cacheReport.relativeJsonPath, cacheReport.relativeMdPath);
    }

    await reportProgress(input, { stage: 'finalizing', state: 'completed' });
    await reportProgress(input, { stage: 'completed', state: 'completed' });
    await runLogger.endRun(runId, 'completed');
    return {
      projectId: paths.projectId,
      runId,
      artifacts
    };
  } catch (error) {
    if (error instanceof AppError && error.code === 'BUILD_BIBLE_CANCELLED') {
      await runLogger.recordError(runId, {
        code: error.code,
        message: error.message,
        recoverable: true
      });
      await runLogger.endRun(runId, 'cancelled');
      throw error;
    }
    await runLogger.recordError(runId, {
      code: 'BUILD_BIBLE_FAILED',
      message: getErrorMessage(error),
      recoverable: false
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

async function ensureProjectReady(paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (!(await fileStore.exists(paths.projectRoot))) {
    throw new AppError('PROJECT_NOT_FOUND', `Project not found: ${paths.projectRoot}`, 2);
  }
  if (!(await fileStore.exists(paths.brief()))) {
    throw new AppError('BRIEF_NOT_FOUND', `Brief file not found: ${paths.brief()}`, 2);
  }
}

async function ensureCanWriteOutputs(
  paths: ProjectPaths,
  fileStore: FileStore,
  force: boolean,
  resumeIncomplete: boolean | undefined
): Promise<void> {
  const existingCount = (await Promise.all(BUILD_BIBLE_PROMPTS.map((promptArtifact) => (
    fileStore.exists(path.join(paths.strategyDir(), promptArtifact.outputPath))
  )))).filter(Boolean).length;
  const artifactAlreadyExists = new AppError(
    'ARTIFACT_ALREADY_EXISTS',
    `Story Bible artifacts already exist: ${paths.strategyDir()}`,
    2
  );

  if (existingCount === BUILD_BIBLE_PROMPTS.length && !force) {
    throw artifactAlreadyExists;
  }
  if (existingCount > 0 && resumeIncomplete !== true && !force) {
    throw artifactAlreadyExists;
  }
}

async function reportProgress(input: BuildBibleInput, event: BuildBibleProgressEvent): Promise<void> {
  await input.onProgress?.(event);
}

async function strategyArtifactsExist(paths: ProjectPaths, fileStore: FileStore): Promise<boolean> {
  for (const promptArtifact of BUILD_BIBLE_PROMPTS) {
    if (!(await fileStore.exists(path.join(paths.strategyDir(), promptArtifact.outputPath)))) {
      return false;
    }
  }
  return true;
}

function buildBibleCacheKey(provider: ProviderName, briefHash: string): string {
  return sha256(JSON.stringify({ provider, briefHash, prompts: BUILD_BIBLE_PROMPTS.map((prompt) => prompt.promptId) }));
}

async function readLatestCacheReport(paths: ProjectPaths, fileStore: FileStore): Promise<BuildBibleCacheReport | undefined> {
  if (!(await fileStore.exists(paths.strategyDir()))) return undefined;
  const files = (await fileStore.list(paths.strategyDir()))
    .filter((fileName) => /^build_bible_cache_report_v\d+\.json$/.test(fileName))
    .sort((left, right) => cacheReportVersion(right) - cacheReportVersion(left));
  if (files[0] === undefined) return undefined;
  try {
    return await fileStore.readJson(path.join(paths.strategyDir(), files[0]), BuildBibleCacheReportSchema);
  } catch {
    return undefined;
  }
}

async function writeCacheReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: {
    provider: ProviderName;
    briefHash: string;
    cacheKey: string;
    cacheHit: boolean;
    reusedArtifacts: string[];
    regeneratedArtifacts: string[];
    reason: string;
  }
): Promise<{ relativeJsonPath: string; relativeMdPath: string }> {
  const version = await nextCacheReportVersion(paths, fileStore);
  const jsonFileName = `build_bible_cache_report_v${version}.json`;
  const mdFileName = `build_bible_cache_report_v${version}.md`;
  const relativeJsonPath = path.posix.join('strategy', jsonFileName);
  const relativeMdPath = path.posix.join('strategy', mdFileName);
  const report = await fileStore.writeJson(
    paths.projectArtifact(relativeJsonPath),
    {
      reportId: `build_bible_cache_report_v${version}`,
      projectId: paths.projectId,
      briefHash: input.briefHash,
      cacheKey: input.cacheKey,
      cacheHit: input.cacheHit,
      reusedArtifacts: input.reusedArtifacts,
      regeneratedArtifacts: input.regeneratedArtifacts,
      reason: input.reason,
      generatedAt: new Date().toISOString()
    },
    BuildBibleCacheReportSchema
  );
  await fileStore.writeText(
    paths.projectArtifact(relativeMdPath),
    [
      `# Build Bible Cache ${report.reportId}`,
      '',
      `cacheHit: ${String(report.cacheHit)}`,
      `reason: ${report.reason}`,
      `provider: ${input.provider}`,
      '',
      '## Reused Artifacts',
      ...(report.reusedArtifacts.length === 0 ? ['none'] : report.reusedArtifacts.map((artifact) => `- ${artifact}`)),
      '',
      '## Regenerated Artifacts',
      ...(report.regeneratedArtifacts.length === 0 ? ['none'] : report.regeneratedArtifacts.map((artifact) => `- ${artifact}`))
    ].join('\n') + '\n'
  );
  return { relativeJsonPath, relativeMdPath };
}

async function nextCacheReportVersion(paths: ProjectPaths, fileStore: FileStore): Promise<number> {
  if (!(await fileStore.exists(paths.strategyDir()))) return 1;
  const versions = (await fileStore.list(paths.strategyDir()))
    .map((fileName) => /^build_bible_cache_report_v(\d+)\.json$/.exec(fileName)?.[1])
    .filter((version): version is string => version !== undefined)
    .map((version) => Number.parseInt(version, 10));
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

function cacheReportVersion(fileName: string): number {
  return Number.parseInt(/^build_bible_cache_report_v(\d+)\.json$/.exec(fileName)?.[1] ?? '0', 10);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
