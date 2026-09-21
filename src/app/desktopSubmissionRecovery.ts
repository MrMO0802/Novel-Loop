import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { hashJson } from '../logging/RunLogger.js';
import { normalizeCodexSlimOutput } from '../providers/codex/normalizers.js';
import { DesktopSubmissionPatchProposalSchema } from '../schemas/desktopSubmissionPatchProposal.js';
import {
  CanonPatchSchema, ChapterQueueSchema, CommitJournalSchema, CommitReportSchema, ConflictReportSchema,
  DesktopSubmissionApprovalSchema, DesktopSubmissionArtifactReferenceSchema, DesktopSubmissionPreviewSchema,
  DesktopSubmissionTaskSchema, DiagnosticsReportSchema, RunManifestV2Schema, SnapshotSchema, StateDiffReportSchema, StoryStateSchema
} from '../schemas/index.js';
import type { CommitJournal, DesktopSubmissionTask, StoryState } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { applyCanonPatchToStoryState, checkPatchConflicts, detectPatchConflictItems } from './chapterCommit.js';
import { validateChapterQueueConsistency } from './chapterQueue.js';
import { isCompletedCommitJournal } from './commitJournal.js';
import { assertSubmissionPreviewRun, assertSubmissionPreviewTask, readExactSubmissionText, SubmissionError, submissionChapterPath, submissionHash, submissionStore } from './desktopSubmissionSource.js';
import { diffPatchPreview, summarizeChanges } from './stateDiff.js';

const ReadInputSchema = z.object({ projectRoot: z.string().min(1) }).strict();
export type SubmissionReadInput = z.infer<typeof ReadInputSchema>;
export type DesktopSubmissionRecoveryResult = { outcome: 'none' | 'recovery_required' }
  | { outcome: 'committed'; chapterNumber: number; latestCommittedChapter: number; hasNextChapter: boolean };
const MAX_ENTRIES = 4096;

export async function readDesktopSubmissionTasks(input: SubmissionReadInput): Promise<DesktopSubmissionTask[]> {
  try {
    const reader = await createReader(input);
    const tasks: DesktopSubmissionTask[] = [];
    for (const runId of await reader.list('runs')) {
      if (!/^[A-Za-z0-9_-]{1,128}$/u.test(runId)) continue;
      const relative = `runs/${runId}/submission_task.json`;
      if (!(await reader.store.exists(reader.paths.projectArtifact(relative)))) continue;
      const task = await reader.json(relative, DesktopSubmissionTaskSchema);
      requireEvidence(task.projectId === reader.paths.projectId && task.runId === runId);
      tasks.push(task);
    }
    await reader.unchanged();
    // Persisted task status is evidence, never an authorization or a request to resume work.
    return tasks.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  } catch { throw new SubmissionError('recovery_required'); }
}

export async function readDesktopSubmissionRecovery(input: SubmissionReadInput): Promise<DesktopSubmissionRecoveryResult> {
  try {
    const reader = await createReader(input);
    const state = await reader.json('state/story_state.json', StoryStateSchema);
    const queue = await reader.json('planning/chapter_queue.json', ChapterQueueSchema);
    requireEvidence(state.projectId === reader.paths.projectId && queue.projectId === reader.paths.projectId
      && validateChapterQueueConsistency(queue, state).length === 0);
    let latest: CommitJournal | undefined;
    const desktopChapters = new Set<number>();
    for (const chapter of await reader.list('chapters')) {
      const match = /^chapter_(\d{3,})$/u.exec(chapter);
      if (match === null) continue;
      for (const file of await reader.list(`chapters/${chapter}`)) {
        const version = /^commit_journal_v([1-9]\d*)\.json$/u.exec(file);
        if (version === null) continue;
        const relative = `chapters/${chapter}/${file}`;
        const journal = await reader.json(relative, CommitJournalSchema);
        requireEvidence(journal.projectId === reader.paths.projectId && journal.chapterNumber === Number(match[1])
          && journal.journalPath === relative && journal.journalId === `commit_journal_ch${match[1]}_v${version[1]}`
          && journal.storyStatePath === 'state/story_state.json' && isCompletedCommitJournal(journal)
          && journal.chapterNumber <= state.latestCommittedChapter);
        if (journal.commitKind !== 'desktop_controlled_commit') continue;
        requireEvidence(!desktopChapters.has(journal.chapterNumber));
        desktopChapters.add(journal.chapterNumber);
        await verifyCompletedEvidence(reader, journal, state);
        const item = queue.chapters.find(item => item.chapterNumber === journal.chapterNumber);
        requireEvidence(item?.status === 'committed' && item.currentStage === 'commit' && item.committedAt !== null && item.latestRunId === journal.runId);
        if (journal.chapterNumber === state.latestCommittedChapter) latest = journal;
      }
    }
    await reader.unchanged();
    return latest === undefined ? { outcome: 'none' } : {
      outcome: 'committed', chapterNumber: latest.chapterNumber, latestCommittedChapter: state.latestCommittedChapter,
      hasNextChapter: queue.chapters.some(item => item.chapterNumber === state.latestCommittedChapter + 1 && item.committedAt === null && item.status !== 'stale_due_to_history_edit')
    };
  } catch { return { outcome: 'recovery_required' }; }
}

type EvidenceReader = Awaited<ReturnType<typeof createReader>>;

async function verifyCompletedEvidence(reader: EvidenceReader, journal: CommitJournal, live: StoryState): Promise<void> {
  const chapter = journal.chapterNumber;
  const previewText = await reader.reference(journal.previewManifestPath!, journal.previewManifestHash!);
  const preview = DesktopSubmissionPreviewSchema.parse(JSON.parse(previewText));
  const root = submissionChapterPath(chapter, 'submission_previews', `preview_v${preview.version}`);
  requireEvidence(preview.projectId === reader.paths.projectId && preview.chapterNumber === chapter && preview.previewId === journal.previewId
    && journal.previewManifestPath === `${root}/manifest.json` && journal.approvalRecordPath === `${root}/approval.json`
    && journal.canonicalFinalPath === submissionChapterPath(chapter, 'final.md')
    && journal.canonPatchPath === submissionChapterPath(chapter, 'canon_patch.json')
    && journal.commitReportPath === submissionChapterPath(chapter, 'commit_report.json'));
  assertSubmissionPreviewTask(preview, await reader.json(`runs/${preview.runId}/submission_task.json`, DesktopSubmissionTaskSchema));
  assertSubmissionPreviewRun(preview, await reader.json(`runs/${preview.runId}/run_manifest.json`, RunManifestV2Schema));
  const approval = DesktopSubmissionApprovalSchema.parse(JSON.parse(await reader.reference(journal.approvalRecordPath!, journal.approvalRecordHash!)));
  requireEvidence(approval.approvalId === journal.approvalId && approval.previewId === preview.previewId && approval.runId === journal.runId
    && approval.projectId === preview.projectId && approval.chapterNumber === chapter && approval.manifestHash === journal.previewManifestHash
    && approval.sourceHash === journal.sourceHash && approval.sourceHash === preview.source.sourceHash
    && approval.patchHash === journal.patchHash && approval.patchHash === preview.artifacts.patch.hash
    && approval.diffHash === journal.diffHash && approval.diffHash === preview.artifacts.diff.hash);
  const texts = {} as Record<keyof typeof preview.artifacts, string>;
  for (const key of Object.keys(preview.artifacts) as (keyof typeof preview.artifacts)[]) {
    const ref = preview.artifacts[key];
    texts[key] = await reader.reference(ref.path, ref.hash);
  }
  requireEvidence(await reader.reference(journal.canonicalFinalPath!, journal.sourceHash!) === texts.source);
  requireEvidence(await reader.reference(journal.canonPatchPath!, journal.patchHash!) === texts.patch);
  const patch = CanonPatchSchema.parse(JSON.parse(texts.patch));
  const proposal = DesktopSubmissionPatchProposalSchema.parse(JSON.parse(texts.patchProposal));
  const normalized = CanonPatchSchema.parse(normalizeCodexSlimOutput('memory.extract_canon_patch_proposal_slim', proposal, { projectId: reader.paths.projectId, chapterNumber: chapter }));
  const diagnostics = DiagnosticsReportSchema.parse(JSON.parse(texts.diagnostics));
  const conflict = ConflictReportSchema.parse(JSON.parse(texts.conflict));
  const diff = StateDiffReportSchema.parse(JSON.parse(texts.diff));
  requireEvidence(isDeepStrictEqual(normalized, patch) && patch.chapterNumber === chapter
    && patch.sourceFinalPath === journal.canonicalFinalPath && (patch.latestCommittedChapter ?? chapter) === chapter
    && diagnostics.chapterNumber === chapter && diagnostics.passed === true && diagnostics.hardFailures.length === 0);
  const report = await reader.json(journal.commitReportPath!, CommitReportSchema);
  const snapshotId = z.string().regex(/^snapshot_[A-Za-z0-9_-]+$/u);
  const beforeId = snapshotId.parse(journal.beforeSnapshotId);
  const afterId = snapshotId.parse(journal.afterSnapshotId);
  const before = await reader.json(`snapshots/${beforeId}.json`, SnapshotSchema);
  const after = await reader.json(`snapshots/${afterId}.json`, SnapshotSchema);
  requireEvidence(before.meta.snapshotId === beforeId && after.meta.snapshotId === afterId && beforeId !== afterId
    && before.meta.runId === journal.runId && after.meta.runId === journal.runId
    && before.meta.sourceChapter === chapter && after.meta.sourceChapter === chapter
    && before.storyState.projectId === reader.paths.projectId && after.storyState.projectId === reader.paths.projectId
    && before.storyState.latestCommittedChapter === chapter - 1 && after.storyState.latestCommittedChapter === chapter
    && journal.latestCommittedChapterBefore === chapter - 1 && journal.latestCommittedChapterAfter === chapter
    && journal.beforeStateHash === hashJson(before.storyState) && journal.afterStateHash === hashJson(after.storyState)
    && report.chapterNumber === chapter && report.canonPatchPath === journal.canonPatchPath && report.storyStatePath === journal.storyStatePath
    && isDeepStrictEqual(report.beforeSnapshot, before.meta) && isDeepStrictEqual(report.afterSnapshot, after.meta));
  // Apply may update characterStates by reference; keep hashed evidence immutable for diff proof.
  const applied = applyCanonPatchToStoryState(before.storyState, structuredClone(patch));
  const conflicts = checkPatchConflicts(before.storyState, patch);
  requireEvidence(conflicts.hard.length === 0 && isDeepStrictEqual(report.conflicts, conflicts)
    && isDeepStrictEqual(report.appliedChanges, applied.appliedChanges)
    && isDeepStrictEqual({ ...applied.storyState, updatedAt: after.storyState.updatedAt }, after.storyState));
  requireEvidence(conflict.projectId === reader.paths.projectId && conflict.chapterNumber === chapter && conflict.sourcePatchPath === preview.artifacts.patch.path
    && isDeepStrictEqual(conflict.conflicts, detectPatchConflictItems(before.storyState, patch)));
  const changes = diffPatchPreview(before.storyState, patch);
  requireEvidence(diff.projectId === reader.paths.projectId && diff.mode === 'patch_preview' && diff.patchPath === preview.artifacts.patch.path
    && !diff.unsafeToCommit && isDeepStrictEqual(diff.changes, changes) && isDeepStrictEqual(diff.summary, summarizeChanges(changes)));
  if (live.latestCommittedChapter === chapter) requireEvidence(isDeepStrictEqual(live, after.storyState));
  const runId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).parse(journal.runId);
  const run = await reader.json(`runs/${runId}/run_manifest.json`, RunManifestV2Schema);
  requireEvidence(run.projectId === reader.paths.projectId && run.runId === runId && run.status === 'success'
    && run.promptCalls.length === 0 && run.llmCalls.length === 0
    && run.stateMutations.length === 1 && run.stateMutations[0]?.applied === true
    && run.stateMutations[0]?.patchPath === journal.canonPatchPath
    && run.stateMutations[0]?.beforeSnapshotId === beforeId && run.stateMutations[0]?.afterSnapshotId === afterId
    && run.stateMutations[0]?.beforeStateHash === journal.beforeStateHash && run.stateMutations[0]?.afterStateHash === journal.afterStateHash);
}

async function createReader(inputValue: SubmissionReadInput) {
  const input = ReadInputSchema.parse(inputValue);
  const root = path.resolve(input.projectRoot);
  const paths = new ProjectPaths(path.dirname(root), path.basename(root));
  const store = submissionStore(root);
  await store.assertSafePath(root);
  const files = new Map<string, string>();
  const directories = new Map<string, string[]>();
  const text = async (relative: string) => {
    requireEvidence(files.size < MAX_ENTRIES);
    const value = await readExactSubmissionText(store, paths.projectArtifact(relative));
    if (files.has(relative)) requireEvidence(files.get(relative) === value);
    files.set(relative, value);
    return value;
  };
  const list = async (relative: string) => {
    const values = await store.exists(paths.projectArtifact(relative)) ? await store.list(paths.projectArtifact(relative)) : [];
    requireEvidence(values.length <= MAX_ENTRIES && directories.size < MAX_ENTRIES);
    directories.set(relative, values);
    return values;
  };
  return {
    paths, store, list,
    json: async <T>(relative: string, schema: z.ZodType<T>) => schema.parse(JSON.parse(await text(relative))),
    reference: async (relative: string, hash: string) => {
      DesktopSubmissionArtifactReferenceSchema.parse({ path: relative, hash });
      const value = await text(relative);
      requireEvidence(submissionHash(value) === hash);
      return value;
    },
    unchanged: async () => {
      for (const [relative, value] of files) requireEvidence(await readExactSubmissionText(store, paths.projectArtifact(relative)) === value);
      for (const [relative, values] of directories) {
        const current = await store.exists(paths.projectArtifact(relative)) ? await store.list(paths.projectArtifact(relative)) : [];
        requireEvidence(isDeepStrictEqual(current, values));
      }
    }
  };
}

function requireEvidence(condition: boolean): asserts condition {
  if (!condition) throw new SubmissionError('recovery_required');
}
