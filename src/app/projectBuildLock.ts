import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../utils/AppError.js';

const BUILD_LOCK_NAME = '.novel-loop-build-bible.lock';
const BUILD_LOCK_STALE_MS = 10 * 60 * 1000;
const BUILD_LOCK_HEARTBEAT_MS = 30 * 1000;
const STALE_RECOVERY_ATTEMPTS = 4;

export interface ProjectBuildLock {
  release(): Promise<void>;
}

export async function acquireProjectBuildLock(
  projectRoot: string
): Promise<ProjectBuildLock> {
  const lockPath = path.join(projectRoot, BUILD_LOCK_NAME);
  const token = randomUUID();

  for (let attempt = 0; attempt < STALE_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockPath);
      return await ownLock(lockPath, token);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      if (!(await recoverStaleLock(lockPath, token))) {
        throw new AppError(
          'BUILD_BIBLE_LOCKED',
          'Another Story Bible build is already running for this project.',
          2
        );
      }
    }
  }

  throw new AppError(
    'BUILD_BIBLE_LOCKED',
    'Another Story Bible build is already running for this project.',
    2
  );
}

async function ownLock(lockPath: string, token: string): Promise<ProjectBuildLock> {
  const ownerPath = path.join(lockPath, 'owner.json');
  try {
    await writeFile(ownerPath, JSON.stringify({
      token,
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    }) + '\n', { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }

  const heartbeat = setInterval(() => {
    const now = new Date();
    void utimes(lockPath, now, now).catch(() => undefined);
  }, BUILD_LOCK_HEARTBEAT_MS);
  heartbeat.unref();
  let released = false;

  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      clearInterval(heartbeat);

      try {
        const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as {
          token?: unknown;
        };
        if (owner.token !== token) return;
        const releasedPath = `${lockPath}.released-${token}`;
        await rename(lockPath, releasedPath);
        await rm(releasedPath, { recursive: true, force: true });
      } catch {
        // A failed cleanup remains recoverable through the stale-lock path.
      }
    }
  };
}

async function recoverStaleLock(lockPath: string, token: string): Promise<boolean> {
  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs <= BUILD_LOCK_STALE_MS) return false;

    const stalePath = `${lockPath}.stale-${token}`;
    await rename(lockPath, stalePath);
    await rm(stalePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true;
    return false;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
