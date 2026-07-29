import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeCodexContextManifest } from './codexMinimalContext.js';
import { normalizeCodexOutput } from './codexNormalization.js';
import {
  acquireProjectBuildLock,
  type ProjectBuildLock
} from './projectBuildLock.js';
import { ArcMapSchema, ChapterQueueSchema } from '../schemas/index.js';
import type { ArcMap, ChapterQueue } from '../schemas/index.js';
import { ProviderFactory, type ProviderName } from '../llm/ProviderFactory.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import { normalizeArcMap, normalizeChapterQueue } from '../providers/codex/normalizers.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export type PlanGlobalStage =
  | 'preparing'
  | 'global_outline'
  | 'volume_outline'
  | 'arc_map'
  | 'chapter_queue'
  | 'finalizing'
  | 'completed';

export interface PlanGlobalProgressEvent {
  stage: PlanGlobalStage;
  state: 'started' | 'completed';
}

export interface PlanGlobalInput {
  projectId: string;
  projectsRoot?: string;
  provider?: ProviderName;
  promptRoot?: string;
  fixturesRoot?: string;
  runId?: string;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
  codexContextBudgetBytes?: number;
  codexMaxArtifactsInContext?: number;
  codexContextMode?: 'compact' | 'balanced' | 'rich';
  onProgress?: (event: PlanGlobalProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
  resumeIncomplete?: boolean;
}

export interface PlanGlobalResult {
  projectId: string;
  runId: string;
  artifacts: string[];
}

interface PlanningStage<T> {
  stage: Exclude<PlanGlobalStage, 'preparing' | 'finalizing' | 'completed'>;
  relativePath: string;
  outputPath: string;
  readExisting: () => Promise<T>;
  generate: () => Promise<T>;
  write: (value: T) => Promise<void>;
}

interface PlanningLifecycleContext {
  input: PlanGlobalInput;
  paths: ProjectPaths;
  runId: string;
  runLogger: RunLogger;
  fileStore: FileStore;
  artifacts: string[];
}

const DEFAULT_PROJECTS_ROOT = './projects';
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_PROMPT_ROOT = path.join(PACKAGE_ROOT, 'prompts');
const DEFAULT_FIXTURES_ROOT = path.join(PACKAGE_ROOT, 'fixtures', 'llm');
const MAX_PLAN_GLOBAL_MARKDOWN_BYTES = 2 * 1024 * 1024;
const PLANNING_OUTPUTS = [
  'planning/global_outline.md',
  'planning/volume_01_outline.md',
  'planning/arc_map.json',
  'planning/chapter_queue.json'
] as const;

export async function planGlobal(input: PlanGlobalInput, fileStore = new FileStore()): Promise<PlanGlobalResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const provider = input.provider ?? 'mock';
  const runId = input.runId ?? createRunId();
  const runLogger = new RunLogger(paths, fileStore);
  const context: PlanningLifecycleContext = {
    input,
    paths,
    runId,
    runLogger,
    fileStore,
    artifacts: []
  };

  await ensureProjectReady(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'plan-global',
    args: {
      provider,
      ...(input.codexProfile === undefined ? {} : { codexProfile: input.codexProfile })
    }
  });

  let buildLock: ProjectBuildLock | undefined;
  try {
    buildLock = await acquireProjectBuildLock(paths.projectRoot);
    await reportProgress(input, { stage: 'preparing', state: 'started' });
    await ensureCanWriteOutputs(paths, fileStore, input.resumeIncomplete);
    await reportProgress(input, { stage: 'preparing', state: 'completed' });

    if (provider === 'codex-text') {
      await planGlobalWithCodexText(context);
    } else {
      await planGlobalWithProvider(context, provider);
    }

    await reportProgress(input, { stage: 'finalizing', state: 'started' });
    await reportProgress(input, { stage: 'finalizing', state: 'completed' });
    await reportProgress(input, { stage: 'completed', state: 'completed' });
    await runLogger.endRun(runId, 'completed');
    return {
      projectId: paths.projectId,
      runId,
      artifacts: context.artifacts
    };
  } catch (error) {
    if (error instanceof AppError && error.code === 'PLAN_GLOBAL_CANCELLED') {
      await runLogger.recordError(runId, {
        code: error.code,
        message: error.message,
        recoverable: true
      });
      await runLogger.endRun(runId, 'cancelled');
      throw error;
    }
    await runLogger.recordError(runId, {
      code: 'PLAN_GLOBAL_FAILED',
      message: getErrorMessage(error),
      recoverable: false
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  } finally {
    await buildLock?.release();
  }
}

async function planGlobalWithProvider(context: PlanningLifecycleContext, provider: ProviderName): Promise<void> {
  const { input, paths, runId, runLogger, fileStore } = context;
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
    telemetry: { paths, runId, fileStore }
  });
  const brief = await fileStore.readText(paths.brief());
  const storyBible = await fileStore.readText(path.join(paths.strategyDir(), 'story_bible.md'));

  const globalOutline = await runPlanningStage(context, {
    stage: 'global_outline',
    relativePath: 'planning/global_outline.md',
    outputPath: path.join(paths.planningDir(), 'global_outline.md'),
    readExisting: () => readMarkdownArtifact(fileStore, path.join(paths.planningDir(), 'global_outline.md')),
    generate: async () => {
      const prompt = await promptService.renderPrompt('planning.plan_global_outline', { BRIEF: brief, STORY_BIBLE: storyBible });
      const response = await llmClient.complete({
        promptId: 'planning.plan_global_outline',
        system: 'Novel Loop Engine planning module',
        user: prompt,
        responseFormat: 'markdown'
      });
      const output = validateMarkdownOutput(response.text);
      await writePromptRunArtifacts(fileStore, paths, runId, 'planning.plan_global_outline', prompt, output);
      return output;
    },
    write: (value) => fileStore.writeText(path.join(paths.planningDir(), 'global_outline.md'), value)
  });
  const volumeOutline = await runPlanningStage(context, {
    stage: 'volume_outline',
    relativePath: 'planning/volume_01_outline.md',
    outputPath: path.join(paths.planningDir(), 'volume_01_outline.md'),
    readExisting: () => readMarkdownArtifact(fileStore, path.join(paths.planningDir(), 'volume_01_outline.md')),
    generate: async () => {
      const prompt = await promptService.renderPrompt('planning.plan_volume_outline', { GLOBAL_OUTLINE: globalOutline });
      const response = await llmClient.complete({
        promptId: 'planning.plan_volume_outline',
        system: 'Novel Loop Engine planning module',
        user: prompt,
        responseFormat: 'markdown'
      });
      const output = validateMarkdownOutput(response.text);
      await writePromptRunArtifacts(fileStore, paths, runId, 'planning.plan_volume_outline', prompt, output);
      return output;
    },
    write: (value) => fileStore.writeText(path.join(paths.planningDir(), 'volume_01_outline.md'), value)
  });
  await runPlanningStage(context, {
    stage: 'arc_map',
    relativePath: 'planning/arc_map.json',
    outputPath: path.join(paths.planningDir(), 'arc_map.json'),
    readExisting: () => fileStore.readJson(path.join(paths.planningDir(), 'arc_map.json'), ArcMapSchema),
    generate: async () => {
      const prompt = await promptService.renderPrompt('planning.generate_arc_map', { GLOBAL_OUTLINE: globalOutline });
      const response = await llmClient.complete({
        promptId: 'planning.generate_arc_map',
        system: 'Novel Loop Engine planning module',
        user: prompt,
        responseFormat: 'json'
      });
      await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_arc_map', prompt, response.text);
      return ArcMapSchema.parse(response.json);
    },
    write: async (value) => { await fileStore.writeJson(path.join(paths.planningDir(), 'arc_map.json'), value, ArcMapSchema); }
  });
  await runPlanningStage(context, {
    stage: 'chapter_queue',
    relativePath: 'planning/chapter_queue.json',
    outputPath: path.join(paths.planningDir(), 'chapter_queue.json'),
    readExisting: () => fileStore.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema),
    generate: async () => {
      const prompt = await promptService.renderPrompt('planning.generate_chapter_queue', { GLOBAL_OUTLINE: globalOutline });
      const response = await llmClient.complete({
        promptId: 'planning.generate_chapter_queue',
        system: 'Novel Loop Engine planning module',
        user: prompt,
        responseFormat: 'json'
      });
      await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_chapter_queue', prompt, response.text);
      return ChapterQueueSchema.parse(response.json);
    },
    write: async (value) => { await fileStore.writeJson(path.join(paths.planningDir(), 'chapter_queue.json'), value, ChapterQueueSchema); }
  });
  void volumeOutline;
}

async function planGlobalWithCodexText(context: PlanningLifecycleContext): Promise<void> {
  const { input, paths, runId, runLogger, fileStore } = context;
  const promptService = new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
  const llmClient = ProviderFactory.create({
    provider: 'codex-text',
    projectsRoot: paths.projectsRoot,
    projectId: paths.projectId,
    ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
    ...(input.codexProfile === undefined ? {} : { codexProfile: input.codexProfile }),
    ...(input.codexJsonRetries === undefined ? {} : { codexJsonRetries: input.codexJsonRetries }),
    ...(input.codexJsonRepair === undefined ? {} : { codexJsonRepair: input.codexJsonRepair }),
    ...(input.codexJsonRepairRetries === undefined ? {} : { codexJsonRepairRetries: input.codexJsonRepairRetries }),
    ...(input.codexTimeoutMs === undefined ? {} : { codexTimeoutMs: input.codexTimeoutMs }),
    fixturesRoot: input.fixturesRoot ?? DEFAULT_FIXTURES_ROOT,
    telemetry: { paths, runId, fileStore }
  });
  const brief = await fileStore.readText(paths.brief());
  const storyBible = await fileStore.readText(path.join(paths.strategyDir(), 'story_bible.md'));
  const genreContractPath = path.join(paths.strategyDir(), 'genre_contract.md');
  const genreContract = (await fileStore.exists(genreContractPath)) ? await fileStore.readText(genreContractPath) : '';
  const contextManifest = await writeCodexContextManifest(paths, fileStore, {
    task: 'plan-global',
    requestedMode: input.codexContextMode ?? 'compact',
    ...(input.codexContextBudgetBytes === undefined ? {} : { budgetBytes: input.codexContextBudgetBytes }),
    ...(input.codexMaxArtifactsInContext === undefined ? {} : { maxArtifacts: input.codexMaxArtifactsInContext }),
    includedArtifacts: [
      { path: 'brief.md', reason: 'brief is required for global planning', summary: summarize(brief) },
      { path: 'strategy/story_bible.md', reason: 'story bible summary anchors the plan', summary: summarize(storyBible) },
      { path: 'strategy/genre_contract.md', reason: 'genre contract summary constrains planning', summary: summarize(genreContract) }
    ]
  });
  await runLogger.recordArtifact(runId, contextManifest.relativePath, {
    action: 'generated', stage: 'codex', provenanceNote: 'minimal context manifest for codex-text plan-global'
  });

  const globalOutline = await runPlanningStage(context, {
    stage: 'global_outline', relativePath: 'planning/global_outline.md', outputPath: path.join(paths.planningDir(), 'global_outline.md'),
    readExisting: () => readMarkdownArtifact(fileStore, path.join(paths.planningDir(), 'global_outline.md')),
    generate: async () => {
      const prompt = await promptService.renderPrompt('planning.generate_global_outline_text', {
        BRIEF_SUMMARY: summarize(brief), STORY_BIBLE_SUMMARY: summarize(storyBible), GENRE_CONTRACT_SUMMARY: summarize(genreContract)
      });
      const response = await llmClient.complete({ promptId: 'planning.generate_global_outline_text', system: 'Novel Loop Engine codex-text planning module', user: prompt, responseFormat: 'markdown' });
      const output = validateMarkdownOutput(response.text);
      await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_global_outline_text', prompt, output);
      return output;
    },
    write: (value) => fileStore.writeText(path.join(paths.planningDir(), 'global_outline.md'), value)
  });
  const volumeOutline = await runPlanningStage(context, {
    stage: 'volume_outline', relativePath: 'planning/volume_01_outline.md', outputPath: path.join(paths.planningDir(), 'volume_01_outline.md'),
    readExisting: () => readMarkdownArtifact(fileStore, path.join(paths.planningDir(), 'volume_01_outline.md')),
    generate: async () => {
      const prompt = await promptService.renderPrompt('planning.generate_volume_outline_text', {
        GLOBAL_OUTLINE_SUMMARY: summarize(globalOutline), STORY_BIBLE_SUMMARY: summarize(storyBible)
      });
      const response = await llmClient.complete({ promptId: 'planning.generate_volume_outline_text', system: 'Novel Loop Engine codex-text planning module', user: prompt, responseFormat: 'markdown' });
      const output = validateMarkdownOutput(response.text);
      await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_volume_outline_text', prompt, output);
      return output;
    },
    write: (value) => fileStore.writeText(path.join(paths.planningDir(), 'volume_01_outline.md'), value)
  });
  const arcMap = await runPlanningStage(context, {
    stage: 'arc_map', relativePath: 'planning/arc_map.json', outputPath: path.join(paths.planningDir(), 'arc_map.json'),
    readExisting: () => fileStore.readJson(path.join(paths.planningDir(), 'arc_map.json'), ArcMapSchema),
    generate: async () => {
      const prompt = await promptService.renderPrompt('planning.generate_arc_map_minimal_json', {
        GLOBAL_OUTLINE_SUMMARY: summarize(globalOutline), VOLUME_OUTLINE_SUMMARY: summarize(volumeOutline)
      });
      const response = await llmClient.complete({ promptId: 'planning.generate_arc_map_minimal_json', system: 'Novel Loop Engine codex-text planning module', user: prompt, responseFormat: 'json' });
      await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_arc_map_minimal_json', prompt, response.text);
      return normalizeCodexOutput(paths, fileStore, {
        runId, promptId: 'planning.generate_arc_map_minimal_json', stage: 'plan-global', value: response.json,
        normalize: () => normalizeArcMap(response.json, { projectId: paths.projectId })
      });
    },
    write: async (value) => { await fileStore.writeJson(path.join(paths.planningDir(), 'arc_map.json'), value, ArcMapSchema); }
  });
  const chapterQueue = await runPlanningStage(context, {
    stage: 'chapter_queue', relativePath: 'planning/chapter_queue.json', outputPath: path.join(paths.planningDir(), 'chapter_queue.json'),
    readExisting: () => fileStore.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema),
    generate: async () => {
      const prompt = await promptService.renderPrompt('planning.generate_chapter_queue_minimal_json', {
        GLOBAL_OUTLINE_SUMMARY: summarize(globalOutline), VOLUME_OUTLINE_SUMMARY: summarize(volumeOutline)
      });
      const response = await llmClient.complete({ promptId: 'planning.generate_chapter_queue_minimal_json', system: 'Novel Loop Engine codex-text planning module', user: prompt, responseFormat: 'json' });
      await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_chapter_queue_minimal_json', prompt, response.text);
      return normalizeCodexOutput(paths, fileStore, {
        runId, promptId: 'planning.generate_chapter_queue_minimal_json', stage: 'plan-global', value: response.json,
        normalize: () => normalizeChapterQueue(response.json, { projectId: paths.projectId })
      });
    },
    write: async (value) => { await fileStore.writeJson(path.join(paths.planningDir(), 'chapter_queue.json'), value, ChapterQueueSchema); }
  });
  await fileStore.writeText(path.join(paths.planningDir(), 'validation_summary.md'), renderLocalPlanningValidationSummary(arcMap, chapterQueue));
  await runLogger.recordArtifact(runId, 'planning/validation_summary.md', {
    action: 'generated', stage: 'planning', derivedFrom: ['planning/arc_map.json', 'planning/chapter_queue.json'],
    provenanceNote: 'local deterministic planning validation assembly'
  });
}

async function runPlanningStage<T>(context: PlanningLifecycleContext, stage: PlanningStage<T>): Promise<T> {
  await reportProgress(context.input, { stage: stage.stage, state: 'started' });
  if (context.input.resumeIncomplete === true && await context.fileStore.exists(stage.outputPath)) {
    const reused = await stage.readExisting();
    await context.runLogger.recordArtifact(context.runId, stage.relativePath, {
      action: 'reused', stage: 'planning', provenanceNote: 'resumed desktop global planning stage'
    });
    context.artifacts.push(stage.relativePath);
    await reportProgress(context.input, { stage: stage.stage, state: 'completed' });
    return reused;
  }
  await stopBeforeNextCall(context.input);
  const generated = await stage.generate();
  await stage.write(generated);
  await context.runLogger.recordArtifact(context.runId, stage.relativePath);
  context.artifacts.push(stage.relativePath);
  await reportProgress(context.input, { stage: stage.stage, state: 'completed' });
  return generated;
}

async function stopBeforeNextCall(input: PlanGlobalInput): Promise<void> {
  if (await input.shouldStop?.()) {
    throw new AppError('PLAN_GLOBAL_CANCELLED', 'Global planning stopped before the next stage.', 2);
  }
}

async function ensureProjectReady(paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (!(await fileStore.exists(paths.projectRoot))) {
    throw new AppError('PROJECT_NOT_FOUND', `Project not found: ${paths.projectRoot}`, 2);
  }
  if (!(await fileStore.exists(path.join(paths.strategyDir(), 'story_bible.md')))) {
    throw new AppError('STORY_BIBLE_NOT_FOUND', `Story Bible not found for project: ${paths.projectId}`, 2);
  }
}

async function ensureCanWriteOutputs(paths: ProjectPaths, fileStore: FileStore, resumeIncomplete: boolean | undefined): Promise<void> {
  const existingCount = (await Promise.all(PLANNING_OUTPUTS.map((artifact) => fileStore.exists(paths.projectArtifact(artifact))))).filter(Boolean).length;
  if (existingCount === PLANNING_OUTPUTS.length || (existingCount > 0 && resumeIncomplete !== true)) {
    throw new AppError('ARTIFACT_ALREADY_EXISTS', `Global planning artifacts already exist: ${paths.planningDir()}`, 2);
  }
}

async function readMarkdownArtifact(fileStore: FileStore, filePath: string): Promise<string> {
  return validateMarkdownOutput(await fileStore.readText(filePath));
}

function validateMarkdownOutput(value: string): string {
  if (Buffer.byteLength(value, 'utf8') > MAX_PLAN_GLOBAL_MARKDOWN_BYTES) {
    throw new AppError('PLAN_GLOBAL_INVALID_OUTPUT', 'Generated global planning Markdown exceeds the 2 MiB document limit.', 2);
  }
  return value;
}

async function reportProgress(input: PlanGlobalInput, event: PlanGlobalProgressEvent): Promise<void> {
  await input.onProgress?.(event);
}

function summarize(text: string, maxLength = 1800): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function renderLocalPlanningValidationSummary(arcMap: ArcMap, chapterQueue: ChapterQueue): string {
  return [
    '# Local planning assembly validation',
    '',
    'Local planning assembly completed without a Codex validation call.',
    `Arc count: ${arcMap.arcs.length}`,
    `Chapter queue count: ${chapterQueue.chapters.length}`,
    '',
    'Arc map and chapter queue were schema-validated before this summary was written.'
  ].join('\n') + '\n';
}
