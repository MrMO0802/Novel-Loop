import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexCandidatePreview } from '../../src/app/codexCandidatePreview.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareAdoptedRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d3-review-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D3 review integration', () => {
  test('shows candidate adoption and preview provenance with a human commit review recommendation', async () => {
    const store = new FileStore();
    const prepared = await prepareAdoptedRevisionCandidateProject(tempRoot, store);
    const fake = await writeFakeCodex(tempRoot, 'codex-candidate-preview');
    await runCodexCandidatePreview({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      draft: 'draft_v2',
      approval: 'latest',
      codexBin: fake.codexBin
    }, store);

    const output = await reviewChapter({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      diagnostics: true,
      artifacts: true,
      state: true,
      suggestNext: true
    }, store);

    expect(output).toContain('Candidate v2 review');
    expect(output).toContain('Candidate adoption approval');
    expect(output).toContain('Draft adoption');
    expect(output).toContain('selectedDraftVersion: 2');
    expect(output).toContain('Standard candidate diagnostics');
    expect(output).toContain('Candidate preview');
    expect(output).toContain('previewComplete: true');
    expect(output).toContain('recommendedNextStep: human_commit_review');
    expect(output).toContain('human commit review');
    expect(output).not.toContain('--confirm-codex-commit');
  }, 90_000);
});
