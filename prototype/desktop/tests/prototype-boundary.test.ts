import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function sourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((entry) => {
    const absolute = path.join(root, entry);
    return statSync(absolute).isDirectory() ? sourceFiles(absolute) : [absolute];
  }).filter((file) => /\.(ts|tsx)$/.test(file));
}

describe('prototype boundary', () => {
  test('does not import production engine, Node, Electron, or Codex modules', () => {
    const forbidden = [
      /from ['"].*src\/app/,
      /from ['"].*src\/storage/,
      /from ['"].*src\/providers/,
      /node:fs/,
      /node:child_process/,
      /electron/,
      /codex exec/
    ];
    for (const file of sourceFiles(path.resolve('src'))) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbidden) expect(content, file).not.toMatch(pattern);
    }
  });
});
