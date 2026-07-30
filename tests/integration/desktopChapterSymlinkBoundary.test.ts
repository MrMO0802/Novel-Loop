import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import {
  draftDesktopNextChapter,
  planDesktopNextChapter
} from '../../src/desktop/chapterWorkspace.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { ChapterQueueSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

const promptRoot = path.resolve('prompts');
const temporaryDirectories: string[] = [];
const store = new FileStore();
const originalCodexBin = process.env.NLE_CODEX_BIN;

beforeEach(() => {
  temporaryDirectories.length = 0;
});

afterEach(async () => {
  if (originalCodexBin === undefined) delete process.env.NLE_CODEX_BIN;
  else process.env.NLE_CODEX_BIN = originalCodexBin;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('desktop chapter project symlink boundary', () => {
  test.each([
    ['chapters', (paths: ProjectPaths) => paths.chaptersDir()],
    ['chapter directory', (paths: ProjectPaths) => paths.chapterDir(1)],
    ['runs', (paths: ProjectPaths) => paths.runsDir()],
    ['codex runs', (paths: ProjectPaths) => paths.projectArtifact(path.join('codex', 'runs'))]
  ])('rejects a symlinked %s target before planning invokes Codex or mutates project state', async (_label, targetPath) => {
    const context = await createProject(`symlink-${slug(_label)}`);
    const external = await makeTemporaryDirectory('novel-loop-external-');
    await replaceWithDirectorySymlink(targetPath(context.paths), external);
    const before = await protectedBytes(context.paths);
    const externalBefore = await directorySnapshot(external);
    const callsBefore = await readOptional(context.argsLogPath);

    await expect(planDesktopNextChapter({
      projectRoot: context.paths.projectRoot
    })).rejects.toMatchObject({ code: 'DESKTOP_PROJECT_UNSAFE_PATH' });

    expect(await protectedBytes(context.paths)).toEqual(before);
    expect(await directorySnapshot(external)).toEqual(externalBefore);
    expect(await readOptional(context.argsLogPath)).toBe(callsBefore);
  }, 30_000);

  test('rejects a symlinked scenes target before drafting invokes Codex or mutates project state', async () => {
    const context = await createProject('symlink-scenes');
    await planDesktopNextChapter({ projectRoot: context.paths.projectRoot });
    const external = await makeTemporaryDirectory('novel-loop-external-scenes-');
    await replaceWithDirectorySymlink(
      context.paths.chapterArtifact(1, 'scenes'),
      external
    );
    const before = await protectedBytes(context.paths);
    const externalBefore = await directorySnapshot(external);
    const callsBefore = await readOptional(context.argsLogPath);

    await expect(draftDesktopNextChapter({
      projectRoot: context.paths.projectRoot
    })).rejects.toMatchObject({ code: 'DESKTOP_PROJECT_UNSAFE_PATH' });

    expect(await protectedBytes(context.paths)).toEqual(before);
    expect(await directorySnapshot(external)).toEqual(externalBefore);
    expect(await readOptional(context.argsLogPath)).toBe(callsBefore);
  }, 30_000);
});

async function createProject(projectId: string): Promise<{
  paths: ProjectPaths;
  argsLogPath: string;
}> {
  const projectsRoot = await makeTemporaryDirectory('novel-loop-symlink-boundary-');
  const paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Symlink Boundary\n\nGenerated chapter artifacts must stay inside the project.\n'
  });
  await buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    runId: `${projectId}_bible`
  });
  await planGlobal({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    runId: `${projectId}_plan`
  });
  const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
  await store.writeJson(paths.chapterQueue(), {
    ...queue,
    projectId
  }, ChapterQueueSchema);
  const fake = await writeFakeCodex(projectsRoot, 'valid');
  process.env.NLE_CODEX_BIN = fake.codexBin;
  return { paths, argsLogPath: fake.argsLogPath };
}

async function protectedBytes(paths: ProjectPaths): Promise<{
  state: Buffer;
  queue: Buffer;
}> {
  return {
    state: await readFile(paths.storyState()),
    queue: await readFile(paths.chapterQueue())
  };
}

async function replaceWithDirectorySymlink(
  targetPath: string,
  externalPath: string
): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
  await mkdir(path.dirname(targetPath), { recursive: true });
  await symlink(externalPath, targetPath, 'dir');
}

async function directorySnapshot(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.map((entry) => path.join(entry.parentPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
}
