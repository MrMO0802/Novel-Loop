import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { recommitChapter } from '../../src/app/recommitChapter.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, prepareCommittedThreeChapterProject, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m16-history-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('historical recommit safety', () => {
  test('blocks historical chapter recommit by default and preserves Story State', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const stateBefore = await store.readText(paths.storyState());

    await expect(
      recommitChapter(
        {
          projectId,
          projectsRoot: tempRoot,
          chapterNumber: 2,
          sourceType: 'final',
          provider: 'mock',
          promptRoot,
          fixturesRoot,
          confirm: true
        },
        store
      )
    ).rejects.toMatchObject({ code: 'HISTORICAL_RECOMMIT_BLOCKED' });
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
  });
});
