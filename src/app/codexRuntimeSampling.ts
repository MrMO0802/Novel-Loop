import path from 'node:path';
import { z } from 'zod';

import {
  normalizeCanonPatchProposal,
  normalizeDiagnostics,
  normalizeMission,
  normalizeSceneCards
} from '../providers/codex/normalizers.js';
import { resolveCodexOutputSchema } from '../providers/codex/schemas.js';
import { CodexTextProvider } from '../providers/codexTextProvider.js';
import type { CodexProfile, LLMJsonResult } from '../providers/providerTypes.js';
import { RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import {
  CanonPatchSchema,
  ChapterMissionSchema,
  ChapterQueueSchema,
  CodexRuntimeSamplingReportSchema,
  DiagnosticsReportSchema,
  SceneCardsSchema,
  StoryStateSchema,
  RunManifestSchema
} from '../schemas/index.js';
import type { CodexRuntimeSamplingReport, CodexRuntimeSamplingSample, CodexRuntimeSamplingStage, RunEventType, RunManifest, RunManifestV2 } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface RunCodexRuntimeStageSamplingInput {
  projectId: string;
  projectsRoot?: string;
  promptRoot?: string;
  chapterNumber: number;
  stage: CodexRuntimeSamplingStage;
  samples?: number;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
}

export interface RunCodexRuntimeStageSamplingResult {
  report: CodexRuntimeSamplingReport;
  reportPath: string;
  markdownPath: string;
}

type SampleSummary = Omit<
  CodexRuntimeSamplingReport,
  'reportId' | 'projectId' | 'generatedAt' | 'chapterNumber' | 'stage' | 'promptId' | 'samples' | 'storyStateMutated'
>;

interface StageDescriptor {
  promptId: string;
  responseFormat: 'json' | 'text';
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const SampleFailureReportSchema = z.object({
  sampleId: z.string(),
  errorType: z.string(),
  message: z.string(),
  generatedAt: z.string(),
  storyStateMutated: z.literal(false)
});

const STAGE_DESCRIPTORS: Record<CodexRuntimeSamplingStage, StageDescriptor> = {
  chapter_mission: { promptId: 'planning.plan_chapter_mission_slim', responseFormat: 'json' },
  scene_cards: { promptId: 'planning.generate_scene_cards_slim', responseFormat: 'json' },
  write_scene: { promptId: 'production.write_scene', responseFormat: 'text' },
  canon_patch_proposal: { promptId: 'memory.extract_canon_patch_proposal_slim', responseFormat: 'json' },
  diagnostics: { promptId: 'diagnostics.diagnose_chapter_slim', responseFormat: 'json' },
  final_chapter: { promptId: 'revision.final_chapter', responseFormat: 'text' }
};

export async function runCodexRuntimeStageSampling(
  input: RunCodexRuntimeStageSamplingInput,
  fileStore = new FileStore()
): Promise<RunCodexRuntimeStageSamplingResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const storyStateBefore = await readOptionalText(paths.storyState(), fileStore);
  const descriptor = STAGE_DESCRIPTORS[input.stage];
  const sampleCount = Math.max(1, input.samples ?? 1);
  const samples: CodexRuntimeSamplingSample[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    samples.push(await runOneSample({ input, paths, fileStore, descriptor, sampleIndex: index + 1 }));
  }

  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_runtime_sampling_report');
  const summary = summarizeRuntimeSamples(samples);
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_runtime_sampling_report_v${artifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      chapterNumber: input.chapterNumber,
      stage: input.stage,
      promptId: descriptor.promptId,
      ...summary,
      samples,
      storyStateMutated: false
    },
    CodexRuntimeSamplingReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderSamplingMarkdown(report));
  const storyStateAfter = await readOptionalText(paths.storyState(), fileStore);
  if (storyStateAfter !== storyStateBefore) {
    throw new Error('codex sample-stage mutated Story State');
  }
  return { report, reportPath: artifact.relativeJsonPath, markdownPath: artifact.relativeMdPath };
}

export function summarizeRuntimeSamples(samples: CodexRuntimeSamplingSample[]): SampleSummary {
  const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  const sampleCount = samples.length;
  const successCount = samples.filter((sample) => sample.errorType === undefined).length;
  const failureCount = sampleCount - successCount;
  const retrySamples = samples.filter((sample) => sample.retryCount > 0).length;
  const repairSamples = samples.filter((sample) => sample.repairCount > 0).length;
  const schemaValidSamples = samples.filter((sample) => sample.schemaValid).length;
  const timeoutSamples = samples.filter((sample) => sample.errorType === 'CODEX_TIMEOUT').length;
  const medianDurationMs = percentile(durations, 0.5);
  const p90DurationMs = percentile(durations, 0.9);
  const p95DurationMs = percentile(durations, 0.95);
  const retryRate = rate(retrySamples, sampleCount);
  const repairRate = rate(repairSamples, sampleCount);
  const schemaValidRate = rate(schemaValidSamples, sampleCount);
  const timeoutRate = rate(timeoutSamples, sampleCount);
  const maxDurationMs = durations.at(-1) ?? 0;
  const minDurationMs = durations[0] ?? 0;
  const meanDurationMs = sampleCount === 0 ? 0 : Math.round(samples.reduce((sum, sample) => sum + sample.durationMs, 0) / sampleCount);
  const varianceRatio = medianDurationMs === 0 ? 0 : maxDurationMs / medianDurationMs;
  const tailRatio = medianDurationMs === 0 ? 0 : p95DurationMs / medianDurationMs;
  const varianceLevel = varianceRatio >= 3 || tailRatio >= 2 ? 'high' : varianceRatio >= 1.7 || tailRatio >= 1.5 ? 'medium' : 'low';
  const sampleCountTooLow = sampleCount < 5;
  const retryHeavy = retryRate >= 0.4 || schemaValidRate < 0.8;
  const stableBottleneck = !sampleCountTooLow && !retryHeavy && varianceLevel === 'low' && medianDurationMs >= 5_000;
  const likelyRuntimeVariance = !sampleCountTooLow && !retryHeavy && varianceLevel === 'high';
  const enoughEvidenceForPromptOptimization = stableBottleneck && !likelyRuntimeVariance;
  const recommendation = retryHeavy
    ? 'prompt/schema hardening'
    : stableBottleneck
      ? 'prompt/context/schema optimization'
      : likelyRuntimeVariance
        ? 'runtime variance strategy / repeated benchmark / timeout tuning'
        : sampleCountTooLow
          ? 'collect more samples before prompt optimization'
          : 'continue targeted sampling';

  return {
    sampleCount,
    successCount,
    failureCount,
    minDurationMs,
    maxDurationMs,
    meanDurationMs,
    medianDurationMs,
    p90DurationMs,
    p95DurationMs,
    retryRate,
    repairRate,
    schemaValidRate,
    timeoutRate,
    interpretation: {
      varianceLevel,
      stableBottleneck,
      likelyRuntimeVariance,
      enoughEvidenceForPromptOptimization,
      explanation: buildInterpretationExplanation({ sampleCount, varianceLevel, retryRate, schemaValidRate, medianDurationMs, p95DurationMs })
    },
    recommendation
  };
}

async function runOneSample(context: {
  input: RunCodexRuntimeStageSamplingInput;
  paths: ProjectPaths;
  fileStore: FileStore;
  descriptor: StageDescriptor;
  sampleIndex: number;
}): Promise<CodexRuntimeSamplingSample> {
  const { input, paths, fileStore, descriptor, sampleIndex } = context;
  const sampleId = `${input.stage}_sample_${String(sampleIndex).padStart(3, '0')}`;
  const runId = createRunId(new Date(), `codex_sample_${input.stage}_${String(sampleIndex).padStart(3, '0')}`);
  const runLogger = new RunLogger(paths, fileStore);
  const storyStateBefore = await readOptionalText(paths.storyState(), fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex sample-stage',
    args: {
      provider: 'codex-text',
      chapterNumber: input.chapterNumber,
      stage: input.stage,
      sampleId,
      codexProfile: input.codexProfile ?? 'clean',
      storyStateCommitAllowed: false
    }
  });
  const started = Date.now();
  let errorType: string | undefined;
  let failureReportPath: string | undefined;
  let parsed = false;
  let schemaValid = false;
  let outputBytes = 0;

  try {
    const prompt = await renderStagePrompt(input, paths, fileStore, descriptor.promptId);
    const provider = new CodexTextProvider({
      ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
      projectsRoot: paths.projectsRoot,
      projectId: paths.projectId,
      codexProfile: input.codexProfile ?? 'clean',
      codexJsonRetries: input.codexJsonRetries ?? 2,
      codexJsonRepair: input.codexJsonRepair ?? true,
      codexJsonRepairRetries: input.codexJsonRepairRetries ?? 1,
      ...(input.codexTimeoutMs === undefined ? {} : { codexTimeoutMs: input.codexTimeoutMs }),
      telemetry: { paths, runId, fileStore }
    });
    if (descriptor.responseFormat === 'json') {
      const outputSchema = resolveCodexOutputSchema(descriptor.promptId);
      if (outputSchema === undefined) {
        throw new AppError('OUTPUT_SCHEMA_NOT_FOUND', `No output schema registered for ${descriptor.promptId}`, 1);
      }
      const response = await provider.complete({
        promptId: descriptor.promptId,
        system: 'Novel Loop Engine targeted runtime sampling. Do not edit files.',
        user: prompt,
        responseFormat: 'json',
        metadata: {
          outputSchemaPath: outputSchema.schemaPath,
          schemaName: outputSchema.schemaName
        }
      });
      const result = response.raw as LLMJsonResult;
      parsed = result.jsonParsed;
      outputBytes = byteLength(result.text);
      validateNormalizedStageOutput(descriptor.promptId, result.parsed, paths.projectId, input.chapterNumber);
      schemaValid = true;
    } else {
      const response = await provider.complete({
        promptId: descriptor.promptId,
        system: 'Novel Loop Engine targeted runtime sampling. Do not edit files.',
        user: prompt,
        responseFormat: 'markdown'
      });
      parsed = false;
      schemaValid = true;
      outputBytes = byteLength(response.text);
    }
  } catch (error) {
    errorType = classifySamplingError(error);
    failureReportPath = await writeSampleFailure(paths, fileStore, sampleId, errorType, getErrorMessage(error));
    await runLogger.recordError(runId, { code: errorType, message: getErrorMessage(error), recoverable: true });
  }

  const metrics = await readSampleMetrics(paths, fileStore, runId, descriptor.promptId);
  await copyChildCodexTimingEvents(paths, fileStore, runLogger, runId, metrics.childRunIds);
  const sampleDir = path.posix.join('audit', 'codex', 'samples', sampleId);
  const sampleArtifactPath = path.posix.join(sampleDir, 'sample_result.json');
  const storyStateAfter = await readOptionalText(paths.storyState(), fileStore);
  const stateMutated = storyStateAfter !== storyStateBefore;
  if (stateMutated) {
    await runLogger.recordError(runId, { code: 'CODEX_SAMPLE_STATE_MUTATED', message: 'sample-stage mutated Story State', recoverable: false });
  }
  const sample = CodexRuntimeSamplingReportSchema.shape.samples.element.parse({
    sampleId,
    runId,
    promptCallId: metrics.promptCallId,
    durationMs: Math.max(0, Date.now() - started),
    retryCount: metrics.retryCount,
    repairCount: metrics.repairCount,
    schemaValid,
    jsonParsed: parsed,
    promptInputBytes: metrics.promptInputBytes,
    schemaBytes: metrics.schemaBytes,
    outputBytes: metrics.outputBytes || outputBytes,
    ...(errorType === undefined ? {} : { errorType }),
    ...(failureReportPath === undefined ? {} : { failureReportPath }),
    artifactPaths: [...metrics.artifactPaths, sampleArtifactPath, ...(failureReportPath === undefined ? [] : [failureReportPath])],
    stateMutated: false
  } satisfies CodexRuntimeSamplingSample);
  await fileStore.ensureDir(paths.projectArtifact(sampleDir));
  await fileStore.writeJson(paths.projectArtifact(sampleArtifactPath), sample, CodexRuntimeSamplingReportSchema.shape.samples.element);
  await runLogger.recordArtifact(runId, sampleArtifactPath, {
    action: 'generated',
    stage: 'codex_runtime_sampling',
    provenanceNote: `targeted ${input.stage} runtime sample result`
  });
  if (failureReportPath !== undefined) {
    await runLogger.recordArtifact(runId, failureReportPath, {
      action: 'generated',
      stage: 'codex_runtime_sampling',
      provenanceNote: `targeted ${input.stage} runtime sample failure`
    });
  }
  await runLogger.endRun(runId, errorType === undefined ? 'success' : 'failed');
  if (stateMutated) {
    throw new Error('codex sample-stage mutated Story State');
  }
  return sample;
}

async function renderStagePrompt(input: RunCodexRuntimeStageSamplingInput, paths: ProjectPaths, fileStore: FileStore, promptId: string): Promise<string> {
  const promptService = new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const queue = await readOptionalJson(paths.chapterQueue(), fileStore, ChapterQueueSchema);
  const queueItem = queue?.chapters.find((chapter) => chapter.chapterNumber === input.chapterNumber) ?? {};
  return promptService.renderPrompt(promptId, {
    CHAPTER_NUMBER: input.chapterNumber,
    STORY_STATE_SUMMARY: compactJson({
      latestCommittedChapter: storyState.latestCommittedChapter,
      canonFacts: storyState.canonFacts.slice(-8),
      openDebts: storyState.narrativeDebts.filter((debt) => debt.status !== 'resolved').slice(0, 8),
      readerState: storyState.readerState
    }),
    CHAPTER_QUEUE_ITEM: compactJson(queueItem),
    MISSION_SUMMARY: sampleMissionSummary(input.chapterNumber),
    SELECTED_PLAN_SUMMARY: sampleSelectedPlanSummary(input.chapterNumber),
    CANDIDATE_COUNT: 3,
    CANDIDATE_IDS: 'plan_001, plan_002, plan_003',
    PLAN_CANDIDATES: samplePlanCandidates(input.chapterNumber),
    SCENE_CARD_JSON: sampleSceneCard(input.chapterNumber),
    STYLE_SUMMARY: 'Lean suspense prose with conservative continuity.',
    SOURCE_FINAL_PATH: path.posix.join('chapters', `chapter_${String(input.chapterNumber).padStart(3, '0')}`, 'final.md'),
    FINAL_MARKDOWN: await readOptionalProjectText(paths, path.posix.join('chapters', `chapter_${String(input.chapterNumber).padStart(3, '0')}`, 'final.md'), sampleFinal(input.chapterNumber), fileStore),
    DRAFT_VERSION: 1,
    DRAFT_SUMMARY: `Chapter ${input.chapterNumber} draft advances the queued mystery without resolving final answers.`,
    DRAFT_MARKDOWN: await readOptionalProjectText(paths, path.posix.join('chapters', `chapter_${String(input.chapterNumber).padStart(3, '0')}`, 'draft_v1.md'), sampleDraft(input.chapterNumber), fileStore),
    DIAGNOSTICS_SUMMARY: 'No hard continuity issue in sample context.',
    REVISION_PLAN_SUMMARY: 'Preserve continuity and tighten the chapter hook.'
  });
}

function validateNormalizedStageOutput(promptId: string, value: unknown, projectId: string, chapterNumber: number): void {
  if (promptId === 'planning.plan_chapter_mission_slim') {
    ChapterMissionSchema.parse(normalizeMission(value, { projectId, chapterNumber }));
  } else if (promptId === 'planning.generate_scene_cards_slim') {
    SceneCardsSchema.parse(normalizeSceneCards(value, { projectId, chapterNumber }));
  } else if (promptId === 'diagnostics.diagnose_chapter_slim') {
    DiagnosticsReportSchema.parse(normalizeDiagnostics(value, { projectId, chapterNumber }));
  } else if (promptId === 'memory.extract_canon_patch_proposal_slim') {
    CanonPatchSchema.parse(normalizeCanonPatchProposal(value, { projectId, chapterNumber }));
  }
}

async function readSampleMetrics(paths: ProjectPaths, fileStore: FileStore, runId: string, promptId: string): Promise<{
  promptCallId: string;
  retryCount: number;
  repairCount: number;
  promptInputBytes: number;
  schemaBytes: number;
  outputBytes: number;
  artifactPaths: string[];
  childRunIds: string[];
}> {
  try {
    const manifest = await fileStore.readJson(paths.runManifest(runId), RunManifestSchema);
    if (!isV2(manifest)) return emptySampleMetrics(promptId);
    const calls = manifest.promptCalls.filter((call) => call.promptId === promptId);
    const call = calls.at(-1) ?? manifest.promptCalls.at(-1);
    const artifactPaths = manifest.artifacts.map((artifact) => artifact.path);
    const childRunIds = calls.map((item) => item.requestId).filter((requestId): requestId is string => requestId !== undefined);
    return {
      promptCallId: call?.promptCallId ?? `prompt_missing_${promptId.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      retryCount: calls.reduce((sum, item) => sum + (item.retryCount ?? 0), 0),
      repairCount: calls.filter((item) => item.finishReason === 'repaired').length,
      promptInputBytes: calls.reduce((sum, item) => sum + (item.promptInputBytes ?? 0), 0),
      schemaBytes: calls.reduce((sum, item) => sum + (item.schemaBytes ?? 0), 0),
      outputBytes: calls.reduce((sum, item) => sum + (item.outputBytes ?? 0), 0),
      artifactPaths,
      childRunIds
    };
  } catch {
    return emptySampleMetrics(promptId);
  }
}

function emptySampleMetrics(promptId: string) {
  return {
    promptCallId: `prompt_missing_${promptId.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    retryCount: 0,
    repairCount: 0,
    promptInputBytes: 0,
    schemaBytes: 0,
    outputBytes: 0,
    artifactPaths: [] as string[],
    childRunIds: [] as string[]
  };
}

async function copyChildCodexTimingEvents(paths: ProjectPaths, fileStore: FileStore, runLogger: RunLogger, sampleRunId: string, childRunIds: string[]): Promise<void> {
  for (const childRunId of childRunIds) {
    const eventPath = paths.runEvents(childRunId);
    if (!(await fileStore.exists(eventPath))) continue;
    const lines = (await fileStore.readText(eventPath)).trim().split('\n').filter(Boolean);
    for (const line of lines) {
      let event: { eventType?: unknown; timestamp?: unknown; payload?: unknown; relatedArtifactPaths?: unknown };
      try {
        event = JSON.parse(line) as { eventType?: unknown; timestamp?: unknown; payload?: unknown; relatedArtifactPaths?: unknown };
      } catch {
        continue;
      }
      if (typeof event.eventType !== 'string' || !event.eventType.startsWith('CODEX_') || typeof event.timestamp !== 'string') continue;
      await runLogger.recordEvent(sampleRunId, event.eventType as RunEventType, {
        stage: 'codex',
        timestamp: event.timestamp,
        payload: {
          childRunId,
          ...(isRecord(event.payload) ? event.payload : {})
        },
        relatedArtifactPaths: Array.isArray(event.relatedArtifactPaths) ? event.relatedArtifactPaths.filter((item): item is string => typeof item === 'string') : []
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function writeSampleFailure(paths: ProjectPaths, fileStore: FileStore, sampleId: string, errorType: string, message: string): Promise<string> {
  const relativePath = path.posix.join('audit', 'codex', 'samples', sampleId, 'failure_report.json');
  await fileStore.ensureDir(path.dirname(paths.projectArtifact(relativePath)));
  await fileStore.writeJson(paths.projectArtifact(relativePath), {
    sampleId,
    errorType,
    message: redactFailureMessage(message),
    generatedAt: new Date().toISOString(),
    storyStateMutated: false
  }, SampleFailureReportSchema);
  return relativePath;
}

async function nextAuditArtifact(paths: ProjectPaths, fileStore: FileStore, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const jsonPath = paths.auditArtifact(jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      const mdFile = `${baseName}_v${version}.md`;
      return {
        version,
        jsonPath,
        mdPath: paths.auditArtifact(mdFile),
        relativeJsonPath: path.join('audit', jsonFile),
        relativeMdPath: path.join('audit', mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName}.`);
}

function percentile(sortedDurations: number[], percentileValue: number): number {
  if (sortedDurations.length === 0) return 0;
  const index = Math.ceil(percentileValue * sortedDurations.length) - 1;
  return sortedDurations[Math.min(sortedDurations.length - 1, Math.max(0, index))] ?? 0;
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(4));
}

function buildInterpretationExplanation(input: { sampleCount: number; varianceLevel: 'low' | 'medium' | 'high'; retryRate: number; schemaValidRate: number; medianDurationMs: number; p95DurationMs: number }): string {
  if (input.sampleCount < 5) {
    return `Only ${input.sampleCount} sample(s); collect more data before prompt optimization.`;
  }
  if (input.retryRate >= 0.4 || input.schemaValidRate < 0.8) {
    return `Retry/schema instability dominates: retryRate=${input.retryRate}, schemaValidRate=${input.schemaValidRate}.`;
  }
  if (input.varianceLevel === 'high') {
    return `High variance: median=${input.medianDurationMs}ms, p95=${input.p95DurationMs}ms.`;
  }
  if (input.varianceLevel === 'low') {
    return `Low variance: median=${input.medianDurationMs}ms, p95=${input.p95DurationMs}ms.`;
  }
  return `Medium variance: median=${input.medianDurationMs}ms, p95=${input.p95DurationMs}ms.`;
}

function renderSamplingMarkdown(report: CodexRuntimeSamplingReport): string {
  return [
    `# Codex Runtime Sampling ${report.projectId}`,
    '',
    `chapterNumber: ${report.chapterNumber}`,
    `stage: ${report.stage}`,
    `promptId: ${report.promptId}`,
    `sampleCount: ${report.sampleCount}`,
    `successCount: ${report.successCount}`,
    `failureCount: ${report.failureCount}`,
    `medianDurationMs: ${report.medianDurationMs}`,
    `p95DurationMs: ${report.p95DurationMs}`,
    `retryRate: ${report.retryRate}`,
    `schemaValidRate: ${report.schemaValidRate}`,
    `varianceLevel: ${report.interpretation.varianceLevel}`,
    `stableBottleneck: ${String(report.interpretation.stableBottleneck)}`,
    `likelyRuntimeVariance: ${String(report.interpretation.likelyRuntimeVariance)}`,
    `recommendation: ${report.recommendation}`
  ].join('\n') + '\n';
}

async function readOptionalText(filePath: string, fileStore: FileStore): Promise<string> {
  if (!(await fileStore.exists(filePath))) return '';
  return fileStore.readText(filePath);
}

async function readOptionalProjectText(paths: ProjectPaths, relativePath: string, fallback: string, fileStore: FileStore): Promise<string> {
  const absolutePath = paths.projectArtifact(relativePath);
  if (!(await fileStore.exists(absolutePath))) return fallback;
  return fileStore.readText(absolutePath);
}

async function readOptionalJson<T>(filePath: string, fileStore: FileStore, schema: z.ZodType<T>): Promise<T | undefined> {
  if (!(await fileStore.exists(filePath))) return undefined;
  try {
    return await fileStore.readJson(filePath, schema);
  } catch {
    return undefined;
  }
}

function isV2(manifest: RunManifest): manifest is RunManifestV2 {
  return 'schemaVersion' in manifest && manifest.schemaVersion === '2';
}

function classifySamplingError(error: unknown): string {
  if (error instanceof AppError) return error.code;
  const message = getErrorMessage(error);
  if (/timeout/i.test(message)) return 'CODEX_TIMEOUT';
  if (/schema/i.test(message)) return 'CODEX_SCHEMA_VALIDATION_FAILED';
  if (/json|parse/i.test(message)) return 'CODEX_INVALID_JSON';
  return 'CODEX_SAMPLE_FAILED';
}

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function sampleMissionSummary(chapterNumber: number): string {
  return `Chapter ${chapterNumber} advances the queued mystery while preserving unresolved final answers.`;
}

function sampleSelectedPlanSummary(chapterNumber: number): string {
  return `Plan 001 follows the strongest committed clue into chapter ${chapterNumber}.`;
}

function samplePlanCandidates(chapterNumber: number): string {
  return compactJson({
    chapterNumber,
    candidates: [
      { id: 'plan_001', title: 'Continuity First', summary: `Advance chapter ${chapterNumber} from prior facts.` },
      { id: 'plan_002', title: 'Tension First', summary: 'Open with a sharper obstacle.' },
      { id: 'plan_003', title: 'Reader Hook First', summary: 'Delay explanation and sharpen curiosity.' }
    ]
  });
}

function sampleSceneCard(chapterNumber: number): string {
  return compactJson({
    sceneId: 'scene_001',
    chapterNumber,
    purpose: `Advance chapter ${chapterNumber}.`,
    conflict: 'Investigation pressure versus incomplete knowledge.',
    entryPoint: 'The clue returns.',
    exitPoint: 'The next question sharpens.',
    characters: ['char_lincheng'],
    location: 'Old Building'
  });
}

function sampleDraft(chapterNumber: number): string {
  return `# Chapter ${chapterNumber}\n\nLin Cheng follows the old clue and finds one more trace, but not the final answer.\n`;
}

function sampleFinal(chapterNumber: number): string {
  return `# Chapter ${chapterNumber}\n\nLin Cheng follows the old clue and records one new fact for the case.\n`;
}

function redactFailureMessage(message: string): string {
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/["']?[^"'\s,]*auth\.json["']?/g, '"[REDACTED_AUTH_FILE]"');
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
