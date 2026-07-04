import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { ChapterMissionSchema, ChapterPlanRankingSchema, RunManifestSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;
let briefPath: string;

const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m6-'));
  briefPath = path.join(tempRoot, 'brief.md');
  await writeFile(briefPath, '# Demo Brief\n\nA controlled test brief.\n', 'utf8');
  await initProject({ projectId: 'demo-novel', briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId: 'demo-novel', projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_build_bible_test' });
  await planGlobal({ projectId: 'demo-novel', projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_plan_global_test' });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('chapter dry-run planning', () => {
  test('creates mission, candidates, ranking, and selected plan without writing prose or updating state', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();

    const result = await runChapterDryRun({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      chapterNumber: 1,
      candidates: 3,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_chapter_dry_run_test'
    });

    expect(result.artifacts).toEqual([
      'chapters/chapter_001/mission.json',
      'chapters/chapter_001/plan_candidates/plan_001.md',
      'chapters/chapter_001/plan_candidates/plan_002.md',
      'chapters/chapter_001/plan_candidates/plan_003.md',
      'chapters/chapter_001/ranking.json',
      'chapters/chapter_001/selected_plan.md'
    ]);

    const mission = await store.readJson(paths.chapterArtifact(1, 'mission.json'), ChapterMissionSchema);
    expect(mission.requiredObjectives.map((objective) => objective.type)).toContain('debt');
    expect(mission.requiredObjectives.map((objective) => objective.type)).toContain('foreshadowing');
    expect(mission.readerInformationDelta.newKnowledge).toContain('旧收音机可以在无电状态播放求救声');
    expect(mission.characterDeltas[0]?.characterId).toBe('char_lincheng');
    expect(mission.forbiddenMoves).toContain('不要揭示旧收音机与林澈母亲失踪案的关系');

    await expect(store.readText(paths.chapterArtifact(1, 'plan_candidates', 'plan_001.md'))).resolves.toContain('# Plan 001');
    await expect(store.readText(paths.chapterArtifact(1, 'plan_candidates', 'plan_002.md'))).resolves.toContain('# Plan 002');
    await expect(store.readText(paths.chapterArtifact(1, 'selected_plan.md'))).resolves.toContain('# Plan 002');

    const ranking = await store.readJson(paths.chapterArtifact(1, 'ranking.json'), ChapterPlanRankingSchema);
    expect(ranking.selectedCandidateId).toBe('plan_002');
    expect(ranking.candidates[1]?.scores).toMatchObject({
      plot_progression: 8,
      character_arc_value: 9,
      tension_potential: 9,
      continuity_risk: 4,
      reader_hook_strength: 9,
      genre_satisfaction: 9
    });

    await expect(store.exists(paths.chapterArtifact(1, 'draft_v1.md'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'final.md'))).resolves.toBe(false);
    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(0);

    const manifest = await store.readJson(paths.runManifest('run_chapter_dry_run_test'), RunManifestSchema);
    expect(manifest.command).toBe('chapter');
    expect(manifest.status).toBe('success');
    expect(JSON.stringify(manifest.artifacts)).toContain('chapters/chapter_001/selected_plan.md');
  });
});
