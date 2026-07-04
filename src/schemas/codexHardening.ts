import { z } from 'zod';

export const CodexErrorTypeSchema = z.enum([
  'CODEX_BINARY_MISSING',
  'CODEX_NOT_LOGGED_IN',
  'CODEX_DOCTOR_UNHEALTHY_NON_BLOCKING',
  'CODEX_EXEC_FAILED',
  'CODEX_OUTPUT_MISSING',
  'CODEX_INVALID_JSON',
  'CODEX_SCHEMA_VALIDATION_FAILED',
  'CODEX_REPAIR_FAILED',
  'CODEX_TIMEOUT',
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

const QualityScoreSchema = z.number().min(0).max(10);

export const CodexChapterQualityReportSchema = z.object({
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
    chapterHook: QualityScoreSchema
  }),
  criticalIssues: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  blocking: z.boolean(),
  storyStateMutated: z.literal(false)
});

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
  includedArtifacts: z.array(CodexContextArtifactSchema),
  excludedArtifacts: z.array(CodexContextArtifactSchema),
  maxContextChars: z.number().int().positive(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/)
});

export type CodexErrorType = z.infer<typeof CodexErrorTypeSchema>;
export type CodexJsonFailureAttempt = z.infer<typeof CodexJsonFailureAttemptSchema>;
export type CodexJsonFailureReport = z.infer<typeof CodexJsonFailureReportSchema>;
export type CodexPatchFailureReport = z.infer<typeof CodexPatchFailureReportSchema>;
export type CodexChapterQualityReport = z.infer<typeof CodexChapterQualityReportSchema>;
export type CodexSingleChapterSmokeStage = z.infer<typeof CodexSingleChapterSmokeStageSchema>;
export type CodexSingleChapterSmokeReport = z.infer<typeof CodexSingleChapterSmokeReportSchema>;
export type CodexContextArtifact = z.infer<typeof CodexContextArtifactSchema>;
export type CodexContextManifest = z.infer<typeof CodexContextManifestSchema>;
