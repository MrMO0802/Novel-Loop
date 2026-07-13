import { z } from 'zod';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const TargetedRevisionOperationTypeSchema = z.enum([
  'replace_paragraph',
  'delete_duplicate_paragraph',
  'merge_target_paragraphs'
]);

export const TargetedRevisionAllowedTargetSchema = z.object({
  targetId: z.string().min(1),
  paragraphIndex: z.number().int().positive(),
  originalSnippetHash: Sha256Schema,
  reason: z.string().min(1),
  relatedClaimIds: z.array(z.string()),
  relatedContradictionIds: z.array(z.string())
}).strict();

export const TargetedRevisionOperationSchema = z.object({
  operationId: z.string().min(1),
  operationType: TargetedRevisionOperationTypeSchema,
  targetIds: z.array(z.string().min(1)).min(1),
  replacementText: z.string().max(2000),
  reason: z.string().min(1),
  expectedEffect: z.string().min(1),
  rulesAddressed: z.array(z.string()).min(1),
  factsPreserved: z.array(z.string()),
  newFactsIntroduced: z.array(z.string()).max(0)
}).strict().superRefine((operation, context) => {
  if (operation.operationType === 'replace_paragraph' && (operation.targetIds.length !== 1 || operation.replacementText.trim().length === 0)) {
    context.addIssue({ code: 'custom', path: ['targetIds'], message: 'replace_paragraph requires one target and non-empty replacementText' });
  }
  if (operation.operationType === 'delete_duplicate_paragraph' && (operation.targetIds.length !== 1 || operation.replacementText.length !== 0)) {
    context.addIssue({ code: 'custom', path: ['replacementText'], message: 'delete_duplicate_paragraph requires one target and empty replacementText' });
  }
  if (operation.operationType === 'merge_target_paragraphs' && (operation.targetIds.length < 2 || operation.replacementText.trim().length === 0)) {
    context.addIssue({ code: 'custom', path: ['targetIds'], message: 'merge_target_paragraphs requires at least two targets and non-empty replacementText' });
  }
});

export const TargetedRevisionProviderOutputSchema = z.object({
  operations: z.array(TargetedRevisionOperationSchema).min(1).max(16)
}).strict();

export const TargetedRevisionPlanSchema = z.object({
  planId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  sourceAdjudicationPath: z.string(),
  sourceDraftPath: z.string(),
  sourceDraftHash: Sha256Schema,
  generatedAt: z.string(),
  objective: z.string(),
  allowedTargets: z.array(TargetedRevisionAllowedTargetSchema).min(1),
  operations: z.array(TargetedRevisionOperationSchema).min(1),
  factsToPreserve: z.array(z.string()),
  forbiddenChanges: z.array(z.string()).min(1),
  expectedResolvedRules: z.array(z.string()).min(1),
  storyStateMutated: z.literal(false)
}).strict().superRefine((plan, context) => {
  const allowed = new Set(plan.allowedTargets.map((target) => target.targetId));
  const used = new Set<string>();
  const addressedRules = new Set(plan.operations.flatMap((operation) => operation.rulesAddressed));
  for (const [operationIndex, operation] of plan.operations.entries()) {
    for (const targetId of operation.targetIds) {
      if (!allowed.has(targetId)) {
        context.addIssue({ code: 'custom', path: ['operations', operationIndex, 'targetIds'], message: `Operation references unauthorized target ${targetId}` });
      }
      if (used.has(targetId)) {
        context.addIssue({ code: 'custom', path: ['operations', operationIndex, 'targetIds'], message: `Target ${targetId} is modified more than once` });
      }
      used.add(targetId);
    }
  }
  for (const ruleId of plan.expectedResolvedRules) {
    if (!addressedRules.has(ruleId)) {
      context.addIssue({ code: 'custom', path: ['operations'], message: `No operation addresses expected rule ${ruleId}` });
    }
  }
});

export const TargetedRevisionChangedParagraphSchema = z.object({
  targetId: z.string(),
  paragraphIndexBefore: z.number().int().positive(),
  paragraphIndexAfter: z.number().int().positive().nullable(),
  changeType: z.enum(['replaced', 'deleted', 'merged']),
  beforeHash: Sha256Schema,
  afterHash: Sha256Schema.nullable()
}).strict();

export const TargetedRevisionScopeValidationSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  sourceDraftPath: z.string(),
  candidateDraftPath: z.string(),
  sourceDraftHash: Sha256Schema,
  candidateDraftHash: Sha256Schema,
  changedParagraphs: z.array(TargetedRevisionChangedParagraphSchema),
  unauthorizedChanges: z.array(z.string()),
  preservedFacts: z.array(z.string()),
  newEntities: z.array(z.string()),
  newOrders: z.array(z.string()),
  newRecipients: z.array(z.string()),
  newReveals: z.array(z.string()),
  chapterTitleUnchanged: z.boolean(),
  nonTargetParagraphsUnchanged: z.boolean(),
  missionTimeAligned: z.boolean(),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false),
  scopeValid: z.boolean(),
  generatedAt: z.string()
}).strict().superRefine((report, context) => {
  if (report.scopeValid && (
    report.unauthorizedChanges.length > 0 ||
    report.newEntities.length > 0 ||
    report.newOrders.length > 0 ||
    report.newRecipients.length > 0 ||
    report.newReveals.length > 0 ||
    !report.chapterTitleUnchanged ||
    !report.nonTargetParagraphsUnchanged ||
    !report.missionTimeAligned
  )) {
    context.addIssue({ code: 'custom', path: ['scopeValid'], message: 'scopeValid cannot be true when a scope guard failed' });
  }
});

export const TargetedRevisionDiffChangeSchema = z.object({
  targetId: z.string(),
  paragraphIndexBefore: z.number().int().positive(),
  paragraphIndexAfter: z.number().int().positive().nullable(),
  changeType: z.enum(['replace_paragraph', 'delete_duplicate_paragraph', 'merge_target_paragraphs']),
  beforeSnippet: z.string().max(600),
  afterSnippet: z.string().max(600),
  beforeHash: Sha256Schema,
  afterHash: Sha256Schema.nullable(),
  reason: z.string(),
  addressedRules: z.array(z.string())
}).strict();

export const TargetedRevisionDiffSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  sourceDraftPath: z.string(),
  candidateDraftPath: z.string(),
  generatedAt: z.string(),
  changes: z.array(TargetedRevisionDiffChangeSchema).min(1),
  storyStateMutated: z.literal(false)
}).strict();

export const TargetedRevisionDiagnosticsSampleSchema = z.object({
  sampleId: z.string(),
  pairIndex: z.number().int().positive(),
  arm: z.enum(['baseline', 'candidate']),
  sequenceIndex: z.number().int().positive(),
  runId: z.string(),
  promptCallId: z.string(),
  durationMs: z.number().int().nonnegative(),
  draftPath: z.string(),
  draftHash: Sha256Schema,
  schemaValid: z.boolean(),
  timelineConsistencyPassed: z.boolean().nullable(),
  allHardChecksPassed: z.boolean().nullable(),
  hardChecks: z.record(z.string(), z.object({ passed: z.boolean(), message: z.string(), evidence: z.string().optional() })),
  averageScore: z.number().min(0).max(10).nullable(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  rawOutputPath: z.string(),
  finalOutputPath: z.string(),
  parsedOutputPath: z.string(),
  error: z.string().nullable(),
  storyStateMutated: z.literal(false)
}).strict();

export const TargetedRevisionDiagnosticsSummarySchema = z.object({
  sampleCount: z.number().int().positive(),
  schemaValidCount: z.number().int().nonnegative(),
  timelinePassCount: z.number().int().nonnegative(),
  timelineFailCount: z.number().int().nonnegative(),
  timelinePassRateAmongSchemaValid: z.number().min(0).max(1).nullable(),
  allHardChecksPassCount: z.number().int().nonnegative(),
  allHardChecksPassRateAmongSchemaValid: z.number().min(0).max(1).nullable(),
  averageScoreMean: z.number().min(0).max(10).nullable(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative()
}).strict();

export const TargetedRevisionPairComparisonSchema = z.object({
  pairIndex: z.number().int().positive(),
  baselineSampleId: z.string(),
  candidateSampleId: z.string(),
  timelineOutcome: z.enum(['improved', 'regressed', 'unchanged_pass', 'unchanged_fail', 'inconclusive']),
  scoreDelta: z.number().nullable()
}).strict();

export const TargetedRevisionProtectedArtifactSchema = z.object({
  path: z.string(),
  beforeSha256: Sha256Schema,
  afterSha256: Sha256Schema,
  unchanged: z.literal(true)
}).strict();

export const TargetedRevisionExperimentResultSchema = z.enum([
  'candidate_clears_timeline_failure',
  'candidate_improves_but_not_clear',
  'no_improvement',
  'regression',
  'inconclusive'
]);

export const TargetedRevisionExperimentReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  runId: z.string(),
  generatedAt: z.string(),
  sourceAdjudicationPath: z.string(),
  targetedRevisionPlanPath: z.string(),
  candidateDraftPath: z.string(),
  scopeValidationPath: z.string(),
  revisionDiffPath: z.string(),
  sourceDraftPath: z.string(),
  sampleCountPerArm: z.number().int().positive(),
  executionOrder: z.array(z.string()).min(2),
  contextMode: z.literal('enhanced'),
  provider: z.literal('codex-text'),
  codexProfile: z.enum(['default', 'clean', 'debug']),
  codexVersion: z.string(),
  environmentConsistent: z.boolean(),
  diagnosticsPromptId: z.literal('diagnostics.diagnose_chapter_slim'),
  diagnosticsOutputSchemaPath: z.string(),
  sharedContextHash: Sha256Schema,
  storyStateHash: Sha256Schema,
  missionHash: Sha256Schema,
  selectedPlanHash: Sha256Schema,
  samples: z.array(TargetedRevisionDiagnosticsSampleSchema),
  baselineSummary: TargetedRevisionDiagnosticsSummarySchema,
  candidateSummary: TargetedRevisionDiagnosticsSummarySchema,
  pairedComparisons: z.array(TargetedRevisionPairComparisonSchema),
  result: TargetedRevisionExperimentResultSchema,
  recommendation: z.string(),
  independenceCaveat: z.string(),
  protectedArtifacts: z.array(TargetedRevisionProtectedArtifactSchema).min(1),
  candidateAdopted: z.literal(false),
  normalPreviewStarted: z.literal(false),
  commitStarted: z.literal(false),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false),
  originalDraftMutated: z.literal(false),
  canonicalDiagnosticsMutated: z.literal(false)
}).strict().superRefine((report, context) => {
  if (report.samples.length !== report.sampleCountPerArm * 2) {
    context.addIssue({ code: 'custom', path: ['samples'], message: 'A/B report must contain two samples per pair' });
  }
  if (report.pairedComparisons.length !== report.sampleCountPerArm) {
    context.addIssue({ code: 'custom', path: ['pairedComparisons'], message: 'pairedComparisons must match sampleCountPerArm' });
  }
});

export type TargetedRevisionAllowedTarget = z.infer<typeof TargetedRevisionAllowedTargetSchema>;
export type TargetedRevisionOperation = z.infer<typeof TargetedRevisionOperationSchema>;
export type TargetedRevisionProviderOutput = z.infer<typeof TargetedRevisionProviderOutputSchema>;
export type TargetedRevisionPlan = z.infer<typeof TargetedRevisionPlanSchema>;
export type TargetedRevisionScopeValidation = z.infer<typeof TargetedRevisionScopeValidationSchema>;
export type TargetedRevisionDiff = z.infer<typeof TargetedRevisionDiffSchema>;
export type TargetedRevisionDiagnosticsSample = z.infer<typeof TargetedRevisionDiagnosticsSampleSchema>;
export type TargetedRevisionDiagnosticsSummary = z.infer<typeof TargetedRevisionDiagnosticsSummarySchema>;
export type TargetedRevisionExperimentReport = z.infer<typeof TargetedRevisionExperimentReportSchema>;
