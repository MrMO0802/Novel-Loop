import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Mkdir = (dirPath: string, options: { recursive: true }) => Promise<unknown>;
type WriteFile = (filePath: string, data: string, options: { encoding: BufferEncoding }) => Promise<void>;
type Rename = (oldPath: string, newPath: string) => Promise<void>;
type Rm = (filePath: string, options: { force: true }) => Promise<void>;

export interface AtomicWriterFileSystem {
  mkdir: Mkdir;
  writeFile: WriteFile;
  rename: Rename;
  rm: Rm;
}

export type AtomicWriterOverrides = Partial<AtomicWriterFileSystem>;
export type AtomicWriterPathGuard = (filePath: string) => Promise<void>;

export class AtomicWriter {
  private readonly fileSystem: AtomicWriterFileSystem;

  constructor(
    overrides: AtomicWriterOverrides = {},
    private readonly pathGuard?: AtomicWriterPathGuard
  ) {
    this.fileSystem = {
      mkdir,
      writeFile,
      rename,
      rm,
      ...overrides
    };
  }

  async writeText(targetPath: string, content: string): Promise<void> {
    const resolvedTargetPath = path.resolve(targetPath);
    const targetDir = path.dirname(resolvedTargetPath);
    const tempPath = path.join(targetDir, this.createTempFileName(resolvedTargetPath));

    await this.pathGuard?.(resolvedTargetPath);
    await this.pathGuard?.(targetDir);
    await this.fileSystem.mkdir(targetDir, { recursive: true });
    await this.pathGuard?.(targetDir);

    try {
      await this.pathGuard?.(tempPath);
      await this.fileSystem.writeFile(tempPath, content, { encoding: 'utf8' });
      await this.pathGuard?.(tempPath);
      await this.pathGuard?.(resolvedTargetPath);
      await this.fileSystem.rename(tempPath, resolvedTargetPath);
    } catch (error) {
      await this.fileSystem.rm(tempPath, { force: true });
      throw error;
    }
  }

  private createTempFileName(targetPath: string): string {
    const suffix = randomBytes(4).toString('hex');
    return `${path.basename(targetPath)}.${process.pid}.${Date.now()}.${suffix}.tmp`;
  }
}
