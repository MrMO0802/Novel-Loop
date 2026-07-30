import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { RunManifestSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { validCharacterState } from '../fixtures/schemas/valid.js';

const projectId = 'chapter-desktop-lifecycle';
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');
let projectsRoot: string;
let paths: ProjectPaths;
const store = new FileStore();

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-chapter-lifecycle-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  const briefPath = path.join(projectsRoot, 'brief.md');
  await writeFile(briefPath, '# Chapter Lifecycle\n\nA recoverable chapter workflow.\n', 'utf8');
  await initProject({ projectId, briefPath, projectsRoot });
  await buildBible({ projectId, projectsRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_chapter_lifecycle_bible' });
  await planGlobal({ projectId, projectsRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_chapter_lifecycle_plan' });
  const initialState = await store.readJson(paths.storyState(), StoryStateSchema);
  await store.writeJson(paths.storyState(), {
    ...initialState,
    characters: [validCharacterState]
  }, StoryStateSchema);
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('desktop chapter lifecycles', () => {
  test('records a recoverable planning cancellation and reuses the completed mission on rerun', async () => {
    let stopRequested = false;
    const beforeStateHash = sha256(await store.readText(paths.storyState()));

    await expect(runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      candidates: 3,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_chapter_planning_cancelled',
      shouldStop: () => stopRequested,
      onProgress: (event) => {
        if (event.stage === 'mission' && event.state === 'completed') stopRequested = true;
      }
    })).rejects.toMatchObject({ code: 'CHAPTER_PLANNING_CANCELLED' });

    expect(await store.exists(paths.chapterArtifact(1, 'mission.json'))).toBe(true);
    expect(await store.exists(paths.chapterArtifact(1, 'ranking.json'))).toBe(false);
    expect(sha256(await store.readText(paths.storyState()))).toBe(beforeStateHash);
    const cancelledManifest = await store.readJson(paths.runManifest('run_chapter_planning_cancelled'), RunManifestSchema);
    expect(cancelledManifest.status).toBe('failed');
    expect(cancelledManifest.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CHAPTER_PLANNING_CANCELLED', recoverable: true })
    ]));

    const resumed = await runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      candidates: 3,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_chapter_planning_resumed'
    });

    expect(resumed.reusedArtifacts).toContain('chapters/chapter_001/mission.json');
  });

  test('records a recoverable drafting cancellation without creating post-draft canonical artifacts', async () => {
    await runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      candidates: 3,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_chapter_drafting_prerequisites'
    });
    let stopRequested = false;
    const beforeStateHash = sha256(await store.readText(paths.storyState()));

    await expect(runChapterUntilDraft({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_chapter_draft_cancelled',
      shouldStop: () => stopRequested,
      onProgress: (event) => {
        if (event.stage === 'scene_drafts' && event.state === 'progress' && event.current === 1) stopRequested = true;
      }
    })).rejects.toMatchObject({ code: 'CHAPTER_DRAFT_CANCELLED' });

    expect(await store.exists(paths.chapterArtifact(1, 'scenes', 'scene_001.md'))).toBe(true);
    expect(await store.exists(paths.chapterArtifact(1, 'scenes', 'scene_002.md'))).toBe(false);
    expect(await store.exists(paths.chapterArtifact(1, 'draft_v1.md'))).toBe(false);
    expect(await store.exists(paths.chapterArtifact(1, 'final.md'))).toBe(false);
    expect(sha256(await store.readText(paths.storyState()))).toBe(beforeStateHash);
    const cancelledManifest = await store.readJson(paths.runManifest('run_chapter_draft_cancelled'), RunManifestSchema);
    expect(cancelledManifest.status).toBe('failed');
    expect(cancelledManifest.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CHAPTER_DRAFT_CANCELLED', recoverable: true })
    ]));

    const resumed = await runChapterUntilDraft({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_chapter_draft_resumed'
    });

    expect(resumed.reusedArtifacts).toEqual(expect.arrayContaining([
      'chapters/chapter_001/scene_cards.json',
      'chapters/chapter_001/scenes/scene_001.md'
    ]));
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
