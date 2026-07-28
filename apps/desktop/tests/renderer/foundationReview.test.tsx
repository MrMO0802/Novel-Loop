// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { App } from '../../src/renderer/src/App';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import type { ProjectSummary } from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';

const projectKey = 'project_0123456789abcdef01234567';
const readiness: SystemReadiness = {
  app: { name: 'Novel Loop', platform: 'linux', version: '0.1.0' },
  checkedAt: '2026-07-28T01:00:00.000Z',
  codex: { canRunSmoke: true, status: 'ready', summary: '已准备好。', version: null }
};
const project: ProjectSummary = {
  projectKey,
  title: '雾港来信',
  latestCommittedChapter: 0,
  health: 'ready',
  lastOpenedAt: '2026-07-28T01:00:00.000Z',
  briefExcerpt: '一名夜班邮差收到来自未来的退信。',
  locationLabel: '我的小说',
  storyBibleAvailable: true,
  globalPlanAvailable: false
};

function installApi() {
  const api = {
    system: { getReadiness: vi.fn().mockResolvedValue(readiness) },
    projects: {
      list: vi.fn().mockResolvedValue({
        projects: [project],
        defaultLocation: { configured: true, locationLabel: '我的小说' },
        warning: null
      }),
      chooseDefaultLibrary: vi.fn(),
      create: vi.fn(),
      openExisting: vi.fn(),
      open: vi.fn().mockResolvedValue({ outcome: 'opened', project }),
      remove: vi.fn()
    },
    foundation: {
      start: vi.fn(), get: vi.fn(), cancel: vi.fn(),
      read: vi.fn().mockResolvedValue({ available: true, documents: [
        { kind: 'story_bible', title: 'private story bible', markdown: '# 故事核心\n\n夜班邮差收到一封未来退信。' },
        { kind: 'genre_contract', title: 'private genre', markdown: '# 类型边界\n\n悬疑与成长并行。' },
        { kind: 'reader_promise', title: 'private promise', markdown: '# 读者期待\n\n每章都推进谜团。' },
        { kind: 'style_guide', title: 'private style', markdown: '# 写作风格\n\n克制而清晰。' }
      ] })
    }
  } satisfies NovelLoopDesktopApi;
  Object.defineProperty(window, 'novelLoop', { configurable: true, value: api });
  return api;
}

async function openCompleteProject() {
  fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开《雾港来信》' }));
  await screen.findByRole('heading', { name: '雾港来信' });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'novelLoop');
});

test('reads all four foundation documents without technical metadata', async () => {
  const api = installApi();
  render(<App />);
  await openCompleteProject();
  fireEvent.click(screen.getByRole('button', { name: '查看故事基础' }));
  expect(await screen.findByRole('heading', { name: '故事基础' })).toBeVisible();
  expect(screen.getByText('这是一份生成草稿，尚未写入正式故事状态。')).toBeVisible();
  expect(screen.getAllByRole('button', { name: /故事核心|类型边界|读者期待|写作风格/ })).toHaveLength(4);
  expect(api.foundation.read).toHaveBeenCalledWith({ projectKey });
  expect(document.body).not.toHaveTextContent(/run_|strategy\/|schema|jsonl|private/i);
});

test('moves focus to the route heading and supports keyboard document navigation', async () => {
  installApi();
  render(<App />);
  await openCompleteProject();
  fireEvent.click(screen.getByRole('button', { name: '查看故事基础' }));
  const heading = await screen.findByRole('heading', { name: '故事基础' });
  expect(heading).toHaveFocus();
  const firstDocument = screen.getByRole('button', { name: '故事核心' });
  firstDocument.focus();
  fireEvent.keyDown(firstDocument, { key: 'ArrowDown' });
  expect(screen.getByRole('button', { name: '类型边界' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('button', { name: '类型边界' }), { key: 'Enter' });
  expect(screen.getByText('悬疑与成长并行。')).toBeVisible();
});

test('renders source markdown as text without injecting HTML', async () => {
  const api = installApi();
  api.foundation.read.mockResolvedValue({ available: true, documents: [
    { kind: 'story_bible', title: '故事核心', markdown: '# 故事核心\n\n<img src=x onerror=alert(1)>' },
    { kind: 'genre_contract', title: '类型边界', markdown: '# 类型边界' },
    { kind: 'reader_promise', title: '读者期待', markdown: '# 读者期待' },
    { kind: 'style_guide', title: '写作风格', markdown: '# 写作风格' }
  ] });
  render(<App />);
  await openCompleteProject();
  fireEvent.click(screen.getByRole('button', { name: '查看故事基础' }));
  expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(document.querySelector('img')).toBeNull();
});
