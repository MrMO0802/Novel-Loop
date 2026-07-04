import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { validateProject } from '../../src/app/validateProject.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m22-pipeline-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('codex-text provider pipeline integration', () => {
  test('builds bible, plans globally, dry-runs a chapter, and drafts without committing Story State', async () => {
    const fake = await writeFakeCodex(tempRoot);
    const store = new FileStore();
    await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);

    const bible = await buildBible({
      projectId,
      projectsRoot: tempRoot,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'run_m22_codex_build_bible'
    }, store);
    expect(bible.artifacts).toEqual([
      'strategy/story_bible.md',
      'strategy/genre_contract.md',
      'strategy/reader_promise.md',
      'strategy/style_guide.md'
    ]);

    const global = await planGlobal({
      projectId,
      projectsRoot: tempRoot,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'run_m22_codex_plan_global'
    }, store);
    expect(global.artifacts).toContain('planning/arc_map.json');
    expect(global.artifacts).toContain('planning/chapter_queue.json');

    const dryRun = await runChapterDryRun({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      candidates: 3,
      runId: 'run_m22_codex_chapter_dry_run'
    }, store);
    expect(dryRun.artifacts).toEqual([
      'chapters/chapter_001/mission.json',
      'chapters/chapter_001/plan_candidates/plan_001.md',
      'chapters/chapter_001/plan_candidates/plan_002.md',
      'chapters/chapter_001/plan_candidates/plan_003.md',
      'chapters/chapter_001/ranking.json',
      'chapters/chapter_001/selected_plan.md'
    ]);

    const draft = await runChapterUntilDraft({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'run_m22_codex_chapter_draft'
    }, store);
    expect(draft.artifacts).toContain('chapters/chapter_001/scene_cards.json');
    expect(draft.artifacts).toContain('chapters/chapter_001/draft_v1.md');

    const paths = new ProjectPaths(tempRoot, projectId);
    const state = JSON.parse(await store.readText(paths.storyState())) as { latestCommittedChapter: number };
    expect(state.latestCommittedChapter).toBe(0);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
    await expect(validateProject({ projectId, projectsRoot: tempRoot }, store)).resolves.toMatchObject({ ok: true });
  });
});
