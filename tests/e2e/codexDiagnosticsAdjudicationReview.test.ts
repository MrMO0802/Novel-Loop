import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexDiagnosticsEvidenceAdjudication } from '../../src/app/codexDiagnosticsEvidenceAdjudication.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareDiagnosticsAdjudicationProject } from './codexDiagnosticsAdjudicationFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712b-review-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12B diagnostics adjudication review integration', () => {
  test('review displays adjudication evidence and remains read-only', async () => {
    const store = new FileStore();
    const { paths } = await prepareDiagnosticsAdjudicationProject(tempRoot, store);
    await runCodexDiagnosticsEvidenceAdjudication({ projectId: adjudicationProjectId, projectsRoot: tempRoot, chapterNumber: 1 }, store);
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

    expect(output).toContain('Diagnostics evidence adjudication');
    expect(output).toContain('adjudication: confirmed_true_positive');
    expect(output).toContain('confidence: high');
    expect(output).toContain('repeatabilityRate: 1');
    expect(output).toContain('uniqueClaimCount:');
    expect(output).toContain('timeline_contradiction_map_v1.json');
    expect(output).toContain('targeted revision experiment');
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
    expect(await store.readText(paths.chapterQueue())).toBe(queueBefore);
  }, 30_000);
});
