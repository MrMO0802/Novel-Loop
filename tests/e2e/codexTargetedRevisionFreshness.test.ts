import { rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexTargetedRevisionExperiment } from '../../src/app/codexTargetedRevisionExperiment.js';
import { AppError } from '../../src/utils/AppError.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetedRevisionProject } from './codexTargetedRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712c-freshness-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12C source freshness gate', () => {
  test('rejects a stale source draft before generating plan or candidate artifacts', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareTargetedRevisionProject(tempRoot, store);
    await store.writeText(paths.chapterArtifact(1, 'draft_v1.md'), `${await store.readText(paths.chapterArtifact(1, 'draft_v1.md'))}\nmanual edit\n`);
    const stateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());

    await expect(runCodexTargetedRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      adjudication: 'latest',
      samples: 3,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_REVISION_SOURCE_STALE' });

    await expect(store.exists(paths.chapterArtifact(1, 'targeted_revision_plan_v1.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v1.md'))).resolves.toBe(false);
    await expect(store.readText(paths.storyState())).resolves.toBe(stateBefore);
    await expect(store.readText(paths.chapterQueue())).resolves.toBe(queueBefore);
  }, 30_000);

  test('rejects a missing source diagnostics artifact before invoking Codex', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareTargetedRevisionProject(tempRoot, store);
    await rm(paths.chapterArtifact(1, 'diagnostics_v1.json'));
    const stateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());

    await expect(runCodexTargetedRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      adjudication: 'latest',
      samples: 3,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_REVISION_SOURCE_STALE' });

    await expect(store.exists(paths.chapterArtifact(1, 'targeted_revision_plan_v1.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v1.md'))).resolves.toBe(false);
    await expect(store.readText(paths.storyState())).resolves.toBe(stateBefore);
    await expect(store.readText(paths.chapterQueue())).resolves.toBe(queueBefore);
  }, 30_000);
});
