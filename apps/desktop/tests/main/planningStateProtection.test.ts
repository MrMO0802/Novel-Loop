import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../../../src/app/buildBible.js';
import { initProjectFromBriefText } from '../../../../src/app/initProject.js';
import { ProjectPaths } from '../../../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../../../../tests/helpers/fakeCodex.js';
import { EnginePlanningGateway } from '../../src/main/planning/EnginePlanningGateway';

const projectId = 'planning-state-protection';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('global planning Story State protection', () => {
  test('preserves Story State bytes after a successful real desktop planning gateway run', async () => {
    const context = await createPlanningProject('valid');
    const before = await sha256(context.paths.storyState());

    try {
      await expect(context.gateway.build({
        projectRoot: context.paths.projectRoot,
        resumeIncomplete: true,
        onProgress: () => undefined,
        shouldStop: () => false
      })).resolves.toBeUndefined();

      expect(await sha256(context.paths.storyState())).toBe(before);
      await expect(context.gateway.read(context.paths.projectRoot)).resolves.toMatchObject({
        available: true
      });
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('preserves Story State bytes after a failed real desktop planning gateway run', async () => {
    const context = await createPlanningProject('invalid-json');
    const before = await sha256(context.paths.storyState());

    try {
      await expect(context.gateway.build({
        projectRoot: context.paths.projectRoot,
        resumeIncomplete: true,
        onProgress: () => undefined,
        shouldStop: () => false
      })).rejects.toBeDefined();

      expect(await sha256(context.paths.storyState())).toBe(before);
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);
});

async function createPlanningProject(mode: 'valid' | 'invalid-json'): Promise<{
  gateway: EnginePlanningGateway;
  paths: ProjectPaths;
  restoreCodexBin(): void;
}> {
  const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-planning-state-'));
  temporaryDirectories.push(projectsRoot);
  const paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Global Planning\n\nPlanning must never mutate canonical Story State.\n'
  });
  await buildBible({ projectId, projectsRoot, provider: 'mock', runId: `planning_state_${mode}_bible` });

  const fake = await writeFakeCodex(projectsRoot, mode);
  const previousCodexBin = process.env.NLE_CODEX_BIN;
  process.env.NLE_CODEX_BIN = fake.codexBin;

  return {
    gateway: new EnginePlanningGateway(),
    paths,
    restoreCodexBin: () => {
      if (previousCodexBin === undefined) delete process.env.NLE_CODEX_BIN;
      else process.env.NLE_CODEX_BIN = previousCodexBin;
    }
  };
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}
