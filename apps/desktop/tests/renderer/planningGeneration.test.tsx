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
import type { PlanningTask } from '../../src/shared/planningContract';
import type { ProjectSummary } from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';

const projectKey = 'project_0123456789abcdef01234567';
const readiness: SystemReadiness = {
  app: { name: 'Novel Loop', platform: 'linux', version: '0.1.0' },
  checkedAt: '2026-07-29T01:00:00.000Z',
  codex: {
    canRunSmoke: true,
    status: 'ready',
    summary: '已准备好。',
    version: null
  }
};
const project: ProjectSummary = {
  projectKey,
  title: '雾港来信',
  latestCommittedChapter: 0,
  health: 'ready',
  lastOpenedAt: '2026-07-29T01:00:00.000Z',
  briefExcerpt: '一名夜班邮差收到来自未来的退信。',
  locationLabel: '我的小说',
  storyBibleAvailable: true,
  globalPlanAvailable: false
};
const plannedProject: ProjectSummary = {
  ...project,
  globalPlanAvailable: true
};
const completeReview = {
  available: true as const,
  documents: [
    {
      kind: 'global_outline' as const,
      title: '全书方向',
      markdown: '# 全书方向'
    },
    {
      kind: 'volume_outline' as const,
      title: '第一卷',
      markdown: '# 第一卷'
    }
  ],
  arcs: [],
  chapters: []
};

function planningTask(overrides: Partial<PlanningTask> = {}): PlanningTask {
  return {
    taskId: 'planning_0123456789abcdef',
    projectKey,
    status: 'running',
    stage: 'global_outline',
    completedStages: ['preparing'],
    startedAt: '2026-07-29T01:00:00.000Z',
    updatedAt: '2026-07-29T01:00:01.000Z',
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
      start: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      read: vi.fn().mockResolvedValue({ available: false, reason: 'not_ready' })
    },
    planning: {
      start: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      read: vi.fn().mockResolvedValue(completeReview)
    }
  } satisfies NovelLoopDesktopApi;
  Object.defineProperty(window, 'novelLoop', {
    configurable: true,
    value: api
  });
  return api;
}

async function openGeneration() {
  fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开《雾港来信》' }));
  await screen.findByRole('heading', { name: '雾港来信' });
  fireEvent.click(screen.getByRole('button', { name: '准备生成全局规划' }));
}

async function confirmStart() {
  fireEvent.click(screen.getByRole('button', { name: '开始生成全局规划' }));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'novelLoop');
});

describe('global planning generation', () => {
  test('requires explicit confirmation before calling the planning boundary', async () => {
    const api = installApi();
    api.planning.start.mockResolvedValue(planningTask());

    render(<App />);
    await openGeneration();

    expect(screen.getByText(
      '生成通常需要几分钟，期间不会提交章节或修改正式故事状态。'
    )).toBeVisible();
    expect(api.planning.start).not.toHaveBeenCalled();
    await confirmStart();
    expect(api.planning.start).toHaveBeenCalledWith({ projectKey });
  });

  test('polls stable planning stages and requests a cooperative stop', async () => {
    const api = installApi();
    api.planning.start.mockResolvedValue(planningTask());
    api.planning.get.mockResolvedValue(planningTask({
      stage: 'volume_outline',
      completedStages: ['preparing', 'global_outline']
    }));
    api.planning.cancel.mockResolvedValue(planningTask({
      status: 'stop_requested'
    }));

    render(<App />);
    await openGeneration();
    vi.useFakeTimers();
    await confirmStart();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });

    expect(screen.getByText('正在组织第一卷')).toBeVisible();
    const stages = screen.getByRole('list', { name: '全局规划生成阶段' });
    expect(within(stages).getAllByRole('listitem')).toHaveLength(7);
    expect(within(stages).getByRole('listitem', {
      name: '规划全书方向，已完成'
    })).toBeVisible();
    expect(within(stages).getByRole('listitem', {
      name: '组织第一卷，当前阶段'
    })).toHaveAttribute('aria-current', 'step');

    fireEvent.click(screen.getByRole('button', {
      name: '完成当前 Codex 步骤后停止'
    }));
    expect(api.planning.cancel).toHaveBeenCalledWith({
      taskId: 'planning_0123456789abcdef'
    });
    expect(screen.getByText(
      '停止请求会在当前 Codex 步骤完成后生效，不会删除已经准备好的规划。'
    )).toBeVisible();
  });

  test('continues polling when a cooperative stop request fails', async () => {
    const api = installApi();
    const firstPoll = deferred<PlanningTask>();
    api.planning.start.mockResolvedValue(planningTask());
    api.planning.get
      .mockReturnValueOnce(firstPoll.promise)
      .mockResolvedValueOnce(planningTask({
        status: 'succeeded',
        stage: 'completed',
        completedStages: [
          'preparing',
          'global_outline',
          'volume_outline',
          'arc_map',
          'chapter_queue',
          'finalizing',
          'completed'
        ],
        canCancel: false
      }));
    api.planning.cancel.mockRejectedValue(new Error('temporary cancel failure'));
    api.projects.open
      .mockResolvedValueOnce({ outcome: 'opened', project })
      .mockResolvedValueOnce({ outcome: 'opened', project: plannedProject });

    render(<App />);
    await openGeneration();
    vi.useFakeTimers();
    await confirmStart();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });
    expect(api.planning.get).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', {
      name: '完成当前 Codex 步骤后停止'
    }));
    await act(async () => {
      await Promise.resolve();
      firstPoll.resolve(planningTask({
        stage: 'volume_outline',
        completedStages: ['preparing', 'global_outline']
      }));
      await firstPoll.promise;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.planning.get).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: '全局规划' })).toBeVisible();
  });

  test('retries a partial failure without claiming completed work will be replaced', async () => {
    const api = installApi();
    api.planning.start
      .mockResolvedValueOnce(planningTask({
        status: 'failed',
        stage: 'arc_map',
        completedStages: ['preparing', 'global_outline', 'volume_outline'],
        canCancel: false,
        canRetry: true,
        error: { kind: 'timeout', message: 'private detail' }
      }))
      .mockResolvedValueOnce(planningTask({
        stage: 'arc_map',
        completedStages: ['preparing', 'global_outline', 'volume_outline']
      }));

    render(<App />);
    await openGeneration();
    await confirmStart();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '生成等待时间过长，尚未完成的规划可以稍后继续。'
    );
    expect(screen.getByText(
      '已经准备好的全书方向和第一卷会被保留。'
    )).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '继续生成' }));
    expect(api.planning.start).toHaveBeenCalledTimes(2);
  });

  test('refreshes stale overview data when planning completed elsewhere', async () => {
    const api = installApi();
    api.planning.start.mockResolvedValue(planningTask({
      status: 'failed',
      stage: 'completed',
      canCancel: false,
      canRetry: false,
      error: { kind: 'already_complete', message: 'private detail' }
    }));
    api.projects.open
      .mockResolvedValueOnce({ outcome: 'opened', project })
      .mockResolvedValueOnce({ outcome: 'opened', project: plannedProject });

    render(<App />);
    await openGeneration();
    await confirmStart();

    expect(await screen.findByRole('heading', { name: '全局规划' })).toBeVisible();
    expect(api.projects.open).toHaveBeenLastCalledWith(projectKey);
    expect(screen.queryByText(/already_complete|private detail/i))
      .not.toBeInTheDocument();
  });

  test('keeps polling when a task is temporarily inaccessible', async () => {
    const api = installApi();
    api.planning.start.mockResolvedValue(planningTask());
    api.planning.get
      .mockRejectedValueOnce(new Error('Planning task was not found.'))
      .mockResolvedValueOnce(planningTask({
        stage: 'arc_map',
        completedStages: ['preparing', 'global_outline', 'volume_outline']
      }));

    render(<App />);
    await openGeneration();
    vi.useFakeTimers();
    await confirmStart();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });

    expect(screen.getByText('暂时无法刷新进度，正在继续尝试。')).toBeVisible();
    expect(document.body).not.toHaveTextContent(/task was not found/i);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });
    expect(screen.getByText('正在梳理故事线')).toBeVisible();
    expect(screen.queryByText('暂时无法刷新进度，正在继续尝试。'))
      .not.toBeInTheDocument();
  });

  test('refreshes the project summary before opening completed planning', async () => {
    const api = installApi();
    api.planning.start.mockResolvedValue(planningTask());
    api.planning.get.mockResolvedValue(planningTask({
      status: 'succeeded',
      stage: 'completed',
      completedStages: [
        'preparing',
        'global_outline',
        'volume_outline',
        'arc_map',
        'chapter_queue',
        'finalizing',
        'completed'
      ],
      canCancel: false
    }));
    api.projects.open
      .mockResolvedValueOnce({ outcome: 'opened', project })
      .mockResolvedValueOnce({ outcome: 'opened', project: plannedProject });

    render(<App />);
    await openGeneration();
    vi.useFakeTimers();
    await confirmStart();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.projects.open).toHaveBeenLastCalledWith(projectKey);
    expect(screen.getByRole('heading', { name: '全局规划' })).toBeVisible();
  });

  test('shows a stable completed state while the project refresh is pending', async () => {
    const api = installApi();
    const projectRefresh = deferred<Awaited<ReturnType<
      NovelLoopDesktopApi['projects']['open']
    >>>();
    api.planning.start.mockResolvedValue(planningTask());
    api.planning.get.mockResolvedValue(planningTask({
      status: 'succeeded',
      stage: 'completed',
      completedStages: [
        'preparing',
        'global_outline',
        'volume_outline',
        'arc_map',
        'chapter_queue',
        'finalizing',
        'completed'
      ],
      canCancel: false
    }));
    api.projects.open
      .mockResolvedValueOnce({ outcome: 'opened', project })
      .mockReturnValueOnce(projectRefresh.promise);

    render(<App />);
    await openGeneration();
    vi.useFakeTimers();
    await confirmStart();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });

    expect(screen.getByText('全局规划已准备完成')).toBeVisible();

    await act(async () => {
      projectRefresh.resolve({ outcome: 'opened', project: plannedProject });
      await projectRefresh.promise;
    });
    expect(screen.getByRole('heading', { name: '全局规划' })).toBeVisible();
  });

  test.each([
    ['codex_unavailable', '暂时无法使用本地 Codex，请确认它已安装并可用后重试。'],
    ['login_required', '请先在系统中登录 Codex，然后继续生成。'],
    ['usage_limit', '本次生成次数已达上限，请稍后继续。'],
    ['timeout', '生成等待时间过长，尚未完成的规划可以稍后继续。'],
    ['invalid_output', '本次生成结果暂时无法使用，可以继续生成尚未完成的部分。'],
    ['foundation_missing', '故事基础尚未准备完整，请先返回核对故事基础。'],
    ['project_unavailable', '当前项目暂时无法读取，请返回作品库后重新打开。'],
    ['generation_busy', '这个项目正在进行另一项生成，请稍后再试。'],
    ['unexpected', '生成时出现意外情况，正式故事状态没有改变。']
  ] as const)('uses safe author language for %s', async (kind, message) => {
    const api = installApi();
    api.planning.start.mockResolvedValue(planningTask({
      status: 'failed',
      canCancel: false,
      canRetry: kind !== 'project_unavailable',
      error: {
        kind,
        message: 'PLANNING_INTERNAL /home/private/run_123/events.jsonl'
      }
    }));

    render(<App />);
    await openGeneration();
    await confirmStart();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByText('本次操作没有提交章节，也没有修改正式故事状态。'))
      .toBeVisible();
    expect(document.body).not.toHaveTextContent(
      /PLANNING_INTERNAL|home\/private|run_123|jsonl|taskId|projectKey/i
    );
  });
});
