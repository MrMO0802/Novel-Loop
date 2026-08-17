import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const faults = vi.hoisted(() => ({
  canonicalPath: '',
  failLinkAfterPublish: false,
  failCanonicalVerificationOnce: false,
  linkPublished: false,
  publicationCleanupRenameFailures: 0,
  claimCleanupRenameFailures: 0,
  claimCleanupRenameAttempts: 0,
  injectClaimAba: false,
  claimAbaInjected: false,
  latestClaimText: '',
  releaseRenameFailures: 0,
  staleRenameFailures: 0
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    link: async (...args: Parameters<typeof original.link>) => {
      await original.link(...args);
      const [, newPath] = args;
      const publishedCanonical = typeof newPath === 'string'
        && path.resolve(newPath) === faults.canonicalPath;
      if (publishedCanonical) faults.linkPublished = true;
      if (publishedCanonical && faults.failLinkAfterPublish) {
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
      const claimPath = `${faults.canonicalPath}.transition-claim`;
      if (
        typeof oldPath === 'string'
        && path.resolve(oldPath) === claimPath
        && typeof newPath === 'string'
        && newPath.includes('.claim-finished-')
      ) {
        faults.claimCleanupRenameAttempts += 1;
        if (faults.claimCleanupRenameFailures > 0) {
          faults.claimCleanupRenameFailures -= 1;
          const error = new Error('forced transition claim cleanup failure');
          Object.assign(error, { code: 'EIO' });
          throw error;
        }
      }
      if (
        faults.injectClaimAba
        && !faults.claimAbaInjected
        && typeof oldPath === 'string'
        && path.resolve(oldPath) === claimPath
        && typeof newPath === 'string'
        && newPath.includes('.claim-finished-')
      ) {
        faults.claimAbaInjected = true;
        const originalClaim = JSON.parse(await original.readFile(oldPath, 'utf8')) as {
          claimant: Record<string, unknown>;
          observedOwnerToken: unknown;
          observedLockIdentity: unknown;
          claimedAt: unknown;
        };
        const displacedClaim = {
          ...originalClaim,
          claimant: {
            ...originalClaim.claimant,
            token: 'abababab-abab-4bab-8bab-abababababab'
          }
        };
        const latestClaim = {
          ...originalClaim,
          claimant: {
            ...originalClaim.claimant,
            token: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
          }
        };
        await original.rename(oldPath, `${oldPath}.aba-original`);
        await original.writeFile(oldPath, `${JSON.stringify(displacedClaim)}\n`, { mode: 0o600 });
        await original.rename(oldPath, newPath);
        faults.latestClaimText = `${JSON.stringify(latestClaim)}\n`;
        await original.writeFile(oldPath, faults.latestClaimText, {
          flag: 'wx',
          mode: 0o600
        });
        return;
      }
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
  PROJECT_OPERATION_LOCK_NAME,
  withProjectChapterOperationLease
} from '../../src/app/projectOperationLease.js';
import { buildBible } from '../../src/app/buildBible.js';
import {
  createInitialStoryState,
  initProjectFromBriefText
} from '../../src/app/initProject.js';

let root: string | undefined;

afterEach(async () => {
  faults.canonicalPath = '';
  faults.failLinkAfterPublish = false;
  faults.failCanonicalVerificationOnce = false;
  faults.linkPublished = false;
  faults.publicationCleanupRenameFailures = 0;
  faults.claimCleanupRenameFailures = 0;
  faults.claimCleanupRenameAttempts = 0;
  faults.injectClaimAba = false;
  faults.claimAbaInjected = false;
  faults.latestClaimText = '';
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

  test('resumes its exact live claim after release and claim cleanup fail together', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-fault-'));
    faults.canonicalPath = path.resolve(root, PROJECT_OPERATION_LOCK_NAME);
    const lease = await acquireProjectOperationLease(root);
    faults.releaseRenameFailures = 1;
    faults.claimCleanupRenameFailures = 1;

    await expect(lease.release()).rejects.toThrow('forced release rename failure');
    expect((await lstat(`${faults.canonicalPath}.transition-claim`)).isFile()).toBe(true);

    await expect(lease.release()).resolves.toBeUndefined();
    const replacement = await acquireProjectOperationLease(root);
    await expect(replacement.release()).resolves.toBeUndefined();
  });

  test.each([
    {
      description: 'after a transient release rename failure',
      claimCleanupRenameFailures: 0
    },
    {
      description: 'after release rename and first claim cleanup both fail',
      claimCleanupRenameFailures: 1
    }
  ])(
    'retries wrapper release $description and preserves protected project bytes',
    async ({ claimCleanupRenameFailures }) => {
      root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-fault-'));
      faults.canonicalPath = path.resolve(root, PROJECT_OPERATION_LOCK_NAME);
      const fixture = await createChapterOperationFixture(root);
      faults.releaseRenameFailures = 1;
      faults.claimCleanupRenameFailures = claimCleanupRenameFailures;
      const intervalSpy = vi.spyOn(globalThis, 'setInterval');
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

      try {
        await expect(runChapterLease(root, 'first-callback-result'))
          .resolves.toBe('first-callback-result');
        await expect(runChapterLease(root, 'later-callback-result'))
          .resolves.toBe('later-callback-result');

        const createdTimers = intervalSpy.mock.results
          .filter((result) => result.type === 'return')
          .map((result) => result.value);
        expect(createdTimers.length).toBeGreaterThan(0);
        for (const timer of createdTimers) {
          expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
        }
        await expect(lstat(faults.canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(`${faults.canonicalPath}.transition-claim`))
          .rejects.toMatchObject({ code: 'ENOENT' });
        expect((await readdir(root)).filter((entry) => entry.includes('.released-'))).toEqual([]);
        expect(await readFile(fixture.statePath)).toEqual(fixture.storyStateBytes);
        expect(await readFile(fixture.queuePath)).toEqual(fixture.queueBytes);
      } finally {
        intervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }
    }
  );

  test('retries a transient release failure through the real buildBible path', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-build-release-fault-'));
    const fixture = await createBuildReleaseFixture(root, 'transient-build-release');
    faults.canonicalPath = path.resolve(
      fixture.projectRoot,
      PROJECT_OPERATION_LOCK_NAME
    );
    faults.releaseRenameFailures = 1;
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    try {
      await expect(buildBible({
        projectId: fixture.projectId,
        projectsRoot: root,
        provider: 'mock',
        runId: 'run_transient_build_release'
      })).resolves.toMatchObject({
        projectId: fixture.projectId,
        runId: 'run_transient_build_release'
      });

      expect(faults.releaseRenameFailures).toBe(0);
      await expectProjectLeaseArtifactsClean(fixture.projectRoot);
      expect(await readFile(fixture.statePath)).toEqual(fixture.storyStateBytes);
      expect(await readFile(fixture.queuePath)).toEqual(fixture.queueBytes);
      expectAllCreatedIntervalsCleared(intervalSpy, clearIntervalSpy);
    } finally {
      intervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  test('retains an exhausted buildBible release for a later same-process chapter operation', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-build-release-fault-'));
    const fixture = await createBuildReleaseFixture(root, 'retained-build-release');
    faults.canonicalPath = path.resolve(
      fixture.projectRoot,
      PROJECT_OPERATION_LOCK_NAME
    );
    faults.releaseRenameFailures = 32;

    await expect(buildBible({
      projectId: fixture.projectId,
      projectsRoot: root,
      provider: 'mock',
      runId: 'run_retained_build_release'
    })).rejects.toThrow('forced release rename failure');
    expect((await lstat(faults.canonicalPath)).isFile()).toBe(true);

    faults.releaseRenameFailures = 0;
    await expect(runChapterLease(fixture.projectRoot, 'recovered-after-build'))
      .resolves.toBe('recovered-after-build');

    await expectProjectLeaseArtifactsClean(fixture.projectRoot);
    expect(await readFile(fixture.statePath)).toEqual(fixture.storyStateBytes);
    expect(await readFile(fixture.queuePath)).toEqual(fixture.queueBytes);
  });

  test('keeps persistent direct release failure explicit without starting a later callback', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-build-release-fault-'));
    const fixture = await createBuildReleaseFixture(root, 'persistent-build-release');
    faults.canonicalPath = path.resolve(
      fixture.projectRoot,
      PROJECT_OPERATION_LOCK_NAME
    );
    faults.releaseRenameFailures = 32;

    await expect(buildBible({
      projectId: fixture.projectId,
      projectsRoot: root,
      provider: 'mock',
      runId: 'run_persistent_build_release'
    })).rejects.toThrow('forced release rename failure');

    let laterCallbackCount = 0;
    await expect(withProjectChapterOperationLease({
      projectRoot: fixture.projectRoot,
      chapterNumber: 1,
      operation: 'blocked-by-persistent-build-release',
      allowStoryStateWrite: false
    }, async () => {
      laterCallbackCount += 1;
      return 'must-not-run';
    })).rejects.toThrow('forced release rename failure');
    expect(laterCallbackCount).toBe(0);
    expect((await lstat(faults.canonicalPath)).isFile()).toBe(true);
    expect(await readFile(fixture.statePath)).toEqual(fixture.storyStateBytes);
    expect(await readFile(fixture.queuePath)).toEqual(fixture.queueBytes);

    faults.releaseRenameFailures = 0;
    await expect(runChapterLease(fixture.projectRoot, 'recovered-after-persistent-fault'))
      .resolves.toBe('recovered-after-persistent-fault');
    await expectProjectLeaseArtifactsClean(fixture.projectRoot);
  });

  test('retains an exhausted wrapper release so a later same-process operation can recover it', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-fault-'));
    faults.canonicalPath = path.resolve(root, PROJECT_OPERATION_LOCK_NAME);
    const fixture = await createChapterOperationFixture(root);
    faults.releaseRenameFailures = 32;

    await expect(runChapterLease(root, 'unreachable-result'))
      .rejects.toThrow('forced release rename failure');
    expect((await lstat(faults.canonicalPath)).isFile()).toBe(true);
    expect(await readFile(fixture.statePath)).toEqual(fixture.storyStateBytes);
    expect(await readFile(fixture.queuePath)).toEqual(fixture.queueBytes);

    faults.releaseRenameFailures = 0;
    const recoveredLease = await acquireProjectOperationLease(root);
    await expect(recoveredLease.release()).resolves.toBeUndefined();
    await expect(lstat(faults.canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(`${faults.canonicalPath}.transition-claim`))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(root)).filter((entry) => entry.includes('.released-'))).toEqual([]);
    expect(await readFile(fixture.statePath)).toEqual(fixture.storyStateBytes);
    expect(await readFile(fixture.queuePath)).toEqual(fixture.queueBytes);
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

  test('commits business release and cleans terminal resources when claim cleanup fails', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-fault-'));
    faults.canonicalPath = path.resolve(root, PROJECT_OPERATION_LOCK_NAME);
    const statePath = path.join(root, 'state', 'story_state.json');
    const queuePath = path.join(root, 'planning', 'chapter_queue.json');
    await Promise.all([
      mkdir(path.dirname(statePath), { recursive: true }),
      mkdir(path.dirname(queuePath), { recursive: true })
    ]);
    const storyStateText = `${JSON.stringify(createInitialStoryState('release-fault'))}\n`;
    const queueText = `${JSON.stringify({
      schemaVersion: '1.0',
      projectId: 'release-fault',
      chapters: [{
        chapterNumber: 1,
        title: 'Lease release',
        status: 'draft_ready',
        currentStage: 'draft_assembly'
      }]
    })}\n`;
    await Promise.all([
      writeFile(statePath, storyStateText),
      writeFile(queuePath, queueText)
    ]);
    faults.claimCleanupRenameFailures = 1;
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    try {
      await expect(withProjectChapterOperationLease({
        projectRoot: root,
        chapterNumber: 1,
        operation: 'release-fault-business-callback',
        allowStoryStateWrite: false
      }, async () => 'callback-result')).resolves.toBe('callback-result');

      const createdTimers = intervalSpy.mock.results
        .filter((result) => result.type === 'return')
        .map((result) => result.value);
      expect(createdTimers).toHaveLength(2);
      for (const timer of createdTimers) {
        expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
      }
      expect(faults.claimCleanupRenameAttempts).toBe(1);
      expect((await lstat(`${faults.canonicalPath}.transition-claim`)).isFile()).toBe(true);
      expect((await readdir(root)).filter((entry) => entry.includes('.released-'))).toEqual([]);
      expect(await readFile(statePath, 'utf8')).toBe(storyStateText);
      expect(await readFile(queuePath, 'utf8')).toBe(queueText);

      const replacement = await acquireProjectOperationLease(root);
      await expect(lstat(`${faults.canonicalPath}.transition-claim`))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(faults.claimCleanupRenameAttempts).toBe(1);
      const replacementOwner = await readFile(faults.canonicalPath, 'utf8');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await readFile(faults.canonicalPath, 'utf8')).toBe(replacementOwner);
      await expect(replacement.release()).resolves.toBeUndefined();
      expect(faults.claimCleanupRenameAttempts).toBe(2);
    } finally {
      intervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  test('never restores a displaced claim over a newer claimant during exact cleanup', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-fault-'));
    faults.canonicalPath = path.resolve(root, PROJECT_OPERATION_LOCK_NAME);
    const lease = await acquireProjectOperationLease(root);
    faults.injectClaimAba = true;

    await lease.release();

    expect(faults.claimAbaInjected).toBe(true);
    expect(await readFile(`${faults.canonicalPath}.transition-claim`, 'utf8'))
      .toBe(faults.latestClaimText);
    const replacement = await acquireProjectOperationLease(root);
    await expect(replacement.release()).resolves.toBeUndefined();
  });
});

async function createChapterOperationFixture(projectRoot: string): Promise<{
  statePath: string;
  queuePath: string;
  storyStateBytes: Buffer;
  queueBytes: Buffer;
}> {
  const statePath = path.join(projectRoot, 'state', 'story_state.json');
  const queuePath = path.join(projectRoot, 'planning', 'chapter_queue.json');
  await Promise.all([
    mkdir(path.dirname(statePath), { recursive: true }),
    mkdir(path.dirname(queuePath), { recursive: true })
  ]);
  const storyStateBytes = Buffer.from(
    `${JSON.stringify(createInitialStoryState('wrapper-release-fault'))}\n`,
    'utf8'
  );
  const queueBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: '1.0',
    projectId: 'wrapper-release-fault',
    chapters: [{
      chapterNumber: 1,
      title: 'Wrapper release recovery',
      status: 'draft_ready',
      currentStage: 'draft_assembly'
    }]
  })}\n`, 'utf8');
  await Promise.all([
    writeFile(statePath, storyStateBytes),
    writeFile(queuePath, queueBytes)
  ]);
  return { statePath, queuePath, storyStateBytes, queueBytes };
}

async function createBuildReleaseFixture(
  projectsRoot: string,
  projectId: string
): Promise<{
  projectId: string;
  projectRoot: string;
  statePath: string;
  queuePath: string;
  storyStateBytes: Buffer;
  queueBytes: Buffer;
}> {
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Managed build release\n\nA lease recovery fixture.\n'
  });
  const projectRoot = path.join(projectsRoot, projectId);
  const statePath = path.join(projectRoot, 'state', 'story_state.json');
  const queuePath = path.join(projectRoot, 'planning', 'chapter_queue.json');
  const queueBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: '1.0',
    projectId,
    chapters: [{
      chapterNumber: 1,
      title: 'Managed build release',
      status: 'draft_ready',
      currentStage: 'draft_assembly'
    }]
  })}\n`, 'utf8');
  await writeFile(queuePath, queueBytes);
  return {
    projectId,
    projectRoot,
    statePath,
    queuePath,
    storyStateBytes: await readFile(statePath),
    queueBytes
  };
}

async function expectProjectLeaseArtifactsClean(projectRoot: string): Promise<void> {
  const lockPath = path.join(projectRoot, PROJECT_OPERATION_LOCK_NAME);
  await expect(lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(lstat(`${lockPath}.transition-claim`))
    .rejects.toMatchObject({ code: 'ENOENT' });
  expect((await readdir(projectRoot)).filter((entry) => (
    entry.includes('.released-')
    || entry.includes('.transition-claim')
  ))).toEqual([]);
}

function expectAllCreatedIntervalsCleared(
  intervalSpy: ReturnType<typeof vi.spyOn>,
  clearIntervalSpy: ReturnType<typeof vi.spyOn>
): void {
  const createdTimers = intervalSpy.mock.results
    .filter((result) => result.type === 'return')
    .map((result) => result.value);
  expect(createdTimers.length).toBeGreaterThan(0);
  for (const timer of createdTimers) {
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
  }
}

async function runChapterLease(projectRoot: string, result: string): Promise<string> {
  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: 1,
    operation: 'wrapper-release-recovery',
    allowStoryStateWrite: false
  }, async () => result);
}
