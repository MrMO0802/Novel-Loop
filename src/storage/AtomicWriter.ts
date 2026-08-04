import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  appendFile,
  mkdir,
  open,
  rename,
  rm,
  writeFile,
  type FileHandle
} from 'node:fs/promises';
import path from 'node:path';

type Mkdir = (dirPath: string, options: { recursive: true }) => Promise<unknown>;
type WriteFile = (filePath: string, data: string, options: { encoding: BufferEncoding }) => Promise<void>;
type AppendFile = (filePath: string, data: string, options: { encoding: BufferEncoding }) => Promise<void>;
type Rename = (oldPath: string, newPath: string) => Promise<void>;
type Rm = (filePath: string, options: { force: true }) => Promise<void>;

export interface AtomicWriterFileSystem {
  mkdir: Mkdir;
  writeFile: WriteFile;
  appendFile: AppendFile;
  rename: Rename;
  rm: Rm;
}

export type AtomicWriterOverrides = Partial<AtomicWriterFileSystem>;
export type AtomicWriterPathGuard = (filePath: string) => Promise<void>;

export class AtomicWriter {
  private readonly fileSystem: AtomicWriterFileSystem;

  constructor(
    overrides: AtomicWriterOverrides = {},
    private readonly pathGuard?: AtomicWriterPathGuard,
    projectRoot?: string
  ) {
    this.fileSystem = {
      mkdir,
      writeFile,
      appendFile,
      rename,
      rm,
      ...overrides
    };
    this.projectRoot = projectRoot === undefined
      ? undefined
      : path.resolve(projectRoot);
  }

  private readonly projectRoot: string | undefined;

  async writeText(targetPath: string, content: string): Promise<void> {
    const resolvedTargetPath = path.resolve(targetPath);
    const targetDir = path.dirname(resolvedTargetPath);
    const tempPath = path.join(targetDir, this.createTempFileName(resolvedTargetPath));

    await this.pathGuard?.(resolvedTargetPath);
    await this.pathGuard?.(targetDir);

    if (this.canUseAnchoredProjectWrite(resolvedTargetPath)) {
      await this.ensureDirectoryAnchored(targetDir);
      await this.pathGuard?.(tempPath);
      await this.writeTextAnchored(
        resolvedTargetPath,
        path.basename(tempPath),
        content
      );
      return;
    }

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

  async appendText(targetPath: string, content: string): Promise<void> {
    const resolvedTargetPath = path.resolve(targetPath);
    const targetDir = path.dirname(resolvedTargetPath);

    await this.pathGuard?.(resolvedTargetPath);
    await this.pathGuard?.(targetDir);

    if (this.canUseAnchoredProjectWrite(resolvedTargetPath)) {
      await this.ensureDirectoryAnchored(targetDir);
      const handles = await this.openAnchoredDirectory(targetDir);
      try {
        const anchoredTarget = anchoredPath(
          handles[handles.length - 1]!,
          path.basename(resolvedTargetPath)
        );
        const targetHandle = await open(
          anchoredTarget,
          constants.O_WRONLY
            | constants.O_APPEND
            | constants.O_CREAT
            | constants.O_NOFOLLOW,
          0o600
        );
        try {
          await targetHandle.writeFile(content, { encoding: 'utf8' });
        } finally {
          await targetHandle.close();
        }
      } finally {
        await closeHandles(handles);
      }
      return;
    }

    await this.fileSystem.mkdir(targetDir, { recursive: true });
    await this.pathGuard?.(targetDir);
    await this.fileSystem.appendFile(
      resolvedTargetPath,
      content,
      { encoding: 'utf8' }
    );
  }

  async ensureDir(dirPath: string): Promise<void> {
    const resolvedDirPath = path.resolve(dirPath);
    await this.pathGuard?.(resolvedDirPath);

    if (this.canUseAnchoredProjectWrite(resolvedDirPath)) {
      await this.ensureDirectoryAnchored(resolvedDirPath);
      return;
    }

    await this.fileSystem.mkdir(resolvedDirPath, { recursive: true });
    await this.pathGuard?.(resolvedDirPath);
  }

  private canUseAnchoredProjectWrite(targetPath: string): boolean {
    return process.platform === 'linux'
      && this.projectRoot !== undefined
      && isWithin(this.projectRoot, targetPath);
  }

  private async writeTextAnchored(
    targetPath: string,
    tempFileName: string,
    content: string
  ): Promise<void> {
    const handles = await this.openAnchoredDirectory(path.dirname(targetPath));
    const directoryHandle = handles[handles.length - 1]!;
    const anchoredTempPath = anchoredPath(directoryHandle, tempFileName);
    const anchoredTargetPath = anchoredPath(
      directoryHandle,
      path.basename(targetPath)
    );
    try {
      const tempHandle = await open(
        anchoredTempPath,
        constants.O_WRONLY
          | constants.O_CREAT
          | constants.O_EXCL
          | constants.O_NOFOLLOW,
        0o600
      );
      try {
        await tempHandle.writeFile(content, { encoding: 'utf8' });
        await tempHandle.sync();
      } finally {
        await tempHandle.close();
      }
      await this.pathGuard?.(targetPath);
      await rename(anchoredTempPath, anchoredTargetPath);
      await directoryHandle.sync();
    } catch (error) {
      await rm(anchoredTempPath, { force: true });
      throw error;
    } finally {
      await closeHandles(handles);
    }
  }

  private async openAnchoredDirectory(targetDir: string): Promise<FileHandle[]> {
    return this.openAnchoredDirectorySegments(targetDir, false);
  }

  private async ensureDirectoryAnchored(targetDir: string): Promise<void> {
    const handles = await this.openAnchoredDirectorySegments(targetDir, true);
    await closeHandles(handles);
  }

  private async openAnchoredDirectorySegments(
    targetDir: string,
    createMissing: boolean
  ): Promise<FileHandle[]> {
    const projectRoot = this.projectRoot;
    if (projectRoot === undefined) {
      throw new Error('Anchored project writes require a project root.');
    }
    const relative = path.relative(projectRoot, targetDir);
    if (!isWithin(projectRoot, targetDir)) {
      throw new Error('Anchored project write escaped the project root.');
    }

    const handles: FileHandle[] = [];
    try {
      let current = await openDirectoryNoFollow(projectRoot);
      handles.push(current);
      for (const segment of relative.split(path.sep).filter(Boolean)) {
        const nextPath = anchoredPath(current, segment);
        try {
          current = await openDirectoryNoFollow(nextPath);
        } catch (error) {
          if (!createMissing || !hasCode(error, 'ENOENT')) {
            throw error;
          }
          try {
            await mkdir(nextPath, { mode: 0o700 });
          } catch (mkdirError) {
            if (!hasCode(mkdirError, 'EEXIST')) {
              throw mkdirError;
            }
          }
          current = await openDirectoryNoFollow(nextPath);
        }
        handles.push(current);
      }
      return handles;
    } catch (error) {
      await closeHandles(handles);
      throw error;
    }
  }

  private createTempFileName(targetPath: string): string {
    const suffix = randomBytes(4).toString('hex');
    return `${path.basename(targetPath)}.${process.pid}.${Date.now()}.${suffix}.tmp`;
  }
}

async function openDirectoryNoFollow(directoryPath: string): Promise<FileHandle> {
  return open(
    directoryPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
}

function anchoredPath(directoryHandle: FileHandle, fileName: string): string {
  return path.join('/proc/self/fd', String(directoryHandle.fd), fileName);
}

async function closeHandles(handles: FileHandle[]): Promise<void> {
  await Promise.all(handles.reverse().map(async (handle) => {
    await handle.close().catch(() => undefined);
  }));
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== '..'
      && !path.isAbsolute(relative));
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
