import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { initProjectFromBriefText } from '../../../../src/app/initProject.js';
import { RunManifestSchema } from '../../../../src/schemas/index.js';
import { FileStore } from '../../../../src/storage/FileStore.js';
import { ProjectPaths } from '../../../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../../../../tests/helpers/fakeCodex.js';
import { EngineFoundationGateway } from '../../src/main/foundation/EngineFoundationGateway';
import {
  ProjectFoundationService,
  type ProjectRootResolver
} from '../../src/main/foundation/ProjectFoundationService';

const projectId = 'foundation-state-protection';
const projectKey = 'project_0123456789abcdef01234567';
const fileStore = new FileStore();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('Story Foundation state protection', () => {
  test('preserves canonical files through the real desktop service and gateway', async () => {
    const { paths, restoreCodexBin, service } = await createDesktopFoundation();

    try {
      const before = {
        storyState: await sha256(paths.storyState()),
        chapterQueue: await sha256(paths.chapterQueue())
      };
      const task = await service.start(projectKey);
      await eventually(async () => {
        await expect(service.get(task.taskId)).resolves.toMatchObject({ status: 'succeeded' });
      });

      expect(await sha256(paths.storyState())).toBe(before.storyState);
      expect(await sha256(paths.chapterQueue())).toBe(before.chapterQueue);
      expect(await fileStore.exists(paths.chapterDir(1))).toBe(false);
      expect(await fileStore.exists(path.join(paths.strategyDir(), 'story_bible.md')))
        .toBe(true);
      expect(await fileStore.list(paths.snapshotsDir())).toEqual([]);
      expect(await fileStore.list(paths.diffsDir())).toEqual([]);
      expect(await fileStore.exists(paths.chapterArtifact(1, 'canon_patch.json'))).toBe(false);
      expect(await fileStore.exists(paths.chapterArtifact(1, 'commit_report.json'))).toBe(false);
    } finally {
      restoreCodexBin();
    }
  }, 30_000);

  test('keeps distinct retry provenance and cannot overwrite a completed foundation', async () => {
    const { gateway, paths, restoreCodexBin, service } = await createDesktopFoundation();

    try {
      const cancelled = await service.start(projectKey);
      await service.cancel(cancelled.taskId);
      await eventually(async () => {
        await expect(service.get(cancelled.taskId)).resolves.toMatchObject({ status: 'cancelled' });
      });

      const retry = await service.start(projectKey);
      await eventually(async () => {
        await expect(service.get(retry.taskId)).resolves.toMatchObject({ status: 'succeeded' });
      });

      const runIds = await fileStore.list(paths.runsDir());
      const manifests = await Promise.all(runIds.map(async (runId) => ({
        runId,
        manifest: await fileStore.readJson(paths.runManifest(runId), RunManifestSchema)
      })));
      const foundationRuns = manifests.filter(({ manifest }) => manifest.command === 'build-bible');
      const strategyPaths = [
        'story_bible.md',
        'genre_contract.md',
        'reader_promise.md',
        'style_guide.md'
      ].map((fileName) => path.join(paths.strategyDir(), fileName));
      const completeHashes = await Promise.all(strategyPaths.map(sha256));

      expect(foundationRuns).toHaveLength(2);
      expect(new Set(foundationRuns.map(({ runId }) => runId)).size).toBe(2);
      expect(foundationRuns.map(({ manifest }) => manifest.status).sort()).toEqual(['cancelled', 'success']);
      await expect(gateway.build({
        projectRoot: paths.projectRoot,
        resumeIncomplete: true,
        onProgress: () => undefined,
        shouldStop: () => false
      })).rejects.toMatchObject({ code: 'ARTIFACT_ALREADY_EXISTS' });
      await expect(Promise.all(strategyPaths.map(sha256))).resolves.toEqual(completeHashes);
    } finally {
      restoreCodexBin();
    }
  }, 30_000);
});

async function createDesktopFoundation(): Promise<{
  gateway: EngineFoundationGateway;
  paths: ProjectPaths;
  restoreCodexBin(): void;
  service: ProjectFoundationService;
}> {
  const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-foundation-protection-'));
  temporaryDirectories.push(projectsRoot);
  const paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Story Foundation\n\nA foundation must not alter canonical state.\n'
  });
  await fileStore.writeText(paths.chapterQueue(), '{"protected":true}\n');
  const fake = await writeFakeCodex(projectsRoot);
  const originalCodexBin = process.env.NLE_CODEX_BIN;
  process.env.NLE_CODEX_BIN = fake.codexBin;
  const gateway = new EngineFoundationGateway();
  const service = new ProjectFoundationService({
    gateway,
    projects: new StaticProjectRootResolver(paths.projectRoot)
  });

  return {
    gateway,
    paths,
    service,
    restoreCodexBin: () => {
      if (originalCodexBin === undefined) {
        delete process.env.NLE_CODEX_BIN;
      } else {
        process.env.NLE_CODEX_BIN = originalCodexBin;
      }
    }
  };
}

class StaticProjectRootResolver implements ProjectRootResolver {
  constructor(private readonly projectRoot: string) {}

  async resolveProjectRoot(key: string): Promise<string | null> {
    return key === projectKey ? this.projectRoot : null;
  }
}

async function eventually(assertion: () => Promise<void> | void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}
