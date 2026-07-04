import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { initProject } from '../../src/app/initProject.js';
import { validateProject } from '../../src/app/validateProject.js';
import { ConfigSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;
let briefPath: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m3-'));
  briefPath = path.join(tempRoot, 'brief.md');
  await writeFile(briefPath, '# Demo Brief\n\nA controlled test brief.\n', 'utf8');
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('initProject and validateProject', () => {
  test('initializes a project with required directories and valid core JSON', async () => {
    const result = await initProject({
      projectId: 'demo-novel',
      briefPath,
      projectsRoot: tempRoot
    });
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();

    expect(result.projectId).toBe('demo-novel');
    expect(result.projectRoot).toBe(paths.projectRoot);
    expect(result.created).toContain(paths.config());
    expect(result.created).toContain(paths.storyState());
    await expect(store.readText(paths.brief())).resolves.toContain('A controlled test brief.');
    await expect(store.readJson(paths.config(), ConfigSchema)).resolves.toMatchObject({
      projectId: 'demo-novel',
      defaultProvider: 'mock'
    });
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({
      schemaVersion: '1.0',
      projectId: 'demo-novel',
      latestCommittedChapter: 0
    });
    for (const dir of ['strategy', 'planning', 'chapters', 'runs', 'snapshots']) {
      await expect(store.exists(path.join(paths.projectRoot, dir))).resolves.toBe(true);
    }
  });

  test('validates an initialized project', async () => {
    await initProject({
      projectId: 'demo-novel',
      briefPath,
      projectsRoot: tempRoot
    });

    const validation = await validateProject({
      projectId: 'demo-novel',
      projectsRoot: tempRoot
    });

    expect(validation.ok).toBe(true);
    expect(validation.checks.map((check) => check.name)).toEqual([
      'project directory',
      'brief.md',
      'config.json',
      'state/story_state.json',
      'strategy directory',
      'planning directory',
      'chapters directory',
      'runs directory',
      'snapshots directory',
      'diffs directory'
    ]);
    expect(validation.checks.every((check) => check.ok)).toBe(true);
  });

  test('reports invalid core JSON during validation', async () => {
    await initProject({
      projectId: 'demo-novel',
      briefPath,
      projectsRoot: tempRoot
    });
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    await new FileStore().writeText(paths.config(), '{"projectId":"demo-novel","qualityThreshold":12}\n');

    const validation = await validateProject({
      projectId: 'demo-novel',
      projectsRoot: tempRoot
    });

    expect(validation.ok).toBe(false);
    expect(validation.checks.find((check) => check.name === 'config.json')).toMatchObject({
      ok: false
    });
  });
});
