import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { reviewCodexRevisionCandidate } from '../../src/app/codexRevisionCandidateAdoption.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d3-review-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D3 candidate review gate', () => {
  test('writes a provider-free review report without changing canonical artifacts', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareRevisionCandidateProject(tempRoot, store);
    const before = await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(fake.argsLogPath)
    ]);

    const result = await reviewCodexRevisionCandidate({
      projectId: paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      candidate: 'latest'
    }, store);

    expect(result.report.approvedForAdoption).toBe(false);
    expect(result.report.experimentResult).toBe('revision_effective');
    expect(result.report.disposition).toBe('accepted_for_preview_review');
    expect(result.report.scopeValid).toBe(true);
    expect(result.report.contradictionsResolved).toBe(true);
    expect(result.report.newBlockingHardChecks).toEqual([]);
    expect(result.report.humanReviewChecklist.every((item) => item.passed)).toBe(true);
    expect(await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(fake.argsLogPath)
    ])).toEqual(before);
  }, 60_000);
});
