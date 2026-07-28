import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { readDesktopStoryBible } from '../../src/desktop/storyBible.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

const projectId = 'desktop-story-bible';
const fileStore = new FileStore();
let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-desktop-story-bible-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Desktop Story Bible\n\n## Core Idea\n\nA safe desktop boundary.\n'
  });
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('desktop Story Bible', () => {
  test('reports unavailable until all four foundation documents exist', async () => {
    await fileStore.writeText(path.join(paths.strategyDir(), 'story_bible.md'), '# Story Bible\n');

    await expect(readDesktopStoryBible({ projectRoot: paths.projectRoot })).resolves.toEqual({ available: false });
  });

  test('returns the fixed four foundation documents after generation', async () => {
    await buildBible({
      projectId,
      projectsRoot,
      provider: 'mock',
      runId: 'run_desktop_story_bible'
    });

    await expect(readDesktopStoryBible({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
      available: true,
      documents: [
        { kind: 'story_bible', title: 'Story Bible' },
        { kind: 'genre_contract', title: 'Genre Contract' },
        { kind: 'reader_promise', title: 'Reader Promise' },
        { kind: 'style_guide', title: 'Style Guide' }
      ]
    });
  });

  test('uses packaged prompt fixtures and output schemas after cwd changes', async () => {
    const originalCwd = process.cwd();
    const originalCodexBin = process.env.NLE_CODEX_BIN;
    const unrelatedCwd = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-unrelated-cwd-'));
    const fake = await writeFakeCodex(projectsRoot);

    try {
      process.chdir(unrelatedCwd);
      process.env.NLE_CODEX_BIN = fake.codexBin;
      vi.resetModules();
      const { buildDesktopStoryBible } = await import('../../src/desktop/storyBible.js');
      const { resolveCodexOutputSchema } = await import('../../src/providers/codex/schemas.js');
      await expect(buildDesktopStoryBible({ projectRoot: paths.projectRoot })).resolves.toEqual({
        artifactCount: 4,
        completed: true
      });
      expect(resolveCodexOutputSchema('strategy.build_story_bible')?.schemaPath).toMatch(/schemas[\\/]codex-output[\\/]strategy\.story_bible\.schema\.json$/);
    } finally {
      process.chdir(originalCwd);
      if (originalCodexBin === undefined) {
        delete process.env.NLE_CODEX_BIN;
      } else {
        process.env.NLE_CODEX_BIN = originalCodexBin;
      }
      await rm(unrelatedCwd, { recursive: true, force: true });
    }
  });
});
