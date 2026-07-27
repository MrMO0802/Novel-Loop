import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import type {
  DesktopProjectBriefInput,
  DesktopProjectInspection
} from 'novel-loop-engine/desktop';

import { FileProjectRegistryStore, type ProjectRegistry } from '../../src/main/projects/ProjectRegistryStore';
import {
  ProjectLibraryService,
  type ProjectDialogPort,
  type ProjectEngineGateway
} from '../../src/main/projects/ProjectLibraryService';

const temporaryDirectories: string[] = [];
const validInspection: DesktopProjectInspection = {
  valid: true,
  projectId: 'novel-20260727-120000-a1b2c3',
  title: '雾港来信',
  briefExcerpt: '一名夜班邮差收到来自未来的退信。',
  latestCommittedChapter: 0,
  storyBibleAvailable: false,
  globalPlanAvailable: false
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

class FakeProjectDialog implements ProjectDialogPort {
  defaultLibraryResult: string | null = null;
  projectDirectoryResult: string | null = null;
  alternateLibraryResult: string | null = null;

  async chooseDefaultLibrary(): Promise<string | null> {
    return this.defaultLibraryResult;
  }

  async chooseProjectDirectory(): Promise<string | null> {
    return this.projectDirectoryResult;
  }

  async chooseAlternateLibrary(): Promise<string | null> {
    return this.alternateLibraryResult;
  }
}

class FakeProjectGateway implements ProjectEngineGateway {
  inspection: DesktopProjectInspection = validInspection;
  createError: unknown = undefined;
  readonly create = vi.fn(async (input: {
    projectsRoot: string;
    projectId: string;
    brief: DesktopProjectBriefInput;
  }): Promise<void> => {
    if (this.createError !== undefined) {
      throw this.createError;
    }
    await mkdir(path.join(input.projectsRoot, input.projectId), { recursive: true });
  });
  readonly inspect = vi.fn(async (_projectRoot: string): Promise<DesktopProjectInspection> => (
    this.inspection
  ));
}

interface TestContext {
  root: string;
  libraryRoot: string;
  alternateLibraryRoot: string;
  registry: FileProjectRegistryStore;
  dialog: FakeProjectDialog;
  gateway: FakeProjectGateway;
  service: ProjectLibraryService;
}

async function createContext(): Promise<TestContext> {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-loop-library-'));
  temporaryDirectories.push(root);
  const libraryRoot = path.join(root, '我的小说');
  const alternateLibraryRoot = path.join(root, '另一处小说');
  await Promise.all([
    mkdir(libraryRoot),
    mkdir(alternateLibraryRoot)
  ]);
  const registry = new FileProjectRegistryStore(path.join(root, 'user-data'));
  const dialog = new FakeProjectDialog();
  const gateway = new FakeProjectGateway();
  let clockTick = 0;
  let randomTick = 0;
  const service = new ProjectLibraryService({
    registry,
    dialog,
    gateway,
    clock: () => new Date(Date.UTC(2026, 6, 27, 12, 0, clockTick++)),
    randomBytes: (size) => Uint8Array.from(
      { length: size },
      () => randomTick++ % 256
    )
  });

  return {
    root,
    libraryRoot,
    alternateLibraryRoot,
    registry,
    dialog,
    gateway,
    service
  };
}

function createRegistryProject(projectRoot: string, overrides: Partial<{
  projectKey: string;
  title: string;
  addedAt: string;
  lastOpenedAt: string;
}> = {}) {
  return {
    projectKey: 'project_0123456789abcdef01234567',
    projectRoot,
    title: '雾港来信',
    addedAt: '2026-07-27T11:00:00.000Z',
    lastOpenedAt: '2026-07-27T11:00:00.000Z',
    ...overrides
  };
}

async function registrySnapshot(registry: FileProjectRegistryStore): Promise<ProjectRegistry> {
  return (await registry.load()).registry;
}

async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('ProjectLibraryService', () => {
  test('first create requests and remembers a default library', async () => {
    const { dialog, gateway, libraryRoot, registry, service } = await createContext();
    dialog.defaultLibraryResult = libraryRoot;

    const selected = await service.chooseDefaultLibrary();
    const created = await service.create({
      title: '雾港来信',
      coreIdea: '一名夜班邮差收到来自未来的退信。',
      useDifferentLocation: false
    });

    expect(selected).toEqual({
      selection: 'selected',
      locationLabel: path.basename(libraryRoot)
    });
    expect(created).toMatchObject({
      outcome: 'created',
      project: { title: '雾港来信' }
    });
    expect((await registrySnapshot(registry)).defaultLibraryRoot).toBe(libraryRoot);
    expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({ projectsRoot: libraryRoot }));
    expect(JSON.stringify(created)).not.toContain(libraryRoot);
  });

  test('cancelled open writes nothing', async () => {
    const { dialog, gateway, registry, service } = await createContext();
    dialog.projectDirectoryResult = null;
    const before = await registrySnapshot(registry);

    await expect(service.openExisting()).resolves.toEqual({ outcome: 'cancelled' });
    await expect(registrySnapshot(registry)).resolves.toEqual(before);
    expect(gateway.inspect).not.toHaveBeenCalled();
  });

  test('an unavailable default library selection returns a typed outcome', async () => {
    const { dialog, root, service } = await createContext();
    dialog.defaultLibraryResult = path.join(root, 'removed-library');

    await expect(service.chooseDefaultLibrary()).resolves.toEqual({
      selection: 'location_unavailable'
    });
  });

  test('opening an invalid directory does not add it', async () => {
    const { dialog, gateway, root, service } = await createContext();
    const invalidRoot = path.join(root, 'not-a-project');
    await mkdir(invalidRoot);
    dialog.projectDirectoryResult = invalidRoot;
    gateway.inspection = { valid: false, reason: 'invalid_project' };

    await expect(service.openExisting()).resolves.toEqual({ outcome: 'invalid_project' });
    await expect(service.list()).resolves.toMatchObject({ projects: [] });
  });

  test('remove forgets the entry without touching its project', async () => {
    const { libraryRoot, registry, service } = await createContext();
    const projectRoot = path.join(libraryRoot, 'novel-20260727-120000-a1b2c3');
    const storyStatePath = path.join(projectRoot, 'state', 'story_state.json');
    await mkdir(path.dirname(storyStatePath), { recursive: true });
    await writeFile(storyStatePath, '{"chapter":0}\n');
    const projectKey = 'project_0123456789abcdef01234567';
    await registry.save({
      schemaVersion: 1,
      defaultLibraryRoot: libraryRoot,
      projects: [createRegistryProject(projectRoot, { projectKey })]
    });
    const storyHashBefore = await hashFile(storyStatePath);

    await service.remove(projectKey);

    await expect(hashFile(storyStatePath)).resolves.toBe(storyHashBefore);
    await expect(fileExists(storyStatePath)).resolves.toBe(true);
    await expect(registrySnapshot(registry)).resolves.toMatchObject({ projects: [] });
  });

  test('alternate creation location does not replace the default library', async () => {
    const { alternateLibraryRoot, dialog, gateway, libraryRoot, registry, service } = await createContext();
    await registry.save({ schemaVersion: 1, defaultLibraryRoot: libraryRoot, projects: [] });
    dialog.alternateLibraryResult = alternateLibraryRoot;

    await expect(service.create({
      title: '雾港来信',
      coreIdea: '一名夜班邮差收到来自未来的退信。',
      useDifferentLocation: true
    })).resolves.toMatchObject({ outcome: 'created' });

    expect((await registrySnapshot(registry)).defaultLibraryRoot).toBe(libraryRoot);
    expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({
      projectsRoot: alternateLibraryRoot
    }));
  });

  test('duplicate open updates time instead of adding another entry', async () => {
    const { dialog, gateway, libraryRoot, registry, service } = await createContext();
    const projectRoot = path.join(libraryRoot, 'novel-20260727-120000-a1b2c3');
    await mkdir(projectRoot);
    dialog.projectDirectoryResult = projectRoot;

    await service.openExisting();
    await service.openExisting();

    const saved = await registrySnapshot(registry);
    expect(saved.projects).toHaveLength(1);
    expect(saved.projects[0]?.lastOpenedAt).toBe('2026-07-27T12:00:01.000Z');
    expect(gateway.inspect).toHaveBeenCalledTimes(2);
  });

  test('opening a symlink alias deduplicates by canonical realpath', async () => {
    const { dialog, libraryRoot, registry, root, service } = await createContext();
    const projectRoot = path.join(libraryRoot, 'novel-20260727-120000-a1b2c3');
    const aliasRoot = path.join(root, 'alias');
    await mkdir(projectRoot);
    await symlink(projectRoot, aliasRoot, 'dir');

    dialog.projectDirectoryResult = projectRoot;
    await service.openExisting();
    dialog.projectDirectoryResult = aliasRoot;
    await service.openExisting();

    const saved = await registrySnapshot(registry);
    expect(saved.projects).toHaveLength(1);
    expect(saved.projects[0]?.projectRoot).toBe(projectRoot);
  });

  test('list orders recent projects by last opened time', async () => {
    const { libraryRoot, registry, service } = await createContext();
    const olderRoot = path.join(libraryRoot, 'novel-20260727-100000-a1b2c3');
    const newerRoot = path.join(libraryRoot, 'novel-20260727-110000-a1b2c3');
    await Promise.all([mkdir(olderRoot), mkdir(newerRoot)]);
    await registry.save({
      schemaVersion: 1,
      defaultLibraryRoot: libraryRoot,
      projects: [
        createRegistryProject(olderRoot, {
          projectKey: 'project_older',
          lastOpenedAt: '2026-07-27T10:00:00.000Z'
        }),
        createRegistryProject(newerRoot, {
          projectKey: 'project_newer',
          lastOpenedAt: '2026-07-27T11:00:00.000Z'
        })
      ]
    });

    const result = await service.list();

    expect(result.projects.map((project) => project.projectKey)).toEqual([
      'project_newer',
      'project_older'
    ]);
  });

  test('reopen revalidates the saved project before returning it', async () => {
    const { gateway, libraryRoot, registry, service } = await createContext();
    const projectRoot = path.join(libraryRoot, 'novel-20260727-120000-a1b2c3');
    await mkdir(projectRoot);
    await registry.save({
      schemaVersion: 1,
      defaultLibraryRoot: libraryRoot,
      projects: [createRegistryProject(projectRoot)]
    });
    gateway.inspection = { valid: false, reason: 'project_data_invalid' };

    await expect(service.open('project_0123456789abcdef01234567')).resolves.toEqual({
      outcome: 'invalid_project'
    });
    expect(gateway.inspect).toHaveBeenCalledWith(projectRoot);
  });

  test('missing recent project becomes needs_attention', async () => {
    const { libraryRoot, registry, root, service } = await createContext();
    const missingProjectRoot = path.join(root, 'missing-project');
    await registry.save({
      schemaVersion: 1,
      defaultLibraryRoot: libraryRoot,
      projects: [createRegistryProject(missingProjectRoot)]
    });

    const result = await service.list();

    expect(result.projects).toEqual([expect.objectContaining({
      projectKey: 'project_0123456789abcdef01234567',
      health: 'needs_attention'
    })]);
    expect(JSON.stringify(result)).not.toContain(missingProjectRoot);
  });

  test('create retries a typed project collision exactly once with a new internal ID', async () => {
    const { gateway, libraryRoot, registry, service } = await createContext();
    await registry.save({ schemaVersion: 1, defaultLibraryRoot: libraryRoot, projects: [] });
    gateway.create.mockRejectedValueOnce(Object.assign(new Error('already exists'), {
      code: 'PROJECT_ALREADY_EXISTS'
    }));

    await expect(service.create({
      title: '雾港来信',
      coreIdea: '一名夜班邮差收到来自未来的退信。',
      useDifferentLocation: false
    })).resolves.toMatchObject({ outcome: 'created' });

    expect(gateway.create).toHaveBeenCalledTimes(2);
    const firstProjectId = gateway.create.mock.calls[0]?.[0].projectId;
    const secondProjectId = gateway.create.mock.calls[1]?.[0].projectId;
    expect(firstProjectId).not.toBe(secondProjectId);
  });

  test('engine exception maps to failed without its raw message', async () => {
    const { gateway, libraryRoot, registry, service } = await createContext();
    await registry.save({ schemaVersion: 1, defaultLibraryRoot: libraryRoot, projects: [] });
    gateway.create.mockRejectedValueOnce(new Error('private path: /very/secret/library'));

    const result = await service.create({
      title: '雾港来信',
      coreIdea: '一名夜班邮差收到来自未来的退信。',
      useDifferentLocation: false
    });

    expect(result).toEqual({ outcome: 'failed' });
    expect(JSON.stringify(result)).not.toContain('/very/secret/library');
    expect(gateway.create).toHaveBeenCalledTimes(1);
  });

  test('renderer-facing results never expose absolute paths', async () => {
    const { dialog, libraryRoot, registry, root, service } = await createContext();
    const projectRoot = path.join(libraryRoot, 'novel-20260727-120000-a1b2c3');
    await mkdir(projectRoot);
    await registry.save({
      schemaVersion: 1,
      defaultLibraryRoot: libraryRoot,
      projects: [createRegistryProject(projectRoot)]
    });
    dialog.projectDirectoryResult = projectRoot;

    const results = await Promise.all([
      service.list(),
      service.chooseDefaultLibrary(),
      service.openExisting(),
      service.open('project_0123456789abcdef01234567'),
      service.remove('project_0123456789abcdef01234567')
    ]);

    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain(root);
      expect(JSON.stringify(result)).not.toMatch(/(?:^|["'])\/[A-Za-z0-9._/-]+/);
    }
  });
});
