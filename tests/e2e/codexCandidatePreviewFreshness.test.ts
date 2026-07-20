import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexCandidatePreview } from '../../src/app/codexCandidatePreview.js';
import { StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { AppError } from '../../src/utils/AppError.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareAdoptedRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d3-preview-stale-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D3 candidate preview freshness', () => {
  test('blocks stale source state before invoking Codex or writing diagnostics_v2', async () => {
    const store = new FileStore();
    const prepared = await prepareAdoptedRevisionCandidateProject(tempRoot, store);
    const fake = await writeFakeCodex(tempRoot, 'codex-candidate-preview');
    const state = await store.readJson(prepared.paths.storyState(), StoryStateSchema);
    await store.writeJson(prepared.paths.storyState(), {
      ...state,
      readerState: { ...state.readerState, readerExpectations: [...state.readerState.readerExpectations, 'stale test'] }
    }, StoryStateSchema);
    const argsLogExistedBefore = await store.exists(fake.argsLogPath);

    await expect(runCodexCandidatePreview({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      draft: 'draft_v2',
      approval: 'latest',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_CANDIDATE_PREVIEW_STALE' });

    expect(argsLogExistedBefore).toBe(false);
    await expect(store.exists(fake.argsLogPath)).resolves.toBe(false);
    await expect(store.exists(prepared.paths.chapterArtifact(1, 'diagnostics_v2.json'))).resolves.toBe(false);
  }, 60_000);
});
