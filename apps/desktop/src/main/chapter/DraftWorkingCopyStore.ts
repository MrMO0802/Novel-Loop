import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_RECORD_BYTES = MAX_MARKDOWN_BYTES + 16 * 1024;
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
}

export class DraftWorkingCopyStore {
  private readonly replace: (temporaryPath: string, targetPath: string) => Promise<void>;
  private readonly operations = new Map<string, Promise<void>>();

  constructor(
    private readonly userDataRoot: string,
    options: DraftWorkingCopyStoreOptions = {}
  ) {
    this.replace = options.replace ?? rename;
  }

  async save(record: DraftWorkingCopySaveInput): Promise<void> {
    const parsed = parseRecord({ schemaVersion: '1.0', ...record });
    const directory = this.directoryFor(parsed.projectKey, parsed.chapterNumber);
    const target = path.join(directory, 'draft.json');
    await this.enqueue(target, async () => {
      const temporary = path.join(
        directory,
        `draft.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
      );
      await this.ensureSafeDirectory(directory, true);
      await chmod(directory, 0o700);
      await writeFile(temporary, JSON.stringify(parsed), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
      try {
        await this.replace(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  async read(
    projectKey: string,
    chapterNumber: number,
    expectedSourceHash?: string
  ): Promise<DraftWorkingCopyReadResult> {
    const directory = this.directoryFor(ProjectKeySchema.parse(projectKey), positiveChapter(chapterNumber));
    const target = path.join(directory, 'draft.json');
    await this.operations.get(target)?.catch(() => undefined);
    if (!(await this.ensureSafeDirectory(directory, false))) return unavailable();
    let text: string;
    try {
      const metadata = await lstat(target);
      if (
        metadata.isSymbolicLink()
        || !metadata.isFile()
        || metadata.size > MAX_RECORD_BYTES
      ) {
        await this.quarantine(target);
        return unavailable();
      }
      text = await readBoundedText(target);
    } catch (error: unknown) {
      if (isMissing(error)) return unavailable();
      if (isUnsafeLink(error)) {
        await this.quarantine(target);
        return unavailable();
      }
      if (errorCode(error) === 'DRAFT_WORKING_COPY_OVERSIZED') {
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
    if (record.projectKey !== projectKey || record.chapterNumber !== chapterNumber) {
      await this.quarantine(target);
      return unavailable();
    }
    if (expectedSourceHash !== undefined && record.sourceHash !== Sha256Schema.parse(expectedSourceHash)) {
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
  }

  async discard(projectKey: string, chapterNumber: number): Promise<void> {
    const directory = this.directoryFor(ProjectKeySchema.parse(projectKey), positiveChapter(chapterNumber));
    const target = path.join(directory, 'draft.json');
    await this.enqueue(target, async () => {
      if (!(await this.ensureSafeDirectory(directory, false))) return;
      const metadata = await lstat(target).catch((error: unknown) => (
        isMissing(error) ? null : Promise.reject(error)
      ));
      if (metadata?.isSymbolicLink()) {
        await this.quarantine(target);
        return;
      }
      await rm(target, { force: true });
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
    const directory = this.directoryFor(parsedProjectKey, parsedChapterNumber);
    const target = path.join(directory, 'draft.json');
    let discarded = false;
    await this.enqueue(target, async () => {
      if (!(await this.ensureSafeDirectory(directory, false))) return;
      let record: DraftWorkingCopyRecord;
      try {
        const metadata = await lstat(target);
        if (metadata.isSymbolicLink() || !metadata.isFile()) return;
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
    });
    return discarded;
  }

  private directoryFor(projectKey: string, chapterNumber: number): string {
    return path.join(
      this.userDataRoot,
      'working-copies',
      projectKey,
      `chapter_${String(chapterNumber).padStart(3, '0')}`
    );
  }

  private async quarantine(target: string): Promise<void> {
    await rm(`${target}.quarantine`, { force: true });
    await rename(target, `${target}.quarantine`).catch(() => undefined);
  }

  private async ensureSafeDirectory(
    directory: string,
    createMissing: boolean
  ): Promise<boolean> {
    const root = path.resolve(this.userDataRoot);
    const resolved = path.resolve(directory);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw draftStoreError();
    }
    const rootMetadata = await lstat(root).catch(async (error: unknown) => {
      if (!isMissing(error) || !createMissing) return null;
      await mkdir(root, { mode: 0o700 });
      return lstat(root);
    });
    if (rootMetadata === null) return false;
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
      throw draftStoreError();
    }

    let current = root;
    for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const metadata = await lstat(current).catch(async (error: unknown) => {
        if (!isMissing(error) || !createMissing) return null;
        await mkdir(current, { mode: 0o700 });
        return lstat(current);
      });
      if (metadata === null) return false;
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw draftStoreError();
    }
    return true;
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

function positiveChapter(value: number): number {
  return z.number().int().positive().parse(value);
}

function unavailable(): DraftWorkingCopyReadResult {
  return { recoveryAvailable: false, stale: false, markdown: null, savedAt: null };
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}

function isUnsafeLink(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 'ELOOP' || error.code === 'EMLINK');
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
  const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(target, constants.O_RDONLY | noFollow);
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
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close();
  }
}

function draftStoreError(): Error {
  return Object.assign(new Error('Draft working copy is unavailable.'), {
    code: 'DRAFT_WORKING_COPY_UNAVAILABLE'
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
