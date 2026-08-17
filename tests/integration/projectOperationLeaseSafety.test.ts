import { spawn, type ChildProcess } from 'node:child_process';
import {
  lstat,
  lutimes,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  acquireProjectOperationLease,
  PROJECT_OPERATION_LOCK_NAME
} from '../../src/app/projectOperationLease.js';

const execFileAsync = promisify(execFile);
const CLAIM_SUFFIX = '.transition-claim';
const OLD_DATE = new Date('2020-01-01T00:00:00.000Z');

let root: string;
let child: ChildProcess | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-lease-safety-'));
});

afterEach(async () => {
  child?.kill('SIGKILL');
  child = undefined;
  await rm(root, { recursive: true, force: true });
});

describe('project operation lease publication and transition safety', () => {
  test.skipIf(process.platform !== 'linux')(
    'publishes complete owner metadata as one regular no-replace lock file',
    async () => {
      const lease = await acquireProjectOperationLease(root);
      const lockPath = projectLockPath();
      expect((await lstat(lockPath)).isFile()).toBe(true);
      const owner = JSON.parse(await readFile(lockPath, 'utf8')) as Record<string, unknown>;
      expect(owner).toMatchObject({
        pid: process.pid,
        processStartIdentity: expect.stringMatching(/^linux-proc-start:\d+$/u),
        bootId: await linuxBootId()
      });
      await lease.release();
    }
  );

  test('does not replace a fresh ownerless legacy lock during publication', async () => {
    const lockPath = projectLockPath();
    await mkdir(lockPath);

    await expect(acquireProjectOperationLease(root))
      .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
    expect((await lstat(lockPath)).isDirectory()).toBe(true);
  });

  test.skipIf(process.platform !== 'linux')(
    'recovers a transition claim after its claimant is killed',
    async () => {
      const lockPath = projectLockPath();
      child = spawn(process.execPath, ['-e', crashClaimFixture(), lockPath], {
        stdio: ['ignore', 'pipe', 'inherit']
      });
      await waitForChildReady(child);
      child.kill('SIGKILL');
      await waitForExit(child);
      child = undefined;

      const lease = await acquireProjectOperationLease(root);
      await expect(acquireProjectOperationLease(root))
        .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
      await lease.release();
    }
  );

  test.skipIf(process.platform !== 'linux')(
    'does not steal a delayed live claim and recovers it after boot identity mismatch',
    async () => {
      const lockPath = projectLockPath();
      const owner = await deadOwner('11111111-1111-4111-8111-111111111111');
      await writeFile(lockPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
      await utimes(lockPath, OLD_DATE, OLD_DATE);
      const lockStat = await lstat(lockPath);
      const liveClaim = await transitionClaim({
        token: '22222222-2222-4222-8222-222222222222',
        observedOwnerToken: owner.token,
        observedLockIdentity: `${lockStat.dev}:${lockStat.ino}`
      });
      const claimPath = `${lockPath}${CLAIM_SUFFIX}`;
      await writeFile(claimPath, `${JSON.stringify(liveClaim)}\n`, { mode: 0o600 });

      await expect(acquireProjectOperationLease(root))
        .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
      expect(JSON.parse(await readFile(claimPath, 'utf8'))).toEqual(liveClaim);

      await writeFile(claimPath, `${JSON.stringify({
        ...liveClaim,
        claimant: { ...liveClaim.claimant, bootId: '00000000-0000-4000-8000-000000000000' }
      })}\n`, 'utf8');
      await utimes(claimPath, OLD_DATE, OLD_DATE);
      const lease = await acquireProjectOperationLease(root);
      await lease.release();
    }
  );

  test.skipIf(process.platform !== 'linux')(
    'does not expire an exact live transition claimant solely because its heartbeat is old',
    async () => {
      const lockPath = projectLockPath();
      const owner = await deadOwner('12121212-1212-4212-8212-121212121212');
      await writeFile(lockPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
      await utimes(lockPath, OLD_DATE, OLD_DATE);
      const lockStat = await lstat(lockPath);
      const orphan = await transitionClaim({
        token: '23232323-2323-4232-8232-232323232323',
        observedOwnerToken: owner.token,
        observedLockIdentity: `${lockStat.dev}:${lockStat.ino}`
      });
      const claimPath = `${lockPath}${CLAIM_SUFFIX}`;
      await writeFile(claimPath, `${JSON.stringify(orphan)}\n`, { mode: 0o600 });
      await utimes(claimPath, OLD_DATE, OLD_DATE);

      await expect(withTimeout(acquireProjectOperationLease(root), 2_000))
        .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
      expect(JSON.parse(await readFile(claimPath, 'utf8'))).toEqual(orphan);
    }
  );

  test.skipIf(process.platform !== 'linux')(
    'cleans a live orphan claim when its observed lock no longer exists',
    async () => {
      const lockPath = projectLockPath();
      const claimPath = `${lockPath}${CLAIM_SUFFIX}`;
      const orphan = await transitionClaim({
        token: '34343434-3434-4434-8434-343434343434',
        observedOwnerToken: '45454545-4545-4454-8454-454545454545',
        observedLockIdentity: '1:1'
      });
      await writeFile(claimPath, `${JSON.stringify(orphan)}\n`, { mode: 0o600 });

      const lease = await withTimeout(acquireProjectOperationLease(root), 2_000);
      await expect(lease.release()).resolves.toBeUndefined();
      await expect(lstat(claimPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  test.skipIf(process.platform !== 'linux')(
    'treats a live PID from another Linux boot as a dead lock owner',
    async () => {
      const lockPath = projectLockPath();
      await writeFile(lockPath, `${JSON.stringify({
        token: '66666666-6666-4666-8666-666666666666',
        pid: process.pid,
        processStartIdentity: await processStartIdentity(process.pid),
        bootId: '00000000-0000-4000-8000-000000000000',
        acquiredAt: new Date().toISOString()
      })}\n`, { mode: 0o600 });

      const lease = await acquireProjectOperationLease(root);
      await lease.release();
    }
  );

  test.each([
    { kind: 'huge' as const },
    { kind: 'invalid_utf8' as const },
    { kind: 'symlink' as const },
    { kind: 'fifo' as const }
  ])(
    'recovers an old legacy lock with $kind owner metadata using no-follow bounded reads',
    async ({ kind }) => {
      const lockPath = projectLockPath();
      const ownerPath = path.join(lockPath, 'owner.json');
      const externalPath = path.join(root, `legacy-owner-external-${kind}.json`);
      await mkdir(lockPath);
      if (kind === 'huge') {
        await writeFile(ownerPath, Buffer.alloc(8 * 1024 + 1, 0x61));
      } else if (kind === 'invalid_utf8') {
        await writeFile(ownerPath, Buffer.from([0xc3, 0x28]));
      } else if (kind === 'symlink') {
        const liveOwner = await transitionClaim({
          token: '77777777-7777-4777-8777-777777777777',
          observedOwnerToken: '88888888-8888-4888-8888-888888888888',
          observedLockIdentity: '1:1'
        });
        await writeFile(externalPath, `${JSON.stringify(liveOwner.claimant)}\n`, 'utf8');
        await symlink(externalPath, ownerPath);
      } else {
        await execFileAsync('mkfifo', [ownerPath]);
      }
      await utimes(lockPath, OLD_DATE, OLD_DATE);

      const lease = await withTimeout(acquireProjectOperationLease(root), 2_000);
      if (kind === 'symlink') {
        expect(JSON.parse(await readFile(externalPath, 'utf8'))).toMatchObject({
          pid: process.pid
        });
      }
      await lease.release();
    }
  );

  test.each([
    { kind: 'huge' as const },
    { kind: 'invalid_utf8' as const },
    { kind: 'symlink' as const },
    { kind: 'fifo' as const }
  ])(
    'recovers an old hostile $kind transition claim without following or blocking on it',
    async ({ kind }) => {
      const lockPath = projectLockPath();
      const owner = await deadOwner('33333333-3333-4333-8333-333333333333');
      await writeFile(lockPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
      await utimes(lockPath, OLD_DATE, OLD_DATE);
      const claimPath = `${lockPath}${CLAIM_SUFFIX}`;
      const externalPath = path.join(root, `external-${kind}.json`);
      const externalBytes = Buffer.from('{"protected":true}\n', 'utf8');
      if (kind === 'huge') {
        await writeFile(claimPath, Buffer.alloc(8 * 1024 + 1, 0x61));
        await utimes(claimPath, OLD_DATE, OLD_DATE);
      } else if (kind === 'invalid_utf8') {
        await writeFile(claimPath, Buffer.from([0xc3, 0x28]));
        await utimes(claimPath, OLD_DATE, OLD_DATE);
      } else if (kind === 'symlink') {
        await writeFile(externalPath, externalBytes);
        await symlink(externalPath, claimPath);
        await lutimes(claimPath, OLD_DATE, OLD_DATE);
      } else {
        await execFileAsync('mkfifo', [claimPath]);
        await utimes(claimPath, OLD_DATE, OLD_DATE);
      }

      const lease = await withTimeout(acquireProjectOperationLease(root), 2_000);
      if (kind === 'symlink') {
        expect(await readFile(externalPath)).toEqual(externalBytes);
      }
      await lease.release();
    }
  );

  test.each([
    { kind: 'huge' as const },
    { kind: 'invalid_utf8' as const }
  ])('recovers an old $kind owner record through bounded fatal decoding', async ({ kind }) => {
    const lockPath = projectLockPath();
    await writeFile(
      lockPath,
      kind === 'huge'
        ? Buffer.alloc(8 * 1024 + 1, 0x61)
        : Buffer.from([0xc3, 0x28])
    );
    await utimes(lockPath, OLD_DATE, OLD_DATE);

    const lease = await withTimeout(acquireProjectOperationLease(root), 2_000);
    await lease.release();
  });

  test.each([
    { kind: 'symlink' as const },
    { kind: 'fifo' as const }
  ])('fails closed without following or blocking on a $kind canonical lock', async ({ kind }) => {
    const lockPath = projectLockPath();
    const externalPath = path.join(root, `canonical-external-${kind}.json`);
    const externalBytes = Buffer.from('{"protected":true}\n', 'utf8');
    if (kind === 'symlink') {
      await writeFile(externalPath, externalBytes);
      await symlink(externalPath, lockPath);
    } else {
      await execFileAsync('mkfifo', [lockPath]);
    }

    await expect(withTimeout(acquireProjectOperationLease(root), 2_000))
      .rejects.toMatchObject({ code: 'PROJECT_OPERATION_LOCKED' });
    if (kind === 'symlink') expect(await readFile(externalPath)).toEqual(externalBytes);
  });
});

function projectLockPath(): string {
  return path.join(root, PROJECT_OPERATION_LOCK_NAME);
}

async function linuxBootId(): Promise<string> {
  return (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
}

async function processStartIdentity(pid: number): Promise<string> {
  const processStat = await readFile(`/proc/${pid}/stat`, 'utf8');
  const commandEnd = processStat.lastIndexOf(')');
  const fieldsFromState = processStat.slice(commandEnd + 2).trim().split(/\s+/u);
  return `linux-proc-start:${fieldsFromState[19]}`;
}

async function deadOwner(token: string) {
  return {
    token,
    pid: 999_999_999,
    processStartIdentity: 'linux-proc-start:1',
    bootId: await linuxBootId(),
    acquiredAt: '2026-08-04T01:00:00.000Z'
  };
}

async function transitionClaim(input: {
  token: string;
  observedOwnerToken: string;
  observedLockIdentity: string;
}) {
  return {
    claimant: {
      token: input.token,
      pid: process.pid,
      processStartIdentity: await processStartIdentity(process.pid),
      bootId: await linuxBootId(),
      acquiredAt: '2026-08-04T01:00:00.000Z'
    },
    observedOwnerToken: input.observedOwnerToken,
    observedLockIdentity: input.observedLockIdentity,
    claimedAt: '2026-08-04T01:00:00.000Z'
  };
}

function crashClaimFixture(): string {
  return String.raw`
    const fs = require('node:fs');
    const lockPath = process.argv[1];
    const procStat = fs.readFileSync('/proc/self/stat', 'utf8');
    const commandEnd = procStat.lastIndexOf(')');
    const start = procStat.slice(commandEnd + 2).trim().split(/\s+/u)[19];
    const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const acquiredAt = new Date().toISOString();
    const owner = {
      token: '44444444-4444-4444-8444-444444444444',
      pid: process.pid,
      processStartIdentity: 'linux-proc-start:' + start,
      bootId,
      acquiredAt
    };
    fs.writeFileSync(lockPath, JSON.stringify(owner) + '\n', { flag: 'wx', mode: 0o600 });
    const lockStat = fs.lstatSync(lockPath);
    const claim = {
      claimant: {
        token: '55555555-5555-4555-8555-555555555555',
        pid: process.pid,
        processStartIdentity: 'linux-proc-start:' + start,
        bootId,
        acquiredAt
      },
      observedOwnerToken: owner.token,
      observedLockIdentity: lockStat.dev + ':' + lockStat.ino,
      claimedAt: acquiredAt
    };
    fs.writeFileSync(lockPath + '${CLAIM_SUFFIX}', JSON.stringify(claim) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write('ready\n');
    setInterval(() => {}, 1000);
  `;
}

async function waitForChildReady(process: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout?.once('data', (chunk) => {
      if (String(chunk).includes('ready')) resolve();
    });
    process.once('error', reject);
    process.once('exit', (code) => reject(new Error(`Claim child exited before ready: ${code}`)));
  });
}

async function waitForExit(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  await new Promise<void>((resolve) => process.once('exit', () => resolve()));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for lease operation.')), timeoutMs);
    })
  ]);
}
