import { z } from 'zod';

import { DiagnosticsNormalizationWarningSchema } from './diagnostics.js';

export const CodexErrorTypeSchema = z.enum([
  'CODEX_BINARY_MISSING',
  'CODEX_NOT_LOGGED_IN',
  'CODEX_DOCTOR_UNHEALTHY_NON_BLOCKING',
  'CODEX_EXEC_FAILED',
  'CODEX_PREVIEW_INCOMPLETE',
  'CODEX_PREVIEW_FINAL_MISSING',
  'CODEX_PREVIEW_DIAGNOSTICS_MISSING',
  'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL',
  'CODEX_PREVIEW_PATCH_PROPOSAL_MISSING',
  'CODEX_PREVIEW_PATCH_SCHEMA_INVALID',
  'CODEX_PREVIEW_PATCH_NORMALIZATION_FAILED',
  'CODEX_PREVIEW_CONFLICT_DETECTED',
  'CODEX_PREVIEW_STATE_DIFF_MISSING',
  'CODEX_PREVIEW_STATE_HASH_MISSING',
  'CODEX_PREVIEW_RUN_MANIFEST_MISSING',
  'CODEX_PREVIEW_EVENT_LOG_MISSING',
  'CODEX_HUNG',
  'CODEX_OUTPUT_MISSING',
  'CODEX_NO_FINAL_MESSAGE',
  'CODEX_JSONL_STREAM_INCOMPLETE',
  'CODEX_STALLED_AFTER_EVENTS',
  'CODEX_INVALID_JSON',
  'CODEX_SCHEMA_VALIDATION_FAILED',
  'CODEX_SCHEMA_TOO_COMPLEX',
  'CODEX_PROMPT_TOO_LARGE',
  'CODEX_REPAIR_FAILED',
  'CODEX_REPAIR_LOOP_EXHAUSTED',
  'CODEX_TIMEOUT',
  'CODEX_STAGE_BUDGET_EXCEEDED',
  'CODEX_TOTAL_RUNTIME_EXCEEDED',
  'CODEX_PLUGIN_WARNING',
  'CODEX_SKILL_MANIFEST_WARNING',
  'CODEX_UNKNOWN_ERROR'
]);

export const CodexJsonFailureAttemptSchema = z.object({
  attemptNumber: z.number().int().positive(),
  runId: z.string().optional(),
  errorType: CodexErrorTypeSchema,
  message: z.string(),
  rawOutputPath: z.string().optional(),
  finalOutputPath: z.string().optional()
});

export const CodexJsonFailureReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  runId: z.string(),
  promptId: z.string(),
  provider: z.literal('codex-text'),
  generatedAt: z.string(),
  errorType: CodexErrorTypeSchema,
  errorMessage: z.string(),
  codexProfile: z.enum(['default', 'clean', 'debug']),
  outputSchemaPath: z.string().optional(),
  failureRoot: z.string(),
  failedPromptPath: z.string().optional(),
  rawOutputPath: z.string().optional(),
  finalOutputPath: z.string().optional(),
  parseErrorPath: z.string().optional(),
  schemaErrorPath: z.string().optional(),
  stderrExcerpt: z.string().default(''),
  attempts: z.array(CodexJsonFailureAttemptSchema).default([]),
  repairAttempts: z.array(CodexJsonFailureAttemptSchema).default([]),
  storyStateMutated: z.literal(false),
  redacted: z.literal(true)
});

export const CodexPatchFailureReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  runId: z.string(),
  chapterNumber: z.number().int().positive(),
  stage: z.string(),
  provider: z.literal('codex-text'),
  codexProfile: z.enum(['default', 'clean', 'debug']),
  command: z.string(),
  errorCode: z.string(),
  providerErrorType: CodexErrorTypeSchema.optional(),
  stderrExcerptRedacted: z.string().default(''),
  rawOutputPath: z.string().optional(),
  finalOutputPath: z.string().optional(),
  parsedOutputPath: z.string().optional(),
  schemaPath: z.string().optional(),
  schemaErrors: z.array(z.string()).default([]),
  normalizationErrors: z.array(z.string()).default([]),
  conflictReportPath: z.string().optional(),
  stateDiffPath: z.string().optional(),
  suggestedFixes: z.array(z.string()),
  suggestedRetryCommand: z.string(),
  generatedAt: z.string(),
  storyStateMutated: z.literal(false),
  redacted: z.literal(true)
});

export const CodexPreviewArtifactCheckSchema = z.object({
  artifactType: z.string(),
  expectedPath: z.string(),
  exists: z.boolean(),
  schemaValid: z.boolean(),
  reason: z.string(),
  requiredForPreview: z.boolean(),
  blocking: z.boolean()
});

export const CodexPreviewSubStageNameSchema = z.enum([
  'draft_ready_check',
  'diagnostics',
  'revision_plan',
  'final_generation_or_assembly',
  'quality_report',
  'canon_patch_proposal',
  'patch_normalization',
  'schema_validation',
  'conflict_check',
  'state_diff_preview',
  'completeness_check'
]);

export const CodexPreviewSubStageTimelineItemSchema = z.object({
  name: CodexPreviewSubStageNameSchema,
  status: z.enum(['started', 'completed', 'failed', 'skipped']),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  artifactPaths: z.array(z.string()).default([]),
  errorCode: CodexErrorTypeSchema.optional(),
  message: z.string().optional()
});

export const CodexPreviewCompletenessReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string(),
  provider: z.literal('codex-text'),
  previewRunId: z.string(),
  previewStage: z.string(),
  complete: z.boolean(),
  missingArtifacts: z.array(CodexPreviewArtifactCheckSchema),
  invalidArtifacts: z.array(CodexPreviewArtifactCheckSchema),
  blockingReasons: z.array(CodexErrorTypeSchema),
  warnings: z.array(z.string()),
  suggestedRetryCommand: z.string(),
  suggestedInspectCommands: z.array(z.string()),
  subStageTimeline: z.array(CodexPreviewSubStageTimelineItemSchema).default([]),
  queueStatusBefore: z.string().optional(),
  queueStatusAfter: z.string().optional(),
  latestCommittedChapterBefore: z.number().int().nonnegative(),
  latestCommittedChapterAfter: z.number().int().nonnegative(),
  storyStateMutated: z.boolean(),
  previewStateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  previewStateHashRecorded: z.boolean(),
  conflictCheckPassed: z.boolean().optional(),
  failureReportPath: z.string().optional(),
  redacted: z.literal(true)
});

export const CodexPreviewFailureReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  runId: z.string(),
  chapterNumber: z.number().int().positive(),
  provider: z.literal('codex-text'),
  generatedAt: z.string(),
  failureStage: z.string(),
  errorCode: CodexErrorTypeSchema,
  previewCompletenessReportPath: z.string(),
  failedSubStage: CodexPreviewSubStageNameSchema.optional(),
  lastSuccessfulSubStage: CodexPreviewSubStageNameSchema.optional(),
  rawOutputPaths: z.array(z.string()),
  finalOutputPath: z.string().optional(),
  parsedOutputPaths: z.array(z.string()),
  schemaErrorPaths: z.array(z.string()),
  normalizationErrorPaths: z.array(z.string()),
  conflictReportPath: z.string().optional(),
  stateDiffPath: z.string().optional(),
  queueStatusBefore: z.string().optional(),
  queueStatusAfter: z.string().optional(),
  latestCommittedChapterBefore: z.number().int().nonnegative(),
  latestCommittedChapterAfter: z.number().int().nonnegative(),
  storyStateMutated: z.boolean(),
  suggestedRetryCommand: z.string(),
  suggestedResumeCommand: z.string(),
  suggestedInspectCommands: z.array(z.string()),
  redacted: z.literal(true)
});

export const CodexDiagnosticsHardCheckNameSchema = z.enum([
  'timeline_consistency',
  'character_knowledge_consistency',
  'world_rule_consistency',
  'no_unplanned_reveal'
]);

export const CodexDiagnosticsFailureClassificationSchema = z.enum([
  'true_positive_draft_issue',
  'diagnostics_false_positive',
  'diagnostics_context_missing',
  'draft_context_missing',
  'schema_or_normalizer_issue',
  'insufficient_evidence',
  'unknown'
]);

export const DiagnosticsContextModeSchema = z.enum(['baseline', 'enhanced']);

export const CodexDiagnosticsLikelyCauseSchema = z.enum([
  'timeline_conflict',
  'character_knowledge_conflict',
  'world_rule_conflict',
  'unplanned_reveal',
  'missing_chapter_goal',
  'weak_continuity',
  'reader_state_mismatch',
  'canon_patch_risk',
  'diagnostics_prompt_overstrict',
  'diagnostics_missing_context',
  'unknown'
]);

export const CodexDiagnosticsEvidenceSchema = z.object({
  source: z.enum(['draft', 'plan', 'mission', 'story_state', 'reader_state', 'character_states', 'narrative_debts', 'foreshadowing', 'timeline']),
  path: z.string(),
  excerpt: z.string(),
  relatedIds: z.array(z.string()).default([]),
  confidence: z.enum(['low', 'medium', 'high'])
});

export const CodexDiagnosticsHardFailureAnalysisSchema = z.object({
  checkName: CodexDiagnosticsHardCheckNameSchema,
  failed: z.literal(true),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  diagnosticsMessage: z.string(),
  evidenceFromDraft: z.array(CodexDiagnosticsEvidenceSchema),
  evidenceFromPlan: z.array(CodexDiagnosticsEvidenceSchema),
  evidenceFromStoryState: z.array(CodexDiagnosticsEvidenceSchema),
  missingEvidence: z.array(z.string()),
  likelyCause: CodexDiagnosticsLikelyCauseSchema,
  classification: CodexDiagnosticsFailureClassificationSchema
});

export const CodexDiagnosticsSoftScoreSummarySchema = z.object({
  averageScore: z.number().min(0).max(10),
  minScore: z.number().min(0).max(10),
  maxScore: z.number().min(0).max(10),
  scores: z.record(z.string(), z.number().min(0).max(10))
});

export const CodexDiagnosticsContextAvailabilityItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  present: z.boolean(),
  includedInDiagnosticsPrompt: z.boolean(),
  bytes: z.number().int().nonnegative(),
  note: z.string()
});

export const CodexDiagnosticsContextAvailabilitySchema = z.object({
  requiredArtifacts: z.array(CodexDiagnosticsContextAvailabilityItemSchema),
  missingRequiredArtifacts: z.array(z.string()),
  contextTruncated: z.boolean(),
  possibleContextLoss: z.array(z.string())
});

export const CodexDiagnosticsFalsePositiveRiskSchema = z.object({
  level: z.enum(['low', 'medium', 'high']),
  reasons: z.array(z.string())
});

export const CodexDiagnosticsHardFailAnalysisSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string(),
  contextMode: DiagnosticsContextModeSchema.default('baseline'),
  contextFixReportPath: z.string().optional(),
  classificationChanged: z.boolean().default(false),
  hardFailuresBefore: z.array(CodexDiagnosticsHardFailureAnalysisSchema).default([]),
  hardFailuresAfter: z.array(CodexDiagnosticsHardFailureAnalysisSchema).default([]),
  evidenceImprovementSummary: z.string().default('No enhanced diagnostics context comparison was available.'),
  remainingInsufficientEvidence: z.array(z.string()).default([]),
  sourceDiagnosticsPath: z.string(),
  sourceDraftPath: z.string(),
  sourceFinalPath: z.string(),
  sourceMissionPath: z.string(),
  sourceSelectedPlanPath: z.string(),
  sourceStoryStatePath: z.string(),
  sourceReaderStateSummary: z.string(),
  hardFailures: z.array(CodexDiagnosticsHardFailureAnalysisSchema),
  softScoreSummary: CodexDiagnosticsSoftScoreSummarySchema,
  suspectedRootCauses: z.array(CodexDiagnosticsLikelyCauseSchema),
  evidenceMap: z.array(CodexDiagnosticsEvidenceSchema),
  contextAvailability: CodexDiagnosticsContextAvailabilitySchema,
  falsePositiveRisk: CodexDiagnosticsFalsePositiveRiskSchema,
  recommendedFixes: z.array(z.string()),
  suggestedRetryCommand: z.string(),
  suggestedReviewCommand: z.string(),
  storyStateMutated: z.literal(false)
});

export const CodexDiagnosticsContextAuditArtifactSchema = z.object({
  name: z.string(),
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  reason: z.string()
});

export const CodexDiagnosticsContextAuditSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  diagnosticsPromptPath: z.string(),
  contextManifestPath: z.string(),
  includedArtifacts: z.array(CodexDiagnosticsContextAuditArtifactSchema),
  excludedArtifacts: z.array(CodexDiagnosticsContextAuditArtifactSchema),
  requiredArtifacts: z.array(z.string()),
  missingRequiredArtifacts: z.array(z.string()),
  contextBytes: z.number().int().nonnegative(),
  contextBudgetBytes: z.number().int().nonnegative(),
  contextTruncated: z.boolean(),
  possibleContextLoss: z.array(z.string()),
  generatedAt: z.string(),
  storyStateMutated: z.literal(false)
});

export const DiagnosticsContextManifestArtifactSchema = z.object({
  name: z.string(),
  path: z.string(),
  artifactType: z.string(),
  bytes: z.number().int().nonnegative(),
  included: z.boolean(),
  reason: z.string()
});

export const DiagnosticsContextManifestSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string(),
  mode: DiagnosticsContextModeSchema,
  includedArtifacts: z.array(DiagnosticsContextManifestArtifactSchema),
  excludedArtifacts: z.array(DiagnosticsContextManifestArtifactSchema),
  requiredArtifacts: z.array(z.string()),
  missingRequiredArtifacts: z.array(z.string()),
  contextBytes: z.number().int().nonnegative(),
  contextBudgetBytes: z.number().int().positive(),
  contextTruncated: z.boolean(),
  storyStateSummaryIncluded: z.boolean(),
  characterStatesIncluded: z.boolean(),
  timelineIncluded: z.boolean(),
  readerStateIncluded: z.boolean(),
  openDebtsIncluded: z.boolean(),
  unresolvedForeshadowingIncluded: z.boolean(),
  selectedPlanIncluded: z.boolean(),
  missionIncluded: z.boolean(),
  draftIncluded: z.boolean(),
  warnings: z.array(z.string()),
  storyStateMutated: z.literal(false)
});

export const CodexDiagnosticsBenchmarkSampleSchema = z.object({
  sampleId: z.string(),
  runId: z.string(),
  durationMs: z.number().int().nonnegative(),
  schemaValid: z.boolean(),
  hardChecks: z.record(z.string(), z.object({ passed: z.boolean(), message: z.string(), evidence: z.string().optional() })),
  averageScore: z.number().min(0).max(10),
  passed: z.boolean(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  rawOutputPath: z.string().default(''),
  finalOutputPath: z.string().default(''),
  parsedOutputPath: z.string().default(''),
  providerSchemaValid: z.boolean().default(false),
  normalizationSucceeded: z.boolean().default(false),
  internalSchemaValid: z.boolean().default(false),
  semanticConsistency: z.boolean().default(false),
  providerSchemaErrors: z.array(z.string()).default([]),
  parseErrors: z.array(z.string()).default([]),
  normalizationErrors: z.array(z.string()).default([]),
  internalSchemaErrors: z.array(z.string()).default([]),
  semanticContradictions: z.array(z.string()).default([]),
  normalizationReportPath: z.string().optional(),
  storyStateMutated: z.literal(false)
});

export const CodexDiagnosticsBenchmarkReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  sampleCount: z.number().int().positive(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  hardFailRate: z.number().min(0).max(1).optional(),
  totalSampleCount: z.number().int().positive().default(1),
  schemaValidSampleCount: z.number().int().nonnegative().default(0),
  schemaInvalidSampleCount: z.number().int().nonnegative().default(0),
  schemaInvalidRate: z.number().min(0).max(1).default(0),
  observedFailureCountAllSamples: z.number().int().nonnegative().default(0),
  observedFailureRateAllSamples: z.number().min(0).max(1).default(0),
  hardFailCountAmongSchemaValidSamples: z.number().int().nonnegative().default(0),
  hardFailRateAmongSchemaValidSamples: z.number().min(0).max(1).nullable().default(null),
  experimentValid: z.boolean().default(false),
  experimentInvalidReason: z.string().nullable().default(null),
  hardCheckResultsDistribution: z.record(z.string(), z.object({ passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative() })),
  averageScoreDistribution: z.object({
    min: z.number().min(0).max(10),
    max: z.number().min(0).max(10),
    mean: z.number().min(0).max(10)
  }),
  retryRate: z.number().min(0).max(1),
  repairRate: z.number().min(0).max(1),
  schemaValidRate: z.number().min(0).max(1),
  samples: z.array(CodexDiagnosticsBenchmarkSampleSchema),
  stableFailure: z.boolean(),
  likelyFalsePositive: z.boolean(),
  recommendation: z.string(),
  contextMode: DiagnosticsContextModeSchema.default('baseline'),
  diagnosticsContextManifestPath: z.string().optional(),
  contextFixReportPath: z.string().optional(),
  generatedAt: z.string(),
  storyStateMutated: z.literal(false)
});

export const CodexDiagnosticsContextFixHardCheckComparisonSchema = z.object({
  checkName: CodexDiagnosticsHardCheckNameSchema,
  baselineResult: z.string(),
  enhancedResult: z.string(),
  changed: z.boolean(),
  evidenceImproved: z.boolean(),
  classificationBefore: CodexDiagnosticsFailureClassificationSchema,
  classificationAfter: CodexDiagnosticsFailureClassificationSchema,
  notes: z.string()
});

export const CodexDiagnosticsContextFixReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string(),
  baselineBenchmarkPath: z.string(),
  enhancedBenchmarkPath: z.string(),
  baselineHardFailRate: z.number().min(0).max(1).optional(),
  enhancedHardFailRate: z.number().min(0).max(1).optional(),
  totalSampleCount: z.number().int().nonnegative().default(0),
  schemaValidSampleCount: z.number().int().nonnegative().default(0),
  schemaInvalidSampleCount: z.number().int().nonnegative().default(0),
  schemaInvalidRate: z.number().min(0).max(1).default(0),
  observedFailureCountAllSamples: z.number().int().nonnegative().default(0),
  observedFailureRateAllSamples: z.number().min(0).max(1).default(0),
  hardFailCountAmongSchemaValidSamples: z.number().int().nonnegative().default(0),
  hardFailRateAmongSchemaValidSamples: z.number().min(0).max(1).nullable().default(null),
  experimentValid: z.boolean().default(false),
  experimentInvalidReason: z.string().nullable().default(null),
  baselineHardFailRateAmongSchemaValidSamples: z.number().min(0).max(1).nullable().default(null),
  enhancedHardFailRateAmongSchemaValidSamples: z.number().min(0).max(1).nullable().default(null),
  baselineFalsePositiveRisk: z.enum(['low', 'medium', 'high']),
  enhancedFalsePositiveRisk: z.enum(['low', 'medium', 'high']),
  baselineInsufficientEvidenceCount: z.number().int().nonnegative(),
  enhancedInsufficientEvidenceCount: z.number().int().nonnegative(),
  hardCheckComparison: z.array(CodexDiagnosticsContextFixHardCheckComparisonSchema),
  contextManifestPath: z.string(),
  conclusion: z.enum([
    'diagnostics_schema_noncompliance',
    'insufficient_valid_samples',
    'context_fix_helped',
    'context_fix_no_change',
    'diagnostics_context_fix_helped',
    'diagnostics_context_fix_no_change',
    'true_positive_draft_issue_confirmed',
    'diagnostics_prompt_overstrict',
    'diagnostics_prompt_still_overstrict',
    'requires_revision',
    'requires_human_review'
  ]),
  recommendedNextStep: z.string(),
  storyStateMutated: z.literal(false)
});

export const DiagnosticsSchemaFailureLayerSchema = z.enum([
  'codex_final_output',
  'provider_json_schema',
  'json_parser',
  'provider_normalizer',
  'internal_zod_schema',
  'cross_layer_schema_drift',
  'unknown'
]);

export const DiagnosticsSchemaViolationSampleSchema = z.object({
  sampleId: z.string(),
  runId: z.string(),
  rawOutputPath: z.string(),
  finalOutputPath: z.string(),
  parsedOutputPath: z.string(),
  providerSchemaValid: z.boolean(),
  normalizationSucceeded: z.boolean(),
  internalSchemaValid: z.boolean(),
  providerSchemaErrors: z.array(z.string()),
  parseErrors: z.array(z.string()),
  normalizationErrors: z.array(z.string()),
  internalSchemaErrors: z.array(z.string()),
  unexpectedProperties: z.array(z.string()),
  missingRequiredFields: z.array(z.string()),
  invalidEnumValues: z.array(z.string()),
  invalidTypes: z.array(z.string()),
  semanticContradictions: z.array(z.string())
});

export const DiagnosticsSchemaViolationSummarySchema = z.object({
  providerSchemaViolationCount: z.number().int().nonnegative(),
  parseErrorCount: z.number().int().nonnegative(),
  normalizationErrorCount: z.number().int().nonnegative(),
  internalSchemaErrorCount: z.number().int().nonnegative(),
  semanticContradictionCount: z.number().int().nonnegative(),
  missingRequiredFieldCount: z.number().int().nonnegative(),
  unexpectedPropertyCount: z.number().int().nonnegative(),
  invalidEnumValueCount: z.number().int().nonnegative(),
  invalidTypeCount: z.number().int().nonnegative()
});

export const DiagnosticsSchemaComplianceReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  contextMode: DiagnosticsContextModeSchema,
  generatedAt: z.string(),
  providerSchemaPath: z.string(),
  internalSchemaName: z.literal('DiagnosticsReportSchema'),
  sampleCount: z.number().int().positive(),
  validSampleCount: z.number().int().nonnegative(),
  invalidSampleCount: z.number().int().nonnegative(),
  violationsBySample: z.array(DiagnosticsSchemaViolationSampleSchema),
  violationSummary: DiagnosticsSchemaViolationSummarySchema,
  likelyFailureLayer: DiagnosticsSchemaFailureLayerSchema,
  recommendedFixes: z.array(z.string()),
  storyStateMutated: z.literal(false)
});

export const DiagnosticsNormalizationReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  contextMode: DiagnosticsContextModeSchema,
  sampleId: z.string(),
  runId: z.string(),
  parsedOutputPath: z.string(),
  generatedAt: z.string(),
  normalizationSucceeded: z.boolean(),
  internalSchemaValid: z.boolean(),
  normalizationWarnings: z.array(DiagnosticsNormalizationWarningSchema),
  normalizationErrors: z.array(z.string()),
  internalSchemaErrors: z.array(z.string()),
  semanticContradictions: z.array(z.string()),
  storyStateMutated: z.literal(false)
});

export const CodexDiagnosticsSchemaBenchmarkSampleSchema = z.object({
  sampleId: z.string(),
  runId: z.string(),
  durationMs: z.number().int().nonnegative(),
  rawOutputPath: z.string(),
  finalOutputPath: z.string(),
  parsedOutputPath: z.string(),
  normalizationReportPath: z.string(),
  parseValid: z.boolean(),
  providerSchemaValid: z.boolean(),
  normalizationSucceeded: z.boolean(),
  internalSchemaValid: z.boolean(),
  semanticConsistent: z.boolean(),
  retryCount: z.number().int().nonnegative(),
  repairUsed: z.boolean(),
  errors: z.array(z.string()),
  storyStateMutated: z.literal(false)
});

export const CodexDiagnosticsSchemaBenchmarkReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  contextMode: DiagnosticsContextModeSchema,
  generatedAt: z.string(),
  providerSchemaPath: z.string(),
  internalSchemaName: z.literal('DiagnosticsReportSchema'),
  diagnosticsContextManifestPath: z.string(),
  complianceReportPath: z.string(),
  sampleCount: z.number().int().positive(),
  parseValidRate: z.number().min(0).max(1),
  providerSchemaValidRate: z.number().min(0).max(1),
  normalizationSuccessRate: z.number().min(0).max(1),
  internalSchemaValidRate: z.number().min(0).max(1),
  semanticConsistencyRate: z.number().min(0).max(1),
  repairRate: z.number().min(0).max(1),
  retryRate: z.number().min(0).max(1),
  samples: z.array(CodexDiagnosticsSchemaBenchmarkSampleSchema),
  releaseGatePassed: z.boolean(),
  releaseGateReasons: z.array(z.string()),
  canonicalDiagnosticsMutated: z.literal(false),
  storyStateMutated: z.literal(false)
});

export const RevisionOpportunityTargetSchema = z.object({
  target: z.string(),
  reason: z.string(),
  affectedHardChecks: z.array(CodexDiagnosticsHardCheckNameSchema),
  suggestedChange: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high'])
});

export const RevisionOpportunityReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  hardFailures: z.array(CodexDiagnosticsHardFailureAnalysisSchema),
  proposedRevisionTargets: z.array(RevisionOpportunityTargetSchema),
  canRepairByLocalInstruction: z.boolean(),
  requiresRegenerateDraft: z.boolean(),
  requiresHumanReview: z.boolean(),
  suggestedRevisionPromptAddendum: z.string(),
  suggestedRetryCommand: z.string(),
  generatedAt: z.string(),
  storyStateMutated: z.literal(false)
});

const QualityScoreSchema = z.number().min(0).max(10);
const StageMetricMapSchema = z.record(z.string(), z.number().int().nonnegative());
const CodexContextModeSchema = z.enum(['compact', 'balanced', 'rich']);

export const CodexQualityStructureSchema = z.object({
  hasTitle: z.boolean(),
  sceneCount: z.number().int().nonnegative(),
  hasOpeningHook: z.boolean(),
  hasEndingHook: z.boolean(),
  hasClearConflict: z.boolean(),
  hasInformationDelta: z.boolean(),
  hasProtagonistDecision: z.boolean(),
  hasNextChapterHook: z.boolean()
});

export const CodexQualityContinuitySchema = z.object({
  referencesPreviousChapter: z.boolean(),
  referencesOpenDebt: z.boolean(),
  advancesAtLeastOneDebt: z.boolean(),
  advancesOrReinforcesForeshadowing: z.boolean(),
  updatesReaderExpectation: z.boolean(),
  preservesCharacterGoalContinuity: z.boolean()
});

export const CodexQualityStyleSchema = z.object({
  repeatedParagraphRisk: z.boolean(),
  placeholderRisk: z.boolean(),
  forbiddenPhraseRisk: z.boolean(),
  expositionOverloadRisk: z.boolean(),
  dialogueBalanceEstimate: z.enum(['low', 'balanced', 'high', 'unknown'])
});

export const CodexQualityPatchConsistencySchema = z.object({
  canonPatchMatchesFinal: z.boolean(),
  timelineMatchesFinal: z.boolean(),
  characterChangesSupportedByText: z.boolean(),
  debtsSupportedByText: z.boolean(),
  foreshadowingSupportedByText: z.boolean()
});

const CodexChapterQualityReportBaseSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  provider: z.literal('codex-text'),
  generatedAt: z.string(),
  finalChapterPath: z.string(),
  canonPatchPath: z.string().optional(),
  diagnosticsPath: z.string().optional(),
  hasTitle: z.boolean(),
  approximateWordCount: z.number().int().nonnegative(),
  sceneCount: z.number().int().nonnegative(),
  hasOpeningHook: z.boolean(),
  hasEndingHook: z.boolean(),
  protagonistPresent: z.boolean(),
  conflictPresent: z.boolean(),
  informationDeltaPresent: z.boolean(),
  styleGuideFollowed: z.boolean(),
  repeatedParagraphRisk: z.boolean(),
  unresolvedPlaceholders: z.array(z.string()).default([]),
  forbiddenPhrases: z.array(z.string()).default([]),
  jsonArtifactsConsistent: z.boolean(),
  canonPatchMatchesFinal: z.boolean(),
  diagnosticsHardChecksPassed: z.boolean(),
  readerQuestionGenerated: z.boolean(),
  nextChapterHook: z.boolean(),
  softScores: z.object({
    readability: QualityScoreSchema,
    narrativeMomentum: QualityScoreSchema,
    characterConsistency: QualityScoreSchema,
    tension: QualityScoreSchema,
    genreFit: QualityScoreSchema,
    proseQuality: QualityScoreSchema,
    chapterHook: QualityScoreSchema,
    emotionalImpact: QualityScoreSchema.optional(),
    hookStrength: QualityScoreSchema.optional(),
    continuityStrength: QualityScoreSchema.optional()
  }),
  structure: CodexQualityStructureSchema,
  continuity: CodexQualityContinuitySchema,
  style: CodexQualityStyleSchema,
  patchConsistency: CodexQualityPatchConsistencySchema,
  criticalIssues: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  normalizationWarnings: z.array(DiagnosticsNormalizationWarningSchema).default([]),
  blocking: z.boolean(),
  storyStateMutated: z.literal(false)
});

export const CodexChapterQualityReportSchema = z.preprocess((value) => {
  if (!isRecord(value)) return value;
  return {
    ...value,
    structure: value.structure ?? {
      hasTitle: asBoolean(value.hasTitle),
      sceneCount: asNonnegativeInteger(value.sceneCount),
      hasOpeningHook: asBoolean(value.hasOpeningHook),
      hasEndingHook: asBoolean(value.hasEndingHook),
      hasClearConflict: asBoolean(value.conflictPresent),
      hasInformationDelta: asBoolean(value.informationDeltaPresent),
      hasProtagonistDecision: asBoolean(value.protagonistPresent),
      hasNextChapterHook: asBoolean(value.nextChapterHook)
    },
    continuity: value.continuity ?? {
      referencesPreviousChapter: false,
      referencesOpenDebt: false,
      advancesAtLeastOneDebt: false,
      advancesOrReinforcesForeshadowing: false,
      updatesReaderExpectation: asBoolean(value.readerQuestionGenerated),
      preservesCharacterGoalContinuity: asBoolean(value.protagonistPresent)
    },
    style: value.style ?? {
      repeatedParagraphRisk: asBoolean(value.repeatedParagraphRisk),
      placeholderRisk: asStringArray(value.unresolvedPlaceholders).length > 0,
      forbiddenPhraseRisk: asStringArray(value.forbiddenPhrases).length > 0,
      expositionOverloadRisk: false,
      dialogueBalanceEstimate: 'unknown'
    },
    patchConsistency: value.patchConsistency ?? {
      canonPatchMatchesFinal: asBoolean(value.canonPatchMatchesFinal),
      timelineMatchesFinal: asBoolean(value.jsonArtifactsConsistent),
      characterChangesSupportedByText: asBoolean(value.canonPatchMatchesFinal),
      debtsSupportedByText: asBoolean(value.canonPatchMatchesFinal),
      foreshadowingSupportedByText: asBoolean(value.canonPatchMatchesFinal)
    }
  };
}, CodexChapterQualityReportBaseSchema);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNonnegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export const CodexSingleChapterSmokeStageSchema = z.object({
  stageName: z.string(),
  command: z.string(),
  status: z.enum(['success', 'failed', 'skipped']),
  runId: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().nonnegative(),
  artifacts: z.array(z.string()).default([]),
  errorCode: z.string().optional(),
  failureReportPath: z.string().optional()
});

export const CodexSingleChapterSmokeReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  codexStatus: z.record(z.string(), z.unknown()),
  stages: z.array(CodexSingleChapterSmokeStageSchema),
  previewRunId: z.string().optional(),
  confirmedRunId: z.string().optional(),
  finalChapterPath: z.string().optional(),
  canonPatchPath: z.string().optional(),
  stateDiffPath: z.string().optional(),
  approvalRecordPath: z.string().optional(),
  commitReportPath: z.string().optional(),
  beforeSnapshotId: z.string().optional(),
  afterSnapshotId: z.string().optional(),
  latestCommittedChapterBefore: z.number().int().nonnegative(),
  latestCommittedChapterAfter: z.number().int().nonnegative(),
  validatePassed: z.boolean(),
  auditPassed: z.boolean(),
  qualityReportPath: z.string().optional(),
  failureReportPath: z.string().optional(),
  success: z.boolean()
});

export const CodexMultiChapterPilotChapterSchema = z.object({
  chapterNumber: z.number().int().positive(),
  draftRunId: z.string().optional(),
  previewRunId: z.string().optional(),
  confirmedRunId: z.string().optional(),
  finalPath: z.string().optional(),
  canonPatchPath: z.string().optional(),
  qualityReportPath: z.string().optional(),
  stateDiffPath: z.string().optional(),
  approvalRecordPath: z.string().optional(),
  commitReportPath: z.string().optional(),
  beforeSnapshotId: z.string().optional(),
  afterSnapshotId: z.string().optional(),
  latestCommittedChapterBefore: z.number().int().nonnegative(),
  latestCommittedChapterAfter: z.number().int().nonnegative(),
  previewStateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  confirmedStateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  previewReusedForConfirm: z.boolean().default(false),
  qualityCriticalIssues: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});

export const CodexMultiChapterPilotReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  targetChapterCount: z.number().int().positive(),
  completedChapterCount: z.number().int().nonnegative(),
  latestCommittedChapterBefore: z.number().int().nonnegative(),
  latestCommittedChapterAfter: z.number().int().nonnegative(),
  success: z.boolean(),
  codexStatus: z.record(z.string(), z.unknown()),
  chapters: z.array(CodexMultiChapterPilotChapterSchema),
  validatePassed: z.boolean(),
  auditPassed: z.boolean(),
  crossChapterDriftReportPath: z.string().optional(),
  crossChapterContinuityReportPath: z.string().optional(),
  failureReportPath: z.string().optional()
});

export const CodexCrossChapterDriftIssueSchema = z.object({
  issueId: z.string(),
  chapterNumber: z.number().int().positive().optional(),
  severity: z.enum(['warning', 'error', 'critical']),
  message: z.string(),
  path: z.string().optional()
});

export const CodexCrossChapterDriftReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  chapters: z.array(z.number().int().positive()),
  latestCommittedChapter: z.number().int().nonnegative(),
  queueCommittedChapters: z.array(z.number().int().positive()),
  blockingIssues: z.array(CodexCrossChapterDriftIssueSchema),
  warnings: z.array(CodexCrossChapterDriftIssueSchema),
  recommendations: z.array(z.string()).default([]),
  storyStateMutated: z.literal(false)
});

export const CodexBudgetReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string(),
  exceeded: z.boolean(),
  reason: z.string(),
  budget: z.object({
    maxCallsPerChapter: z.number().int().nonnegative(),
    maxRuntimeMsPerChapter: z.number().int().positive(),
    timeoutMs: z.number().int().positive()
  }),
  usage: z.object({
    callsUsed: z.number().int().nonnegative(),
    runtimeMs: z.number().int().nonnegative()
  }),
  storyStateMutated: z.literal(false),
  suggestedRetryCommand: z.string()
});

export const CodexBenchmarkLevelSchema = z.enum(['health', 'bible', 'plan', 'draft', 'preview', 'confirm', 'chapter2', 'chapter3', 'all']);

export const CodexRuntimeBenchmarkStageSchema = z.object({
  level: CodexBenchmarkLevelSchema.exclude(['all']),
  stageName: z.string(),
  command: z.string(),
  runId: z.string().optional(),
  status: z.enum(['success', 'failed', 'skipped']),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  codexCallCount: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  timeoutCount: z.number().int().nonnegative(),
  promptInputBytes: z.number().int().nonnegative(),
  contextBytes: z.number().int().nonnegative(),
  schemaBytes: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  rawJsonlBytes: z.number().int().nonnegative(),
  artifactCount: z.number().int().nonnegative(),
  stateMutationApplied: z.boolean(),
  latestCommittedChapterBefore: z.number().int().nonnegative(),
  latestCommittedChapterAfter: z.number().int().nonnegative(),
  failureReportPath: z.string().optional(),
  errorCode: CodexErrorTypeSchema.optional(),
  suggestedRetryCommand: z.string()
});

export const CodexProfileComparisonItemSchema = z.object({
  profile: z.enum(['default', 'clean', 'debug']),
  durationMs: z.number().int().nonnegative(),
  success: z.boolean(),
  failureType: CodexErrorTypeSchema.optional(),
  warningCount: z.number().int().nonnegative(),
  outputValid: z.boolean(),
  schemaRetryCount: z.number().int().nonnegative()
});

export const CodexRuntimeFailureReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  level: CodexBenchmarkLevelSchema.exclude(['all']),
  stageName: z.string(),
  errorType: CodexErrorTypeSchema,
  message: z.string(),
  lastEventType: z.string().optional(),
  elapsedMs: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  stderrExcerptRedacted: z.string().default(''),
  storyStateMutated: z.literal(false),
  previewCompletenessReportPath: z.string().optional(),
  previewFailureReportPath: z.string().optional(),
  suggestedRetryCommand: z.string(),
  generatedAt: z.string(),
  redacted: z.literal(true)
});

export const CodexRuntimeBenchmarkReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  codexStatus: z.record(z.string(), z.unknown()),
  profile: z.union([z.enum(['default', 'clean', 'debug']), z.literal('comparison')]),
  totalDurationMs: z.number().int().nonnegative(),
  success: z.boolean(),
  completedLevels: z.array(CodexBenchmarkLevelSchema.exclude(['all'])),
  failedLevel: CodexBenchmarkLevelSchema.exclude(['all']).optional(),
  stages: z.array(CodexRuntimeBenchmarkStageSchema),
  failureReportPath: z.string().optional(),
  profileComparisons: z.array(CodexProfileComparisonItemSchema).default([])
});

export const CodexContextArtifactSchema = z.object({
  path: z.string(),
  reason: z.string(),
  summary: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
});

export const CodexContextManifestSchema = z.object({
  manifestId: z.string(),
  projectId: z.string(),
  task: z.string(),
  generatedAt: z.string(),
  requestedMode: CodexContextModeSchema.default('compact'),
  budgetBytes: z.number().int().positive().default(12000),
  actualBytes: z.number().int().nonnegative().default(0),
  maxArtifacts: z.number().int().positive().optional(),
  includedArtifacts: z.array(CodexContextArtifactSchema),
  excludedArtifacts: z.array(CodexContextArtifactSchema),
  truncationApplied: z.boolean().default(false),
  reason: z.string().default('context budget applied'),
  maxContextChars: z.number().int().positive(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/)
});

export const ChapterContextSummarySchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string(),
  shortSummary: z.string(),
  keyEvents: z.array(z.string()),
  characterStateChanges: z.array(z.string()),
  readerKnowledgeChanges: z.array(z.string()),
  debtsAdvanced: z.array(z.string()),
  foreshadowingAddedOrUpdated: z.array(z.string()),
  nextChapterHooks: z.array(z.string()),
  canonFactIds: z.array(z.string()),
  timelineEventIds: z.array(z.string()),
  generatedAt: z.string()
});

export const FinalAssemblyReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  mode: z.enum(['local-assemble', 'light-polish']),
  sourceScenePaths: z.array(z.string()),
  selectedPlanPath: z.string(),
  sceneCardsPath: z.string(),
  outputFinalPath: z.string(),
  sceneCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  generatedAt: z.string()
});

export const BuildBibleCacheReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  briefHash: z.string().regex(/^[a-f0-9]{64}$/),
  cacheKey: z.string(),
  cacheHit: z.boolean(),
  reusedArtifacts: z.array(z.string()),
  regeneratedArtifacts: z.array(z.string()),
  reason: z.string(),
  generatedAt: z.string()
});

const CodexProfilingSuggestedActionSchema = z.enum([
  'reduce_context',
  'slim_schema',
  'split_task',
  'merge_task',
  'localize_task',
  'cache_summary',
  'reuse_artifact',
  'improve_mapping',
  'inspect_prompt',
  'no_action_safety_critical'
]);

const CodexProfilingRiskLevelSchema = z.enum(['low', 'medium', 'high']);
const CodexProfilingSafetyImpactSchema = z.enum(['no_state_mutation', 'read_only', 'requires_human_review', 'safety_critical']);

export const CodexStageRuntimeOptimizationCandidateSchema = z.object({
  candidateId: z.string().default('legacy_candidate'),
  stage: z.string(),
  promptId: z.string().default('unknown'),
  reason: z.string(),
  evidence: z.array(z.string()).default([]),
  estimatedImpact: z.enum(['low', 'medium', 'high']),
  suggestedAction: z.union([CodexProfilingSuggestedActionSchema, z.string()]),
  riskLevel: CodexProfilingRiskLevelSchema.default('low'),
  safetyImpact: CodexProfilingSafetyImpactSchema.default('read_only')
});

const CodexProfileMetricItemSchema = z.object({
  key: z.string(),
  totalCalls: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative()
});

const CodexWrapperCallTypeSchema = z.enum(['exec_text', 'exec_json', 'health', 'smoke', 'repair', 'unknown']);
const CodexAttributionModeSchema = z.enum(['direct', 'parent_child', 'inferred', 'unclassified']);
const CodexAttributionConfidenceSchema = z.enum(['high', 'medium', 'low']);

const CodexOtherCategoryMetricItemSchema = z.object({
  category: z.enum([
    'health_check',
    'smoke',
    'exec_json_smoke',
    'json_repair',
    'normalization',
    'provider_inspect',
    'build_bible_subtask',
    'plan_global_subtask',
    'chapter_planning_subtask',
    'drafting_subtask',
    'diagnostics_subtask',
    'canon_patch_subtask',
    'unknown'
  ]),
  totalCalls: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative()
});

const CodexOtherReasonCategoryMetricItemSchema = z.object({
  category: z.enum([
    'true_unknown',
    'wrapper_orphan',
    'legacy_missing_parent',
    'health_or_smoke',
    'unsupported_old_manifest',
    'diagnostic_overhead',
    'smoke_or_health',
    'standalone_operator_command',
    'unknown_runtime_gap'
  ]),
  totalCalls: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative()
});

const CodexPromptCallProfileSchema = z.object({
  promptCallId: z.string(),
  runId: z.string(),
  command: z.string().default('unknown'),
  status: z.string().default('unknown'),
  chapterNumber: z.number().int().positive().optional(),
  promptId: z.string(),
  promptFamily: z.string().default('unknown'),
  inferredStage: z.string(),
  likelyCategory: z.string().default('unknown'),
  classified: z.boolean().default(true),
  durationMs: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  promptInputBytes: z.number().int().nonnegative(),
  contextBytes: z.number().int().nonnegative(),
  schemaBytes: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  rawJsonlBytes: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  jsonParsed: z.boolean(),
  schemaValid: z.boolean(),
  artifactPaths: z.array(z.string()).default([]),
  rawOutputPath: z.string().optional(),
  finalOutputPath: z.string().optional(),
  parsedOutputPath: z.string().optional(),
  errorType: z.string().optional(),
  parentPromptCallId: z.string().optional(),
  parentPromptId: z.string().optional(),
  parentStage: z.string().optional(),
  parentRunId: z.string().optional(),
  wrapperCallType: CodexWrapperCallTypeSchema.optional(),
  attributionMode: CodexAttributionModeSchema.default('direct'),
  attributionConfidence: CodexAttributionConfidenceSchema.default('high'),
  attributionReason: z.string().default('direct business call'),
  suggestedOptimization: z.string()
});

const CodexRawRuntimeViewSchema = z.object({
  totalPromptCallCount: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  byStage: StageMetricMapSchema,
  includesWrapperCalls: z.literal(true)
});

const CodexBusinessRuntimeViewSchema = z.object({
  totalBusinessCallCount: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  byBusinessStage: StageMetricMapSchema,
  byPromptId: StageMetricMapSchema,
  wrapperCallsRolledUp: z.literal(true),
  doubleCountingRemoved: z.literal(true)
});

const CodexOverheadRuntimeViewSchema = z.object({
  wrapperCallCount: z.number().int().nonnegative(),
  wrapperDurationMs: z.number().int().nonnegative(),
  healthSmokeDurationMs: z.number().int().nonnegative(),
  jsonRepairDurationMs: z.number().int().nonnegative(),
  redactionDurationMs: z.number().int().nonnegative().default(0),
  artifactWriteDurationMs: z.number().int().nonnegative().default(0),
  unclassifiedOverheadMs: z.number().int().nonnegative()
});

const CodexWrapperCallProfileSchema = z.object({
  promptCallId: z.string(),
  wrapperCallType: CodexWrapperCallTypeSchema,
  runId: z.string(),
  command: z.string().default('unknown'),
  durationMs: z.number().int().nonnegative(),
  parentPromptCallId: z.string().optional(),
  parentPromptId: z.string().optional(),
  parentStage: z.string().optional(),
  parentRunId: z.string().optional(),
  attributionMode: CodexAttributionModeSchema,
  attributionConfidence: CodexAttributionConfidenceSchema,
  attributionReason: z.string(),
  artifactPath: z.string().optional(),
  rawOutputPath: z.string().optional(),
  finalOutputPath: z.string().optional(),
  parsedOutputPath: z.string().optional(),
  timestamp: z.string().default('unknown'),
  structuredReason: z.enum([
    'diagnostic_overhead',
    'legacy_missing_parent',
    'smoke_or_health',
    'standalone_operator_command',
    'unknown_runtime_gap'
  ]).default('unknown_runtime_gap'),
  suggestedFix: z.string().default('Inspect wrapper provenance and add parentPromptCallId when this is a child of a business prompt.')
});

const CodexWrapperWarningSchema = z.object({
  runId: z.string(),
  promptCallId: z.string(),
  command: z.string(),
  artifactPath: z.string().optional(),
  rawOutputPath: z.string().optional(),
  finalOutputPath: z.string().optional(),
  parsedOutputPath: z.string().optional(),
  timestamp: z.string(),
  reason: z.enum([
    'diagnostic_overhead',
    'legacy_missing_parent',
    'smoke_or_health',
    'standalone_operator_command',
    'unknown_runtime_gap'
  ]),
  suggestedFix: z.string(),
  attributionConfidence: CodexAttributionConfidenceSchema
});

const CodexWrapperBreakdownSchema = z.object({
  totalWrapperCalls: z.number().int().nonnegative(),
  totalWrapperDurationMs: z.number().int().nonnegative(),
  orphanWrapperCallCount: z.number().int().nonnegative(),
  byWrapperType: z.array(CodexProfileMetricItemSchema).default([]),
  byParentStage: z.array(CodexProfileMetricItemSchema).default([]),
  byParentPromptId: z.array(CodexProfileMetricItemSchema).default([]),
  orphanWrapperCalls: z.array(CodexWrapperCallProfileSchema).default([]),
  inferredWrapperCalls: z.array(CodexWrapperCallProfileSchema).default([]),
  orphanWrapperWarnings: z.array(CodexWrapperWarningSchema).default([])
});

const CodexBusinessPromptCallSchema = z.object({
  businessPromptCallId: z.string(),
  promptId: z.string(),
  stage: z.string(),
  chapterNumber: z.number().int().positive().optional(),
  runId: z.string(),
  netDurationMs: z.number().int().nonnegative(),
  wrapperDurationMs: z.number().int().nonnegative(),
  providerLatencyMs: z.number().int().nonnegative(),
  promptInputBytes: z.number().int().nonnegative(),
  contextBytes: z.number().int().nonnegative(),
  schemaBytes: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  childWrapperCallIds: z.array(z.string()).default([]),
  suggestedOptimization: z.string()
});

const CodexRunProfileSchema = z.object({
  runId: z.string(),
  command: z.string(),
  chapterNumber: z.number().int().positive().optional(),
  status: z.string(),
  durationMs: z.number().int().nonnegative(),
  codexCallCount: z.number().int().nonnegative(),
  slowestPromptCallId: z.string().optional(),
  artifactCount: z.number().int().nonnegative(),
  stateMutationApplied: z.boolean()
});

const CodexOtherCodexBreakdownSchema = z.object({
  totalCalls: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  byPromptId: z.array(CodexProfileMetricItemSchema).default([]),
  byRunId: z.array(CodexProfileMetricItemSchema).default([]),
  byCommand: z.array(CodexProfileMetricItemSchema).default([]),
  byArtifactType: z.array(CodexProfileMetricItemSchema).default([]),
  likelyCategories: z.array(CodexOtherCategoryMetricItemSchema).default([]),
  reasonCategories: z.array(CodexOtherReasonCategoryMetricItemSchema).default([])
});

export const CodexStageRuntimeProfileReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  sourceRunCount: z.number().int().nonnegative(),
  sourceBenchmarkReportPaths: z.array(z.string()),
  totalDurationMs: z.number().int().nonnegative(),
  durationByChapter: StageMetricMapSchema,
  durationByStage: StageMetricMapSchema,
  codexCallsByStage: StageMetricMapSchema,
  retriesByStage: StageMetricMapSchema,
  repairsByStage: StageMetricMapSchema,
  timeoutByStage: StageMetricMapSchema,
  promptBytesByStage: StageMetricMapSchema,
  outputBytesByStage: StageMetricMapSchema,
  schemaBytesByStage: StageMetricMapSchema,
  profiledPromptCallCount: z.number().int().nonnegative().default(0),
  slowestPromptCalls: z.array(CodexPromptCallProfileSchema).default([]),
  promptCallsByPromptId: StageMetricMapSchema.default({}),
  promptCallsByStage: StageMetricMapSchema.default({}),
  promptCallsByRun: StageMetricMapSchema.default({}),
  promptCallsByChapter: StageMetricMapSchema.default({}),
  largestPromptInputs: z.array(CodexPromptCallProfileSchema).default([]),
  largestSchemas: z.array(CodexPromptCallProfileSchema).default([]),
  largestOutputs: z.array(CodexPromptCallProfileSchema).default([]),
  repairCalls: z.array(CodexPromptCallProfileSchema).default([]),
  retryCalls: z.array(CodexPromptCallProfileSchema).default([]),
  unclassifiedCalls: z.array(CodexPromptCallProfileSchema).default([]),
  remainingUnclassifiedCount: z.number().int().nonnegative().default(0),
  otherCodexBreakdown: CodexOtherCodexBreakdownSchema.default({
    totalCalls: 0,
    totalDurationMs: 0,
    byPromptId: [],
    byRunId: [],
    byCommand: [],
    byArtifactType: [],
    likelyCategories: [],
    reasonCategories: []
  }),
  rawRuntimeView: CodexRawRuntimeViewSchema.default({
    totalPromptCallCount: 0,
    totalDurationMs: 0,
    byStage: {},
    includesWrapperCalls: true
  }),
  businessRuntimeView: CodexBusinessRuntimeViewSchema.default({
    totalBusinessCallCount: 0,
    totalDurationMs: 0,
    byBusinessStage: {},
    byPromptId: {},
    wrapperCallsRolledUp: true,
    doubleCountingRemoved: true
  }),
  overheadRuntimeView: CodexOverheadRuntimeViewSchema.default({
    wrapperCallCount: 0,
    wrapperDurationMs: 0,
    healthSmokeDurationMs: 0,
    jsonRepairDurationMs: 0,
    redactionDurationMs: 0,
    artifactWriteDurationMs: 0,
    unclassifiedOverheadMs: 0
  }),
  wrapperBreakdown: CodexWrapperBreakdownSchema.default({
    totalWrapperCalls: 0,
    totalWrapperDurationMs: 0,
    orphanWrapperCallCount: 0,
    byWrapperType: [],
    byParentStage: [],
    byParentPromptId: [],
    orphanWrapperCalls: [],
    inferredWrapperCalls: [],
    orphanWrapperWarnings: []
  }),
  slowestBusinessPromptCalls: z.array(CodexBusinessPromptCallSchema).default([]),
  slowestRuns: z.array(CodexRunProfileSchema).default([]),
  durationByCommand: StageMetricMapSchema.default({}),
  durationByPromptId: StageMetricMapSchema.default({}),
  durationByPromptFamily: StageMetricMapSchema.default({}),
  durationByChapterStage: StageMetricMapSchema.default({}),
  slowestStages: z.array(
    z.object({
      stage: z.string(),
      durationMs: z.number().int().nonnegative(),
      codexCallCount: z.number().int().nonnegative()
    })
  ),
  optimizationCandidates: z.array(CodexStageRuntimeOptimizationCandidateSchema),
  storyStateMutated: z.literal(false)
});

const CodexBusinessOptimizationCandidateTypeSchema = z.enum([
  'reduce_context',
  'add_context_budget',
  'use_chapter_summary_cache',
  'slim_schema',
  'split_task',
  'merge_task',
  'localize_task',
  'cache_artifact',
  'reuse_preview_artifact',
  'improve_prompt',
  'improve_normalizer',
  'improve_stage_mapping',
  'classify_orphan_wrapper',
  'no_action_safety_critical'
]);

const CodexOptimizationQualityRiskSchema = z.enum(['low', 'medium', 'high']);
const CodexOptimizationComplexitySchema = z.enum(['low', 'medium', 'high']);

const CodexBusinessOptimizationTargetStageSchema = z.object({
  stage: z.string(),
  promptId: z.string(),
  totalDurationMs: z.number().int().nonnegative(),
  callCount: z.number().int().positive(),
  averageDurationMs: z.number().nonnegative(),
  maxDurationMs: z.number().int().nonnegative(),
  promptInputBytesTotal: z.number().int().nonnegative(),
  averagePromptInputBytes: z.number().nonnegative(),
  schemaBytesTotal: z.number().int().nonnegative(),
  outputBytesTotal: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  qualityRisk: CodexOptimizationQualityRiskSchema,
  safetyCritical: z.boolean(),
  recommendedStrategy: z.string().min(1)
});

const CodexBusinessOptimizationCandidateSchema = z.object({
  candidateId: z.string(),
  stage: z.string(),
  promptId: z.string(),
  candidateType: CodexBusinessOptimizationCandidateTypeSchema,
  reason: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  estimatedImpactMs: z.number().int().nonnegative(),
  estimatedImpactPercent: z.number().nonnegative(),
  implementationComplexity: CodexOptimizationComplexitySchema,
  riskLevel: CodexProfilingRiskLevelSchema,
  safetyImpact: CodexProfilingSafetyImpactSchema,
  expectedBehaviorChange: z.string().min(1),
  filesLikelyTouched: z.array(z.string()),
  testsRequired: z.array(z.string()),
  rollbackPlan: z.string().min(1),
  recommendedFirstStep: z.string().min(1)
});

const CodexWrapperInterpretationSchema = z.object({
  likelyIncludesProviderExecution: z.literal(true),
  pureBoundaryOverheadEstimateMs: z.number().int().nonnegative().nullable(),
  reason: z.string().min(1),
  childCallsRolledUpToBusiness: z.boolean(),
  orphanWrapperDurationMs: z.number().int().nonnegative(),
  recommendedAction: z.string().min(1)
});

const CodexOptimizationCleanupRecommendationSchema = z.object({
  promptId: z.string(),
  stage: z.string(),
  durationMs: z.number().int().nonnegative(),
  confidence: z.enum(['low', 'medium', 'high']),
  recommendedAction: z.string().min(1)
});

const CodexOptimizationStageSpecificAnalysisSchema = z.object({
  stage: z.string(),
  promptId: z.string(),
  recommendation: z.string().min(1),
  safetyNote: z.string().min(1)
});

export const CodexBusinessOptimizationPlanSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  sourceProfilePath: z.string(),
  sourceProfileVersion: z.number().int().positive(),
  businessTotalDurationMs: z.number().int().nonnegative(),
  rawTotalDurationMs: z.number().int().nonnegative(),
  wrapperDurationMs: z.number().int().nonnegative(),
  targetStages: z.array(CodexBusinessOptimizationTargetStageSchema),
  optimizationCandidates: z.array(CodexBusinessOptimizationCandidateSchema),
  recommendedExecutionOrder: z.array(z.string()),
  expectedImpactSummary: z.object({
    totalEstimatedImpactMs: z.number().int().nonnegative(),
    totalEstimatedImpactPercent: z.number().nonnegative(),
    topCandidateIds: z.array(z.string()),
    notes: z.array(z.string())
  }),
  safetyNotes: z.array(z.string()),
  rollbackPlan: z.string().min(1),
  wrapperInterpretation: CodexWrapperInterpretationSchema,
  orphanCleanupPlan: z.array(CodexOptimizationCleanupRecommendationSchema),
  stageSpecificAnalysis: z.array(CodexOptimizationStageSpecificAnalysisSchema),
  storyStateMutated: z.literal(false)
});

export const CodexCrossChapterLinkSchema = z.object({
  fromChapter: z.number().int().positive(),
  toChapter: z.number().int().positive(),
  linkedFactIds: z.array(z.string()).default([]),
  linkedDebtIds: z.array(z.string()).default([]),
  linkedForeshadowingIds: z.array(z.string()).default([]),
  linkedReaderExpectations: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  strength: z.enum(['weak', 'medium', 'strong'])
});

export const CodexCrossChapterContinuityReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  chapters: z.array(z.number().int().positive()),
  continuityScore: QualityScoreSchema,
  blockingIssues: z.array(CodexCrossChapterDriftIssueSchema),
  warnings: z.array(CodexCrossChapterDriftIssueSchema),
  recommendations: z.array(z.string()),
  chapterLinks: z.array(CodexCrossChapterLinkSchema),
  summariesMissing: z.array(z.number().int().positive()).default([]),
  duplicateHookRisk: z.boolean(),
  repeatedScenePatternRisk: z.boolean(),
  storyStateMutated: z.literal(false)
});

export const CodexPromptAuditIssueSchema = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  severity: z.enum(['warning', 'error'])
});

export const CodexPromptAuditReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string().default('prompt-pack'),
  promptRoot: z.string(),
  generatedAt: z.string(),
  ok: z.boolean(),
  promptCount: z.number().int().nonnegative(),
  maxPromptBytes: z.number().int().positive(),
  issues: z.array(CodexPromptAuditIssueSchema),
  auditedPrompts: z.array(
    z.object({
      path: z.string(),
      promptId: z.string().optional(),
      task: z.string().optional(),
      expectedOutput: z.string().optional(),
      contextBudget: z.string().optional(),
      qualityRisks: z.string().optional(),
      sizeBytes: z.number().int().nonnegative()
    })
  )
});

export const CodexCallReductionReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  beforeCallCount: z.number().int().nonnegative(),
  afterCallCount: z.number().int().nonnegative(),
  reducedCallCount: z.number().int().nonnegative(),
  localDeterministicTasks: z.array(z.string()),
  preservedCodexTasks: z.array(z.string()),
  schemaSafetyChecksPreserved: z.literal(true),
  storyStateSafetyPreserved: z.literal(true),
  notes: z.array(z.string())
});

export const CodexRuntimeOptimizationReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  realBenchmark: z.boolean(),
  baseline: z.record(z.string(), z.number().int().nonnegative()),
  current: z.record(z.string(), z.number().int().nonnegative()),
  deltaPercent: z.record(z.string(), z.number()),
  deltaByPromptId: z.record(z.string(), z.number()).default({}),
  callCountBefore: z.number().int().nonnegative().default(0),
  callCountAfter: z.number().int().nonnegative().default(0),
  cacheHits: z.number().int().nonnegative().default(0),
  localAssembleUsage: z.number().int().nonnegative().default(0),
  contextBudgetStats: z
    .object({
      manifestCount: z.number().int().nonnegative(),
      overBudgetCount: z.number().int().nonnegative(),
      averageActualBytes: z.number().nonnegative(),
      averageBudgetBytes: z.number().nonnegative()
    })
    .default({
      manifestCount: 0,
      overBudgetCount: 0,
      averageActualBytes: 0,
      averageBudgetBytes: 0
    }),
  warnings: z.array(z.string()).default([]),
  improvedStages: z.array(z.string()),
  regressedStages: z.array(z.string()),
  nextRecommendations: z.array(z.string()).default([]),
  notes: z.array(z.string())
});

export const CodexRealOptimizationStageDeltaSchema = z.object({
  stage: z.string(),
  baselineMs: z.number().int().nonnegative(),
  currentMs: z.number().int().nonnegative(),
  deltaMs: z.number().int(),
  deltaPercent: z.number(),
  faster: z.boolean(),
  comparisonConfidence: z.enum(['low', 'medium', 'high']),
  regressionReason: z.string().optional()
});

export const CodexRealOptimizationContextBudgetStatsSchema = z.object({
  manifestCount: z.number().int().nonnegative(),
  averageContextBytes: z.number().nonnegative(),
  maxContextBytes: z.number().int().nonnegative(),
  budgetBytes: z.number().int().nonnegative(),
  overBudgetCount: z.number().int().nonnegative(),
  contextBudgetWarnings: z.array(z.string())
});

export const CodexRealOptimizationSafetyChecksSchema = z.object({
  previewDidNotMutateStoryState: z.boolean(),
  confirmMutationsRequireApprovalAndSnapshots: z.boolean(),
  localAssembleDidNotMutateStoryState: z.boolean(),
  cacheHitDidNotMutateStoryState: z.boolean(),
  contextManifestDidNotMutateStoryState: z.boolean(),
  failurePathsStoryStateMutatedFalse: z.boolean()
});

export const CodexRealOptimizationBenchmarkReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  realBenchmark: z.literal(true),
  baselineSource: z.string(),
  baselineDurations: z.record(z.string(), z.number().int().nonnegative()),
  currentDurations: z.record(z.string(), z.number().int().nonnegative()),
  deltaByStage: z.record(z.string(), CodexRealOptimizationStageDeltaSchema),
  deltaByPromptId: z.record(z.string(), z.number()),
  callCountBefore: z.number().int().nonnegative(),
  callCountAfter: z.number().int().nonnegative(),
  promptBytesBefore: z.number().int().nonnegative(),
  promptBytesAfter: z.number().int().nonnegative(),
  schemaBytesBefore: z.number().int().nonnegative(),
  schemaBytesAfter: z.number().int().nonnegative(),
  outputBytesBefore: z.number().int().nonnegative(),
  outputBytesAfter: z.number().int().nonnegative(),
  retryCountBefore: z.number().int().nonnegative(),
  retryCountAfter: z.number().int().nonnegative(),
  repairCountBefore: z.number().int().nonnegative(),
  repairCountAfter: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  localAssembleUsed: z.boolean(),
  contextBudgetStats: CodexRealOptimizationContextBudgetStatsSchema,
  qualityReportPaths: z.array(z.string()),
  continuityReportPath: z.string().nullable(),
  validatePassed: z.boolean(),
  auditPassed: z.boolean(),
  latestCommittedChapterAfter: z.number().int().nonnegative(),
  comparisonConfidence: z.enum(['low', 'medium', 'high']),
  success: z.boolean(),
  warnings: z.array(z.string()),
  regressions: z.array(z.string()),
  recommendedNextOptimizations: z.array(z.string()),
  safetyChecks: CodexRealOptimizationSafetyChecksSchema,
  sourceBenchmarkReportPath: z.string().optional()
});

const CodexRegressionConfidenceSchema = z.enum(['low', 'medium', 'high']);
const CodexRegressionRootCauseTypeSchema = z.enum([
  'duplicate_call',
  'increased_prompt_bytes',
  'increased_schema_bytes',
  'increased_output_bytes',
  'retry_repair_increase',
  'context_builder_change',
  'cache_not_used',
  'local_assemble_side_effect',
  'attribution_artifact',
  'codex_runtime_variance',
  'unknown'
]);

const CodexChapterRegressionStageBreakdownSchema = z.object({
  stage: z.string(),
  durationMs: z.number().int().nonnegative(),
  promptCallCount: z.number().int().nonnegative(),
  codexCallCount: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  promptInputBytes: z.number().int().nonnegative(),
  contextBytes: z.number().int().nonnegative(),
  schemaBytes: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  rawJsonlBytes: z.number().int().nonnegative(),
  artifactCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  comparedToBaselineDeltaMs: z.number().int(),
  comparedToBaselineDeltaPercent: z.number()
});

const CodexChapterRegressionChapterComparisonSchema = z.object({
  chapterNumber: z.number().int().positive(),
  baselineDurationMs: z.number().int().nonnegative(),
  currentDurationMs: z.number().int().nonnegative(),
  deltaMs: z.number().int(),
  deltaPercent: z.number(),
  explainedDeltaMs: z.number().int().nonnegative().default(0),
  unexplainedDeltaMs: z.number().int().nonnegative().default(0),
  explanationCoveragePercent: z.number().default(0),
  durationByStage: z.record(z.string(), CodexChapterRegressionStageBreakdownSchema),
  durationByPromptId: z.record(z.string(), z.number().int().nonnegative()),
  codexCallCount: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  promptBytesTotal: z.number().int().nonnegative(),
  schemaBytesTotal: z.number().int().nonnegative(),
  outputBytesTotal: z.number().int().nonnegative(),
  rawJsonlBytesTotal: z.number().int().nonnegative(),
  qualityCriticalIssues: z.number().int().nonnegative(),
  continuityWarnings: z.number().int().nonnegative()
});

const CodexDuplicatePromptCallSchema = z.object({
  promptId: z.string(),
  chapterNumber: z.number().int().positive(),
  stage: z.string(),
  runIds: z.array(z.string()),
  artifactPaths: z.array(z.string()),
  reason: z.string(),
  safeToReuse: z.boolean(),
  suggestedFix: z.string()
});

const CodexRepeatedStageCallSchema = z.object({
  chapterNumber: z.number().int().positive(),
  stage: z.string(),
  promptIds: z.array(z.string()),
  runIds: z.array(z.string()),
  reason: z.string(),
  suggestedFix: z.string()
});

const CodexBytesRegressionSchema = z.object({
  chapterNumber: z.number().int().positive(),
  stage: z.string(),
  promptId: z.string(),
  baselineBytes: z.number().int().nonnegative(),
  currentBytes: z.number().int().nonnegative(),
  deltaBytes: z.number().int(),
  deltaPercent: z.number(),
  likelyReason: z.string(),
  suggestedFix: z.string()
});

const CodexRetryRepairRegressionSchema = z.object({
  chapterNumber: z.number().int().positive(),
  promptId: z.string(),
  stage: z.string(),
  baselineRetryCount: z.number().int().nonnegative(),
  currentRetryCount: z.number().int().nonnegative(),
  baselineRepairCount: z.number().int().nonnegative(),
  currentRepairCount: z.number().int().nonnegative(),
  errorTypes: z.array(z.string()),
  suggestedFix: z.string()
});

const CodexRegressionRootCauseSchema = z.object({
  rootCauseId: z.string(),
  rootCauseType: CodexRegressionRootCauseTypeSchema,
  affectedChapter: z.number().int().positive(),
  affectedStage: z.string(),
  affectedPromptId: z.string(),
  evidence: z.array(z.string().min(1)).min(1),
  impactMs: z.number().int().nonnegative(),
  confidence: CodexRegressionConfidenceSchema,
  proposedFix: z.string().min(1),
  riskLevel: z.enum(['low', 'medium', 'high']),
  nextExperiment: z.string().min(1)
});

const CodexRegressionRecommendedFixSchema = z.object({
  experimentId: z.string(),
  targetChapter: z.number().int().positive(),
  targetStage: z.string(),
  targetPromptId: z.string(),
  hypothesis: z.string().min(1),
  change: z.string().min(1),
  expectedImpactMs: z.number().int().nonnegative(),
  safetyRisk: z.enum(['low', 'medium', 'high']),
  requiredTests: z.array(z.string().min(1)),
  rollbackPlan: z.string().min(1)
});

const CodexMappingCleanupSchema = z.object({
  unknownPromptMappings: z.array(
    z.object({
      promptId: z.string(),
      runId: z.string(),
      artifactPaths: z.array(z.string()),
      suggestedMapping: z.string()
    })
  ),
  diagnosticOverheadClassified: z.array(
    z.object({
      promptId: z.string(),
      runId: z.string(),
      reason: z.string()
    })
  ),
  unresolvedWarnings: z.array(
    z.object({
      promptId: z.string(),
      runId: z.string(),
      warning: z.string(),
      artifactPaths: z.array(z.string()),
      promptCallId: z.string().optional(),
      command: z.string().optional(),
      artifactPath: z.string().optional(),
      rawOutputPath: z.string().optional(),
      finalOutputPath: z.string().optional(),
      parsedOutputPath: z.string().optional(),
      timestamp: z.string().optional(),
      reason: z.enum([
        'diagnostic_overhead',
        'legacy_missing_parent',
        'smoke_or_health',
        'standalone_operator_command',
        'unknown_runtime_gap'
      ]).optional(),
      suggestedFix: z.string().optional(),
      parentPromptCallId: z.string().optional(),
      parentPromptId: z.string().optional(),
      parentStage: z.string().optional()
    })
  )
});

const CodexRegressionRecommendationSchema = z.object({
  recommendationType: z.enum(['continue_runtime_gap_analysis', 'stabilize_mission_retry', 'close_wrapper_attribution', 'run_micro_benchmark']),
  reason: z.string(),
  suggestedCommand: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high'])
});

const CodexRuntimeGapSourceSchema = z.enum([
  'codex_provider_latency_variance',
  'codex_process_startup',
  'jsonl_stream_wait',
  'artifact_io',
  'local_processing',
  'event_timing_missing',
  'legacy_manifest_gap',
  'benchmark_aggregation_gap',
  'unknown'
]);

const CodexRuntimeGapChapterSchema = z.object({
  chapterNumber: z.number().int().positive(),
  wallClockMs: z.number().int().nonnegative(),
  promptCallMs: z.number().int().nonnegative(),
  localStageMs: z.number().int().nonnegative(),
  unattributedGapMs: z.number().int().nonnegative(),
  gapPercent: z.number(),
  largestGapRunIds: z.array(z.string()),
  largestGapStages: z.array(z.string())
});

const CodexRuntimeGapRunSchema = z.object({
  runId: z.string(),
  command: z.string(),
  chapterNumber: z.number().int().positive().optional(),
  wallClockMs: z.number().int().nonnegative(),
  promptCallMs: z.number().int().nonnegative(),
  localStageMs: z.number().int().nonnegative(),
  eventDurationMs: z.number().int().nonnegative(),
  unattributedGapMs: z.number().int().nonnegative(),
  gapPercent: z.number(),
  status: z.string(),
  suspectedSource: CodexRuntimeGapSourceSchema,
  processStartupMs: z.number().int().nonnegative().default(0),
  timeToFirstEventMs: z.number().int().nonnegative().default(0),
  modelResponseMs: z.number().int().nonnegative().default(0),
  finalMessageToExitMs: z.number().int().nonnegative().default(0),
  artifactWriteMs: z.number().int().nonnegative().default(0),
  parseMs: z.number().int().nonnegative().default(0),
  schemaValidationMs: z.number().int().nonnegative().default(0),
  measuredCodexBoundaryMs: z.number().int().nonnegative().default(0),
  measuredLocalProcessingMs: z.number().int().nonnegative().default(0),
  unexplainedMsAfterPrecision: z.number().int().nonnegative().default(0),
  timingOverlapDetected: z.boolean().default(false),
  timingOverlapWarning: z.string().default(''),
  overlapExplanation: z.string().default('')
});

const CodexRuntimeGapStageSchema = z.object({
  stage: z.string(),
  chapterNumber: z.number().int().positive().optional(),
  wallClockMs: z.number().int().nonnegative(),
  promptCallMs: z.number().int().nonnegative(),
  localStageMs: z.number().int().nonnegative(),
  unattributedGapMs: z.number().int().nonnegative(),
  gapPercent: z.number()
});

const CodexRuntimeGapSuspectedSourceSchema = z.object({
  suspectedSource: CodexRuntimeGapSourceSchema,
  totalGapMs: z.number().int().nonnegative(),
  runIds: z.array(z.string()),
  evidence: z.array(z.string())
});

const CodexRuntimeGapRecommendationSchema = z.object({
  recommendedAction: z.enum(['fix_observability_before_prompt_compression', 'measure_provider_variance', 'add_parent_attribution', 'inspect_event_timing']),
  reason: z.string(),
  suggestedCommand: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high'])
});

export const CodexRuntimeGapReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  sourceBenchmarkPath: z.string(),
  sourceProfilePath: z.string(),
  totalWallClockMs: z.number().int().nonnegative(),
  totalPromptCallMs: z.number().int().nonnegative(),
  totalLocalStageMs: z.number().int().nonnegative(),
  totalUnattributedGapMs: z.number().int().nonnegative(),
  gapByChapter: z.array(CodexRuntimeGapChapterSchema),
  gapByRun: z.array(CodexRuntimeGapRunSchema),
  gapByStage: z.array(CodexRuntimeGapStageSchema),
  suspectedGapSources: z.array(CodexRuntimeGapSuspectedSourceSchema),
  recommendations: z.array(CodexRuntimeGapRecommendationSchema),
  processStartupMs: z.number().int().nonnegative().default(0),
  timeToFirstEventMs: z.number().int().nonnegative().default(0),
  modelResponseMs: z.number().int().nonnegative().default(0),
  finalMessageToExitMs: z.number().int().nonnegative().default(0),
  artifactWriteMs: z.number().int().nonnegative().default(0),
  parseMs: z.number().int().nonnegative().default(0),
  schemaValidationMs: z.number().int().nonnegative().default(0),
  measuredCodexBoundaryMs: z.number().int().nonnegative().default(0),
  measuredLocalProcessingMs: z.number().int().nonnegative().default(0),
  unexplainedMsAfterPrecision: z.number().int().nonnegative().default(0),
  timingOverlapDetected: z.boolean().default(false),
  timingOverlapWarning: z.string().default(''),
  overlapExplanation: z.string().default(''),
  storyStateMutated: z.literal(false)
});

export const CodexRuntimeSamplingStageSchema = z.enum(['chapter_mission', 'scene_cards', 'write_scene', 'canon_patch_proposal', 'diagnostics', 'final_chapter']);

export const CodexRuntimeSamplingSampleSchema = z.object({
  sampleId: z.string(),
  runId: z.string(),
  promptCallId: z.string(),
  durationMs: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  schemaValid: z.boolean(),
  jsonParsed: z.boolean(),
  promptInputBytes: z.number().int().nonnegative(),
  schemaBytes: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  errorType: z.string().optional(),
  failureReportPath: z.string().optional(),
  artifactPaths: z.array(z.string()).default([]),
  stateMutated: z.literal(false)
});

export const CodexRuntimeSamplingInterpretationSchema = z.object({
  varianceLevel: z.enum(['low', 'medium', 'high']),
  stableBottleneck: z.boolean(),
  likelyRuntimeVariance: z.boolean(),
  enoughEvidenceForPromptOptimization: z.boolean(),
  explanation: z.string()
});

export const CodexRuntimeSamplingReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  chapterNumber: z.number().int().positive(),
  stage: CodexRuntimeSamplingStageSchema,
  promptId: z.string(),
  sampleCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  minDurationMs: z.number().int().nonnegative(),
  maxDurationMs: z.number().int().nonnegative(),
  meanDurationMs: z.number().nonnegative(),
  medianDurationMs: z.number().int().nonnegative(),
  p90DurationMs: z.number().int().nonnegative(),
  p95DurationMs: z.number().int().nonnegative(),
  retryRate: z.number().min(0).max(1),
  repairRate: z.number().min(0).max(1),
  schemaValidRate: z.number().min(0).max(1),
  timeoutRate: z.number().min(0).max(1),
  samples: z.array(CodexRuntimeSamplingSampleSchema),
  interpretation: CodexRuntimeSamplingInterpretationSchema,
  recommendation: z.string(),
  storyStateMutated: z.literal(false)
});

export const MissionSchemaDiagnosticsReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  promptId: z.string(),
  generatedAt: z.string(),
  schemaValid: z.boolean(),
  errorTypes: z.array(z.string()),
  missingFields: z.array(z.string()).default([]),
  extraFields: z.array(z.string()).default([]),
  outputPath: z.string().optional(),
  storyStateMutated: z.literal(false)
});

export const CodexMissionRetryReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  promptId: z.string(),
  previousRetryCount: z.number().int().nonnegative(),
  currentRetryCount: z.number().int().nonnegative(),
  schemaErrorTypes: z.array(z.string()),
  repairUsed: z.boolean(),
  promptChanges: z.array(z.string()),
  schemaChanges: z.array(z.string()),
  normalizerChanges: z.array(z.string()),
  success: z.boolean(),
  generatedAt: z.string(),
  storyStateMutated: z.literal(false)
});

export const CodexMissionMicroBenchmarkReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  promptId: z.string(),
  generatedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  promptBytes: z.number().int().nonnegative(),
  schemaBytes: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  schemaValid: z.boolean(),
  errors: z.array(z.string()),
  success: z.boolean(),
  runId: z.string(),
  retryReportPath: z.string(),
  schemaDiagnosticsPath: z.string(),
  storyStateMutated: z.literal(false)
});

export const CodexChapterRegressionAnalysisSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  baselineSource: z.string(),
  currentBenchmarkPath: z.string(),
  baselineChapters: z.array(CodexChapterRegressionChapterComparisonSchema),
  currentChapters: z.array(CodexChapterRegressionChapterComparisonSchema),
  regressions: z.array(CodexChapterRegressionChapterComparisonSchema),
  improvedStages: z.array(CodexChapterRegressionStageBreakdownSchema),
  suspectedRootCauses: z.array(CodexRegressionRootCauseSchema),
  recommendedFixes: z.array(CodexRegressionRecommendedFixSchema),
  recommendations: z.array(CodexRegressionRecommendationSchema).default([]),
  runtimeGapReportPath: z.string().optional(),
  missionRetryReportPath: z.string().optional(),
  missionMicroBenchmarkPath: z.string().optional(),
  confidence: CodexRegressionConfidenceSchema,
  warnings: z.array(z.string()),
  duplicatePromptCalls: z.array(CodexDuplicatePromptCallSchema),
  repeatedStageCalls: z.array(CodexRepeatedStageCallSchema),
  rerunOnConfirmDetected: z.boolean(),
  previewArtifactsReused: z.boolean(),
  previewPatchReused: z.boolean(),
  finalReused: z.boolean(),
  stateDiffReused: z.boolean(),
  promptBytesRegressions: z.array(CodexBytesRegressionSchema),
  schemaBytesRegressions: z.array(CodexBytesRegressionSchema),
  outputBytesRegressions: z.array(CodexBytesRegressionSchema),
  retryRegressions: z.array(CodexRetryRepairRegressionSchema),
  repairRegressions: z.array(CodexRetryRepairRegressionSchema),
  jsonRepairHotspots: z.array(CodexRetryRepairRegressionSchema),
  mappingCleanup: CodexMappingCleanupSchema,
  storyStateMutated: z.literal(false)
});

export type CodexErrorType = z.infer<typeof CodexErrorTypeSchema>;
export type CodexJsonFailureAttempt = z.infer<typeof CodexJsonFailureAttemptSchema>;
export type CodexJsonFailureReport = z.infer<typeof CodexJsonFailureReportSchema>;
export type CodexPatchFailureReport = z.infer<typeof CodexPatchFailureReportSchema>;
export type CodexPreviewArtifactCheck = z.infer<typeof CodexPreviewArtifactCheckSchema>;
export type CodexPreviewCompletenessReport = z.infer<typeof CodexPreviewCompletenessReportSchema>;
export type CodexPreviewFailureReport = z.infer<typeof CodexPreviewFailureReportSchema>;
export type CodexPreviewSubStageName = z.infer<typeof CodexPreviewSubStageNameSchema>;
export type CodexPreviewSubStageTimelineItem = z.infer<typeof CodexPreviewSubStageTimelineItemSchema>;
export type CodexDiagnosticsHardCheckName = z.infer<typeof CodexDiagnosticsHardCheckNameSchema>;
export type CodexDiagnosticsFailureClassification = z.infer<typeof CodexDiagnosticsFailureClassificationSchema>;
export type CodexDiagnosticsLikelyCause = z.infer<typeof CodexDiagnosticsLikelyCauseSchema>;
export type CodexDiagnosticsEvidence = z.infer<typeof CodexDiagnosticsEvidenceSchema>;
export type CodexDiagnosticsHardFailureAnalysis = z.infer<typeof CodexDiagnosticsHardFailureAnalysisSchema>;
export type CodexDiagnosticsHardFailAnalysis = z.infer<typeof CodexDiagnosticsHardFailAnalysisSchema>;
export type CodexDiagnosticsContextAudit = z.infer<typeof CodexDiagnosticsContextAuditSchema>;
export type DiagnosticsContextMode = z.infer<typeof DiagnosticsContextModeSchema>;
export type DiagnosticsContextManifestArtifact = z.infer<typeof DiagnosticsContextManifestArtifactSchema>;
export type DiagnosticsContextManifest = z.infer<typeof DiagnosticsContextManifestSchema>;
export type CodexDiagnosticsBenchmarkSample = z.infer<typeof CodexDiagnosticsBenchmarkSampleSchema>;
export type CodexDiagnosticsBenchmarkReport = z.infer<typeof CodexDiagnosticsBenchmarkReportSchema>;
export type CodexDiagnosticsContextFixHardCheckComparison = z.infer<typeof CodexDiagnosticsContextFixHardCheckComparisonSchema>;
export type CodexDiagnosticsContextFixReport = z.infer<typeof CodexDiagnosticsContextFixReportSchema>;
export type DiagnosticsSchemaFailureLayer = z.infer<typeof DiagnosticsSchemaFailureLayerSchema>;
export type DiagnosticsSchemaViolationSample = z.infer<typeof DiagnosticsSchemaViolationSampleSchema>;
export type DiagnosticsSchemaComplianceReport = z.infer<typeof DiagnosticsSchemaComplianceReportSchema>;
export type DiagnosticsNormalizationReport = z.infer<typeof DiagnosticsNormalizationReportSchema>;
export type CodexDiagnosticsSchemaBenchmarkSample = z.infer<typeof CodexDiagnosticsSchemaBenchmarkSampleSchema>;
export type CodexDiagnosticsSchemaBenchmarkReport = z.infer<typeof CodexDiagnosticsSchemaBenchmarkReportSchema>;
export type RevisionOpportunityReport = z.infer<typeof RevisionOpportunityReportSchema>;
export type RevisionOpportunityTarget = z.infer<typeof RevisionOpportunityTargetSchema>;
export type CodexChapterQualityReport = z.infer<typeof CodexChapterQualityReportSchema>;
export type CodexMultiChapterPilotChapter = z.infer<typeof CodexMultiChapterPilotChapterSchema>;
export type CodexMultiChapterPilotReport = z.infer<typeof CodexMultiChapterPilotReportSchema>;
export type CodexCrossChapterDriftIssue = z.infer<typeof CodexCrossChapterDriftIssueSchema>;
export type CodexCrossChapterDriftReport = z.infer<typeof CodexCrossChapterDriftReportSchema>;
export type CodexBudgetReport = z.infer<typeof CodexBudgetReportSchema>;
export type CodexBenchmarkLevel = z.infer<typeof CodexBenchmarkLevelSchema>;
export type CodexRuntimeBenchmarkStage = z.infer<typeof CodexRuntimeBenchmarkStageSchema>;
export type CodexProfileComparisonItem = z.infer<typeof CodexProfileComparisonItemSchema>;
export type CodexRuntimeFailureReport = z.infer<typeof CodexRuntimeFailureReportSchema>;
export type CodexRuntimeBenchmarkReport = z.infer<typeof CodexRuntimeBenchmarkReportSchema>;
export type CodexSingleChapterSmokeStage = z.infer<typeof CodexSingleChapterSmokeStageSchema>;
export type CodexSingleChapterSmokeReport = z.infer<typeof CodexSingleChapterSmokeReportSchema>;
export type CodexContextArtifact = z.infer<typeof CodexContextArtifactSchema>;
export type CodexContextManifest = z.infer<typeof CodexContextManifestSchema>;
export type ChapterContextSummary = z.infer<typeof ChapterContextSummarySchema>;
export type FinalAssemblyReport = z.infer<typeof FinalAssemblyReportSchema>;
export type BuildBibleCacheReport = z.infer<typeof BuildBibleCacheReportSchema>;
export type CodexStageRuntimeProfileReport = z.infer<typeof CodexStageRuntimeProfileReportSchema>;
export type CodexCrossChapterLink = z.infer<typeof CodexCrossChapterLinkSchema>;
export type CodexCrossChapterContinuityReport = z.infer<typeof CodexCrossChapterContinuityReportSchema>;
export type CodexPromptAuditIssue = z.infer<typeof CodexPromptAuditIssueSchema>;
export type CodexPromptAuditReport = z.infer<typeof CodexPromptAuditReportSchema>;
export type CodexCallReductionReport = z.infer<typeof CodexCallReductionReportSchema>;
export type CodexRuntimeOptimizationReport = z.infer<typeof CodexRuntimeOptimizationReportSchema>;
export type CodexBusinessOptimizationPlan = z.infer<typeof CodexBusinessOptimizationPlanSchema>;
export type CodexRealOptimizationStageDelta = z.infer<typeof CodexRealOptimizationStageDeltaSchema>;
export type CodexRealOptimizationBenchmarkReport = z.infer<typeof CodexRealOptimizationBenchmarkReportSchema>;
export type CodexRuntimeGapReport = z.infer<typeof CodexRuntimeGapReportSchema>;
export type CodexRuntimeSamplingStage = z.infer<typeof CodexRuntimeSamplingStageSchema>;
export type CodexRuntimeSamplingSample = z.infer<typeof CodexRuntimeSamplingSampleSchema>;
export type CodexRuntimeSamplingInterpretation = z.infer<typeof CodexRuntimeSamplingInterpretationSchema>;
export type CodexRuntimeSamplingReport = z.infer<typeof CodexRuntimeSamplingReportSchema>;
export type MissionSchemaDiagnosticsReport = z.infer<typeof MissionSchemaDiagnosticsReportSchema>;
export type CodexMissionRetryReport = z.infer<typeof CodexMissionRetryReportSchema>;
export type CodexMissionMicroBenchmarkReport = z.infer<typeof CodexMissionMicroBenchmarkReportSchema>;
export type CodexChapterRegressionAnalysis = z.infer<typeof CodexChapterRegressionAnalysisSchema>;
