import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { diffState } from '../../src/app/stateDiff.js';
import { StateDiffReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { SnapshotStore } from '../../src/storage/SnapshotStore.js';
import { createTempRoot, prepareCommittedThreeChapterProject, projectId, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m16-diff-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('state diff', () => {
  test('compares two snapshots and writes JSON plus Markdown artifacts', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const snapshots = await new SnapshotStore(paths, store).listSnapshots();

    const result = await diffState(
      {
        projectId,
        projectsRoot: tempRoot,
        fromSnapshot: snapshots[0]!.snapshotId,
        toSnapshot: snapshots[1]!.snapshotId
      },
      store
    );

    expect(result.report.mode).toBe('snapshot_to_snapshot');
    expect(result.report.changes.some((change) => change.path === '/latestCommittedChapter')).toBe(true);
    await expect(store.readJson(result.jsonPath, StateDiffReportSchema)).resolves.toMatchObject({ mode: 'snapshot_to_snapshot' });
    await expect(store.exists(result.markdownPath)).resolves.toBe(true);
  });

  test('previews a conflicting patch without modifying Story State and marks it unsafe', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const stateBefore = await store.readText(paths.storyState());
    const patchPath = path.resolve('fixtures/llm/memory.extract_canon_patch.patch-conflict-timeline.json');

    const result = await diffState(
      {
        projectId,
        projectsRoot: tempRoot,
        patchPath
      },
      store
    );

    expect(result.report.mode).toBe('patch_preview');
    expect(result.report.unsafeToCommit).toBe(true);
    expect(result.report.changes.some((change) => change.path.startsWith('/timeline'))).toBe(true);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 3 });
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
  });
});
