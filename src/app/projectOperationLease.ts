import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  link,
  lstat,
  open,
  readFile,
  rename,
  rm
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
const LOCK_TRANSITION_CLAIM_SUFFIX = '.transition-claim';
const MAX_LOCK_METADATA_BYTES = 8 * 1024;
const ABANDONED_BOOT_ID = '00000000-0000-4000-8000-000000000000';

const ProjectOperationLeaseOwnerSchema = z.object({
  token: z.string().uuid(),
  pid: z.number().int().positive(),
  processStartIdentity: z.string().min(1).max(128),
  bootId: z.string().min(1).max(128),
  acquiredAt: z.string().datetime({ offset: true })
}).strict();

const ProjectOperationLeaseClaimSchema = z.object({
  claimant: ProjectOperationLeaseOwnerSchema,
  observedOwnerToken: z.string().uuid().nullable(),
  observedLockIdentity: z.string().min(1).max(128),
  claimedAt: z.string().datetime({ offset: true })
}).strict();

type ProjectOperationLeaseOwner = z.infer<typeof ProjectOperationLeaseOwnerSchema>;
type ProjectOperationLeaseClaim = z.infer<typeof ProjectOperationLeaseClaimSchema>;

interface LockObservation {
  lockIdentity: string;
  kind: 'regular' | 'legacy_directory' | 'unsafe';
  mtimeMs: number;
  owner: ProjectOperationLeaseOwner | null;
  ownerText: string | null;
}

interface TransitionClaimObservation {
  claimIdentity: string;
  mtimeMs: number;
  claim: ProjectOperationLeaseClaim | null;
  claimText: string | null;
}

interface TransitionClaimHandle {
  claimPath: string;
  claimIdentity: string;
  claim: ProjectOperationLeaseClaim;
  release(): Promise<void>;
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
      if (!(await recoverStaleLock(lockPath, owner))) {
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
  let candidateIdentity: string | null = null;
  try {
    candidateIdentity = await writeMetadataCandidate(candidatePath, owner);
    await link(candidatePath, lockPath);
    await syncParentDirectory(lockPath);
    const observation = await observeLock(lockPath);
    if (
      observation.kind !== 'regular'
      || observation.lockIdentity !== candidateIdentity
      || !isDeepStrictEqual(observation.owner, owner)
    ) {
      throw new Error('Published project lease owner could not be verified.');
    }
    await rm(candidatePath, { force: true });
    await syncParentDirectory(candidatePath);
    return ownLock(lockPath, owner, observation.lockIdentity);
  } catch (error) {
    if (candidateIdentity !== null) {
      const removed = await removeExactPath(
        lockPath,
        candidateIdentity,
        `publication-failed-${owner.token}`
      ).catch(() => false);
      if (!removed && await pathHasIdentity(lockPath, candidateIdentity)) {
        await rewriteMetadataCandidate(candidatePath, candidateIdentity, {
          ...owner,
          bootId: ABANDONED_BOOT_ID
        }).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    await rm(candidatePath, { force: true }).catch(() => undefined);
  }
}

async function ownLock(
  lockPath: string,
  owner: ProjectOperationLeaseOwner,
  lockIdentity: string
): Promise<ProjectOperationLease> {
  const heartbeat = setInterval(() => {
    void heartbeatOwnedLock(lockPath, owner, lockIdentity);
  }, PROJECT_OPERATION_HEARTBEAT_MS);
  heartbeat.unref();
  let released = false;
  let releaseAttempt: Promise<void> | null = null;

  function finishRelease(): void {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
  }

  return {
    async release(): Promise<void> {
      if (released) return;
      if (releaseAttempt !== null) return releaseAttempt;
      releaseAttempt = (async () => {
        let observation: LockObservation;
        try {
          observation = await observeLock(lockPath);
        } catch (error) {
          if (hasCode(error, 'ENOENT')) {
            finishRelease();
            return;
          }
          throw error;
        }
        if (
          observation.lockIdentity !== lockIdentity
          || !isDeepStrictEqual(observation.owner, owner)
        ) {
          finishRelease();
          return;
        }
        const claim = await claimLockTransition(lockPath, observation, owner);
        if (claim === null) {
          throw new AppError(
            'PROJECT_OPERATION_LOCKED',
            'Project operation lease release is already in transition.',
            2
          );
        }
        const releasedPath = `${lockPath}.released-${owner.token}-${randomUUID()}`;
        try {
          await rename(lockPath, releasedPath);
          await syncParentDirectory(lockPath);
          const moved = await observeLock(releasedPath);
          if (moved.lockIdentity !== lockIdentity) {
            await rename(releasedPath, lockPath).catch(() => undefined);
            throw new Error('Released project lease identity changed during transition.');
          }
          await claim.release();
          finishRelease();
          await rm(releasedPath, { recursive: true, force: true });
          await syncParentDirectory(releasedPath);
        } catch (error) {
          await claim.release().catch(() => undefined);
          throw error;
        }
      })().finally(() => {
        releaseAttempt = null;
      });
      return releaseAttempt;
    }
  };
}

async function recoverStaleLock(
  lockPath: string,
  claimant: ProjectOperationLeaseOwner
): Promise<boolean> {
  try {
    const observation = await observeLock(lockPath);
    if (!(await mayRecoverLock(observation))) return false;
    const claim = await claimLockTransition(lockPath, observation, claimant);
    if (claim === null) return false;
    const stalePath = `${lockPath}.stale-${claimant.token}-${randomUUID()}`;
    try {
      await rename(lockPath, stalePath);
      await syncParentDirectory(lockPath);
      if ((await observeLock(stalePath)).lockIdentity !== observation.lockIdentity) {
        await rename(stalePath, lockPath).catch(() => undefined);
        return false;
      }
      await rm(stalePath, { recursive: true, force: true });
      await syncParentDirectory(stalePath);
      return true;
    } finally {
      await claim.release().catch(() => undefined);
    }
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true;
    return false;
  }
}

async function createLeaseOwner(token: string): Promise<ProjectOperationLeaseOwner> {
  const linuxBootId = await readLinuxBootId();
  const linuxProcessStart = await readProcessStartIdentity(process.pid);
  if (process.platform === 'linux' && (linuxBootId === null || linuxProcessStart === null)) {
    throw new AppError(
      'PROJECT_OPERATION_LOCK_UNAVAILABLE',
      'The local process identity required for a safe project lease is unavailable.',
      2
    );
  }
  const runtimeStart = Math.max(0, Math.round(Date.now() - process.uptime() * 1000));
  return ProjectOperationLeaseOwnerSchema.parse({
    token,
    pid: process.pid,
    processStartIdentity: linuxProcessStart ?? `runtime-start:${runtimeStart}`,
    bootId: linuxBootId ?? `runtime-boot:${runtimeStart}`,
    acquiredAt: new Date().toISOString()
  });
}

async function writeMetadataCandidate(
  candidatePath: string,
  value: ProjectOperationLeaseOwner | ProjectOperationLeaseClaim
): Promise<string> {
  const handle = await open(
    candidatePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, { encoding: 'utf8' });
    await handle.sync();
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Project lease metadata candidate is not regular.');
    return nodeIdentity(metadata);
  } finally {
    await handle.close();
  }
}

async function heartbeatOwnedLock(
  lockPath: string,
  owner: ProjectOperationLeaseOwner,
  lockIdentity: string
): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      lockPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const metadata = await handle.stat();
    if (!metadata.isFile() || nodeIdentity(metadata) !== lockIdentity) return;
    const parsed = await readMetadataFromHandle(handle, ProjectOperationLeaseOwnerSchema);
    if (
      parsed.value === null
      || !isDeepStrictEqual(parsed.value, owner)
    ) return;
    await handle.utimes(new Date(), new Date());
  } catch {
    // A lost lock is surfaced by the guarded project operation writes.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function observeLock(lockPath: string): Promise<LockObservation> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      lockPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const lockStat = await handle.stat();
    if (lockStat.isFile()) {
      const parsed = await readMetadataFromHandle(handle, ProjectOperationLeaseOwnerSchema);
      return {
        lockIdentity: nodeIdentity(lockStat),
        kind: 'regular',
        mtimeMs: lockStat.mtimeMs,
        owner: parsed.value,
        ownerText: parsed.text
      };
    }
    if (lockStat.isDirectory()) {
      const parsed = process.platform === 'linux'
        ? await readMetadataAtPath(
            `/proc/self/fd/${handle.fd}/${LOCK_OWNER_FILE}`,
            ProjectOperationLeaseOwnerSchema
          )
        : { text: null, value: null };
      return {
        lockIdentity: nodeIdentity(lockStat),
        kind: 'legacy_directory',
        mtimeMs: lockStat.mtimeMs,
        owner: parsed.value,
        ownerText: parsed.text
      };
    }
    return {
      lockIdentity: nodeIdentity(lockStat),
      kind: 'unsafe',
      mtimeMs: lockStat.mtimeMs,
      owner: null,
      ownerText: null
    };
  } catch (error) {
    if (!hasCode(error, 'ELOOP')) throw error;
    const metadata = await lstat(lockPath);
    return {
      lockIdentity: nodeIdentity(metadata),
      kind: 'unsafe',
      mtimeMs: metadata.mtimeMs,
      owner: null,
      ownerText: null
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
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
  if (process.platform === 'linux') {
    const currentBootId = await readLinuxBootId();
    if (currentBootId === null) return null;
    if (currentBootId !== owner.bootId) return false;
  }
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

async function readLinuxBootId(): Promise<string | null> {
  if (process.platform !== 'linux') return null;
  try {
    const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(bootId)
      ? bootId
      : null;
  } catch {
    return null;
  }
}

async function claimLockTransition(
  lockPath: string,
  observation: LockObservation,
  claimant: ProjectOperationLeaseOwner
): Promise<TransitionClaimHandle | null> {
  const claimPath = `${lockPath}${LOCK_TRANSITION_CLAIM_SUFFIX}`;
  const claim = ProjectOperationLeaseClaimSchema.parse({
    claimant,
    observedOwnerToken: observation.owner?.token ?? null,
    observedLockIdentity: observation.lockIdentity,
    claimedAt: new Date().toISOString()
  });

  for (let attempt = 0; attempt < STALE_RECOVERY_ATTEMPTS; attempt += 1) {
    let handle: TransitionClaimHandle;
    try {
      handle = await publishTransitionClaim(claimPath, claim);
    } catch (error) {
      if (!isLockExistsError(error)) throw error;
      if (await recoverStaleTransitionClaim(claimPath)) continue;
      return null;
    }
    try {
      const [afterClaim, observedClaim] = await Promise.all([
        observeLock(lockPath),
        observeTransitionClaim(claimPath)
      ]);
      if (
        afterClaim.lockIdentity !== observation.lockIdentity
        || afterClaim.ownerText !== observation.ownerText
        || observedClaim === null
        || observedClaim.claimIdentity !== handle.claimIdentity
        || !isDeepStrictEqual(observedClaim.claim, claim)
      ) {
        await handle.release();
        return null;
      }
      return handle;
    } catch (error) {
      await handle.release().catch(() => undefined);
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
  }
  return null;
}

async function publishTransitionClaim(
  claimPath: string,
  claim: ProjectOperationLeaseClaim
): Promise<TransitionClaimHandle> {
  const candidatePath = `${claimPath}.candidate-${claim.claimant.token}-${randomUUID()}`;
  let candidateIdentity: string | null = null;
  try {
    candidateIdentity = await writeMetadataCandidate(candidatePath, claim);
    await link(candidatePath, claimPath);
    await syncParentDirectory(claimPath);
    const observed = await observeTransitionClaim(claimPath);
    if (
      observed === null
      || observed.claimIdentity !== candidateIdentity
      || !isDeepStrictEqual(observed.claim, claim)
    ) {
      throw new Error('Published project lease transition claim could not be verified.');
    }
    await rm(candidatePath, { force: true });
    const publishedIdentity = candidateIdentity;
    return {
      claimPath,
      claimIdentity: publishedIdentity,
      claim,
      async release(): Promise<void> {
        await removeExactPath(
          claimPath,
          publishedIdentity,
          `claim-finished-${claim.claimant.token}`
        );
      }
    };
  } catch (error) {
    if (candidateIdentity !== null) {
      const removed = await removeExactPath(
        claimPath,
        candidateIdentity,
        `claim-publication-failed-${claim.claimant.token}`
      ).catch(() => false);
      if (!removed && await pathHasIdentity(claimPath, candidateIdentity)) {
        await rewriteMetadataCandidate(candidatePath, candidateIdentity, {
          ...claim,
          claimant: {
            ...claim.claimant,
            bootId: ABANDONED_BOOT_ID
          }
        }).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    await rm(candidatePath, { force: true }).catch(() => undefined);
  }
}

async function recoverStaleTransitionClaim(claimPath: string): Promise<boolean> {
  const observation = await observeTransitionClaim(claimPath).catch((error: unknown) => {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  });
  if (observation === null) return true;
  const ageMs = Date.now() - (
    observation.claim === null
      ? observation.mtimeMs
      : Date.parse(observation.claim.claimedAt)
  );
  if (observation.claim !== null) {
    const alive = await isLockOwnerAlive(observation.claim.claimant);
    if (alive === true) return false;
    if (alive === null && ageMs <= PROJECT_OPERATION_LOCK_STALE_MS) return false;
  } else if (ageMs <= PROJECT_OPERATION_OWNERLESS_GRACE_MS) {
    return false;
  }
  const removed = await removeExactPath(
    claimPath,
    observation.claimIdentity,
    `stale-claim-${randomUUID()}`
  );
  return removed || !(await pathExistsNoFollow(claimPath));
}

async function observeTransitionClaim(
  claimPath: string
): Promise<TransitionClaimObservation | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      claimPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const metadata = await handle.stat();
    const parsed = metadata.isFile()
      ? await readMetadataFromHandle(handle, ProjectOperationLeaseClaimSchema)
      : { text: null, value: null };
    return {
      claimIdentity: nodeIdentity(metadata),
      mtimeMs: metadata.mtimeMs,
      claim: parsed.value,
      claimText: parsed.text
    };
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    if (!hasCode(error, 'ELOOP')) throw error;
    const metadata = await lstat(claimPath);
    return {
      claimIdentity: nodeIdentity(metadata),
      mtimeMs: metadata.mtimeMs,
      claim: null,
      claimText: null
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readMetadataAtPath<T>(
  filePath: string,
  schema: z.ZodType<T>
): Promise<{ text: string | null; value: T | null }> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const metadata = await handle.stat();
    if (!metadata.isFile()) return { text: null, value: null };
    return await readMetadataFromHandle(handle, schema);
  } catch {
    return { text: null, value: null };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readMetadataFromHandle<T>(
  handle: Awaited<ReturnType<typeof open>>,
  schema: z.ZodType<T>
): Promise<{ text: string | null; value: T | null }> {
  const metadata = await handle.stat();
  if (!metadata.isFile() || metadata.size > MAX_LOCK_METADATA_BYTES) {
    return { text: null, value: null };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= MAX_LOCK_METADATA_BYTES) {
    const chunk = Buffer.alloc(Math.min(1024, MAX_LOCK_METADATA_BYTES + 1 - total));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > MAX_LOCK_METADATA_BYTES) return { text: null, value: null };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return { text: null, value: null };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const result = schema.safeParse(parsed);
    return { text, value: result.success ? result.data : null };
  } catch {
    return { text, value: null };
  }
}

async function removeExactPath(
  sourcePath: string,
  expectedIdentity: string,
  reason: string
): Promise<boolean> {
  let metadata;
  try {
    metadata = await lstat(sourcePath);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
  if (nodeIdentity(metadata) !== expectedIdentity) return false;
  const quarantinedPath = `${sourcePath}.${reason}-${randomUUID()}`;
  await rename(sourcePath, quarantinedPath);
  await syncParentDirectory(sourcePath);
  const moved = await lstat(quarantinedPath);
  if (nodeIdentity(moved) !== expectedIdentity) {
    await rename(quarantinedPath, sourcePath).catch(() => undefined);
    return false;
  }
  await rm(quarantinedPath, { recursive: true, force: true });
  await syncParentDirectory(quarantinedPath);
  return true;
}

async function rewriteMetadataCandidate(
  candidatePath: string,
  expectedIdentity: string,
  value: ProjectOperationLeaseOwner | ProjectOperationLeaseClaim
): Promise<void> {
  const handle = await open(
    candidatePath,
    constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || nodeIdentity(metadata) !== expectedIdentity) return;
    await handle.truncate(0);
    await handle.writeFile(`${JSON.stringify(value)}\n`, { encoding: 'utf8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncParentDirectory(filePath: string): Promise<void> {
  const handle = await open(
    path.dirname(filePath),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function pathExistsNoFollow(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

async function pathHasIdentity(filePath: string, expectedIdentity: string): Promise<boolean> {
  try {
    return nodeIdentity(await lstat(filePath)) === expectedIdentity;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function nodeIdentity(metadata: { dev: number | bigint; ino: number | bigint }): string {
  return `${metadata.dev}:${metadata.ino}`;
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
