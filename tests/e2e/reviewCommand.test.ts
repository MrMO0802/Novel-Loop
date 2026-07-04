import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, prepareCommittedThreeChapterProject, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m16-review-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('review command service', () => {
  test('renders blocked chapter context without modifying Story State or chapter queue', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();

    await expect(
      runChapterFullProduction({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 4,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        candidates: 3,
        maxRevisions: 2,
        commit: true,
        mockScenario: 'patch-conflict-timeline',
        runId: 'run_m16_review_blocked'
      })
    ).rejects.toMatchObject({ code: 'CANON_PATCH_CONFLICT' });

    const stateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());

    const output = await reviewChapter(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 4,
        conflicts: true,
        diagnostics: true,
        state: true,
        artifacts: true,
        suggestNext: true
      },
      store
    );

    expect(output).toContain('Chapter: 4');
    expect(output).toContain('Queue status: blocked');
    expect(output).toContain('Current stage: commit');
    expect(output).toContain('Final path: chapters/chapter_004/final.md');
    expect(output).toContain('conflict_report_v1.json');
    expect(output).toContain('highest severity: high');
    expect(output).toContain('Suggested command:');
    expect(output).toContain('novel-loop recommit demo-novel 4 --from-final --confirm');
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
    expect(await store.readText(paths.chapterQueue())).toBe(queueBefore);
  }, 15000);
});
