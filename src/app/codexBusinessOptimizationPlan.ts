import path from 'node:path';

import { CodexBusinessOptimizationPlanSchema, CodexStageRuntimeProfileReportSchema } from '../schemas/index.js';
import type { CodexBusinessOptimizationPlan, CodexStageRuntimeProfileReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface GenerateCodexBusinessOptimizationPlanInput {
  projectId: string;
  projectsRoot?: string;
  sourceProfilePath?: string;
}

export interface GenerateCodexBusinessOptimizationPlanResult {
  report: CodexBusinessOptimizationPlan;
  reportPath: string;
  markdownPath: string;
}

type CandidateType = CodexBusinessOptimizationPlan['optimizationCandidates'][number]['candidateType'];
type RiskLevel = CodexBusinessOptimizationPlan['optimizationCandidates'][number]['riskLevel'];
type SafetyImpact = CodexBusinessOptimizationPlan['optimizationCandidates'][number]['safetyImpact'];
type Complexity = CodexBusinessOptimizationPlan['optimizationCandidates'][number]['implementationComplexity'];
type QualityRisk = CodexBusinessOptimizationPlan['targetStages'][number]['qualityRisk'];

interface TargetDraft {
  stage: string;
  promptId: string;
  durations: number[];
  promptInputBytesTotal: number;
  schemaBytesTotal: number;
  outputBytesTotal: number;
  retryCount: number;
  repairCount: number;
  failureCount: number;
}

interface CandidateDraft {
  stage: string;
  promptId: string;
  candidateType: CandidateType;
  reason: string;
  evidence: string[];
  estimatedImpactMs: number;
  implementationComplexity: Complexity;
  riskLevel: RiskLevel;
  safetyImpact: SafetyImpact;
  expectedBehaviorChange: string;
  filesLikelyTouched: string[];
  testsRequired: string[];
  rollbackPlan: string;
  recommendedFirstStep: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const WRAPPER_REASON = 'Current event timing does not separate provider execution from boundary process duration.';
const DO_NOT_OPTIMIZE_AWAY = [
  'CanonPatchSchema validation',
  'conflict checks',
  'quality critical checks',
  'state diff preview',
  'approval record',
  'before/after snapshots',
  'local applyCanonPatch',
  'audit provenance'
];

export async function generateCodexBusinessOptimizationPlan(
  input: GenerateCodexBusinessOptimizationPlanInput,
  fileStore = new FileStore()
): Promise<GenerateCodexBusinessOptimizationPlanResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const sourceProfilePath = input.sourceProfilePath ?? (await latestRuntimeProfile(paths, fileStore));
  const sourceProfileVersion = versionOf(sourceProfilePath);
  const sourceProfile = await fileStore.readJson(paths.projectArtifact(sourceProfilePath), CodexStageRuntimeProfileReportSchema);
  const targetStages = buildTargetStages(sourceProfile);
  const orphanCleanupPlan = buildOrphanCleanupPlan(sourceProfile);
  const stageSpecificAnalysis = buildStageSpecificAnalysis(targetStages);
  const optimizationCandidates = rankCandidates([
    ...buildStageCandidates(sourceProfile, targetStages),
    ...buildCleanupCandidates(orphanCleanupPlan)
  ]).map((candidate, index) => toPlanCandidate(candidate, index + 1, sourceProfile.businessRuntimeView.totalDurationMs));
  const recommendedExecutionOrder = optimizationCandidates.map((candidate) => candidate.candidateId);
  const totalEstimatedImpactMs = optimizationCandidates.reduce((sum, candidate) => sum + candidate.estimatedImpactMs, 0);
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_business_optimization_plan');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_business_optimization_plan_v${artifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      sourceProfilePath,
      sourceProfileVersion,
      businessTotalDurationMs: sourceProfile.businessRuntimeView.totalDurationMs,
      rawTotalDurationMs: sourceProfile.rawRuntimeView.totalDurationMs,
      wrapperDurationMs: sourceProfile.overheadRuntimeView.wrapperDurationMs,
      targetStages,
      optimizationCandidates,
      recommendedExecutionOrder,
      expectedImpactSummary: {
        totalEstimatedImpactMs,
        totalEstimatedImpactPercent: percentOf(totalEstimatedImpactMs, sourceProfile.businessRuntimeView.totalDurationMs),
        topCandidateIds: recommendedExecutionOrder.slice(0, 5),
        notes: [
          'Impact estimates are directional and generated from existing run manifest v2 runtime attribution only.',
          'Candidates preserve schema validation, conflict checks, approval, snapshots, and local Story State apply boundaries.'
        ]
      },
      safetyNotes: [
        'Do Not Optimize Away: ' + DO_NOT_OPTIMIZE_AWAY.join('; '),
        'Codex optimization planning is read-only and must not mutate Story State.',
        'Do not replace Canon Patch, state diff, approval, snapshot, or audit provenance with direct Codex writes.'
      ],
      rollbackPlan: 'Delete the generated optimization plan artifacts or ignore their recommendations; no Story State or queue files are modified.',
      wrapperInterpretation: {
        likelyIncludesProviderExecution: true,
        pureBoundaryOverheadEstimateMs: null,
        reason: WRAPPER_REASON,
        childCallsRolledUpToBusiness: sourceProfile.businessRuntimeView.wrapperCallsRolledUp,
        orphanWrapperDurationMs: sumOrphanWrapperDuration(sourceProfile),
        recommendedAction: 'Use the business runtime view for optimization decisions; treat wrapper-only time as attribution cleanup until provider execution can be separated.'
      },
      orphanCleanupPlan,
      stageSpecificAnalysis,
      storyStateMutated: false
    },
    CodexBusinessOptimizationPlanSchema
  );
  await fileStore.writeText(artifact.mdPath, renderOptimizationMarkdown(report));
  return {
    report,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath
  };
}

async function latestRuntimeProfile(paths: ProjectPaths, fileStore: FileStore): Promise<string> {
  if (!(await fileStore.exists(paths.auditDir()))) {
    throw new Error(`No runtime profile found for ${paths.projectId}. Run novel-loop codex profile-runtime ${paths.projectId} first.`);
  }
  const fileName = (await fileStore.list(paths.auditDir()))
    .filter((entry) => /^codex_stage_runtime_profile_v\d+\.json$/.test(entry))
    .sort((left, right) => versionOf(path.join('audit', right)) - versionOf(path.join('audit', left)))[0];
  if (fileName === undefined) {
    throw new Error(`No runtime profile found for ${paths.projectId}. Run novel-loop codex profile-runtime ${paths.projectId} first.`);
  }
  return path.join('audit', fileName);
}

function buildTargetStages(report: CodexStageRuntimeProfileReport): CodexBusinessOptimizationPlan['targetStages'] {
  const groups = new Map<string, TargetDraft>();
  for (const call of report.slowestBusinessPromptCalls) {
    const key = `${call.stage}\u0000${call.promptId}`;
    const existing =
      groups.get(key) ??
      {
        stage: call.stage,
        promptId: call.promptId,
        durations: [],
        promptInputBytesTotal: 0,
        schemaBytesTotal: 0,
        outputBytesTotal: 0,
        retryCount: 0,
        repairCount: 0,
        failureCount: 0
      };
    existing.durations.push(call.netDurationMs);
    existing.promptInputBytesTotal += call.promptInputBytes;
    existing.schemaBytesTotal += call.schemaBytes;
    existing.outputBytesTotal += call.outputBytes;
    existing.retryCount += call.retryCount;
    existing.repairCount += call.repairCount;
    groups.set(key, existing);
  }
  return [...groups.values()]
    .map((stage) => {
      const totalDurationMs = stage.durations.reduce((sum, duration) => sum + duration, 0);
      const callCount = stage.durations.length;
      return {
        stage: stage.stage,
        promptId: stage.promptId,
        totalDurationMs,
        callCount,
        averageDurationMs: Math.round(totalDurationMs / callCount),
        maxDurationMs: Math.max(...stage.durations),
        promptInputBytesTotal: stage.promptInputBytesTotal,
        averagePromptInputBytes: Math.round(stage.promptInputBytesTotal / callCount),
        schemaBytesTotal: stage.schemaBytesTotal,
        outputBytesTotal: stage.outputBytesTotal,
        retryCount: stage.retryCount,
        repairCount: stage.repairCount,
        failureCount: stage.failureCount,
        qualityRisk: qualityRiskForStage(stage.stage),
        safetyCritical: isSafetyCritical(stage.stage),
        recommendedStrategy: strategyForStage(stage.stage)
      };
    })
    .sort((left, right) => right.totalDurationMs - left.totalDurationMs);
}

function buildStageCandidates(
  report: CodexStageRuntimeProfileReport,
  targetStages: CodexBusinessOptimizationPlan['targetStages']
): CandidateDraft[] {
  const candidates: CandidateDraft[] = [];
  for (const target of targetStages) {
    if (target.stage === 'canon_patch_proposal') {
      candidates.push(candidate(target, 'split_task', 0.12, 'medium', 'safety_critical', 'medium', [
        'Separate evidence extraction from final CanonPatchSchema-constrained proposal.',
        'Local validation and conflict checks remain unchanged after the split.'
      ]));
      candidates.push(candidate(target, 'slim_schema', 0.15, 'medium', 'safety_critical', 'medium', [
        'Canon patch proposal has high schema bytes and retry/repair pressure.',
        'Split extraction from validation and keep CanonPatchSchema as the final gate.'
      ]));
      candidates.push(candidate(target, 'improve_normalizer', 0.1, 'medium', 'safety_critical', 'low', [
        `retryCount=${target.retryCount}`,
        `repairCount=${target.repairCount}`
      ]));
      continue;
    }
    if (target.stage === 'build_bible') {
      candidates.push(candidate(target, 'reduce_context', 0.3, 'low', 'read_only', 'medium', [
        `promptInputBytesTotal=${target.promptInputBytesTotal}`,
        'Build bible can use brief-focused context and cached strategy artifacts.'
      ]));
      candidates.push(candidate(target, 'cache_artifact', 0.2, 'low', 'read_only', 'low', [
        'Bible outputs are project-level artifacts that should be reused when brief/config have not changed.'
      ]));
      continue;
    }
    if (target.stage === 'write_scene') {
      candidates.push(candidate(target, 'add_context_budget', 0.2, 'low', 'read_only', 'medium', [
        `averagePromptInputBytes=${target.averagePromptInputBytes}`,
        'Use chapter summary, scene card, and active debts instead of full upstream artifacts.'
      ]));
      candidates.push(candidate(target, 'use_chapter_summary_cache', 0.18, 'low', 'read_only', 'medium', [
        'Scene writing should prefer compact prior-chapter summaries over full previous drafts.'
      ]));
      continue;
    }
    if (target.stage === 'final_chapter') {
      candidates.push(candidate(target, 'localize_task', 0.6, 'low', 'read_only', 'medium', [
        'Final chapter can often be local assembly or light polish after draft diagnostics pass.',
        'Do not bypass quality critical checks before final.md.'
      ]));
      continue;
    }
    if (target.stage === 'planning.validate_and_assemble') {
      candidates.push(candidate(target, 'improve_stage_mapping', 0, 'low', 'read_only', 'low', [
        'If no Codex prompt call exists, classify this as deterministic local planning assembly.',
        'If a real promptId exists, add explicit stage mapping.'
      ]));
      continue;
    }
    if (target.schemaBytesTotal > 24_000) {
      candidates.push(candidate(target, 'slim_schema', 0.12, 'medium', isSafetyCritical(target.stage) ? 'safety_critical' : 'read_only', 'medium', [
        `schemaBytesTotal=${target.schemaBytesTotal}`
      ]));
    }
    if (target.retryCount + target.repairCount > 0) {
      candidates.push(candidate(target, 'improve_normalizer', 0.08, 'medium', isSafetyCritical(target.stage) ? 'safety_critical' : 'read_only', 'low', [
        `retryCount=${target.retryCount}`,
        `repairCount=${target.repairCount}`
      ]));
    }
  }
  if ((report.otherCodexBreakdown.totalCalls > 0 || report.remainingUnclassifiedCount > 0) && !targetStages.some((target) => target.stage === 'planning.validate_and_assemble')) {
    const durationMs = report.otherCodexBreakdown.totalDurationMs;
    candidates.push({
      stage: 'other_codex',
      promptId: 'other_codex',
      candidateType: 'improve_stage_mapping',
      reason: 'Remaining other_codex calls should be classified before optimizing business runtime.',
      evidence: [`remainingUnclassifiedCount=${report.remainingUnclassifiedCount}`, `otherCodexDurationMs=${durationMs}`],
      estimatedImpactMs: 0,
      implementationComplexity: 'low',
      riskLevel: 'low',
      safetyImpact: 'read_only',
      expectedBehaviorChange: 'Profiler attribution becomes clearer without changing generation behavior.',
      filesLikelyTouched: ['src/providers/codex/promptStageMapping.ts', 'src/app/codexRuntimeProfiler.ts'],
      testsRequired: ['tests/e2e/codexCallLevelProfile.test.ts', 'tests/e2e/codexWrapperAttribution.test.ts'],
      rollbackPlan: 'Revert attribution mapping changes; no Story State artifacts are touched.',
      recommendedFirstStep: 'Classify recurring orphan or smoke-like calls with explicit promptId rules.'
    });
  }
  return candidates;
}

function buildCleanupCandidates(orphanCleanupPlan: CodexBusinessOptimizationPlan['orphanCleanupPlan']): CandidateDraft[] {
  return orphanCleanupPlan.map((cleanup) => ({
    stage: cleanup.stage,
    promptId: cleanup.promptId,
    candidateType: cleanup.promptId.startsWith('codex.exec') ? 'classify_orphan_wrapper' : 'improve_stage_mapping',
    reason: 'Cleanup remaining unclassified Codex runtime before making business runtime commitments.',
    evidence: [`durationMs=${cleanup.durationMs}`, `confidence=${cleanup.confidence}`],
    estimatedImpactMs: 0,
    implementationComplexity: 'low',
    riskLevel: 'low',
    safetyImpact: 'read_only',
    expectedBehaviorChange: 'Runtime reports become easier to interpret; generation behavior does not change.',
    filesLikelyTouched: ['src/providers/codex/promptStageMapping.ts', 'src/app/codexRuntimeProfiler.ts'],
    testsRequired: ['tests/e2e/codexCallLevelProfile.test.ts', 'tests/e2e/codexWrapperAttribution.test.ts'],
    rollbackPlan: 'Revert attribution-only mapping changes; no Story State artifacts are modified.',
    recommendedFirstStep: cleanup.recommendedAction
  }));
}

function candidate(
  target: CodexBusinessOptimizationPlan['targetStages'][number],
  candidateType: CandidateType,
  impactRatio: number,
  riskLevel: RiskLevel,
  safetyImpact: SafetyImpact,
  implementationComplexity: Complexity,
  evidence: string[]
): CandidateDraft {
  return {
    stage: target.stage,
    promptId: target.promptId,
    candidateType,
    reason: reasonForCandidate(target.stage, candidateType),
    evidence: [
      `totalDurationMs=${target.totalDurationMs}`,
      `callCount=${target.callCount}`,
      `promptInputBytesTotal=${target.promptInputBytesTotal}`,
      `schemaBytesTotal=${target.schemaBytesTotal}`,
      ...evidence
    ],
    estimatedImpactMs: Math.round(target.totalDurationMs * impactRatio),
    implementationComplexity,
    riskLevel,
    safetyImpact,
    expectedBehaviorChange: behaviorChangeForCandidate(candidateType),
    filesLikelyTouched: filesForCandidate(target.stage, candidateType),
    testsRequired: testsForCandidate(target.stage, candidateType),
    rollbackPlan: 'Revert the targeted prompt/context/profiler change and rerun mock plus Codex pilot regression; no committed Story State should be edited manually.',
    recommendedFirstStep: firstStepForCandidate(target.stage, candidateType)
  };
}

function rankCandidates(candidates: CandidateDraft[]): CandidateDraft[] {
  return [...candidates].sort((left, right) => score(right) - score(left) || right.estimatedImpactMs - left.estimatedImpactMs || left.stage.localeCompare(right.stage));
}

function score(candidate: CandidateDraft): number {
  const riskPenalty = { low: 0, medium: 35_000, high: 100_000 }[candidate.riskLevel];
  const safetyPenalty = candidate.safetyImpact === 'safety_critical' ? 60_000 : 0;
  const complexityPenalty = { low: 0, medium: 15_000, high: 45_000 }[candidate.implementationComplexity];
  return candidate.estimatedImpactMs - riskPenalty - safetyPenalty - complexityPenalty;
}

function toPlanCandidate(candidate: CandidateDraft, index: number, businessTotalDurationMs: number): CodexBusinessOptimizationPlan['optimizationCandidates'][number] {
  const candidateId = `candidate_${String(index).padStart(3, '0')}_${candidate.candidateType}_${sanitizeId(candidate.stage)}`;
  return {
    candidateId,
    ...candidate,
    estimatedImpactPercent: percentOf(candidate.estimatedImpactMs, businessTotalDurationMs)
  };
}

function buildOrphanCleanupPlan(report: CodexStageRuntimeProfileReport): CodexBusinessOptimizationPlan['orphanCleanupPlan'] {
  const cleanup = new Map<string, CodexBusinessOptimizationPlan['orphanCleanupPlan'][number]>();
  for (const call of report.unclassifiedCalls) {
    cleanup.set(`${call.promptId}:${call.inferredStage}:${call.promptCallId}`, {
      promptId: call.promptId,
      stage: call.promptId === 'planning.validate_and_assemble' ? 'planning.validate_and_assemble' : call.inferredStage,
      durationMs: call.durationMs,
      confidence: 'low',
      recommendedAction: cleanupActionForCall(call.promptId)
    });
  }
  for (const wrapper of report.wrapperBreakdown.orphanWrapperCalls) {
    const matchingCall = report.unclassifiedCalls.find((call) => call.promptCallId === wrapper.promptCallId);
    const promptId = matchingCall?.promptId ?? 'codex.exec-json';
    cleanup.set(`${promptId}:other_codex:${wrapper.promptCallId}`, {
      promptId,
      stage: 'other_codex',
      durationMs: wrapper.durationMs,
      confidence: wrapper.attributionConfidence,
      recommendedAction: cleanupActionForCall(promptId)
    });
  }
  return [...cleanup.values()].sort((left, right) => right.durationMs - left.durationMs);
}

function buildStageSpecificAnalysis(targetStages: CodexBusinessOptimizationPlan['targetStages']): CodexBusinessOptimizationPlan['stageSpecificAnalysis'] {
  const analyses = new Map<string, CodexBusinessOptimizationPlan['stageSpecificAnalysis'][number]>();
  for (const stage of targetStages) {
    if (stage.stage === 'canon_patch_proposal') {
      analyses.set(stage.stage, {
        stage: stage.stage,
        promptId: stage.promptId,
        recommendation: 'Consider split extraction, slim schema prompts, improved normalizer, and local post-processing while keeping CanonPatchSchema validation.',
        safetyNote: 'Never let Codex directly overwrite story_state.json or bypass conflict checks.'
      });
    }
    if (stage.stage === 'build_bible') {
      analyses.set(stage.stage, {
        stage: stage.stage,
        promptId: stage.promptId,
        recommendation: 'Reduce brief context, cache stable strategy artifacts, or split only if the output quality degrades.',
        safetyNote: 'This is read-only project material generation and does not justify state commit shortcuts.'
      });
    }
    if (stage.stage === 'write_scene') {
      analyses.set(stage.stage, {
        stage: stage.stage,
        promptId: stage.promptId,
        recommendation: 'Use chapter summary cache, scene-only context, scene length caps, and prompt rewrite before increasing full-context size.',
        safetyNote: 'Do not reuse old stale final text as canonical generation input.'
      });
    }
    if (stage.stage === 'final_chapter') {
      analyses.set(stage.stage, {
        stage: stage.stage,
        promptId: stage.promptId,
        recommendation: 'Prefer local assemble or light polish when diagnostics pass; keep final quality gates before commit.',
        safetyNote: 'Do not skip diagnostics, approval, or state diff to save runtime.'
      });
    }
    if (stage.stage === 'planning.validate_and_assemble') {
      analyses.set(stage.stage, {
        stage: stage.stage,
        promptId: stage.promptId,
        recommendation: 'Classify deterministic local planning assembly outside business Codex runtime unless a real promptId exists.',
        safetyNote: 'Mapping changes must be provenance-only and must not alter planning artifacts.'
      });
    }
  }
  return [...analyses.values()];
}

function qualityRiskForStage(stage: string): QualityRisk {
  if (stage === 'canon_patch_proposal' || stage === 'final_chapter') return 'high';
  if (stage === 'write_scene' || stage === 'build_bible') return 'medium';
  return 'low';
}

function isSafetyCritical(stage: string): boolean {
  return ['canon_patch_proposal', 'state_diff', 'confirm_apply'].includes(stage);
}

function strategyForStage(stage: string): string {
  if (stage === 'canon_patch_proposal') return 'Split extraction from validation, slim prompt schema, and improve normalizer without weakening commit safety.';
  if (stage === 'build_bible') return 'Reduce context and cache stable strategy artifacts.';
  if (stage === 'write_scene') return 'Use chapter summary cache, scene card, and explicit context budget instead of broad project context.';
  if (stage === 'final_chapter') return 'Prefer local assemble/light polish if quality gates already pass.';
  if (stage === 'planning.validate_and_assemble') return 'Classify as local deterministic assembly unless run evidence shows a real Codex prompt.';
  return 'Inspect prompt bytes, schema bytes, retry counts, and provenance before changing behavior.';
}

function reasonForCandidate(stage: string, candidateType: CandidateType): string {
  if (stage === 'canon_patch_proposal') return 'Canon patch proposal is slow and repair-prone, but safety gates must remain intact.';
  if (stage === 'write_scene') return 'Scene writing is prompt-byte heavy and can benefit from compact chapter summaries.';
  if (stage === 'final_chapter') return 'Final assembly may be deterministic after draft and diagnostics produce acceptable structure.';
  if (stage === 'build_bible') return 'Build bible has large input context and stable reusable outputs.';
  if (candidateType === 'improve_stage_mapping') return 'Profiler attribution should separate local deterministic assembly from business Codex generation.';
  return 'Runtime profile indicates this stage is a candidate for targeted optimization.';
}

function behaviorChangeForCandidate(candidateType: CandidateType): string {
  if (candidateType === 'localize_task') return 'Moves deterministic work out of Codex while preserving downstream validation.';
  if (candidateType === 'classify_orphan_wrapper' || candidateType === 'improve_stage_mapping') return 'Improves reporting attribution only; no generation behavior change.';
  if (candidateType === 'slim_schema') return 'Reduces prompt/schema payload while preserving the schema validation boundary.';
  if (candidateType === 'add_context_budget' || candidateType === 'use_chapter_summary_cache') return 'Changes Codex input selection to compact summaries and bounded context.';
  return 'Narrows Codex input/output work without weakening safety gates.';
}

function filesForCandidate(stage: string, candidateType: CandidateType): string[] {
  if (candidateType === 'improve_stage_mapping' || candidateType === 'classify_orphan_wrapper') {
    return ['src/providers/codex/promptStageMapping.ts', 'src/app/codexRuntimeProfiler.ts'];
  }
  if (stage === 'write_scene') {
    return ['src/providers/codex/contextBuilder.ts', 'prompts/write_scene.md', 'tests/e2e/codexSingleChapterSmoke.test.ts'];
  }
  if (stage === 'canon_patch_proposal') {
    return ['src/providers/codex/CodexTextProvider.ts', 'prompts/extract_canon_patch.md', 'src/schemas/canonPatch.ts'];
  }
  if (stage === 'final_chapter') {
    return ['src/app/chapterPipeline.ts', 'src/app/chapterDraft.ts', 'tests/e2e/codexSingleChapterSmoke.test.ts'];
  }
  return ['src/providers/codex/contextBuilder.ts', 'prompts'];
}

function testsForCandidate(stage: string, candidateType: CandidateType): string[] {
  if (candidateType === 'improve_stage_mapping' || candidateType === 'classify_orphan_wrapper') {
    return ['tests/e2e/codexCallLevelProfile.test.ts', 'tests/e2e/codexWrapperAttribution.test.ts'];
  }
  if (stage === 'canon_patch_proposal') {
    return ['tests/e2e/codexPatchFailure.test.ts', 'tests/e2e/stateDiff.test.ts', 'tests/e2e/codexSingleChapterSmoke.test.ts'];
  }
  if (stage === 'write_scene') {
    return ['tests/e2e/codexSingleChapterSmoke.test.ts', 'tests/e2e/crossChapterContinuityReport.test.ts'];
  }
  return ['tests/e2e/codexSingleChapterSmoke.test.ts', 'tests/e2e/mockDemo.test.ts'];
}

function firstStepForCandidate(stage: string, candidateType: CandidateType): string {
  if (candidateType === 'slim_schema') return 'Measure schema bytes for the prompt and remove redundant explanatory text while keeping output-schema validation.';
  if (candidateType === 'add_context_budget') return 'Add a stage-specific context budget report and reject oversized scene prompts before Codex execution.';
  if (candidateType === 'use_chapter_summary_cache') return 'Feed chapter_summary_for_context.json instead of full previous chapter text in the scene prompt context.';
  if (candidateType === 'localize_task') return 'Prototype local assembly behind a feature flag and compare final quality reports before enabling.';
  if (candidateType === 'cache_artifact') return 'Hash brief/config inputs and reuse unchanged strategy artifacts.';
  if (candidateType === 'improve_normalizer') return 'Collect repair failures and add deterministic normalization before retrying Codex.';
  if (candidateType === 'improve_stage_mapping') return 'Add a promptId-to-stage mapping fixture and rerun profile-runtime.';
  if (candidateType === 'classify_orphan_wrapper') return 'Link wrapper calls with parentPromptCallId or classify smoke-like exec-json artifacts.';
  return `Inspect ${stage} prompt/runtime evidence and make one reversible change.`;
}

function cleanupActionForCall(promptId: string): string {
  if (promptId.startsWith('codex.exec-json')) return 'Classify codex.exec-json smoke-like if artifact/command matches; otherwise keep it as a low-confidence warning.';
  if (promptId === 'planning.validate_and_assemble') return 'Classify planning.validate_and_assemble as local planning assembly if no Codex prompt call exists, or add a mapping if an actual promptId exists.';
  return 'Add a promptId mapping only after repeated evidence; keep low-confidence one-off calls as warnings.';
}

function sumOrphanWrapperDuration(report: CodexStageRuntimeProfileReport): number {
  return report.wrapperBreakdown.orphanWrapperCalls.reduce((sum, call) => sum + call.durationMs, 0);
}

function percentOf(value: number, total: number): number {
  return total === 0 ? 0 : Number(((value / total) * 100).toFixed(2));
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'unknown';
}

function versionOf(relativePath: string): number {
  return Number.parseInt(/codex_stage_runtime_profile_v(\d+)\.json$/.exec(relativePath)?.[1] ?? '0', 10);
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

function renderOptimizationMarkdown(report: CodexBusinessOptimizationPlan): string {
  return [
    `# Codex Business Optimization Plan ${report.reportId}`,
    '',
    '## Executive Summary',
    `Project: ${report.projectId}`,
    `Business runtime: ${report.businessTotalDurationMs}ms`,
    `Raw runtime: ${report.rawTotalDurationMs}ms`,
    `Wrapper runtime: ${report.wrapperDurationMs}ms`,
    `Top estimated impact: ${report.expectedImpactSummary.totalEstimatedImpactMs}ms (${report.expectedImpactSummary.totalEstimatedImpactPercent}%)`,
    '',
    '## Current Runtime Breakdown',
    `Source profile: ${report.sourceProfilePath}`,
    `Wrapper interpretation: ${report.wrapperInterpretation.reason}`,
    `Orphan wrapper duration: ${report.wrapperInterpretation.orphanWrapperDurationMs}ms`,
    '',
    '## Top Business Bottlenecks',
    ...report.targetStages.slice(0, 8).map((stage) => `- ${stage.stage} / ${stage.promptId}: ${stage.totalDurationMs}ms, calls=${stage.callCount}, promptBytes=${stage.promptInputBytesTotal}, schemaBytes=${stage.schemaBytesTotal}`),
    '',
    '## Top Optimization Candidates',
    ...report.optimizationCandidates.slice(0, 10).map((candidate) => `- ${candidate.candidateId}: ${candidate.candidateType} for ${candidate.stage} / ${candidate.promptId}, impact=${candidate.estimatedImpactMs}ms, risk=${candidate.riskLevel}, safety=${candidate.safetyImpact}`),
    '',
    '## Stage-specific Recommendations',
    ...report.stageSpecificAnalysis.map((analysis) => `- ${analysis.stage}: ${analysis.recommendation} Safety: ${analysis.safetyNote}`),
    '',
    '## Safety Constraints',
    ...report.safetyNotes.map((note) => `- ${note}`),
    '',
    '## Recommended Next Milestones',
    '- M27.5: implement the top low-risk context or cache candidate behind focused tests.',
    '- M27.6: re-run runtime profile and compare net business runtime before changing safety-critical stages.',
    '',
    '## Do Not Optimize Away',
    ...DO_NOT_OPTIMIZE_AWAY.map((item) => `- ${item}`),
    '',
    '## Orphan Cleanup Plan',
    ...report.orphanCleanupPlan.map((cleanup) => `- ${cleanup.promptId} (${cleanup.stage}): ${cleanup.recommendedAction}`)
  ].join('\n') + '\n';
}
