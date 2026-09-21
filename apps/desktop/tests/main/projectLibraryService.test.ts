import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const fileSystemMocks = vi.hoisted(() => ({
  access: vi.fn<typeof import('node:fs/promises').access>(),
  actualAccess: undefined as
    | typeof import('node:fs/promises').access
    | undefined
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  fileSystemMocks.actualAccess = original.access;
  fileSystemMocks.access.mockImplementation(original.access);
  return {
    ...original,
    access: fileSystemMocks.access
  };
});

import type {
  DesktopProjectBriefInput,
  DesktopProjectInspection
} from 'novel-loop-engine/desktop';

import {
  EngineProjectGateway
} from '../../src/main/projects/EngineProjectGateway';
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
  fileSystemMocks.access.mockReset();
  fileSystemMocks.access.mockImplementation(fileSystemMocks.actualAccess!);
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

class FakeProjectDialog implements ProjectDialogPort {
  defaultLibraryResult: string | null = null;
  projectDirectoryResult: string | null = null;
  alternateLibraryResult: string | null = null;
  defaultLibraryError: unknown = undefined;

  async chooseDefaultLibrary(): Promise<string | null> {
    if (this.defaultLibraryError !== undefined) throw this.defaultLibraryError;
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

type RegistryMutationOperation =
  | 'chooseDefaultLibrary'
  | 'create'
  | 'openExisting'
  | 'open'
  | 'remove';

const corruptRegistryCases = [
  {
    name: 'malformed JSON',
    contents: '{not valid json'
  },
  {
    name: 'schema-invalid JSON',
    contents: JSON.stringify({
      schemaVersion: 1,
      defaultLibraryRoot: null,
      projects: [{ projectKey: 'missing-required-fields' }]
    })
  }
] as const;
const registryMutationOperations: RegistryMutationOperation[] = [
  'chooseDefaultLibrary',
  'create',
  'openExisting',
  'open',
  'remove'
];
const warnedRegistryMutationCases = corruptRegistryCases.flatMap(
  (registryCase) => registryMutationOperations.map((operation) => ({
    ...registryCase,
    operation
  }))
);

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

async function runWarnedRegistryMutation(
  context: TestContext,
  operation: RegistryMutationOperation
) {
  const projectRoot = path.join(
    context.libraryRoot,
    'novel-20260727-120000-a1b2c3'
  );
  await mkdir(projectRoot, { recursive: true });
  context.dialog.defaultLibraryResult = context.libraryRoot;
  context.dialog.alternateLibraryResult = context.alternateLibraryRoot;
  context.dialog.projectDirectoryResult = projectRoot;

  switch (operation) {
    case 'chooseDefaultLibrary':
      return context.service.chooseDefaultLibrary();
    case 'create':
      return context.service.create({
        title: '雾港来信',
        coreIdea: '一名夜班邮差收到来自未来的退信。',
        useDifferentLocation: true
      });
    case 'openExisting':
      return context.service.openExisting();
    case 'open':
      return context.service.open('project_0123456789abcdef01234567');
    case 'remove':
      return context.service.remove('project_0123456789abcdef01234567');
  }
}

function warnedMutationOutcome(operation: RegistryMutationOperation) {
  if (operation === 'chooseDefaultLibrary') {
    return { selection: 'location_unavailable' };
  }
  if (operation === 'remove') {
    return {
      projects: [],
      defaultLocation: { configured: false, locationLabel: null },
      warning: 'registry_unavailable'
    };
  }
  return { outcome: 'failed' };
}

class PhysicalCollisionGateway extends EngineProjectGateway {
  readonly collisionInjections: boolean[] = [];
  readonly createInputs: Array<{
    projectsRoot: string;
    projectId: string;
    brief: DesktopProjectBriefInput;
  }> = [];

  constructor(private remainingCollisions: number) {
    super();
  }

  override async create(input: {
    projectsRoot: string;
    projectId: string;
    brief: DesktopProjectBriefInput;
  }): Promise<void> {
    this.createInputs.push(input);
    const injectCollision = this.remainingCollisions > 0;
    this.collisionInjections.push(injectCollision);
    if (injectCollision) {
      this.remainingCollisions -= 1;
      await mkdir(path.join(input.projectsRoot, input.projectId));
    }
    await super.create(input);
  }
}

async function createPhysicalCollisionContext(collisionCount: number) {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-loop-real-collision-'));
  temporaryDirectories.push(root);
  const libraryRoot = path.join(root, 'library');
  await mkdir(libraryRoot);
  const registry = new FileProjectRegistryStore(path.join(root, 'user-data'));
  await registry.save({
    schemaVersion: 1,
    defaultLibraryRoot: libraryRoot,
    projects: []
  });
  const gateway = new PhysicalCollisionGateway(collisionCount);
  let randomTick = 0;
  const service = new ProjectLibraryService({
    registry,
    dialog: new FakeProjectDialog(),
    gateway,
    clock: () => new Date('2026-07-27T12:00:00.000Z'),
    randomBytes: (size) => Uint8Array.from(
      { length: size },
      () => randomTick++ % 256
    )
  });
  return { gateway, libraryRoot, service };
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

async function createReadOnlyProjectFixture(
  libraryRoot: string,
  gateway: EngineProjectGateway
): Promise<string> {
  const projectId = 'novel-20260727-120000-c0ffee';
  await gateway.create({
    projectsRoot: libraryRoot,
    projectId,
    brief: {
      title: '雾港来信',
      coreIdea: '一名夜班邮差收到来自未来的退信。'
    }
  });
  const projectRoot = path.join(libraryRoot, projectId);
  const fixtureFiles = new Map<string, string>([
    [
      'planning/chapter_queue.json',
      `${JSON.stringify({
        schemaVersion: '1.0',
        projectId,
        chapters: [{
          chapterNumber: 1,
          title: '退信',
          status: 'planned'
        }]
      }, null, 2)}\n`
    ],
    ['planning/global_outline.md', '# 全局规划\n\n已有规划内容。\n'],
    ['strategy/story_bible.md', '# 故事基础\n\n已有设定内容。\n'],
    ['chapters/chapter_001/outline.md', '# 第一章章纲\n'],
    ['chapters/chapter_001/draft_v1.md', '# 第一章草稿\n'],
    ['chapters/chapter_001/artifact.json', '{"kind":"chapter-artifact"}\n'],
    ['runs/run_fixture/manifest.json', '{"status":"complete"}\n'],
    ['runs/run_fixture/events.jsonl', '{"event":"fixture"}\n'],
    ['snapshots/chapter_000/story_state.json', '{"snapshot":0}\n'],
    ['diffs/chapter_001.patch', '--- draft\n+++ final\n']
  ]);

  for (const [relativePath, contents] of fixtureFiles) {
    const filePath = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, 'utf8');
  }

  return projectRoot;
}

async function snapshotProjectTree(projectRoot: string): Promise<Array<{
  kind: 'directory' | 'file';
  path: string;
  sha256?: string;
}>> {
  const snapshot: Array<{
    kind: 'directory' | 'file';
    path: string;
    sha256?: string;
  }> = [];

  async function visit(directoryPath: string, relativeDirectory: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativePath = relativeDirectory.length === 0
        ? entry.name
        : path.join(relativeDirectory, entry.name);
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        snapshot.push({ kind: 'directory', path: relativePath });
        await visit(entryPath, relativePath);
      } else if (entry.isFile()) {
        snapshot.push({
          kind: 'file',
          path: relativePath,
          sha256: createHash('sha256')
            .update(await readFile(entryPath))
            .digest('hex')
        });
      } else {
        throw new Error(`Unsupported fixture entry: ${relativePath}`);
      }
    }
  }

  await visit(projectRoot, '');
  return snapshot;
}

describe('ProjectLibraryService', () => {
  test.each(warnedRegistryMutationCases)(
    'blocks $operation after loading $name',
    async ({ contents, operation }) => {
      const context = await createContext();
      await mkdir(path.dirname(context.registry.registryPath), {
        recursive: true
      });
      await writeFile(context.registry.registryPath, contents, 'utf8');
      const save = vi.spyOn(context.registry, 'save');

      await expect(runWarnedRegistryMutation(context, operation)).resolves
        .toEqual(warnedMutationOutcome(operation));

      expect(save).not.toHaveBeenCalled();
      expect(context.gateway.create).not.toHaveBeenCalled();
      expect(context.gateway.inspect).not.toHaveBeenCalled();
      await expect(readFile(context.registry.registryPath, 'utf8')).resolves
        .toBe(contents);
    }
  );

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

  test('default library selection rejects a directory without create access', async () => {
    const { dialog, libraryRoot, service } = await createContext();
    dialog.defaultLibraryResult = libraryRoot;
    fileSystemMocks.access.mockRejectedValueOnce(Object.assign(new Error('denied'), {
      code: 'EACCES'
    }));

    await expect(service.chooseDefaultLibrary()).resolves.toEqual({
      selection: 'location_unavailable'
    });
    expect(fileSystemMocks.access).toHaveBeenCalledWith(
      libraryRoot,
      constants.R_OK | constants.W_OK
    );
  });

  test('alternate library creation rejects a directory without create access', async () => {
    const { alternateLibraryRoot, dialog, gateway, service } = await createContext();
    dialog.alternateLibraryResult = alternateLibraryRoot;
    fileSystemMocks.access.mockRejectedValueOnce(Object.assign(new Error('denied'), {
      code: 'EACCES'
    }));

    await expect(service.create({
      title: '雾港来信',
      coreIdea: '一名夜班邮差收到来自未来的退信。',
      useDifferentLocation: true
    })).resolves.toEqual({ outcome: 'location_unavailable' });
    expect(gateway.create).not.toHaveBeenCalled();
    expect(fileSystemMocks.access).toHaveBeenCalledWith(
      alternateLibraryRoot,
      constants.R_OK | constants.W_OK
    );
  });

  test('existing project selection rejects a directory without read access', async () => {
    const { dialog, gateway, libraryRoot, service } = await createContext();
    const projectRoot = path.join(libraryRoot, 'novel-20260727-120000-a1b2c3');
    await mkdir(projectRoot);
    dialog.projectDirectoryResult = projectRoot;
    fileSystemMocks.access.mockRejectedValueOnce(Object.assign(new Error('denied'), {
      code: 'EACCES'
    }));

    await expect(service.openExisting()).resolves.toEqual({ outcome: 'location_unavailable' });
    expect(gateway.inspect).not.toHaveBeenCalled();
    expect(fileSystemMocks.access).toHaveBeenCalledWith(projectRoot, constants.R_OK);
  });

  test('resolves only registered readable valid project roots for main-process services', async () => {
    const { gateway, libraryRoot, registry, service } = await createContext();
    const projectKey = 'project_0123456789abcdef01234567';
    const projectRoot = path.join(libraryRoot, 'novel-20260727-120000-a1b2c3');
    await mkdir(projectRoot);
    await registry.save({
      schemaVersion: 1,
      defaultLibraryRoot: libraryRoot,
      projects: [createRegistryProject(projectRoot, { projectKey })]
    });

    await expect(service.resolveProjectRoot(projectKey)).resolves.toBe(projectRoot);
    await expect(service.resolveProjectRoot('project_missing')).resolves.toBeNull();

    fileSystemMocks.access.mockRejectedValueOnce(Object.assign(new Error('denied'), {
      code: 'EACCES'
    }));
    await expect(service.resolveProjectRoot(projectKey)).resolves.toBeNull();

    gateway.inspection = { valid: false, reason: 'project_data_invalid' };
    await expect(service.resolveProjectRoot(projectKey)).resolves.toBeNull();
    await expect(service.resolveRegisteredRootForRecovery(projectKey)).resolves.toBe(projectRoot);
    await expect(service.resolveRegisteredRootForRecovery(projectRoot)).resolves.toBeNull();
    await expect(service.resolveRegisteredRootForRecovery('project_missing')).resolves.toBeNull();
    const moved = `${projectRoot}-moved`;
    await import('node:fs/promises').then(({ rename }) => rename(projectRoot, moved));
    await symlink(moved, projectRoot);
    await expect(service.resolveRegisteredRootForRecovery(projectKey)).resolves.toBeNull();
  });

  test('default library dialog errors map to location_unavailable', async () => {
    const { dialog, service } = await createContext();
    dialog.defaultLibraryError = new Error('dialog unavailable');

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

  test('all existing-project library workflows preserve the complete project tree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-loop-read-only-'));
    temporaryDirectories.push(root);
    const libraryRoot = path.join(root, 'library');
    await mkdir(libraryRoot);
    const gateway = new EngineProjectGateway();
    const projectRoot = await createReadOnlyProjectFixture(
      libraryRoot,
      gateway
    );
    const registry = new FileProjectRegistryStore(path.join(root, 'user-data'));
    await registry.save({
      schemaVersion: 1,
      defaultLibraryRoot: libraryRoot,
      projects: []
    });
    const dialog = new FakeProjectDialog();
    dialog.projectDirectoryResult = projectRoot;
    let randomTick = 0;
    const service = new ProjectLibraryService({
      registry,
      dialog,
      gateway,
      clock: () => new Date('2026-07-27T12:00:00.000Z'),
      randomBytes: (size) => Uint8Array.from(
        { length: size },
        () => randomTick++ % 256
      )
    });
    const before = await snapshotProjectTree(projectRoot);

    await expect(service.list()).resolves.toMatchObject({ projects: [] });
    const selectedOpen = await service.openExisting();
    expect(selectedOpen).toMatchObject({ outcome: 'opened' });
    if (selectedOpen.outcome !== 'opened') {
      throw new Error('Expected the fixture project to open.');
    }
    await expect(service.list()).resolves.toMatchObject({
      projects: [{ projectKey: selectedOpen.project.projectKey }]
    });
    await expect(gateway.inspect(projectRoot)).resolves.toMatchObject({
      valid: true,
      projectId: 'novel-20260727-120000-c0ffee'
    });
    await expect(service.open(selectedOpen.project.projectKey)).resolves
      .toMatchObject({ outcome: 'opened' });
    await expect(service.remove(selectedOpen.project.projectKey)).resolves
      .toMatchObject({ projects: [] });

    const after = await snapshotProjectTree(projectRoot);
    expect(before).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'file',
        path: path.join('planning', 'chapter_queue.json')
      }),
      expect.objectContaining({
        kind: 'file',
        path: path.join('chapters', 'chapter_001', 'draft_v1.md')
      }),
      expect.objectContaining({
        kind: 'file',
        path: path.join('runs', 'run_fixture', 'events.jsonl')
      }),
      expect.objectContaining({
        kind: 'file',
        path: path.join('snapshots', 'chapter_000', 'story_state.json')
      }),
      expect.objectContaining({
        kind: 'file',
        path: path.join('diffs', 'chapter_001.patch')
      })
    ]));
    expect(after).toEqual(before);
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

  test('list maps asynchronous result construction errors to registry_unavailable', async () => {
    const { gateway, libraryRoot, registry, service } = await createContext();
    const projectRoot = path.join(libraryRoot, 'novel-20260727-120000-a1b2c3');
    await mkdir(projectRoot);
    await registry.save({
      schemaVersion: 1,
      defaultLibraryRoot: libraryRoot,
      projects: [createRegistryProject(projectRoot)]
    });
    gateway.inspection = { ...validInspection, title: '' };

    await expect(service.list()).resolves.toEqual({
      projects: [],
      defaultLocation: { configured: false, locationLabel: null },
      warning: 'registry_unavailable'
    });
  });

  test('remove maps asynchronous result construction errors to registry_unavailable', async () => {
    const { gateway, libraryRoot, registry, service } = await createContext();
    const projectRoot = path.join(libraryRoot, 'novel-20260727-120000-a1b2c3');
    await mkdir(projectRoot);
    await registry.save({
      schemaVersion: 1,
      defaultLibraryRoot: libraryRoot,
      projects: [createRegistryProject(projectRoot)]
    });
    gateway.inspection = { ...validInspection, title: '' };

    await expect(service.remove('project_not_found')).resolves.toEqual({
      projects: [],
      defaultLocation: { configured: false, locationLabel: null },
      warning: 'registry_unavailable'
    });
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

  test('a physical adapter collision retries once through the real Engine gateway', async () => {
    const { gateway, libraryRoot, service } =
      await createPhysicalCollisionContext(1);

    const result = await service.create({
      title: '雾港来信',
      coreIdea: '一名夜班邮差收到来自未来的退信。',
      useDifferentLocation: false
    });

    expect(gateway.createInputs.map((input) => input.projectId)).toEqual([
      'novel-20260727-120000-000102',
      'novel-20260727-120000-030405'
    ]);
    expect(gateway.collisionInjections).toEqual([true, false]);
    expect(result).toMatchObject({
      outcome: 'created',
      project: { title: '雾港来信' }
    });
    expect(gateway.createInputs).toHaveLength(2);
    expect(gateway.createInputs[0]?.projectId)
      .not.toBe(gateway.createInputs[1]?.projectId);
    expect(JSON.stringify(result)).not.toContain(libraryRoot);
  });

  test('two physical adapter collisions return path-free project_exists', async () => {
    const { gateway, libraryRoot, service } =
      await createPhysicalCollisionContext(2);

    const result = await service.create({
      title: '雾港来信',
      coreIdea: '一名夜班邮差收到来自未来的退信。',
      useDifferentLocation: false
    });

    expect(result).toEqual({ outcome: 'project_exists' });
    expect(gateway.createInputs).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(libraryRoot);
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
