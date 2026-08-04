import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
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

import { ChapterQueueSchema, StoryStateSchema } from '../schemas/index.js';
import { AppError } from '../utils/AppError.js';

export const PROJECT_OPERATION_LOCK_NAME = '.novel-loop-build-bible.lock';

const PROJECT_OPERATION_LOCK_STALE_MS = 10 * 60 * 1000;
const PROJECT_OPERATION_HEARTBEAT_MS = 30 * 1000;
const STALE_RECOVERY_ATTEMPTS = 4;

export interface ProjectOperationLease {
  release(): Promise<void>;
}

export interface ProjectOperationBusyError {
  code: string;
  message: string;
}

export interface ProjectChapterOperationOptions {
  projectRoot: string;
  chapterNumber: number;
  operation: string;
  allowStoryStateWrite: boolean;
}

interface ChapterOperationExpectation {
  chapterNumber: number;
  allowStoryStateWrite: boolean;
  storyStatePath: string;
  queuePath: string;
  storyStateHash: string;
  queueHash: string;
  latestCommittedChapter: number;
  queueStatus: string;
  queueStage: string;
  stale: boolean;
}

interface ProjectOperationContext {
  projectRoot: string;
  operation: string;
  lease: ProjectOperationLease;
  chapter?: ChapterOperationExpectation;
}

const operationContext = new AsyncLocalStorage<ProjectOperationContext>();

export async function acquireProjectOperationLease(
  projectRoot: string,
  busyError: ProjectOperationBusyError = {
    code: 'PROJECT_OPERATION_LOCKED',
    message: 'Another project operation is already running.'
  }
): Promise<ProjectOperationLease> {
  const lockPath = path.join(path.resolve(projectRoot), PROJECT_OPERATION_LOCK_NAME);
  const token = randomUUID();

  for (let attempt = 0; attempt < STALE_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockPath);
      return await ownLock(lockPath, token);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      if (!(await recoverStaleLock(lockPath, token))) {
        throw new AppError(busyError.code, busyError.message, 2);
      }
    }
  }

  throw new AppError(busyError.code, busyError.message, 2);
}

export async function withProjectChapterOperationLease<T>(
  options: ProjectChapterOperationOptions,
  callback: () => Promise<T>
): Promise<T> {
  const projectRoot = path.resolve(options.projectRoot);
  const active = operationContext.getStore();
  if (active?.projectRoot === projectRoot) {
    if (
      active.chapter !== undefined
      && active.chapter.chapterNumber !== options.chapterNumber
    ) {
      throw new AppError(
        'PROJECT_OPERATION_NESTED_CONFLICT',
        'A nested project operation targeted a different chapter.',
        2
      );
    }
    return callback();
  }

  const lease = await acquireProjectOperationLease(projectRoot);
  try {
    const chapter = await readChapterExpectation(options);
    return await operationContext.run({
      projectRoot,
      operation: options.operation,
      lease,
      chapter
    }, callback);
  } finally {
    await lease.release();
  }
}

export async function beforeProjectOperationWrite(filePath: string): Promise<void> {
  const context = operationContext.getStore();
  const chapter = context?.chapter;
  if (
    context === undefined
    || chapter === undefined
    || !isWithinProject(context.projectRoot, filePath)
  ) {
    return;
  }
  if (chapter.stale) throw staleOperationError(context);

  try {
    const [storyStateText, queueText] = await Promise.all([
      readFile(chapter.storyStatePath, 'utf8'),
      readFile(chapter.queuePath, 'utf8')
    ]);
    const storyState = StoryStateSchema.parse(JSON.parse(storyStateText) as unknown);
    const queue = ChapterQueueSchema.parse(JSON.parse(queueText) as unknown);
    const queueItems = queue.chapters.filter(
      (item) => item.chapterNumber === chapter.chapterNumber
    );
    if (
      sha256(storyStateText) !== chapter.storyStateHash
      || storyState.latestCommittedChapter !== chapter.latestCommittedChapter
      || sha256(queueText) !== chapter.queueHash
      || queueItems.length !== 1
      || queueItems[0]?.status !== chapter.queueStatus
      || queueItems[0]?.currentStage !== chapter.queueStage
    ) {
      chapter.stale = true;
      throw staleOperationError(context);
    }
  } catch (error) {
    if (error instanceof AppError && error.code === 'PROJECT_OPERATION_STALE') {
      throw error;
    }
    chapter.stale = true;
    throw staleOperationError(context);
  }

  if (
    path.resolve(filePath) === chapter.storyStatePath
    && !chapter.allowStoryStateWrite
  ) {
    throw new AppError(
      'PROJECT_OPERATION_STATE_WRITE_FORBIDDEN',
      'This project operation cannot modify Story State.',
      2
    );
  }
}

export async function afterProjectOperationWrite(
  filePath: string,
  content: string
): Promise<void> {
  const context = operationContext.getStore();
  const chapter = context?.chapter;
  if (
    context === undefined
    || chapter === undefined
    || !isWithinProject(context.projectRoot, filePath)
  ) {
    return;
  }

  const resolvedPath = path.resolve(filePath);
  if (resolvedPath === chapter.queuePath) {
    const queue = ChapterQueueSchema.parse(JSON.parse(content) as unknown);
    const queueItems = queue.chapters.filter(
      (item) => item.chapterNumber === chapter.chapterNumber
    );
    if (queueItems.length !== 1) {
      chapter.stale = true;
      throw staleOperationError(context);
    }
    chapter.queueHash = sha256(content);
    chapter.queueStatus = queueItems[0]!.status;
    chapter.queueStage = queueItems[0]!.currentStage;
  }
  if (resolvedPath === chapter.storyStatePath) {
    const state = StoryStateSchema.parse(JSON.parse(content) as unknown);
    chapter.storyStateHash = sha256(content);
    chapter.latestCommittedChapter = state.latestCommittedChapter;
  }
}

async function readChapterExpectation(
  options: ProjectChapterOperationOptions
): Promise<ChapterOperationExpectation> {
  const projectRoot = path.resolve(options.projectRoot);
  const storyStatePath = path.join(projectRoot, 'state', 'story_state.json');
  const queuePath = path.join(projectRoot, 'planning', 'chapter_queue.json');
  const [storyStateText, queueText] = await Promise.all([
    readFile(storyStatePath, 'utf8'),
    readFile(queuePath, 'utf8')
  ]);
  const storyState = StoryStateSchema.parse(JSON.parse(storyStateText) as unknown);
  const queue = ChapterQueueSchema.parse(JSON.parse(queueText) as unknown);
  const queueItems = queue.chapters.filter(
    (item) => item.chapterNumber === options.chapterNumber
  );
  if (queueItems.length !== 1) {
    throw new AppError(
      'PROJECT_OPERATION_TARGET_INVALID',
      `Chapter ${options.chapterNumber} is not a unique queue target.`,
      2
    );
  }

  return {
    chapterNumber: options.chapterNumber,
    allowStoryStateWrite: options.allowStoryStateWrite,
    storyStatePath,
    queuePath,
    storyStateHash: sha256(storyStateText),
    queueHash: sha256(queueText),
    latestCommittedChapter: storyState.latestCommittedChapter,
    queueStatus: queueItems[0]!.status,
    queueStage: queueItems[0]!.currentStage,
    stale: false
  };
}

async function ownLock(
  lockPath: string,
  token: string
): Promise<ProjectOperationLease> {
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
  }, PROJECT_OPERATION_HEARTBEAT_MS);
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
        // Failed cleanup remains recoverable through stale-lock handling.
      }
    }
  };
}

async function recoverStaleLock(
  lockPath: string,
  token: string
): Promise<boolean> {
  try {
    const lockStat = await stat(lockPath);
    const ownerAlive = await isLockOwnerAlive(lockPath);
    if (
      ownerAlive !== false
      && Date.now() - lockStat.mtimeMs <= PROJECT_OPERATION_LOCK_STALE_MS
    ) {
      return false;
    }
    const stalePath = `${lockPath}.stale-${token}`;
    await rename(lockPath, stalePath);
    await rm(stalePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true;
    return false;
  }
}

async function isLockOwnerAlive(lockPath: string): Promise<boolean | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(lockPath, 'owner.json'), 'utf8')
    );
    if (
      typeof parsed !== 'object'
      || parsed === null
      || !('pid' in parsed)
      || typeof parsed.pid !== 'number'
      || !Number.isInteger(parsed.pid)
      || parsed.pid <= 0
    ) return null;
    try {
      process.kill(parsed.pid, 0);
      return true;
    } catch (error) {
      return hasCode(error, 'ESRCH') ? false : true;
    }
  } catch {
    return null;
  }
}

function staleOperationError(context: ProjectOperationContext): AppError {
  return new AppError(
    'PROJECT_OPERATION_STALE',
    'Project state changed while this operation was running.',
    2,
    {
      stage: context.operation,
      ...(context.chapter === undefined
        ? {}
        : { chapterNumber: context.chapter.chapterNumber })
    }
  );
}

function isWithinProject(projectRoot: string, filePath: string): boolean {
  const relative = path.relative(projectRoot, path.resolve(filePath));
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
