import { lstat, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const faults = vi.hoisted(() => ({
  canonicalPath: '',
  failLinkAfterPublish: false,
  failCanonicalVerificationOnce: false,
  linkPublished: false,
  publicationCleanupRenameFailures: 0,
  releaseRenameFailures: 0,
  staleRenameFailures: 0
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    link: async (...args: Parameters<typeof original.link>) => {
      await original.link(...args);
      faults.linkPublished = true;
      if (faults.failLinkAfterPublish) {
        const error = new Error('forced post-publication link failure');
        Object.assign(error, { code: 'EIO' });
        throw error;
      }
    },
    open: async (...args: Parameters<typeof original.open>) => {
      const [filePath] = args;
      if (
        faults.linkPublished
        && faults.failCanonicalVerificationOnce
        && typeof filePath === 'string'
        && path.resolve(filePath) === faults.canonicalPath
      ) {
        faults.failCanonicalVerificationOnce = false;
        const error = new Error('forced post-publication verification failure');
        Object.assign(error, { code: 'EIO' });
        throw error;
      }
      return original.open(...args);
    },
    rename: async (...args: Parameters<typeof original.rename>) => {
      const [oldPath, newPath] = args;
      if (
        faults.publicationCleanupRenameFailures > 0
        && typeof oldPath === 'string'
        && typeof newPath === 'string'
        && path.resolve(oldPath) === faults.canonicalPath
        && newPath.includes('.publication-failed-')
      ) {
        faults.publicationCleanupRenameFailures -= 1;
        const error = new Error('forced publication cleanup rename failure');
        Object.assign(error, { code: 'EIO' });
        throw error;
      }
      if (
        faults.releaseRenameFailures > 0
        && typeof oldPath === 'string'
        && typeof newPath === 'string'
        && path.resolve(oldPath) === faults.canonicalPath
        && newPath.includes('.released-')
      ) {
        faults.releaseRenameFailures -= 1;
        const error = new Error('forced release rename failure');
        Object.assign(error, { code: 'EIO' });
        throw error;
      }
      if (
        faults.staleRenameFailures > 0
        && typeof oldPath === 'string'
        && typeof newPath === 'string'
        && path.resolve(oldPath) === faults.canonicalPath
        && newPath.includes('.stale-')
      ) {
        faults.staleRenameFailures -= 1;
        const error = new Error('forced stale takeover rename failure');
        Object.assign(error, { code: 'EIO' });
        throw error;
      }
      return original.rename(...args);
    }
  };
});

import {
  acquireProjectOperationLease,
  PROJECT_OPERATION_LOCK_NAME
} from '../../src/app/projectOperationLease.js';

let root: string | undefined;

afterEach(async () => {
  faults.canonicalPath = '';
  faults.failLinkAfterPublish = false;
  faults.failCanonicalVerificationOnce = false;
  faults.linkPublished = false;
  faults.publicationCleanupRenameFailures = 0;
  faults.releaseRenameFailures = 0;
  faults.staleRenameFailures = 0;
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('project operation lease fault recovery', () => {
  test('removes its exact published lock when atomic publication reports failure', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-fault-'));
    faults.canonicalPath = path.resolve(root, PROJECT_OPERATION_LOCK_NAME);
    faults.failLinkAfterPublish = true;

    await expect(acquireProjectOperationLease(root))
      .rejects.toThrow('forced post-publication link failure');
    await expect(lstat(faults.canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('removes its exact published lock when owner verification fails', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-fault-'));
    faults.canonicalPath = path.resolve(root, PROJECT_OPERATION_LOCK_NAME);
    faults.failCanonicalVerificationOnce = true;

    await expect(acquireProjectOperationLease(root))
      .rejects.toThrow('forced post-publication verification failure');
    await expect(lstat(faults.canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('abandons its owner identity when post-publication cleanup also fails', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-fault-'));
    faults.canonicalPath = path.resolve(root, PROJECT_OPERATION_LOCK_NAME);
    faults.failCanonicalVerificationOnce = true;
    faults.publicationCleanupRenameFailures = 1;

    await expect(acquireProjectOperationLease(root))
      .rejects.toThrow('forced post-publication verification failure');
    const abandoned = JSON.parse(await readFile(faults.canonicalPath, 'utf8')) as {
      bootId?: unknown;
    };
    expect(abandoned.bootId).toBe('00000000-0000-4000-8000-000000000000');

    const replacement = await acquireProjectOperationLease(root);
    await replacement.release();
  });

  test('keeps a lease live and retryable when release rename fails', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-fault-'));
    faults.canonicalPath = path.resolve(root, PROJECT_OPERATION_LOCK_NAME);
    const lease = await acquireProjectOperationLease(root);
    faults.releaseRenameFailures = 1;

    await expect(lease.release()).rejects.toThrow('forced release rename failure');
    await expect(lstat(`${faults.canonicalPath}.transition-claim`))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(acquireProjectOperationLease(root))
      .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });

    await expect(lease.release()).resolves.toBeUndefined();
    const replacement = await acquireProjectOperationLease(root);
    await replacement.release();
  });

  test('cleans its claim after stale takeover rename fails so a new owner can retry', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-fault-'));
    faults.canonicalPath = path.resolve(root, PROJECT_OPERATION_LOCK_NAME);
    await writeFile(faults.canonicalPath, '{"invalid":"dead-owner"}\n', { mode: 0o600 });
    const old = new Date('2020-01-01T00:00:00.000Z');
    await utimes(faults.canonicalPath, old, old);
    faults.staleRenameFailures = 1;

    await expect(acquireProjectOperationLease(root))
      .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
    await expect(lstat(`${faults.canonicalPath}.transition-claim`))
      .rejects.toMatchObject({ code: 'ENOENT' });

    const replacement = await acquireProjectOperationLease(root);
    await replacement.release();
  });
});
