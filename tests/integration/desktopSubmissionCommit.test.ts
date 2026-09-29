import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as desktop from '../../src/desktop/chapterSubmission.js';
import { submissionHash } from '../../src/app/desktopSubmissionSource.js';
import { startCommitJournal, isCompletedCommitJournal } from '../../src/app/commitJournal.js';
import { CanonPatchSchema, ChapterQueueSchema, CommitJournalSchema, CommitReportSchema, DesktopSubmissionApprovalSchema, SnapshotSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { applyCanonPatchToStoryState } from '../../src/app/chapterCommit.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { createDesktopSubmissionFixture } from '../helpers/desktopSubmissionFixture.js';

const chapter = 'chapters/chapter_001';
const previewDir = `${chapter}/submission_previews/preview_v1`;

describe('desktop local controlled commit', () => {
  let seed: Awaited<ReturnType<typeof createDesktopSubmissionFixture>>;
  let root: string;
  let projectRoot: string;
  let paths: ProjectPaths;
  let store: FileStore;
  let preview: NonNullable<Awaited<ReturnType<typeof desktop.readDesktopSubmissionPreview>>>;
  let input: { projectRoot: string; chapterNumber: number; previewId: string; expectedManifestHash: string; approvalId: string; confirm: true };
  beforeAll(async () => {
    seed = await createDesktopSubmissionFixture();
    vi.stubEnv('NLE_CODEX_BIN', seed.codexBin);
    expect((await desktop.checkDesktopChapterSubmission({ projectRoot: seed.projectRoot, chapterNumber: 1, taskId: 'commit_seed' }, { shouldCancel: () => false, onProgress: async () => {} })).status).toBe('ready');
    preview = (await desktop.readDesktopSubmissionPreview({ projectRoot: seed.projectRoot, chapterNumber: 1 }))!;
  }, 60000);
  afterAll(async () => { vi.unstubAllEnvs(); await seed?.cleanup(); });
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'submission-commit-'));
    projectRoot = path.join(root, seed.projectId);
    await cp(seed.projectRoot, projectRoot, { recursive: true });
    paths = new ProjectPaths(root, seed.projectId);
    store = FileStore.forProject(projectRoot);
    input = { projectRoot, chapterNumber: 1, previewId: preview.previewId, expectedManifestHash: submissionHash(await store.readText(path.join(projectRoot, previewDir, 'manifest.json'))), approvalId: 'approval_test', confirm: true };
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('commits exactly adopted B without any model calls and records bound approval, snapshots and queue transitions', async () => {
    expect(typeof desktop.confirmDesktopChapterSubmission).toBe('function');
    const calls = await readFile(`${seed.codexBin}.stdin.ndjson`);
    const beforePreview = await readFile(path.join(projectRoot, previewDir, 'manifest.json'));
    const result = await desktop.confirmDesktopChapterSubmission(input);
    expect(result).toMatchObject({ chapterNumber: 1, latestCommittedChapter: 1, commitReportPath: `${chapter}/commit_report.json`, hasNextChapter: true });
    expect(await readFile(paths.chapterArtifact(1, 'final.md'))).toEqual(Buffer.from(seed.adoptedText));
    expect(await readFile(paths.chapterArtifact(1, 'final.md'))).toEqual(await readFile(path.join(projectRoot, preview.artifacts.source.path)));
    expect(await readFile(paths.chapterArtifact(1, 'draft_v1.md'))).toEqual(Buffer.from(seed.originalText));
    expect(await readFile(path.join(projectRoot, seed.adoptedDraftPath))).toEqual(Buffer.from(seed.adoptedText));
    expect(await readFile(`${seed.codexBin}.stdin.ndjson`)).toEqual(calls);
    expect(await readFile(path.join(projectRoot, previewDir, 'manifest.json'))).toEqual(beforePreview);
    expect(await readFile(paths.chapterArtifact(1, 'canon_patch.json'))).toEqual(await readFile(path.join(projectRoot, preview.artifacts.patch.path)));
    expect((await store.readJson(paths.storyState(), StoryStateSchema)).latestCommittedChapter).toBe(1);
    const approval = await store.readJson(path.join(projectRoot, previewDir, 'approval.json'), DesktopSubmissionApprovalSchema);
    expect(approval).toMatchObject({ approvalId: input.approvalId, previewId: input.previewId, manifestHash: input.expectedManifestHash, sourceHash: preview.source.sourceHash, confirmed: true });
    const journal = await store.readJson(paths.chapterArtifact(1, 'commit_journal_v1.json'), CommitJournalSchema);
    expect(isCompletedCommitJournal(journal)).toBe(true);
    expect(journal).toMatchObject({ commitKind: 'desktop_controlled_commit', approvalRecordPath: `${previewDir}/approval.json`, previewManifestHash: input.expectedManifestHash, sourceHash: preview.source.sourceHash });
    const report = await store.readJson(paths.chapterArtifact(1, 'commit_report.json'), CommitReportSchema);
    expect(report.appliedChanges.latestCommittedChapter).toEqual({ from: 0, to: 1 });
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters[0]).toMatchObject({ status: 'committed', currentStage: 'commit' });
    const run = JSON.parse(await store.readText(paths.runManifest(approval.runId)));
    expect(run.promptCalls).toEqual([]);
    expect(run.stateMutations).toHaveLength(1);
    expect(run.queueTransitions.map((t: { afterStatus: string }) => t.afterStatus)).toEqual(['diagnosing', 'final_ready', 'patch_extracted', 'committed']);
    expect(run.status).toBe('success');
    expect(run.resolvedContext.latestCommittedChapterBefore).toBe(0);
    expect(run.resolvedContext.mode).toBe('commit');
  });

  it('serializes concurrent confirmations and blocks every repeat without rewriting state', async () => {
    const results = await Promise.allSettled([desktop.confirmDesktopChapterSubmission(input), desktop.confirmDesktopChapterSubmission(input)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const state = await readFile(paths.storyState());
    await expect(desktop.confirmDesktopChapterSubmission(input)).rejects.toMatchObject({ code: 'already_committed' });
    await expect(desktop.confirmDesktopChapterSubmission({ ...input, previewId: 'different_preview' })).rejects.toBeDefined();
    expect(await readFile(paths.storyState())).toEqual(state);
  });

  it.each(['final.md', 'canon_patch.json', 'commit_report.json', 'submission_previews/preview_v1/approval.json'])('never overwrites existing %s', async artifact => {
    await writeFile(paths.chapterArtifact(1, artifact), 'existing evidence');
    const state = await readFile(paths.storyState());
    await expect(desktop.confirmDesktopChapterSubmission(input)).rejects.toMatchObject({ code: 'recovery_required' });
    expect(await store.readText(paths.chapterArtifact(1, artifact))).toBe('existing evidence');
    expect(await readFile(paths.storyState())).toEqual(state);
    expect(await store.exists(paths.chapterArtifact(1, 'commit_journal_v1.json'))).toBe(false);
  });

  it.each(['config.json', 'state/story_state.json', 'planning/chapter_queue.json', `${chapter}/selected_plan.md`, `${previewDir}/source.md`, `${previewDir}/normalized_patch.json`, `${previewDir}/diagnostics.json`, `${previewDir}/state_diff.json`])('rejects changed %s before persistence', async artifact => {
    await writeFile(path.join(projectRoot, artifact), `${await store.readText(path.join(projectRoot, artifact))}\n`);
    await expect(desktop.confirmDesktopChapterSubmission(input)).rejects.toBeDefined();
    expect(await store.exists(paths.chapterArtifact(1, 'commit_journal_v1.json'))).toBe(false);
    expect(await store.exists(paths.chapterArtifact(1, 'final.md'))).toBe(false);
  });

  it('rejects incorrect identity, manifest hash and unexpected facade dependencies', async () => {
    for (const extra of [{ previewId: 'wrong' }, { expectedManifestHash: '0'.repeat(64) }, { provider: 'codex-text' }, { fileStore: store }, { confirm: false }]) {
      await expect(desktop.confirmDesktopChapterSubmission({ ...input, ...extra } as typeof input)).rejects.toBeDefined();
    }
    expect(await store.exists(paths.chapterArtifact(1, 'commit_journal_v1.json'))).toBe(false);
  });

  it('blocks an incomplete journal in a different chapter before canonical writes', async () => {
    await startCommitJournal({ paths, fileStore: store, chapterNumber: 2, commitKind: 'chapter_commit', provider: 'mock' });
    await expect(desktop.confirmDesktopChapterSubmission(input)).rejects.toMatchObject({ code: 'recovery_required' });
    expect(await store.exists(paths.chapterArtifact(1, 'final.md'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('rejects a symlinked preview and preserves its target', async () => {
    const original = path.join(projectRoot, previewDir, 'source.md');
    await rm(original);
    await symlink(path.join(seed.projectRoot, previewDir, 'source.md'), original);
    await expect(desktop.confirmDesktopChapterSubmission(input)).rejects.toBeDefined();
    expect(await store.exists(paths.chapterArtifact(1, 'final.md'))).toBe(false);
  });

  it.each(['planned_ready', 'exhausted'])('reports next planning availability for %s without creating chapters', async status => {
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    if (status === 'exhausted') queue.chapters = queue.chapters.filter(item => item.chapterNumber === 1);
    else queue.chapters.find(item => item.chapterNumber === 2)!.status = 'planned_ready';
    await store.writeJson(paths.chapterQueue(), queue, ChapterQueueSchema);
    const checked = await desktop.checkDesktopChapterSubmission({ projectRoot, chapterNumber: 1, taskId: 'planning_check' }, { shouldCancel: () => false, onProgress: async () => {} });
    expect(checked.status).toBe('ready');
    const fresh = (await desktop.readDesktopSubmissionPreview({ projectRoot, chapterNumber: 1 }))!;
    const freshManifest = path.join(projectRoot, path.dirname(fresh.artifacts.source.path), 'manifest.json');
    const result = await desktop.confirmDesktopChapterSubmission({ ...input, previewId: fresh.previewId, expectedManifestHash: submissionHash(await store.readText(freshManifest)) });
    expect(result.hasNextChapter).toBe(status !== 'exhausted');
    expect((await store.readJson(paths.chapterQueue(), ChapterQueueSchema)).chapters).toHaveLength(queue.chapters.length);
  });

  it('keeps generated BOM and CRLF bytes and prevents confirming a superseded preview', async () => {
    await rm(paths.chapterArtifact(1, 'author_revisions'), { recursive: true });
    const bytes = Buffer.from(`\uFEFF${seed.originalText.replace(/\r?\n/gu, '\r\n')}\r\nGENERATED_EXACT_BYTES\r\n`);
    await writeFile(paths.chapterArtifact(1, 'draft_v1.md'), bytes);
    const checked = await desktop.checkDesktopChapterSubmission({ projectRoot, chapterNumber: 1, taskId: 'generated_check' }, { shouldCancel: () => false, onProgress: async () => {} });
    expect(checked.status).toBe('ready');
    const fresh = (await desktop.readDesktopSubmissionPreview({ projectRoot, chapterNumber: 1 }))!;
    expect(fresh.source.sourceKind).toBe('generated');
    await expect(desktop.confirmDesktopChapterSubmission(input)).rejects.toMatchObject({ code: 'source_stale' });
    expect(await store.exists(paths.chapterArtifact(1, 'commit_journal_v1.json'))).toBe(false);
    await desktop.confirmDesktopChapterSubmission({ ...input, previewId: fresh.previewId, expectedManifestHash: submissionHash(await store.readText(path.join(projectRoot, path.dirname(fresh.artifacts.source.path), 'manifest.json'))) });
    expect(await readFile(paths.chapterArtifact(1, 'final.md'))).toEqual(bytes);
  });

  it('rejects incomplete or falsely completed desktop journals even with an advanced state', async () => {
    await desktop.confirmDesktopChapterSubmission(input);
    const journalPath = paths.chapterArtifact(1, 'commit_journal_v1.json');
    const journal = await store.readJson(journalPath, CommitJournalSchema);
    for (const changed of [{ ...journal, phases: journal.phases.filter(p => p.phase !== 'canonical_final_written') }, { ...journal, approvalRecordHash: undefined }]) {
      await store.writeJson(journalPath, changed, CommitJournalSchema);
      await expect(desktop.confirmDesktopChapterSubmission(input)).rejects.toMatchObject({ code: 'recovery_required' });
    }
  });

  it('reads tasks and a verified latest completion without model calls or writes', async () => {
    expect(typeof desktop.readDesktopSubmissionTasks).toBe('function');
    expect(typeof desktop.readDesktopSubmissionRecovery).toBe('function');
    expect(await desktop.readDesktopSubmissionTasks({ projectRoot })).toMatchObject([{ previewId: preview.previewId, status: 'ready' }]);
    expect(await desktop.readDesktopSubmissionRecovery({ projectRoot })).toEqual({ outcome: 'none' });
    const reviewedPatch = await store.readJson(path.join(projectRoot, preview.artifacts.patch.path), CanonPatchSchema);
    const character = reviewedPatch.characterStates.find(item => reviewedPatch.characterUpdates.some(update => update.characterId === item.id && update.field === 'currentGoal'))!;
    expect(character).toBeDefined();
    const update = reviewedPatch.characterUpdates.find(item => item.characterId === character.id && item.field === 'currentGoal')!;
    expect(character.currentGoal).not.toEqual(update.newValue);
    const patchBytes = await readFile(path.join(projectRoot, preview.artifacts.patch.path));
    await desktop.confirmDesktopChapterSubmission(input);
    const report = await store.readJson(paths.chapterArtifact(1, 'commit_report.json'), CommitReportSchema);
    const before = await store.readJson(paths.snapshot(report.beforeSnapshot.snapshotId), SnapshotSchema);
    const expected = applyCanonPatchToStoryState(before.storyState, structuredClone(reviewedPatch));
    const actual = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(actual).toEqual({ ...expected.storyState, updatedAt: actual.updatedAt });
    expect(report.appliedChanges).toEqual(expected.appliedChanges);
    const calls = await readFile(`${seed.codexBin}.stdin.ndjson`);
    const writes = vi.spyOn(FileStore.prototype, 'writeText');
    const appends = vi.spyOn(FileStore.prototype, 'appendText');
    const directories = vi.spyOn(FileStore.prototype, 'ensureDir');
    try {
      expect(await desktop.readDesktopSubmissionRecovery({ projectRoot })).toEqual({ outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: true });
      expect(await desktop.readDesktopSubmissionTasks({ projectRoot })).toHaveLength(1);
      expect(writes).not.toHaveBeenCalled();
      expect(appends).not.toHaveBeenCalled();
      expect(directories).not.toHaveBeenCalled();
      expect(await readFile(`${seed.codexBin}.stdin.ndjson`)).toEqual(calls);
      expect(await readFile(path.join(projectRoot, preview.artifacts.patch.path))).toEqual(patchBytes);
      expect(await readFile(paths.chapterArtifact(1, 'canon_patch.json'))).toEqual(patchBytes);
    } finally { writes.mockRestore(); appends.mockRestore(); directories.mockRestore(); }
  });

  it.each(['approval', 'manifest', 'final', 'patch', 'report', 'before_snapshot', 'after_snapshot', 'state', 'queue', 'other_journal'])('does not trust a completed journal with corrupted %s evidence', async artifact => {
    expect(typeof desktop.readDesktopSubmissionRecovery).toBe('function');
    await desktop.confirmDesktopChapterSubmission(input);
    expect(await desktop.readDesktopSubmissionRecovery({ projectRoot })).toMatchObject({ outcome: 'committed', chapterNumber: 1 });
    const journal = await store.readJson(paths.chapterArtifact(1, 'commit_journal_v1.json'), CommitJournalSchema);
    const relative = {
      approval: `${previewDir}/approval.json`, manifest: `${previewDir}/manifest.json`, final: `${chapter}/final.md`,
      patch: `${chapter}/canon_patch.json`, report: `${chapter}/commit_report.json`,
      before_snapshot: `snapshots/${journal.beforeSnapshotId}.json`, after_snapshot: `snapshots/${journal.afterSnapshotId}.json`,
      state: 'state/story_state.json', queue: 'planning/chapter_queue.json', other_journal: 'chapters/chapter_002/commit_journal_v1.json'
    }[artifact]!;
    if (artifact === 'other_journal') await store.ensureDir(paths.chapterDir(2));
    await writeFile(path.join(projectRoot, relative), 'corrupted evidence');
    expect(await desktop.readDesktopSubmissionRecovery({ projectRoot })).toEqual({ outcome: 'recovery_required' });
  });

  it('recovers immutable completion evidence after author/config edits, without live source freshness', async () => {
    expect(typeof desktop.readDesktopSubmissionRecovery).toBe('function');
    await desktop.confirmDesktopChapterSubmission(input);
    await writeFile(path.join(projectRoot, seed.adoptedDraftPath), 'later working revision');
    await writeFile(paths.config(), `${await store.readText(paths.config())}\n`);
    expect(await desktop.readDesktopSubmissionRecovery({ projectRoot })).toMatchObject({ outcome: 'committed', chapterNumber: 1 });
  });

  it('rejects unsafe or malformed persisted tasks rather than recovering authorization', async () => {
    expect(typeof desktop.readDesktopSubmissionTasks).toBe('function');
    const taskPath = path.join(projectRoot, 'runs', preview.runId, 'submission_task.json');
    await writeFile(taskPath, '{}');
    await expect(desktop.readDesktopSubmissionTasks({ projectRoot })).rejects.toMatchObject({ code: 'recovery_required' });
  });
});
