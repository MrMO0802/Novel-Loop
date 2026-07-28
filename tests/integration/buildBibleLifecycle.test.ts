import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible, type BuildBibleProgressEvent } from '../../src/app/buildBible.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { RunManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

const projectId = 'lifecycle-novel';
const fileStore = new FileStore();
let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-build-bible-lifecycle-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Lifecycle Novel\n\n## Core Idea\n\nA safe engine lifecycle.\n'
  });
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('buildBible lifecycle', () => {
  test('rejects a concurrent project build while its filesystem lock is fresh', async () => {
    const lockPath = path.join(paths.projectRoot, '.novel-loop-build-bible.lock');
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, 'owner.json'), '{"token":"active"}\n');

    await expect(buildBible({
      projectId,
      projectsRoot,
      provider: 'mock',
      runId: 'run_lifecycle_locked'
    })).rejects.toMatchObject({ code: 'BUILD_BIBLE_LOCKED' });
    expect(await fileStore.exists(path.join(paths.strategyDir(), 'story_bible.md'))).toBe(false);
  });

  test('recovers a crashed build lock after its bounded stale interval', async () => {
    const lockPath = path.join(paths.projectRoot, '.novel-loop-build-bible.lock');
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, 'owner.json'), '{"token":"crashed"}\n');
    const staleAt = new Date(Date.now() - 11 * 60 * 1000);
    await utimes(lockPath, staleAt, staleAt);

    await expect(buildBible({
      projectId,
      projectsRoot,
      provider: 'mock',
      runId: 'run_lifecycle_stale_lock'
    })).resolves.toBeDefined();
    expect(await fileStore.exists(lockPath)).toBe(false);
  });

  test('reports ordered stages and leaves Story State unchanged', async () => {
    const before = await fileStore.readText(paths.storyState());
    const events: BuildBibleProgressEvent[] = [];

    await buildBible({
      projectId,
      projectsRoot,
      provider: 'mock',
      runId: 'run_lifecycle_progress',
      onProgress: (event) => {
        events.push(event);
      }
    });

    expect(events).toEqual([
      { stage: 'preparing', state: 'started' },
      { stage: 'preparing', state: 'completed' },
      { stage: 'story_bible', state: 'started' },
      { stage: 'story_bible', state: 'completed' },
      { stage: 'genre_contract', state: 'started' },
      { stage: 'genre_contract', state: 'completed' },
      { stage: 'reader_promise', state: 'started' },
      { stage: 'reader_promise', state: 'completed' },
      { stage: 'style_guide', state: 'started' },
      { stage: 'style_guide', state: 'completed' },
      { stage: 'finalizing', state: 'started' },
      { stage: 'finalizing', state: 'completed' },
      { stage: 'completed', state: 'completed' }
    ]);
    expect(await fileStore.readText(paths.storyState())).toBe(before);
  });

  test('stops before the next prompt and records a cancelled run', async () => {
    let stopRequested = false;

    await expect(buildBible({
      projectId,
      projectsRoot,
      provider: 'mock',
      runId: 'run_lifecycle_cancelled',
      shouldStop: () => stopRequested,
      onProgress: (event) => {
        if (event.stage === 'story_bible' && event.state === 'completed') {
          stopRequested = true;
        }
      }
    })).rejects.toMatchObject({ code: 'BUILD_BIBLE_CANCELLED' });

    expect(await fileStore.exists(path.join(paths.strategyDir(), 'story_bible.md'))).toBe(true);
    expect(await fileStore.exists(path.join(paths.strategyDir(), 'genre_contract.md'))).toBe(false);
    expect((await fileStore.readJson(paths.runManifest('run_lifecycle_cancelled'), RunManifestSchema)).status).toBe('cancelled');
  });

  test('resumeIncomplete can replace a partial set but not a complete set', async () => {
    await fileStore.writeText(path.join(paths.strategyDir(), 'story_bible.md'), 'partial');

    await expect(buildBible({
      projectId,
      projectsRoot,
      provider: 'mock',
      runId: 'run_lifecycle_resume_partial',
      resumeIncomplete: true
    })).resolves.toBeDefined();

    await expect(buildBible({
      projectId,
      projectsRoot,
      provider: 'mock',
      runId: 'run_lifecycle_resume_complete',
      resumeIncomplete: true
    })).rejects.toMatchObject({ code: 'ARTIFACT_ALREADY_EXISTS' });
  });
});
