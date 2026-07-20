import { z } from 'zod';

import { ArtifactStatusSchema, ArtifactTypeSchema, ReusePolicySchema } from './observability.js';

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const RunStatusSchema = z.enum(['running', 'success', 'failed', 'partial', 'blocked', 'completed', 'human_review_required', 'cancelled']);

export const RunErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().default(false),
  details: z.unknown().optional(),
  createdAt: z.string().optional()
});

export const LLMUsageRecordSchema = z.object({
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  totalTokens: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional()
});

export const PromptWrapperCallTypeSchema = z.enum(['exec_text', 'exec_json', 'health', 'smoke', 'repair', 'unknown']);
export const PromptAttributionModeSchema = z.enum(['direct', 'parent_child', 'inferred', 'unclassified']);
export const PromptAttributionConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const RunRedactionPolicySchema = z.object({
  savePromptInputs: z.boolean(),
  savePromptOutputs: z.boolean(),
  redactSecrets: z.boolean(),
  redactUserContent: z.boolean(),
  redactedFields: z.array(z.string()).default([])
});

export const LLMCallRecordSchema = z.object({
  promptCallId: z.string().optional(),
  promptId: z.string(),
  provider: z.string(),
  model: z.string(),
  transport: z.string().optional(),
  codexVersion: z.string().optional(),
  codexProfile: z.enum(['default', 'clean', 'debug']).optional(),
  sandbox: z.string().optional(),
  outputSchemaPath: z.string().optional(),
  rawOutputPath: z.string().optional(),
  finalOutputPath: z.string().optional(),
  parsedOutputPath: z.string().optional(),
  requestId: z.string().optional(),
  parentPromptCallId: z.string().optional(),
  parentPromptId: z.string().optional(),
  parentStage: z.string().optional(),
  parentRunId: z.string().optional(),
  wrapperCallType: PromptWrapperCallTypeSchema.optional(),
  attributionMode: PromptAttributionModeSchema.optional(),
  attributionConfidence: PromptAttributionConfidenceSchema.optional(),
  attributionReason: z.string().optional(),
  finishReason: z.string().optional(),
  mockScenario: z.string().optional(),
  status: z.enum(['succeeded', 'failed']).optional(),
  startedAt: z.string(),
  endedAt: z.string(),
  latencyMs: z.number().nonnegative(),
  promptInputBytes: z.number().int().nonnegative().optional(),
  contextBytes: z.number().int().nonnegative().optional(),
  schemaBytes: z.number().int().nonnegative().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
  rawJsonlBytes: z.number().int().nonnegative().optional(),
  inputArtifactPath: z.string().optional(),
  outputArtifactPath: z.string().optional(),
  inputHash: HashSchema.optional(),
  outputHash: HashSchema.optional(),
  redacted: z.boolean().default(false),
  redactionReason: z.string().optional(),
  jsonParsed: z.boolean().default(false),
  schemaName: z.string().optional(),
  schemaValid: z.boolean().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  errorType: z.string().optional(),
  tokenUsage: LLMUsageRecordSchema.optional(),
  estimatedCost: z.number().nonnegative().optional(),
  usage: LLMUsageRecordSchema.optional()
});

export const RunResolvedContextSchema = z.object({
  projectId: z.string(),
  chapterNumber: z.number().int().positive().optional(),
  requestedChapter: z.union([z.number().int().positive(), z.string()]).optional(),
  resolvedChapterNumber: z.number().int().positive().optional(),
  mode: z.enum([
    'normal',
    'dry_run',
    'draft',
    'commit',
    'resume',
    'conflict_repair',
    'recommit',
    'historical_recommit',
    'regenerate_stale',
    'audit',
    'browser',
    'codex'
  ]),
  latestCommittedChapterBefore: z.number().int().nonnegative().optional(),
  latestCommittedChapterAfter: z.number().int().nonnegative().optional(),
  queueStatusBefore: z.string().optional(),
  queueStatusAfter: z.string().optional()
});

export const RunStageRecordSchema = z.object({
  stage: z.string(),
  name: z.string(),
  status: z.enum(['started', 'completed', 'failed']),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  chapterNumber: z.number().int().positive().optional()
});

export const ArtifactLineageRecordSchema = z.object({
  artifactId: z.string(),
  artifactType: ArtifactTypeSchema,
  path: z.string(),
  chapterNumber: z.number().int().positive().optional(),
  phase: z.string(),
  action: z.enum(['generated', 'reused', 'archived', 'validated', 'invalid', 'skipped']),
  runId: z.string(),
  stage: z.string().optional(),
  sha256: HashSchema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  schemaName: z.string().optional(),
  schemaValid: z.boolean().optional(),
  sourceArtifactIds: z.array(z.string()).default([]),
  sourcePaths: z.array(z.string()).default([]),
  derivedFrom: z.array(z.string()).default([]),
  archivedTo: z.string().optional(),
  archiveManifestPath: z.string().optional(),
  status: ArtifactStatusSchema,
  provenanceNote: z.string().optional()
});

export const QueueTransitionRecordSchema = z.object({
  transitionId: z.string(),
  chapterNumber: z.number().int().positive(),
  beforeStatus: z.string(),
  afterStatus: z.string(),
  beforeStage: z.string(),
  afterStage: z.string(),
  reason: z.string(),
  runId: z.string(),
  timestamp: z.string(),
  relatedArtifactPath: z.string().optional()
});

export const StateMutationRecordSchema = z.object({
  mutationId: z.string(),
  mutationType: z.enum(['apply_canon_patch', 'recommit_patch', 'historical_rebase', 'regenerate_stale_commit', 'rollback', 'codex_controlled_commit']),
  chapterNumber: z.number().int().positive().optional(),
  patchPath: z.string().optional(),
  beforeSnapshotId: z.string().optional(),
  afterSnapshotId: z.string().optional(),
  beforeStateHash: HashSchema.optional(),
  afterStateHash: HashSchema.optional(),
  latestCommittedChapterBefore: z.number().int().nonnegative().optional(),
  latestCommittedChapterAfter: z.number().int().nonnegative().optional(),
  conflictCheckPassed: z.boolean().optional(),
  schemaValidationPassed: z.boolean().optional(),
  applied: z.boolean(),
  blockedReason: z.string().optional(),
  stateDiffPath: z.string().optional()
});

export const SnapshotRunRecordSchema = z.object({
  snapshotId: z.string(),
  path: z.string(),
  reason: z.string().optional(),
  chapterNumber: z.number().int().positive().optional(),
  stateHash: HashSchema.optional()
});

export const ArchiveRunRecordSchema = z.object({
  archiveId: z.string().optional(),
  archiveManifestPath: z.string(),
  chapterNumber: z.number().int().positive().optional(),
  archivedArtifactCount: z.number().int().nonnegative().default(0),
  reason: z.string().optional()
});

export const ReusePolicyRunRecordSchema = z.object({
  reportPath: z.string().optional(),
  chapterNumber: z.number().int().positive().optional(),
  requestedPolicy: ReusePolicySchema,
  effectivePolicy: ReusePolicySchema,
  downgradeReason: z.string().optional()
});

export const RunEventTypeSchema = z.enum([
  'RUN_STARTED',
  'RUN_COMPLETED',
  'RUN_FAILED',
  'STAGE_STARTED',
  'STAGE_COMPLETED',
  'STAGE_FAILED',
  'PROMPT_CALL_STARTED',
  'PROMPT_CALL_COMPLETED',
  'PROMPT_CALL_FAILED',
  'ARTIFACT_GENERATED',
  'ARTIFACT_REUSED',
  'ARTIFACT_ARCHIVED',
  'ARTIFACT_VALIDATED',
  'ARTIFACT_INVALID',
  'QUEUE_TRANSITION',
  'STATE_MUTATION_PLANNED',
  'STATE_MUTATION_APPLIED',
  'STATE_MUTATION_BLOCKED',
  'SNAPSHOT_CREATED',
  'CONFLICT_DETECTED',
  'CONFLICT_REPAIR_STARTED',
  'CONFLICT_REPAIR_COMPLETED',
  'RECOMMIT_PREVIEW_CREATED',
  'RECOMMIT_APPLIED',
  'HISTORICAL_REBASE_STARTED',
  'HISTORICAL_REBASE_APPLIED',
  'DOWNSTREAM_INVALIDATED',
  'REGENERATION_PLAN_CREATED',
  'REUSE_POLICY_EVALUATED',
  'PROVENANCE_COMPACTED',
  'CODEX_STATUS_CHECKED',
  'CODEX_EXEC_STARTED',
  'CODEX_EXEC_COMPLETED',
  'CODEX_EXEC_FAILED',
  'CODEX_PROCESS_SPAWN_STARTED',
  'CODEX_PROCESS_SPAWNED',
  'CODEX_STDIN_WRITTEN',
  'CODEX_FIRST_JSONL_EVENT',
  'CODEX_FINAL_MESSAGE_SEEN',
  'CODEX_PROCESS_EXITED',
  'CODEX_ARTIFACT_WRITE_STARTED',
  'CODEX_ARTIFACT_WRITE_COMPLETED',
  'CODEX_PARSE_STARTED',
  'CODEX_PARSE_COMPLETED',
  'CODEX_SCHEMA_VALIDATE_STARTED',
  'CODEX_SCHEMA_VALIDATE_COMPLETED',
  'CODEX_PREVIEW_SUBSTAGE_STARTED',
  'CODEX_PREVIEW_SUBSTAGE_COMPLETED',
  'CODEX_PREVIEW_SUBSTAGE_FAILED',
  'CODEX_PREVIEW_COMPLETENESS_REPORTED',
  'CODEX_PREVIEW_FAILURE_REPORTED',
  'CODEX_COMMIT_PREVIEW_CREATED',
  'CODEX_CANDIDATE_PREVIEW_CREATED',
  'CODEX_CANDIDATE_COMMIT_REVIEW_CREATED',
  'CODEX_COMMIT_APPROVAL_RECORDED',
  'ERROR_RECORDED'
]);

export const RunEventSchema = z.object({
  eventId: z.string(),
  runId: z.string(),
  projectId: z.string(),
  timestamp: z.string(),
  eventType: RunEventTypeSchema,
  stage: z.string().optional(),
  chapterNumber: z.number().int().positive().optional(),
  payload: UnknownRecordSchema,
  relatedArtifactPaths: z.array(z.string()).default([]),
  severity: z.enum(['info', 'warning', 'error', 'critical'])
});

export const RunSummarySchema = z.object({
  generatedArtifactCount: z.number().int().nonnegative(),
  reusedArtifactCount: z.number().int().nonnegative(),
  archivedArtifactCount: z.number().int().nonnegative(),
  promptCallCount: z.number().int().nonnegative(),
  queueTransitionCount: z.number().int().nonnegative(),
  stateMutationCount: z.number().int().nonnegative(),
  snapshotCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative()
});

export const RunManifestV2Schema = z.object({
  schemaVersion: z.literal('2'),
  runId: z.string(),
  projectId: z.string(),
  command: z.string(),
  args: UnknownRecordSchema.default({}),
  argv: z.array(z.string()),
  cwd: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  status: RunStatusSchema,
  packageVersion: z.string(),
  nodeVersion: z.string(),
  provider: z.string().optional(),
  mockScenario: z.string().optional(),
  redactionPolicy: RunRedactionPolicySchema,
  resolvedContext: RunResolvedContextSchema,
  stages: z.array(RunStageRecordSchema).default([]),
  promptCalls: z.array(LLMCallRecordSchema).default([]),
  llmCalls: z.array(LLMCallRecordSchema).default([]),
  artifacts: z.array(ArtifactLineageRecordSchema).default([]),
  queueTransitions: z.array(QueueTransitionRecordSchema).default([]),
  stateMutations: z.array(StateMutationRecordSchema).default([]),
  snapshots: z.array(SnapshotRunRecordSchema).default([]),
  archives: z.array(ArchiveRunRecordSchema).default([]),
  conflicts: z.array(UnknownRecordSchema).default([]),
  repairs: z.array(UnknownRecordSchema).default([]),
  recommits: z.array(UnknownRecordSchema).default([]),
  historicalRebases: z.array(UnknownRecordSchema).default([]),
  reusePolicies: z.array(ReusePolicyRunRecordSchema).default([]),
  errors: z.array(RunErrorSchema).default([]),
  auditRefs: z.array(UnknownRecordSchema).default([]),
  summary: RunSummarySchema
});

export const LegacyRunManifestSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  command: z.string(),
  args: UnknownRecordSchema.default({}),
  status: RunStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().optional(),
  artifacts: z.array(z.string()).default([]),
  llmCalls: z.array(LLMCallRecordSchema).default([]),
  errors: z.array(RunErrorSchema).default([])
});

export const RunManifestSchema = z.union([RunManifestV2Schema, LegacyRunManifestSchema]);

export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunError = z.infer<typeof RunErrorSchema>;
export type LLMUsageRecord = z.infer<typeof LLMUsageRecordSchema>;
export type LLMCallRecord = z.infer<typeof LLMCallRecordSchema>;
export type RunRedactionPolicy = z.infer<typeof RunRedactionPolicySchema>;
export type RunResolvedContext = z.infer<typeof RunResolvedContextSchema>;
export type RunStageRecord = z.infer<typeof RunStageRecordSchema>;
export type ArtifactLineageRecord = z.infer<typeof ArtifactLineageRecordSchema>;
export type QueueTransitionRecord = z.infer<typeof QueueTransitionRecordSchema>;
export type StateMutationRecord = z.infer<typeof StateMutationRecordSchema>;
export type SnapshotRunRecord = z.infer<typeof SnapshotRunRecordSchema>;
export type ArchiveRunRecord = z.infer<typeof ArchiveRunRecordSchema>;
export type ReusePolicyRunRecord = z.infer<typeof ReusePolicyRunRecordSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = z.infer<typeof RunEventTypeSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type RunManifestV2 = z.infer<typeof RunManifestV2Schema>;
export type LegacyRunManifest = z.infer<typeof LegacyRunManifestSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
