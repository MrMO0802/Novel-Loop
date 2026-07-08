import { z } from 'zod';

export const ArtifactStatusSchema = z.enum(['active', 'archived', 'stale', 'missing', 'invalid']);

export const ArtifactTypeSchema = z.enum([
  'brief',
  'config',
  'story_state',
  'story_bible',
  'genre_contract',
  'reader_promise',
  'style_guide',
  'global_outline',
  'volume_outline',
  'arc_map',
  'chapter_queue',
  'mission',
  'plan_candidate',
  'ranking',
  'selected_plan',
  'scene_card',
  'scene_draft',
  'draft',
  'diagnostics',
  'revision_plan',
  'final',
  'canon_patch',
  'commit_report',
  'commit_journal',
  'conflict_report',
  'repair_plan',
  'repaired_patch',
  'manual_review_report',
  'recommit_report',
  'approval_record',
  'downstream_invalidation_report',
  'historical_recommit_report',
  'regeneration_plan',
  'state_diff',
  'snapshot',
  'archive_manifest',
  'run_manifest',
  'event_log',
  'prompt_artifact',
  'retention_report',
  'compaction_report',
  'codex_raw_output',
  'codex_final_output',
  'codex_parsed_json',
  'codex_context_manifest',
  'codex_patch_failure_report',
  'codex_chapter_quality_report',
  'codex_chapter_context_summary',
  'final_assembly_report',
  'build_bible_cache_report',
  'codex_single_chapter_smoke_report',
  'codex_multi_chapter_pilot_report',
  'codex_cross_chapter_drift_report',
  'codex_cross_chapter_continuity_report',
  'codex_budget_report',
  'codex_call_reduction_report',
  'codex_prompt_audit_report',
  'codex_stage_runtime_profile_report',
  'codex_business_optimization_plan',
  'codex_runtime_benchmark_report',
  'codex_runtime_optimization_report',
  'codex_real_optimization_benchmark_report',
  'codex_chapter_regression_analysis',
  'codex_runtime_gap_report',
  'codex_mission_retry_report',
  'codex_mission_micro_benchmark_report',
  'mission_schema_diagnostics_report',
  'codex_runtime_failure_report'
]);

export const CodexSafetyPolicySchema = z.object({
  sandbox: z.literal('read-only'),
  workspaceWriteAllowed: z.literal(false),
  shellCommandsAllowed: z.literal(false),
  storyStateCommitAllowed: z.literal(false),
  authFilesRead: z.literal(false)
});

export const CodexExecReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  runId: z.string(),
  operation: z.enum(['status', 'smoke', 'exec-text', 'exec-json']),
  binaryPath: z.string(),
  sandbox: z.literal('read-only'),
  startedAt: z.string(),
  endedAt: z.string(),
  latencyMs: z.number().nonnegative(),
  promptPath: z.string().optional(),
  schemaPath: z.string().optional(),
  rawOutputPath: z.string().optional(),
  finalOutputPath: z.string().optional(),
  parsedJsonPath: z.string().optional(),
  safety: CodexSafetyPolicySchema
});

export const PerformanceStatsSchema = z
  .object({
    durationMs: z.number().nonnegative(),
    fileCount: z.number().int().nonnegative().default(0),
    artifactCount: z.number().int().nonnegative().default(0),
    runManifestCount: z.number().int().nonnegative().default(0),
    eventLogCount: z.number().int().nonnegative().default(0),
    archiveCount: z.number().int().nonnegative().default(0),
    snapshotCount: z.number().int().nonnegative().default(0),
    hashedBytes: z.number().int().nonnegative().default(0)
  })
  .default({
    durationMs: 0,
    fileCount: 0,
    artifactCount: 0,
    runManifestCount: 0,
    eventLogCount: 0,
    archiveCount: 0,
    snapshotCount: 0,
    hashedBytes: 0
  });

export const ArtifactIndexItemSchema = z.object({
  artifactId: z.string(),
  chapterNumber: z.number().int().positive().optional(),
  artifactType: ArtifactTypeSchema,
  phase: z.string(),
  path: z.string(),
  runId: z.string().optional(),
  createdAt: z.string().optional(),
  modifiedAt: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  schemaName: z.string().optional(),
  status: ArtifactStatusSchema,
  provenance: z.string()
});

export const ArtifactIndexSchema = z.object({
  projectId: z.string(),
  generatedAt: z.string(),
  artifacts: z.array(ArtifactIndexItemSchema),
  performance: PerformanceStatsSchema
});

export const AuditIssueSchema = z.object({
  issueId: z.string(),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  category: z.string(),
  path: z.string(),
  message: z.string(),
  suggestedFix: z.string(),
  blocking: z.boolean()
});

export const AuditSummarySchema = z.object({
  totalIssues: z.number().int().nonnegative(),
  bySeverity: z.object({
    info: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative()
  })
});

export const SnapshotAuditReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  ok: z.boolean(),
  snapshotsChecked: z.number().int().nonnegative(),
  requiredBaseSnapshotsMissing: z.number().int().nonnegative(),
  issues: z.array(AuditIssueSchema)
});

export const ProjectAuditReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  strict: z.boolean(),
  ok: z.boolean(),
  summary: AuditSummarySchema,
  issues: z.array(AuditIssueSchema),
  artifactIndexPath: z.string().optional(),
  performance: PerformanceStatsSchema
});

export const RetentionPolicySchema = z.object({
  keepRuns: z.number().int().positive(),
  keepArchivesPerChapter: z.number().int().nonnegative().default(2)
});

export const RetentionReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  applied: z.boolean(),
  policy: RetentionPolicySchema,
  candidateRunIds: z.array(z.string()),
  retainedRunIds: z.array(z.string()),
  keptRunIds: z.array(z.string()),
  candidateArchivePaths: z.array(z.string()).default([]),
  retainedArchivePaths: z.array(z.string()).default([]),
  keptArchivePaths: z.array(z.string()).default([]),
  reportPath: z.string().optional(),
  notes: z.array(z.string()).default([])
});

export const ProvenanceCompactionReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  applied: z.boolean(),
  maxEventsPerRun: z.number().int().positive(),
  scannedRuns: z.number().int().nonnegative(),
  compactedRuns: z.array(
    z.object({
      runId: z.string(),
      originalEventCount: z.number().int().nonnegative(),
      compactedEventCount: z.number().int().nonnegative(),
      eventsPath: z.string(),
      originalEventsPath: z.string().optional()
    })
  ),
  totalEventsRemoved: z.number().int().nonnegative(),
  reportPath: z.string().optional(),
  notes: z.array(z.string()).default([])
});

export const ReusePolicySchema = z.enum([
  'preserve_nothing',
  'reference_only',
  'preserve_scene_structure_if_valid',
  'preserve_final_text_if_unaffected'
]);

export const ReusePolicyReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  requestedPolicy: ReusePolicySchema,
  effectivePolicy: ReusePolicySchema,
  oldArtifactsReferenced: z.array(z.string()),
  oldArtifactsCopiedToArchive: z.array(z.string()),
  validityChecks: z.array(
    z.object({
      checkId: z.string(),
      passed: z.boolean(),
      message: z.string()
    })
  ),
  downgradeReason: z.string().optional(),
  generatedAt: z.string()
});

export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type CodexSafetyPolicy = z.infer<typeof CodexSafetyPolicySchema>;
export type CodexExecReport = z.infer<typeof CodexExecReportSchema>;
export type ArtifactIndexItem = z.infer<typeof ArtifactIndexItemSchema>;
export type ArtifactIndex = z.infer<typeof ArtifactIndexSchema>;
export type AuditIssue = z.infer<typeof AuditIssueSchema>;
export type SnapshotAuditReport = z.infer<typeof SnapshotAuditReportSchema>;
export type ProjectAuditReport = z.infer<typeof ProjectAuditReportSchema>;
export type ReusePolicy = z.infer<typeof ReusePolicySchema>;
export type ReusePolicyReport = z.infer<typeof ReusePolicyReportSchema>;
export type PerformanceStats = z.infer<typeof PerformanceStatsSchema>;
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;
export type RetentionReport = z.infer<typeof RetentionReportSchema>;
export type ProvenanceCompactionReport = z.infer<typeof ProvenanceCompactionReportSchema>;
