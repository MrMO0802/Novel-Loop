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
import type { ChapterInspection } from '../../src/shared/chapterContract';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import type { ProjectSummary } from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';
import {
  chapterTask,
  completeChapterPlan,
  createInertChapterApi,
  deferred,
  readyChapterInspection
} from './desktopApiFixtures';

const projectKey = 'project_0123456789abcdef01234567';
const project: ProjectSummary = {
  projectKey,
  title: '白箱循环',
  latestCommittedChapter: 0,
  health: 'ready',
  lastOpenedAt: '2026-07-30T01:00:00.000Z',
  briefExcerpt: '林默追查妹妹留在循环城市中的异常报告。',
  locationLabel: '测试作品库',
  storyBibleAvailable: true,
  globalPlanAvailable: true
};
const readiness: SystemReadiness = {
  app: { name: 'Novel Loop', platform: 'linux', version: '0.1.0' },
  checkedAt: '2026-07-30T01:00:00.000Z',
  codex: {
    canRunSmoke: true,
    status: 'ready',
    summary: '已准备好。',
    version: null
  }
};

function installApi(
  inspection: Extract<ChapterInspection, { available: true }> =
    readyChapterInspection
) {
  const chapter = {
    ...createInertChapterApi(),
    inspect: vi.fn().mockResolvedValue(inspection),
    readPlan: vi.fn().mockResolvedValue(completeChapterPlan)
  };
  const api = {
    system: { getReadiness: vi.fn().mockResolvedValue(readiness) },
    projects: {
      list: vi.fn().mockResolvedValue({
        projects: [project],
        defaultLocation: { configured: true, locationLabel: '测试作品库' },
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
      read: vi.fn()
    },
    planning: {
      start: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      read: vi.fn()
    },
    chapter
  } satisfies NovelLoopDesktopApi;
  Object.defineProperty(window, 'novelLoop', {
    configurable: true,
    value: api
  });
  return api;
}

async function openProject() {
  fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开《白箱循环》' }));
  await screen.findByRole('heading', { name: '白箱循环' });
}

async function openPlanningGeneration() {
  await openProject();
  fireEvent.click(await screen.findByRole('button', {
    name: '创建第 1 章'
  }));
}

async function openPlanningGenerationFromGlobalPlan() {
  await openProject();
  fireEvent.click(await screen.findByRole('button', {
    name: '查看全局规划'
  }));
  fireEvent.click(await screen.findByRole('button', {
    name: '创建第 1 章'
  }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'novelLoop');
});

describe('chapter planning generation', () => {
  test('requires explicit confirmation before starting chapter planning', async () => {
    const api = installApi();
    api.chapter.startPlanning.mockResolvedValue(chapterTask());

    render(<App />);
    await openPlanningGeneration();

    expect(screen.getByRole('heading', {
      name: '准备第 1 章方向'
    })).toBeVisible();
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', {
      name: '开始准备章节方向'
    }));
    expect(api.chapter.startPlanning).toHaveBeenCalledWith({ projectKey });
  });

  test('polls author-facing stages and requests a cooperative stop', async () => {
    const api = installApi();
    api.chapter.startPlanning.mockResolvedValue(chapterTask());
    api.chapter.get.mockResolvedValue(chapterTask({
      stage: 'plan_candidates',
      completedStages: ['preparing', 'mission']
    }));
    api.chapter.cancel.mockResolvedValue(chapterTask({
      status: 'stop_requested'
    }));

    render(<App />);
    await openPlanningGeneration();
    await screen.findByRole('button', { name: '开始准备章节方向' });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '开始准备章节方向' }));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });

    expect(screen.getByText('正在比较不同章节方案')).toBeVisible();
    const stages = screen.getByRole('list', { name: '章节方向准备阶段' });
    expect(within(stages).getByRole('listitem', {
      name: '确定本章任务，已完成'
    })).toBeVisible();

    fireEvent.click(screen.getByRole('button', {
      name: '完成当前安全步骤后停止'
    }));
    expect(api.chapter.cancel).toHaveBeenCalledWith({
      taskId: 'chapter_0123456789abcdef'
    });
    expect(screen.getByText(
      '已请求停止，会在当前安全步骤完成后暂停；已完成的内容会保留。'
    )).toBeVisible();
  });

  test('keeps terminal failure visible and retries preserved planning work', async () => {
    const api = installApi();
    api.chapter.startPlanning
      .mockResolvedValueOnce(chapterTask({
        status: 'failed',
        stage: 'ranking',
        completedStages: ['preparing', 'mission', 'plan_candidates'],
        canCancel: false,
        canRetry: true,
        error: { kind: 'timeout', message: '/private/run/events.jsonl' }
      }))
      .mockResolvedValueOnce(chapterTask({
        stage: 'ranking',
        completedStages: ['preparing', 'mission', 'plan_candidates']
      }));

    render(<App />);
    await openPlanningGeneration();
    fireEvent.click(await screen.findByRole('button', {
      name: '开始准备章节方向'
    }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '等待时间较长，本章已完成的规划会保留，可以继续准备。'
    );
    expect(document.body).not.toHaveTextContent(/private|jsonl|taskId|run_/i);
    fireEvent.click(screen.getByRole('button', { name: '继续准备' }));
    expect(api.chapter.startPlanning).toHaveBeenCalledTimes(2);
  });

  test('keeps planning progress visible when a stop request is temporarily unavailable', async () => {
    const api = installApi();
    api.chapter.startPlanning.mockResolvedValue(chapterTask({
      stage: 'mission',
      completedStages: ['preparing']
    }));
    api.chapter.cancel.mockRejectedValue(new Error('/private/cancel failure'));

    render(<App />);
    await openPlanningGeneration();
    fireEvent.click(await screen.findByRole('button', {
      name: '开始准备章节方向'
    }));
    fireEvent.click(await screen.findByRole('button', {
      name: '完成当前安全步骤后停止'
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('正在确定本章任务')).toBeVisible();
    expect(screen.getByText('暂时无法刷新进度，正在继续尝试。')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('keeps stop_requested monotonic when an older planning poll resolves late', async () => {
    const api = installApi();
    const oldPoll = deferred<ReturnType<typeof chapterTask>>();
    api.chapter.startPlanning.mockResolvedValue(chapterTask({
      stage: 'mission',
      completedStages: ['preparing'],
      updatedAt: '2026-07-30T01:00:01.000Z'
    }));
    api.chapter.get.mockReturnValue(oldPoll.promise);
    api.chapter.cancel.mockResolvedValue(chapterTask({
      status: 'stop_requested',
      stage: 'mission',
      completedStages: ['preparing'],
      canCancel: false,
      updatedAt: '2026-07-30T01:00:03.000Z'
    }));

    render(<App />);
    await openPlanningGeneration();
    await screen.findByRole('button', { name: '开始准备章节方向' });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', {
      name: '开始准备章节方向'
    }));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(api.chapter.get).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', {
      name: '完成当前安全步骤后停止'
    }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(
      '已请求停止，会在当前安全步骤完成后暂停；已完成的内容会保留。'
    )).toBeVisible();

    await act(async () => {
      oldPoll.resolve(chapterTask({
        stage: 'ranking',
        completedStages: ['preparing', 'mission', 'plan_candidates'],
        updatedAt: '2026-07-30T01:00:02.000Z'
      }));
      await Promise.resolve();
    });

    expect(screen.getByText(
      '已请求停止，会在当前安全步骤完成后暂停；已完成的内容会保留。'
    )).toBeVisible();
    expect(screen.queryByRole('button', {
      name: '完成当前安全步骤后停止'
    })).not.toBeInTheDocument();
  });

  test('ignores a late cancel response from task A after retry task B starts', async () => {
    const api = installApi();
    const oldCancel = deferred<ReturnType<typeof chapterTask>>();
    const taskAId = 'chapter_aaaaaaaaaaaaaaaa';
    const taskBId = 'chapter_bbbbbbbbbbbbbbbb';
    api.chapter.startPlanning
      .mockResolvedValueOnce(chapterTask({
        taskId: taskAId,
        stage: 'mission',
        completedStages: ['preparing']
      }))
      .mockResolvedValueOnce(chapterTask({
        taskId: taskBId,
        stage: 'ranking',
        completedStages: ['preparing', 'mission', 'plan_candidates'],
        updatedAt: '2026-07-30T01:00:04.000Z'
      }));
    api.chapter.cancel.mockReturnValue(oldCancel.promise);
    api.chapter.get
      .mockResolvedValueOnce(chapterTask({
        taskId: taskAId,
        status: 'failed',
        stage: 'mission',
        completedStages: ['preparing'],
        canCancel: false,
        canRetry: true,
        error: { kind: 'timeout', message: 'Task A timed out.' },
        updatedAt: '2026-07-30T01:00:03.000Z'
      }))
      .mockResolvedValue(chapterTask({
        taskId: taskBId,
        stage: 'ranking',
        completedStages: ['preparing', 'mission', 'plan_candidates'],
        updatedAt: '2026-07-30T01:00:05.000Z'
      }));

    render(<App />);
    await openPlanningGeneration();
    await screen.findByRole('button', { name: '开始准备章节方向' });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', {
      name: '开始准备章节方向'
    }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', {
      name: '完成当前安全步骤后停止'
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    fireEvent.click(screen.getByRole('button', { name: '继续准备' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('正在选择最合适的方向')).toBeVisible();

    await act(async () => {
      oldCancel.resolve(chapterTask({
        taskId: taskAId,
        status: 'cancelled',
        stage: 'mission',
        completedStages: ['preparing'],
        canCancel: false,
        canRetry: true,
        updatedAt: '2026-07-30T01:00:06.000Z'
      }));
      await Promise.resolve();
    });

    expect(screen.getByText('正在选择最合适的方向')).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(api.chapter.get).toHaveBeenLastCalledWith({ taskId: taskBId });
  });

  test('continues planning polling after a temporary get failure', async () => {
    const api = installApi();
    api.chapter.startPlanning.mockResolvedValue(chapterTask({
      stage: 'mission',
      completedStages: ['preparing']
    }));
    api.chapter.get
      .mockRejectedValueOnce(new Error('/private/get unavailable'))
      .mockResolvedValue(chapterTask({
        stage: 'plan_candidates',
        completedStages: ['preparing', 'mission'],
        updatedAt: '2026-07-30T01:00:02.000Z'
      }));

    render(<App />);
    await openPlanningGeneration();
    await screen.findByRole('button', { name: '开始准备章节方向' });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', {
      name: '开始准备章节方向'
    }));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText(
      '暂时无法刷新进度，正在继续尝试。'
    )).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText('正在比较不同章节方案')).toBeVisible();
    expect(screen.queryByText(
      '暂时无法刷新进度，正在继续尝试。'
    )).not.toBeInTheDocument();
  });

  test('ignores an in-flight planning response after unmount', async () => {
    const api = installApi();
    const oldPoll = deferred<ReturnType<typeof chapterTask>>();
    api.chapter.startPlanning.mockResolvedValue(chapterTask());
    api.chapter.get.mockReturnValue(oldPoll.promise);

    const rendered = render(<App />);
    await openPlanningGeneration();
    await screen.findByRole('button', { name: '开始准备章节方向' });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', {
      name: '开始准备章节方向'
    }));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const inspectionsBeforeUnmount = api.chapter.inspect.mock.calls.length;
    rendered.unmount();

    await act(async () => {
      oldPoll.resolve(chapterTask({
        status: 'succeeded',
        stage: 'completed',
        completedStages: ['preparing', 'mission', 'plan_candidates', 'ranking',
          'finalizing', 'completed'],
        canCancel: false,
        updatedAt: '2026-07-30T01:00:02.000Z'
      }));
      await Promise.resolve();
    });

    expect(api.chapter.inspect).toHaveBeenCalledTimes(inspectionsBeforeUnmount);
  });

  test.each([
    ['not_started', '准备第 1 章方向'],
    ['planning_partial', '准备第 1 章方向'],
    ['plan_ready', '审阅第 1 章方向'],
    ['drafting_partial', '生成第 1 章初稿'],
    ['draft_ready', '第 1 章 凌晨三点十七分']
  ] as const)('restores the %s phase from the global planning entry', async (
    phase,
    heading
  ) => {
    const api = installApi();
    api.chapter.inspect
      .mockResolvedValueOnce({
        available: false,
        reason: 'invalid_output'
      })
      .mockResolvedValue({ ...readyChapterInspection, phase });
    api.planning.read.mockResolvedValue({
      available: true,
      documents: [
        {
          kind: 'global_outline',
          title: '全书方向',
          markdown: '# 全书方向\n\n林默追查循环城市。'
        },
        {
          kind: 'volume_outline',
          title: '第一卷',
          markdown: '# 第一卷\n\n从异常报告开始。'
        }
      ],
      arcs: [],
      chapters: []
    });
    api.chapter.readPlan.mockResolvedValue(completeChapterPlan);
    api.chapter.readDraft.mockResolvedValue({
      available: true,
      chapterNumber: 1,
      title: '凌晨三点十七分',
      markdown: '# 第 1 章 凌晨三点十七分\n\n正文',
      versionKind: 'generated',
      scenes: [{ summary: '发现异常报告。' }]
    });
    api.chapter.startDrafting.mockResolvedValue(chapterTask({
      kind: 'drafting',
      stage: 'scene_cards',
      completedStages: ['preparing']
    }));

    render(<App />);
    await openPlanningGenerationFromGlobalPlan();

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
    if (phase === 'drafting_partial') {
      expect(api.chapter.startDrafting).toHaveBeenCalledWith({ projectKey });
    } else {
      expect(api.chapter.startPlanning).not.toHaveBeenCalled();
    }
  });
});
