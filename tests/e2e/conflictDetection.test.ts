import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { ChapterQueueSchema, ConflictReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m15-detect-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('canon patch conflict detection', () => {
  test('blocks commit by default, writes conflict_report_v1, and preserves Story State', async () => {
    const paths = await prepareCommittedThreeChapterProject();
    const store = new FileStore();

    await expect(
      runChapterFullProduction({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 4,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        candidates: 3,
        maxRevisions: 2,
        commit: true,
        mockScenario: 'patch-conflict-timeline',
        runId: 'run_m15_detect_ch004_revision'
      })
    ).rejects.toMatchObject({
      code: 'CANON_PATCH_CONFLICT'
    });

    const conflictReport = await store.readJson(paths.chapterArtifact(4, 'conflict_report_v1.json'), ConflictReportSchema);
    expect(conflictReport.chapterNumber).toBe(4);
    expect(conflictReport.sourcePatchPath).toBe('chapters/chapter_004/canon_patch.json');
    expect(conflictReport.conflicts.map((conflict) => conflict.conflictType)).toContain('TIMELINE_ORDER_CONFLICT');
    expect(conflictReport.conflicts.some((conflict) => conflict.blocking)).toBe(true);

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 3 });
    const queue = await store.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema);
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 4)).toMatchObject({
      status: 'blocked',
      currentStage: 'commit'
    });
  });
});

async function prepareCommittedThreeChapterProject(): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m15_detect_build' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m15_detect_plan' });
  for (const chapterNumber of [1, 2, 3]) {
    await runChapterFullProduction({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      planningRunId: `run_m15_detect_ch${chapterNumber}_planning`,
      draftRunId: `run_m15_detect_ch${chapterNumber}_draft`,
      runId: `run_m15_detect_ch${chapterNumber}_revision`
    });
  }
  return new ProjectPaths(tempRoot, projectId);
}
