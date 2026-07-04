import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction, runChapterResume } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { ChapterQueueSchema, RunManifestSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m14-fail-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('chapter pipeline failure injection', () => {
  test('fail_at=write_scene_002 preserves state, records failure, and resume completes commit', async () => {
    const paths = await prepareProject();
    const store = new FileStore();

    await expect(
      runChapterFullProduction({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        candidates: 3,
        maxRevisions: 2,
        commit: true,
        planningRunId: 'run_m14_fail_planning',
        draftRunId: 'run_m14_fail_draft',
        runId: 'run_m14_fail_revision',
        failAt: 'write_scene_002'
      })
    ).rejects.toMatchObject({
      code: 'INJECTED_FAILURE'
    });

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 0 });
    await expect(store.exists(paths.chapterArtifact(1, 'scenes', 'scene_001.md'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(1, 'scenes', 'scene_002.md'))).resolves.toBe(false);

    const failedQueue = await store.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema);
    expect(failedQueue.chapters[0]).toMatchObject({
      status: 'failed',
      currentStage: 'scene_drafts',
      latestRunId: 'run_m14_fail_draft'
    });
    expect(failedQueue.chapters[0]?.failureReason).toContain('write_scene_002');
    await expect(store.readJson(paths.runManifest('run_m14_fail_draft'), RunManifestSchema)).resolves.toMatchObject({
      status: 'failed'
    });

    const resumed = await runChapterResume({
      projectId,
      projectsRoot: tempRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      planningRunId: 'run_m14_resume_planning',
      draftRunId: 'run_m14_resume_draft',
      runId: 'run_m14_resume_revision'
    });

    expect(resumed.status).toBe('committed');
    expect(resumed.chapterNumber).toBe(1);
    expect(resumed.resumeFromStage).toBe('scene_drafts');
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 1 });
    const committedQueue = await store.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema);
    expect(committedQueue.chapters[0]).toMatchObject({
      status: 'committed',
      currentStage: 'commit'
    });
  });

  test('failed status preserves artifacts instead of deleting partial output', async () => {
    const paths = await prepareProject();
    const store = new FileStore();

    await expect(
      runChapterFullProduction({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        candidates: 3,
        maxRevisions: 2,
        commit: true,
        planningRunId: 'run_m14_preserve_planning',
        draftRunId: 'run_m14_preserve_draft',
        runId: 'run_m14_preserve_revision',
        failAt: 'diagnostics'
      })
    ).rejects.toMatchObject({
      code: 'INJECTED_FAILURE'
    });

    await expect(store.exists(paths.chapterArtifact(1, 'mission.json'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(1, 'selected_plan.md'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(1, 'draft_v1.md'))).resolves.toBe(true);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 0 });
  });
});

async function prepareProject(): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m14_fail_build_bible' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m14_fail_plan_global' });
  return new ProjectPaths(tempRoot, projectId);
}
