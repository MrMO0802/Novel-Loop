import { z } from 'zod';

import {
  NormalizedTargetedRevisionOperationSchema,
  TargetedRevisionOperationNormalizationModeSchema,
  TargetedRevisionOperationTypeSchema
} from './codexTargetedRevision.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const TargetedRevisionOperationContractErrorCodeSchema = z.enum([
  'CODEX_TARGETED_REVISION_OPERATION_CONTRACT_MISMATCH',
  'CODEX_TARGETED_REVISION_DELETE_CARDINALITY_INVALID',
  'CODEX_TARGETED_REVISION_ATOMIC_SPLIT_UNSAFE',
  'CODEX_TARGETED_REVISION_OPERATION_TARGET_NOT_APPROVED',
  'CODEX_TARGETED_REVISION_OPERATION_TYPE_NOT_ALLOWED',
  'CODEX_TARGETED_REVISION_SEQUENCE_IDENTITY_MISMATCH'
]);

export const TargetedRevisionOperationNormalizationEntrySchema = z.object({
  sourceOperationId: z.string().min(1),
  sourceOperationType: TargetedRevisionOperationTypeSchema,
  sourceTargetIds: z.array(z.string().min(1)).min(1),
  normalizedOperationIds: z.array(z.string().min(1)).min(1),
  normalizedTargetIds: z.array(z.string().min(1)).min(1),
  normalizationMode: TargetedRevisionOperationNormalizationModeSchema,
  normalizationReason: z.string().min(1),
  semanticEquivalenceConfirmed: z.boolean(),
  approvedTargetCheckPassed: z.boolean(),
  allowedOperationCheckPassed: z.boolean(),
  sequenceIdentityCheckPassed: z.boolean()
}).strict();

export const TargetedRevisionRejectedOperationSchema = z.object({
  sourceOperationId: z.string().min(1),
  sourceOperationType: TargetedRevisionOperationTypeSchema.nullable(),
  sourceTargetIds: z.array(z.string()),
  errorCode: TargetedRevisionOperationContractErrorCodeSchema,
  reason: z.string().min(1)
}).strict();

export const TargetedRevisionNormalizationProtectedArtifactSchema = z.object({
  path: z.string().min(1),
  beforeSha256: Sha256Schema,
  afterSha256: Sha256Schema,
  unchanged: z.literal(true)
}).strict();

export const TargetedRevisionOperationNormalizationSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  runId: z.string().min(1),
  mode: z.enum(['pipeline', 'contract_check']),
  generatedAt: z.string().min(1),
  rawProviderOutputPath: z.string().min(1),
  rawProviderOutputHash: Sha256Schema,
  approvalRecordPath: z.string().min(1),
  coverageReportPath: z.string().min(1),
  targetCoverageGraphPath: z.string().min(1),
  targetCoverageGraphHash: Sha256Schema,
  approvedTargetIds: z.array(z.string().min(1)).min(1),
  providerSchemaValid: z.boolean(),
  canonicalSchemaValid: z.boolean(),
  coveragePreflightPassed: z.boolean(),
  sourceOperationCount: z.number().int().nonnegative(),
  normalizedOperationCount: z.number().int().nonnegative(),
  normalizedOperations: z.array(NormalizedTargetedRevisionOperationSchema),
  operations: z.array(TargetedRevisionOperationNormalizationEntrySchema),
  rejectedOperations: z.array(TargetedRevisionRejectedOperationSchema),
  warnings: z.array(z.string()),
  semanticChangesIntroduced: z.literal(false),
  normalizationSucceeded: z.boolean(),
  protectedArtifacts: z.array(TargetedRevisionNormalizationProtectedArtifactSchema),
  codexInvoked: z.boolean(),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false),
  canonicalArtifactsMutated: z.literal(false)
}).strict().superRefine((report, context) => {
  if (report.normalizedOperationCount !== report.normalizedOperations.length) {
    context.addIssue({ code: 'custom', path: ['normalizedOperationCount'], message: 'normalizedOperationCount must match normalizedOperations length' });
  }
  if (report.normalizationSucceeded && (
    !report.providerSchemaValid || !report.canonicalSchemaValid ||
    report.rejectedOperations.length > 0 || report.normalizedOperations.length === 0
  )) {
    context.addIssue({ code: 'custom', path: ['normalizationSucceeded'], message: 'successful normalization requires valid provider/canonical schemas and no rejected operations' });
  }
  if (!report.normalizationSucceeded && report.rejectedOperations.length === 0) {
    context.addIssue({ code: 'custom', path: ['rejectedOperations'], message: 'failed normalization requires a rejected operation reason' });
  }
});

export type TargetedRevisionOperationContractErrorCode = z.infer<typeof TargetedRevisionOperationContractErrorCodeSchema>;
export type TargetedRevisionOperationNormalization = z.infer<typeof TargetedRevisionOperationNormalizationSchema>;
