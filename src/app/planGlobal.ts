import path from 'node:path';

import { writeCodexContextManifest } from './codexMinimalContext.js';
import { normalizeCodexOutput } from './codexNormalization.js';
import { ArcMapSchema, ChapterQueueSchema } from '../schemas/index.js';
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
}

export interface PlanGlobalResult {
  projectId: string;
  runId: string;
  artifacts: string[];
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DEFAULT_FIXTURES_ROOT = './fixtures/llm';

export async function planGlobal(input: PlanGlobalInput, fileStore = new FileStore()): Promise<PlanGlobalResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const provider = input.provider ?? 'mock';
  const runId = input.runId ?? createRunId();
  const runLogger = new RunLogger(paths, fileStore);

  await ensureProjectReady(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'plan-global',
    args: {
      provider,
      ...(input.codexProfile === undefined ? {} : { codexProfile: input.codexProfile })
    }
  });

  try {
    if (provider === 'codex-text') {
      return await planGlobalWithCodexText(input, paths, runId, runLogger, fileStore);
    }

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
    const brief = await fileStore.readText(paths.brief());
    const storyBible = await fileStore.readText(path.join(paths.strategyDir(), 'story_bible.md'));
    const artifacts: string[] = [];

    const globalOutlinePrompt = await promptService.renderPrompt('planning.plan_global_outline', {
      BRIEF: brief,
      STORY_BIBLE: storyBible
    });
    const globalOutlineResponse = await llmClient.complete({
      promptId: 'planning.plan_global_outline',
      system: 'Novel Loop Engine planning module',
      user: globalOutlinePrompt,
      responseFormat: 'markdown'
    });
    await writePromptRunArtifacts(fileStore, paths, runId, 'planning.plan_global_outline', globalOutlinePrompt, globalOutlineResponse.text);
    await fileStore.writeText(path.join(paths.planningDir(), 'global_outline.md'), globalOutlineResponse.text);
    await runLogger.recordArtifact(runId, 'planning/global_outline.md');
    artifacts.push('planning/global_outline.md');

    const volumeOutlinePrompt = await promptService.renderPrompt('planning.plan_volume_outline', {
      GLOBAL_OUTLINE: globalOutlineResponse.text
    });
    const volumeOutlineResponse = await llmClient.complete({
      promptId: 'planning.plan_volume_outline',
      system: 'Novel Loop Engine planning module',
      user: volumeOutlinePrompt,
      responseFormat: 'markdown'
    });
    await writePromptRunArtifacts(fileStore, paths, runId, 'planning.plan_volume_outline', volumeOutlinePrompt, volumeOutlineResponse.text);
    await fileStore.writeText(path.join(paths.planningDir(), 'volume_01_outline.md'), volumeOutlineResponse.text);
    await runLogger.recordArtifact(runId, 'planning/volume_01_outline.md');
    artifacts.push('planning/volume_01_outline.md');

    const arcMapPrompt = await promptService.renderPrompt('planning.generate_arc_map', {
      GLOBAL_OUTLINE: globalOutlineResponse.text
    });
    const arcMapResponse = await llmClient.complete({
      promptId: 'planning.generate_arc_map',
      system: 'Novel Loop Engine planning module',
      user: arcMapPrompt,
      responseFormat: 'json'
    });
    await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_arc_map', arcMapPrompt, arcMapResponse.text);
    await fileStore.writeJson(path.join(paths.planningDir(), 'arc_map.json'), arcMapResponse.json, ArcMapSchema);
    await runLogger.recordArtifact(runId, 'planning/arc_map.json');
    artifacts.push('planning/arc_map.json');

    const chapterQueuePrompt = await promptService.renderPrompt('planning.generate_chapter_queue', {
      GLOBAL_OUTLINE: globalOutlineResponse.text
    });
    const chapterQueueResponse = await llmClient.complete({
      promptId: 'planning.generate_chapter_queue',
      system: 'Novel Loop Engine planning module',
      user: chapterQueuePrompt,
      responseFormat: 'json'
    });
    await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_chapter_queue', chapterQueuePrompt, chapterQueueResponse.text);
    await fileStore.writeJson(path.join(paths.planningDir(), 'chapter_queue.json'), chapterQueueResponse.json, ChapterQueueSchema);
    await runLogger.recordArtifact(runId, 'planning/chapter_queue.json');
    artifacts.push('planning/chapter_queue.json');

    await runLogger.endRun(runId, 'completed');
    return {
      projectId: paths.projectId,
      runId,
      artifacts
    };
  } catch (error) {
    await runLogger.recordError(runId, {
      code: 'PLAN_GLOBAL_FAILED',
      message: getErrorMessage(error),
      recoverable: false
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

async function planGlobalWithCodexText(
  input: PlanGlobalInput,
  paths: ProjectPaths,
  runId: string,
  runLogger: RunLogger,
  fileStore: FileStore
): Promise<PlanGlobalResult> {
  const promptRoot = path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text');
  const promptService = new PromptService(promptRoot, fileStore);
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
    telemetry: {
      paths,
      runId,
      fileStore
    }
  });
  const brief = await fileStore.readText(paths.brief());
  const storyBible = await fileStore.readText(path.join(paths.strategyDir(), 'story_bible.md'));
  const genreContractPath = path.join(paths.strategyDir(), 'genre_contract.md');
  const genreContract = (await fileStore.exists(genreContractPath)) ? await fileStore.readText(genreContractPath) : '';
  const artifacts: string[] = [];
  const context = await writeCodexContextManifest(paths, fileStore, {
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
  await runLogger.recordArtifact(runId, context.relativePath, {
    action: 'generated',
    stage: 'codex',
    provenanceNote: 'minimal context manifest for codex-text plan-global'
  });

  const globalOutlinePrompt = await promptService.renderPrompt('planning.generate_global_outline_text', {
    BRIEF_SUMMARY: summarize(brief),
    STORY_BIBLE_SUMMARY: summarize(storyBible),
    GENRE_CONTRACT_SUMMARY: summarize(genreContract)
  });
  const globalOutlineResponse = await llmClient.complete({
    promptId: 'planning.generate_global_outline_text',
    system: 'Novel Loop Engine codex-text planning module',
    user: globalOutlinePrompt,
    responseFormat: 'markdown'
  });
  await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_global_outline_text', globalOutlinePrompt, globalOutlineResponse.text);
  await fileStore.writeText(path.join(paths.planningDir(), 'global_outline.md'), globalOutlineResponse.text);
  await runLogger.recordArtifact(runId, 'planning/global_outline.md');
  artifacts.push('planning/global_outline.md');

  const volumeOutlinePrompt = await promptService.renderPrompt('planning.generate_volume_outline_text', {
    GLOBAL_OUTLINE_SUMMARY: summarize(globalOutlineResponse.text),
    STORY_BIBLE_SUMMARY: summarize(storyBible)
  });
  const volumeOutlineResponse = await llmClient.complete({
    promptId: 'planning.generate_volume_outline_text',
    system: 'Novel Loop Engine codex-text planning module',
    user: volumeOutlinePrompt,
    responseFormat: 'markdown'
  });
  await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_volume_outline_text', volumeOutlinePrompt, volumeOutlineResponse.text);
  await fileStore.writeText(path.join(paths.planningDir(), 'volume_01_outline.md'), volumeOutlineResponse.text);
  await runLogger.recordArtifact(runId, 'planning/volume_01_outline.md');
  artifacts.push('planning/volume_01_outline.md');

  const arcMapPrompt = await promptService.renderPrompt('planning.generate_arc_map_minimal_json', {
    GLOBAL_OUTLINE_SUMMARY: summarize(globalOutlineResponse.text),
    VOLUME_OUTLINE_SUMMARY: summarize(volumeOutlineResponse.text)
  });
  const arcMapResponse = await llmClient.complete({
    promptId: 'planning.generate_arc_map_minimal_json',
    system: 'Novel Loop Engine codex-text planning module',
    user: arcMapPrompt,
    responseFormat: 'json'
  });
  await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_arc_map_minimal_json', arcMapPrompt, arcMapResponse.text);
  const arcMap = await normalizeCodexOutput(paths, fileStore, {
    runId,
    promptId: 'planning.generate_arc_map_minimal_json',
    stage: 'plan-global',
    value: arcMapResponse.json,
    normalize: () => normalizeArcMap(arcMapResponse.json, { projectId: paths.projectId })
  });
  await fileStore.writeJson(path.join(paths.planningDir(), 'arc_map.json'), arcMap, ArcMapSchema);
  await runLogger.recordArtifact(runId, 'planning/arc_map.json');
  artifacts.push('planning/arc_map.json');

  const chapterQueuePrompt = await promptService.renderPrompt('planning.generate_chapter_queue_minimal_json', {
    GLOBAL_OUTLINE_SUMMARY: summarize(globalOutlineResponse.text),
    VOLUME_OUTLINE_SUMMARY: summarize(volumeOutlineResponse.text)
  });
  const chapterQueueResponse = await llmClient.complete({
    promptId: 'planning.generate_chapter_queue_minimal_json',
    system: 'Novel Loop Engine codex-text planning module',
    user: chapterQueuePrompt,
    responseFormat: 'json'
  });
  await writePromptRunArtifacts(fileStore, paths, runId, 'planning.generate_chapter_queue_minimal_json', chapterQueuePrompt, chapterQueueResponse.text);
  const chapterQueue = await normalizeCodexOutput(paths, fileStore, {
    runId,
    promptId: 'planning.generate_chapter_queue_minimal_json',
    stage: 'plan-global',
    value: chapterQueueResponse.json,
    normalize: () => normalizeChapterQueue(chapterQueueResponse.json, { projectId: paths.projectId })
  });
  await fileStore.writeJson(path.join(paths.planningDir(), 'chapter_queue.json'), chapterQueue, ChapterQueueSchema);
  await runLogger.recordArtifact(runId, 'planning/chapter_queue.json');
  artifacts.push('planning/chapter_queue.json');

  const validationSummary = renderLocalPlanningValidationSummary(arcMap, chapterQueue);
  await fileStore.writeText(path.join(paths.planningDir(), 'validation_summary.md'), validationSummary);
  await runLogger.recordArtifact(runId, 'planning/validation_summary.md', {
    action: 'generated',
    stage: 'planning',
    derivedFrom: ['planning/arc_map.json', 'planning/chapter_queue.json'],
    provenanceNote: 'local deterministic planning validation assembly'
  });

  await runLogger.endRun(runId, 'completed');
  return {
    projectId: paths.projectId,
    runId,
    artifacts
  };
}

function summarize(text: string, maxLength = 1800): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function renderLocalPlanningValidationSummary(arcMap: unknown, chapterQueue: unknown): string {
  const arcCount = typeof arcMap === 'object' && arcMap !== null && 'arcs' in arcMap && Array.isArray((arcMap as { arcs?: unknown }).arcs)
    ? (arcMap as { arcs: unknown[] }).arcs.length
    : 0;
  const chapterCount = typeof chapterQueue === 'object' && chapterQueue !== null && 'chapters' in chapterQueue && Array.isArray((chapterQueue as { chapters?: unknown }).chapters)
    ? (chapterQueue as { chapters: unknown[] }).chapters.length
    : 0;
  return [
    '# Local planning assembly validation',
    '',
    'Local planning assembly completed without a Codex validation call.',
    `Arc count: ${arcCount}`,
    `Chapter queue count: ${chapterCount}`,
    '',
    'Arc map and chapter queue were schema-validated before this summary was written.'
  ].join('\n') + '\n';
}

async function ensureProjectReady(paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (!(await fileStore.exists(paths.projectRoot))) {
    throw new AppError('PROJECT_NOT_FOUND', `Project not found: ${paths.projectRoot}`, 2);
  }
  if (!(await fileStore.exists(path.join(paths.strategyDir(), 'story_bible.md')))) {
    throw new AppError('STORY_BIBLE_NOT_FOUND', `Story Bible not found for project: ${paths.projectId}`, 2);
  }
}
