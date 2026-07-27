import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const preloadPath = path.resolve('src/preload/index.ts');
const apiPath = path.resolve('src/shared/desktopApi.ts');

describe('typed preload boundary', () => {
  test('exposes one named Novel Loop API without exposing Electron primitives', () => {
    const preload = readFileSync(preloadPath, 'utf8');

    expect(preload).toContain("contextBridge.exposeInMainWorld('novelLoop'");
    expect(preload).toContain('system:');
    expect(preload).toContain('getReadiness:');
    expect(preload).toContain('IPC_CHANNELS.systemGetReadiness');
    expect(preload).not.toMatch(/ipcRenderer\.(send|sendSync|on|once|postMessage)/);
    expect(preload).not.toMatch(/invoke\s*\(\s*(channel|name|key|input)/);
  });

  test('contains no filesystem, shell, Codex, project-write, or generic IPC surface', () => {
    const source = [
      readFileSync(preloadPath, 'utf8'),
      readFileSync(apiPath, 'utf8')
    ].join('\n');

    expect(source).not.toMatch(/node:fs|node:child_process|shell\.|execFile|spawn\(/);
    expect(source).not.toMatch(
      /codex\s+exec|execCodex|runCodex|storyState|writeFile|projectPath|rawJsonl/i
    );
    expect(source).not.toMatch(/\b(send|invoke|subscribe)\s*:\s*\(/);
  });

  test('keeps sandboxed preload free of third-party runtime dependencies', () => {
    const preload = readFileSync(preloadPath, 'utf8');

    expect(preload).not.toContain('SystemReadinessSchema');
    expect(preload).not.toMatch(/from ['"]zod['"]/);
    expect(preload).toMatch(/import type \{ SystemReadiness \}/);
  });
});
