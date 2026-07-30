import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn()
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electron.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: electron.invoke
  }
}));

const preloadPath = path.resolve('src/preload/index.ts');
const apiPath = path.resolve('src/shared/desktopApi.ts');

beforeEach(() => {
  electron.exposeInMainWorld.mockReset();
  electron.invoke.mockReset();
  vi.resetModules();
});

async function exposeApi(): Promise<NovelLoopDesktopApi> {
  await import('../../src/preload/index');
  const captured = electron.exposeInMainWorld.mock.calls[0];
  if (captured === undefined) {
    throw new Error('Expected preload to expose the desktop API.');
  }
  expect(captured[0]).toBe('novelLoop');
  return captured[1] as NovelLoopDesktopApi;
}

describe('typed preload boundary', () => {
  test('exposes exactly the seven named chapter methods', async () => {
    const api = await exposeApi();

    expect(Object.keys(api)).toEqual([
      'system',
      'projects',
      'foundation',
      'planning',
      'chapter'
    ]);
    expect(Object.keys(api.chapter)).toEqual([
      'inspect',
      'startPlanning',
      'startDrafting',
      'get',
      'cancel',
      'readPlan',
      'readDraft'
    ]);
  });

  test('uses the fixed chapter channels for every exposed chapter request', async () => {
    const api = await exposeApi();
    const projectRequest = { projectKey: 'project_radio' };
    const taskRequest = { taskId: 'chapter_0123456789abcdef' };

    await api.chapter.inspect(projectRequest);
    await api.chapter.startPlanning(projectRequest);
    await api.chapter.startDrafting(projectRequest);
    await api.chapter.get(taskRequest);
    await api.chapter.cancel(taskRequest);
    await api.chapter.readPlan(projectRequest);
    await api.chapter.readDraft(projectRequest);

    expect(electron.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.chapterInspect, projectRequest],
      [IPC_CHANNELS.chapterStartPlanning, projectRequest],
      [IPC_CHANNELS.chapterStartDrafting, projectRequest],
      [IPC_CHANNELS.chapterGet, taskRequest],
      [IPC_CHANNELS.chapterCancel, taskRequest],
      [IPC_CHANNELS.chapterReadPlan, projectRequest],
      [IPC_CHANNELS.chapterReadDraft, projectRequest]
    ]);
  });

  test('exposes no generic or privileged API capability', async () => {
    const api = await exposeApi();
    const forbidden = [
      'invoke',
      'send',
      'subscribe',
      'fs',
      'filesystem',
      'shell',
      'process',
      'codex'
    ];

    for (const surface of [api, api.chapter]) {
      for (const property of forbidden) {
        expect(surface).not.toHaveProperty(property);
      }
    }
  });

  test('contains no path, filesystem, shell, process, Codex, Node, or generic IPC surface', () => {
    const source = [
      readFileSync(preloadPath, 'utf8'),
      readFileSync(apiPath, 'utf8')
    ].join('\n');

    expect(source).not.toMatch(/node:fs|node:child_process|shell\.|execFile|spawn\(/);
    expect(source).not.toMatch(
      /codex\s+exec|execCodex|runCodex|storyState|writeFile|project(Path|Root)|rawJsonl|runId|codexBin/i
    );
    expect(source).not.toMatch(/node:|electron\/main|electron\/renderer/);
    expect(source).not.toMatch(/\b(process|fs|filesystem|shell|codex|send|invoke|subscribe)\s*:/i);
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
