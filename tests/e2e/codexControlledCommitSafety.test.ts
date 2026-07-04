import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { recommitChapter } from '../../src/app/recommitChapter.js';
import { StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m24-safety-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M24 codex controlled commit safety scope', () => {
  test('blocks codex stale regeneration commit and codex recommit paths with specific errors', async () => {
    const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid' as any);
    const store = new FileStore();
    await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
    await buildBible({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin }, store);
    await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin }, store);
    const paths = new ProjectPaths(tempRoot, projectId);
    const stateBefore = await store.readJson(paths.storyState(), StoryStateSchema);

    await expect(
      runChapterFullProduction({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        provider: 'codex-text',
        promptRoot,
        codexBin: fake.codexBin,
        commit: true,
        regenerateStale: true,
        confirmCodexCommit: true
      } as any, store)
    ).rejects.toMatchObject({ code: 'CODEX_TEXT_STALE_REGEN_COMMIT_BLOCKED' });

    await expect(
      recommitChapter({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        sourceType: 'final',
        provider: 'codex-text'
      }, store)
    ).rejects.toMatchObject({ code: 'CODEX_TEXT_RECOMMIT_BLOCKED' });

    await expect(
      recommitChapter({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        sourceType: 'final',
        provider: 'codex-text',
        allowHistoricalRecommit: true,
        markDownstreamStale: true,
        confirm: true
      }, store)
    ).rejects.toMatchObject({ code: 'CODEX_TEXT_HISTORICAL_RECOMMIT_BLOCKED' });

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(stateBefore);
  });
});
