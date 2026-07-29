import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { planGlobal, type PlanGlobalProgressEvent } from '../../src/app/planGlobal.js';
import { ArcMapSchema, RunManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

const projectId = 'plan-global-lifecycle';
const promptRoot = path.resolve('tests/fixtures/prompts');
const fixturesRoot = path.resolve('tests/fixtures/llm');
const fileStore = new FileStore();
let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-plan-global-lifecycle-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Planning Lifecycle\n\n## Core Idea\n\nA safe global planning lifecycle.\n'
  });
  await buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    runId: 'run_plan_lifecycle_bible'
  });
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('planGlobal lifecycle', () => {
  test('reports ordered stages and leaves Story State unchanged', async () => {
    const before = await fileStore.readText(paths.storyState());
    const events: PlanGlobalProgressEvent[] = [];

    await planGlobal({
      projectId,
      projectsRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_plan_lifecycle_progress',
      onProgress: (event) => events.push(event)
    });

    expect(events.map((event) => `${event.stage}:${event.state}`)).toEqual([
      'preparing:started',
      'preparing:completed',
      'global_outline:started',
      'global_outline:completed',
      'volume_outline:started',
      'volume_outline:completed',
      'arc_map:started',
      'arc_map:completed',
      'chapter_queue:started',
      'chapter_queue:completed',
      'finalizing:started',
      'finalizing:completed',
      'completed:completed'
    ]);
    expect(await fileStore.readText(paths.storyState())).toBe(before);
  });

  test('stops before a later stage and records a recoverable cancelled run', async () => {
    let stopRequested = false;

    await expect(planGlobal({
      projectId,
      projectsRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_plan_lifecycle_cancelled',
      shouldStop: () => stopRequested,
      onProgress: (event) => {
        if (event.stage === 'global_outline' && event.state === 'completed') stopRequested = true;
      }
    })).rejects.toMatchObject({ code: 'PLAN_GLOBAL_CANCELLED' });

    expect(await fileStore.exists(path.join(paths.planningDir(), 'global_outline.md'))).toBe(true);
    expect(await fileStore.exists(path.join(paths.planningDir(), 'volume_01_outline.md'))).toBe(false);
    expect((await fileStore.readJson(paths.runManifest('run_plan_lifecycle_cancelled'), RunManifestSchema)).status).toBe('cancelled');
  });

  test('resumes a valid partial plan without replacing completed stages', async () => {
    const globalOutlinePath = path.join(paths.planningDir(), 'global_outline.md');
    const existingOutline = '# Reused Global Outline\n\nExisting valid planning work.\n';
    await fileStore.writeText(globalOutlinePath, existingOutline);

    await planGlobal({
      projectId,
      projectsRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_plan_lifecycle_resume',
      resumeIncomplete: true
    });

    expect(await fileStore.readText(globalOutlinePath)).toBe(existingOutline);
    expect(await fileStore.readJson(path.join(paths.planningDir(), 'arc_map.json'), ArcMapSchema)).toMatchObject({
      schemaVersion: '1.0'
    });
    const manifest = await fileStore.readJson(paths.runManifest('run_plan_lifecycle_resume'), RunManifestSchema);
    expect(JSON.stringify(manifest.artifacts)).toContain('resumed desktop global planning stage');
  });

  test('rejects a complete plan rerun and an invalid resumed JSON artifact', async () => {
    await planGlobal({
      projectId,
      projectsRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_plan_lifecycle_complete'
    });
    await expect(planGlobal({
      projectId,
      projectsRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_plan_lifecycle_complete_again',
      resumeIncomplete: true
    })).rejects.toMatchObject({ code: 'ARTIFACT_ALREADY_EXISTS' });

    await rm(paths.planningDir(), { recursive: true, force: true });
    await fileStore.ensureDir(paths.planningDir());
    await fileStore.writeText(path.join(paths.planningDir(), 'global_outline.md'), '# Existing\n');
    await fileStore.writeText(path.join(paths.planningDir(), 'volume_01_outline.md'), '# Existing Volume\n');
    await fileStore.writeText(path.join(paths.planningDir(), 'arc_map.json'), '{"schemaVersion":"1.0","projectId":"wrong","arcs":"invalid"}\n');
    await expect(planGlobal({
      projectId,
      projectsRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_plan_lifecycle_invalid_resume',
      resumeIncomplete: true
    })).rejects.toBeDefined();
  });

  test('rejects a concurrent project build lock before writing planning artifacts', async () => {
    const lockPath = path.join(paths.projectRoot, '.novel-loop-build-bible.lock');
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, 'owner.json'), '{"token":"active"}\n');

    await expect(planGlobal({
      projectId,
      projectsRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_plan_lifecycle_locked'
    })).rejects.toMatchObject({ code: 'BUILD_BIBLE_LOCKED' });
    expect(await fileStore.exists(path.join(paths.planningDir(), 'global_outline.md'))).toBe(false);
  });
});
