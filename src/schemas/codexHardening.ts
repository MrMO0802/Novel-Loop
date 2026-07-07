import { z } from 'zod';

import { DiagnosticsNormalizationWarningSchema } from './diagnostics.js';

export const CodexErrorTypeSchema = z.enum([
  'CODEX_BINARY_MISSING',
  'CODEX_NOT_LOGGED_IN',
  'CODEX_DOCTOR_UNHEALTHY_NON_BLOCKING',
  'CODEX_EXEC_FAILED',
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
    'unsupported_old_manifest'
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
  durationMs: z.number().int().nonnegative(),
  parentPromptCallId: z.string().optional(),
  parentPromptId: z.string().optional(),
  parentStage: z.string().optional(),
  parentRunId: z.string().optional(),
  attributionMode: CodexAttributionModeSchema,
  attributionConfidence: CodexAttributionConfidenceSchema,
  attributionReason: z.string(),
  rawOutputPath: z.string().optional(),
  finalOutputPath: z.string().optional(),
  parsedOutputPath: z.string().optional()
});

const CodexWrapperBreakdownSchema = z.object({
  totalWrapperCalls: z.number().int().nonnegative(),
  totalWrapperDurationMs: z.number().int().nonnegative(),
  orphanWrapperCallCount: z.number().int().nonnegative(),
  byWrapperType: z.array(CodexProfileMetricItemSchema).default([]),
  byParentStage: z.array(CodexProfileMetricItemSchema).default([]),
  byParentPromptId: z.array(CodexProfileMetricItemSchema).default([]),
  orphanWrapperCalls: z.array(CodexWrapperCallProfileSchema).default([]),
  inferredWrapperCalls: z.array(CodexWrapperCallProfileSchema).default([])
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
    inferredWrapperCalls: []
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
  improvedStages: z.array(z.string()),
  regressedStages: z.array(z.string()),
  notes: z.array(z.string())
});

export type CodexErrorType = z.infer<typeof CodexErrorTypeSchema>;
export type CodexJsonFailureAttempt = z.infer<typeof CodexJsonFailureAttemptSchema>;
export type CodexJsonFailureReport = z.infer<typeof CodexJsonFailureReportSchema>;
export type CodexPatchFailureReport = z.infer<typeof CodexPatchFailureReportSchema>;
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
export type CodexStageRuntimeProfileReport = z.infer<typeof CodexStageRuntimeProfileReportSchema>;
export type CodexCrossChapterLink = z.infer<typeof CodexCrossChapterLinkSchema>;
export type CodexCrossChapterContinuityReport = z.infer<typeof CodexCrossChapterContinuityReportSchema>;
export type CodexPromptAuditIssue = z.infer<typeof CodexPromptAuditIssueSchema>;
export type CodexPromptAuditReport = z.infer<typeof CodexPromptAuditReportSchema>;
export type CodexCallReductionReport = z.infer<typeof CodexCallReductionReportSchema>;
export type CodexRuntimeOptimizationReport = z.infer<typeof CodexRuntimeOptimizationReportSchema>;
export type CodexBusinessOptimizationPlan = z.infer<typeof CodexBusinessOptimizationPlanSchema>;
