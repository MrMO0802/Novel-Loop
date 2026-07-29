import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const preloadPath = path.resolve('src/preload/index.ts');
const apiPath = path.resolve('src/shared/desktopApi.ts');

describe('typed preload boundary', () => {
  test('exposes only named system, project, foundation, and planning methods', () => {
    const preload = readFileSync(preloadPath, 'utf8');

    expect(preload).toContain("contextBridge.exposeInMainWorld('novelLoop'");
    expect(preload).toContain('system:');
    expect(preload).toContain('getReadiness:');
    expect(preload).toContain('IPC_CHANNELS.systemGetReadiness');
    expect(preload).toContain('projects:');
    expect(preload).toContain('list:');
    expect(preload).toContain('chooseDefaultLibrary:');
    expect(preload).toContain('create:');
    expect(preload).toContain('openExisting:');
    expect(preload).toContain('open:');
    expect(preload).toContain('remove:');
    expect(preload).toContain('IPC_CHANNELS.projectsList');
    expect(preload).toContain('IPC_CHANNELS.projectsChooseDefaultLibrary');
    expect(preload).toContain('IPC_CHANNELS.projectsCreate');
    expect(preload).toContain('IPC_CHANNELS.projectsOpenExisting');
    expect(preload).toContain('IPC_CHANNELS.projectsOpen');
    expect(preload).toContain('IPC_CHANNELS.projectsRemove');
    expect(preload).toContain('foundation:');
    expect(preload).toContain('start:');
    expect(preload).toContain('get:');
    expect(preload).toContain('cancel:');
    expect(preload).toContain('read:');
    expect(preload).toContain('IPC_CHANNELS.foundationStart');
    expect(preload).toContain('IPC_CHANNELS.foundationGet');
    expect(preload).toContain('IPC_CHANNELS.foundationCancel');
    expect(preload).toContain('IPC_CHANNELS.foundationRead');
    expect(preload).toContain('planning:');
    expect(preload).toContain('IPC_CHANNELS.planningStart');
    expect(preload).toContain('IPC_CHANNELS.planningGet');
    expect(preload).toContain('IPC_CHANNELS.planningCancel');
    expect(preload).toContain('IPC_CHANNELS.planningRead');
    expect(preload).not.toMatch(/ipcRenderer\.(send|sendSync|on|once|postMessage)/);
    expect(preload).not.toMatch(/invoke\s*\(\s*(channel|name|key|input)/);
  });

  test('contains no path, filesystem, shell, Codex, Node, or generic IPC surface', () => {
    const source = [
      readFileSync(preloadPath, 'utf8'),
      readFileSync(apiPath, 'utf8')
    ].join('\n');

    expect(source).not.toMatch(/node:fs|node:child_process|shell\.|execFile|spawn\(/);
    expect(source).not.toMatch(
      /codex\s+exec|execCodex|runCodex|storyState|writeFile|project(Path|Root)|rawJsonl|runId|codexBin/i
    );
    expect(source).not.toMatch(/node:|electron\/main|electron\/renderer/);
    expect(source).not.toMatch(/\b(send|invoke|subscribe)\s*:\s*\(/);
  });

  test('keeps sandboxed preload free of third-party runtime dependencies', () => {
    const preload = readFileSync(preloadPath, 'utf8');
    const runtimeImports = [...preload.matchAll(
      /^import (?!type\b).* from ['"]([^'"]+)['"];?$/gm
    )].map((match) => match[1]);

    expect(preload).not.toContain('SystemReadinessSchema');
    expect(preload).not.toMatch(/from ['"]zod['"]/);
    expect(preload).toMatch(/import type \{ SystemReadiness \}/);
    expect(runtimeImports).toEqual([
      'electron',
      '../shared/ipcChannels'
    ]);
  });
});
