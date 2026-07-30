import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { validCharacterState } from '../fixtures/schemas/valid.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m23-dryrun-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M23 codex dry-run and draft pipeline', () => {
  test('uses slim chapter tasks and does not mutate Story State', async () => {
    const fake = await writeFakeCodex(tempRoot, 'slim-valid');
    const store = new FileStore();
    await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
    await buildBible({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
    await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);

    const paths = new ProjectPaths(tempRoot, projectId);
    const initialState = await store.readJson(paths.storyState(), StoryStateSchema);
    await store.writeJson(paths.storyState(), {
      ...initialState,
      characters: [validCharacterState]
    }, StoryStateSchema);
    const before = await store.readJson(paths.storyState(), StoryStateSchema);
    const dryRun = await runChapterDryRun({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      codexProfile: 'clean',
      codexJsonRetries: 2,
      codexJsonRepair: true,
      runId: 'run_m23_dryrun'
    }, store);
    expect(dryRun.artifacts).toContain('chapters/chapter_001/mission.json');
    expect(await store.readJson(paths.storyState(), StoryStateSchema)).toEqual(before);

    const draft = await runChapterUntilDraft({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      codexProfile: 'clean',
      codexJsonRetries: 2,
      codexJsonRepair: true,
      runId: 'run_m23_draft'
    }, store);
    expect(draft.artifacts).toContain('chapters/chapter_001/scene_cards.json');
    expect(draft.artifacts).toContain('chapters/chapter_001/draft_v1.md');
    expect(await store.readJson(paths.storyState(), StoryStateSchema)).toEqual(before);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
  });
});
