import { createInertDiagnosticRevisionApi } from "./desktopApiFixtures";
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/renderer/src/App';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import type { FoundationTask } from '../../src/shared/foundationContract';
import type { ProjectSummary } from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';
import { createInertChapterApi, createInertSubmissionApi } from './desktopApiFixtures';

const projectKey = 'project_0123456789abcdef01234567';
const readiness: SystemReadiness = {
  app: { name: 'Novel Loop', platform: 'linux', version: '0.1.0' },
  checkedAt: '2026-07-28T01:00:00.000Z',
  codex: { canRunSmoke: true, status: 'ready', summary: '已准备好。', version: null }
};
const incompleteProject: ProjectSummary = {
  projectKey,
  title: '雾港来信',
  latestCommittedChapter: 0,
  health: 'ready',
  lastOpenedAt: '2026-07-28T01:00:00.000Z',
  briefExcerpt: '一名夜班邮差收到来自未来的退信。',
  locationLabel: '我的小说',
  storyBibleAvailable: false,
  globalPlanAvailable: false
};
const completeProject: ProjectSummary = {
  ...incompleteProject,
  storyBibleAvailable: true
};
const completeReview = {
  available: true as const,
  documents: [
    { kind: 'story_bible' as const, title: '故事核心', markdown: '# 故事核心' },
    { kind: 'genre_contract' as const, title: '类型边界', markdown: '# 类型边界' },
    { kind: 'reader_promise' as const, title: '读者期待', markdown: '# 读者期待' },
    { kind: 'style_guide' as const, title: '写作风格', markdown: '# 写作风格' }
  ]
};

function foundationTask(overrides: Partial<FoundationTask> = {}): FoundationTask {
  return {
    taskId: 'foundation_0123456789abcdef',
    projectKey,
    status: 'running',
    stage: 'story_bible',
    completedStages: ['preparing'],
    startedAt: '2026-07-28T01:00:00.000Z',
    updatedAt: '2026-07-28T01:00:01.000Z',
    canCancel: true,
    canRetry: false,
    error: null,
    ...overrides
  };
}

function installApi() {
  const api = {
    system: { getReadiness: vi.fn().mockResolvedValue(readiness) },
    projects: {
      list: vi.fn().mockResolvedValue({
        projects: [incompleteProject],
        defaultLocation: { configured: true, locationLabel: '我的小说' },
        warning: null
      }),
      chooseDefaultLibrary: vi.fn(),
      create: vi.fn(),
      openExisting: vi.fn(),
      open: vi.fn().mockResolvedValue({ outcome: 'opened', project: incompleteProject }),
      remove: vi.fn()
    },
    foundation: { start: vi.fn(), get: vi.fn(), cancel: vi.fn(), read: vi.fn() },
    planning: { start: vi.fn(), get: vi.fn(), cancel: vi.fn(), read: vi.fn() },
    chapter: createInertChapterApi(),
    diagnosticRevision: createInertDiagnosticRevisionApi(),
    submission: createInertSubmissionApi()
  } satisfies NovelLoopDesktopApi;
  Object.defineProperty(window, 'novelLoop', { configurable: true, value: api });
  return api;
}

async function openIncompleteProject() {
  fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开《雾港来信》' }));
  await screen.findByRole('heading', { name: '雾港来信' });
}

async function openGeneration() {
  await openIncompleteProject();
  fireEvent.click(screen.getByRole('button', { name: '准备生成故事基础' }));
}

async function confirmStart() {
  fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'novelLoop');
});

describe('Story Foundation generation', () => {
  test('requires confirmation before starting generation', async () => {
    const api = installApi();
    api.foundation.start.mockResolvedValue(foundationTask());
    render(<App />);
    await openGeneration();
    expect(screen.getByRole('heading', { name: '生成故事基础' })).toBeVisible();
    expect(screen.getByText('生成通常需要几分钟，期间不会写入正式故事状态。'))
      .toBeVisible();
    expect(api.foundation.start).not.toHaveBeenCalled();
    await confirmStart();
    expect(api.foundation.start).toHaveBeenCalledWith({ projectKey });
  });

  test('shows the current stage and requests a safe stop after the current step', async () => {
    const api = installApi();
    api.foundation.start.mockResolvedValue(foundationTask());
    api.foundation.get.mockResolvedValue(foundationTask({
      stage: 'genre_contract', completedStages: ['preparing', 'story_bible']
    }));
    api.foundation.cancel.mockResolvedValue(foundationTask({ status: 'stop_requested' }));
    render(<App />);
    await openGeneration();
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-28T01:02:05.000Z');
    await confirmStart();
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });
    expect(screen.getByText('正在整理类型边界')).toBeVisible();
    const stageList = screen.getByRole('list', { name: '故事基础生成阶段' });
    expect(within(stageList).getAllByRole('listitem')).toHaveLength(7);
    expect(within(stageList).getByRole('listitem', { name: '读取项目资料，已完成' }))
      .toBeVisible();
    expect(within(stageList).getByRole('listitem', { name: '整理类型边界，当前阶段' }))
      .toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('timer')).toHaveTextContent('已用时 2 分钟');
    expect(screen.getByText('停止会在当前步骤完成后生效。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '完成当前步骤后停止' }));
    expect(api.foundation.cancel).toHaveBeenCalledWith({ taskId: 'foundation_0123456789abcdef' });
  });

  test('retries a failed generation only after confirmation', async () => {
    const api = installApi();
    api.foundation.start.mockResolvedValue(foundationTask({
      status: 'failed', canCancel: false, canRetry: true,
      error: { kind: 'timeout', message: 'private detail' }
    }));
    render(<App />);
    await openGeneration();
    await confirmStart();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '生成等待时间过长，故事基础尚未完成。请重试。'
    );
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    expect(screen.getByRole('heading', { name: '生成故事基础' })).toBeVisible();
    expect(api.foundation.start).toHaveBeenCalledOnce();
    await confirmStart();
    expect(api.foundation.start).toHaveBeenCalledTimes(2);
  });

  test('refreshes the project before entering review after success', async () => {
    const api = installApi();
    api.foundation.start.mockResolvedValue(foundationTask());
    api.foundation.get.mockResolvedValue(foundationTask({
      status: 'succeeded', stage: 'completed', canCancel: false
    }));
    api.projects.open
      .mockResolvedValueOnce({ outcome: 'opened', project: incompleteProject })
      .mockResolvedValueOnce({
        outcome: 'opened', project: { ...incompleteProject, storyBibleAvailable: true }
      });
    api.foundation.read.mockResolvedValue({ available: true, documents: [
      { kind: 'story_bible', title: '故事核心', markdown: '# 故事核心' },
      { kind: 'genre_contract', title: '类型边界', markdown: '# 类型边界' },
      { kind: 'reader_promise', title: '读者期待', markdown: '# 读者期待' },
      { kind: 'style_guide', title: '写作风格', markdown: '# 写作风格' }
    ] });
    render(<App />);
    await openGeneration();
    vi.useFakeTimers();
    await confirmStart();
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.projects.open).toHaveBeenLastCalledWith(projectKey);
    expect(screen.getByRole('heading', { name: '故事基础' })).toBeVisible();
  });

  test('continues polling after a transient refresh failure and enters review on success', async () => {
    const api = installApi();
    api.foundation.start.mockResolvedValue(foundationTask());
    api.foundation.get
      .mockRejectedValueOnce(new Error('temporary refresh failure'))
      .mockResolvedValueOnce(foundationTask({
        status: 'succeeded', stage: 'completed', canCancel: false
      }));
    api.projects.open
      .mockResolvedValueOnce({ outcome: 'opened', project: incompleteProject })
      .mockResolvedValueOnce({
        outcome: 'opened', project: { ...incompleteProject, storyBibleAvailable: true }
      });
    api.foundation.read.mockResolvedValue({ available: true, documents: [
      { kind: 'story_bible', title: '故事核心', markdown: '# 故事核心' },
      { kind: 'genre_contract', title: '类型边界', markdown: '# 类型边界' },
      { kind: 'reader_promise', title: '读者期待', markdown: '# 读者期待' },
      { kind: 'style_guide', title: '写作风格', markdown: '# 写作风格' }
    ] });
    render(<App />);
    await openGeneration();
    vi.useFakeTimers();
    await confirmStart();
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });
    expect(screen.getByText('正在构建故事核心')).toBeVisible();
    expect(screen.getByText('暂时无法刷新进度，正在继续尝试。')).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.projects.open).toHaveBeenLastCalledWith(projectKey);
    expect(screen.getByRole('heading', { name: '故事基础' })).toBeVisible();
  });

  test('refreshes stale overview data when another process completed the foundation', async () => {
    const api = installApi();
    api.foundation.start.mockResolvedValue(foundationTask({
      status: 'failed',
      canCancel: false,
      canRetry: false,
      error: { kind: 'already_complete', message: 'private detail' }
    }));
    api.projects.open
      .mockResolvedValueOnce({ outcome: 'opened', project: incompleteProject })
      .mockResolvedValueOnce({ outcome: 'opened', project: completeProject });
    api.foundation.read.mockResolvedValue(completeReview);
    render(<App />);
    await openGeneration();

    await confirmStart();

    expect(await screen.findByRole('heading', { name: '故事基础' })).toBeVisible();
    expect(api.projects.open).toHaveBeenLastCalledWith(projectKey);
    expect(screen.queryByText('故事基础已经准备完成，请返回项目概览查看。'))
      .not.toBeInTheDocument();
  });

  test('recovers after leaving a running task that completes in the background', async () => {
    const api = installApi();
    api.foundation.start
      .mockResolvedValueOnce(foundationTask())
      .mockResolvedValueOnce(foundationTask({
        status: 'failed',
        canCancel: false,
        canRetry: false,
        error: { kind: 'already_complete', message: 'private detail' }
      }));
    api.projects.open
      .mockResolvedValueOnce({ outcome: 'opened', project: incompleteProject })
      .mockResolvedValueOnce({ outcome: 'opened', project: completeProject });
    api.foundation.read.mockResolvedValue(completeReview);
    render(<App />);
    await openGeneration();
    await confirmStart();
    expect(await screen.findByText('正在构建故事核心')).toBeVisible();

    fireEvent.click(screen.getAllByRole('button', { name: '返回项目概览' })[0]!);
    expect(await screen.findByRole('heading', { name: '雾港来信' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '准备生成故事基础' }));
    await confirmStart();

    expect(await screen.findByRole('heading', { name: '故事基础' })).toBeVisible();
    expect(api.foundation.start).toHaveBeenCalledTimes(2);
  });

  test('ignores an already-complete refresh after leaving the generation view', async () => {
    const api = installApi();
    let resolveRefresh!: (value: {
      outcome: 'opened';
      project: ProjectSummary;
    }) => void;
    const refresh = new Promise<{
      outcome: 'opened';
      project: ProjectSummary;
    }>((resolve) => {
      resolveRefresh = resolve;
    });
    api.foundation.start.mockResolvedValue(foundationTask({
      status: 'failed',
      canCancel: false,
      canRetry: false,
      error: { kind: 'already_complete', message: 'private detail' }
    }));
    api.projects.open
      .mockResolvedValueOnce({ outcome: 'opened', project: incompleteProject })
      .mockImplementationOnce(async () => refresh);
    render(<App />);
    await openGeneration();
    await confirmStart();
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.projects.open).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getAllByRole('button', { name: '返回项目概览' })[0]!);
    await act(async () => {
      resolveRefresh({ outcome: 'opened', project: completeProject });
      await Promise.resolve();
    });

    expect(screen.getByRole('heading', { name: '雾港来信' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '故事基础' })).not.toBeInTheDocument();
  });

  test.each([
    ['codex_unavailable', '暂时无法使用本地 Codex，请确认它已安装并可用后重试。'],
    ['login_required', '请先在系统中登录 Codex，然后重新生成。'],
    ['usage_limit', '本次生成次数已达上限，请稍后再试。'],
    ['timeout', '生成等待时间过长，故事基础尚未完成。请重试。'],
    ['invalid_output', '生成内容暂时无法使用，请重试。'],
    ['project_unavailable', '当前项目暂时无法读取，请返回作品库后重新打开。'],
    ['generation_busy', '这个项目正在生成故事基础，请稍后重试。'],
    ['unexpected', '生成时出现意外情况，请重试。']
  ] as const)('uses a natural recovery message for %s', async (kind, message) => {
    const api = installApi();
    api.foundation.start.mockResolvedValue(foundationTask({
      status: 'failed', canCancel: false, canRetry: kind !== 'project_unavailable',
      error: { kind, message: 'FOUNDATION_INTERNAL /home/private/run.jsonl' }
    }));
    render(<App />);
    await openGeneration();
    await confirmStart();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(document.body).not.toHaveTextContent(/FOUNDATION_INTERNAL|home\/private|jsonl/i);
  });
});
