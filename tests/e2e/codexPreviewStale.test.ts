import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m25-stale-preview-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M25 codex preview stale detection', () => {
  test('confirmed commit refuses to reuse preview when Story State changed after preview', async () => {
    const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
    const store = new FileStore();
    await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
    await buildBible({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
    await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
    await runChapterDryRun({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
    await runChapterUntilDraft({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
    await runCodexCommit(store, fake.codexBin, { runId: 'run_m25_preview_stale' });

    const paths = new ProjectPaths(tempRoot, projectId);
    const stateBefore = await store.readJson(paths.storyState(), StoryStateSchema);
    await store.writeJson(paths.storyState(), { ...stateBefore, updatedAt: '2099-01-01T00:00:00.000Z' }, StoryStateSchema);

    await expect(
      runCodexCommit(store, fake.codexBin, {
        confirmCodexCommit: true,
        runId: 'run_m25_confirm_stale'
      })
    ).rejects.toMatchObject({
      code: 'CODEX_PREVIEW_STALE'
    });

    const stateAfter = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(stateAfter.latestCommittedChapter).toBe(0);
  });
});

function runCodexCommit(store: FileStore, codexBin: string, options: Record<string, unknown>) {
  return runChapterFullProduction(
    {
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin,
      codexProfile: 'clean',
      codexJsonRetries: 2,
      codexJsonRepair: true,
      maxRevisions: 2,
      commit: true,
      ...options
    } as any,
    store
  );
}
