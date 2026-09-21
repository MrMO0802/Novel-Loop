import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as desktop from '../../src/desktop/chapterSubmission.js';
import { submissionHash } from '../../src/app/desktopSubmissionSource.js';
import { isCompletedCommitJournal } from '../../src/app/commitJournal.js';
import { CommitJournalSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createDesktopSubmissionFixture } from '../helpers/desktopSubmissionFixture.js';

describe('desktop commit persistence failure barriers', () => {
  let seed: Awaited<ReturnType<typeof createDesktopSubmissionFixture>>;
  let previewId: string;
  let manifestHash: string;
  beforeAll(async () => {
    seed = await createDesktopSubmissionFixture();
    vi.stubEnv('NLE_CODEX_BIN', seed.codexBin);
    const task = await desktop.checkDesktopChapterSubmission({ projectRoot: seed.projectRoot, chapterNumber: 1, taskId: 'failure_seed' }, { shouldCancel: () => false, onProgress: async () => {} });
    expect(task.status).toBe('ready');
    previewId = task.previewId!;
    manifestHash = submissionHash(await seed.store.readText(seed.paths.chapterArtifact(1, 'submission_previews/preview_v1/manifest.json')));
  }, 60000);
  afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await seed?.cleanup(); });

  it('rejects every before/after persistence failure, including state-write phase gaps, and never retries apply', async () => {
    expect(typeof desktop.confirmDesktopChapterSubmission).toBe('function');
    const { confirmSubmissionCommit } = await import('../../src/app/desktopSubmissionCommit.js');
    const operations: string[] = [];
    let failAt = -1;
    let side: 'before' | 'after' = 'before';
    let index = 0;
    let fired = false;
    let activeRoot = '';
    const around = async (kind: string, p: string, action: () => Promise<void>) => {
      const step = index++;
      if (failAt === -1) operations.push(`${kind}:${path.relative(activeRoot, p)}`);
      if (step === failAt && side === 'before') { fired = true; throw new Error('injected before persistence'); }
      await action();
      if (step === failAt && side === 'after') { fired = true; throw new Error('injected after persistence'); }
    };
    const originalAppend = FileStore.prototype.appendText;
    vi.spyOn(FileStore.prototype, 'appendText').mockImplementation(async function (this: FileStore, p, content) {
      await around('append', p, () => originalAppend.call(this, p, content));
    });
    class FaultStore extends FileStore {
      override async writeText(p: string, content: string) { await around('write', p, () => super.writeText(p, content)); }
      override async ensureDir(p: string) { await around('mkdir', p, () => super.ensureDir(p)); }
    }
    const run = async (failure: number, timing: 'before' | 'after') => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'submission-fault-'));
      activeRoot = path.join(root, seed.projectId);
      await cp(seed.projectRoot, activeRoot, { recursive: true });
      const input = { projectRoot: activeRoot, chapterNumber: 1, previewId, expectedManifestHash: manifestHash, approvalId: 'failure_approval', confirm: true as const };
      index = 0; failAt = failure; side = timing; fired = false;
      try {
        if (failure === -1) {
          await confirmSubmissionCommit(input, { fileStore: new FaultStore() });
          return;
        }
        await expect(confirmSubmissionCommit(input, { fileStore: new FaultStore() }), `${timing} #${failure} ${operations[failure]}`).rejects.toMatchObject({ code: 'recovery_required' });
        expect(fired).toBe(true);
        const statePath = path.join(activeRoot, 'state/story_state.json');
        const stateBytes = await readFile(statePath);
        const store = FileStore.forProject(activeRoot);
        const journalPath = path.join(activeRoot, 'chapters/chapter_001/commit_journal_v1.json');
        if (await store.exists(journalPath)) {
          expect(isCompletedCommitJournal(await store.readJson(journalPath, CommitJournalSchema))).toBe(false);
          failAt = -2;
          expect(await desktop.readDesktopSubmissionRecovery({ projectRoot: activeRoot })).toEqual({ outcome: 'recovery_required' });
          await expect(desktop.confirmDesktopChapterSubmission(input)).rejects.toMatchObject({ code: 'recovery_required' });
          expect(await readFile(statePath)).toEqual(stateBytes);
        } else {
          expect(failure).toBe(0);
          expect(timing).toBe('before');
          expect((await store.readJson(statePath, StoryStateSchema)).latestCommittedChapter).toBe(0);
        }
      } finally { await rm(root, { recursive: true, force: true }); }
    };
    try {
      await run(-1, 'before');
      expect(operations[0]).toContain('commit_journal_v1.json');
      expect(operations.some(p => p.startsWith('append:'))).toBe(true);
      expect(operations.some(p => p.endsWith('state/story_state.json'))).toBe(true);
      expect(operations.some(p => p.endsWith('planning/chapter_queue.json'))).toBe(true);
      for (let operation = 0; operation < operations.length; operation++) {
        await run(operation, 'before');
        await run(operation, 'after');
      }
      console.info(`Injected before/after all ${operations.length} persistence operations (${operations.length * 2} failures).`);
    } finally { vi.restoreAllMocks(); }
  }, 180000);

  it('preserves the incomplete journal when state persisted but all subsequent journal updates fail', async () => {
    expect(typeof desktop.confirmDesktopChapterSubmission).toBe('function');
    const { confirmSubmissionCommit } = await import('../../src/app/desktopSubmissionCommit.js');
    const root = await mkdtemp(path.join(os.tmpdir(), 'submission-journal-fault-'));
    const projectRoot = path.join(root, seed.projectId);
    await cp(seed.projectRoot, projectRoot, { recursive: true });
    class FailedJournalStore extends FileStore {
      stateWritten = false;
      override async writeText(p: string, content: string) {
        if (this.stateWritten && p.endsWith('commit_journal_v1.json')) throw new Error('journal disk failure');
        await super.writeText(p, content);
        if (p.endsWith('state/story_state.json')) this.stateWritten = true;
      }
    }
    const input = { projectRoot, chapterNumber: 1, previewId, expectedManifestHash: manifestHash, approvalId: 'journal_failure', confirm: true as const };
    try {
      await expect(confirmSubmissionCommit(input, { fileStore: new FailedJournalStore() })).rejects.toMatchObject({ code: 'recovery_required' });
      const store = FileStore.forProject(projectRoot);
      const journal = await store.readJson(path.join(projectRoot, 'chapters/chapter_001/commit_journal_v1.json'), CommitJournalSchema);
      expect(journal.stateWriteCompleted).toBe(false);
      expect(journal.status).toBe('in_progress');
      expect((await store.readJson(path.join(projectRoot, 'state/story_state.json'), StoryStateSchema)).latestCommittedChapter).toBe(1);
      expect(await desktop.readDesktopSubmissionRecovery({ projectRoot })).toEqual({ outcome: 'recovery_required' });
      await expect(desktop.confirmDesktopChapterSubmission(input)).rejects.toMatchObject({ code: 'recovery_required' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
