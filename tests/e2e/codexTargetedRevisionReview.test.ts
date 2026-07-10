import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { reviewChapter } from '../../src/app/reviewChapter.js';
import { runCodexTargetedRevisionExperiment } from '../../src/app/codexTargetedRevisionExperiment.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetedRevisionProject } from './codexTargetedRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712c-review-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12C review integration', () => {
  test('shows isolated A/B result and recommends human review without adoption or commit', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareTargetedRevisionProject(tempRoot, store);
    await runCodexTargetedRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store);
    const stateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());

    const output = await reviewChapter({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      diagnostics: true,
      artifacts: true,
      suggestNext: true
    }, store);

    expect(output).toContain('Targeted revision experiment');
    expect(output).toContain('result: candidate_clears_timeline_failure');
    expect(output).toContain('candidateAdopted: false');
    expect(output).toContain('human review');
    await expect(store.readText(paths.storyState())).resolves.toBe(stateBefore);
    await expect(store.readText(paths.chapterQueue())).resolves.toBe(queueBefore);
  }, 45_000);
});
