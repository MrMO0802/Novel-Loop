import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterFullProduction, runChapterResume } from '../../src/app/chapterPipeline.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m14-idem-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('chapter idempotency', () => {
  test('dry-run and until draft can repeat without updating Story State', async () => {
    const paths = await prepareProject();
    const store = new FileStore();

    await runChapterDryRun({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      candidates: 3,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_m14_idem_dry_1'
    });
    await runChapterDryRun({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      candidates: 3,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_m14_idem_dry_2'
    });
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 0 });

    await runChapterUntilDraft({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_m14_idem_draft_1'
    });
    await runChapterUntilDraft({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_m14_idem_draft_2'
    });
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 0 });
  });

  test('committed chapters cannot be committed, resumed, or force-staged by default', async () => {
    await prepareProject();
    await commitChapter(1, 'first');

    await expect(commitChapter(1, 'repeat')).rejects.toMatchObject({
      code: 'CHAPTER_ALREADY_COMMITTED'
    });
    await expect(
      runChapterResume({
        projectId,
        projectsRoot: tempRoot,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        commit: true
      })
    ).rejects.toMatchObject({
      code: 'NO_RESUMABLE_CHAPTER'
    });
    await expect(
      runChapterFullProduction({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        maxRevisions: 2,
        commit: true,
        forceStage: 'ranking'
      })
    ).rejects.toMatchObject({
      code: 'FORCE_STAGE_COMMITTED_CHAPTER'
    });
    await expect(
      runChapterDryRun({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        candidates: 3,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        forceStage: 'ranking'
      })
    ).rejects.toMatchObject({
      code: 'FORCE_STAGE_COMMITTED_CHAPTER'
    });
    await expect(
      runChapterUntilDraft({
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        forceStage: 'scene_cards'
      })
    ).rejects.toMatchObject({
      code: 'FORCE_STAGE_COMMITTED_CHAPTER'
    });
  });
});

async function prepareProject(): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m14_idem_build_bible' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m14_idem_plan_global' });
  return new ProjectPaths(tempRoot, projectId);
}

async function commitChapter(chapterNumber: number, suffix: string) {
  return runChapterFullProduction({
    projectId,
    projectsRoot: tempRoot,
    chapterNumber,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    candidates: 3,
    maxRevisions: 2,
    commit: true,
    planningRunId: `run_m14_idem_${suffix}_planning`,
    draftRunId: `run_m14_idem_${suffix}_draft`,
    runId: `run_m14_idem_${suffix}_revision`
  });
}
