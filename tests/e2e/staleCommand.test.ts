import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { recommitChapter } from '../../src/app/recommitChapter.js';
import { listStaleChapters } from '../../src/app/staleChapters.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, prepareCommittedThreeChapterProject, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m17-stale-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('stale command service', () => {
  test('lists stale chapters without modifying Story State or queue', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    await recommitChapter(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 2,
        sourceType: 'final',
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        mockScenario: 'historical-recommit-chapter-2-valid',
        allowHistoricalRecommit: true,
        markDownstreamStale: true,
        confirm: true
      },
      store
    );
    const stateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());

    const result = await listStaleChapters({ projectId, projectsRoot: tempRoot }, store);

    expect(result.staleCount).toBe(1);
    expect(result.staleChapters.map((chapter) => chapter.chapterNumber)).toEqual([3]);
    expect(result.output).toContain('staleCount: 1');
    expect(result.output).toContain('staleChapters: 3');
    expect(result.output).toContain('regeneration-plan demo-novel --from 3');
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
    expect(await store.readText(paths.chapterQueue())).toBe(queueBefore);
  });
});
