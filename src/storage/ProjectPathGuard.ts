import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../utils/AppError.js';

export class ProjectPathGuard {
  readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  async assertSafePath(candidatePath: string): Promise<void> {
    const resolvedCandidate = path.resolve(candidatePath);
    if (!isWithin(this.projectRoot, resolvedCandidate)) {
      throw unsafePath();
    }

    const rootStat = await lstat(this.projectRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw unsafePath();
    }
    const canonicalRoot = await realpath(this.projectRoot);
    const relative = path.relative(this.projectRoot, resolvedCandidate);
    let current = this.projectRoot;

    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const currentStat = await lstat(current);
        if (currentStat.isSymbolicLink()) throw unsafePath();
        if (!isWithin(canonicalRoot, await realpath(current))) {
          throw unsafePath();
        }
      } catch (error) {
        if (hasCode(error, 'ENOENT')) return;
        throw error;
      }
    }
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== '..'
      && !path.isAbsolute(relative));
}

function unsafePath(): AppError {
  return new AppError(
    'DESKTOP_PROJECT_UNSAFE_PATH',
    'A project artifact path is not a safe regular descendant of the project directory.',
    2
  );
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
