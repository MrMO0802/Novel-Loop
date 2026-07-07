import { rm } from 'node:fs/promises';
import path from 'node:path';

import { buildBible } from './buildBible.js';
import { checkCodexStatus, execCodexJson, runCodexSmoke } from './codexBoundary.js';
import { initProject } from './initProject.js';
import { createDefaultConfig, createInitialStoryState } from './initProject.js';
import { planGlobal } from './planGlobal.js';
import { runChapterUntilDraft } from './chapterDrafting.js';
import { runChapterDryRun } from './chapterPlanning.js';
import { runChapterFullProduction } from './chapterPipeline.js';
import { generateCodexRealOptimizationBenchmarkReport } from './codexRealOptimizationBenchmark.js';
import { hashJson } from '../logging/RunLogger.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import {
  CodexRuntimeBenchmarkReportSchema,
  CodexRuntimeFailureReportSchema,
  ConfigSchema,
  RunManifestSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  CodexBenchmarkLevel,
  CodexErrorType,
  CodexProfileComparisonItem,
  CodexRuntimeBenchmarkReport,
  CodexRuntimeBenchmarkStage,
  RunManifest
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface RunCodexRuntimeBenchmarkInput {
  projectId?: string;
  projectsRoot?: string;
  briefPath: string;
  promptRoot?: string;
  codexBin?: string;
  level?: CodexBenchmarkLevel;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
  codexContextBudgetBytes?: number;
  codexMaxArtifactsInContext?: number;
  codexContextMode?: 'compact' | 'balanced' | 'rich';
  codexFinalMode?: 'codex' | 'local-assemble' | 'light-polish';
  optimizationMode?: 'low-risk-v1';
  useCache?: boolean;
  warmCache?: boolean;
  codexStageTimeoutMs?: number;
  codexMaxTotalRuntimeMs?: number;
  codexMaxCallsPerStage?: number;
  codexMaxCallsPerChapter?: number;
  continueOnFailure?: boolean;
  resume?: boolean;
  clean?: boolean;
}

export interface RunCodexRuntimeBenchmarkResult {
  report: CodexRuntimeBenchmarkReport;
  reportPath: string;
  markdownPath: string;
  realOptimizationReportPath?: string;
  realOptimizationMarkdownPath?: string;
}

export interface RunCodexProfileComparisonInput extends Omit<RunCodexRuntimeBenchmarkInput, 'codexProfile' | 'level'> {
  level: Exclude<CodexBenchmarkLevel, 'all'>;
  profiles: CodexProfile[];
}

const DEFAULT_PROJECT_ID = 'codex-bench';
const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DEFAULT_CODEX_TIMEOUT_MS = 180_000;
const LEVEL_ORDER: Array<Exclude<CodexBenchmarkLevel, 'all'>> = ['health', 'bible', 'plan', 'draft', 'preview', 'confirm', 'chapter2', 'chapter3'];

export async function runCodexRuntimeBenchmark(input: RunCodexRuntimeBenchmarkInput, fileStore = new FileStore()): Promise<RunCodexRuntimeBenchmarkResult> {
  const started = Date.now();
  const projectId = input.projectId ?? DEFAULT_PROJECT_ID;
  const projectsRoot = input.projectsRoot ?? DEFAULT_PROJECTS_ROOT;
  const promptRoot = input.promptRoot ?? DEFAULT_PROMPT_ROOT;
  const paths = new ProjectPaths(projectsRoot, projectId);
  const level = input.level ?? 'all';
  const stages: CodexRuntimeBenchmarkStage[] = [];
  const codexStatus = await safeCodexStatus(input, projectsRoot, projectId);
  const completedLevels: Array<Exclude<CodexBenchmarkLevel, 'all'>> = [];
  let failedLevel: Exclude<CodexBenchmarkLevel, 'all'> | undefined;
  let failureReportPath: string | undefined;

  if (input.clean === true || (input.clean !== false && input.resume !== true && (level === 'all' || level === 'health'))) {
    await rm(paths.projectRoot, { recursive: true, force: true });
  }

  for (const currentLevel of resolveLevels(level)) {
    const beforeCount = stages.length;
    try {
      await runLevel(currentLevel, {
        input,
        paths,
        projectsRoot,
        projectId,
        promptRoot,
        stages,
        fileStore
      });
      if (stages.slice(beforeCount).every((stage) => stage.status !== 'failed')) {
        completedLevels.push(currentLevel);
      }
    } catch (error) {
      failedLevel = currentLevel;
      const failedStage = stages.at(-1);
      if (failedStage !== undefined && failedStage.status === 'failed') {
        failureReportPath = failedStage.failureReportPath;
      }
      if (input.continueOnFailure !== true) break;
    }
    if (input.codexMaxTotalRuntimeMs !== undefined && Date.now() - started > input.codexMaxTotalRuntimeMs) {
      failedLevel = currentLevel;
      const failure = await writeRuntimeFailureReport(paths, fileStore, {
        level: currentLevel,
        stageName: 'total-runtime',
        errorType: 'CODEX_TOTAL_RUNTIME_EXCEEDED',
        message: `Benchmark exceeded total runtime budget ${input.codexMaxTotalRuntimeMs}ms.`,
        elapsedMs: Date.now() - started,
        outputBytes: 0,
        suggestedRetryCommand: suggestedRetryCommand(projectId, currentLevel, input.resume === true)
      });
      failureReportPath = failure.relativePath;
      stages.push(emptyStage(paths, fileStore, currentLevel, 'total-runtime', `codex benchmark --level ${currentLevel}`, 'failed', {
        errorCode: 'CODEX_TOTAL_RUNTIME_EXCEEDED',
        failureReportPath: failure.relativePath,
        startedAtMs: Date.now()
      }));
      break;
    }
  }

  const success = failedLevel === undefined && stages.every((stage) => stage.status !== 'failed');
  const benchmark = await writeBenchmarkReport(paths, fileStore, {
    projectId,
    generatedAt: new Date().toISOString(),
    codexStatus,
    profile: input.codexProfile ?? 'clean',
    totalDurationMs: Date.now() - started,
    success,
    completedLevels,
    ...(failedLevel === undefined ? {} : { failedLevel }),
    stages,
    ...(failureReportPath === undefined ? {} : { failureReportPath }),
    profileComparisons: []
  });
  if (shouldWriteRealOptimizationReport(input)) {
    const realOptimization = await generateCodexRealOptimizationBenchmarkReport(
      {
        projectId,
        projectsRoot,
        benchmarkReport: benchmark.report,
        sourceBenchmarkReportPath: benchmark.reportPath,
        realBenchmark: true
      },
      fileStore
    );
    return {
      ...benchmark,
      realOptimizationReportPath: realOptimization.reportPath,
      realOptimizationMarkdownPath: realOptimization.markdownPath
    };
  }
  return benchmark;
}

export async function runCodexProfileComparison(input: RunCodexProfileComparisonInput, fileStore = new FileStore()): Promise<RunCodexRuntimeBenchmarkResult> {
  const started = Date.now();
  const projectId = input.projectId ?? DEFAULT_PROJECT_ID;
  const projectsRoot = input.projectsRoot ?? DEFAULT_PROJECTS_ROOT;
  const paths = new ProjectPaths(projectsRoot, projectId);
  const comparisons: CodexProfileComparisonItem[] = [];
  const stages: CodexRuntimeBenchmarkStage[] = [];
  for (const profile of input.profiles) {
    const profileProjectId = `${projectId}-${profile}`;
    const result = await runCodexRuntimeBenchmark(
      {
        ...input,
        projectId: profileProjectId,
        codexProfile: profile,
        level: input.level,
        clean: true
      },
      fileStore
    );
    stages.push(...result.report.stages);
    comparisons.push({
      profile,
      durationMs: result.report.totalDurationMs,
      success: result.report.success,
      ...(result.report.failedLevel === undefined ? {} : { failureType: result.report.stages.find((stage) => stage.status === 'failed')?.errorCode ?? 'CODEX_UNKNOWN_ERROR' }),
      warningCount: 0,
      outputValid: result.report.success,
      schemaRetryCount: result.report.stages.reduce((sum, stage) => sum + stage.retryCount, 0)
    });
  }
  const success = comparisons.every((item) => item.success);
  return writeBenchmarkReport(paths, fileStore, {
    projectId,
    generatedAt: new Date().toISOString(),
    codexStatus: { comparedProfiles: input.profiles },
    profile: 'comparison',
    totalDurationMs: Date.now() - started,
    success,
    completedLevels: success ? [input.level] : [],
    ...(success ? {} : { failedLevel: input.level }),
    stages,
    profileComparisons: comparisons
  });
}

async function runLevel(
  level: Exclude<CodexBenchmarkLevel, 'all'>,
  context: {
    input: RunCodexRuntimeBenchmarkInput;
    paths: ProjectPaths;
    projectsRoot: string;
    projectId: string;
    promptRoot: string;
    stages: CodexRuntimeBenchmarkStage[];
    fileStore: FileStore;
  }
): Promise<void> {
  const { input, paths, projectsRoot, projectId, promptRoot, stages, fileStore } = context;
  if (level === 'health') {
    await runMeasuredStage(context, level, 'codex-status', 'codex status', undefined, async () => {
      await checkCodexStatus(boundaryOptions(input, projectsRoot, projectId));
      return { artifacts: [] };
    });
    const smokeRunId = createBenchmarkRunId('codex_benchmark_smoke');
    await runMeasuredStage(context, level, 'codex-smoke', 'codex smoke', smokeRunId, async () => {
      const result = await runCodexSmoke({ ...boundaryOptions(input, projectsRoot, projectId), runId: smokeRunId });
      return { runId: result.runId, artifacts: [result.rawOutputPath, result.finalOutputPath] };
    });
    const execJsonRunId = createBenchmarkRunId('codex_benchmark_exec_json');
    await runMeasuredStage(context, level, 'codex-exec-json', 'codex exec-json --output-schema', execJsonRunId, async () => {
      const result = await execCodexJson({
        ...boundaryOptions(input, projectsRoot, projectId),
        runId: execJsonRunId,
        promptPath: path.resolve('examples/codex_json_prompt.md'),
        schemaPath: path.resolve('examples/codex_output.schema.json')
      });
      return { runId: result.runId, artifacts: [result.rawOutputPath, result.finalOutputPath, result.parsedJsonPath] };
    });
    return;
  }

  if (level === 'bible') {
    await ensureProjectInitialized(context);
    if (!(await fileStore.exists(path.join(paths.strategyDir(), 'story_bible.md')))) {
      const runId = createBenchmarkRunId('codex_benchmark_bible');
      await runMeasuredStage(context, level, 'build-bible', `build-bible ${projectId} --provider codex-text`, runId, async () => {
        const result = await buildBible(
          {
            projectId,
            projectsRoot,
            provider: 'codex-text',
            promptRoot,
            runId,
            ...(useBuildBibleCache(input) ? { useCache: true } : {}),
            ...codexOptions(input)
          },
          fileStore
        );
        return { runId: result.runId, artifacts: result.artifacts };
      });
    }
    if (useBuildBibleCache(input) && input.warmCache === true && !stages.some((stage) => stage.stageName === 'build-bible-cache-hit')) {
      const warmRunId = createBenchmarkRunId('codex_benchmark_bible_cache_hit');
      await runMeasuredStage(context, level, 'build-bible-cache-hit', `build-bible ${projectId} --provider codex-text --use-cache`, warmRunId, async () => {
        const result = await buildBible(
          {
            projectId,
            projectsRoot,
            provider: 'codex-text',
            promptRoot,
            runId: warmRunId,
            useCache: true,
            ...codexOptions(input)
          },
          fileStore
        );
        return { runId: result.runId, artifacts: result.artifacts };
      });
    }
    return;
  }

  if (level === 'plan') {
    await runLevel('bible', context);
    if (await fileStore.exists(paths.chapterQueue())) return;
    const runId = createBenchmarkRunId('codex_benchmark_plan');
    await runMeasuredStage(context, level, 'plan-global', `plan-global ${projectId} --provider codex-text`, runId, async () => {
      const result = await planGlobal({ projectId, projectsRoot, provider: 'codex-text', promptRoot, runId, ...codexOptions(input) }, fileStore);
      return { runId: result.runId, artifacts: result.artifacts };
    });
    return;
  }

  if (level === 'draft') {
    await ensureChapterDraft(context, 1);
    return;
  }

  if (level === 'preview') {
    await ensureChapterPreview(context, 1, 'preview');
    return;
  }

  if (level === 'confirm') {
    if (input.resume === true) {
      await runChapterConfirmStage(context, 1, 'confirm');
      return;
    }
    await ensureChapterPreview(context, 1, 'preview');
    await runChapterConfirmStage(context, 1, 'confirm');
    return;
  }

  if (level === 'chapter2' || level === 'chapter3') {
    const chapterNumber = level === 'chapter2' ? 2 : 3;
    await ensurePriorCommitted(context, chapterNumber - 1);
    await ensureChapterPreview(context, chapterNumber, level);
    await runChapterConfirmStage(context, chapterNumber, level);
  }
}

async function ensureProjectInitialized(context: { input: RunCodexRuntimeBenchmarkInput; paths: ProjectPaths; projectId: string; projectsRoot: string; fileStore: FileStore; stages: CodexRuntimeBenchmarkStage[] }): Promise<void> {
  if ((await context.fileStore.exists(context.paths.projectRoot)) && (await context.fileStore.exists(context.paths.storyState())) && (await context.fileStore.exists(context.paths.config())) && (await context.fileStore.exists(context.paths.brief()))) {
    return;
  }
  await runMeasuredStage(context as StageContext, 'bible', 'init', `init ${context.projectId} --brief ${context.input.briefPath}`, undefined, async () => {
    if (!(await context.fileStore.exists(context.paths.projectRoot))) {
      const result = await initProject({ projectId: context.projectId, projectsRoot: context.projectsRoot, briefPath: context.input.briefPath }, context.fileStore);
      return { artifacts: result.created.map((created) => path.relative(context.paths.projectRoot, created).split(path.sep).join(path.posix.sep)).filter((item) => item.length > 0) };
    }
    const artifacts = await completePartialInitialization(context);
    return { artifacts };
  });
}

async function completePartialInitialization(context: { input: RunCodexRuntimeBenchmarkInput; paths: ProjectPaths; projectId: string; fileStore: FileStore }): Promise<string[]> {
  const artifacts: string[] = [];
  for (const dir of [
    context.paths.strategyDir(),
    context.paths.stateDir(),
    context.paths.planningDir(),
    context.paths.chaptersDir(),
    context.paths.runsDir(),
    context.paths.snapshotsDir(),
    context.paths.diffsDir()
  ]) {
    await context.fileStore.ensureDir(dir);
  }
  if (!(await context.fileStore.exists(context.paths.brief()))) {
    await context.fileStore.writeText(context.paths.brief(), await context.fileStore.readText(context.input.briefPath));
    artifacts.push('brief.md');
  }
  if (!(await context.fileStore.exists(context.paths.config()))) {
    await context.fileStore.writeJson(context.paths.config(), createDefaultConfig(context.projectId), ConfigSchema);
    artifacts.push('config.json');
  }
  if (!(await context.fileStore.exists(context.paths.storyState()))) {
    await context.fileStore.writeJson(context.paths.storyState(), createInitialStoryState(context.projectId), StoryStateSchema);
    artifacts.push('state/story_state.json');
  }
  return artifacts;
}

async function ensureChapterDraft(context: StageContext, chapterNumber: number): Promise<void> {
  await runLevel('plan', context);
  const draftPath = context.paths.chapterArtifact(chapterNumber, 'draft_v1.md');
  if (await context.fileStore.exists(draftPath)) return;
  const dryRunId = createBenchmarkRunId(`codex_benchmark_ch${chapterNumber}_dry`);
  await runMeasuredStage(context, chapterLevel(chapterNumber), `chapter-${formatChapter(chapterNumber)}-dry-run`, `chapter ${context.projectId} ${chapterNumber} --provider codex-text --dry-run`, dryRunId, async () => {
    const result = await runChapterDryRun({ projectId: context.projectId, projectsRoot: context.projectsRoot, chapterNumber, provider: 'codex-text', promptRoot: context.promptRoot, runId: dryRunId, ...codexOptions(context.input) }, context.fileStore);
    return { runId: result.runId, artifacts: result.artifacts };
  });
  const draftRunId = createBenchmarkRunId(`codex_benchmark_ch${chapterNumber}_draft`);
  await runMeasuredStage(context, chapterLevel(chapterNumber), `chapter-${formatChapter(chapterNumber)}-draft`, `chapter ${context.projectId} ${chapterNumber} --provider codex-text --until draft`, draftRunId, async () => {
    const result = await runChapterUntilDraft({ projectId: context.projectId, projectsRoot: context.projectsRoot, chapterNumber, provider: 'codex-text', promptRoot: context.promptRoot, runId: draftRunId, ...codexOptions(context.input) }, context.fileStore);
    return { runId: result.runId, artifacts: result.artifacts };
  });
}

async function ensureChapterPreview(context: StageContext, chapterNumber: number, level: Exclude<CodexBenchmarkLevel, 'all'>): Promise<void> {
  await ensureChapterDraft(context, chapterNumber);
  if (await hasCodexPreview(context.paths, context.fileStore, chapterNumber)) return;
  const runId = createBenchmarkRunId(`codex_benchmark_ch${chapterNumber}_preview`);
  await runMeasuredStage(context, level, `chapter-${formatChapter(chapterNumber)}-preview`, `chapter ${context.projectId} ${chapterNumber} --provider codex-text --commit`, runId, async () => {
    const stateBefore = await context.fileStore.readJson(context.paths.storyState(), StoryStateSchema);
    const result = await runChapterFullProduction(
      {
        projectId: context.projectId,
        projectsRoot: context.projectsRoot,
        chapterNumber,
        provider: 'codex-text',
        promptRoot: context.promptRoot,
        runId,
        maxRevisions: 2,
        commit: true,
        codexFinalMode: codexFinalModeForBenchmark(context.input),
        ...codexOptions(context.input)
      },
      context.fileStore
    );
    const stateAfter = await context.fileStore.readJson(context.paths.storyState(), StoryStateSchema);
    if (hashJson(stateBefore) !== hashJson(stateAfter)) {
      throw new Error(`Codex preview mutated Story State for chapter ${chapterNumber}.`);
    }
    if (
      result.status !== 'codex_commit_preview' ||
      result.previewOnly !== true ||
      result.codexPatchPath === undefined ||
      result.stateDiffPath === undefined ||
      result.qualityReportPath === undefined
    ) {
      throw new Error(`Codex preview did not produce a complete controlled-commit preview for chapter ${chapterNumber}.`);
    }
    return { runId: result.runId, artifacts: result.artifacts };
  });
}

async function runChapterConfirmStage(context: StageContext, chapterNumber: number, level: Exclude<CodexBenchmarkLevel, 'all'>): Promise<void> {
  const state = await readStoryStateOrZero(context.paths, context.fileStore);
  if (state.latestCommittedChapter >= chapterNumber) return;
  const runId = createBenchmarkRunId(`codex_benchmark_ch${chapterNumber}_confirm`);
  await runMeasuredStage(context, level, `chapter-${formatChapter(chapterNumber)}-confirm`, `chapter ${context.projectId} ${chapterNumber} --provider codex-text --commit --confirm-codex-commit`, runId, async () => {
    const stateBefore = await context.fileStore.readJson(context.paths.storyState(), StoryStateSchema);
    const result = await runChapterFullProduction(
      {
        projectId: context.projectId,
        projectsRoot: context.projectsRoot,
        chapterNumber,
        provider: 'codex-text',
        promptRoot: context.promptRoot,
        runId,
        maxRevisions: 2,
        commit: true,
        confirmCodexCommit: true,
        codexFinalMode: codexFinalModeForBenchmark(context.input),
        ...codexOptions(context.input)
      },
      context.fileStore
    );
    const stateAfter = await context.fileStore.readJson(context.paths.storyState(), StoryStateSchema);
    if (stateBefore.latestCommittedChapter !== chapterNumber - 1) {
      throw new Error(`Codex confirm expected chapter ${chapterNumber - 1} to be the latest committed chapter before confirming chapter ${chapterNumber}.`);
    }
    if (
      result.status !== 'committed' ||
      result.commitStatus !== 'committed' ||
      result.commitReportPath === undefined ||
      stateAfter.latestCommittedChapter !== chapterNumber
    ) {
      throw new Error(`Codex confirm did not commit chapter ${chapterNumber}.`);
    }
    return { runId: result.runId, artifacts: result.artifacts };
  });
}

async function ensurePriorCommitted(context: StageContext, chapterNumber: number): Promise<void> {
  const state = await readStoryStateOrZero(context.paths, context.fileStore);
  if (state.latestCommittedChapter >= chapterNumber) return;
  for (let current = state.latestCommittedChapter + 1; current <= chapterNumber; current += 1) {
    await ensureChapterPreview(context, current, chapterLevel(current));
    await runChapterConfirmStage(context, current, chapterLevel(current));
  }
}

type StageContext = {
  input: RunCodexRuntimeBenchmarkInput;
  paths: ProjectPaths;
  projectsRoot: string;
  projectId: string;
  promptRoot: string;
  stages: CodexRuntimeBenchmarkStage[];
  fileStore: FileStore;
};

async function runMeasuredStage(
  context: StageContext,
  level: Exclude<CodexBenchmarkLevel, 'all'>,
  stageName: string,
  command: string,
  expectedRunId: string | undefined,
  action: () => Promise<{ runId?: string; artifacts: string[] }>
): Promise<void> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const latestBefore = (await readStoryStateOrZero(context.paths, context.fileStore)).latestCommittedChapter;
  try {
    const result = await action();
    const runId = result.runId ?? expectedRunId;
    const latestAfter = (await readStoryStateOrZero(context.paths, context.fileStore)).latestCommittedChapter;
    const metrics = await collectRunMetrics(context.paths, context.fileStore, runId, result.artifacts.length);
    const stage = {
      level,
      stageName,
      command,
      ...(runId === undefined ? {} : { runId }),
      status: 'success',
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      ...metrics,
      artifactCount: Math.max(metrics.artifactCount, result.artifacts.length),
      stateMutationApplied: metrics.stateMutationApplied || latestAfter !== latestBefore,
      latestCommittedChapterBefore: latestBefore,
      latestCommittedChapterAfter: latestAfter,
      suggestedRetryCommand: suggestedRetryCommand(context.projectId, level, true)
    } satisfies CodexRuntimeBenchmarkStage;
    checkStageBudgets(context, stage);
    context.stages.push(stage);
  } catch (error) {
    const latestAfter = (await readStoryStateOrZero(context.paths, context.fileStore)).latestCommittedChapter;
    const metrics = await collectRunMetrics(context.paths, context.fileStore, expectedRunId, 0);
    const errorCode = classifyRuntimeError(error);
    const failure = await writeRuntimeFailureReport(context.paths, context.fileStore, {
      level,
      stageName,
      errorType: errorCode,
      message: getErrorMessage(error),
      elapsedMs: Date.now() - startedAtMs,
      outputBytes: metrics.outputBytes,
      suggestedRetryCommand: suggestedRetryCommand(context.projectId, level, true)
    });
    context.stages.push({
      level,
      stageName,
      command,
      ...(expectedRunId === undefined ? {} : { runId: expectedRunId }),
      status: 'failed',
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      ...metrics,
      timeoutCount: metrics.timeoutCount + (errorCode === 'CODEX_TIMEOUT' ? 1 : 0),
      artifactCount: metrics.artifactCount,
      stateMutationApplied: false,
      latestCommittedChapterBefore: latestBefore,
      latestCommittedChapterAfter: latestAfter,
      failureReportPath: failure.relativePath,
      errorCode,
      suggestedRetryCommand: suggestedRetryCommand(context.projectId, level, true)
    });
    throw error;
  }
}

function checkStageBudgets(context: StageContext, stage: CodexRuntimeBenchmarkStage): void {
  if (context.input.codexMaxCallsPerStage !== undefined && stage.codexCallCount > context.input.codexMaxCallsPerStage) {
    throw new Error(`Codex stage call budget exceeded for ${stage.stageName}.`);
  }
}

async function collectRunMetrics(paths: ProjectPaths, fileStore: FileStore, runId: string | undefined, fallbackArtifacts: number) {
  const zero = {
    codexCallCount: 0,
    retryCount: 0,
    repairCount: 0,
    timeoutCount: 0,
    promptInputBytes: 0,
    contextBytes: 0,
    schemaBytes: 0,
    outputBytes: 0,
    rawJsonlBytes: 0,
    artifactCount: fallbackArtifacts,
    stateMutationApplied: false
  };
  if (runId === undefined || !(await fileStore.exists(paths.runManifest(runId)))) return zero;
  const manifest = await fileStore.readJson(paths.runManifest(runId), RunManifestSchema);
  if (!isV2(manifest)) return zero;
  const calls = manifest.promptCalls;
  return {
    codexCallCount: calls.filter((call) => call.provider === 'codex-text' || call.provider === 'codex-cli').length,
    retryCount: calls.reduce((sum, call) => sum + (call.retryCount ?? 0), 0),
    repairCount: calls.filter((call) => call.finishReason === 'repaired' || call.promptId.includes('repair')).length,
    timeoutCount: calls.filter((call) => call.errorType === 'CODEX_TIMEOUT').length + manifest.errors.filter((error) => error.code === 'CODEX_TIMEOUT').length,
    promptInputBytes: calls.reduce((sum, call) => sum + (call.promptInputBytes ?? 0), 0),
    contextBytes: calls.reduce((sum, call) => sum + (call.contextBytes ?? 0), 0),
    schemaBytes: calls.reduce((sum, call) => sum + (call.schemaBytes ?? 0), 0),
    outputBytes: calls.reduce((sum, call) => sum + (call.outputBytes ?? 0), 0),
    rawJsonlBytes: calls.reduce((sum, call) => sum + (call.rawJsonlBytes ?? 0), 0),
    artifactCount: manifest.artifacts.length,
    stateMutationApplied: manifest.stateMutations.some((mutation) => mutation.applied)
  };
}

async function writeRuntimeFailureReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: {
    level: Exclude<CodexBenchmarkLevel, 'all'>;
    stageName: string;
    errorType: CodexErrorType;
    message: string;
    elapsedMs: number;
    outputBytes: number;
    suggestedRetryCommand: string;
  }
): Promise<{ relativePath: string }> {
  await fileStore.ensureDir(paths.auditDir());
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_runtime_failure_report');
  await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_runtime_failure_report_v${artifact.version}`,
      projectId: paths.projectId,
      level: input.level,
      stageName: input.stageName,
      errorType: input.errorType,
      message: redactMessage(input.message),
      elapsedMs: input.elapsedMs,
      outputBytes: input.outputBytes,
      stderrExcerptRedacted: redactMessage(input.message).slice(0, 4000),
      storyStateMutated: false,
      suggestedRetryCommand: input.suggestedRetryCommand,
      generatedAt: new Date().toISOString(),
      redacted: true
    },
    CodexRuntimeFailureReportSchema
  );
  return { relativePath: artifact.relativeJsonPath };
}

async function writeBenchmarkReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: Omit<CodexRuntimeBenchmarkReport, 'reportId'>
): Promise<RunCodexRuntimeBenchmarkResult> {
  await fileStore.ensureDir(paths.auditDir());
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_runtime_benchmark_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      ...input,
      reportId: `codex_runtime_benchmark_report_v${artifact.version}`
    },
    CodexRuntimeBenchmarkReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderBenchmarkMarkdown(report));
  return {
    report,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath
  };
}

function resolveLevels(level: CodexBenchmarkLevel): Array<Exclude<CodexBenchmarkLevel, 'all'>> {
  if (level === 'all') return LEVEL_ORDER;
  return [level];
}

function codexOptions(input: RunCodexRuntimeBenchmarkInput) {
  return {
    ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
    codexProfile: input.codexProfile ?? 'clean',
    codexJsonRetries: input.codexJsonRetries ?? 2,
    codexJsonRepair: input.codexJsonRepair ?? true,
    codexJsonRepairRetries: input.codexJsonRepairRetries ?? 1,
    codexTimeoutMs: input.codexStageTimeoutMs ?? input.codexTimeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS,
    ...(input.codexContextBudgetBytes === undefined ? {} : { codexContextBudgetBytes: input.codexContextBudgetBytes }),
    ...(input.codexMaxArtifactsInContext === undefined ? {} : { codexMaxArtifactsInContext: input.codexMaxArtifactsInContext }),
    codexContextMode: input.codexContextMode ?? 'compact'
  };
}

function codexFinalModeForBenchmark(input: RunCodexRuntimeBenchmarkInput): 'codex' | 'local-assemble' | 'light-polish' {
  if (input.optimizationMode === 'low-risk-v1') return 'local-assemble';
  return input.codexFinalMode ?? 'codex';
}

function useBuildBibleCache(input: RunCodexRuntimeBenchmarkInput): boolean {
  return input.useCache === true || input.optimizationMode === 'low-risk-v1';
}

function shouldWriteRealOptimizationReport(input: RunCodexRuntimeBenchmarkInput): boolean {
  return input.useCache === true || input.warmCache === true || input.optimizationMode === 'low-risk-v1' || input.codexFinalMode === 'local-assemble' || input.codexFinalMode === 'light-polish';
}

function boundaryOptions(input: RunCodexRuntimeBenchmarkInput, projectsRoot: string, projectId: string) {
  return {
    projectsRoot,
    projectId,
    ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
    codexProfile: input.codexProfile ?? 'clean',
    timeoutMs: input.codexStageTimeoutMs ?? input.codexTimeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS
  };
}

async function readStoryStateOrZero(paths: ProjectPaths, fileStore: FileStore): Promise<{ latestCommittedChapter: number }> {
  if (!(await fileStore.exists(paths.storyState()))) return { latestCommittedChapter: 0 };
  return fileStore.readJson(paths.storyState(), StoryStateSchema);
}

async function hasCodexPreview(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<boolean> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) return false;
  return (await fileStore.list(chapterDir)).some((fileName) => /^canon_patch_codex_proposal_v\d+\.json$/.test(fileName));
}

async function safeCodexStatus(input: RunCodexRuntimeBenchmarkInput, projectsRoot: string, projectId: string): Promise<Record<string, unknown>> {
  try {
    return { ...(await checkCodexStatus(boundaryOptions(input, projectsRoot, projectId))) };
  } catch (error) {
    return { ok: false, error: redactMessage(getErrorMessage(error)) };
  }
}

async function nextAuditArtifact(paths: ProjectPaths, fileStore: FileStore, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const mdFile = `${baseName}_v${version}.md`;
    const jsonPath = paths.auditArtifact(jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      return {
        version,
        jsonPath,
        mdPath: paths.auditArtifact(mdFile),
        relativeJsonPath: path.join('audit', jsonFile).split(path.sep).join(path.posix.sep),
        relativeMdPath: path.join('audit', mdFile).split(path.sep).join(path.posix.sep)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName} audit artifact.`);
}

function classifyRuntimeError(error: unknown): CodexErrorType {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;
  const message = getErrorMessage(error);
  if (code === 'CODEX_TIMEOUT' || /timeout|timed out/i.test(message)) return 'CODEX_TIMEOUT';
  if (code === 'CODEX_BINARY_NOT_FOUND') return 'CODEX_BINARY_MISSING';
  if (code === 'CODEX_OUTPUT_MISSING') return 'CODEX_NO_FINAL_MESSAGE';
  if (/no final|output missing|missing final/i.test(message)) return 'CODEX_NO_FINAL_MESSAGE';
  if (/schema.*complex/i.test(message)) return 'CODEX_SCHEMA_TOO_COMPLEX';
  if (/prompt.*large/i.test(message)) return 'CODEX_PROMPT_TOO_LARGE';
  if (/repair/i.test(message)) return 'CODEX_REPAIR_LOOP_EXHAUSTED';
  return 'CODEX_EXEC_FAILED';
}

function suggestedRetryCommand(projectId: string, level: Exclude<CodexBenchmarkLevel, 'all'>, resume: boolean): string {
  return `corepack pnpm novel-loop codex benchmark --project-id ${projectId} --level ${level}${resume ? ' --resume' : ''}`;
}

function renderBenchmarkMarkdown(report: CodexRuntimeBenchmarkReport): string {
  return [
    `# Codex Runtime Benchmark ${report.projectId}`,
    '',
    `success: ${String(report.success)}`,
    `profile: ${report.profile}`,
    `totalDurationMs: ${report.totalDurationMs}`,
    `completedLevels: ${report.completedLevels.join(', ') || 'none'}`,
    `failedLevel: ${report.failedLevel ?? 'none'}`,
    '',
    '## Stages',
    ...report.stages.map((stage) => `- ${stage.level}/${stage.stageName}: ${stage.status} (${stage.durationMs}ms, calls=${stage.codexCallCount}, bytes=${stage.outputBytes})`),
    '',
    '## Profile Comparisons',
    ...(report.profileComparisons.length === 0
      ? ['none']
      : report.profileComparisons.map((item) => `- ${item.profile}: ${item.success ? 'success' : 'failed'} (${item.durationMs}ms)`))
  ].join('\n') + '\n';
}

function emptyStage(
  paths: ProjectPaths,
  fileStore: FileStore,
  level: Exclude<CodexBenchmarkLevel, 'all'>,
  stageName: string,
  command: string,
  status: 'success' | 'failed' | 'skipped',
  options: { startedAtMs: number; errorCode?: CodexErrorType; failureReportPath?: string }
): CodexRuntimeBenchmarkStage {
  void paths;
  void fileStore;
  return {
    level,
    stageName,
    command,
    status,
    startedAt: new Date(options.startedAtMs).toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - options.startedAtMs,
    codexCallCount: 0,
    retryCount: 0,
    repairCount: 0,
    timeoutCount: options.errorCode === 'CODEX_TIMEOUT' ? 1 : 0,
    promptInputBytes: 0,
    contextBytes: 0,
    schemaBytes: 0,
    outputBytes: 0,
    rawJsonlBytes: 0,
    artifactCount: 0,
    stateMutationApplied: false,
    latestCommittedChapterBefore: 0,
    latestCommittedChapterAfter: 0,
    ...(options.failureReportPath === undefined ? {} : { failureReportPath: options.failureReportPath }),
    ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
    suggestedRetryCommand: suggestedRetryCommand(paths.projectId, level, true)
  };
}

function chapterLevel(chapterNumber: number): Exclude<CodexBenchmarkLevel, 'all'> {
  if (chapterNumber === 2) return 'chapter2';
  if (chapterNumber === 3) return 'chapter3';
  return 'draft';
}

function formatChapter(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function createBenchmarkRunId(suffix: string): string {
  return createRunId(new Date(), suffix.replace(/[^a-zA-Z0-9]+/g, '_'));
}

function isV2(manifest: RunManifest): manifest is Extract<RunManifest, { schemaVersion: '2' }> {
  return 'schemaVersion' in manifest && manifest.schemaVersion === '2';
}

function redactMessage(message: string): string {
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/["']?[^"'\s,]*auth\.json["']?/g, '"[REDACTED_AUTH_FILE]"');
}
