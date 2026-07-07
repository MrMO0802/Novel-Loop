import path from 'node:path';

import { inferCodexPromptStage } from '../providers/codex/promptStageMapping.js';
import { CodexRuntimeBenchmarkReportSchema, CodexStageRuntimeProfileReportSchema, RunManifestSchema } from '../schemas/index.js';
import type { CodexRuntimeBenchmarkReport, CodexStageRuntimeProfileReport, RunManifest, RunManifestV2 } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface ProfileCodexRuntimeInput {
  projectId: string;
  projectsRoot?: string;
}

export interface ProfileCodexRuntimeResult {
  report: CodexStageRuntimeProfileReport;
  reportPath: string;
  markdownPath: string;
}

interface PromptCallProfileDraft {
  promptCallId: string;
  runId: string;
  command: string;
  status: string;
  chapterNumber?: number;
  promptId: string;
  promptFamily: string;
  inferredStage: string;
  likelyCategory: string;
  classified: boolean;
  requestId?: string;
  parentPromptCallId?: string;
  parentPromptId?: string;
  parentStage?: string;
  parentRunId?: string;
  wrapperCallType?: WrapperCallType;
  attributionMode: AttributionMode;
  attributionConfidence: AttributionConfidence;
  attributionReason: string;
  durationMs: number;
  latencyMs: number;
  promptInputBytes: number;
  contextBytes: number;
  schemaBytes: number;
  outputBytes: number;
  rawJsonlBytes: number;
  retryCount: number;
  repairCount: number;
  jsonParsed: boolean;
  schemaValid: boolean;
  artifactPaths: string[];
  rawOutputPath?: string;
  finalOutputPath?: string;
  parsedOutputPath?: string;
  errorType?: string;
  suggestedOptimization: string;
}

type WrapperCallType = 'exec_text' | 'exec_json' | 'health' | 'smoke' | 'repair' | 'unknown';
type AttributionMode = 'direct' | 'parent_child' | 'inferred' | 'unclassified';
type AttributionConfidence = 'high' | 'medium' | 'low';

interface BusinessPromptCallDraft {
  businessPromptCallId: string;
  promptId: string;
  stage: string;
  chapterNumber?: number;
  runId: string;
  netDurationMs: number;
  wrapperDurationMs: number;
  providerLatencyMs: number;
  promptInputBytes: number;
  contextBytes: number;
  schemaBytes: number;
  outputBytes: number;
  retryCount: number;
  repairCount: number;
  childWrapperCallIds: string[];
  suggestedOptimization: string;
}

interface RunProfileDraft {
  runId: string;
  command: string;
  status: string;
  chapterNumber?: number;
  durationMs: number;
  codexCallCount: number;
  slowestPromptCallId?: string;
  slowestPromptDurationMs: number;
  artifactCount: number;
  stateMutationApplied: boolean;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const M27_STAGES = [
  'build_bible',
  'plan_global_outline',
  'plan_volume_outline',
  'plan_arc_map',
  'plan_chapter_queue',
  'chapter_mission',
  'plan_candidates',
  'ranking',
  'scene_cards',
  'write_scene',
  'diagnostics',
  'revision_plan',
  'final_chapter',
  'canon_patch_proposal',
  'state_diff',
  'confirm_apply',
  'health_check',
  'smoke',
  'exec_json_smoke',
  'json_repair',
  'normalization',
  'provider_inspect',
  'other_codex'
];

export async function profileCodexRuntime(input: ProfileCodexRuntimeInput, fileStore = new FileStore()): Promise<ProfileCodexRuntimeResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const durationByStage = emptyStageMap();
  const codexCallsByStage = emptyStageMap();
  const retriesByStage = emptyStageMap();
  const repairsByStage = emptyStageMap();
  const timeoutByStage = emptyStageMap();
  const promptBytesByStage = emptyStageMap();
  const outputBytesByStage = emptyStageMap();
  const schemaBytesByStage = emptyStageMap();
  const durationByChapter: Record<string, number> = {};
  const durationByCommand: Record<string, number> = {};
  const durationByPromptId: Record<string, number> = {};
  const durationByPromptFamily: Record<string, number> = {};
  const durationByChapterStage: Record<string, number> = {};
  const promptCallsByPromptId: Record<string, number> = {};
  const promptCallsByStage: Record<string, number> = {};
  const promptCallsByRun: Record<string, number> = {};
  const promptCallsByChapter: Record<string, number> = {};
  const callProfiles: PromptCallProfileDraft[] = [];
  const runProfiles = new Map<string, RunProfileDraft>();
  let sourceRunCount = 0;
  let totalDurationMs = 0;

  for (const manifest of await readRunManifests(paths, fileStore)) {
    sourceRunCount += 1;
    if (!isV2RunManifest(manifest)) continue;
    const runProfile = createRunProfile(manifest);
    runProfiles.set(manifest.runId, runProfile);
    const promptStagesInManifest = new Set<string>();
    for (const [index, call] of manifest.promptCalls.entries()) {
      if (call.provider !== 'codex-text' && call.provider !== 'codex-cli') continue;
      const callProfile = toPromptCallProfile(manifest, call, index);
      callProfiles.push(callProfile);
      promptStagesInManifest.add(callProfile.inferredStage);
      runProfile.durationMs += callProfile.durationMs;
      runProfile.codexCallCount += 1;
      if (callProfile.durationMs > runProfile.slowestPromptDurationMs) {
        runProfile.slowestPromptDurationMs = callProfile.durationMs;
        runProfile.slowestPromptCallId = callProfile.promptCallId;
      }
      totalDurationMs += callProfile.durationMs;
    }
    for (const stageRecord of manifest.stages) {
      const stage = stageForRunStage(stageRecord.stage, stageRecord.name);
      const durationMs = durationForRunStage(stageRecord);
      if (stage === undefined || durationMs === undefined || promptStagesInManifest.has(stage)) continue;
      increment(durationByStage, stage, durationMs);
      increment(durationByCommand, manifest.command, durationMs);
      totalDurationMs += durationMs;
      runProfile.durationMs += durationMs;
      const stageChapter = stageRecord.chapterNumber ?? chapterNumberForManifest(manifest);
      if (stageChapter !== undefined) {
        increment(durationByChapter, chapterKey(stageChapter), durationMs);
        increment(durationByChapterStage, `${chapterKey(stageChapter)}.${stage}`, durationMs);
      }
    }
  }

  applyWrapperAttribution(callProfiles);
  for (const callProfile of callProfiles) {
    addToStageAggregates(callProfile, {
      durationByStage,
      codexCallsByStage,
      retriesByStage,
      repairsByStage,
      timeoutByStage,
      promptBytesByStage,
      outputBytesByStage,
      schemaBytesByStage
    });
    increment(promptCallsByPromptId, callProfile.promptId, 1);
    increment(promptCallsByStage, callProfile.inferredStage, 1);
    increment(promptCallsByRun, callProfile.runId, 1);
    if (callProfile.chapterNumber !== undefined) {
      increment(promptCallsByChapter, chapterKey(callProfile.chapterNumber), 1);
      increment(durationByChapter, chapterKey(callProfile.chapterNumber), callProfile.durationMs);
      increment(durationByChapterStage, `${chapterKey(callProfile.chapterNumber)}.${callProfile.inferredStage}`, callProfile.durationMs);
    }
    increment(durationByCommand, callProfile.command, callProfile.durationMs);
    increment(durationByPromptId, callProfile.promptId, callProfile.durationMs);
    increment(durationByPromptFamily, callProfile.promptFamily, callProfile.durationMs);
  }

  const sourceBenchmarkReportPaths: string[] = [];
  for (const benchmark of await readBenchmarkReports(paths, fileStore)) {
    sourceBenchmarkReportPaths.push(benchmark.relativePath);
    if (totalDurationMs === 0) {
      totalDurationMs += benchmark.report.totalDurationMs;
    }
    for (const stage of benchmark.report.stages) {
      const mappedStage = stageForBenchmarkStage(stage.stageName);
      if ((codexCallsByStage[mappedStage] ?? 0) === 0) {
        increment(durationByStage, mappedStage, stage.durationMs);
        increment(codexCallsByStage, mappedStage, stage.codexCallCount);
        increment(retriesByStage, mappedStage, stage.retryCount);
        increment(repairsByStage, mappedStage, stage.repairCount);
        increment(timeoutByStage, mappedStage, stage.timeoutCount);
        increment(promptBytesByStage, mappedStage, stage.promptInputBytes);
        increment(outputBytesByStage, mappedStage, stage.outputBytes);
        increment(schemaBytesByStage, mappedStage, stage.schemaBytes);
      }
      const stageChapter = chapterNumberForStageName(stage.stageName);
      if (stageChapter !== undefined) {
        increment(durationByChapter, chapterKey(stageChapter), stage.durationMs);
        increment(durationByChapterStage, `${chapterKey(stageChapter)}.${mappedStage}`, stage.durationMs);
      }
    }
  }

  const slowestStages = Object.entries(durationByStage)
    .map(([stage, durationMs]) => ({ stage, durationMs, codexCallCount: codexCallsByStage[stage] ?? 0 }))
    .filter((stage) => stage.durationMs > 0 || stage.codexCallCount > 0)
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 8);
  const slowestPromptCalls = sortCalls(callProfiles, 'durationMs').slice(0, 10);
  const largestPromptInputs = sortCalls(callProfiles, 'promptInputBytes').slice(0, 10);
  const largestSchemas = sortCalls(callProfiles, 'schemaBytes').filter((call) => call.schemaBytes > 0).slice(0, 10);
  const largestOutputs = sortCalls(callProfiles, 'outputBytes').slice(0, 10);
  const repairCalls = callProfiles.filter((call) => call.repairCount > 0).sort((left, right) => right.durationMs - left.durationMs);
  const retryCalls = callProfiles.filter((call) => call.retryCount > 0).sort((left, right) => right.retryCount - left.retryCount || right.durationMs - left.durationMs);
  const unclassifiedCalls = callProfiles.filter((call) => !call.classified).sort((left, right) => right.durationMs - left.durationMs);
  const wrapperCalls = callProfiles.filter(isWrapperCall);
  const businessPromptCalls = buildBusinessPromptCalls(callProfiles, wrapperCalls);
  const otherCodexBreakdown = buildOtherCodexBreakdown(callProfiles);
  const wrapperBreakdown = buildWrapperBreakdown(wrapperCalls);
  const rawRuntimeView = {
    totalPromptCallCount: callProfiles.length,
    totalDurationMs: callProfiles.reduce((sum, call) => sum + call.durationMs, 0),
    byStage: Object.fromEntries(Object.entries(durationByStage).filter(([stage]) => M27_STAGES.includes(stage))),
    includesWrapperCalls: true as const
  };
  const businessRuntimeView = {
    totalBusinessCallCount: businessPromptCalls.length,
    totalDurationMs: businessPromptCalls.reduce((sum, call) => sum + call.netDurationMs, 0),
    byBusinessStage: metricDurationRecord(businessPromptCalls, (call) => call.stage, (call) => call.netDurationMs),
    byPromptId: metricDurationRecord(businessPromptCalls, (call) => call.promptId, (call) => call.netDurationMs),
    wrapperCallsRolledUp: true as const,
    doubleCountingRemoved: true as const
  };
  const overheadRuntimeView = {
    wrapperCallCount: wrapperCalls.length,
    wrapperDurationMs: wrapperCalls.reduce((sum, call) => sum + call.durationMs, 0),
    healthSmokeDurationMs: wrapperCalls
      .filter((call) => call.wrapperCallType === 'health' || call.wrapperCallType === 'smoke')
      .reduce((sum, call) => sum + call.durationMs, 0),
    jsonRepairDurationMs: callProfiles
      .filter((call) => call.inferredStage === 'json_repair' || call.wrapperCallType === 'repair')
      .reduce((sum, call) => sum + call.durationMs, 0),
    redactionDurationMs: 0,
    artifactWriteDurationMs: 0,
    unclassifiedOverheadMs: wrapperCalls
      .filter((call) => call.attributionMode === 'unclassified')
      .reduce((sum, call) => sum + call.durationMs, 0)
  };
  const slowestBusinessPromptCalls = [...businessPromptCalls].sort((left, right) => right.netDurationMs - left.netDurationMs).slice(0, 10);
  const slowestRuns = [...runProfiles.values()]
    .filter((run) => run.durationMs > 0 || run.codexCallCount > 0)
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 10)
    .map(({ slowestPromptDurationMs, ...run }) => {
      void slowestPromptDurationMs;
      return run;
    });
  const optimizationCandidates = buildOptimizationCandidates(
    slowestBusinessPromptCalls.map((call) => businessToPromptCallProfile(call, callProfiles)),
    unclassifiedCalls
  );
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_stage_runtime_profile');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_stage_runtime_profile_v${artifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      sourceRunCount,
      sourceBenchmarkReportPaths,
      totalDurationMs,
      durationByChapter,
      durationByStage,
      codexCallsByStage,
      retriesByStage,
      repairsByStage,
      timeoutByStage,
      promptBytesByStage,
      outputBytesByStage,
      schemaBytesByStage,
      profiledPromptCallCount: callProfiles.length,
      slowestPromptCalls,
      promptCallsByPromptId,
      promptCallsByStage,
      promptCallsByRun,
      promptCallsByChapter,
      largestPromptInputs,
      largestSchemas,
      largestOutputs,
      repairCalls,
      retryCalls,
      unclassifiedCalls,
      remainingUnclassifiedCount: unclassifiedCalls.length,
      otherCodexBreakdown,
      rawRuntimeView,
      businessRuntimeView,
      overheadRuntimeView,
      wrapperBreakdown,
      slowestBusinessPromptCalls,
      slowestRuns,
      durationByCommand,
      durationByPromptId,
      durationByPromptFamily,
      durationByChapterStage,
      slowestStages,
      optimizationCandidates,
      storyStateMutated: false
    },
    CodexStageRuntimeProfileReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderProfileMarkdown(report));
  return {
    report,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath
  };
}

async function readRunManifests(paths: ProjectPaths, fileStore: FileStore): Promise<RunManifest[]> {
  if (!(await fileStore.exists(paths.runsDir()))) return [];
  const manifests: RunManifest[] = [];
  for (const entry of await fileStore.list(paths.runsDir())) {
    const manifestPath = paths.runManifest(entry);
    if (!(await fileStore.exists(manifestPath))) continue;
    try {
      manifests.push(await fileStore.readJson(manifestPath, RunManifestSchema));
    } catch {
      // Profiler is read-only and best-effort; audit handles invalid manifests strictly.
    }
  }
  return manifests;
}

async function readBenchmarkReports(
  paths: ProjectPaths,
  fileStore: FileStore
): Promise<Array<{ relativePath: string; report: CodexRuntimeBenchmarkReport }>> {
  if (!(await fileStore.exists(paths.auditDir()))) return [];
  const reports: Array<{ relativePath: string; report: CodexRuntimeBenchmarkReport }> = [];
  for (const entry of await fileStore.list(paths.auditDir())) {
    if (!/^codex_runtime_benchmark_report_v\d+\.json$/.test(entry)) continue;
    const relativePath = path.join('audit', entry);
    try {
      reports.push({
        relativePath,
        report: await fileStore.readJson(paths.projectArtifact(relativePath), CodexRuntimeBenchmarkReportSchema)
      });
    } catch {
      // audit --strict reports invalid benchmark artifacts.
    }
  }
  return reports;
}

function isV2RunManifest(manifest: RunManifest): manifest is RunManifestV2 {
  return 'schemaVersion' in manifest && manifest.schemaVersion === '2';
}

function emptyStageMap(): Record<string, number> {
  return Object.fromEntries(M27_STAGES.map((stage) => [stage, 0]));
}

function toPromptCallProfile(manifest: RunManifestV2, call: RunManifestV2['promptCalls'][number], index: number): PromptCallProfileDraft {
  const mapping = inferCodexPromptStage(call.promptId);
  const durationMs = Math.round(call.latencyMs);
  const wrapperCallType = call.wrapperCallType ?? detectWrapperCallType(call.promptId);
  const wrapper = wrapperCallType !== undefined;
  const boundarySmoke = wrapper && isBoundarySmokeWrapper(manifest, call, wrapperCallType);
  const repairCount = call.finishReason === 'repaired' || mapping.stage === 'json_repair' || wrapperCallType === 'repair' ? 1 : 0;
  const artifactPaths = uniqueStrings([
    call.rawOutputPath,
    call.finalOutputPath,
    call.parsedOutputPath,
    call.inputArtifactPath,
    call.outputArtifactPath
  ]);
  const base = {
    promptCallId: call.promptCallId ?? `prompt_${String(index + 1).padStart(3, '0')}_${sanitizeId(call.promptId)}`,
    runId: manifest.runId,
    command: manifest.command,
    status: call.status ?? 'succeeded',
    promptId: call.promptId,
    promptFamily: mapping.promptFamily,
    inferredStage: mapping.stage,
    likelyCategory: mapping.likelyCategory,
    classified: wrapper ? boundarySmoke : mapping.classified,
    ...(call.requestId === undefined ? {} : { requestId: call.requestId }),
    ...(call.parentPromptCallId === undefined ? {} : { parentPromptCallId: call.parentPromptCallId }),
    ...(call.parentPromptId === undefined ? {} : { parentPromptId: call.parentPromptId }),
    ...(call.parentStage === undefined ? {} : { parentStage: call.parentStage }),
    ...(call.parentRunId === undefined ? {} : { parentRunId: call.parentRunId }),
    ...(wrapperCallType === undefined ? {} : { wrapperCallType }),
    attributionMode: call.attributionMode ?? (wrapper ? (boundarySmoke ? 'direct' : 'unclassified') : 'direct'),
    attributionConfidence: call.attributionConfidence ?? (boundarySmoke || !wrapper ? 'high' : 'low'),
    attributionReason: call.attributionReason ?? (wrapper ? (boundarySmoke ? `${wrapperCallType} wrapper is standalone boundary smoke` : 'wrapper call awaits parent attribution') : 'direct business call'),
    durationMs,
    latencyMs: call.latencyMs,
    promptInputBytes: call.promptInputBytes ?? 0,
    contextBytes: call.contextBytes ?? 0,
    schemaBytes: call.schemaBytes ?? 0,
    outputBytes: call.outputBytes ?? 0,
    rawJsonlBytes: call.rawJsonlBytes ?? 0,
    retryCount: call.retryCount ?? 0,
    repairCount,
    jsonParsed: call.jsonParsed ?? false,
    schemaValid: call.schemaValid ?? false,
    artifactPaths,
    suggestedOptimization: suggestedOptimizationForCall(mapping.stage, call.promptId, {
      promptInputBytes: call.promptInputBytes ?? 0,
      schemaBytes: call.schemaBytes ?? 0,
      retryCount: call.retryCount ?? 0,
      repairCount
    })
  };
  const chapterNumber = chapterNumberForManifest(manifest);
  return {
    ...base,
    ...(chapterNumber === undefined ? {} : { chapterNumber }),
    ...(call.rawOutputPath === undefined ? {} : { rawOutputPath: call.rawOutputPath }),
    ...(call.finalOutputPath === undefined ? {} : { finalOutputPath: call.finalOutputPath }),
    ...(call.parsedOutputPath === undefined ? {} : { parsedOutputPath: call.parsedOutputPath }),
    ...(call.errorType === undefined ? {} : { errorType: call.errorType })
  };
}

function detectWrapperCallType(promptId: string): WrapperCallType | undefined {
  const normalized = promptId.toLowerCase().replace(/-/g, '_');
  if (normalized === 'codex.exec_text') return 'exec_text';
  if (normalized === 'codex.exec_json') return 'exec_json';
  if (normalized === 'provider.health' || normalized.includes('health')) return 'health';
  if (normalized.includes('smoke')) return 'smoke';
  return undefined;
}

function isBoundarySmokeWrapper(manifest: RunManifestV2, call: RunManifestV2['promptCalls'][number], wrapperCallType: WrapperCallType): boolean {
  if (wrapperCallType === 'health' || wrapperCallType === 'smoke') return true;
  if (wrapperCallType !== 'exec_json') return false;
  const command = manifest.command.toLowerCase();
  const promptId = call.promptId.toLowerCase().replace(/-/g, '_');
  return promptId === 'codex.exec_json' && (command.includes('exec-json') || command.includes('exec_json') || command.includes('output-schema'));
}

function isWrapperCall(call: PromptCallProfileDraft): boolean {
  return call.wrapperCallType !== undefined;
}

function applyWrapperAttribution(callProfiles: PromptCallProfileDraft[]): void {
  const businessCalls = callProfiles.filter((call) => !isWrapperCall(call));
  const byCallId = new Map<string, PromptCallProfileDraft>();
  const byRequestId = new Map<string, PromptCallProfileDraft>();
  for (const call of businessCalls) {
    byCallId.set(call.promptCallId, call);
    byCallId.set(`${call.runId}:${call.promptCallId}`, call);
    if (call.requestId !== undefined) {
      byRequestId.set(call.requestId, call);
    }
  }
  for (const call of callProfiles.filter(isWrapperCall)) {
    if (call.classified && call.attributionMode === 'direct') {
      call.classified = true;
      call.attributionMode = 'direct';
      call.attributionConfidence = 'high';
      call.attributionReason = call.attributionReason || `${call.wrapperCallType} wrapper is tracked as boundary overhead`;
      continue;
    }
    const explicitParent = findExplicitParent(call, byCallId);
    if (explicitParent !== undefined) {
      attachParent(call, explicitParent, 'parent_child', 'high', 'child wrapper declared parentPromptCallId');
      continue;
    }
    if (call.parentPromptCallId !== undefined) {
      call.classified = false;
      call.attributionMode = 'unclassified';
      call.attributionConfidence = 'low';
      call.attributionReason = `declared parentPromptCallId ${call.parentPromptCallId} was not found`;
      continue;
    }
    const inferredParent = byRequestId.get(call.runId);
    if (inferredParent !== undefined) {
      attachParent(call, inferredParent, 'inferred', 'high', 'legacy inference matched wrapper runId to parent requestId');
      continue;
    }
    call.classified = false;
    call.attributionMode = 'unclassified';
    call.attributionConfidence = 'low';
    call.attributionReason = 'wrapper call has no declared parent and no requestId inference match';
  }
}

function findExplicitParent(call: PromptCallProfileDraft, byCallId: Map<string, PromptCallProfileDraft>): PromptCallProfileDraft | undefined {
  if (call.parentPromptCallId === undefined) return undefined;
  return byCallId.get(`${call.parentRunId ?? ''}:${call.parentPromptCallId}`) ?? byCallId.get(call.parentPromptCallId);
}

function attachParent(
  wrapper: PromptCallProfileDraft,
  parent: PromptCallProfileDraft,
  attributionMode: AttributionMode,
  attributionConfidence: AttributionConfidence,
  attributionReason: string
): void {
  wrapper.parentPromptCallId = parent.promptCallId;
  wrapper.parentPromptId = parent.promptId;
  wrapper.parentStage = parent.inferredStage;
  wrapper.parentRunId = parent.runId;
  wrapper.inferredStage = parent.inferredStage;
  wrapper.likelyCategory = parent.likelyCategory;
  wrapper.classified = true;
  wrapper.attributionMode = attributionMode;
  wrapper.attributionConfidence = attributionConfidence;
  wrapper.attributionReason = attributionReason;
}

function createRunProfile(manifest: RunManifestV2): RunProfileDraft {
  const chapterNumber = chapterNumberForManifest(manifest);
  return {
    runId: manifest.runId,
    command: manifest.command,
    status: manifest.status,
    ...(chapterNumber === undefined ? {} : { chapterNumber }),
    durationMs: 0,
    codexCallCount: 0,
    slowestPromptDurationMs: 0,
    artifactCount: manifest.artifacts.length,
    stateMutationApplied: manifest.stateMutations.some((mutation) => mutation.applied)
  };
}

function addToStageAggregates(
  call: PromptCallProfileDraft,
  maps: {
    durationByStage: Record<string, number>;
    codexCallsByStage: Record<string, number>;
    retriesByStage: Record<string, number>;
    repairsByStage: Record<string, number>;
    timeoutByStage: Record<string, number>;
    promptBytesByStage: Record<string, number>;
    outputBytesByStage: Record<string, number>;
    schemaBytesByStage: Record<string, number>;
  }
): void {
  increment(maps.durationByStage, call.inferredStage, call.durationMs);
  increment(maps.codexCallsByStage, call.inferredStage, 1);
  increment(maps.retriesByStage, call.inferredStage, call.retryCount);
  increment(maps.repairsByStage, call.inferredStage, call.repairCount);
  increment(maps.timeoutByStage, call.inferredStage, call.errorType === 'CODEX_TIMEOUT' ? 1 : 0);
  increment(maps.promptBytesByStage, call.inferredStage, call.promptInputBytes);
  increment(maps.outputBytesByStage, call.inferredStage, call.outputBytes);
  increment(maps.schemaBytesByStage, call.inferredStage, call.schemaBytes);
}

function stageForBenchmarkStage(stageName: string): string {
  if (stageName === 'codex-status') return 'health_check';
  if (stageName === 'codex-smoke') return 'smoke';
  if (stageName === 'codex-exec-json') return 'exec_json_smoke';
  if (stageName === 'build-bible') return 'build_bible';
  if (stageName === 'plan-global') return 'plan_global_outline';
  if (stageName.includes('dry-run')) return 'chapter_mission';
  if (stageName.includes('draft')) return 'write_scene';
  if (stageName.includes('preview')) return 'canon_patch_proposal';
  if (stageName.includes('confirm')) return 'confirm_apply';
  return 'other_codex';
}

function stageForRunStage(stage: string, name: string): string | undefined {
  const normalized = `${stage} ${name}`.toLowerCase().replace(/-/g, '_');
  for (const m27Stage of M27_STAGES) {
    if (normalized.includes(m27Stage)) return m27Stage;
  }
  if (normalized.includes('diff')) return 'state_diff';
  if (normalized.includes('confirm') || normalized.includes('apply')) return 'confirm_apply';
  return undefined;
}

function durationForRunStage(stage: { durationMs?: number | undefined; startedAt?: string | undefined; endedAt?: string | undefined }): number | undefined {
  if (stage.durationMs !== undefined) return Math.round(stage.durationMs);
  if (stage.startedAt === undefined || stage.endedAt === undefined) return undefined;
  const started = Date.parse(stage.startedAt);
  const ended = Date.parse(stage.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return undefined;
  return ended - started;
}

function chapterNumberForManifest(manifest: RunManifestV2): number | undefined {
  return manifest.resolvedContext.chapterNumber ?? manifest.resolvedContext.resolvedChapterNumber;
}

function chapterNumberForStageName(stageName: string): number | undefined {
  const match = /chapter-(\d{3})/.exec(stageName);
  if (match === null) return undefined;
  return Number.parseInt(match[1]!, 10);
}

function chapterKey(chapterNumber: number): string {
  return `chapter_${String(chapterNumber).padStart(3, '0')}`;
}

function buildOtherCodexBreakdown(callProfiles: PromptCallProfileDraft[]) {
  const otherCalls = callProfiles.filter((call) => call.inferredStage === 'other_codex' || !call.classified);
  return {
    totalCalls: otherCalls.length,
    totalDurationMs: otherCalls.reduce((sum, call) => sum + call.durationMs, 0),
    byPromptId: metricItems(otherCalls, (call) => call.promptId),
    byRunId: metricItems(otherCalls, (call) => call.runId),
    byCommand: metricItems(otherCalls, (call) => call.command),
    byArtifactType: metricItems(flattenOtherArtifactTypes(otherCalls), (item) => item.artifactType, (item) => item.durationMs),
    likelyCategories: metricItems(otherCalls, (call) => call.likelyCategory).map((item) => ({
      category: item.key,
      totalCalls: item.totalCalls,
      totalDurationMs: item.totalDurationMs
    })),
    reasonCategories: metricItems(otherCalls, otherCodexReasonCategory).map((item) => ({
      category: item.key,
      totalCalls: item.totalCalls,
      totalDurationMs: item.totalDurationMs
    }))
  };
}

function otherCodexReasonCategory(call: PromptCallProfileDraft):
  | 'true_unknown'
  | 'wrapper_orphan'
  | 'legacy_missing_parent'
  | 'health_or_smoke'
  | 'unsupported_old_manifest' {
  if (call.wrapperCallType === 'health' || call.wrapperCallType === 'smoke') return 'health_or_smoke';
  if (isWrapperCall(call) && call.parentPromptCallId !== undefined) return 'legacy_missing_parent';
  if (isWrapperCall(call)) return 'wrapper_orphan';
  return 'true_unknown';
}

function buildBusinessPromptCalls(callProfiles: PromptCallProfileDraft[], wrapperCalls: PromptCallProfileDraft[]): BusinessPromptCallDraft[] {
  const wrappersByParent = new Map<string, PromptCallProfileDraft[]>();
  for (const wrapper of wrapperCalls) {
    if (wrapper.parentPromptCallId === undefined) continue;
    const key = `${wrapper.parentRunId ?? ''}:${wrapper.parentPromptCallId}`;
    const existing = wrappersByParent.get(key) ?? [];
    existing.push(wrapper);
    wrappersByParent.set(key, existing);
  }
  return callProfiles
    .filter((call) => !isWrapperCall(call))
    .map((call) => {
      const wrappers = wrappersByParent.get(`${call.runId}:${call.promptCallId}`) ?? [];
      return {
        businessPromptCallId: call.promptCallId,
        promptId: call.promptId,
        stage: call.inferredStage,
        ...(call.chapterNumber === undefined ? {} : { chapterNumber: call.chapterNumber }),
        runId: call.runId,
        netDurationMs: call.durationMs,
        wrapperDurationMs: wrappers.reduce((sum, wrapper) => sum + wrapper.durationMs, 0),
        providerLatencyMs: call.latencyMs,
        promptInputBytes: call.promptInputBytes,
        contextBytes: call.contextBytes,
        schemaBytes: call.schemaBytes,
        outputBytes: call.outputBytes,
        retryCount: call.retryCount,
        repairCount: call.repairCount,
        childWrapperCallIds: wrappers.map((wrapper) => wrapper.promptCallId),
        suggestedOptimization: call.suggestedOptimization
      };
    });
}

function buildWrapperBreakdown(wrapperCalls: PromptCallProfileDraft[]) {
  const orphanWrapperCalls = wrapperCalls.filter((call) => call.attributionMode === 'unclassified');
  const inferredWrapperCalls = wrapperCalls.filter((call) => call.attributionMode === 'inferred');
  const attributedWrappers = wrapperCalls.filter((call) => call.parentPromptCallId !== undefined && call.attributionMode !== 'unclassified');
  return {
    totalWrapperCalls: wrapperCalls.length,
    totalWrapperDurationMs: wrapperCalls.reduce((sum, call) => sum + call.durationMs, 0),
    orphanWrapperCallCount: orphanWrapperCalls.length,
    byWrapperType: metricItems(wrapperCalls, (call) => call.wrapperCallType ?? 'unknown'),
    byParentStage: metricItems(attributedWrappers, (call) => call.parentStage ?? 'unknown'),
    byParentPromptId: metricItems(attributedWrappers, (call) => call.parentPromptId ?? 'unknown'),
    orphanWrapperCalls: orphanWrapperCalls.map(toWrapperCallProfile),
    inferredWrapperCalls: inferredWrapperCalls.map(toWrapperCallProfile)
  };
}

function toWrapperCallProfile(call: PromptCallProfileDraft) {
  return {
    promptCallId: call.promptCallId,
    wrapperCallType: call.wrapperCallType ?? 'unknown',
    runId: call.runId,
    durationMs: call.durationMs,
    ...(call.parentPromptCallId === undefined ? {} : { parentPromptCallId: call.parentPromptCallId }),
    ...(call.parentPromptId === undefined ? {} : { parentPromptId: call.parentPromptId }),
    ...(call.parentStage === undefined ? {} : { parentStage: call.parentStage }),
    ...(call.parentRunId === undefined ? {} : { parentRunId: call.parentRunId }),
    attributionMode: call.attributionMode,
    attributionConfidence: call.attributionConfidence,
    attributionReason: call.attributionReason,
    ...(call.rawOutputPath === undefined ? {} : { rawOutputPath: call.rawOutputPath }),
    ...(call.finalOutputPath === undefined ? {} : { finalOutputPath: call.finalOutputPath }),
    ...(call.parsedOutputPath === undefined ? {} : { parsedOutputPath: call.parsedOutputPath })
  };
}

function metricDurationRecord<T>(items: T[], keyFor: (item: T) => string, durationFor: (item: T) => number): Record<string, number> {
  const record: Record<string, number> = {};
  for (const item of items) {
    increment(record, keyFor(item), durationFor(item));
  }
  return record;
}

function businessToPromptCallProfile(businessCall: BusinessPromptCallDraft, callProfiles: PromptCallProfileDraft[]): PromptCallProfileDraft {
  return callProfiles.find((call) => call.runId === businessCall.runId && call.promptCallId === businessCall.businessPromptCallId) ?? {
    promptCallId: businessCall.businessPromptCallId,
    runId: businessCall.runId,
    command: 'unknown',
    status: 'succeeded',
    promptId: businessCall.promptId,
    promptFamily: businessCall.promptId.split('.')[0] ?? 'unknown',
    inferredStage: businessCall.stage,
    likelyCategory: 'unknown',
    classified: true,
    attributionMode: 'direct',
    attributionConfidence: 'high',
    attributionReason: 'business runtime view',
    durationMs: businessCall.netDurationMs,
    latencyMs: businessCall.providerLatencyMs,
    promptInputBytes: businessCall.promptInputBytes,
    contextBytes: businessCall.contextBytes,
    schemaBytes: businessCall.schemaBytes,
    outputBytes: businessCall.outputBytes,
    rawJsonlBytes: 0,
    retryCount: businessCall.retryCount,
    repairCount: businessCall.repairCount,
    jsonParsed: false,
    schemaValid: false,
    artifactPaths: [],
    suggestedOptimization: businessCall.suggestedOptimization
  };
}

function flattenOtherArtifactTypes(calls: PromptCallProfileDraft[]): Array<{ artifactType: string; durationMs: number }> {
  const items: Array<{ artifactType: string; durationMs: number }> = [];
  for (const call of calls) {
    for (const artifactType of new Set(call.artifactPaths.map(artifactTypeForPath))) {
      items.push({ artifactType, durationMs: call.durationMs });
    }
  }
  return items;
}

function buildOptimizationCandidates(slowestPromptCalls: PromptCallProfileDraft[], unclassifiedCalls: PromptCallProfileDraft[]) {
  const candidates = [...slowestPromptCalls.slice(0, 8)];
  for (const call of unclassifiedCalls) {
    if (!candidates.some((candidate) => candidate.promptCallId === call.promptCallId)) {
      candidates.push(call);
    }
  }
  return candidates.slice(0, 12).map((call, index) => {
    const suggestedAction = suggestedActionForCall(call);
    return {
      candidateId: `candidate_${String(index + 1).padStart(3, '0')}_${sanitizeId(call.promptId)}`,
      stage: call.inferredStage,
      promptId: call.promptId,
      reason: candidateReason(call),
      evidence: candidateEvidence(call),
      estimatedImpact: call.durationMs >= 120_000 || call.promptInputBytes > 24_000 || call.retryCount > 0 || call.repairCount > 0 ? 'high' as const : call.durationMs > 30_000 ? 'medium' as const : 'low' as const,
      suggestedAction,
      riskLevel: riskLevelForAction(suggestedAction),
      safetyImpact: 'no_state_mutation' as const
    };
  });
}

function suggestedActionForCall(call: PromptCallProfileDraft):
  | 'reduce_context'
  | 'slim_schema'
  | 'split_task'
  | 'merge_task'
  | 'localize_task'
  | 'cache_summary'
  | 'reuse_artifact'
  | 'improve_mapping'
  | 'inspect_prompt'
  | 'no_action_safety_critical' {
  if (!call.classified || call.inferredStage === 'other_codex') return 'improve_mapping';
  if (call.repairCount > 0 || call.retryCount > 0 || call.schemaBytes > 12_000) return 'slim_schema';
  if (call.promptInputBytes > 24_000) return 'reduce_context';
  if (call.inferredStage === 'diagnostics' || call.inferredStage === 'ranking') return 'localize_task';
  if (call.inferredStage === 'canon_patch_proposal') return 'slim_schema';
  if (call.inferredStage === 'write_scene') return 'reduce_context';
  if (call.inferredStage === 'build_bible') return 'inspect_prompt';
  return 'cache_summary';
}

function suggestedOptimizationForCall(stage: string, promptId: string, metrics: { promptInputBytes: number; schemaBytes: number; retryCount: number; repairCount: number }): string {
  if (stage === 'other_codex') return `Improve prompt stage mapping for ${promptId}.`;
  if (metrics.retryCount > 0 || metrics.repairCount > 0) return 'Slim schema or harden prompt JSON instructions.';
  if (metrics.schemaBytes > 12_000) return 'Slim output schema for this prompt.';
  if (metrics.promptInputBytes > 24_000) return 'Reduce context or use cached summaries.';
  return 'Inspect prompt only if this call appears in slowest rankings.';
}

function candidateReason(call: PromptCallProfileDraft): string {
  if (!call.classified || call.inferredStage === 'other_codex') return `${call.promptId} is not mapped to a specific stage.`;
  if (call.promptInputBytes > 24_000) return `${call.promptId} sends large prompt context (${call.promptInputBytes} bytes).`;
  if (call.retryCount > 0 || call.repairCount > 0) return `${call.promptId} required retry or repair.`;
  return `${call.promptId} is among the slowest observed prompt calls.`;
}

function candidateEvidence(call: PromptCallProfileDraft): string[] {
  return [
    `durationMs=${call.durationMs}`,
    `promptInputBytes=${call.promptInputBytes}`,
    `schemaBytes=${call.schemaBytes}`,
    `outputBytes=${call.outputBytes}`,
    `retryCount=${call.retryCount}`,
    `repairCount=${call.repairCount}`,
    `runId=${call.runId}`
  ];
}

function riskLevelForAction(action: ReturnType<typeof suggestedActionForCall>): 'low' | 'medium' | 'high' {
  if (action === 'no_action_safety_critical') return 'high';
  if (action === 'merge_task' || action === 'split_task') return 'medium';
  return 'low';
}

function metricItems<T>(
  items: T[],
  keyFor: (item: T) => string,
  durationFor: (item: T) => number = (item) => (item as PromptCallProfileDraft).durationMs
): Array<{ key: string; totalCalls: number; totalDurationMs: number }> {
  const metrics = new Map<string, { totalCalls: number; totalDurationMs: number }>();
  for (const item of items) {
    const key = keyFor(item);
    const current = metrics.get(key) ?? { totalCalls: 0, totalDurationMs: 0 };
    current.totalCalls += 1;
    current.totalDurationMs += durationFor(item);
    metrics.set(key, current);
  }
  return [...metrics.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => right.totalDurationMs - left.totalDurationMs || right.totalCalls - left.totalCalls || left.key.localeCompare(right.key));
}

function sortCalls(calls: PromptCallProfileDraft[], metric: keyof Pick<PromptCallProfileDraft, 'durationMs' | 'promptInputBytes' | 'schemaBytes' | 'outputBytes'>): PromptCallProfileDraft[] {
  return [...calls].sort((left, right) => right[metric] - left[metric] || right.durationMs - left.durationMs || left.promptCallId.localeCompare(right.promptCallId));
}

function artifactTypeForPath(artifactPath: string): string {
  if (artifactPath.endsWith('.jsonl')) return 'codex_raw_output';
  if (artifactPath.includes('parsed')) return 'codex_parsed_json';
  if (artifactPath.includes('/prompts/')) return 'prompt_artifact';
  if (artifactPath.length > 0) return 'codex_final_output';
  return 'unknown';
}

function increment(target: Record<string, number>, key: string, amount: number): void {
  target[key] = (target[key] ?? 0) + amount;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined && value.length > 0))];
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'unknown';
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
        relativeJsonPath: path.join('audit', jsonFile),
        relativeMdPath: path.join('audit', mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName} audit artifact.`);
}

function renderProfileMarkdown(report: CodexStageRuntimeProfileReport): string {
  return [
    `# Codex Stage Runtime Profile ${report.projectId}`,
    '',
    `totalDurationMs: ${report.totalDurationMs}`,
    `sourceRunCount: ${report.sourceRunCount}`,
    `profiledPromptCallCount: ${report.profiledPromptCallCount}`,
    `remainingUnclassifiedCount: ${report.remainingUnclassifiedCount}`,
    '',
    '## Raw Runtime View',
    'Raw time may include wrapper child calls and can double count provider latency when parent business calls are also recorded.',
    `totalPromptCallCount: ${report.rawRuntimeView.totalPromptCallCount}`,
    `totalDurationMs: ${report.rawRuntimeView.totalDurationMs}`,
    renderRecordTable(report.rawRuntimeView.byStage, 'stage'),
    '',
    '## Business Runtime View',
    'Business time removes double counting by rolling wrapper child calls into parent business prompts. optimization should use business view.',
    `totalBusinessCallCount: ${report.businessRuntimeView.totalBusinessCallCount}`,
    `totalDurationMs: ${report.businessRuntimeView.totalDurationMs}`,
    '### Business duration by stage',
    renderRecordTable(report.businessRuntimeView.byBusinessStage, 'businessStage'),
    '### Business duration by promptId',
    renderRecordTable(report.businessRuntimeView.byPromptId, 'promptId'),
    '',
    '## Overhead Runtime View',
    `wrapperCallCount: ${report.overheadRuntimeView.wrapperCallCount}`,
    `wrapperDurationMs: ${report.overheadRuntimeView.wrapperDurationMs}`,
    `healthSmokeDurationMs: ${report.overheadRuntimeView.healthSmokeDurationMs}`,
    `jsonRepairDurationMs: ${report.overheadRuntimeView.jsonRepairDurationMs}`,
    `unclassifiedOverheadMs: ${report.overheadRuntimeView.unclassifiedOverheadMs}`,
    '',
    '## Wrapper Calls Rolled Up',
    `totalWrapperCalls: ${report.wrapperBreakdown.totalWrapperCalls}`,
    `totalWrapperDurationMs: ${report.wrapperBreakdown.totalWrapperDurationMs}`,
    `orphanWrapperCallCount: ${report.wrapperBreakdown.orphanWrapperCallCount}`,
    '',
    '### Wrapper by type',
    renderMetricTable(report.wrapperBreakdown.byWrapperType),
    '',
    '### Wrapper by parent stage',
    renderMetricTable(report.wrapperBreakdown.byParentStage),
    '',
    '## Orphan Wrapper Calls',
    renderWrapperCallTable(report.wrapperBreakdown.orphanWrapperCalls),
    '',
    '## Top 10 Slowest Business Prompt Calls',
    renderBusinessCallTable(report.slowestBusinessPromptCalls),
    '',
    '## Top 10 slowest prompt calls',
    renderCallTable(report.slowestPromptCalls),
    '',
    '## Top 10 largest prompt inputs',
    renderCallTable(report.largestPromptInputs, 'promptInputBytes'),
    '',
    '## Top 10 largest schemas',
    renderCallTable(report.largestSchemas, 'schemaBytes'),
    '',
    '## Top 10 largest outputs',
    renderCallTable(report.largestOutputs, 'outputBytes'),
    '',
    '## Duration by stage',
    renderRecordTable(report.durationByStage, 'stage'),
    '',
    '## Duration by promptId',
    renderRecordTable(report.durationByPromptId, 'promptId'),
    '',
    '## other_codex breakdown',
    `totalCalls: ${report.otherCodexBreakdown.totalCalls}`,
    `totalDurationMs: ${report.otherCodexBreakdown.totalDurationMs}`,
    '',
    '### other_codex by promptId',
    renderMetricTable(report.otherCodexBreakdown.byPromptId),
    '',
    '### other_codex likely categories',
    renderMetricTable(report.otherCodexBreakdown.likelyCategories.map((item) => ({ key: item.category, totalCalls: item.totalCalls, totalDurationMs: item.totalDurationMs }))),
    '',
    '## Recommended next optimizations',
    'optimization should use business view before raw wrapper timings.',
    ...(report.optimizationCandidates.length === 0
      ? ['- none']
      : report.optimizationCandidates.map((item) => `- ${item.candidateId}: ${item.promptId} -> ${item.suggestedAction} (${item.estimatedImpact})`))
  ].join('\n') + '\n';
}

function renderBusinessCallTable(calls: CodexStageRuntimeProfileReport['slowestBusinessPromptCalls']): string {
  if (calls.length === 0) return '- none';
  return [
    '| businessPromptCallId | runId | promptId | stage | netDurationMs | wrapperDurationMs | providerLatencyMs | childWrapperCallIds |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | --- |',
    ...calls.map((call) => `| ${call.businessPromptCallId} | ${call.runId} | ${call.promptId} | ${call.stage} | ${call.netDurationMs} | ${call.wrapperDurationMs} | ${call.providerLatencyMs} | ${call.childWrapperCallIds.join(', ')} |`)
  ].join('\n');
}

function renderWrapperCallTable(calls: CodexStageRuntimeProfileReport['wrapperBreakdown']['orphanWrapperCalls']): string {
  if (calls.length === 0) return '- none';
  return [
    '| promptCallId | runId | wrapperCallType | durationMs | attributionConfidence | reason |',
    '| --- | --- | --- | ---: | --- | --- |',
    ...calls.map((call) => `| ${call.promptCallId} | ${call.runId} | ${call.wrapperCallType} | ${call.durationMs} | ${call.attributionConfidence} | ${call.attributionReason} |`)
  ].join('\n');
}

function renderCallTable(calls: CodexStageRuntimeProfileReport['slowestPromptCalls'], metric = 'durationMs'): string {
  if (calls.length === 0) return '- none';
  return [
    '| promptCallId | runId | promptId | stage | durationMs | promptInputBytes | schemaBytes | outputBytes | retries | repairs |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...calls.map((call) => `| ${call.promptCallId} | ${call.runId} | ${call.promptId} | ${call.inferredStage} | ${call.durationMs} | ${call.promptInputBytes} | ${call.schemaBytes} | ${call.outputBytes} | ${call.retryCount} | ${call.repairCount} |`)
  ].join('\n') + `\n\nSorted by ${metric}.`;
}

function renderRecordTable(record: Record<string, number>, label: string): string {
  const rows = Object.entries(record)
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 25);
  if (rows.length === 0) return '- none';
  return ['| ' + label + ' | durationMs |', '| --- | ---: |', ...rows.map(([key, value]) => `| ${key} | ${value} |`)].join('\n');
}

function renderMetricTable(items: Array<{ key: string; totalCalls: number; totalDurationMs: number }>): string {
  if (items.length === 0) return '- none';
  return ['| key | calls | durationMs |', '| --- | ---: | ---: |', ...items.map((item) => `| ${item.key} | ${item.totalCalls} | ${item.totalDurationMs} |`)].join('\n');
}
