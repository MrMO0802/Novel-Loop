import { z } from 'zod';

import { PatchConflictReportSchema } from './canonPatch.js';
import { SnapshotMetaSchema } from './snapshot.js';

export const CommitReportSchema = z.object({
  chapterNumber: z.number().int().positive(),
  status: z.literal('committed'),
  canonPatchPath: z.string(),
  storyStatePath: z.string(),
  beforeSnapshot: SnapshotMetaSchema,
  afterSnapshot: SnapshotMetaSchema,
  conflicts: PatchConflictReportSchema,
  repaired: z.boolean().default(false),
  originalPatchPath: z.string().optional(),
  repairedPatchPath: z.string().optional(),
  conflictReportPath: z.string().optional(),
  conflictRepairReportPath: z.string().optional(),
  appliedChanges: z.object({
    canonFactsAdded: z.number().int().nonnegative(),
    characterStatesUpserted: z.number().int().nonnegative(),
    characterUpdatesApplied: z.number().int().nonnegative(),
    timelineEventsAdded: z.number().int().nonnegative(),
    readerStateChanges: z.number().int().nonnegative(),
    narrativeDebtsChanged: z.number().int().nonnegative(),
    foreshadowingChanged: z.number().int().nonnegative(),
    relationshipEdgesChanged: z.number().int().nonnegative(),
    latestCommittedChapter: z.object({
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative()
    })
  }),
  committedAt: z.string()
});

export const CodexCommitReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  provider: z.literal('codex-text'),
  controlledCommit: z.literal(true),
  confirmed: z.boolean(),
  canonPatchPath: z.string(),
  stateDiffPath: z.string(),
  approvalRecordPath: z.string().optional(),
  commitReportPath: z.string().optional(),
  beforeSnapshotId: z.string().optional(),
  afterSnapshotId: z.string().optional(),
  conflictCheckPassed: z.boolean(),
  schemaValidationPassed: z.boolean(),
  committed: z.boolean(),
  previewOnly: z.boolean(),
  latestCommittedChapterBefore: z.number().int().nonnegative(),
  latestCommittedChapterAfter: z.number().int().nonnegative(),
  generatedAt: z.string()
});

export const CodexCommitConsistencyReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  previewPatchPath: z.string(),
  previewNormalizedPatchPath: z.string().optional(),
  confirmedPatchPath: z.string().optional(),
  previewStateDiffPath: z.string(),
  previewStateDiffMarkdownPath: z.string().optional(),
  confirmedStateDiffPath: z.string().optional(),
  previewStoryStateHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmedStoryStateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  patchesEquivalent: z.boolean().optional(),
  stateDiffsEquivalent: z.boolean().optional(),
  reusedPreviewArtifacts: z.boolean().optional(),
  warnings: z.array(z.string()).default([]),
  generatedAt: z.string(),
  updatedAt: z.string().optional()
});

export const CommitJournalPhaseSchema = z.enum([
  'prepared',
  'approval_recorded',
  'canonical_patch_written',
  'before_snapshot_created',
  'story_state_written',
  'after_snapshot_created',
  'state_mutation_recorded',
  'commit_report_written',
  'codex_commit_report_written',
  'queue_committed',
  'completed',
  'failed'
]);

export const CommitJournalPhaseStatusSchema = z.enum(['completed', 'failed']);

export const CommitJournalEntrySchema = z.object({
  phase: CommitJournalPhaseSchema,
  status: CommitJournalPhaseStatusSchema,
  at: z.string(),
  message: z.string().optional()
});

export const CommitJournalSchema = z.object({
  journalId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  commitKind: z.enum(['chapter_commit', 'codex_controlled_commit']),
  provider: z.string(),
  status: z.enum(['in_progress', 'completed', 'failed']),
  runId: z.string().optional(),
  journalPath: z.string(),
  canonPatchPath: z.string().optional(),
  storyStatePath: z.string().default('state/story_state.json'),
  beforeSnapshotId: z.string().optional(),
  afterSnapshotId: z.string().optional(),
  commitReportPath: z.string().optional(),
  codexCommitReportPath: z.string().optional(),
  latestCommittedChapterBefore: z.number().int().nonnegative().optional(),
  latestCommittedChapterAfter: z.number().int().nonnegative().optional(),
  stateWriteCompleted: z.boolean(),
  queueCommitted: z.boolean(),
  phases: z.array(CommitJournalEntrySchema).min(1),
  generatedAt: z.string(),
  updatedAt: z.string()
});

export type CommitReport = z.infer<typeof CommitReportSchema>;
export type CodexCommitReport = z.infer<typeof CodexCommitReportSchema>;
export type CodexCommitConsistencyReport = z.infer<typeof CodexCommitConsistencyReportSchema>;
export type CommitJournal = z.infer<typeof CommitJournalSchema>;
export type CommitJournalPhase = z.infer<typeof CommitJournalPhaseSchema>;
