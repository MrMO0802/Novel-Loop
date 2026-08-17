import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const takeoverRace = vi.hoisted(() => {
  return {
    enabled: false,
    lockPath: '',
    matchingCalls: 0,
    firstEntered: null as Promise<void> | null,
    enterFirst: null as (() => void) | null,
    firstReleased: null as Promise<void> | null,
    releaseFirst: null as (() => void) | null,
    pauseAfterFirstMove: false,
    firstMoved: null as Promise<void> | null,
    enterFirstMoved: null as (() => void) | null,
    firstMoveReleased: null as Promise<void> | null,
    releaseFirstMove: null as (() => void) | null
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    rename: async (...args: Parameters<typeof original.rename>) => {
      const [oldPath, newPath] = args;
      if (
        takeoverRace.enabled
        && typeof oldPath === 'string'
        && typeof newPath === 'string'
        && path.resolve(oldPath) === takeoverRace.lockPath
        && newPath.includes('.stale-')
      ) {
        takeoverRace.matchingCalls += 1;
        if (takeoverRace.matchingCalls === 1) {
          takeoverRace.enterFirst?.();
          if (takeoverRace.firstReleased !== null) {
            await takeoverRace.firstReleased;
          }
          await original.rename(...args);
          if (takeoverRace.pauseAfterFirstMove) {
            takeoverRace.enterFirstMoved?.();
            if (takeoverRace.firstMoveReleased !== null) {
              await takeoverRace.firstMoveReleased;
            }
          }
          return;
        }
      }
      return original.rename(...args);
    }
  };
});

import {
  acquireProjectOperationLease,
  PROJECT_OPERATION_LOCK_NAME,
  type ProjectOperationLease
} from '../../src/app/projectOperationLease.js';

let root: string | undefined;

afterEach(async () => {
  takeoverRace.releaseFirst?.();
  takeoverRace.releaseFirstMove?.();
  takeoverRace.enabled = false;
  takeoverRace.lockPath = '';
  takeoverRace.matchingCalls = 0;
  takeoverRace.firstEntered = null;
  takeoverRace.enterFirst = null;
  takeoverRace.firstReleased = null;
  takeoverRace.releaseFirst = null;
  takeoverRace.pauseAfterFirstMove = false;
  takeoverRace.firstMoved = null;
  takeoverRace.enterFirstMoved = null;
  takeoverRace.firstMoveReleased = null;
  takeoverRace.releaseFirstMove = null;
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('project operation lease stale takeover', () => {
  test('a delayed live reclaimer keeps a second owner from stealing its claim', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-race-'));
    const lockPath = path.join(root, PROJECT_OPERATION_LOCK_NAME);
    await writeFile(lockPath, '{"invalid":"dead-owner"}\n', { mode: 0o600 });
    const old = new Date('2020-01-01T00:00:00.000Z');
    await utimes(lockPath, old, old);
    takeoverRace.lockPath = path.resolve(lockPath);
    takeoverRace.enabled = true;
    const race = armTakeoverRace();

    const firstPromise = settleLease(acquireProjectOperationLease(root));
    await race.firstEntered;
    const claim = JSON.parse(await readFile(`${lockPath}.transition-claim`, 'utf8')) as {
      claimant?: { pid?: unknown };
    };
    expect(claim.claimant?.pid).toBe(process.pid);

    const second = await withTimeout(
      settleLease(acquireProjectOperationLease(root)),
      2_000
    );
    expect(second.outcome).toBe('rejected');

    race.releaseFirst();
    const first = await withTimeout(firstPromise, 2_000);
    expect(first.outcome).toBe('acquired');
    if (first.outcome !== 'acquired') throw first.error;
    const currentOwner = JSON.parse(await readFile(lockPath, 'utf8')) as {
      token?: unknown;
      pid?: unknown;
    };
    expect(typeof currentOwner.token).toBe('string');
    expect(currentOwner.pid).toBe(process.pid);
    await expect(acquireProjectOperationLease(root))
      .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
    await first.lease.release();
  });

  test.skipIf(process.platform !== 'linux')(
    'an aged but live paused claimant cannot be stolen by two successor participants',
    async () => {
      root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-three-party-'));
      const lockPath = path.join(root, PROJECT_OPERATION_LOCK_NAME);
      const statePath = path.join(root, 'state', 'story_state.json');
      const queuePath = path.join(root, 'planning', 'chapter_queue.json');
      const writePath = path.join(root, 'participant-writes.txt');
      const stateBytes = Buffer.from('{"protected":"story-state"}\n', 'utf8');
      const queueBytes = Buffer.from('{"protected":"chapter-queue"}\n', 'utf8');
      await Promise.all([
        mkdir(path.dirname(statePath), { recursive: true }),
        mkdir(path.dirname(queuePath), { recursive: true })
      ]);
      await Promise.all([
        writeFile(statePath, stateBytes),
        writeFile(queuePath, queueBytes),
        writeFile(lockPath, '{"invalid":"dead-owner"}\n', { mode: 0o600 })
      ]);
      const old = new Date('2020-01-01T00:00:00.000Z');
      await utimes(lockPath, old, old);
      takeoverRace.lockPath = path.resolve(lockPath);
      takeoverRace.enabled = true;
      const race = armTakeoverRace();
      const acquired: Array<{ label: string; lease: ProjectOperationLease }> = [];
      let activeHolders = 0;
      let maxActiveHolders = 0;

      const register = async (label: string, result: SettledLease): Promise<void> => {
        if (result.outcome !== 'acquired') return;
        acquired.push({ label, lease: result.lease });
        activeHolders += 1;
        maxActiveHolders = Math.max(maxActiveHolders, activeHolders);
        await writeFile(writePath, `${label}\n`, { flag: 'a' });
      };

      try {
        const firstPromise = settleLease(acquireProjectOperationLease(root));
        await race.firstEntered;
        const claimPath = `${lockPath}.transition-claim`;
        await utimes(claimPath, old, old);

        const second = await withTimeout(
          settleLease(acquireProjectOperationLease(root)),
          2_000
        );
        await register('second', second);

        takeoverRace.pauseAfterFirstMove = second.outcome === 'acquired';
        race.releaseFirst();

        let first: SettledLease;
        let third: SettledLease;
        if (second.outcome === 'acquired') {
          await race.firstMoved;
          third = await withTimeout(
            settleLease(acquireProjectOperationLease(root)),
            2_000
          );
          await register('third', third);
          race.releaseFirstMove();
          first = await withTimeout(firstPromise, 2_000);
        } else {
          first = await withTimeout(firstPromise, 2_000);
          await register('first', first);
          third = await withTimeout(
            settleLease(acquireProjectOperationLease(root)),
            2_000
          );
          await register('third', third);
        }

        expect(first.outcome).toBe('acquired');
        expect(second.outcome).toBe('rejected');
        expect(third.outcome).toBe('rejected');
        expect(maxActiveHolders).toBe(1);
        expect(acquired.map(({ label }) => label)).toEqual(['first']);
        expect(await readFile(writePath, 'utf8')).toBe('first\n');
        expect(await readFile(statePath)).toEqual(stateBytes);
        expect(await readFile(queuePath)).toEqual(queueBytes);
      } finally {
        race.releaseFirst();
        race.releaseFirstMove();
        for (const { lease } of acquired.reverse()) {
          await lease.release().catch(() => undefined);
          activeHolders -= 1;
        }
      }
    }
  );
});

function armTakeoverRace(): {
  firstEntered: Promise<void>;
  releaseFirst(): void;
  firstMoved: Promise<void>;
  releaseFirstMove(): void;
} {
  let enterFirst!: () => void;
  let releaseFirst!: () => void;
  let enterFirstMoved!: () => void;
  let releaseFirstMove!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    enterFirst = resolve;
  });
  const firstReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstMoved = new Promise<void>((resolve) => {
    enterFirstMoved = resolve;
  });
  const firstMoveReleased = new Promise<void>((resolve) => {
    releaseFirstMove = resolve;
  });
  takeoverRace.firstEntered = firstEntered;
  takeoverRace.enterFirst = enterFirst;
  takeoverRace.firstReleased = firstReleased;
  takeoverRace.releaseFirst = releaseFirst;
  takeoverRace.firstMoved = firstMoved;
  takeoverRace.enterFirstMoved = enterFirstMoved;
  takeoverRace.firstMoveReleased = firstMoveReleased;
  takeoverRace.releaseFirstMove = releaseFirstMove;
  return { firstEntered, releaseFirst, firstMoved, releaseFirstMove };
}

type SettledLease =
  | { outcome: 'acquired'; lease: ProjectOperationLease }
  | { outcome: 'rejected'; error: unknown };

async function settleLease(promise: Promise<ProjectOperationLease>): Promise<SettledLease> {
  try {
    return { outcome: 'acquired', lease: await promise };
  } catch (error) {
    return { outcome: 'rejected', error };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for lease interleaving.')), timeoutMs);
    })
  ]);
}
