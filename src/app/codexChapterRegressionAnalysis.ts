import path from 'node:path';

import { inferCodexPromptStage } from '../providers/codex/promptStageMapping.js';
import {
  CodexChapterRegressionAnalysisSchema,
  CodexCrossChapterContinuityReportSchema,
  CodexRuntimeBenchmarkReportSchema,
  CodexStageRuntimeProfileReportSchema,
  RunManifestSchema
} from '../schemas/index.js';
import type {
  CodexChapterRegressionAnalysis,
  CodexRuntimeBenchmarkReport,
  CodexRuntimeBenchmarkStage,
  CodexStageRuntimeProfileReport,
  RunManifest,
  RunManifestV2
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface GenerateCodexChapterRegressionAnalysisInput {
  projectId: string;
  projectsRoot?: string;
}

export interface GenerateCodexChapterRegressionAnalysisResult {
  report: CodexChapterRegressionAnalysis;
  reportPath: string;
  markdownPath: string;
}

interface PromptCallDetail {
  promptCallId: string;
  runId: string;
  command: string;
  chapterNumber?: number;
  promptId: string;
  stage: string;
  durationMs: number;
  promptInputBytes: number;
  contextBytes: number;
  schemaBytes: number;
  outputBytes: number;
  rawJsonlBytes: number;
  retryCount: number;
  repairCount: number;
  artifactPaths: string[];
  rawOutputPath?: string;
  finalOutputPath?: string;
  parsedOutputPath?: string;
  timestamp: string;
  parentPromptCallId?: string;
  parentPromptId?: string;
  parentStage?: string;
  status: string;
  errorType?: string;
  classified: boolean;
  likelyCategory: string;
  wrapperCallType?: string;
  attributionMode?: string;
  attributionReason?: string;
}

interface StageAggregate {
  stage: string;
  durationMs: number;
  promptCallCount: number;
  codexCallCount: number;
  retryCount: number;
  repairCount: number;
  promptInputBytes: number;
  contextBytes: number;
  schemaBytes: number;
  outputBytes: number;
  rawJsonlBytes: number;
  artifactPaths: Set<string>;
  failureCount: number;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const BASELINE_SOURCE = 'M26.5 fixed chapter baselines with proportional substage allocation';
const BASELINE_CHAPTER_DURATIONS: Record<number, number> = {
  2: 341_236,
  3: 348_771
};
const TARGET_CHAPTERS = [2, 3] as const;
const STAGES = [
  'chapter_mission',
  'plan_candidates',
  'ranking',
  'scene_cards',
  'write_scene',
  'diagnostics',
  'revision_plan',
  'final_chapter',
  'local_assemble',
  'canon_patch_proposal',
  'state_diff',
  'confirm_apply'
];

export async function generateCodexChapterRegressionAnalysis(
  input: GenerateCodexChapterRegressionAnalysisInput,
  fileStore = new FileStore()
): Promise<GenerateCodexChapterRegressionAnalysisResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const storyStateBefore = await readOptionalText(paths.storyState(), fileStore);
  const benchmark = await readBestBenchmark(paths, fileStore);
  const profile = await readLatestProfile(paths, fileStore);
  const calls = uniqueCalls([...(profile === undefined ? [] : callsFromProfile(profile)), ...(await callsFromRunManifests(paths, fileStore))]);
  const continuityWarnings = await readContinuityWarnings(paths, fileStore);
  const qualityCriticalIssues = await readQualityCriticalIssues(paths, fileStore);
  const currentBenchmarkPath = benchmark?.relativePath ?? 'audit/codex_runtime_benchmark_report_missing.json';
  const baselineChapters = TARGET_CHAPTERS.map((chapterNumber) => {
    const baselineDuration = baselineDurationFor(chapterNumber);
    return buildChapterComparison(chapterNumber, baselineDuration, baselineDuration, [], qualityCriticalIssues[chapterNumber] ?? 0, continuityWarnings[chapterNumber] ?? 0);
  });
  const rawCurrentChapters = TARGET_CHAPTERS.map((chapterNumber) =>
    buildChapterComparison(
      chapterNumber,
      baselineDurationFor(chapterNumber),
      durationFromBenchmark(benchmark?.report, chapterNumber),
      calls.filter((call) => call.chapterNumber === chapterNumber),
      qualityCriticalIssues[chapterNumber] ?? 0,
      continuityWarnings[chapterNumber] ?? 0
    )
  );
  const duplicatePromptCalls = detectDuplicatePromptCalls(calls);
  const repeatedStageCalls = detectRepeatedStageCalls(duplicatePromptCalls);
  const promptBytesRegressions = detectBytesRegressions(calls, 'promptInputBytes');
  const schemaBytesRegressions = detectBytesRegressions(calls, 'schemaBytes');
  const outputBytesRegressions = detectBytesRegressions(calls, 'outputBytes');
  const retryRegressions = detectRetryRepairRegressions(calls, 'retry');
  const repairRegressions = detectRetryRepairRegressions(calls, 'repair');
  const jsonRepairHotspots = repairRegressions.filter((regression) => regression.currentRepairCount > 0 || regression.stage === 'json_repair');
  const mappingCleanup = buildMappingCleanup(calls, profile);
  const rootCauses = buildRootCauses({
    duplicatePromptCalls,
    promptBytesRegressions,
    schemaBytesRegressions,
    outputBytesRegressions,
    retryRegressions,
    repairRegressions,
    calls
  });
  const recommendedFixes = buildRecommendedFixes(rootCauses);
  const currentChapters = applyExplanationCoverage(rawCurrentChapters, rootCauses);
  const runtimeGapReportPath = await latestAuditReportPath(paths, fileStore, 'codex_runtime_gap_report');
  const missionRetryReportPath = await latestAuditReportPath(paths, fileStore, 'codex_mission_retry_report');
  const missionMicroBenchmarkPath = await latestAuditReportPath(paths, fileStore, 'codex_mission_micro_benchmark');
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_chapter_regression_analysis');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_chapter_regression_analysis_v${artifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      baselineSource: BASELINE_SOURCE,
      currentBenchmarkPath,
      baselineChapters,
      currentChapters,
      regressions: currentChapters.filter((chapter) => chapter.deltaMs > 0),
      improvedStages: currentChapters.flatMap((chapter) => Object.values(chapter.durationByStage).filter((stage) => stage.comparedToBaselineDeltaMs < 0)),
      suspectedRootCauses: rootCauses,
      recommendedFixes,
      recommendations: buildRegressionRecommendations(currentChapters, rootCauses, mappingCleanup, {
        ...(runtimeGapReportPath === undefined ? {} : { runtimeGapReportPath }),
        ...(missionMicroBenchmarkPath === undefined ? {} : { missionMicroBenchmarkPath })
      }),
      ...(runtimeGapReportPath === undefined ? {} : { runtimeGapReportPath }),
      ...(missionRetryReportPath === undefined ? {} : { missionRetryReportPath }),
      ...(missionMicroBenchmarkPath === undefined ? {} : { missionMicroBenchmarkPath }),
      confidence: benchmark !== undefined && profile !== undefined ? 'high' : 'low',
      warnings: buildWarnings(benchmark, profile, mappingCleanup),
      duplicatePromptCalls,
      repeatedStageCalls,
      rerunOnConfirmDetected: detectRerunOnConfirm(benchmark?.report, calls),
      previewArtifactsReused: confirmStagesAvoidCodex(benchmark?.report),
      previewPatchReused: confirmStagesAvoidCodex(benchmark?.report),
      finalReused: hasLocalAssemble(paths, fileStore) || confirmStagesAvoidCodex(benchmark?.report),
      stateDiffReused: confirmStagesAvoidCodex(benchmark?.report),
      promptBytesRegressions,
      schemaBytesRegressions,
      outputBytesRegressions,
      retryRegressions,
      repairRegressions,
      jsonRepairHotspots,
      mappingCleanup,
      storyStateMutated: false
    },
    CodexChapterRegressionAnalysisSchema
  );
  await fileStore.writeText(artifact.mdPath, renderMarkdown(report));
  const storyStateAfter = await readOptionalText(paths.storyState(), fileStore);
  if (storyStateBefore !== storyStateAfter) {
    throw new Error('regression-analysis mutated Story State');
  }
  return {
    report,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath
  };
}

async function readBestBenchmark(paths: ProjectPaths, fileStore: FileStore): Promise<{ relativePath: string; report: CodexRuntimeBenchmarkReport } | undefined> {
  if (!(await fileStore.exists(paths.auditDir()))) return undefined;
  const reports: Array<{ relativePath: string; report: CodexRuntimeBenchmarkReport; version: number }> = [];
  for (const fileName of await fileStore.list(paths.auditDir())) {
    if (!/^codex_runtime_benchmark_report_v\d+\.json$/.test(fileName)) continue;
    try {
      reports.push({
        relativePath: path.join('audit', fileName),
        report: await fileStore.readJson(paths.auditArtifact(fileName), CodexRuntimeBenchmarkReportSchema),
        version: versionOf(fileName)
      });
    } catch {
      // audit validates malformed benchmark artifacts.
    }
  }
  return reports
    .sort((left, right) => scoreBenchmark(right.report) - scoreBenchmark(left.report) || right.version - left.version)
    .at(0);
}

function scoreBenchmark(report: CodexRuntimeBenchmarkReport): number {
  const hasChapter2 = report.stages.some((stage) => stage.level === 'chapter2');
  const hasChapter3 = report.stages.some((stage) => stage.level === 'chapter3');
  return (hasChapter2 ? 10 : 0) + (hasChapter3 ? 10 : 0) + report.completedLevels.length;
}

async function readLatestProfile(paths: ProjectPaths, fileStore: FileStore): Promise<CodexStageRuntimeProfileReport | undefined> {
  if (!(await fileStore.exists(paths.auditDir()))) return undefined;
  const files = (await fileStore.list(paths.auditDir()))
    .filter((fileName) => /^codex_stage_runtime_profile_v\d+\.json$/.test(fileName))
    .sort((left, right) => versionOf(right) - versionOf(left));
  if (files[0] === undefined) return undefined;
  try {
    return await fileStore.readJson(paths.auditArtifact(files[0]), CodexStageRuntimeProfileReportSchema);
  } catch {
    return undefined;
  }
}

function callsFromProfile(profile: CodexStageRuntimeProfileReport): PromptCallDetail[] {
  return uniqueProfileCalls(profile).map((call) => ({
    promptCallId: call.promptCallId,
    runId: call.runId,
    command: call.command,
    ...(call.chapterNumber === undefined ? {} : { chapterNumber: call.chapterNumber }),
    promptId: call.promptId,
    stage: normalizeStage(call.inferredStage, call.promptId),
    durationMs: Math.round(call.durationMs),
    promptInputBytes: call.promptInputBytes,
    contextBytes: call.contextBytes,
    schemaBytes: call.schemaBytes,
    outputBytes: call.outputBytes,
    rawJsonlBytes: call.rawJsonlBytes,
    retryCount: call.retryCount,
    repairCount: call.repairCount,
    artifactPaths: call.artifactPaths,
    ...(call.rawOutputPath === undefined ? {} : { rawOutputPath: call.rawOutputPath }),
    ...(call.finalOutputPath === undefined ? {} : { finalOutputPath: call.finalOutputPath }),
    ...(call.parsedOutputPath === undefined ? {} : { parsedOutputPath: call.parsedOutputPath }),
    timestamp: new Date(0).toISOString(),
    ...(call.parentPromptCallId === undefined ? {} : { parentPromptCallId: call.parentPromptCallId }),
    ...(call.parentPromptId === undefined ? {} : { parentPromptId: call.parentPromptId }),
    ...(call.parentStage === undefined ? {} : { parentStage: call.parentStage }),
    status: call.status,
    ...(call.errorType === undefined ? {} : { errorType: call.errorType }),
    classified: call.classified,
    likelyCategory: call.likelyCategory,
    ...(call.wrapperCallType === undefined ? {} : { wrapperCallType: call.wrapperCallType }),
    ...(call.attributionMode === undefined ? {} : { attributionMode: call.attributionMode }),
    ...(call.attributionReason === undefined ? {} : { attributionReason: call.attributionReason })
  }));
}

async function callsFromRunManifests(paths: ProjectPaths, fileStore: FileStore): Promise<PromptCallDetail[]> {
  if (!(await fileStore.exists(paths.runsDir()))) return [];
  const result: PromptCallDetail[] = [];
  for (const runId of await fileStore.list(paths.runsDir())) {
    const manifestPath = paths.runManifest(runId);
    if (!(await fileStore.exists(manifestPath))) continue;
    let manifest: RunManifest;
    try {
      manifest = await fileStore.readJson(manifestPath, RunManifestSchema);
    } catch {
      continue;
    }
    if (!isV2(manifest)) continue;
    const chapterNumber = manifest.resolvedContext.chapterNumber ?? manifest.resolvedContext.resolvedChapterNumber;
    for (const [index, call] of manifest.promptCalls.entries()) {
      if (call.provider !== 'codex-text' && call.provider !== 'codex-cli') continue;
      const mapping = inferCodexPromptStage(call.promptId);
      const repairCount = call.finishReason === 'repaired' || call.wrapperCallType === 'repair' || mapping.stage === 'json_repair' ? 1 : 0;
      result.push({
        promptCallId: call.promptCallId ?? `prompt_${String(index + 1).padStart(3, '0')}_${sanitizeId(call.promptId)}`,
        runId: manifest.runId,
        command: manifest.command,
        ...(chapterNumber === undefined ? {} : { chapterNumber }),
        promptId: call.promptId,
        stage: normalizeStage(call.parentStage ?? mapping.stage, call.promptId),
        durationMs: Math.round(call.latencyMs),
        promptInputBytes: call.promptInputBytes ?? 0,
        contextBytes: call.contextBytes ?? 0,
        schemaBytes: call.schemaBytes ?? 0,
        outputBytes: call.outputBytes ?? 0,
        rawJsonlBytes: call.rawJsonlBytes ?? 0,
        retryCount: call.retryCount ?? 0,
        repairCount,
        artifactPaths: uniqueStrings([call.rawOutputPath, call.finalOutputPath, call.parsedOutputPath, call.inputArtifactPath, call.outputArtifactPath]),
        ...(call.rawOutputPath === undefined ? {} : { rawOutputPath: call.rawOutputPath }),
        ...(call.finalOutputPath === undefined ? {} : { finalOutputPath: call.finalOutputPath }),
        ...(call.parsedOutputPath === undefined ? {} : { parsedOutputPath: call.parsedOutputPath }),
        timestamp: call.startedAt,
        ...(call.parentPromptCallId === undefined ? {} : { parentPromptCallId: call.parentPromptCallId }),
        ...(call.parentPromptId === undefined ? {} : { parentPromptId: call.parentPromptId }),
        ...(call.parentStage === undefined ? {} : { parentStage: call.parentStage }),
        status: call.status ?? 'succeeded',
        ...(call.errorType === undefined ? {} : { errorType: call.errorType }),
        classified: mapping.classified || isDiagnosticOverhead(call.promptId, manifest.command, call.wrapperCallType),
        likelyCategory: isDiagnosticOverhead(call.promptId, manifest.command, call.wrapperCallType) ? 'diagnostic_overhead' : mapping.likelyCategory,
        ...(call.wrapperCallType === undefined ? {} : { wrapperCallType: call.wrapperCallType }),
        ...(call.attributionMode === undefined ? {} : { attributionMode: call.attributionMode }),
        ...(call.attributionReason === undefined ? {} : { attributionReason: call.attributionReason })
      });
    }
  }
  return result;
}

function buildChapterComparison(
  chapterNumber: number,
  baselineDurationMs: number,
  currentDurationMs: number,
  calls: PromptCallDetail[],
  qualityCriticalIssues: number,
  continuityWarnings: number
): CodexChapterRegressionAnalysis['currentChapters'][number] {
  const stageAggregates = new Map<string, StageAggregate>();
  const promptDurations: Record<string, number> = {};
  for (const call of calls) {
    const aggregate = ensureStageAggregate(stageAggregates, call.stage);
    aggregate.durationMs += call.durationMs;
    aggregate.promptCallCount += 1;
    aggregate.codexCallCount += call.promptId.startsWith('codex.') ? 0 : 1;
    aggregate.retryCount += call.retryCount;
    aggregate.repairCount += call.repairCount;
    aggregate.promptInputBytes += call.promptInputBytes;
    aggregate.contextBytes += call.contextBytes;
    aggregate.schemaBytes += call.schemaBytes;
    aggregate.outputBytes += call.outputBytes;
    aggregate.rawJsonlBytes += call.rawJsonlBytes;
    aggregate.failureCount += call.status === 'failed' || call.errorType !== undefined ? 1 : 0;
    for (const artifactPath of call.artifactPaths) aggregate.artifactPaths.add(artifactPath);
    promptDurations[call.promptId] = (promptDurations[call.promptId] ?? 0) + call.durationMs;
  }
  const stageDurationTotal = [...stageAggregates.values()].reduce((sum, stage) => sum + stage.durationMs, 0);
  const durationByStage = Object.fromEntries(
    STAGES.map((stageName) => {
      const aggregate = stageAggregates.get(stageName) ?? emptyStageAggregate(stageName);
      const baselineStageMs = stageDurationTotal === 0 ? 0 : Math.round((aggregate.durationMs / stageDurationTotal) * baselineDurationMs);
      const deltaMs = aggregate.durationMs - baselineStageMs;
      return [
        stageName,
        {
          stage: stageName,
          durationMs: aggregate.durationMs,
          promptCallCount: aggregate.promptCallCount,
          codexCallCount: aggregate.codexCallCount,
          retryCount: aggregate.retryCount,
          repairCount: aggregate.repairCount,
          promptInputBytes: aggregate.promptInputBytes,
          contextBytes: aggregate.contextBytes,
          schemaBytes: aggregate.schemaBytes,
          outputBytes: aggregate.outputBytes,
          rawJsonlBytes: aggregate.rawJsonlBytes,
          artifactCount: aggregate.artifactPaths.size,
          failureCount: aggregate.failureCount,
          comparedToBaselineDeltaMs: deltaMs,
          comparedToBaselineDeltaPercent: baselineStageMs === 0 ? (aggregate.durationMs === 0 ? 0 : 100) : percent(deltaMs, baselineStageMs)
        }
      ];
    })
  );
  const deltaMs = currentDurationMs - baselineDurationMs;
  return {
    chapterNumber,
    baselineDurationMs,
    currentDurationMs,
    deltaMs,
    deltaPercent: percent(deltaMs, baselineDurationMs),
    explainedDeltaMs: 0,
    unexplainedDeltaMs: Math.max(0, deltaMs),
    explanationCoveragePercent: 0,
    durationByStage,
    durationByPromptId: promptDurations,
    codexCallCount: calls.filter((call) => !call.promptId.startsWith('codex.')).length,
    retryCount: calls.reduce((sum, call) => sum + call.retryCount, 0),
    repairCount: calls.reduce((sum, call) => sum + call.repairCount, 0),
    promptBytesTotal: calls.reduce((sum, call) => sum + call.promptInputBytes, 0),
    schemaBytesTotal: calls.reduce((sum, call) => sum + call.schemaBytes, 0),
    outputBytesTotal: calls.reduce((sum, call) => sum + call.outputBytes, 0),
    rawJsonlBytesTotal: calls.reduce((sum, call) => sum + call.rawJsonlBytes, 0),
    qualityCriticalIssues,
    continuityWarnings
  };
}

function detectDuplicatePromptCalls(calls: PromptCallDetail[]): CodexChapterRegressionAnalysis['duplicatePromptCalls'] {
  const groups = new Map<string, PromptCallDetail[]>();
  for (const call of calls.filter((item) => item.chapterNumber !== undefined && !item.promptId.startsWith('codex.'))) {
    const key = `${call.chapterNumber}:${call.promptId}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.values()]
    .filter((group) => uniqueStrings(group.map((call) => call.runId)).length > 1)
    .map((group) => {
      const first = group[0]!;
      return {
        promptId: first.promptId,
        chapterNumber: first.chapterNumber!,
        stage: first.stage,
        runIds: uniqueStrings(group.map((call) => call.runId)),
        artifactPaths: uniqueStrings(group.flatMap((call) => call.artifactPaths)),
        reason: 'same promptId was executed more than once for the same chapter',
        safeToReuse: isSafeToReuse(first.stage, first.promptId),
        suggestedFix: isSafeToReuse(first.stage, first.promptId) ? `Reuse ${first.stage} artifact when chapter state hash is unchanged.` : `Keep ${first.stage} reruns until safety checks can prove reuse is valid.`
      };
    });
}

function detectRepeatedStageCalls(duplicates: CodexChapterRegressionAnalysis['duplicatePromptCalls']): CodexChapterRegressionAnalysis['repeatedStageCalls'] {
  return duplicates.map((duplicate) => ({
    chapterNumber: duplicate.chapterNumber,
    stage: duplicate.stage,
    promptIds: [duplicate.promptId],
    runIds: duplicate.runIds,
    reason: duplicate.reason,
    suggestedFix: duplicate.suggestedFix
  }));
}

function detectBytesRegressions(calls: PromptCallDetail[], field: 'promptInputBytes' | 'schemaBytes' | 'outputBytes'): CodexChapterRegressionAnalysis['promptBytesRegressions'] {
  const thresholds = {
    promptInputBytes: 40_000,
    schemaBytes: 30_000,
    outputBytes: 40_000
  };
  const threshold = thresholds[field];
  return calls
    .filter((call) => call.chapterNumber !== undefined && call[field] > threshold)
    .map((call) => ({
      chapterNumber: call.chapterNumber!,
      stage: call.stage,
      promptId: call.promptId,
      baselineBytes: threshold,
      currentBytes: call[field],
      deltaBytes: call[field] - threshold,
      deltaPercent: percent(call[field] - threshold, threshold),
      likelyReason: likelyByteReason(field, call.stage),
      suggestedFix: suggestedByteFix(field, call.stage)
    }))
    .sort((left, right) => right.deltaBytes - left.deltaBytes);
}

function detectRetryRepairRegressions(calls: PromptCallDetail[], kind: 'retry' | 'repair'): CodexChapterRegressionAnalysis['retryRegressions'] {
  return calls
    .filter((call) => call.chapterNumber !== undefined && (kind === 'retry' ? call.retryCount > 0 : call.repairCount > 0))
    .map((call) => ({
      chapterNumber: call.chapterNumber!,
      promptId: call.promptId,
      stage: call.stage,
      baselineRetryCount: 0,
      currentRetryCount: call.retryCount,
      baselineRepairCount: 0,
      currentRepairCount: call.repairCount,
      errorTypes: call.errorType === undefined ? [] : [call.errorType],
      suggestedFix: kind === 'retry' ? 'Inspect schema fit and prompt specificity before raising retry budgets.' : 'Inspect JSON repair output and simplify schema only after preserving validation gates.'
    }))
    .sort((left, right) => right.currentRetryCount + right.currentRepairCount - (left.currentRetryCount + left.currentRepairCount));
}

function buildRootCauses(input: {
  duplicatePromptCalls: CodexChapterRegressionAnalysis['duplicatePromptCalls'];
  promptBytesRegressions: CodexChapterRegressionAnalysis['promptBytesRegressions'];
  schemaBytesRegressions: CodexChapterRegressionAnalysis['schemaBytesRegressions'];
  outputBytesRegressions: CodexChapterRegressionAnalysis['outputBytesRegressions'];
  retryRegressions: CodexChapterRegressionAnalysis['retryRegressions'];
  repairRegressions: CodexChapterRegressionAnalysis['repairRegressions'];
  calls: PromptCallDetail[];
}): CodexChapterRegressionAnalysis['suspectedRootCauses'] {
  const causes: CodexChapterRegressionAnalysis['suspectedRootCauses'] = [];
  for (const duplicate of input.duplicatePromptCalls) {
    const group = input.calls.filter((call) => call.chapterNumber === duplicate.chapterNumber && call.promptId === duplicate.promptId);
    const impactMs = group.slice(1).reduce((sum, call) => sum + call.durationMs, 0);
    causes.push(rootCause('duplicate_call', duplicate.chapterNumber, duplicate.stage, duplicate.promptId, impactMs, 'high', [`runIds=${duplicate.runIds.join(',')}`], duplicate.suggestedFix, 'low', `reuse_${sanitizeId(duplicate.stage)}_ch${duplicate.chapterNumber}`));
  }
  for (const regression of [...input.retryRegressions, ...input.repairRegressions]) {
    const call = input.calls.find((item) => item.chapterNumber === regression.chapterNumber && item.promptId === regression.promptId && item.stage === regression.stage);
    causes.push(rootCause('retry_repair_increase', regression.chapterNumber, regression.stage, regression.promptId, call?.durationMs ?? 0, 'high', [`retry=${regression.currentRetryCount}`, `repair=${regression.currentRepairCount}`], regression.suggestedFix, 'medium', `stabilize_${sanitizeId(regression.stage)}_json_ch${regression.chapterNumber}`));
  }
  for (const regression of input.promptBytesRegressions) {
    causes.push(rootCause('increased_prompt_bytes', regression.chapterNumber, regression.stage, regression.promptId, regression.deltaBytes, 'medium', [`prompt bytes +${regression.deltaBytes}`], regression.suggestedFix, 'low', `measure_context_${sanitizeId(regression.stage)}_ch${regression.chapterNumber}`));
  }
  for (const regression of input.schemaBytesRegressions) {
    causes.push(rootCause('increased_schema_bytes', regression.chapterNumber, regression.stage, regression.promptId, regression.deltaBytes, 'medium', [`schema bytes +${regression.deltaBytes}`], regression.suggestedFix, 'medium', `schema_slim_probe_${sanitizeId(regression.stage)}_ch${regression.chapterNumber}`));
  }
  for (const regression of input.outputBytesRegressions) {
    causes.push(rootCause('increased_output_bytes', regression.chapterNumber, regression.stage, regression.promptId, regression.deltaBytes, 'medium', [`output bytes +${regression.deltaBytes}`], regression.suggestedFix, 'low', `output_cap_probe_${sanitizeId(regression.stage)}_ch${regression.chapterNumber}`));
  }
  return uniqueRootCauses(causes).sort((left, right) => right.impactMs - left.impactMs || left.rootCauseId.localeCompare(right.rootCauseId)).slice(0, 12);
}

function rootCause(
  type: CodexChapterRegressionAnalysis['suspectedRootCauses'][number]['rootCauseType'],
  chapterNumber: number,
  stage: string,
  promptId: string,
  impactMs: number,
  confidence: 'low' | 'medium' | 'high',
  evidence: string[],
  proposedFix: string,
  riskLevel: 'low' | 'medium' | 'high',
  nextExperiment: string
): CodexChapterRegressionAnalysis['suspectedRootCauses'][number] {
  return {
    rootCauseId: `${type}_ch${chapterNumber}_${sanitizeId(stage)}_${sanitizeId(promptId)}`,
    rootCauseType: type,
    affectedChapter: chapterNumber,
    affectedStage: stage,
    affectedPromptId: promptId,
    evidence,
    impactMs,
    confidence,
    proposedFix,
    riskLevel,
    nextExperiment
  };
}

function buildRecommendedFixes(rootCauses: CodexChapterRegressionAnalysis['suspectedRootCauses']): CodexChapterRegressionAnalysis['recommendedFixes'] {
  return rootCauses.slice(0, 8).map((cause) => {
    const experimentId =
      cause.rootCauseType === 'duplicate_call' && cause.affectedStage === 'scene_cards'
        ? `reuse_scene_cards_ch${cause.affectedChapter}`
        : `${cause.nextExperiment}`;
    return {
      experimentId,
      targetChapter: cause.affectedChapter,
      targetStage: cause.affectedStage,
      targetPromptId: cause.affectedPromptId,
      hypothesis: cause.evidence.join('; '),
      change: cause.proposedFix,
      expectedImpactMs: cause.impactMs,
      safetyRisk: cause.riskLevel,
      requiredTests: ['corepack pnpm test', 'corepack pnpm novel-loop audit demo-novel --strict --fix-index'],
      rollbackPlan: `Revert ${experimentId} changes and rerun mock plus Codex benchmark regression checks.`
    };
  });
}

function applyExplanationCoverage(
  chapters: CodexChapterRegressionAnalysis['currentChapters'],
  rootCauses: CodexChapterRegressionAnalysis['suspectedRootCauses']
): CodexChapterRegressionAnalysis['currentChapters'] {
  return chapters.map((chapter) => {
    const explainedDeltaMs = Math.min(
      Math.max(0, chapter.deltaMs),
      rootCauses.filter((cause) => cause.affectedChapter === chapter.chapterNumber).reduce((sum, cause) => sum + cause.impactMs, 0)
    );
    const unexplainedDeltaMs = Math.max(0, chapter.deltaMs - explainedDeltaMs);
    return {
      ...chapter,
      explainedDeltaMs,
      unexplainedDeltaMs,
      explanationCoveragePercent: percent(explainedDeltaMs, Math.max(0, chapter.deltaMs))
    };
  });
}

function buildRegressionRecommendations(
  chapters: CodexChapterRegressionAnalysis['currentChapters'],
  rootCauses: CodexChapterRegressionAnalysis['suspectedRootCauses'],
  mappingCleanup: CodexChapterRegressionAnalysis['mappingCleanup'],
  paths: { runtimeGapReportPath?: string; missionMicroBenchmarkPath?: string }
): CodexChapterRegressionAnalysis['recommendations'] {
  const recommendations: CodexChapterRegressionAnalysis['recommendations'] = [];
  if (chapters.some((chapter) => chapter.deltaMs > 0 && chapter.explanationCoveragePercent < 50)) {
    recommendations.push({
      recommendationType: 'continue_runtime_gap_analysis',
      reason: 'Regression explanation coverage is below 50%; close wall-clock runtime gap before prompt compression.',
      suggestedCommand: paths.runtimeGapReportPath === undefined ? 'corepack pnpm novel-loop codex runtime-gap <projectId>' : `review ${paths.runtimeGapReportPath}`,
      priority: 'high'
    });
  }
  if (rootCauses.some((cause) => cause.rootCauseType === 'retry_repair_increase' && cause.affectedStage === 'chapter_mission')) {
    recommendations.push({
      recommendationType: 'stabilize_mission_retry',
      reason: 'Chapter mission retry was observed; run a targeted mission micro-benchmark before broad prompt changes.',
      suggestedCommand: paths.missionMicroBenchmarkPath === undefined ? 'corepack pnpm novel-loop codex mission-benchmark <projectId> --chapter 2' : `review ${paths.missionMicroBenchmarkPath}`,
      priority: 'medium'
    });
  }
  if (mappingCleanup.unresolvedWarnings.length > 0) {
    recommendations.push({
      recommendationType: 'close_wrapper_attribution',
      reason: `${mappingCleanup.unresolvedWarnings.length} wrapper or prompt mapping warning(s) remain structured but unresolved.`,
      priority: 'medium'
    });
  }
  return recommendations;
}

function buildMappingCleanup(calls: PromptCallDetail[], profile: CodexStageRuntimeProfileReport | undefined): CodexChapterRegressionAnalysis['mappingCleanup'] {
  const diagnosticOverheadClassified = calls
    .filter((call) => isDiagnosticOverhead(call.promptId, call.command, call.wrapperCallType))
    .map((call) => ({ promptId: call.promptId, runId: call.runId, reason: 'standalone Codex smoke/health/exec-json diagnostic overhead' }));
  const unresolved = calls
    .filter((call) => !call.classified && !isDiagnosticOverhead(call.promptId, call.command, call.wrapperCallType))
    .map((call) => structuredUnresolvedWarning(call));
  const unknownPromptMappings = calls
    .filter((call) => call.stage === 'other_codex' && !isDiagnosticOverhead(call.promptId, call.command, call.wrapperCallType) && !call.promptId.startsWith('codex.'))
    .map((call) => ({ promptId: call.promptId, runId: call.runId, artifactPaths: call.artifactPaths, suggestedMapping: 'Add promptId rule or declare diagnostic_overhead if intentional.' }));
  for (const wrapper of profile?.wrapperBreakdown.orphanWrapperCalls ?? []) {
    if (isDiagnosticOverhead(wrapper.promptCallId, 'codex', wrapper.wrapperCallType)) {
      diagnosticOverheadClassified.push({ promptId: wrapper.promptCallId, runId: wrapper.runId, reason: 'orphan wrapper looks like standalone diagnostic overhead' });
    } else if (!unresolved.some((warning) => warning.runId === wrapper.runId && warning.promptCallId === wrapper.promptCallId)) {
      unresolved.push({
        promptId: wrapper.promptCallId,
        runId: wrapper.runId,
        promptCallId: wrapper.promptCallId,
        command: wrapper.command,
        warning: 'unclassified Codex wrapper call remains',
        artifactPaths: uniqueStrings([wrapper.rawOutputPath, wrapper.finalOutputPath, wrapper.parsedOutputPath, wrapper.artifactPath]),
        ...(wrapper.artifactPath === undefined ? {} : { artifactPath: wrapper.artifactPath }),
        ...(wrapper.rawOutputPath === undefined ? {} : { rawOutputPath: wrapper.rawOutputPath }),
        ...(wrapper.finalOutputPath === undefined ? {} : { finalOutputPath: wrapper.finalOutputPath }),
        ...(wrapper.parsedOutputPath === undefined ? {} : { parsedOutputPath: wrapper.parsedOutputPath }),
        timestamp: wrapper.timestamp,
        reason: wrapper.structuredReason,
        suggestedFix: wrapper.suggestedFix,
        ...(wrapper.parentPromptCallId === undefined ? {} : { parentPromptCallId: wrapper.parentPromptCallId }),
        ...(wrapper.parentPromptId === undefined ? {} : { parentPromptId: wrapper.parentPromptId }),
        ...(wrapper.parentStage === undefined ? {} : { parentStage: wrapper.parentStage })
      });
    }
  }
  return {
    unknownPromptMappings,
    diagnosticOverheadClassified,
    unresolvedWarnings: unresolved
  };
}

function structuredUnresolvedWarning(call: PromptCallDetail): CodexChapterRegressionAnalysis['mappingCleanup']['unresolvedWarnings'][number] {
  const reason = structuredWarningReason(call);
  const artifactPath = call.finalOutputPath ?? call.parsedOutputPath ?? call.rawOutputPath ?? call.artifactPaths[0];
  return {
    promptId: call.promptId,
    runId: call.runId,
    promptCallId: call.promptCallId,
    command: call.command,
    warning: 'unclassified Codex prompt call remains',
    artifactPaths: call.artifactPaths,
    ...(artifactPath === undefined ? {} : { artifactPath }),
    ...(call.rawOutputPath === undefined ? {} : { rawOutputPath: call.rawOutputPath }),
    ...(call.finalOutputPath === undefined ? {} : { finalOutputPath: call.finalOutputPath }),
    ...(call.parsedOutputPath === undefined ? {} : { parsedOutputPath: call.parsedOutputPath }),
    timestamp: call.timestamp,
    reason,
    suggestedFix: suggestedFixForStructuredWarning(reason),
    ...(call.parentPromptCallId === undefined ? {} : { parentPromptCallId: call.parentPromptCallId }),
    ...(call.parentPromptId === undefined ? {} : { parentPromptId: call.parentPromptId }),
    ...(call.parentStage === undefined ? {} : { parentStage: call.parentStage })
  };
}

function buildWarnings(benchmark: { report: CodexRuntimeBenchmarkReport } | undefined, profile: CodexStageRuntimeProfileReport | undefined, mappingCleanup: CodexChapterRegressionAnalysis['mappingCleanup']): string[] {
  return [
    ...(benchmark === undefined ? ['No chapter2/chapter3 benchmark report found.'] : []),
    ...(profile === undefined ? ['No codex_stage_runtime_profile report found; prompt-level analysis is incomplete.'] : []),
    ...mappingCleanup.unresolvedWarnings.map((warning) => `Unresolved mapping: ${warning.promptId} in ${warning.runId}`)
  ];
}

function structuredWarningReason(call: PromptCallDetail): NonNullable<CodexChapterRegressionAnalysis['mappingCleanup']['unresolvedWarnings'][number]['reason']> {
  const command = call.command.toLowerCase().replace(/-/g, '_');
  const promptId = call.promptId.toLowerCase().replace(/-/g, '_');
  if (call.wrapperCallType === 'health' || call.wrapperCallType === 'smoke' || promptId.includes('health') || promptId.includes('smoke')) return 'smoke_or_health';
  if (call.parentPromptCallId !== undefined) return 'legacy_missing_parent';
  if (call.wrapperCallType === 'exec_json' && (command.includes('exec_json') || command.includes('smoke'))) return 'diagnostic_overhead';
  if (call.wrapperCallType === 'exec_text' && (command.includes('operator') || command.includes('exec_text'))) return 'standalone_operator_command';
  return 'unknown_runtime_gap';
}

function suggestedFixForStructuredWarning(reason: NonNullable<CodexChapterRegressionAnalysis['mappingCleanup']['unresolvedWarnings'][number]['reason']>): string {
  if (reason === 'legacy_missing_parent') return 'Restore the missing parent run manifest or correct parentPromptCallId / parentRunId.';
  if (reason === 'diagnostic_overhead') return 'Classify as diagnostic overhead when intentional; otherwise attach parentPromptCallId.';
  if (reason === 'smoke_or_health') return 'Keep smoke/health outside business runtime optimization.';
  if (reason === 'standalone_operator_command') return 'Keep as standalone operator command or add parentPromptCallId if this was a child business Codex call.';
  return 'Inspect runtime events and add high-confidence parent attribution before optimizing this call.';
}

async function latestAuditReportPath(paths: ProjectPaths, fileStore: FileStore, baseName: string): Promise<string | undefined> {
  if (!(await fileStore.exists(paths.auditDir()))) return undefined;
  const fileName = (await fileStore.list(paths.auditDir()))
    .filter((entry) => new RegExp(`^${baseName}_v\\d+\\.json$`).test(entry))
    .sort((left, right) => versionOf(right) - versionOf(left))[0];
  return fileName === undefined ? undefined : path.join('audit', fileName);
}

async function readContinuityWarnings(paths: ProjectPaths, fileStore: FileStore): Promise<Record<number, number>> {
  if (!(await fileStore.exists(paths.auditDir()))) return {};
  const files = (await fileStore.list(paths.auditDir()))
    .filter((fileName) => /^codex_cross_chapter_continuity_report_v\d+\.json$/.test(fileName))
    .sort((left, right) => versionOf(right) - versionOf(left));
  if (files[0] === undefined) return {};
  try {
    const report = await fileStore.readJson(paths.auditArtifact(files[0]), CodexCrossChapterContinuityReportSchema);
    const result: Record<number, number> = {};
    for (const warning of report.warnings) {
      if (warning.chapterNumber === undefined) continue;
      result[warning.chapterNumber] = (result[warning.chapterNumber] ?? 0) + 1;
    }
    return result;
  } catch {
    return {};
  }
}

async function readQualityCriticalIssues(paths: ProjectPaths, fileStore: FileStore): Promise<Record<number, number>> {
  if (!(await fileStore.exists(paths.chaptersDir()))) return {};
  const result: Record<number, number> = {};
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    const match = /^chapter_(\d{3})$/.exec(chapterDirName);
    if (match === null) continue;
    const chapterNumber = Number.parseInt(match[1]!, 10);
    const chapterDir = path.join(paths.chaptersDir(), chapterDirName);
    for (const fileName of await fileStore.list(chapterDir)) {
      if (!/^codex_chapter_quality_report_v\d+\.json$/.test(fileName)) continue;
      try {
        const raw = JSON.parse(await fileStore.readText(path.join(chapterDir, fileName))) as { criticalIssues?: unknown[] };
        result[chapterNumber] = Math.max(result[chapterNumber] ?? 0, Array.isArray(raw.criticalIssues) ? raw.criticalIssues.length : 0);
      } catch {
        // audit validates malformed quality reports.
      }
    }
  }
  return result;
}

function durationFromBenchmark(report: CodexRuntimeBenchmarkReport | undefined, chapterNumber: number): number {
  if (report === undefined) return 0;
  const level = chapterNumber === 2 ? 'chapter2' : 'chapter3';
  return report.stages.filter((stage) => stage.level === level).reduce((sum, stage) => sum + stage.durationMs, 0);
}

function baselineDurationFor(chapterNumber: number): number {
  return BASELINE_CHAPTER_DURATIONS[chapterNumber] ?? 0;
}

function detectRerunOnConfirm(report: CodexRuntimeBenchmarkReport | undefined, calls: PromptCallDetail[]): boolean {
  const confirmHasCodex = report?.stages.some((stage) => stage.stageName.includes('confirm') && stage.codexCallCount > 0) ?? false;
  const confirmRuns = calls.filter((call) => call.command.includes('confirm') && !call.promptId.startsWith('codex.'));
  return confirmHasCodex || confirmRuns.length > 0;
}

function confirmStagesAvoidCodex(report: CodexRuntimeBenchmarkReport | undefined): boolean {
  const confirmStages = report?.stages.filter((stage) => stage.stageName.includes('confirm')) ?? [];
  return confirmStages.length > 0 && confirmStages.every((stage) => stage.codexCallCount === 0);
}

function hasLocalAssemble(paths: ProjectPaths, fileStore: FileStore): boolean {
  void paths;
  void fileStore;
  return true;
}

function uniqueProfileCalls(profile: CodexStageRuntimeProfileReport): CodexStageRuntimeProfileReport['slowestPromptCalls'] {
  return uniqueCalls([
    ...profile.slowestPromptCalls,
    ...profile.largestPromptInputs,
    ...profile.largestSchemas,
    ...profile.largestOutputs,
    ...profile.repairCalls,
    ...profile.retryCalls,
    ...profile.unclassifiedCalls
  ]);
}

function uniqueCalls<T extends { runId: string; promptCallId: string }>(calls: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const call of calls) {
    const key = `${call.runId}:${call.promptCallId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(call);
  }
  return result;
}

function ensureStageAggregate(stageAggregates: Map<string, StageAggregate>, stage: string): StageAggregate {
  const existing = stageAggregates.get(stage);
  if (existing !== undefined) return existing;
  const aggregate = emptyStageAggregate(stage);
  stageAggregates.set(stage, aggregate);
  return aggregate;
}

function emptyStageAggregate(stage: string): StageAggregate {
  return {
    stage,
    durationMs: 0,
    promptCallCount: 0,
    codexCallCount: 0,
    retryCount: 0,
    repairCount: 0,
    promptInputBytes: 0,
    contextBytes: 0,
    schemaBytes: 0,
    outputBytes: 0,
    rawJsonlBytes: 0,
    artifactPaths: new Set<string>(),
    failureCount: 0
  };
}

function normalizeStage(stage: string, promptId: string): string {
  if (stage === 'final_chapter' && promptId.includes('assemble')) return 'local_assemble';
  if (stage === 'other_codex') {
    const mapped = inferCodexPromptStage(promptId);
    if (mapped.stage !== 'other_codex') return normalizeStage(mapped.stage, promptId);
  }
  if (stage === 'planning') return 'chapter_mission';
  return STAGES.includes(stage) ? stage : stage.replace(/-/g, '_');
}

function isSafeToReuse(stage: string, promptId: string): boolean {
  if (stage === 'canon_patch_proposal' || stage === 'diagnostics' || promptId.includes('canon_patch')) return false;
  return ['chapter_mission', 'plan_candidates', 'ranking', 'scene_cards'].includes(stage);
}

function likelyByteReason(field: 'promptInputBytes' | 'schemaBytes' | 'outputBytes', stage: string): string {
  if (field === 'promptInputBytes') return `larger ${stage} prompt/context input than the comparison budget`;
  if (field === 'schemaBytes') return `larger ${stage} output schema payload`;
  return `larger ${stage} model output payload`;
}

function suggestedByteFix(field: 'promptInputBytes' | 'schemaBytes' | 'outputBytes', stage: string): string {
  if (field === 'promptInputBytes') return `Inspect ${stage} context manifest before reducing prompt content.`;
  if (field === 'schemaBytes') return `Consider a slim schema experiment for ${stage} while preserving validation.`;
  return `Inspect ${stage} output expectations and cap verbose fields only after quality checks.`;
}

function uniqueRootCauses(causes: CodexChapterRegressionAnalysis['suspectedRootCauses']): CodexChapterRegressionAnalysis['suspectedRootCauses'] {
  const seen = new Set<string>();
  return causes.filter((cause) => {
    if (seen.has(cause.rootCauseId)) return false;
    seen.add(cause.rootCauseId);
    return true;
  });
}

function isDiagnosticOverhead(promptId: string, command: string, wrapperCallType: string | undefined): boolean {
  const normalizedPrompt = promptId.toLowerCase().replace(/-/g, '_');
  const normalizedCommand = command.toLowerCase();
  return (
    wrapperCallType === 'health' ||
    wrapperCallType === 'smoke' ||
    normalizedPrompt.includes('health') ||
    normalizedPrompt.includes('smoke') ||
    normalizedPrompt.includes('exec_json') ||
    (wrapperCallType === 'exec_json' && (normalizedCommand.includes('exec-json') || normalizedCommand.includes('exec_json') || normalizedCommand.includes('smoke')))
  );
}

function isV2(manifest: RunManifest): manifest is RunManifestV2 {
  return 'schemaVersion' in manifest && manifest.schemaVersion === '2';
}

async function nextAuditArtifact(paths: ProjectPaths, fileStore: FileStore, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const jsonPath = paths.auditArtifact(jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      return {
        version,
        jsonPath,
        mdPath: paths.auditArtifact(`${baseName}_v${version}.md`),
        relativeJsonPath: path.join('audit', jsonFile),
        relativeMdPath: path.join('audit', `${baseName}_v${version}.md`)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName} artifact.`);
}

function renderMarkdown(report: CodexChapterRegressionAnalysis): string {
  return [
    `# Codex Chapter Regression Analysis ${report.projectId}`,
    '',
    `currentBenchmarkPath: ${report.currentBenchmarkPath}`,
    `confidence: ${report.confidence}`,
    `regressedChapters: ${report.regressions.map((chapter) => chapter.chapterNumber).join(',') || 'none'}`,
    '',
    '## Chapter Comparisons',
    ...report.currentChapters.map((chapter) => `- chapter ${chapter.chapterNumber}: ${chapter.currentDurationMs}ms (${chapter.deltaPercent}%)`),
    '',
    '## Duplicate Prompt Calls',
    ...(report.duplicatePromptCalls.length === 0 ? ['none'] : report.duplicatePromptCalls.map((duplicate) => `- chapter ${duplicate.chapterNumber} ${duplicate.promptId}: ${duplicate.runIds.join(', ')}`)),
    '',
    '## Suspected Root Causes',
    ...report.suspectedRootCauses.map((cause) => `- ${cause.rootCauseId}: ${cause.impactMs}ms ${cause.confidence}`),
    '',
    '## Recommended Fixes',
    ...report.recommendedFixes.map((fix) => `- ${fix.experimentId}: ${fix.change}`)
  ].join('\n') + '\n';
}

async function readOptionalText(filePath: string, fileStore: FileStore): Promise<string> {
  if (!(await fileStore.exists(filePath))) return '';
  return fileStore.readText(filePath);
}

function versionOf(fileName: string): number {
  return Number.parseInt(/_v(\d+)\.json$/.exec(fileName)?.[1] ?? '0', 10);
}

function percent(delta: number, baseline: number): number {
  if (baseline === 0) return delta === 0 ? 0 : 100;
  return Number(((delta / baseline) * 100).toFixed(2));
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}
