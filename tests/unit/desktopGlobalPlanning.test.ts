import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import {
  planDesktopGlobal,
  readDesktopGlobalPlanning
} from '../../src/desktop/globalPlanning.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

const projectId = 'desktop-global-planning';
const MAX_PLANNING_MARKDOWN_BYTES = 2 * 1024 * 1024;
const promptRoot = path.resolve('prompts');
const fileStore = new FileStore();
let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-desktop-global-planning-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Desktop Global Planning\n\n## Core Idea\n\nA safe desktop planning boundary.\n'
  });
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('desktop global planning', () => {
  test('reports unavailable until all four planning artifacts exist', async () => {
    await fileStore.writeText(path.join(paths.planningDir(), 'global_outline.md'), '# Global\n');
    await expect(readDesktopGlobalPlanning({ projectRoot: paths.projectRoot })).resolves.toEqual({ available: false });
  });

  test('fixes the provider to codex-text and returns exactly four completed artifacts', async () => {
    const originalCodexBin = process.env.NLE_CODEX_BIN;
    const fake = await writeFakeCodex(projectsRoot);
    try {
      process.env.NLE_CODEX_BIN = fake.codexBin;
      await buildBible({ projectId, projectsRoot, provider: 'mock', runId: 'desktop_plan_bible' });
      await expect(planDesktopGlobal({ projectRoot: paths.projectRoot })).resolves.toEqual({ artifactCount: 4, completed: true });
      const args = await fileStore.readText(fake.argsLogPath);
      expect(args).toContain('exec');
      expect(args).not.toContain('mock');
    } finally {
      if (originalCodexBin === undefined) delete process.env.NLE_CODEX_BIN;
      else process.env.NLE_CODEX_BIN = originalCodexBin;
    }
  }, 30_000);

  test('returns only filtered planning review records without internal paths or run ids', async () => {
    await buildBible({ projectId, projectsRoot, provider: 'mock', runId: 'desktop_plan_review_bible' });
    await planGlobal({ projectId, projectsRoot, provider: 'mock', promptRoot, runId: 'desktop_plan_review' });

    const review = await readDesktopGlobalPlanning({ projectRoot: paths.projectRoot });
    expect(review.available).toBe(true);
    if (!review.available) throw new Error('Planning review unexpectedly unavailable.');
    expect(review.documents).toMatchObject([
      { kind: 'global_outline', title: 'Global Outline' },
      { kind: 'volume_outline', title: 'Volume 01 Outline' }
    ]);
    expect(review.arcs[0]).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    expect(review.chapters[0]).toMatchObject({ chapterNumber: 1, title: expect.any(String) });
    expect(JSON.stringify(review)).not.toMatch(/artifactPath|latestRunId|runId|projectsRoot/i);
  });

  test('rejects a non-file, oversized Markdown, and invalid JSON before returning review content', async () => {
    await seedPlanningArtifacts();
    const globalOutlinePath = path.join(paths.planningDir(), 'global_outline.md');
    await rm(globalOutlinePath);
    await mkdir(globalOutlinePath);
    await expect(readDesktopGlobalPlanning({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_GLOBAL_PLANNING_INVALID_OUTPUT'
    });

    await rm(globalOutlinePath, { recursive: true, force: true });
    await fileStore.writeText(globalOutlinePath, 'x'.repeat(MAX_PLANNING_MARKDOWN_BYTES + 1));
    await expect(readDesktopGlobalPlanning({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_GLOBAL_PLANNING_INVALID_OUTPUT'
    });

    await fileStore.writeText(globalOutlinePath, '# Global\n');
    await fileStore.writeText(path.join(paths.planningDir(), 'arc_map.json'), '{"arcs":"invalid"}\n');
    await expect(readDesktopGlobalPlanning({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_GLOBAL_PLANNING_INVALID_OUTPUT'
    });
  });
});

async function seedPlanningArtifacts(): Promise<void> {
  await fileStore.writeText(path.join(paths.planningDir(), 'global_outline.md'), '# Global\n');
  await fileStore.writeText(path.join(paths.planningDir(), 'volume_01_outline.md'), '# Volume\n');
  await fileStore.writeText(path.join(paths.planningDir(), 'arc_map.json'), JSON.stringify({
    schemaVersion: '1.0', projectId, arcs: []
  }));
  await fileStore.writeText(path.join(paths.planningDir(), 'chapter_queue.json'), JSON.stringify({
    schemaVersion: '1.0', projectId, chapters: []
  }));
}
