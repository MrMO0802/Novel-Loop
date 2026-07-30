import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { ChapterQueueStore, validateChapterQueueConsistency } from '../../src/app/chapterQueue.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { validateProject } from '../../src/app/validateProject.js';
import { resolveChapterSelector } from '../../src/cli/commands/chapter.js';
import { ChapterQueueSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m14-queue-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('chapter queue lifecycle', () => {
  test('tracks chapter 1, 2, and 3 as committed after continuous production', async () => {
    const paths = await prepareProject();
    const store = new FileStore();

    await commitChapter(1, 'chapter_001');
    await expect(resolveChapterSelector({ projectId, projectsRoot: tempRoot, selector: 'next' })).resolves.toBe(2);
    await commitChapter(2, 'chapter_002');
    await expect(resolveChapterSelector({ projectId, projectsRoot: tempRoot, selector: 'next' })).resolves.toBe(3);
    await commitChapter(3, 'chapter_003');

    const queue = await store.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema);
    expect(queue.chapters.slice(0, 3).map((chapter) => chapter.status)).toEqual(['committed', 'committed', 'committed']);
    expect(queue.chapters.slice(0, 3).map((chapter) => chapter.currentStage)).toEqual(['commit', 'commit', 'commit']);
    expect(queue.chapters.slice(0, 3).every((chapter) => chapter.committedAt !== undefined)).toBe(true);
    expect(queue.chapters[0]?.completedStages).toEqual(
      expect.arrayContaining(['mission', 'plan_candidates', 'ranking', 'scene_cards', 'scene_drafts', 'draft_assembly', 'diagnostics', 'revision', 'final', 'canon_patch', 'commit'])
    );
  });

  test('validate reports chapter queue and Story State contradictions', async () => {
    const paths = await prepareProject();
    const store = new FileStore();
    const queue = await store.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema);
    queue.chapters[0] = {
      ...queue.chapters[0]!,
      status: 'committed',
      currentStage: 'commit',
      completedStages: ['commit'],
      committedAt: new Date().toISOString()
    };
    await store.writeJson(path.join(paths.planningDir(), 'chapter_queue.json'), queue, ChapterQueueSchema);

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(0);
    const validation = await validateProject({ projectId, projectsRoot: tempRoot });

    expect(validation.ok).toBe(false);
    expect(validation.checks.find((check) => check.name === 'planning/chapter_queue.json consistency')).toMatchObject({
      ok: false
    });
  });

  test('requires continuous committed or recommitted canonical history', async () => {
    const paths = await prepareProject();
    const store = new FileStore();
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    state.latestCommittedChapter = 2;
    queue.chapters[0].status = 'committed';
    queue.chapters[1].status = 'recommitted';

    expect(validateChapterQueueConsistency(queue, state)).toEqual([]);

    queue.chapters = queue.chapters.filter((chapter) => chapter.chapterNumber !== 1);
    expect(validateChapterQueueConsistency(queue, state)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Chapter 1')
      ])
    );
  });

  test('rejects a desktop queue transition from a later lifecycle status without changing the queue', async () => {
    const paths = await prepareProject();
    const store = new FileStore();
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    queue.chapters[0].status = 'diagnosing';
    await store.writeJson(paths.chapterQueue(), queue, ChapterQueueSchema);
    const before = await store.readText(paths.chapterQueue());

    const queueStore = new ChapterQueueStore(paths, store);
    await expect(queueStore.markStageStart(
      1,
      'planning',
      'mission',
      'desktop_transition_test',
      ['planned', 'planning', 'failed']
    )).rejects.toMatchObject({
      code: 'CHAPTER_QUEUE_TRANSITION_INVALID'
    });
    expect(await store.readText(paths.chapterQueue())).toBe(before);
  });

  test('rejects a desktop queue transition from a failed later lifecycle stage', async () => {
    const paths = await prepareProject();
    const store = new FileStore();
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    queue.chapters[0].status = 'failed';
    queue.chapters[0].currentStage = 'diagnostics';
    await store.writeJson(paths.chapterQueue(), queue, ChapterQueueSchema);
    const before = await store.readText(paths.chapterQueue());

    const queueStore = new ChapterQueueStore(paths, store);
    await expect(queueStore.markStageStart(
      1,
      'planning',
      'mission',
      'desktop_transition_stage_test',
      ['planned', 'planning', 'failed'],
      ['none', 'mission', 'plan_candidates', 'ranking']
    )).rejects.toMatchObject({
      code: 'CHAPTER_QUEUE_TRANSITION_INVALID'
    });
    expect(await store.readText(paths.chapterQueue())).toBe(before);
  });
});

async function prepareProject(): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m14_queue_build_bible' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m14_queue_plan_global' });
  return new ProjectPaths(tempRoot, projectId);
}

async function commitChapter(chapterNumber: number, runSuffix: string) {
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
    planningRunId: `run_m14_queue_${runSuffix}_planning`,
    draftRunId: `run_m14_queue_${runSuffix}_draft`,
    runId: `run_m14_queue_${runSuffix}_revision`
  });
}
