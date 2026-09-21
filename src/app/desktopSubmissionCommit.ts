import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

import { RunLogger, hashJson } from '../logging/RunLogger.js';
import {
  CanonPatchSchema, ChapterQueueSchema, CommitJournalSchema, CommitReportSchema,
  DesktopSubmissionApprovalSchema, DesktopSubmissionPreviewSchema, RunManifestV2Schema, StoryStateSchema
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { SnapshotStore } from '../storage/SnapshotStore.js';
import { applyCanonPatchToStoryState, checkPatchConflicts } from './chapterCommit.js';
import { ChapterQueueStore, validateChapterQueueConsistency } from './chapterQueue.js';
import { isCompletedCommitJournal, recordCommitJournalPhase, startCommitJournal, type CommitJournalHandle } from './commitJournal.js';
import { verifyDesktopSubmissionPreviewIntegrity } from './desktopSubmissionPreview.js';
import { readExactSubmissionText, SubmissionError, submissionChapterPath, submissionHash, submissionStore } from './desktopSubmissionSource.js';
import { withProjectChapterOperationLease } from './projectOperationLease.js';

const Identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const ConfirmInputSchema = z.object({
  projectRoot: z.string().min(1), chapterNumber: z.number().int().positive(),
  previewId: Identifier, expectedManifestHash: z.string().regex(/^[a-f0-9]{64}$/u),
  approvalId: Identifier, confirm: z.literal(true)
}).strict();

export type SubmissionConfirmInput = z.infer<typeof ConfirmInputSchema>;
export interface SubmissionConfirmResult {
  chapterNumber: number;
  latestCommittedChapter: number;
  commitReportPath: string;
  hasNextChapter: boolean;
}

// Only the application service accepts test dependencies; the desktop facade has one argument.
export async function confirmSubmissionCommit(inputValue: SubmissionConfirmInput, dependencies: { fileStore?: FileStore } = {}): Promise<SubmissionConfirmResult> {
  const input = ConfirmInputSchema.parse(inputValue);
  const projectRoot = path.resolve(input.projectRoot);
  const paths = new ProjectPaths(path.dirname(projectRoot), path.basename(projectRoot));
  const store = submissionStore(projectRoot, dependencies.fileStore);
  await store.assertSafePath(projectRoot);
  return withProjectChapterOperationLease({ projectRoot, chapterNumber: input.chapterNumber, operation: 'desktop_submission_commit', allowStoryStateWrite: true }, async () => {
    await assertJournalBarrier(paths, store, input.chapterNumber);
    const beforeState = await store.readJson(paths.storyState(), StoryStateSchema);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    if (input.chapterNumber !== beforeState.latestCommittedChapter + 1) throw new SubmissionError('already_committed');
    if (validateChapterQueueConsistency(queue, beforeState).length > 0) throw new SubmissionError('recovery_required');
    const target = queue.chapters.find(item => item.chapterNumber === input.chapterNumber)!;
    const eligible = ['draft_ready', 'diagnosing', 'revision_required', 'revising', 'final_ready', 'patch_extracted', 'failed', 'blocked', 'needs_human_review'];
    if (!eligible.includes(target.status)) throw new SubmissionError('source_stale');
    const previewParent = submissionChapterPath(input.chapterNumber, 'submission_previews');
    const versions = (await store.list(paths.projectArtifact(previewParent)))
      .filter(name => /^preview_v[1-9]\d*$/u.test(name)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
    if (versions[0] === undefined) throw new SubmissionError('source_stale');
    const previewRoot = path.posix.join(previewParent, versions[0]);
    const previewManifestPath = path.posix.join(previewRoot, 'manifest.json');
    const manifestText = await readExactSubmissionText(store, paths.projectArtifact(previewManifestPath));
    if (submissionHash(manifestText) !== input.expectedManifestHash) throw new SubmissionError('source_stale');
    const preview = DesktopSubmissionPreviewSchema.parse(JSON.parse(manifestText));
    if (preview.previewId !== input.previewId || preview.projectId !== paths.projectId || preview.chapterNumber !== input.chapterNumber
      || `preview_v${preview.version}` !== versions[0]) throw new SubmissionError('source_stale');
    const verified = await verifyDesktopSubmissionPreviewIntegrity(preview, projectRoot, store);
    // The verifier's trial apply can mutate its returned patch. Use the exact reviewed artifact.
    const patchText = await readExactSubmissionText(store, paths.projectArtifact(preview.artifacts.patch.path));
    if (submissionHash(patchText) !== preview.artifacts.patch.hash) throw new SubmissionError('source_stale');
    const reviewedPatch = CanonPatchSchema.parse(JSON.parse(patchText));
    const conflicts = checkPatchConflicts(beforeState, reviewedPatch);
    const applied = applyCanonPatchToStoryState(beforeState, structuredClone(reviewedPatch));
    StoryStateSchema.parse(applied.storyState);
    if (conflicts.hard.length > 0 || applied.storyState.latestCommittedChapter !== input.chapterNumber) throw new SubmissionError('patch_conflict');
    const finalPath = submissionChapterPath(input.chapterNumber, 'final.md');
    const patchPath = submissionChapterPath(input.chapterNumber, 'canon_patch.json');
    const commitReportPath = submissionChapterPath(input.chapterNumber, 'commit_report.json');
    const approvalRecordPath = path.posix.join(previewRoot, 'approval.json');
    for (const p of [finalPath, patchPath, commitReportPath, approvalRecordPath]) await assertAbsent(store, paths.projectArtifact(p));
    const runId = `desktop_commit_${randomUUID()}`;
    await assertAbsent(store, paths.runDir(runId));
    const approval = DesktopSubmissionApprovalSchema.parse({
      schemaVersion: 1, approvalId: input.approvalId, previewId: preview.previewId,
      projectId: paths.projectId, chapterNumber: input.chapterNumber,
      sourceHash: preview.source.sourceHash, manifestHash: input.expectedManifestHash,
      patchHash: preview.artifacts.patch.hash, diffHash: preview.artifacts.diff.hash,
      confirmed: true, approvedAt: new Date().toISOString(), runId
    });
    const approvalText = jsonText(approval);
    const logger = new RunLogger(paths, store);
    const queueStore = new ChapterQueueStore(paths, store);
    // SnapshotStore chooses random names; still reject a collision instead of replacing evidence.
    const snapshotStore = new SnapshotStore(paths, new class extends FileStore {
      override async writeText(p: string, text: string) { await writeNewText(store, p, text); }
    }());
    let journal: CommitJournalHandle | undefined;
    try {
      journal = await startCommitJournal({
        paths, fileStore: store, chapterNumber: input.chapterNumber,
        commitKind: 'desktop_controlled_commit', provider: 'local', runId,
        canonPatchPath: patchPath, latestCommittedChapterBefore: beforeState.latestCommittedChapter,
        latestCommittedChapterAfter: applied.storyState.latestCommittedChapter,
        desktopSubmission: {
          previewId: preview.previewId, previewManifestPath, previewManifestHash: input.expectedManifestHash,
          approvalId: approval.approvalId, approvalRecordPath, approvalRecordHash: submissionHash(approvalText),
          sourceHash: approval.sourceHash, patchHash: approval.patchHash, diffHash: approval.diffHash,
          canonicalFinalPath: finalPath, beforeStateHash: hashJson(beforeState), afterStateHash: hashJson(applied.storyState)
        }
      });
      await writeNewText(store, paths.projectArtifact(approvalRecordPath), approvalText);
      await recordCommitJournalPhase(journal, store, 'approval_recorded');
      await writeNewText(store, paths.projectArtifact(finalPath), verified.sourceText);
      await recordCommitJournalPhase(journal, store, 'canonical_final_written');
      await writeNewText(store, paths.projectArtifact(patchPath), patchText);
      await recordCommitJournalPhase(journal, store, 'canonical_patch_written');
      const beforeSnapshot = await snapshotStore.createSnapshot(beforeState, { reason: `before_chapter_${input.chapterNumber}_commit`, sourceChapter: input.chapterNumber, runId });
      await recordCommitJournalPhase(journal, store, 'before_snapshot_created', { beforeSnapshotId: beforeSnapshot.snapshotId });
      await store.writeJson(paths.storyState(), applied.storyState, StoryStateSchema);
      await recordCommitJournalPhase(journal, store, 'story_state_written', { stateWriteCompleted: true });
      const afterSnapshot = await snapshotStore.createSnapshot(applied.storyState, { reason: `after_chapter_${input.chapterNumber}_commit`, sourceChapter: input.chapterNumber, runId });
      await recordCommitJournalPhase(journal, store, 'after_snapshot_created', { afterSnapshotId: afterSnapshot.snapshotId });
      const run = await logger.startRun({ runId, command: 'desktop-submission-commit', args: { chapterNumber: input.chapterNumber, provider: 'local', commit: true } });
      // Provenance is persisted after state; its before-context comes from the captured preflight.
      run.resolvedContext.latestCommittedChapterBefore = beforeState.latestCommittedChapter;
      await store.writeJson(paths.runManifest(runId), run, RunManifestV2Schema);
      await logger.recordSnapshot(runId, beforeSnapshot, beforeState);
      await logger.recordSnapshot(runId, afterSnapshot, applied.storyState);
      await logger.recordStateMutation(runId, {
        mutationType: 'apply_canon_patch', chapterNumber: input.chapterNumber, patchPath,
        beforeSnapshotId: beforeSnapshot.snapshotId, afterSnapshotId: afterSnapshot.snapshotId,
        beforeStateHash: hashJson(beforeState), afterStateHash: hashJson(applied.storyState),
        latestCommittedChapterBefore: beforeState.latestCommittedChapter, latestCommittedChapterAfter: applied.storyState.latestCommittedChapter,
        conflictCheckPassed: true, schemaValidationPassed: true, applied: true
      });
      for (const artifact of [approvalRecordPath, finalPath, patchPath]) {
        await logger.recordArtifact(runId, artifact, { stage: 'commit', sourcePaths: [previewManifestPath], derivedFrom: [preview.runId] });
      }
      await recordCommitJournalPhase(journal, store, 'state_mutation_recorded');
      const report = CommitReportSchema.parse({
        chapterNumber: input.chapterNumber, status: 'committed', canonPatchPath: patchPath,
        storyStatePath: 'state/story_state.json', beforeSnapshot, afterSnapshot,
        conflicts, repaired: false, appliedChanges: applied.appliedChanges, committedAt: new Date().toISOString()
      });
      await writeNewText(store, paths.projectArtifact(commitReportPath), jsonText(report));
      await recordCommitJournalPhase(journal, store, 'commit_report_written', { commitReportPath });
      // Replay the proven pipeline milestones only after the canonical artifacts exist.
      await queueStore.markStageComplete(input.chapterNumber, 'diagnosing', 'diagnostics', runId, [target.status], [target.currentStage]);
      await queueStore.markStageComplete(input.chapterNumber, 'final_ready', 'final', runId, ['diagnosing'], ['diagnostics']);
      await queueStore.markStageComplete(input.chapterNumber, 'patch_extracted', 'canon_patch', runId, ['final_ready'], ['final']);
      await queueStore.markCommitted(input.chapterNumber, runId);
      await recordCommitJournalPhase(journal, store, 'queue_committed', { queueCommitted: true });
      await logger.recordArtifact(runId, commitReportPath, { stage: 'commit', sourcePaths: [patchPath, approvalRecordPath] });
      await logger.endRun(runId, 'completed');
      await recordCommitJournalPhase(journal, store, 'completed');
      return { chapterNumber: input.chapterNumber, latestCommittedChapter: applied.storyState.latestCommittedChapter, commitReportPath,
        hasNextChapter: queue.chapters.some(item => item.chapterNumber === input.chapterNumber + 1 && item.committedAt === null && item.status !== 'stale_due_to_history_edit') };
    } catch {
      if (journal !== undefined) {
        try { await recordCommitJournalPhase(journal, store, 'failed', {}, 'recovery_required'); }
        catch { /* The previously persisted incomplete journal remains the recovery barrier. */ }
      }
      // This includes a prepared write that reached disk but threw before returning its handle.
      throw new SubmissionError('recovery_required');
    }
  });
}

async function assertJournalBarrier(paths: ProjectPaths, store: FileStore, chapterNumber: number): Promise<void> {
  let completedTarget = false;
  for (const directory of await store.list(paths.chaptersDir())) {
    const chapterMatch = /^chapter_(\d{3,})$/u.exec(directory);
    if (chapterMatch === null) continue;
    for (const name of await store.list(path.join(paths.chaptersDir(), directory))) {
      const match = /^commit_journal_v([1-9]\d*)\.json$/u.exec(name);
      if (match === null) continue;
      const relativePath = path.posix.join('chapters', directory, name);
      try {
        const journal = CommitJournalSchema.parse(JSON.parse(await readExactSubmissionText(store, paths.projectArtifact(relativePath))));
        if (journal.projectId !== paths.projectId || journal.chapterNumber !== Number(chapterMatch[1])
          || journal.journalPath !== relativePath || journal.journalId !== `commit_journal_ch${chapterMatch[1]}_v${match[1]}`
          || journal.storyStatePath !== 'state/story_state.json' || !isCompletedCommitJournal(journal)) throw new SubmissionError('recovery_required');
        if (journal.chapterNumber === chapterNumber) completedTarget = true;
      } catch { throw new SubmissionError('recovery_required'); }
    }
  }
  if (completedTarget) throw new SubmissionError('already_committed');
}

async function assertAbsent(store: FileStore, p: string): Promise<void> {
  if (await store.exists(p)) throw new SubmissionError('recovery_required');
}

async function writeNewText(store: FileStore, p: string, text: string): Promise<void> {
  await assertAbsent(store, p);
  await store.writeText(p, text);
}

function jsonText(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
