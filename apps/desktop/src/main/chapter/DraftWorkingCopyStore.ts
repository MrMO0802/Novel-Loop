import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
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
    const temporary = path.join(directory, `draft.${process.pid}.${Date.now()}.tmp`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(temporary, JSON.stringify(parsed), { encoding: 'utf8', mode: 0o600 });
    try {
      await this.replace(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async read(
    projectKey: string,
    chapterNumber: number,
    expectedSourceHash?: string
  ): Promise<DraftWorkingCopyReadResult> {
    const directory = this.directoryFor(ProjectKeySchema.parse(projectKey), positiveChapter(chapterNumber));
    const target = path.join(directory, 'draft.json');
    let text: string;
    try {
      text = await readFile(target, 'utf8');
    } catch (error: unknown) {
      if (isMissing(error)) return unavailable();
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
    await rm(path.join(directory, 'draft.json'), { force: true });
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
