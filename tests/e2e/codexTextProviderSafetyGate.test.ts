import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { commitChapterState } from '../../src/app/chapterCommit.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
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
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m22-safety-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('codex-text provider safety gate', () => {
  test('blocks post-draft and commit paths before Story State or commit artifacts can be changed', async () => {
    const fake = await writeFakeCodex(tempRoot);
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
        maxRevisions: 2,
        commit: false
      }, store)
    ).rejects.toMatchObject({
      code: 'CODEX_TEXT_COMMIT_BLOCKED'
    });

    await runChapterDryRun({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin }, store);
    await runChapterUntilDraft({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin }, store);

    const preview = await runChapterFullProduction({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      maxRevisions: 2,
      commit: true
    }, store) as any;
    expect(preview.previewOnly).toBe(true);
    expect(preview.status).toBe('codex_commit_preview');

    await expect(
      commitChapterState({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        provider: 'codex-text'
      }, store)
    ).rejects.toMatchObject({
      code: 'CODEX_TEXT_COMMIT_BLOCKED'
    });

    await expect(
      recommitChapter({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        sourceType: 'final',
        provider: 'codex-text'
      }, store)
    ).rejects.toMatchObject({
      code: 'CODEX_TEXT_RECOMMIT_BLOCKED'
    });

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(stateBefore);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(false);
  });
});
