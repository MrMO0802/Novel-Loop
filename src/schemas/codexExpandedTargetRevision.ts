import { z } from 'zod';

import { CandidateDispositionSchema } from './codexTargetCoverage.js';
import {
  TargetedRevisionDiagnosticsSampleSchema,
  TargetedRevisionDiagnosticsSummarySchema,
  TargetedRevisionDiffSchema,
  TargetedRevisionExperimentReportSchema,
  TargetedRevisionOperationSchema,
  TargetedRevisionPlanSchema,
  TargetedRevisionProtectedArtifactSchema,
  TargetedRevisionScopeValidationSchema
} from './codexTargetedRevision.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RatioSchema = z.number().min(0).max(1);

export const ExpandedTargetRevisionAllowedTargetSchema = z.object({
  targetId: z.string().min(1),
  paragraphIndex: z.number().int().positive(),
  originalSnippet: z.string().min(1).max(600),
  originalSnippetHash: Sha256Schema,
  reason: z.string().min(1),
  relatedClaimIds: z.array(z.string()),
  relatedContradictionIds: z.array(z.string()),
  source: z.enum(['initial', 'expanded']),
  requiredForClosure: z.boolean(),
  allowedOperationTypes: z.array(z.enum(['replace_paragraph', 'delete_duplicate_paragraph', 'merge_target_paragraphs'])).min(1),
  factsToPreserve: z.array(z.string())
}).strict();

export const TargetOperationCoverageDispositionSchema = z.enum([
  'replaced',
  'deleted_as_duplicate',
  'merged_into_target',
  'preserved_with_justification'
]);

export const TargetOperationCoverageSchema = z.object({
  targetId: z.string().min(1),
  paragraphIndex: z.number().int().positive(),
  requiredForClosure: z.boolean(),
  operationIds: z.array(z.string()),
  disposition: TargetOperationCoverageDispositionSchema,
  justification: z.string().min(1),
  coveredClaimIds: z.array(z.string()),
  coveredContradictionIds: z.array(z.string())
}).strict().superRefine((coverage, context) => {
  if (coverage.requiredForClosure && coverage.disposition === 'preserved_with_justification') {
    context.addIssue({ code: 'custom', path: ['disposition'], message: 'required closure targets cannot be preserved without an evidence-rule exemption' });
  }
  if (coverage.disposition !== 'preserved_with_justification' && coverage.operationIds.length === 0) {
    context.addIssue({ code: 'custom', path: ['operationIds'], message: 'modified targets require at least one operation id' });
  }
});

export const ExpandedTargetRevisionPlanSchema = z.object({
  planId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  revisionRound: z.literal(2),
  sourceAdjudicationPath: z.string().min(1),
  sourceDraftPath: z.string().regex(/draft_v1\.md$/),
  sourceDraftHash: Sha256Schema,
  sourceCandidatePath: z.null(),
  approvalRecordPath: z.string().min(1),
  coverageReportPath: z.string().min(1),
  generatedAt: z.string().min(1),
  objective: z.string().min(1),
  fullApprovedTargetIds: z.array(z.string().min(1)).min(1),
  allowedTargets: z.array(ExpandedTargetRevisionAllowedTargetSchema).min(1),
  operations: z.array(TargetedRevisionOperationSchema).min(1).max(16),
  targetOperationCoverage: z.array(TargetOperationCoverageSchema).min(1),
  factsToPreserve: z.array(z.string()).min(1),
  forbiddenChanges: z.array(z.string()).min(1),
  expectedResolvedClaims: z.array(z.string()).min(1),
  expectedResolvedRules: z.array(z.string()).min(1),
  storyStateMutated: z.literal(false)
}).strict().superRefine((plan, context) => {
  const approved = [...new Set(plan.fullApprovedTargetIds)].sort();
  const allowed = [...new Set(plan.allowedTargets.map((target) => target.targetId))].sort();
  const coverage = [...new Set(plan.targetOperationCoverage.map((target) => target.targetId))].sort();
  if (approved.join('|') !== allowed.join('|') || approved.join('|') !== coverage.join('|')) {
    context.addIssue({ code: 'custom', path: ['fullApprovedTargetIds'], message: 'approved, allowed, and operation coverage target sets must match exactly' });
  }
  const allowedById = new Map(plan.allowedTargets.map((target) => [target.targetId, target]));
  const used = new Set<string>();
  for (const [operationIndex, operation] of plan.operations.entries()) {
    for (const targetId of operation.targetIds) {
      const target = allowedById.get(targetId);
      if (target === undefined) {
        context.addIssue({ code: 'custom', path: ['operations', operationIndex, 'targetIds'], message: `operation references unapproved target ${targetId}` });
        continue;
      }
      if (!target.allowedOperationTypes.includes(operation.operationType)) {
        context.addIssue({ code: 'custom', path: ['operations', operationIndex, 'operationType'], message: `${operation.operationType} is not approved for ${targetId}` });
      }
      if (used.has(targetId)) {
        context.addIssue({ code: 'custom', path: ['operations', operationIndex, 'targetIds'], message: `target ${targetId} is modified more than once` });
      }
      used.add(targetId);
    }
  }
  for (const target of plan.allowedTargets.filter((item) => item.requiredForClosure)) {
    if (!used.has(target.targetId)) {
      context.addIssue({ code: 'custom', path: ['operations'], message: `required closure target ${target.targetId} is not handled` });
    }
  }
});

const ResidualReferenceSchema = z.object({
  paragraphIndex: z.number().int().positive(),
  snippet: z.string().min(1).max(600),
  ruleIds: z.array(z.string()).min(1)
}).strict();

const ChangedParagraphSchema = z.object({
  targetId: z.string(),
  paragraphIndexBefore: z.number().int().positive(),
  paragraphIndexAfter: z.number().int().positive().nullable(),
  changeType: z.enum(['replaced', 'deleted', 'merged']),
  beforeHash: Sha256Schema,
  afterHash: Sha256Schema.nullable()
}).strict();

export const ExpandedTargetRevisionScopeValidationSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  revisionRound: z.literal(2),
  sourceDraftPath: z.string().regex(/draft_v1\.md$/),
  candidateDraftPath: z.string().regex(/draft_targeted_revision_candidate_v\d+\.md$/),
  sourceDraftHash: Sha256Schema,
  candidateDraftHash: Sha256Schema,
  fullApprovedTargetSetMatched: z.boolean(),
  requiredTargetsHandled: z.boolean(),
  targetOperationCoverage: z.array(TargetOperationCoverageSchema).min(1),
  changedParagraphs: z.array(ChangedParagraphSchema),
  unauthorizedChanges: z.array(z.string()),
  preservedFacts: z.array(z.string()),
  newEntities: z.array(z.string()),
  newOrders: z.array(z.string()),
  newRecipients: z.array(z.string()),
  newReveals: z.array(z.string()),
  chapterTitleUnchanged: z.boolean(),
  nonTargetParagraphsUnchanged: z.boolean(),
  missionTimeAligned: z.boolean(),
  residualTimeReferences: z.array(ResidualReferenceSchema),
  residualDuplicateSequenceFragments: z.array(ResidualReferenceSchema),
  unauthorizedTimeChanges: z.array(z.string()),
  totalChangedParagraphCount: z.number().int().nonnegative(),
  totalDeletedParagraphCount: z.number().int().nonnegative(),
  totalMergedParagraphCount: z.number().int().nonnegative(),
  wordCountDelta: z.number().int(),
  changeRatio: RatioSchema,
  coverageResolved: z.boolean(),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false),
  scopeValid: z.boolean(),
  generatedAt: z.string().min(1)
}).strict().superRefine((report, context) => {
  const guardsPass = report.fullApprovedTargetSetMatched && report.requiredTargetsHandled &&
    report.unauthorizedChanges.length === 0 && report.newEntities.length === 0 &&
    report.newOrders.length === 0 && report.newRecipients.length === 0 && report.newReveals.length === 0 &&
    report.chapterTitleUnchanged && report.nonTargetParagraphsUnchanged && report.missionTimeAligned &&
    report.residualTimeReferences.length === 0 && report.residualDuplicateSequenceFragments.length === 0 &&
    report.unauthorizedTimeChanges.length === 0 && report.coverageResolved;
  if (report.scopeValid !== guardsPass) {
    context.addIssue({ code: 'custom', path: ['scopeValid'], message: 'scopeValid must match all expanded-target safety guards' });
  }
});

export const ExpandedTargetRevisionDiagnosticsABSchema = z.object({
  reportId: z.string().min(1), projectId: z.string().min(1), chapterNumber: z.number().int().positive(), revisionRound: z.literal(2),
  runId: z.string().min(1), generatedAt: z.string().min(1), sourceDraftPath: z.string().regex(/draft_v1\.md$/),
  sourceDraftHash: Sha256Schema, candidateDraftPath: z.string().min(1), candidateDraftHash: Sha256Schema,
  sampleCountPerArm: z.number().int().positive(), executionOrder: z.array(z.string()).min(2),
  samples: z.array(TargetedRevisionDiagnosticsSampleSchema), baselineSummary: TargetedRevisionDiagnosticsSummarySchema,
  candidateSummary: TargetedRevisionDiagnosticsSummarySchema, baselineSchemaValidRate: RatioSchema,
  provider: z.literal('codex-text'), codexProfile: z.enum(['default', 'clean', 'debug']), codexVersions: z.array(z.string()),
  diagnosticsPromptId: z.literal('diagnostics.diagnose_chapter_slim'), diagnosticsOutputSchemaPath: z.string().min(1),
  sharedContextHash: Sha256Schema, storyStateHash: Sha256Schema, missionHash: Sha256Schema, selectedPlanHash: Sha256Schema,
  candidateSchemaValidRate: RatioSchema, baselineTimelineFailureRate: RatioSchema, candidateTimelineFailureRate: RatioSchema,
  baselineAnyBlockingFailureRate: RatioSchema, candidateAnyBlockingFailureRate: RatioSchema,
  baselineAverageScoreMedian: z.number().min(0).max(10).nullable(), candidateAverageScoreMedian: z.number().min(0).max(10).nullable(),
  scoreDelta: z.number().nullable(), newlyIntroducedHardChecks: z.array(z.string()), resolvedHardChecks: z.array(z.string()),
  schemaInvalidSamplesExcludedFromHardFailDenominator: z.literal(true), environmentConsistent: z.boolean(), experimentValid: z.boolean(),
  independenceCaveat: z.string().min(1), storyStateMutated: z.literal(false), queueMutated: z.literal(false), canonicalDiagnosticsMutated: z.literal(false)
}).strict().superRefine((report, context) => {
  if (report.samples.length !== report.sampleCountPerArm * 2) {
    context.addIssue({ code: 'custom', path: ['samples'], message: 'paired diagnostics requires two samples per pair' });
  }
});

export const CandidateTimelineContradictionSchema = z.object({
  contradictionId: z.string().min(1),
  ruleId: z.enum(['same_event_same_day_explicit_time_conflict', 'duplicate_event_repetition', 'mission_plan_time_mismatch', 'new_time_contradiction']),
  paragraphIndexes: z.array(z.number().int().positive()), evidence: z.array(z.string().min(1)), summary: z.string().min(1), confirmed: z.boolean()
}).strict();

export const CandidateTimelineContradictionMapSchema = z.object({
  mapId: z.string().min(1), projectId: z.string().min(1), chapterNumber: z.number().int().positive(), revisionRound: z.literal(2),
  generatedAt: z.string().min(1), sourceCandidatePath: z.string().min(1), sourceCandidateHash: Sha256Schema,
  expectedResolvedClaims: z.array(z.string()).min(1), expectedResolvedRules: z.array(z.string()).min(1),
  contradictions: z.array(CandidateTimelineContradictionSchema), residualTimeReferences: z.array(ResidualReferenceSchema),
  residualDuplicateSequenceFragments: z.array(ResidualReferenceSchema), necessaryCluesPreserved: z.boolean(), coverageResolved: z.boolean(),
  storyStateMutated: z.literal(false)
}).strict();

export const CandidateRevisionAdjudicationResultSchema = z.enum([
  'confirmed_true_positive', 'likely_true_positive', 'ambiguous', 'false_positive', 'insufficient_evidence', 'no_remaining_contradiction'
]);

export const CandidateRevisionEvidenceAdjudicationSchema = z.object({
  reportId: z.string().min(1), projectId: z.string().min(1), chapterNumber: z.number().int().positive(), revisionRound: z.literal(2),
  generatedAt: z.string().min(1), sourceCandidatePath: z.string().min(1), sourceCandidateHash: Sha256Schema,
  sourceDiagnosticsABPath: z.string().min(1), candidateTimelineContradictionMapPath: z.string().min(1),
  checks: z.object({
    middayVsLateExitResolved: z.boolean(), duplicateDeliverySequenceResolved: z.boolean(), missionPlanTimeMismatchResolved: z.boolean(),
    late2329ReferenceResolved: z.boolean(), secondOpeningSequenceResolved: z.boolean(), noNewTimeContradiction: z.boolean(),
    necessaryActionsAndCluesPreserved: z.boolean()
  }).strict(),
  remainingContradictions: z.array(CandidateTimelineContradictionSchema), newlyIntroducedContradictions: z.array(CandidateTimelineContradictionSchema),
  adjudication: CandidateRevisionAdjudicationResultSchema, confidence: z.enum(['low', 'medium', 'high']),
  recommendedNextStep: z.string().min(1), storyStateMutated: z.literal(false), queueMutated: z.literal(false)
}).strict();

export const ExpandedTargetRevisionQualityCheckSchema = z.object({
  checkId: z.string().min(1), passed: z.boolean(), severity: z.enum(['info', 'warning', 'error', 'critical']), message: z.string().min(1)
}).strict();

export const ExpandedTargetRevisionQualityReportSchema = z.object({
  reportId: z.string().min(1), projectId: z.string().min(1), chapterNumber: z.number().int().positive(), revisionRound: z.literal(2),
  generatedAt: z.string().min(1), sourceDraftPath: z.string().regex(/draft_v1\.md$/), candidateDraftPath: z.string().min(1),
  checks: z.array(ExpandedTargetRevisionQualityCheckSchema).min(1), criticalIssueCount: z.number().int().nonnegative(),
  errorIssueCount: z.number().int().nonnegative(), baselineMedianScore: z.number().min(0).max(10).nullable(),
  candidateMedianScore: z.number().min(0).max(10).nullable(), scoreDelta: z.number().nullable(), scoreRegressionLimit: z.literal(0.25),
  scoreRegressionWithinLimit: z.boolean(), qualityResult: z.enum(['pass', 'warning', 'fail']),
  storyStateMutated: z.literal(false), queueMutated: z.literal(false)
}).strict();

export const ExpandedTargetRevisionExperimentResultSchema = z.enum([
  'revision_effective', 'revision_partially_effective', 'revision_ineffective', 'revision_introduced_regression',
  'experiment_inconclusive', 'scope_violation', 'approval_stale'
]);

export const ExpandedTargetRevisionExperimentReportSchema = z.object({
  reportId: z.string().min(1), projectId: z.string().min(1), chapterNumber: z.number().int().positive(), revisionRound: z.literal(2),
  runId: z.string().min(1), generatedAt: z.string().min(1), approvalRecordPath: z.string().min(1), coverageReportPath: z.string().min(1),
  candidateV1DispositionPath: z.string().min(1), sourceAdjudicationPath: z.string().min(1), sourceDraftPath: z.string().regex(/draft_v1\.md$/),
  sourceCandidatePath: z.null(), targetedRevisionPlanPath: z.string().min(1), candidateDraftPath: z.string().min(1),
  scopeValidationPath: z.string().min(1), revisionDiffPath: z.string().min(1), diagnosticsABPath: z.string().min(1),
  candidateAdjudicationPath: z.string().min(1), candidateTimelineMapPath: z.string().min(1), qualityReportPath: z.string().min(1),
  fullApprovedTargetIds: z.array(z.string()).min(1), sampleCountPerArm: z.number().int().positive(), executionOrder: z.array(z.string()).min(2),
  baselineSchemaValidRate: RatioSchema, candidateSchemaValidRate: RatioSchema, baselineTimelineFailureRate: RatioSchema,
  candidateTimelineFailureRate: RatioSchema, baselineAnyBlockingFailureRate: RatioSchema, candidateAnyBlockingFailureRate: RatioSchema,
  baselineAverageScoreMedian: z.number().min(0).max(10).nullable(), candidateAverageScoreMedian: z.number().min(0).max(10).nullable(),
  scoreDelta: z.number().nullable(), newlyIntroducedHardChecks: z.array(z.string()), resolvedHardChecks: z.array(z.string()),
  candidateAdjudication: CandidateRevisionAdjudicationResultSchema, qualityCriticalIssueCount: z.number().int().nonnegative(),
  scopeValid: z.boolean(), fullApprovedTargetSetMatched: z.boolean(), experimentValid: z.boolean(), result: ExpandedTargetRevisionExperimentResultSchema,
  recommendation: z.string().min(1), requiresHumanReview: z.literal(true), protectedArtifacts: z.array(TargetedRevisionProtectedArtifactSchema).min(1),
  candidateAdopted: z.literal(false), normalPreviewStarted: z.literal(false), commitStarted: z.literal(false),
  canonicalPatchGenerated: z.literal(false), snapshotCreated: z.literal(false), storyStateMutated: z.literal(false), queueMutated: z.literal(false),
  originalDraftMutated: z.literal(false), canonicalDiagnosticsMutated: z.literal(false)
}).strict();

export const ExpandedTargetRevisionCandidateDispositionResultSchema = z.enum([
  'accepted_for_preview_review', 'rejected_no_improvement', 'rejected_scope_violation',
  'rejected_quality_regression', 'inconclusive_requires_more_samples'
]);

export const ExpandedTargetRevisionCandidateDispositionSchema = z.object({
  dispositionId: z.string().min(1), projectId: z.string().min(1), chapterNumber: z.number().int().positive(), revisionRound: z.literal(2),
  candidatePath: z.string().min(1), candidateHash: Sha256Schema, scopeValidationPath: z.string().min(1),
  experimentReportPath: z.string().min(1).nullable(), experimentReportHash: Sha256Schema.nullable(),
  result: ExpandedTargetRevisionCandidateDispositionResultSchema, adopted: z.literal(false), committed: z.literal(false),
  eligibleForPreviewReview: z.boolean(), requiresHumanReview: z.literal(true), automaticFurtherRevisionAllowed: z.literal(false),
  maxAutomaticRevisionRound: z.literal(2), reasons: z.array(z.string()).min(1),
  recommendedNextStep: z.enum(['preview_review', 'human_review', 'collect_five_samples']), generatedAt: z.string().min(1),
  storyStateMutated: z.literal(false), queueMutated: z.literal(false)
}).strict().superRefine((disposition, context) => {
  if ((disposition.result === 'accepted_for_preview_review') !== disposition.eligibleForPreviewReview) {
    context.addIssue({ code: 'custom', path: ['eligibleForPreviewReview'], message: 'only accepted candidates can be preview-review eligible' });
  }
  if ((disposition.result === 'rejected_scope_violation') !== (disposition.experimentReportPath === null && disposition.experimentReportHash === null)) {
    context.addIssue({ code: 'custom', path: ['experimentReportPath'], message: 'only a pre-diagnostics scope rejection may omit the experiment report' });
  }
});

export const TargetedRevisionPlanArtifactSchema = z.union([ExpandedTargetRevisionPlanSchema, TargetedRevisionPlanSchema]);
export const TargetedRevisionScopeValidationArtifactSchema = z.union([ExpandedTargetRevisionScopeValidationSchema, TargetedRevisionScopeValidationSchema]);
export const TargetedRevisionExperimentArtifactSchema = z.union([ExpandedTargetRevisionExperimentReportSchema, TargetedRevisionExperimentReportSchema]);
export const TargetedRevisionCandidateDispositionArtifactSchema = z.union([ExpandedTargetRevisionCandidateDispositionSchema, CandidateDispositionSchema]);
export const TargetedRevisionDiffArtifactSchema = TargetedRevisionDiffSchema;

export type ExpandedTargetRevisionAllowedTarget = z.infer<typeof ExpandedTargetRevisionAllowedTargetSchema>;
export type TargetOperationCoverage = z.infer<typeof TargetOperationCoverageSchema>;
export type ExpandedTargetRevisionPlan = z.infer<typeof ExpandedTargetRevisionPlanSchema>;
export type ExpandedTargetRevisionScopeValidation = z.infer<typeof ExpandedTargetRevisionScopeValidationSchema>;
export type ExpandedTargetRevisionDiagnosticsAB = z.infer<typeof ExpandedTargetRevisionDiagnosticsABSchema>;
export type CandidateTimelineContradictionMap = z.infer<typeof CandidateTimelineContradictionMapSchema>;
export type CandidateRevisionEvidenceAdjudication = z.infer<typeof CandidateRevisionEvidenceAdjudicationSchema>;
export type ExpandedTargetRevisionQualityReport = z.infer<typeof ExpandedTargetRevisionQualityReportSchema>;
export type ExpandedTargetRevisionExperimentReport = z.infer<typeof ExpandedTargetRevisionExperimentReportSchema>;
export type ExpandedTargetRevisionCandidateDisposition = z.infer<typeof ExpandedTargetRevisionCandidateDispositionSchema>;
