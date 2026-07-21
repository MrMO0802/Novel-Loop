import { z } from 'zod';

import { CanonPatchSchema } from './canonPatch.js';
import { StateDiffChangeSchema, StateDiffReportSchema } from './humanReview.js';
import {
  CandidateCommitMutationOriginSchema,
  CandidateCommitMutationTypeSchema,
  CandidateCommitMutationDecisionValueSchema
} from './codexCandidateCommitReview.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ArtifactPathSchema = z.string().min(1);

export const CandidatePatchRemovedOperationSchema = z.object({
  patchPath: z.string().min(1),
  collection: z.literal('narrativeDebtUpdates'),
  index: z.number().int().nonnegative(),
  operation: z.unknown(),
  operationHash: Sha256Schema,
  debtId: z.string().min(1),
  action: z.literal('maintain')
}).strict();

export const CandidatePatchRefinementManifestSchema = z.object({
  refinementId: z.string().min(1),
  runId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  sourceProposalPath: ArtifactPathSchema,
  sourceNormalizedPatchPath: ArtifactPathSchema,
  sourceNormalizedPatchHash: Sha256Schema,
  sourceStateDiffPath: ArtifactPathSchema,
  sourceStateDiffHash: Sha256Schema,
  sourceReviewPath: ArtifactPathSchema,
  sourceNoopAnalysisPath: ArtifactPathSchema,
  sourceDecisionPath: ArtifactPathSchema,
  removedMutationIds: z.array(z.string().min(1)).min(1),
  removedPatchPaths: z.array(z.string().min(1)).min(1),
  removedOperations: z.array(CandidatePatchRemovedOperationSchema).min(1),
  refinedPatchPath: ArtifactPathSchema,
  refinedPatchHash: Sha256Schema,
  sourcePatchSchemaValid: z.literal(true),
  refinedPatchSchemaValid: z.literal(true),
  semanticChangeIntended: z.literal(false),
  refinementReason: z.literal('remove_semantic_noop'),
  confirmed: z.literal(true),
  operator: z.literal('local_user'),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict().superRefine((report, context) => {
  if (report.removedMutationIds.length !== report.removedOperations.length || report.removedPatchPaths.length !== report.removedOperations.length) {
    context.addIssue({ code: 'custom', path: ['removedOperations'], message: 'each removed mutation requires exactly one patch path and atomic operation' });
  }
});

export const CandidatePatchRefinementEquivalenceSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  sourcePatchPath: ArtifactPathSchema,
  refinedPatchPath: ArtifactPathSchema,
  sourceStateHash: Sha256Schema,
  sourceProjectedStateHash: Sha256Schema,
  refinedProjectedStateHash: Sha256Schema,
  projectedStatesEquivalent: z.boolean(),
  sourceBusinessStateHash: Sha256Schema,
  refinedBusinessStateHash: Sha256Schema,
  businessStatesEquivalent: z.boolean(),
  engineMetadataEquivalent: z.boolean(),
  removedOperationWasUnconsumed: z.boolean(),
  actualStateDeltaEquivalent: z.boolean(),
  differences: z.array(z.string()),
  generatedAt: z.string().datetime(),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict().superRefine((report, context) => {
  if (report.projectedStatesEquivalent && report.sourceProjectedStateHash !== report.refinedProjectedStateHash) {
    context.addIssue({ code: 'custom', path: ['sourceProjectedStateHash'], message: 'equivalent projected states require equal hashes' });
  }
  if (report.businessStatesEquivalent && report.sourceBusinessStateHash !== report.refinedBusinessStateHash) {
    context.addIssue({ code: 'custom', path: ['sourceBusinessStateHash'], message: 'equivalent business states require equal hashes' });
  }
});

export const CandidatePatchRefinedValidationSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  refinedPatchPath: ArtifactPathSchema,
  refinedPatchHash: Sha256Schema,
  candidatePatchSchemaValid: z.literal(true),
  canonPatchSchemaValid: z.literal(true),
  narrativeDebtFsmValid: z.literal(true),
  timelineValid: z.literal(true),
  characterKnowledgeValid: z.literal(true),
  readerKnowledgeValid: z.literal(true),
  generatedAt: z.string().datetime()
}).strict();

export const CandidatePatchRefinedConflictSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  refinedPatchPath: ArtifactPathSchema,
  refinedPatchHash: Sha256Schema,
  hard: z.array(z.string()),
  warnings: z.array(z.string()),
  conflictCheckPassed: z.boolean(),
  generatedAt: z.string().datetime()
}).strict().superRefine((report, context) => {
  if (report.conflictCheckPassed !== (report.hard.length === 0)) {
    context.addIssue({ code: 'custom', path: ['conflictCheckPassed'], message: 'conflict pass flag must reflect hard conflicts' });
  }
});

export const RefinedStateDiffReportSchema = StateDiffReportSchema.extend({
  sourceDiffPath: ArtifactPathSchema,
  removedMutationIds: z.array(z.string().min(1)),
  unchangedMutationCount: z.number().int().nonnegative(),
  addedMutationCount: z.number().int().nonnegative(),
  changedMutationCount: z.number().int().nonnegative(),
  actualApplyBased: z.literal(true),
  changes: z.array(StateDiffChangeSchema)
}).superRefine((report, context) => {
  if (report.summary.totalChanges !== report.changes.length) {
    context.addIssue({ code: 'custom', path: ['summary', 'totalChanges'], message: 'summary must equal refined diff changes' });
  }
});

export const CandidateCommitMutationLineageEntrySchema = z.object({
  oldMutationId: z.string().min(1).nullable(),
  newMutationId: z.string().min(1).nullable(),
  mutationFingerprint: Sha256Schema,
  statePath: z.string().min(1),
  mutationType: CandidateCommitMutationTypeSchema,
  beforeHash: Sha256Schema,
  afterHash: Sha256Schema,
  origin: CandidateCommitMutationOriginSchema,
  status: z.enum(['unchanged', 'removed_noop', 'changed', 'added']),
  previousDecisionId: z.string().min(1).nullable(),
  eligibleForDecisionCarryForward: z.boolean(),
  reason: z.string().min(1)
}).strict();

export const CandidateCommitMutationLineageSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  oldReviewPath: ArtifactPathSchema,
  oldEvidenceMapPath: ArtifactPathSchema,
  sourceDiffPath: ArtifactPathSchema,
  refinedDiffPath: ArtifactPathSchema,
  removedMutationIds: z.array(z.string().min(1)),
  unchangedMutationCount: z.number().int().nonnegative(),
  removedNoopMutationCount: z.number().int().nonnegative(),
  changedMutationCount: z.number().int().nonnegative(),
  addedMutationCount: z.number().int().nonnegative(),
  entries: z.array(CandidateCommitMutationLineageEntrySchema),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict();

export const CandidateRefinedHighRiskReviewSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  refinedPatchPath: ArtifactPathSchema,
  refinedStateDiffPath: ArtifactPathSchema,
  evidenceMapPath: ArtifactPathSchema,
  highRiskMutationIds: z.array(z.string().min(1)),
  changesReviewed: z.number().int().nonnegative(),
  decision: z.literal('requires_human_decisions'),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict();

export const CandidateCommitDecisionCarryForwardItemSchema = z.object({
  oldMutationId: z.string().min(1),
  newMutationId: z.string().min(1).nullable(),
  mutationFingerprint: Sha256Schema,
  previousDecisionId: z.string().min(1),
  previousDecisionPath: ArtifactPathSchema,
  previousDecision: CandidateCommitMutationDecisionValueSchema,
  previousNote: z.string().min(1),
  evidenceHashBefore: Sha256Schema,
  evidenceHashAfter: Sha256Schema.nullable(),
  evidenceUnchanged: z.boolean(),
  eligible: z.boolean(),
  reason: z.string().min(1)
}).strict();

export const CandidateCommitDecisionCarryForwardSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  oldReviewPath: ArtifactPathSchema,
  newReviewPath: ArtifactPathSchema,
  lineagePath: ArtifactPathSchema,
  sourceStateHash: Sha256Schema,
  sourceQueueHash: Sha256Schema,
  sourceFinalHash: Sha256Schema,
  sourcePatchHash: Sha256Schema,
  sourceDiffHash: Sha256Schema,
  eligibleDecisionCount: z.number().int().nonnegative(),
  ineligibleDecisionCount: z.number().int().nonnegative(),
  decisions: z.array(CandidateCommitDecisionCarryForwardItemSchema),
  approved: z.boolean(),
  confirmedAt: z.string().datetime().nullable(),
  operator: z.literal('local_user'),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict().superRefine((report, context) => {
  if (report.eligibleDecisionCount !== report.decisions.filter((decision) => decision.eligible).length ||
    report.ineligibleDecisionCount !== report.decisions.filter((decision) => !decision.eligible).length) {
    context.addIssue({ code: 'custom', path: ['eligibleDecisionCount'], message: 'carry-forward decision counts are inconsistent' });
  }
  if (report.approved !== (report.confirmedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['approved'], message: 'approved carry-forward requires confirmedAt' });
  }
});

export type CandidatePatchRefinementManifest = z.infer<typeof CandidatePatchRefinementManifestSchema>;
export type CandidatePatchRefinementEquivalence = z.infer<typeof CandidatePatchRefinementEquivalenceSchema>;
export type CandidatePatchRefinedValidation = z.infer<typeof CandidatePatchRefinedValidationSchema>;
export type CandidatePatchRefinedConflict = z.infer<typeof CandidatePatchRefinedConflictSchema>;
export type RefinedStateDiffReport = z.infer<typeof RefinedStateDiffReportSchema>;
export type CandidateCommitMutationLineage = z.infer<typeof CandidateCommitMutationLineageSchema>;
export type CandidateRefinedHighRiskReview = z.infer<typeof CandidateRefinedHighRiskReviewSchema>;
export type CandidateCommitDecisionCarryForward = z.infer<typeof CandidateCommitDecisionCarryForwardSchema>;
export type CandidatePatchRefined = z.infer<typeof CanonPatchSchema>;
