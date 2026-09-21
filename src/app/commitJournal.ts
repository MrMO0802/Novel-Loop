import path from 'node:path';

import { CommitJournalSchema } from '../schemas/index.js';
import type { CommitJournal, CommitJournalPhase } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError } from '../utils/AppError.js';

export interface CommitJournalHandle {
  absolutePath: string;
  relativePath: string;
  journal: CommitJournal;
}

export interface StartCommitJournalInput {
  paths: ProjectPaths;
  fileStore: FileStore;
  chapterNumber: number;
  commitKind: CommitJournal['commitKind'];
  provider: string;
  runId?: string | undefined;
  canonPatchPath?: string | undefined;
  latestCommittedChapterBefore?: number | undefined;
  latestCommittedChapterAfter?: number | undefined;
  desktopSubmission?: Pick<CommitJournal,
    'previewId' | 'previewManifestPath' | 'previewManifestHash' | 'approvalId'
    | 'approvalRecordPath' | 'approvalRecordHash' | 'sourceHash' | 'patchHash'
    | 'diffHash' | 'canonicalFinalPath' | 'beforeStateHash' | 'afterStateHash'>;
}

export interface UpdateCommitJournalInput {
  canonPatchPath?: string | undefined;
  beforeSnapshotId?: string | undefined;
  afterSnapshotId?: string | undefined;
  commitReportPath?: string | undefined;
  codexCommitReportPath?: string | undefined;
  latestCommittedChapterAfter?: number | undefined;
  stateWriteCompleted?: boolean | undefined;
  queueCommitted?: boolean | undefined;
}

export async function startCommitJournal(input: StartCommitJournalInput): Promise<CommitJournalHandle> {
  const artifact = await nextCommitJournalArtifact(input.paths, input.fileStore, input.chapterNumber);
  const now = new Date().toISOString();
  const journal = CommitJournalSchema.parse({
    ...input.desktopSubmission,
    journalId: `commit_journal_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
    projectId: input.paths.projectId,
    chapterNumber: input.chapterNumber,
    commitKind: input.commitKind,
    provider: input.provider,
    status: 'in_progress',
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    journalPath: artifact.relativePath,
    ...(input.canonPatchPath === undefined ? {} : { canonPatchPath: input.canonPatchPath }),
    storyStatePath: path.join('state', 'story_state.json'),
    ...(input.latestCommittedChapterBefore === undefined ? {} : { latestCommittedChapterBefore: input.latestCommittedChapterBefore }),
    ...(input.latestCommittedChapterAfter === undefined ? {} : { latestCommittedChapterAfter: input.latestCommittedChapterAfter }),
    stateWriteCompleted: false,
    queueCommitted: false,
    phases: [{ phase: 'prepared', status: 'completed', at: now }],
    generatedAt: now,
    updatedAt: now
  });
  await input.fileStore.writeJson(artifact.absolutePath, journal, CommitJournalSchema);
  return {
    absolutePath: artifact.absolutePath,
    relativePath: artifact.relativePath,
    journal
  };
}

export async function recordCommitJournalPhase(
  handle: CommitJournalHandle,
  fileStore: FileStore,
  phase: CommitJournalPhase,
  updates: UpdateCommitJournalInput = {},
  message?: string
): Promise<void> {
  const now = new Date().toISOString();
  const nextJournal = CommitJournalSchema.parse({
    ...handle.journal,
    ...definedUpdates(updates),
    status: phase === 'completed' ? 'completed' : phase === 'failed' ? 'failed' : handle.journal.status,
    phases: [
      ...handle.journal.phases,
      {
        phase,
        status: phase === 'failed' ? 'failed' : 'completed',
        at: now,
        ...(message === undefined ? {} : { message })
      }
    ],
    updatedAt: now
  });
  await fileStore.writeJson(handle.absolutePath, nextJournal, CommitJournalSchema);
  handle.journal = nextJournal;
}

export function isCompletedCommitJournal(journal: CommitJournal): boolean {
  if (journal.commitKind === 'desktop_controlled_commit') {
    if (!journal.previewId || !journal.previewManifestPath || !journal.previewManifestHash
      || !journal.approvalId || !journal.approvalRecordPath || !journal.approvalRecordHash
      || !journal.sourceHash || !journal.patchHash || !journal.diffHash || !journal.canonicalFinalPath
      || !journal.beforeStateHash || !journal.afterStateHash || !journal.runId || !journal.canonPatchPath) return false;
    const required: CommitJournalPhase[] = [
      'prepared', 'approval_recorded', 'canonical_final_written', 'canonical_patch_written',
      'before_snapshot_created', 'story_state_written', 'after_snapshot_created',
      'state_mutation_recorded', 'commit_report_written', 'queue_committed', 'completed'
    ];
    if (journal.phases.some(entry => entry.status === 'failed' || entry.phase === 'failed')
      || required.some((phase, index) => journal.phases[index]?.phase !== phase || journal.phases[index]?.status !== 'completed')) return false;
  }
  return (
    journal.status === 'completed' &&
    journal.stateWriteCompleted === true &&
    journal.queueCommitted === true &&
    journal.beforeSnapshotId !== undefined &&
    journal.afterSnapshotId !== undefined &&
    journal.commitReportPath !== undefined &&
    journal.phases.some((phase) => phase.phase === 'completed' && phase.status === 'completed')
  );
}

async function nextCommitJournalArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number
): Promise<{ version: number; absolutePath: string; relativePath: string }> {
  for (let version = 1; version < 1000; version += 1) {
    const fileName = `commit_journal_v${version}.json`;
    const absolutePath = paths.chapterArtifact(chapterNumber, fileName);
    if (!(await fileStore.exists(absolutePath))) {
      return {
        version,
        absolutePath,
        relativePath: relativeChapterArtifact(chapterNumber, fileName)
      };
    }
  }
  throw new AppError('COMMIT_JOURNAL_VERSION_EXHAUSTED', `Could not allocate commit journal for chapter ${chapterNumber}.`, 1, {
    chapterNumber,
    stage: 'commit'
  });
}

function definedUpdates(updates: UpdateCommitJournalInput): Partial<CommitJournal> {
  const result: Partial<CommitJournal> = {};
  if (updates.canonPatchPath !== undefined) result.canonPatchPath = updates.canonPatchPath;
  if (updates.beforeSnapshotId !== undefined) result.beforeSnapshotId = updates.beforeSnapshotId;
  if (updates.afterSnapshotId !== undefined) result.afterSnapshotId = updates.afterSnapshotId;
  if (updates.commitReportPath !== undefined) result.commitReportPath = updates.commitReportPath;
  if (updates.codexCommitReportPath !== undefined) result.codexCommitReportPath = updates.codexCommitReportPath;
  if (updates.latestCommittedChapterAfter !== undefined) result.latestCommittedChapterAfter = updates.latestCommittedChapterAfter;
  if (updates.stateWriteCompleted !== undefined) result.stateWriteCompleted = updates.stateWriteCompleted;
  if (updates.queueCommitted !== undefined) result.queueCommitted = updates.queueCommitted;
  return result;
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, fileName);
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}
