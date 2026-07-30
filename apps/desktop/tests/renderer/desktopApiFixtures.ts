import { vi } from 'vitest';

import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';

export function createInertChapterApi(): NovelLoopDesktopApi['chapter'] {
  return {
    inspect: vi.fn<NovelLoopDesktopApi['chapter']['inspect']>(),
    startPlanning: vi.fn<NovelLoopDesktopApi['chapter']['startPlanning']>(),
    startDrafting: vi.fn<NovelLoopDesktopApi['chapter']['startDrafting']>(),
    get: vi.fn<NovelLoopDesktopApi['chapter']['get']>(),
    cancel: vi.fn<NovelLoopDesktopApi['chapter']['cancel']>(),
    readPlan: vi.fn<NovelLoopDesktopApi['chapter']['readPlan']>(),
    readDraft: vi.fn<NovelLoopDesktopApi['chapter']['readDraft']>()
  };
}
