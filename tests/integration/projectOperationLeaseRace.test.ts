import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const takeoverRace = vi.hoisted(() => {
  let enterFirst!: () => void;
  let releaseFirst!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    enterFirst = resolve;
  });
  const firstReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  return {
    enabled: false,
    firstEntered,
    enterFirst,
    firstReleased,
    releaseFirst,
    lockPath: '',
    matchingCalls: 0
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
          takeoverRace.enterFirst();
          await takeoverRace.firstReleased;
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
  takeoverRace.enabled = false;
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

    const firstPromise = settleLease(acquireProjectOperationLease(root));
    await takeoverRace.firstEntered;
    const claim = JSON.parse(await readFile(`${lockPath}.transition-claim`, 'utf8')) as {
      claimant?: { pid?: unknown };
    };
    expect(claim.claimant?.pid).toBe(process.pid);

    const second = await withTimeout(
      settleLease(acquireProjectOperationLease(root)),
      2_000
    );
    expect(second.outcome).toBe('rejected');

    takeoverRace.releaseFirst();
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
});

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
