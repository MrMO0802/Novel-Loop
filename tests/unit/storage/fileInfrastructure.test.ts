import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';

import { RunManifestSchema, StoryStateSchema } from '../../../src/schemas/index.js';
import { RunLogger } from '../../../src/logging/RunLogger.js';
import {
  AtomicWriteDurabilityUncertainError,
  AtomicWriter
} from '../../../src/storage/AtomicWriter.js';
import { FileStore } from '../../../src/storage/FileStore.js';
import { ProjectPathGuard } from '../../../src/storage/ProjectPathGuard.js';
import { ProjectPaths } from '../../../src/storage/ProjectPaths.js';
import { SnapshotStore } from '../../../src/storage/SnapshotStore.js';
import { validConfig, validStoryState } from '../../fixtures/schemas/valid.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m2-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('ProjectPaths', () => {
  test('generates project paths from a root and project id', () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');

    expect(paths.projectRoot).toBe(path.join(tempRoot, 'demo-novel'));
    expect(paths.config()).toBe(path.join(tempRoot, 'demo-novel', 'config.json'));
    expect(paths.storyState()).toBe(path.join(tempRoot, 'demo-novel', 'state', 'story_state.json'));
    expect(paths.chapterDir(1)).toBe(path.join(tempRoot, 'demo-novel', 'chapters', 'chapter_001'));
    expect(paths.chapterArtifact(12, 'scenes', 'scene_001_v1.md')).toBe(
      path.join(tempRoot, 'demo-novel', 'chapters', 'chapter_012', 'scenes', 'scene_001_v1.md')
    );
    expect(paths.runManifest('run_001')).toBe(path.join(tempRoot, 'demo-novel', 'runs', 'run_001', 'run_manifest.json'));
    expect(paths.snapshot('snapshot_001')).toBe(path.join(tempRoot, 'demo-novel', 'snapshots', 'snapshot_001.json'));
  });
});

describe('AtomicWriter', () => {
  test('writes through a temp file and leaves no temp file behind', async () => {
    const writer = new AtomicWriter();
    const target = path.join(tempRoot, 'nested', 'artifact.txt');

    await writer.writeText(target, 'final content');

    expect(await readFile(target, 'utf8')).toBe('final content');
    const nestedDir = path.dirname(target);
    const leftovers = await new FileStore().list(nestedDir);
    expect(leftovers).toEqual(['artifact.txt']);
  });

  test('keeps the existing file when rename fails', async () => {
    const target = path.join(tempRoot, 'artifact.txt');
    await new AtomicWriter().writeText(target, 'old content');
    const writer = new AtomicWriter({
      rename: async () => {
        throw new Error('rename failed');
      }
    });

    await expect(writer.writeText(target, 'new content')).rejects.toThrow('rename failed');

    expect(await readFile(target, 'utf8')).toBe('old content');
  });

  test.skipIf(process.platform !== 'linux')(
    'does not follow a project directory replaced after its final guard check',
    async () => {
      const projectRoot = path.join(tempRoot, 'project');
      const targetDir = path.join(projectRoot, 'artifacts');
      const target = path.join(targetDir, 'result.txt');
      const externalDir = path.join(tempRoot, 'external');
      await mkdir(targetDir, { recursive: true });
      await mkdir(externalDir, { recursive: true });
      await writeFile(path.join(externalDir, 'sentinel.txt'), 'unchanged', 'utf8');
      const guard = new ProjectPathGuard(projectRoot);
      let replaced = false;
      let escapedWrite = false;
      const writer = new AtomicWriter({
        writeFile: async (filePath, data, options) => {
          if (await realpath(path.dirname(filePath)) === await realpath(externalDir)) {
            escapedWrite = true;
          }
          await writeFile(filePath, data, options);
        }
      }, async (filePath) => {
        await guard.assertSafePath(filePath);
        if (!replaced && filePath.endsWith('.tmp')) {
          await rm(targetDir, { recursive: true, force: true });
          await symlink(externalDir, targetDir, 'dir');
          replaced = true;
        }
      }, projectRoot);

      await expect(writer.writeText(target, 'must stay in project')).rejects.toThrow();

      expect(replaced).toBe(true);
      expect(escapedWrite).toBe(false);
      expect(await readFile(path.join(externalDir, 'sentinel.txt'), 'utf8')).toBe('unchanged');
      await expect(readFile(path.join(externalDir, 'result.txt'), 'utf8')).rejects.toThrow();
    }
  );

  test.skipIf(process.platform !== 'linux')(
    'does not create missing directories through an ancestor replaced after its directory guard',
    async () => {
      const projectRoot = path.join(tempRoot, 'project');
      const ancestorDir = path.join(projectRoot, 'artifacts');
      const targetDir = path.join(ancestorDir, 'nested');
      const target = path.join(targetDir, 'result.txt');
      const externalDir = path.join(tempRoot, 'external');
      await mkdir(ancestorDir, { recursive: true });
      await mkdir(externalDir, { recursive: true });
      const guard = new ProjectPathGuard(projectRoot);
      let replaced = false;
      const writer = new AtomicWriter({}, async (filePath) => {
        await guard.assertSafePath(filePath);
        if (!replaced && filePath === targetDir) {
          await rm(ancestorDir, { recursive: true, force: true });
          await symlink(externalDir, ancestorDir, 'dir');
          replaced = true;
        }
      }, projectRoot);

      await expect(writer.writeText(target, 'must stay in project')).rejects.toThrow();

      expect(replaced).toBe(true);
      await expect(realpath(path.join(externalDir, 'nested'))).rejects.toThrow();
    }
  );

  test.skipIf(process.platform !== 'linux')(
    'classifies a directory-sync failure after rename as durability uncertain',
    async () => {
      const projectRoot = path.join(tempRoot, 'project');
      const target = path.join(projectRoot, 'artifacts', 'result.txt');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'before', 'utf8');
      const writer = new AtomicWriter({
        syncDirectory: async () => {
          throw new Error('forced directory sync failure');
        }
      }, undefined, projectRoot);

      await expect(writer.writeText(target, 'after')).rejects.toBeInstanceOf(
        AtomicWriteDurabilityUncertainError
      );
      expect(await readFile(target, 'utf8')).toBe('after');
    }
  );
});

describe('FileStore', () => {
  test('reads and writes text, checks existence, and lists directory entries', async () => {
    const store = new FileStore();
    const filePath = path.join(tempRoot, 'notes', 'one.txt');

    expect(await store.exists(filePath)).toBe(false);
    await store.writeText(filePath, 'hello');

    expect(await store.exists(filePath)).toBe(true);
    expect(await store.readText(filePath)).toBe('hello');
    expect(await store.list(path.dirname(filePath))).toEqual(['one.txt']);
  });

  test('validates JSON before writing and after reading', async () => {
    const store = new FileStore();
    const filePath = path.join(tempRoot, 'config.json');
    const ConfigFixtureSchema = z.object({
      projectId: z.string(),
      qualityThreshold: z.number().min(0).max(10)
    });

    await store.writeJson(filePath, { projectId: 'demo-novel', qualityThreshold: 8.2 }, ConfigFixtureSchema);

    expect(await store.readJson(filePath, ConfigFixtureSchema)).toEqual({
      projectId: 'demo-novel',
      qualityThreshold: 8.2
    });
    await expect(store.writeJson(filePath, { projectId: 'demo-novel', qualityThreshold: 12 }, ConfigFixtureSchema)).rejects.toThrow();
    expect(await store.readText(filePath)).toContain('"qualityThreshold": 8.2');
  });
});

describe('SnapshotStore', () => {
  test('creates, lists, and reads story state snapshots', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const snapshotStore = new SnapshotStore(paths, new FileStore(), {
      now: () => new Date('2026-07-02T02:25:30.000Z'),
      randomSuffix: () => 'abc123'
    });

    const created = await snapshotStore.createSnapshot(validStoryState, {
      reason: 'chapter commit',
      sourceChapter: 1,
      runId: 'run_001',
      configHash: 'sha256:test'
    });

    expect(created.snapshotId).toBe('snapshot_20260702_022530_abc123');
    expect(created.path).toBe(paths.snapshot(created.snapshotId));
    expect(await snapshotStore.listSnapshots()).toEqual([created]);
    const snapshot = await snapshotStore.readSnapshot(created.snapshotId);
    expect(StoryStateSchema.parse(snapshot.storyState).projectId).toBe('demo-novel');
    expect(snapshot.meta.reason).toBe('chapter commit');
  });
});

describe('RunLogger', () => {
  test('creates and updates a run manifest', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const logger = new RunLogger(paths, new FileStore(), {
      now: () => new Date('2026-07-02T02:25:30.000Z')
    });

    const manifest = await logger.startRun({
      runId: 'run_001',
      command: 'chapter',
      args: { chapterNumber: 1, provider: 'mock' }
    });
    await logger.recordArtifact(manifest.runId, 'chapters/chapter_001/mission.json');
    await logger.recordError(manifest.runId, {
      code: 'LLM_INVALID_JSON',
      message: 'Provider returned invalid JSON',
      recoverable: true
    });
    const completed = await logger.endRun(manifest.runId, 'failed');

    expect(completed.startedAt).toBe('2026-07-02T02:25:30.000Z');
    expect(completed.endedAt).toBe('2026-07-02T02:25:30.000Z');
    expect(completed.artifacts.map((artifact) => artifact.path)).toEqual(['chapters/chapter_001/mission.json']);
    expect(completed.errors[0]?.code).toBe('LLM_INVALID_JSON');
    expect(RunManifestSchema.parse(completed).status).toBe('failed');
  });

  test('preserves a cancelled terminal status', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const logger = new RunLogger(paths, new FileStore(), {
      now: () => new Date('2026-07-02T02:25:30.000Z')
    });

    const manifest = await logger.startRun({
      runId: 'run_cancelled',
      command: 'build-bible'
    });
    const cancelled = await logger.endRun(manifest.runId, 'cancelled');

    expect(RunManifestSchema.parse(cancelled).status).toBe('cancelled');
  });
});
