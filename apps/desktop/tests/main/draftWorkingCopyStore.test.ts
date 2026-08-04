import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-working-copy-'));
  roots.push(root);
  return root;
}
