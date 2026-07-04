import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface FileMetadata {
  sha256: string;
  sizeBytes: number;
  modifiedAt: string;
  createdAt: string;
}

export async function readFileMetadata(filePath: string, fileStore = new FileStore()): Promise<FileMetadata> {
  const [content, stats] = await Promise.all([fileStore.readText(filePath), stat(path.resolve(filePath))]);
  return {
    sha256: createHash('sha256').update(content).digest('hex'),
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    createdAt: stats.birthtime.toISOString()
  };
}

export function toProjectRelativePath(paths: ProjectPaths, absolutePath: string): string {
  return path.relative(paths.projectRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

export function formatChapterDir(chapterNumber: number): string {
  return `chapter_${String(chapterNumber).padStart(3, '0')}`;
}
