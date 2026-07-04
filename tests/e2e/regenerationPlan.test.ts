import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { generateRegenerationPlan } from '../../src/app/regenerationPlan.js';
import { recommitChapter } from '../../src/app/recommitChapter.js';
import { RegenerationPlanSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, prepareCommittedThreeChapterProject, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m17-plan-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('regeneration plan', () => {
  test('writes plan JSON and Markdown for stale downstream chapters without mutating Story State', async () => {
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

    const result = await generateRegenerationPlan({ projectId, projectsRoot: tempRoot, fromChapter: 3 }, store);

    expect(result.planPath).toBe('planning/regeneration_plan_v2.json');
    expect(result.markdownPath).toBe('planning/regeneration_plan_v2.md');
    const plan = await store.readJson(paths.planningArtifact('regeneration_plan_v2.json'), RegenerationPlanSchema);
    expect(plan.startsFromChapter).toBe(3);
    expect(plan.targetChapters.map((chapter) => chapter.chapterNumber)).toEqual([3]);
    expect(plan.strategy).toBe('regenerate_all_downstream');
    expect(plan.recommendedCommands[0]).toContain('chapter demo-novel next --provider mock --regenerate-stale');
    await expect(store.exists(paths.planningArtifact('regeneration_plan_v2.md'))).resolves.toBe(true);
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
  });
});
