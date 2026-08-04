import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import { ChapterQueueSchema, StoryStateSchema } from '../schemas/index.js';
import { AppError } from '../utils/AppError.js';

export const PROJECT_OPERATION_LOCK_NAME = '.novel-loop-build-bible.lock';

const PROJECT_OPERATION_LOCK_STALE_MS = 10 * 60 * 1000;
const PROJECT_OPERATION_OWNERLESS_GRACE_MS = 5 * 1000;
const PROJECT_OPERATION_HEARTBEAT_MS = 30 * 1000;
const STALE_RECOVERY_ATTEMPTS = 4;
const LOCK_OWNER_FILE = 'owner.json';
const LOCK_TRANSITION_CLAIM_FILE = 'transition-claim.json';
const MAX_LOCK_METADATA_BYTES = 8 * 1024;

const ProjectOperationLeaseOwnerSchema = z.object({
  token: z.string().uuid(),
  pid: z.number().int().positive(),
  processStartIdentity: z.string().min(1).max(128),
  acquiredAt: z.string().datetime({ offset: true })
}).strict();

const ProjectOperationLeaseClaimSchema = z.object({
  claimantToken: z.string().uuid(),
  observedOwnerToken: z.string().uuid().nullable(),
  observedDirectoryIdentity: z.string().min(1).max(128),
  claimedAt: z.string().datetime({ offset: true })
}).strict();

type ProjectOperationLeaseOwner = z.infer<typeof ProjectOperationLeaseOwnerSchema>;

interface LockObservation {
  directoryIdentity: string;
  mtimeMs: number;
  owner: ProjectOperationLeaseOwner | null;
  ownerText: string | null;
}

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
  const owner = await createLeaseOwner(token);

  for (let attempt = 0; attempt < STALE_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      return await publishOwnedLock(lockPath, owner);
    } catch (error) {
      if (!isLockExistsError(error)) throw error;
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

async function publishOwnedLock(
  lockPath: string,
  owner: ProjectOperationLeaseOwner
): Promise<ProjectOperationLease> {
  const candidatePath = `${lockPath}.candidate-${owner.token}`;
  let published = false;
  try {
    await mkdir(candidatePath, { mode: 0o700 });
    await writeLeaseOwner(candidatePath, owner);
    await rename(candidatePath, lockPath);
    published = true;
    const observation = await observeLock(lockPath);
    if (!isDeepStrictEqual(observation.owner, owner)) {
      throw new Error('Published project lease owner could not be verified.');
    }
    return ownLock(lockPath, owner, observation.directoryIdentity);
  } catch (error) {
    if (!published) await rm(candidatePath, { recursive: true, force: true });
    throw error;
  }
}

async function ownLock(
  lockPath: string,
  owner: ProjectOperationLeaseOwner,
  directoryIdentity: string
): Promise<ProjectOperationLease> {
  const heartbeat = setInterval(() => {
    void heartbeatOwnedLock(lockPath, owner, directoryIdentity);
  }, PROJECT_OPERATION_HEARTBEAT_MS);
  heartbeat.unref();
  let released = false;

  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      try {
        const observation = await observeLock(lockPath);
        if (
          observation.directoryIdentity !== directoryIdentity
          || !isDeepStrictEqual(observation.owner, owner)
        ) return;
        const claimed = await claimLockTransition(lockPath, observation, owner.token);
        if (!claimed) return;
        const releasedPath = `${lockPath}.released-${owner.token}`;
        await rename(lockPath, releasedPath);
        if ((await observeLock(releasedPath)).directoryIdentity === directoryIdentity) {
          await rm(releasedPath, { recursive: true, force: true });
        }
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
    const observation = await observeLock(lockPath);
    if (!(await mayRecoverLock(observation))) return false;
    if (!(await claimLockTransition(lockPath, observation, token))) return false;
    const stalePath = `${lockPath}.stale-${token}`;
    await rename(lockPath, stalePath);
    if ((await observeLock(stalePath)).directoryIdentity !== observation.directoryIdentity) {
      await rename(stalePath, lockPath).catch(() => undefined);
      return false;
    }
    await rm(stalePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true;
    return false;
  }
}

async function createLeaseOwner(token: string): Promise<ProjectOperationLeaseOwner> {
  const processStartIdentity = await readProcessStartIdentity(process.pid)
    ?? `runtime-start:${Math.max(0, Math.round(Date.now() - process.uptime() * 1000))}`;
  return ProjectOperationLeaseOwnerSchema.parse({
    token,
    pid: process.pid,
    processStartIdentity,
    acquiredAt: new Date().toISOString()
  });
}

async function writeLeaseOwner(
  candidatePath: string,
  owner: ProjectOperationLeaseOwner
): Promise<void> {
  const ownerPath = path.join(candidatePath, LOCK_OWNER_FILE);
  const ownerHandle = await open(
    ownerPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  );
  try {
    await ownerHandle.writeFile(`${JSON.stringify(owner)}\n`, { encoding: 'utf8' });
    await ownerHandle.sync();
  } finally {
    await ownerHandle.close();
  }
  const directoryHandle = await open(
    candidatePath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

async function heartbeatOwnedLock(
  lockPath: string,
  owner: ProjectOperationLeaseOwner,
  directoryIdentity: string
): Promise<void> {
  try {
    const observation = await observeLock(lockPath);
    if (
      observation.directoryIdentity !== directoryIdentity
      || !isDeepStrictEqual(observation.owner, owner)
    ) return;
    const now = new Date();
    await utimes(lockPath, now, now);
  } catch {
    // A lost lock is surfaced by the guarded project operation writes.
  }
}

async function observeLock(lockPath: string): Promise<LockObservation> {
  const lockStat = await stat(lockPath);
  let ownerText: string | null = null;
  let owner: ProjectOperationLeaseOwner | null = null;
  try {
    ownerText = await readFile(path.join(lockPath, LOCK_OWNER_FILE), 'utf8');
    if (Buffer.byteLength(ownerText, 'utf8') <= MAX_LOCK_METADATA_BYTES) {
      const parsed: unknown = JSON.parse(ownerText);
      const result = ProjectOperationLeaseOwnerSchema.safeParse(parsed);
      owner = result.success ? result.data : null;
    }
  } catch {
    ownerText = null;
  }
  return {
    directoryIdentity: `${lockStat.dev}:${lockStat.ino}`,
    mtimeMs: lockStat.mtimeMs,
    owner,
    ownerText
  };
}

async function mayRecoverLock(observation: LockObservation): Promise<boolean> {
  const ageMs = Date.now() - observation.mtimeMs;
  if (observation.owner === null) {
    return ageMs > PROJECT_OPERATION_OWNERLESS_GRACE_MS;
  }
  const ownerAlive = await isLockOwnerAlive(observation.owner);
  if (ownerAlive === true) return false;
  if (ownerAlive === false) return true;
  return ageMs > PROJECT_OPERATION_LOCK_STALE_MS;
}

async function isLockOwnerAlive(
  owner: ProjectOperationLeaseOwner
): Promise<boolean | null> {
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return hasCode(error, 'ESRCH') ? false : null;
  }
  if (process.platform !== 'linux') return null;
  if (!owner.processStartIdentity.startsWith('linux-proc-start:')) return null;
  const currentStartIdentity = await readProcessStartIdentity(owner.pid);
  return currentStartIdentity === null
    ? null
    : currentStartIdentity === owner.processStartIdentity;
}

async function readProcessStartIdentity(pid: number): Promise<string | null> {
  if (process.platform !== 'linux') return null;
  try {
    const processStat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const commandEnd = processStat.lastIndexOf(')');
    if (commandEnd < 0) return null;
    const fieldsFromState = processStat.slice(commandEnd + 2).trim().split(/\s+/u);
    const startTimeTicks = fieldsFromState[19];
    return startTimeTicks !== undefined && /^\d+$/u.test(startTimeTicks)
      ? `linux-proc-start:${startTimeTicks}`
      : null;
  } catch {
    return null;
  }
}

async function claimLockTransition(
  lockPath: string,
  observation: LockObservation,
  claimantToken: string
): Promise<boolean> {
  const claim = ProjectOperationLeaseClaimSchema.parse({
    claimantToken,
    observedOwnerToken: observation.owner?.token ?? null,
    observedDirectoryIdentity: observation.directoryIdentity,
    claimedAt: new Date().toISOString()
  });
  const claimPath = path.join(lockPath, LOCK_TRANSITION_CLAIM_FILE);
  try {
    await writeFile(claimPath, `${JSON.stringify(claim)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
  } catch (error) {
    if (hasCode(error, 'EEXIST') || hasCode(error, 'ENOENT')) return false;
    throw error;
  }

  try {
    const afterClaim = await observeLock(lockPath);
    if (
      afterClaim.directoryIdentity !== observation.directoryIdentity
      || afterClaim.ownerText !== observation.ownerText
    ) {
      await removeOwnTransitionClaim(claimPath, claimantToken);
      return false;
    }
    return true;
  } catch (error) {
    await removeOwnTransitionClaim(claimPath, claimantToken);
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

async function removeOwnTransitionClaim(
  claimPath: string,
  claimantToken: string
): Promise<void> {
  try {
    const text = await readFile(claimPath, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_LOCK_METADATA_BYTES) return;
    const parsed = ProjectOperationLeaseClaimSchema.parse(JSON.parse(text) as unknown);
    if (parsed.claimantToken === claimantToken) {
      await rm(claimPath, { force: true });
    }
  } catch {
    // A mismatched claim belongs to another transition and must be left alone.
  }
}

function isLockExistsError(error: unknown): boolean {
  return hasCode(error, 'EEXIST') || hasCode(error, 'ENOTEMPTY');
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
