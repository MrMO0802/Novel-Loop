import { createHash } from 'node:crypto';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  createDesktopProject,
  inspectDesktopProject
} from '../../src/desktop/projectLibrary.js';
import { validateProject } from '../../src/app/validateProject.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

const projectId = 'novel-20260727-120000-abc123';
const projectTitle = '雾港来信';
const coreIdea = '一名夜班邮差收到来自未来的退信。';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('desktop project library', () => {
  test('creates a standard project from author brief fields', async () => {
    const projectsRoot = await makeTempDir();
    await createDesktopProject({
      projectId,
      projectsRoot,
      brief: {
        title: projectTitle,
        coreIdea,
        genre: '悬疑',
        protagonist: '林岚'
      }
    });

    const paths = new ProjectPaths(projectsRoot, projectId);
    expect(await new FileStore().readText(paths.brief())).toContain(`# ${projectTitle}`);
    expect(await validateProject({
      projectId: paths.projectId,
      projectsRoot
    })).toMatchObject({ ok: true });
  });

  test('preserves a path-free typed code for a physical project collision', async () => {
    const projectsRoot = await makeTempDir();
    const input = {
      projectId,
      projectsRoot,
      brief: { title: projectTitle, coreIdea }
    };
    await createDesktopProject(input);

    const error = await createDesktopProject(input).catch(
      (caught: unknown) => caught
    );

    expect(error).toMatchObject({ code: 'PROJECT_ALREADY_EXISTS' });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(
      new ProjectPaths(projectsRoot, projectId).projectRoot
    );
  });

  test('inspects an existing project without returning its path', async () => {
    const projectsRoot = await makeTempDir();
    await createDesktopProject({
      projectId,
      projectsRoot,
      brief: { title: projectTitle, coreIdea }
    });
    const projectRoot = new ProjectPaths(projectsRoot, projectId).projectRoot;

    const before = await hashStoryState(projectRoot);
    const inspection = await inspectDesktopProject({ projectRoot });
    const after = await hashStoryState(projectRoot);

    expect(inspection).toMatchObject({
      valid: true,
      projectId,
      title: projectTitle,
      briefExcerpt: coreIdea,
      latestCommittedChapter: 0,
      storyBibleAvailable: false,
      globalPlanAvailable: false
    });
    expect(JSON.stringify(inspection)).not.toContain(projectRoot);
    expect(after).toBe(before);
  });

  test('keeps Story Bible unavailable when only one foundation artifact exists', async () => {
    const projectsRoot = await makeTempDir();
    await createDesktopProject({
      projectId,
      projectsRoot,
      brief: { title: projectTitle, coreIdea }
    });
    const paths = new ProjectPaths(projectsRoot, projectId);
    await new FileStore().writeText(path.join(paths.strategyDir(), 'story_bible.md'), '# Partial Story Bible\n');

    await expect(inspectDesktopProject({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
      valid: true,
      storyBibleAvailable: false
    });
  });

  test('rejects a selected directory whose folder does not match projectId', async () => {
    const projectsRoot = await makeTempDir();
    await createDesktopProject({
      projectId,
      projectsRoot,
      brief: { title: projectTitle, coreIdea }
    });
    const paths = new ProjectPaths(projectsRoot, projectId);
    const mismatchedProjectRoot = path.join(projectsRoot, 'novel-20260727-120000-def456');
    await rename(paths.projectRoot, mismatchedProjectRoot);

    const inspection = await inspectDesktopProject({ projectRoot: mismatchedProjectRoot });

    expect(inspection).toEqual({
      valid: false,
      reason: 'invalid_project'
    });
  });
});

async function makeTempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-desktop-library-'));
  temporaryRoots.push(root);
  return root;
}

async function hashStoryState(projectRoot: string): Promise<string> {
  const content = await new FileStore().readText(path.join(projectRoot, 'state', 'story_state.json'));
  return createHash('sha256').update(content).digest('hex');
}
