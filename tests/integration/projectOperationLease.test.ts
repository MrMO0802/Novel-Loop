import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { commitChapterState } from '../../src/app/chapterCommit.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import {
  acquireProjectOperationLease,
  PROJECT_OPERATION_LOCK_NAME
} from '../../src/app/projectOperationLease.js';
import {
  ChapterQueueSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

const promptRoot = path.resolve('prompts');
const projectId = 'project-operation-lease';
const store = new FileStore();
let projectsRoot: string;
let paths: ProjectPaths;
let child: ChildProcess | undefined;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-operation-lease-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Operation Lease\n\nA powerless radio opens a local mystery.\n'
  });
  await buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    runId: 'operation_lease_bible'
  });
  await planGlobal({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    runId: 'operation_lease_plan'
  });
});

afterEach(async () => {
  child?.kill('SIGTERM');
  child = undefined;
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('project operation lease', () => {
  test('blocks a chapter workflow while an independent process owns the shared project lease and recovers after release', async () => {
    child = spawn(process.execPath, [
      '-e',
      `
        const fs = require('node:fs');
        const path = require('node:path');
        const lockPath = path.join(process.argv[1], '.novel-loop-build-bible.lock');
        fs.mkdirSync(lockPath);
        fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ token: 'child', pid: process.pid }) + '\\n');
        process.stdout.write('ready\\n');
        process.on('SIGTERM', () => {
          fs.rmSync(lockPath, { recursive: true, force: true });
          process.exit(0);
        });
        process.on('message', (message) => {
          if (message !== 'release') return;
          fs.rmSync(lockPath, { recursive: true, force: true });
          process.exit(0);
        });
        setInterval(() => fs.utimesSync(lockPath, new Date(), new Date()), 50);
      `,
      paths.projectRoot
    ], {
      stdio: ['ignore', 'pipe', 'inherit', 'ipc']
    });
    await waitForChildReady(child);

    await expect(runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      runId: 'operation_lease_blocked'
    })).rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
    await expect(store.exists(paths.chapterArtifact(1, 'mission.json'))).resolves.toBe(false);

    if (process.platform === 'win32') child.send('release');
    else child.kill('SIGTERM');
    await waitForExit(child);
    child = undefined;

    await expect(runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      runId: 'operation_lease_recovered'
    })).resolves.toMatchObject({ status: 'dry_run_complete' });
  }, 30_000);

  test('serializes a paused chapter provider against commit and only one provider call runs', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'pause-on-mission');
    await store.writeText(
      paths.chapterArtifact(1, 'final.md'),
      '# Chapter 1\n\nThe powerless radio names the old building.\n'
    );
    const stateBefore = await hashFile(paths.storyState());
    const queueBefore = await hashFile(paths.chapterQueue());
    const planning = runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'operation_lease_paused_planning'
    });
    await waitForFile(fake.pausePath);

    await expect(commitChapterState({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      runId: 'operation_lease_losing_commit'
    })).rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
    expect(await hashFile(paths.storyState())).toBe(stateBefore);
    expect(await hashFile(paths.chapterQueue())).not.toBe(queueBefore);
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
    expect(await promptCallCount(fake.statePath, 'planning.plan_chapter_mission_slim')).toBe(1);

    await writeFile(fake.releasePath, 'release\n', 'utf8');
    await expect(planning).resolves.toMatchObject({ status: 'dry_run_complete' });
  }, 30_000);

  test('rejects a paused loser after external state and queue drift without overwriting canonical data', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'pause-on-mission');
    const planning = runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'operation_lease_stale_planning'
    });
    await waitForFile(fake.pausePath);

    const driftedState = {
      ...(await store.readJson(paths.storyState(), StoryStateSchema)),
      latestCommittedChapter: 1,
      updatedAt: '2026-07-30T08:00:00.000Z'
    };
    await store.writeJson(paths.storyState(), driftedState, StoryStateSchema);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    await store.writeJson(paths.chapterQueue(), {
      ...queue,
      chapters: queue.chapters.map((chapter) => (
        chapter.chapterNumber === 1
          ? {
              ...chapter,
              status: 'committed' as const,
              currentStage: 'commit' as const,
              completedStages: [...new Set([...chapter.completedStages, 'commit' as const])],
              committedAt: '2026-07-30T08:00:00.000Z',
              updatedAt: '2026-07-30T08:00:00.000Z'
            }
          : chapter
      ))
    }, ChapterQueueSchema);
    const externalState = await store.readText(paths.storyState());
    const externalQueue = await store.readText(paths.chapterQueue());

    await writeFile(fake.releasePath, 'release\n', 'utf8');
    await expect(planning).rejects.toMatchObject({
      code: 'PROJECT_OPERATION_STALE'
    });

    expect(await store.readText(paths.storyState())).toBe(externalState);
    expect(await store.readText(paths.chapterQueue())).toBe(externalQueue);
    await expect(store.exists(paths.chapterArtifact(1, 'mission.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'ranking.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'selected_plan.md'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
  }, 30_000);

  test.skipIf(process.platform !== 'linux')(
    'publishes a complete owner identity and rejects PID reuse as a live owner',
    async () => {
      const first = await acquireProjectOperationLease(paths.projectRoot);
      const lockPath = path.join(paths.projectRoot, PROJECT_OPERATION_LOCK_NAME);
      const owner = JSON.parse(await readFile(lockPath, 'utf8')) as {
        processStartIdentity?: unknown;
        bootId?: unknown;
      };
      expect(owner.processStartIdentity).toMatch(/^linux-proc-start:\d+$/u);
      expect(owner.bootId).toMatch(/^[0-9a-f-]{36}$/u);
      await first.release();

      await writeFile(lockPath, `${JSON.stringify({
        token: '11111111-1111-4111-8111-111111111111',
        pid: process.pid,
        processStartIdentity: 'linux-proc-start:0',
        bootId: owner.bootId,
        acquiredAt: new Date().toISOString()
      })}\n`, 'utf8');

      const replacement = await acquireProjectOperationLease(paths.projectRoot);
      await expect(acquireProjectOperationLease(paths.projectRoot))
        .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
      await replacement.release();
    }
  );

  test('repairs an ownerless canonical lock left by a pre-owner crash', async () => {
    const lockPath = path.join(paths.projectRoot, PROJECT_OPERATION_LOCK_NAME);
    await mkdir(lockPath);
    const abandonedAt = new Date(Date.now() - 30_000);
    await utimes(lockPath, abandonedAt, abandonedAt);

    const lease = await acquireProjectOperationLease(paths.projectRoot);
    await expect(acquireProjectOperationLease(paths.projectRoot))
      .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
    await lease.release();
  });
});

async function waitForChildReady(process: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout?.once('data', (chunk) => {
      if (String(chunk).includes('ready')) resolve();
    });
    process.once('error', reject);
    process.once('exit', (code) => reject(new Error(`Lease child exited before ready: ${code}`)));
  });
}

async function waitForExit(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  await new Promise<void>((resolve) => process.once('exit', () => resolve()));
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await store.exists(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}.`);
}

async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function promptCallCount(statePath: string, promptId: string): Promise<number> {
  const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, number>;
  return state[`${promptId}:json:normal`] ?? 0;
}
