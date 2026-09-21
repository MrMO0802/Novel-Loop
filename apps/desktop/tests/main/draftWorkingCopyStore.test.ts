import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';

import {
  DraftWorkingCopyRecordSchema,
  DraftWorkingCopyStore
} from '../../src/main/chapter/DraftWorkingCopyStore';

const roots: string[] = [];
const projectKey = 'project_author_draft';
const sourceHash = 'a'.repeat(64);
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('DraftWorkingCopyStore', () => {
  test('submission admission remains blocked by invalid and quarantined edits across restart', async () => {
    const root = await makeRoot();
    const store = new DraftWorkingCopyStore(root);
    const directory = path.join(root, 'working-copies', projectKey, 'chapter_001');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'draft.json'), '{invalid');
    await expect(store.hasPendingSubmissionEdit(projectKey, 1)).resolves.toBe(true);
    await expect(store.read(projectKey, 1)).resolves.toMatchObject({ recoveryAvailable: false });
    await expect(new DraftWorkingCopyStore(root).hasPendingSubmissionEdit(projectKey, 1)).resolves.toBe(true);
    await store.discard(projectKey, 1);
    await expect(store.hasPendingSubmissionEdit(projectKey, 1)).resolves.toBe(false);
  });

  test('submission admission treats every persisted copy, including stale or identical text, as pending', async () => {
    const root = await makeRoot();
    const store = new DraftWorkingCopyStore(root);
    await expect(store.hasPendingSubmissionEdit(projectKey, 1)).resolves.toBe(false);
    await store.save({ projectKey, chapterNumber: 1, sourceHash, markdown: 'same', savedAt: '2026-09-21T00:00:00Z' });
    await expect(store.hasPendingSubmissionEdit(projectKey, 1)).resolves.toBe(true);
    await expect(store.read(projectKey, 1, 'b'.repeat(64))).resolves.toMatchObject({ stale: true });
    await expect(store.hasPendingSubmissionEdit(projectKey, 1)).resolves.toBe(true);
  });
  test('reopens a saved working copy with restrictive permissions', async () => {
    const root = await makeRoot();
    const store = new DraftWorkingCopyStore(root);
    const markdown = '# 第一章\n\n作者修改后的段落。\n';

    await store.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown,
      savedAt: '2026-08-04T01:00:00.000Z'
    });

    const reopened = new DraftWorkingCopyStore(root);
    expect(await reopened.read(projectKey, 1)).toMatchObject({
      markdown,
      recoveryAvailable: true,
      stale: false
    });
    const directory = path.join(root, 'working-copies', projectKey, 'chapter_001');
    const file = path.join(directory, 'draft.json');
    expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
  });

  test('reports malformed and stale recovery without returning unsafe content', async () => {
    const root = await makeRoot();
    const store = new DraftWorkingCopyStore(root);
    const directory = path.join(root, 'working-copies', projectKey, 'chapter_001');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, 'draft.json'), '{invalid', { mode: 0o600 });

    await expect(store.read(projectKey, 1, sourceHash)).resolves.toEqual({
      recoveryAvailable: false,
      stale: false,
      markdown: null,
      savedAt: null
    });
    expect(await readFile(path.join(directory, 'draft.json.quarantine'), 'utf8')).toBe('{invalid');

    await store.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown: '# 第一章\n\n旧来源的草稿。\n',
      savedAt: '2026-08-04T01:00:00.000Z'
    });
    await expect(store.read(projectKey, 1, 'b'.repeat(64))).resolves.toMatchObject({
      recoveryAvailable: true,
      stale: true,
      markdown: null
    });
  });

  test('rejects oversized markdown before persisting it', async () => {
    const root = await makeRoot();
    const store = new DraftWorkingCopyStore(root);

    await expect(store.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown: 'x'.repeat(2 * 1024 * 1024 + 1),
      savedAt: '2026-08-04T01:00:00.000Z'
    })).rejects.toMatchObject({ code: 'DRAFT_WORKING_COPY_INVALID' });
  });

  test('reopens escape-heavy markdown that remains within the Markdown byte limit', async () => {
    const root = await makeRoot();
    const store = new DraftWorkingCopyStore(root);
    const markdown = '\u0000'.repeat(2 * 1024 * 1024);

    await store.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown,
      savedAt: '2026-08-04T01:00:00.000Z'
    });

    await expect(new DraftWorkingCopyStore(root).read(projectKey, 1, sourceHash))
      .resolves.toMatchObject({ recoveryAvailable: true, stale: false, markdown });
  });

  test('quarantines non-UTF-8 stored JSON instead of exposing replacement-character prose', async () => {
    const root = await makeRoot();
    const store = new DraftWorkingCopyStore(root);
    const directory = path.join(root, 'working-copies', projectKey, 'chapter_001');
    const target = path.join(directory, 'draft.json');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const serialized = JSON.stringify({
      schemaVersion: '1.0',
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown: 'INVALID_BYTE_MARKER',
      savedAt: '2026-08-04T01:00:00.000Z'
    });
    const [prefix, suffix] = serialized.split('INVALID_BYTE_MARKER');
    if (prefix === undefined || suffix === undefined) throw new Error('Expected marker split.');
    const bytes = Buffer.concat([
      Buffer.from(prefix, 'utf8'),
      Buffer.from([0xff]),
      Buffer.from(suffix, 'utf8')
    ]);
    await writeFile(target, bytes, { mode: 0o600 });

    await expect(store.read(projectKey, 1, sourceHash)).resolves.toEqual({
      recoveryAvailable: false,
      stale: false,
      markdown: null,
      savedAt: null
    });
    expect(await readFile(`${target}.quarantine`)).toEqual(bytes);
  });

  test('closes an owned child directory handle when mode hardening throws', async () => {
    const root = await makeRoot();
    let openedFd: number | null = null;
    const store = new DraftWorkingCopyStore(root, {
      setDirectoryMode: async (handle: FileHandle) => {
        openedFd = handle.fd;
        throw new Error('forced directory mode failure');
      }
    });

    await expect(store.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown: '# 第一章\n\n不会保存。\n',
      savedAt: '2026-08-04T01:00:00.000Z'
    })).rejects.toMatchObject({ code: 'DRAFT_WORKING_COPY_UNAVAILABLE' });
    if (openedFd === null) throw new Error('Expected the injected child handle.');
    await expect(lstat(`/proc/self/fd/${openedFd}`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('keeps the prior working copy when atomic replacement fails', async () => {
    const root = await makeRoot();
    const original = '# 第一章\n\n原有草稿。\n';
    const stableStore = new DraftWorkingCopyStore(root);
    await stableStore.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown: original,
      savedAt: '2026-08-04T01:00:00.000Z'
    });
    const failingStore = new DraftWorkingCopyStore(root, {
      replace: async () => { throw new Error('replacement failed'); }
    });

    await expect(failingStore.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown: '# 第一章\n\n未写入草稿。\n',
      savedAt: '2026-08-04T01:01:00.000Z'
    })).rejects.toThrow('replacement failed');
    await expect(stableStore.read(projectKey, 1, sourceHash)).resolves.toMatchObject({
      markdown: original,
      recoveryAvailable: true
    });
  });

  test('serializes inverse replacement completion so the newest save wins', async () => {
    const root = await makeRoot();
    let firstStarted!: () => void;
    const replacementStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
    let releaseFirst!: () => void;
    const firstReplacement = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let replacements = 0;
    const store = new DraftWorkingCopyStore(root, {
      replace: async (temporary, target) => {
        replacements += 1;
        if (replacements === 1) {
          firstStarted();
          await firstReplacement;
        }
        await import('node:fs/promises').then(({ rename }) => rename(temporary, target));
      }
    });
    const first = store.save({
      projectKey, chapterNumber: 1, sourceHash, markdown: '# 第一章\n\nA\n', savedAt: '2026-08-04T01:00:00.000Z'
    });
    const second = store.save({
      projectKey, chapterNumber: 1, sourceHash, markdown: '# 第一章\n\nB\n', savedAt: '2026-08-04T01:00:01.000Z'
    });

    await replacementStarted;
    releaseFirst();
    await Promise.all([first, second]);
    await expect(store.read(projectKey, 1, sourceHash)).resolves.toMatchObject({ markdown: '# 第一章\n\nB\n' });
  });

  test('quarantines oversized and symlinked working-copy files without following them', async () => {
    const root = await makeRoot();
    const store = new DraftWorkingCopyStore(root);
    const directory = path.join(root, 'working-copies', projectKey, 'chapter_001');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, 'draft.json'), 'x'.repeat(2 * 1024 * 1024 + 16 * 1024 + 1));
    await expect(store.read(projectKey, 1)).resolves.toMatchObject({ recoveryAvailable: false });

    const outside = path.join(root, 'outside.json');
    await writeFile(outside, JSON.stringify({
      schemaVersion: '1.0', projectKey, chapterNumber: 1, sourceHash,
      markdown: '# 外部草稿\n', savedAt: '2026-08-04T01:00:00.000Z'
    }));
    await rm(path.join(directory, 'draft.json'), { force: true });
    await symlink(outside, path.join(directory, 'draft.json'));
    await expect(store.read(projectKey, 1)).resolves.toMatchObject({ recoveryAvailable: false });
    expect(await readFile(outside, 'utf8')).toContain('外部草稿');
  });

  test.skipIf(process.platform !== 'linux')(
    'rejects a FIFO working-copy record without waiting for a writer',
    async () => {
      const root = await makeRoot();
      const store = new DraftWorkingCopyStore(root);
      const directory = path.join(root, 'working-copies', projectKey, 'chapter_001');
      const target = path.join(directory, 'draft.json');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await execFileAsync('mkfifo', [target]);

      const read = store.read(projectKey, 1, sourceHash);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        read.then(() => 'completed' as const),
        new Promise<'timed_out'>((resolve) => {
          timer = setTimeout(() => {
            void open(target, constants.O_WRONLY | constants.O_NONBLOCK)
              .then(async (writer) => writer.close())
              .catch(() => undefined)
              .finally(() => resolve('timed_out'));
          }, 500);
        })
      ]);
      if (timer !== undefined) clearTimeout(timer);
      await read;

      expect(outcome).toBe('completed');
      await expect(read).resolves.toEqual({
        recoveryAvailable: false,
        stale: false,
        markdown: null,
        savedAt: null
      });
    }
  );

  test('rejects a symlinked working-copy directory before reading or writing outside user data', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    const workingCopiesRoot = path.join(root, 'working-copies');
    await mkdir(workingCopiesRoot, { mode: 0o700 });
    await symlink(outside, path.join(workingCopiesRoot, projectKey));
    const outsideChapter = path.join(outside, 'chapter_001');
    await mkdir(outsideChapter, { mode: 0o700 });
    const outsideDraft = path.join(outsideChapter, 'draft.json');
    await writeFile(outsideDraft, 'outside remains unchanged', 'utf8');
    const store = new DraftWorkingCopyStore(root);

    await expect(store.read(projectKey, 1, sourceHash))
      .rejects.toMatchObject({ code: 'DRAFT_WORKING_COPY_UNAVAILABLE' });
    await expect(store.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown: '# 第一章\n\n不得写到外部。\n',
      savedAt: '2026-08-04T01:00:00.000Z'
    })).rejects.toMatchObject({ code: 'DRAFT_WORKING_COPY_UNAVAILABLE' });
    expect(await readFile(outsideDraft, 'utf8')).toBe('outside remains unchanged');
  });

  test('keeps replacement descriptor-anchored when a validated component is swapped for a symlink', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    const projectDirectory = path.join(root, 'working-copies', projectKey);
    const movedProjectDirectory = path.join(root, 'working-copies', `${projectKey}-moved`);
    const outsideChapter = path.join(outside, 'chapter_001');
    const outsideDraft = path.join(outsideChapter, 'draft.json');
    const stableStore = new DraftWorkingCopyStore(root);
    await stableStore.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown: '# 第一章\n\n原有草稿。\n',
      savedAt: '2026-08-04T01:00:00.000Z'
    });
    await mkdir(outsideChapter, { recursive: true, mode: 0o700 });
    await writeFile(outsideDraft, 'outside remains unchanged', 'utf8');
    const swappingStore = new DraftWorkingCopyStore(root, {
      replace: async (temporary, target) => {
        await rename(projectDirectory, movedProjectDirectory);
        await symlink(outside, projectDirectory);
        await writeFile(
          path.join(outsideChapter, path.basename(temporary)),
          'attacker-controlled temporary file',
          'utf8'
        );
        await rename(temporary, target);
      }
    });

    await swappingStore.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown: '# 第一章\n\n安全的新草稿。\n',
      savedAt: '2026-08-04T01:01:00.000Z'
    });

    expect(await readFile(outsideDraft, 'utf8')).toBe('outside remains unchanged');
    await expect(new DraftWorkingCopyStore(root).read(projectKey, 1, sourceHash))
      .rejects.toMatchObject({ code: 'DRAFT_WORKING_COPY_UNAVAILABLE' });
    const movedRecord = DraftWorkingCopyRecordSchema.parse(JSON.parse(
      await readFile(
        path.join(movedProjectDirectory, 'chapter_001', 'draft.json'),
        'utf8'
      )
    ) as unknown);
    expect(movedRecord.markdown).toBe('# 第一章\n\n安全的新草稿。\n');
  });

  test('fails closed when descriptor-anchored filesystem access is unavailable', async () => {
    const root = await makeRoot();
    const store = new DraftWorkingCopyStore(root, {
      descriptorRoot: path.join(root, 'missing-proc-fd')
    });

    await expect(store.save({
      projectKey,
      chapterNumber: 1,
      sourceHash,
      markdown: '# 第一章\n\n不得降级为路径写入。\n',
      savedAt: '2026-08-04T01:00:00.000Z'
    })).rejects.toMatchObject({ code: 'DRAFT_WORKING_COPY_UNAVAILABLE' });
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-working-copy-'));
  roots.push(root);
  return root;
}
