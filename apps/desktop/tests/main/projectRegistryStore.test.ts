import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  FileProjectRegistryStore,
  removeRegistryProject,
  upsertRegistryProject,
  type ProjectRegistry,
  type ProjectRegistryFileSystem
} from '../../src/main/projects/ProjectRegistryStore';
import {
  ProjectLibraryResultSchema,
  ProjectSummarySchema
} from '../../src/shared/projectContract';

const projectSummary = {
  projectKey: 'project_0123456789abcdef01234567',
  title: '雾港来信',
  latestCommittedChapter: 0,
  health: 'ready' as const,
  lastOpenedAt: '2026-07-27T04:00:00.000Z',
  briefExcerpt: '一名夜班邮差收到来自未来的退信。',
  locationLabel: '我的小说',
  storyBibleAvailable: false,
  globalPlanAvailable: false
};

const registryProject = {
  projectKey: projectSummary.projectKey,
  projectRoot: '/home/author/novels/fog-harbor',
  title: projectSummary.title,
  addedAt: '2026-07-27T03:00:00.000Z',
  lastOpenedAt: projectSummary.lastOpenedAt
};

const emptyRegistry: ProjectRegistry = {
  schemaVersion: 1,
  defaultLibraryRoot: null,
  projects: []
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

async function createStore(): Promise<FileProjectRegistryStore> {
  const directory = await mkdtemp(path.join(tmpdir(), 'novel-loop-registry-'));
  temporaryDirectories.push(directory);
  return new FileProjectRegistryStore(directory);
}

describe('project renderer contract', () => {
  test('accepts a public project summary', () => {
    expect(() => ProjectSummarySchema.parse(projectSummary)).not.toThrow();
  });

  test('rejects an absolute project path in a public project summary', () => {
    expect(() => ProjectSummarySchema.parse({
      ...projectSummary,
      projectRoot: '/home/author/novels/private'
    })).toThrow();
  });

  test('sorts service-facing projects by most recently opened', () => {
    const result = ProjectLibraryResultSchema.parse({
      projects: [
        { ...projectSummary, projectKey: 'project_older', lastOpenedAt: '2026-07-26T04:00:00.000Z' },
        projectSummary,
        { ...projectSummary, projectKey: 'project_newer', lastOpenedAt: '2026-07-28T04:00:00.000Z' }
      ],
      defaultLocation: {
        configured: false,
        locationLabel: null
      },
      warning: null
    });

    expect(result.projects.map((project) => project.projectKey)).toEqual([
      'project_newer',
      projectSummary.projectKey,
      'project_older'
    ]);
  });
});

describe('FileProjectRegistryStore', () => {
  test('returns an empty registry when the registry file is missing', async () => {
    const store = await createStore();

    await expect(store.load()).resolves.toEqual({
      registry: emptyRegistry,
      warning: null
    });
  });

  test('round trips a registry through an atomic save', async () => {
    const store = await createStore();
    const registry: ProjectRegistry = {
      schemaVersion: 1,
      defaultLibraryRoot: '/home/author/novels',
      projects: [registryProject]
    };

    await store.save(registry);

    await expect(store.load()).resolves.toEqual({ registry, warning: null });
    await expect(stat(store.registryPath)).resolves.toMatchObject({ mode: expect.any(Number) });
    expect((await stat(store.registryPath)).mode & 0o777).toBe(0o600);
  });

  test('returns a warning without replacing a corrupt registry file', async () => {
    const store = await createStore();
    const corruptContents = '{not valid json';
    await writeFile(store.registryPath, corruptContents, 'utf8');

    await expect(store.load()).resolves.toEqual({
      registry: emptyRegistry,
      warning: 'registry_unavailable'
    });
    await expect(readFile(store.registryPath, 'utf8')).resolves.toBe(corruptContents);
  });

  test('preserves the previous registry when replacing it fails', async () => {
    const store = await createStore();
    const originalRegistry: ProjectRegistry = {
      schemaVersion: 1,
      defaultLibraryRoot: null,
      projects: [registryProject]
    };
    await store.save(originalRegistry);
    const originalContents = await readFile(store.registryPath, 'utf8');

    const failingFileSystem: ProjectRegistryFileSystem = {
      mkdir,
      readFile,
      rename: async () => {
        throw new Error('rename failed');
      },
      unlink,
      writeFile
    };
    const failingStore = new FileProjectRegistryStore(
      path.dirname(store.registryPath),
      failingFileSystem
    );

    await expect(failingStore.save({
      ...originalRegistry,
      projects: [{ ...registryProject, title: '替换后标题' }]
    })).rejects.toThrow('rename failed');
    await expect(readFile(store.registryPath, 'utf8')).resolves.toBe(originalContents);
    await expect(readdir(path.dirname(store.registryPath))).resolves.toEqual([
      path.basename(store.registryPath)
    ]);
  });

  test('does not retain duplicate canonical paths after upsert', () => {
    const registry: ProjectRegistry = {
      schemaVersion: 1,
      defaultLibraryRoot: null,
      projects: [
        registryProject,
        {
          ...registryProject,
          projectKey: 'project_duplicate',
          projectRoot: '/home/author/novels/./fog-harbor'
        },
        {
          ...registryProject,
          projectKey: 'project_other',
          projectRoot: '/home/author/novels/other'
        }
      ]
    };

    const updated = upsertRegistryProject(registry, {
      ...registryProject,
      projectKey: 'project_reopened',
      projectRoot: '/home/author/novels/archive/../fog-harbor'
    });

    expect(updated.projects).toEqual([
      {
        ...registryProject,
        projectKey: 'project_other',
        projectRoot: '/home/author/novels/other'
      },
      {
        ...registryProject,
        projectKey: 'project_reopened'
      }
    ]);
  });

  test('evicts the least recently opened project when upserting into a full registry', async () => {
    const projects = Array.from({ length: 5_000 }, (_, index) => ({
      ...registryProject,
      projectKey: `project_${index.toString().padStart(4, '0')}`,
      projectRoot: `/home/author/novels/${index}`,
      lastOpenedAt: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString()
    }));
    const registry: ProjectRegistry = {
      schemaVersion: 1,
      defaultLibraryRoot: null,
      projects
    };
    const reopenedProject = {
      ...registryProject,
      projectKey: 'project_reopened',
      projectRoot: '/home/author/novels/reopened',
      lastOpenedAt: '2026-07-27T04:00:00.000Z'
    };

    const updated = upsertRegistryProject(registry, reopenedProject);

    expect(updated.projects).toHaveLength(5_000);
    expect(updated.projects).not.toContainEqual(projects[0]);
    expect(updated.projects).toContainEqual(reopenedProject);
    const store = await createStore();
    await expect(store.save(updated)).resolves.toBeUndefined();
  });

  test('removes only the requested registry entry', () => {
    const registry: ProjectRegistry = {
      schemaVersion: 1,
      defaultLibraryRoot: null,
      projects: [
        registryProject,
        {
          ...registryProject,
          projectKey: 'project_other',
          projectRoot: '/home/author/novels/other'
        }
      ]
    };

    expect(removeRegistryProject(registry, registryProject.projectKey).projects).toEqual([
      {
        ...registryProject,
        projectKey: 'project_other',
        projectRoot: '/home/author/novels/other'
      }
    ]);
  });
});
