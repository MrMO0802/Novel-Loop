import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { extractCanonPatch } from '../../src/app/chapterCommit.js';
import { runChapterFullProduction, runChapterResume } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { CanonPatchSchema, ChapterQueueSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m14-resume-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('chapter resume pipeline', () => {
  test('resumes from final.md to canon patch and commit when patch is missing', async () => {
    const paths = await prepareProject();
    const store = new FileStore();

    await runChapterFullProduction({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: false,
      planningRunId: 'run_m14_final_planning',
      draftRunId: 'run_m14_final_draft',
      runId: 'run_m14_final_revision'
    });

    await expect(store.exists(paths.chapterArtifact(1, 'final.md'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(false);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 0 });

    const resumed = await runChapterResume({
      projectId,
      projectsRoot: tempRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      runId: 'run_m14_resume_from_final'
    });

    expect(resumed.status).toBe('committed');
    expect(resumed.resumeFromStage).toBe('canon_patch');
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(true);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 1 });
  });

  test('resumes from existing canon_patch.json to commit without regenerating patch', async () => {
    const paths = await prepareProject();
    const store = new FileStore();

    await runChapterFullProduction({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: false,
      planningRunId: 'run_m14_patch_planning',
      draftRunId: 'run_m14_patch_draft',
      runId: 'run_m14_patch_revision'
    });
    await extractCanonPatch({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_m14_patch_manual_extract'
    });
    const patchBefore = await store.readJson(paths.chapterArtifact(1, 'canon_patch.json'), CanonPatchSchema);

    const resumed = await runChapterResume({
      projectId,
      projectsRoot: tempRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      runId: 'run_m14_resume_from_patch'
    });

    expect(resumed.status).toBe('committed');
    expect(resumed.resumeFromStage).toBe('commit');
    await expect(store.readJson(paths.chapterArtifact(1, 'canon_patch.json'), CanonPatchSchema)).resolves.toEqual(patchBefore);
    const queue = await store.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema);
    expect(queue.chapters[0]).toMatchObject({
      status: 'committed',
      currentStage: 'commit'
    });
  });
});

async function prepareProject(): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m14_resume_build_bible' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m14_resume_plan_global' });
  return new ProjectPaths(tempRoot, projectId);
}
