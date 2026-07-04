import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction, runChapterResume } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { ChapterQueueSchema, CommitReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m15-resume-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('canon patch conflict resume', () => {
  test('resumes a blocked conflict with repair enabled and commits chapter 4', async () => {
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
        runId: 'run_m15_resume_block'
      })
    ).rejects.toMatchObject({ code: 'CANON_PATCH_CONFLICT' });

    const blockedQueue = await store.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema);
    expect(blockedQueue.chapters.find((chapter) => chapter.chapterNumber === 4)?.status).toBe('blocked');

    const resumed = await runChapterResume({
      projectId,
      projectsRoot: tempRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      repairConflicts: true,
      maxConflictRepairs: 2,
      runId: 'run_m15_resume_repair'
    });

    expect(resumed.status).toBe('committed');
    expect(resumed.resumeFromStage).toBe('commit');
    expect(resumed.repaired).toBe(true);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 4 });
  });

  test('resumes from an existing repaired patch when commit failed after repair', async () => {
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
        repairConflicts: true,
        maxConflictRepairs: 2,
        failAt: 'commit',
        runId: 'run_m15_resume_after_repair_failure'
      })
    ).rejects.toMatchObject({ code: 'INJECTED_FAILURE' });

    await expect(store.exists(paths.chapterArtifact(4, 'canon_patch_repaired_v1.json'))).resolves.toBe(true);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 3 });

    const resumed = await runChapterResume({
      projectId,
      projectsRoot: tempRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      repairConflicts: true,
      maxConflictRepairs: 2,
      runId: 'run_m15_resume_existing_repaired_patch'
    });

    expect(resumed.status).toBe('committed');
    expect(resumed.repaired).toBe(true);
    expect(resumed.repairedPatchPath).toBe('chapters/chapter_004/canon_patch_repaired_v1.json');
    await expect(store.exists(paths.chapterArtifact(4, 'canon_patch_repaired_v2.json'))).resolves.toBe(false);
    const report = await store.readJson(paths.chapterArtifact(4, 'commit_report.json'), CommitReportSchema);
    expect(report.repaired).toBe(true);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 4 });
  });
});

async function prepareCommittedThreeChapterProject(): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m15_resume_build' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m15_resume_plan' });
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
      planningRunId: `run_m15_resume_ch${chapterNumber}_planning`,
      draftRunId: `run_m15_resume_ch${chapterNumber}_draft`,
      runId: `run_m15_resume_ch${chapterNumber}_revision`
    });
  }
  return new ProjectPaths(tempRoot, projectId);
}
