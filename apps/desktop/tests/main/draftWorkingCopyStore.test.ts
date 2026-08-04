import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { DraftWorkingCopyStore } from '../../src/main/chapter/DraftWorkingCopyStore';

const roots: string[] = [];
const projectKey = 'project_author_draft';
const sourceHash = 'a'.repeat(64);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('DraftWorkingCopyStore', () => {
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
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-working-copy-'));
  roots.push(root);
  return root;
}
