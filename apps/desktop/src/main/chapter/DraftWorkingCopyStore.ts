import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  open,
  rename,
  rm
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { z } from 'zod';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_RECORD_BYTES = MAX_MARKDOWN_BYTES * 6 + 64 * 1024;
const DEFAULT_DESCRIPTOR_ROOT = '/proc/self/fd';
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ProjectKeySchema = z.string().regex(/^project_[A-Za-z0-9_-]+$/u).max(96);

export const DraftWorkingCopyRecordSchema = z.object({
  schemaVersion: z.literal('1.0'),
  projectKey: ProjectKeySchema,
  chapterNumber: z.number().int().positive(),
  sourceHash: Sha256Schema,
  markdown: z.string().refine(
    (value) => Buffer.byteLength(value, 'utf8') <= MAX_MARKDOWN_BYTES,
    'Markdown exceeds the working-copy size limit.'
  ),
  savedAt: z.string().datetime({ offset: true })
}).strict();

export interface DraftWorkingCopyRecord extends z.infer<typeof DraftWorkingCopyRecordSchema> {}

export interface DraftWorkingCopySaveInput {
  projectKey: string;
  chapterNumber: number;
  sourceHash: string;
  markdown: string;
  savedAt: string;
}

export interface DraftWorkingCopyReadResult {
  recoveryAvailable: boolean;
  stale: boolean;
  markdown: string | null;
  savedAt: string | null;
}

export interface DraftWorkingCopyStoreOptions {
  replace?: (temporaryPath: string, targetPath: string) => Promise<void>;
  descriptorRoot?: string;
  setDirectoryMode?: (directory: FileHandle) => Promise<void>;
}

interface AnchoredDirectory {
  handle: FileHandle;
  handles: FileHandle[];
}

export class DraftWorkingCopyStore {
  private readonly replace: (temporaryPath: string, targetPath: string) => Promise<void>;
  private readonly descriptorRoot: string;
  private readonly setDirectoryMode: (directory: FileHandle) => Promise<void>;
  private readonly userDataRoot: string;
  private readonly operations = new Map<string, Promise<void>>();

  constructor(
    userDataRoot: string,
    options: DraftWorkingCopyStoreOptions = {}
  ) {
    this.userDataRoot = path.resolve(userDataRoot);
    this.replace = options.replace ?? rename;
    this.descriptorRoot = options.descriptorRoot ?? DEFAULT_DESCRIPTOR_ROOT;
    this.setDirectoryMode = options.setDirectoryMode
      ?? (async (directory) => directory.chmod(0o700));
  }

  async save(record: DraftWorkingCopySaveInput): Promise<void> {
    const parsed = parseRecord({ schemaVersion: '1.0', ...record });
    const serialized = serializeRecord(parsed);
    const operationKey = this.operationKey(parsed.projectKey, parsed.chapterNumber);
    await this.enqueue(operationKey, async () => {
      const directory = await this.openDirectory(
        parsed.projectKey,
        parsed.chapterNumber,
        true
      );
      if (directory === null) throw draftStoreError();
      const directoryPath = this.descriptorPath(directory.handle);
      const target = path.join(directoryPath, 'draft.json');
      const temporary = path.join(
        directoryPath,
        `draft.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
      );
      let temporaryCreated = false;
      try {
        await directory.handle.chmod(0o700);
        const temporaryHandle = await open(
          temporary,
          writeExclusiveFlags(),
          0o600
        );
        temporaryCreated = true;
        try {
          await temporaryHandle.chmod(0o600);
          await temporaryHandle.writeFile(serialized, 'utf8');
          await temporaryHandle.sync();
        } finally {
          await temporaryHandle.close();
        }
        await this.replace(temporary, target);
        temporaryCreated = false;
      } catch (error) {
        if (temporaryCreated) {
          await rm(temporary, { force: true }).catch(() => undefined);
        }
        throw error;
      } finally {
        await closeDirectory(directory);
      }
    });
  }

  async read(
    projectKey: string,
    chapterNumber: number,
    expectedSourceHash?: string
  ): Promise<DraftWorkingCopyReadResult> {
    const parsedProjectKey = ProjectKeySchema.parse(projectKey);
    const parsedChapterNumber = positiveChapter(chapterNumber);
    await this.operations.get(this.operationKey(parsedProjectKey, parsedChapterNumber))
      ?.catch(() => undefined);
    const directory = await this.openDirectory(
      parsedProjectKey,
      parsedChapterNumber,
      false
    );
    if (directory === null) return unavailable();
    const target = path.join(this.descriptorPath(directory.handle), 'draft.json');
    try {
      let text: string;
      try {
        text = await readBoundedText(target);
      } catch (error: unknown) {
        if (isMissing(error)) return unavailable();
        if (
          isUnsafeLink(error)
          || errorCode(error) === 'DRAFT_WORKING_COPY_OVERSIZED'
          || errorCode(error) === 'DRAFT_WORKING_COPY_INVALID_ENCODING'
        ) {
          await this.quarantine(target);
          return unavailable();
        }
        throw error;
      }

      let record: DraftWorkingCopyRecord;
      try {
        record = parseRecord(JSON.parse(text));
      } catch {
        await this.quarantine(target);
        return unavailable();
      }
      if (
        record.projectKey !== parsedProjectKey
        || record.chapterNumber !== parsedChapterNumber
      ) {
        await this.quarantine(target);
        return unavailable();
      }
      if (
        expectedSourceHash !== undefined
        && record.sourceHash !== Sha256Schema.parse(expectedSourceHash)
      ) {
        return {
          recoveryAvailable: true,
          stale: true,
          markdown: null,
          savedAt: record.savedAt
        };
      }
      return {
        recoveryAvailable: true,
        stale: false,
        markdown: record.markdown,
        savedAt: record.savedAt
      };
    } finally {
      await closeDirectory(directory);
    }
  }

  async discard(projectKey: string, chapterNumber: number): Promise<void> {
    const parsedProjectKey = ProjectKeySchema.parse(projectKey);
    const parsedChapterNumber = positiveChapter(chapterNumber);
    const operationKey = this.operationKey(parsedProjectKey, parsedChapterNumber);
    await this.enqueue(operationKey, async () => {
      const directory = await this.openDirectory(
        parsedProjectKey,
        parsedChapterNumber,
        false
      );
      if (directory === null) return;
      try {
        await rm(
          path.join(this.descriptorPath(directory.handle), 'draft.json'),
          { force: true }
        );
      } finally {
        await closeDirectory(directory);
      }
    });
  }

  async discardIfMatches(
    projectKey: string,
    chapterNumber: number,
    expectedSourceHash: string,
    expectedContentHash: string
  ): Promise<boolean> {
    const parsedProjectKey = ProjectKeySchema.parse(projectKey);
    const parsedChapterNumber = positiveChapter(chapterNumber);
    const sourceHash = Sha256Schema.parse(expectedSourceHash);
    const contentHash = Sha256Schema.parse(expectedContentHash);
    const operationKey = this.operationKey(parsedProjectKey, parsedChapterNumber);
    let discarded = false;
    await this.enqueue(operationKey, async () => {
      const directory = await this.openDirectory(
        parsedProjectKey,
        parsedChapterNumber,
        false
      );
      if (directory === null) return;
      const target = path.join(this.descriptorPath(directory.handle), 'draft.json');
      try {
        let record: DraftWorkingCopyRecord;
        try {
          record = parseRecord(JSON.parse(await readBoundedText(target)));
        } catch (error) {
          if (isMissing(error) || isUnsafeLink(error)) return;
          throw error;
        }
        if (
          record.projectKey !== parsedProjectKey
          || record.chapterNumber !== parsedChapterNumber
          || record.sourceHash !== sourceHash
          || sha256(record.markdown) !== contentHash
        ) return;
        await rm(target, { force: true });
        discarded = true;
      } finally {
        await closeDirectory(directory);
      }
    });
    return discarded;
  }

  private operationKey(projectKey: string, chapterNumber: number): string {
    return `${projectKey}:${chapterNumber}`;
  }

  private descriptorPath(directory: FileHandle): string {
    return path.join(this.descriptorRoot, String(directory.fd));
  }

  private async openDirectory(
    projectKey: string,
    chapterNumber: number,
    createMissing: boolean
  ): Promise<AnchoredDirectory | null> {
    const flags = directoryFlags();
    const handles: FileHandle[] = [];
    try {
      let current: FileHandle;
      try {
        current = await open(this.userDataRoot, flags);
      } catch (error) {
        if (!createMissing && isMissing(error)) return null;
        throw error;
      }
      handles.push(current);
      await this.verifyDescriptorRoot(current, flags);

      const segments = [
        'working-copies',
        projectKey,
        `chapter_${String(chapterNumber).padStart(3, '0')}`
      ];
      for (const segment of segments) {
        const childPath = path.join(this.descriptorPath(current), segment);
        let child: FileHandle;
        try {
          child = await open(childPath, flags);
        } catch (error) {
          if (!isMissing(error)) throw error;
          if (!createMissing) {
            await closeHandles(handles);
            return null;
          }
          await mkdir(childPath, { mode: 0o700 }).catch((mkdirError: unknown) => {
            if (!isAlreadyExists(mkdirError)) throw mkdirError;
          });
          child = await open(childPath, flags);
          handles.push(child);
          await this.setDirectoryMode(child);
        }
        if (!handles.includes(child)) handles.push(child);
        const metadata = await child.stat();
        if (!metadata.isDirectory()) {
          throw draftStoreError();
        }
        current = child;
      }
      return { handle: current, handles };
    } catch (error) {
      await closeHandles(handles);
      if (errorCode(error) === 'DRAFT_WORKING_COPY_UNAVAILABLE') throw error;
      throw draftStoreError();
    }
  }

  private async verifyDescriptorRoot(
    directory: FileHandle,
    flags: number
  ): Promise<void> {
    if (process.platform !== 'linux') throw draftStoreError();
    const original = await directory.stat();
    const probe = await open(
      `${this.descriptorPath(directory)}${path.sep}.`,
      flags
    );
    try {
      const anchored = await probe.stat();
      if (original.dev !== anchored.dev || original.ino !== anchored.ino) {
        throw draftStoreError();
      }
    } finally {
      await probe.close();
    }
  }

  private async quarantine(target: string): Promise<void> {
    const quarantine = `${target}.quarantine`;
    await rm(quarantine, { force: true });
    await rename(target, quarantine).catch(() => undefined);
  }

  private async enqueue(target: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.operations.get(target) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.operations.set(target, current);
    try {
      await current;
    } finally {
      if (this.operations.get(target) === current) this.operations.delete(target);
    }
  }
}

function parseRecord(value: unknown): DraftWorkingCopyRecord {
  try {
    return DraftWorkingCopyRecordSchema.parse(value);
  } catch (error) {
    const tagged = error instanceof Error
      ? error
      : new Error('Draft working copy is invalid.');
    throw Object.assign(tagged, { code: 'DRAFT_WORKING_COPY_INVALID' });
  }
}

function serializeRecord(record: DraftWorkingCopyRecord): string {
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) {
    throw Object.assign(new Error('Draft working copy exceeds the serialized size limit.'), {
      code: 'DRAFT_WORKING_COPY_INVALID'
    });
  }
  return serialized;
}

function positiveChapter(value: number): number {
  return z.number().int().positive().parse(value);
}

function unavailable(): DraftWorkingCopyReadResult {
  return { recoveryAvailable: false, stale: false, markdown: null, savedAt: null };
}

function directoryFlags(): number {
  if (
    process.platform !== 'linux'
    || typeof constants.O_DIRECTORY !== 'number'
    || typeof constants.O_NOFOLLOW !== 'number'
  ) throw draftStoreError();
  return constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
}

function writeExclusiveFlags(): number {
  if (typeof constants.O_NOFOLLOW !== 'number') throw draftStoreError();
  return constants.O_WRONLY
    | constants.O_CREAT
    | constants.O_EXCL
    | constants.O_NOFOLLOW;
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return errorCode(error) === 'EEXIST';
}

function isUnsafeLink(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ELOOP' || code === 'EMLINK';
}

function errorCode(error: unknown): string {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : '';
}

async function readBoundedText(target: string): Promise<string> {
  if (
    typeof constants.O_NOFOLLOW !== 'number'
    || typeof constants.O_NONBLOCK !== 'number'
  ) throw draftStoreError();
  const handle = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_RECORD_BYTES) {
      throw Object.assign(new Error('Draft working copy exceeds the size limit.'), {
        code: 'DRAFT_WORKING_COPY_OVERSIZED'
      });
    }
    const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_RECORD_BYTES) {
      throw Object.assign(new Error('Draft working copy exceeds the size limit.'), {
        code: 'DRAFT_WORKING_COPY_OVERSIZED'
      });
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        buffer.subarray(0, offset)
      );
    } catch {
      throw Object.assign(new Error('Draft working copy is not valid UTF-8.'), {
        code: 'DRAFT_WORKING_COPY_INVALID_ENCODING'
      });
    }
  } finally {
    await handle.close();
  }
}

async function closeDirectory(directory: AnchoredDirectory): Promise<void> {
  await closeHandles(directory.handles);
}

async function closeHandles(handles: FileHandle[]): Promise<void> {
  for (const handle of [...handles].reverse()) {
    await handle.close().catch(() => undefined);
  }
}

function draftStoreError(): Error & { code: string } {
  return Object.assign(new Error('Draft working copy is unavailable.'), {
    code: 'DRAFT_WORKING_COPY_UNAVAILABLE'
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
