import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { recommitChapter } from '../../src/app/recommitChapter.js';
import { ChapterQueueSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, prepareCommittedThreeChapterProject, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m17-regenerate-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('regenerate stale chapter', () => {
  test('archives old artifacts, regenerates earliest stale chapter, and commits it', async () => {
    const paths = await prepareStaleChapter3();
    const store = new FileStore();

    const result = await runChapterFullProduction(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 3,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        candidates: 3,
        maxRevisions: 2,
        commit: true,
        regenerateStale: true,
        runId: 'run_m17_regenerate_stale_ch3'
      },
      store
    );

    expect(result.status).toBe('committed');
    expect(result.regeneratedChapterNumber).toBe(3);
    expect(result.archiveManifestPath).toMatch(/^chapters\/chapter_003\/archive\/history_edit_/);
    await expect(store.exists(paths.projectArtifact(result.archiveManifestPath!))).resolves.toBe(true);
    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(3);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 3)?.status).toBe('committed');
  });

  test('preserves rebased Story State and archive manifest when stale regeneration fails', async () => {
    const paths = await prepareStaleChapter3();
    const store = new FileStore();
    const stateBefore = await store.readText(paths.storyState());

    await expect(
      runChapterFullProduction(
        {
          projectId,
          projectsRoot: tempRoot,
          chapterNumber: 3,
          provider: 'mock',
          promptRoot,
          fixturesRoot,
          candidates: 3,
          maxRevisions: 2,
          commit: true,
          regenerateStale: true,
          failAt: 'diagnostics',
          runId: 'run_m17_regenerate_stale_fail'
        },
        store
      )
    ).rejects.toMatchObject({ code: 'INJECTED_FAILURE' });

    expect(await store.readText(paths.storyState())).toBe(stateBefore);
    const archiveDir = await store.list(paths.chapterArtifact(3, 'archive'));
    expect(archiveDir.some((entry) => entry.startsWith('history_edit_'))).toBe(true);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 3)?.status).toBe('failed');
  }, 15000);
});

async function prepareStaleChapter3() {
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
  return paths;
}
