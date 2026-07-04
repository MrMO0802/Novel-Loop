import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { recommitChapter } from '../../src/app/recommitChapter.js';
import {
  ChapterQueueSchema,
  DownstreamInvalidationReportSchema,
  HistoricalRecommitReportSchema,
  RecommitReportSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { SnapshotStore } from '../../src/storage/SnapshotStore.js';
import { createTempRoot, fixturesRoot, prepareCommittedThreeChapterProject, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m17-history-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('historical recommit downstream invalidation', () => {
  test('keeps default historical recommit blocked without writing state or queue', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const stateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());

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
    expect(await store.readText(paths.chapterQueue())).toBe(queueBefore);
  });

  test('requires --mark-downstream-stale when historical recommit is allowed', async () => {
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
          mockScenario: 'historical-recommit-chapter-2-valid',
          allowHistoricalRecommit: true,
          confirm: true
        },
        store
      )
    ).rejects.toMatchObject({ code: 'DOWNSTREAM_STALE_MARK_REQUIRED' });

    expect(await store.readText(paths.storyState())).toBe(stateBefore);
  });

  test('previews historical recommit without mutating Story State or queue', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const stateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());

    const result = await recommitChapter(
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
        confirm: false
      },
      store
    );

    expect(result.previewOnly).toBe(true);
    expect(result.historicalRecommit).toBe(true);
    expect(result.oldLatestCommittedChapter).toBe(3);
    expect(result.newLatestCommittedChapter).toBe(2);
    expect(result.downstreamInvalidationReportPath).toBe('chapters/chapter_002/downstream_invalidation_report_v1.json');
    await expect(store.readJson(paths.chapterArtifact(2, 'downstream_invalidation_report_v1.json'), DownstreamInvalidationReportSchema)).resolves.toMatchObject({
      editedChapterNumber: 2,
      oldLatestCommittedChapter: 3,
      newLatestCommittedChapter: 2,
      regenerationRequired: true
    });
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
    expect(await store.readText(paths.chapterQueue())).toBe(queueBefore);
  });

  test('rebases from chapter 1 after snapshot, rewinds live state, and marks downstream stale', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const oldState = await store.readJson(paths.storyState(), StoryStateSchema);

    const result = await recommitChapter(
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

    expect(result.committed).toBe(true);
    expect(result.historicalRecommit).toBe(true);
    expect(result.oldLatestCommittedChapter).toBe(3);
    expect(result.newLatestCommittedChapter).toBe(2);
    expect(result.downstreamInvalidationReportPath).toBe('chapters/chapter_002/downstream_invalidation_report_v1.json');
    expect(result.historicalRecommitReportPath).toBe('chapters/chapter_002/historical_recommit_report_v1.json');
    expect(result.regenerationPlanPath).toBe('planning/regeneration_plan_v1.json');

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(2);
    expect(state.canonFacts.some((fact) => fact.sourceChapter === 3)).toBe(false);
    expect(state.canonFacts.length).toBeLessThan(oldState.canonFacts.length);

    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 2)?.status).toBe('recommitted');
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 3)?.status).toBe('stale_due_to_history_edit');
    await expect(store.exists(paths.chapterArtifact(3, 'final.md'))).resolves.toBe(true);

    const downstream = await store.readJson(paths.chapterArtifact(2, 'downstream_invalidation_report_v1.json'), DownstreamInvalidationReportSchema);
    expect(downstream.invalidatedChapters.map((chapter) => chapter.chapterNumber)).toEqual([3]);
    const historical = await store.readJson(paths.chapterArtifact(2, 'historical_recommit_report_v1.json'), HistoricalRecommitReportSchema);
    expect(historical).toMatchObject({ historicalRecommit: true, downstreamInvalidated: true, oldLatestCommittedChapter: 3, newLatestCommittedChapter: 2 });
    await expect(store.readJson(paths.chapterArtifact(2, 'recommit_report_v1.json'), RecommitReportSchema)).resolves.toMatchObject({
      historicalRecommit: true,
      downstreamInvalidated: true
    });
  });

  test('blocks historical recommit when base snapshot is missing', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const snapshotStore = new SnapshotStore(paths, store);
    const baseSnapshot = (await snapshotStore.listSnapshots()).find((snapshot) => snapshot.reason === 'after_chapter_001_commit');
    expect(baseSnapshot).toBeDefined();
    await rm(baseSnapshot!.path, { force: true });
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
          mockScenario: 'historical-recommit-chapter-2-valid',
          allowHistoricalRecommit: true,
          markDownstreamStale: true,
          confirm: true
        },
        store
      )
    ).rejects.toMatchObject({ code: 'BASE_SNAPSHOT_NOT_FOUND' });
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
  });

  test('blocks historical recommit when patch conflicts against base state', async () => {
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
          mockScenario: 'historical-recommit-chapter-2-conflict',
          allowHistoricalRecommit: true,
          markDownstreamStale: true,
          confirm: true
        },
        store
      )
    ).rejects.toMatchObject({ code: 'MANUAL_RECOMMIT_CONFLICT' });
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
    await expect(store.exists(paths.chapterArtifact(2, 'conflict_report_v1.json'))).resolves.toBe(true);
  });
});
