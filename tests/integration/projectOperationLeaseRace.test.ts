import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    claimPath: '',
    matchingCalls: 0
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    writeFile: async (...args: Parameters<typeof original.writeFile>) => {
      const [filePath] = args;
      if (
        takeoverRace.enabled
        && typeof filePath === 'string'
        && path.resolve(filePath) === takeoverRace.claimPath
      ) {
        takeoverRace.matchingCalls += 1;
        if (takeoverRace.matchingCalls === 1) {
          takeoverRace.enterFirst();
          await takeoverRace.firstReleased;
        }
      }
      return original.writeFile(...args);
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
  test('two reclaimers cannot remove a replacement live lock', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-race-'));
    const lockPath = path.join(root, PROJECT_OPERATION_LOCK_NAME);
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, 'owner.json'), `${JSON.stringify({
      token: '22222222-2222-4222-8222-222222222222',
      pid: 999_999_999,
      processStartIdentity: 'linux-proc-start:1',
      acquiredAt: '2026-08-04T01:00:00.000Z'
    })}\n`, 'utf8');
    takeoverRace.claimPath = path.resolve(lockPath, 'transition-claim.json');
    takeoverRace.enabled = true;

    const firstPromise = settleLease(acquireProjectOperationLease(root));
    await takeoverRace.firstEntered;
    const secondPromise = settleLease(acquireProjectOperationLease(root));
    const second = await withTimeout(secondPromise, 2_000);
    expect(second.outcome).toBe('acquired');
    const liveOwnerBefore = await readFile(path.join(lockPath, 'owner.json'));

    takeoverRace.releaseFirst();
    const first = await withTimeout(firstPromise, 2_000);
    const leases = [first, second].flatMap((result) => (
      result.outcome === 'acquired' ? [result.lease] : []
    ));

    expect(leases).toHaveLength(1);
    expect(first.outcome).toBe('rejected');
    expect(await readFile(path.join(lockPath, 'owner.json'))).toEqual(liveOwnerBefore);
    const currentOwner = JSON.parse(
      await readFile(path.join(lockPath, 'owner.json'), 'utf8')
    ) as { token?: unknown };
    expect(typeof currentOwner.token).toBe('string');
    await expect(acquireProjectOperationLease(root))
      .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
    await Promise.all(leases.map(async (lease) => lease.release()));
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
