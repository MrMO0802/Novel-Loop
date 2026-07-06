import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(runtimeDir, '..', '..');

export function resolveBundledAssetPath(inputPath: string, defaultRelativeRoot: string): string {
  const absoluteInput = path.resolve(inputPath);
  if (existsSync(absoluteInput)) {
    return absoluteInput;
  }

  const defaultRoot = path.resolve(defaultRelativeRoot);
  const relativeFromDefault = path.relative(defaultRoot, absoluteInput);
  const isDefaultAssetPath =
    relativeFromDefault === '' || (!relativeFromDefault.startsWith('..') && !path.isAbsolute(relativeFromDefault));

  if (!isDefaultAssetPath) {
    return absoluteInput;
  }

  const bundledRoot = path.join(packageRoot, defaultRelativeRoot);
  const bundledCandidate = relativeFromDefault === '' ? bundledRoot : path.join(bundledRoot, relativeFromDefault);
  return existsSync(bundledCandidate) ? bundledCandidate : absoluteInput;
}

