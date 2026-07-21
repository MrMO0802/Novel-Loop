import { z } from 'zod';

import { ConflictItemSchema } from './conflictRecovery.js';

export const StateDiffChangeSchema = z.object({
  mutationId: z.string().min(1).optional(),
  path: z.string(),
  changeType: z.enum(['added', 'removed', 'modified', 'unchanged']),
  before: z.unknown().optional().default(null),
  after: z.unknown().optional().default(null),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  explanation: z.string()
});

export const StateDiffReportSchema = z.object({
  diffId: z.string(),
  projectId: z.string(),
  mode: z.enum(['snapshot_to_snapshot', 'patch_preview']),
  fromSnapshot: z.string().optional(),
  toSnapshot: z.string().optional(),
  patchPath: z.string().optional(),
  generatedAt: z.string(),
  unsafeToCommit: z.boolean().default(false),
  summary: z.object({
    totalChanges: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    modified: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    highRiskChanges: z.number().int().nonnegative()
  }),
  changes: z.array(StateDiffChangeSchema)
});

export const ManualReviewReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  finalPath: z.string(),
  diagnosticsSummary: z.string(),
  conflictSummary: z.string(),
  queueStatus: z.string(),
  suggestedActions: z.array(z.string()),
  generatedAt: z.string()
});

export const RecommitReportSchema = z.object({
  recommitId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  sourceType: z.enum(['final', 'patch']),
  sourcePath: z.string(),
  generatedPatchPath: z.string(),
  stateDiffPath: z.string(),
  beforeSnapshotId: z.string().optional(),
  afterSnapshotId: z.string().optional(),
  conflictsDetected: z.number().int().nonnegative(),
  repaired: z.boolean(),
  committed: z.boolean(),
  confirmed: z.boolean(),
  historicalRecommit: z.boolean(),
  oldLatestCommittedChapter: z.number().int().nonnegative().optional(),
  newLatestCommittedChapter: z.number().int().nonnegative().optional(),
  baseSnapshotId: z.string().optional(),
  downstreamInvalidationReportPath: z.string().optional(),
  regenerationPlanPath: z.string().optional(),
  downstreamInvalidated: z.boolean(),
  generatedAt: z.string()
});

export const ApprovalRecordSchema = z.object({
  approvalId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  action: z.enum(['recommit', 'historical_recommit', 'manual_patch_commit', 'codex_controlled_commit']),
  provider: z.literal('codex-text').optional(),
  stateDiffPath: z.string().optional(),
  canonPatchPath: z.string().optional(),
  confirmed: z.boolean(),
  confirmedAt: z.string(),
  note: z.string().optional(),
  operator: z.literal('local_user'),
  command: z.string(),
  riskAcknowledged: z.boolean()
});

export const InvalidatedChapterSchema = z.object({
  chapterNumber: z.number().int().positive(),
  previousStatus: z.string(),
  newStatus: z.literal('stale_due_to_history_edit'),
  artifactPath: z.string(),
  oldCommitReportPath: z.string().optional(),
  oldCanonPatchPath: z.string().optional(),
  oldFinalPath: z.string().optional(),
  invalidationReason: z.string(),
  canRegenerate: z.boolean(),
  requiresHumanReview: z.boolean()
});

export const DownstreamInvalidationReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  editedChapterNumber: z.number().int().positive(),
  oldLatestCommittedChapter: z.number().int().nonnegative(),
  newLatestCommittedChapter: z.number().int().nonnegative(),
  baseSnapshotId: z.string(),
  beforeSnapshotId: z.string().optional(),
  afterSnapshotId: z.string().optional(),
  historicalRecommitReportPath: z.string().optional(),
  invalidatedChapters: z.array(InvalidatedChapterSchema),
  generatedAt: z.string(),
  reason: z.string(),
  regenerationRequired: z.boolean(),
  suggestedNextCommand: z.string()
});

export const RegenerationTargetChapterSchema = z.object({
  chapterNumber: z.number().int().positive(),
  previousStatus: z.string(),
  regenerationMode: z.string(),
  oldArtifactsArchived: z.boolean(),
  requiredInputs: z.array(z.string()),
  risks: z.array(z.string()),
  suggestedCommand: z.string()
});

export const RegenerationPlanSchema = z.object({
  planId: z.string(),
  projectId: z.string(),
  startsFromChapter: z.number().int().positive(),
  targetChapters: z.array(RegenerationTargetChapterSchema),
  basedOnStateSnapshotId: z.string(),
  generatedAt: z.string(),
  strategy: z.enum(['regenerate_all_downstream', 'regenerate_until_existing_outline_end', 'regenerate_selected', 'human_review_first']),
  reusePolicy: z.enum([
    'do_not_reuse_old_chapter_text',
    'reuse_old_chapter_as_reference_only',
    'preserve_scene_structure_if_still_valid',
    'preserve_nothing'
  ]),
  staleChapters: z.array(z.number().int().positive()),
  blockedChapters: z.array(z.number().int().positive()),
  recommendedCommands: z.array(z.string())
});

export const HistoricalRecommitReportSchema = RecommitReportSchema.extend({
  historicalRecommit: z.literal(true),
  oldLatestCommittedChapter: z.number().int().nonnegative(),
  newLatestCommittedChapter: z.number().int().nonnegative(),
  baseSnapshotId: z.string(),
  beforeSnapshotId: z.string(),
  afterSnapshotId: z.string(),
  downstreamInvalidationReportPath: z.string(),
  regenerationPlanPath: z.string(),
  downstreamInvalidated: z.literal(true)
});

export const ArchivedArtifactSchema = z.object({
  originalPath: z.string(),
  archivedPath: z.string(),
  artifactType: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative()
});

export const ArchiveManifestSchema = z
  .object({
    archiveId: z.string().optional(),
    manifestId: z.string().optional(),
    projectId: z.string(),
    chapterNumber: z.number().int().positive(),
    archiveReason: z.string().optional(),
    reason: z.string().optional(),
    invalidatedByChapter: z.number().int().positive().optional(),
    invalidatedByReportPath: z.string().optional(),
    createdAt: z.string(),
    sourceArtifactRoot: z.string().optional(),
    copiedArtifacts: z.array(ArchivedArtifactSchema).default([]),
    missingArtifacts: z.array(z.string()).default([]),
    fileHashes: z.array(ArchivedArtifactSchema).default([]),
    oldStatus: z.string().optional(),
    newRegenerationRunId: z.string().optional(),
    notes: z.array(z.string()).default([]),
    oldArtifacts: z.array(z.string()).default([]),
    invalidationReportPath: z.string().optional()
  })
  .transform((manifest) => ({
    ...manifest,
    archiveId: manifest.archiveId ?? manifest.manifestId ?? `archive_ch${String(manifest.chapterNumber).padStart(3, '0')}`,
    archiveReason: manifest.archiveReason ?? manifest.reason ?? 'archive',
    sourceArtifactRoot: manifest.sourceArtifactRoot ?? `chapters/chapter_${String(manifest.chapterNumber).padStart(3, '0')}`,
    fileHashes: manifest.fileHashes.length === 0 ? manifest.copiedArtifacts : manifest.fileHashes
  }));

export const ManualConflictReportSchema = z.object({
  conflicts: z.array(ConflictItemSchema)
});

export type StateDiffChange = z.infer<typeof StateDiffChangeSchema>;
export type StateDiffReport = z.infer<typeof StateDiffReportSchema>;
export type ManualReviewReport = z.infer<typeof ManualReviewReportSchema>;
export type RecommitReport = z.infer<typeof RecommitReportSchema>;
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
export type InvalidatedChapter = z.infer<typeof InvalidatedChapterSchema>;
export type DownstreamInvalidationReport = z.infer<typeof DownstreamInvalidationReportSchema>;
export type RegenerationTargetChapter = z.infer<typeof RegenerationTargetChapterSchema>;
export type RegenerationPlan = z.infer<typeof RegenerationPlanSchema>;
export type HistoricalRecommitReport = z.infer<typeof HistoricalRecommitReportSchema>;
export type ArchivedArtifact = z.infer<typeof ArchivedArtifactSchema>;
export type ArchiveManifest = z.infer<typeof ArchiveManifestSchema>;
