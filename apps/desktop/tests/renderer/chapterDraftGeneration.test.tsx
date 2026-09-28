import { createInertDiagnosticRevisionApi } from "./desktopApiFixtures";
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/renderer/src/App';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import type { ProjectSummary } from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';
import {
  chapterTask,
  completeChapterDraft,
  completeChapterPlan,
  createInertChapterApi,
  createInertSubmissionApi,
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

function installApi() {
  const chapter = {
    ...createInertChapterApi(),
    inspect: vi.fn()
      .mockResolvedValueOnce({
        ...readyChapterInspection,
        phase: 'plan_ready' as const
      })
      .mockResolvedValue({
        ...readyChapterInspection,
        phase: 'draft_ready' as const
      }),
    readPlan: vi.fn().mockResolvedValue(completeChapterPlan),
    readDraft: vi.fn().mockResolvedValue(completeChapterDraft)
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
    chapter,
    diagnosticRevision: createInertDiagnosticRevisionApi(),
    submission: createInertSubmissionApi()
  } satisfies NovelLoopDesktopApi;
  Object.defineProperty(window, 'novelLoop', {
    configurable: true,
    value: api
  });
  return api;
}

async function approvePlan() {
  fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开《白箱循环》' }));
  fireEvent.click(await screen.findByRole('button', {
    name: '审阅第 1 章方向'
  }));
  fireEvent.click(await screen.findByRole('button', {
    name: '确认方向并生成草稿'
  }));
  fireEvent.click(screen.getByRole('button', { name: '开始生成草稿' }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'novelLoop');
});

describe('chapter draft generation', () => {
  test('shows scene X/Y progress and supports cooperative stop', async () => {
    const api = installApi();
    api.chapter.startDrafting.mockResolvedValue(chapterTask({
      kind: 'drafting',
      stage: 'scene_drafts',
      completedStages: ['preparing', 'scene_cards'],
      sceneProgress: { current: 1, total: 2 }
    }));
    api.chapter.cancel.mockResolvedValue(chapterTask({
      kind: 'drafting',
      status: 'stop_requested',
      stage: 'scene_drafts',
      completedStages: ['preparing', 'scene_cards'],
      sceneProgress: { current: 1, total: 2 }
    }));

    render(<App />);
    await approvePlan();

    expect(await screen.findByText('正在写第 1 / 2 个场景')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {
      name: '完成当前安全步骤后停止'
    }));
    expect(api.chapter.cancel).toHaveBeenCalledWith({
      taskId: 'chapter_0123456789abcdef'
    });
    expect(screen.getByText(
      '已请求停止，会在当前安全步骤完成后暂停；已写好的场景会保留。'
    )).toBeVisible();
  });

  test('retries a failed draft without exposing internal details', async () => {
    const api = installApi();
    api.chapter.startDrafting
      .mockResolvedValueOnce(chapterTask({
        kind: 'drafting',
        status: 'failed',
        stage: 'scene_drafts',
        completedStages: ['preparing', 'scene_cards'],
        canCancel: false,
        canRetry: true,
        error: { kind: 'invalid_output', message: 'run_1 /private/schema.json' }
      }))
      .mockResolvedValueOnce(chapterTask({
        kind: 'drafting',
        stage: 'scene_drafts',
        completedStages: ['preparing', 'scene_cards']
      }));

    render(<App />);
    await approvePlan();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '本次生成内容暂时无法使用，已完成的场景会保留，可以继续生成。'
    );
    expect(document.body).not.toHaveTextContent(/run_1|private|schema\.json/i);
    fireEvent.click(screen.getByRole('button', { name: '继续生成' }));
    expect(api.chapter.startDrafting).toHaveBeenCalledTimes(2);
  });

  test('keeps draft progress visible when a stop request is temporarily unavailable', async () => {
    const api = installApi();
    api.chapter.startDrafting.mockResolvedValue(chapterTask({
      kind: 'drafting',
      stage: 'scene_cards',
      completedStages: ['preparing']
    }));
    api.chapter.cancel.mockRejectedValue(new Error('/private/cancel failure'));

    render(<App />);
    await approvePlan();
    fireEvent.click(await screen.findByRole('button', {
      name: '完成当前安全步骤后停止'
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('正在安排本章场景')).toBeVisible();
    expect(screen.getByText('暂时无法刷新进度，正在继续尝试。')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('keeps stop_requested monotonic when an older draft poll resolves late', async () => {
    const api = installApi();
    const oldPoll = deferred<ReturnType<typeof chapterTask>>();
    api.chapter.startDrafting.mockResolvedValue(chapterTask({
      kind: 'drafting',
      stage: 'scene_cards',
      completedStages: ['preparing'],
      updatedAt: '2026-07-30T01:00:01.000Z'
    }));
    api.chapter.get.mockReturnValue(oldPoll.promise);
    api.chapter.cancel.mockResolvedValue(chapterTask({
      kind: 'drafting',
      status: 'stop_requested',
      stage: 'scene_cards',
      completedStages: ['preparing'],
      canCancel: false,
      updatedAt: '2026-07-30T01:00:03.000Z'
    }));

    render(<App />);
    await approvePlan();
    vi.useFakeTimers();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('正在安排本章场景')).toBeVisible();
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
      '已请求停止，会在当前安全步骤完成后暂停；已写好的场景会保留。'
    )).toBeVisible();

    await act(async () => {
      oldPoll.resolve(chapterTask({
        kind: 'drafting',
        stage: 'scene_drafts',
        completedStages: ['preparing', 'scene_cards'],
        sceneProgress: { current: 1, total: 2 },
        updatedAt: '2026-07-30T01:00:02.000Z'
      }));
      await Promise.resolve();
    });

    expect(screen.getByText(
      '已请求停止，会在当前安全步骤完成后暂停；已写好的场景会保留。'
    )).toBeVisible();
    expect(screen.queryByRole('button', {
      name: '完成当前安全步骤后停止'
    })).not.toBeInTheDocument();
  });

  test('ignores a late cancel response from draft task A after retry task B starts', async () => {
    const api = installApi();
    const oldCancel = deferred<ReturnType<typeof chapterTask>>();
    const taskAId = 'chapter_aaaaaaaaaaaaaaaa';
    const taskBId = 'chapter_bbbbbbbbbbbbbbbb';
    api.chapter.startDrafting
      .mockResolvedValueOnce(chapterTask({
        taskId: taskAId,
        kind: 'drafting',
        stage: 'scene_cards',
        completedStages: ['preparing']
      }))
      .mockResolvedValueOnce(chapterTask({
        taskId: taskBId,
        kind: 'drafting',
        stage: 'scene_drafts',
        completedStages: ['preparing', 'scene_cards'],
        sceneProgress: { current: 1, total: 2 },
        updatedAt: '2026-07-30T01:00:04.000Z'
      }));
    api.chapter.cancel.mockReturnValue(oldCancel.promise);
    api.chapter.get
      .mockResolvedValueOnce(chapterTask({
        taskId: taskAId,
        kind: 'drafting',
        status: 'failed',
        stage: 'scene_cards',
        completedStages: ['preparing'],
        canCancel: false,
        canRetry: true,
        error: { kind: 'timeout', message: 'Task A timed out.' },
        updatedAt: '2026-07-30T01:00:03.000Z'
      }))
      .mockResolvedValue(chapterTask({
        taskId: taskBId,
        kind: 'drafting',
        stage: 'scene_drafts',
        completedStages: ['preparing', 'scene_cards'],
        sceneProgress: { current: 1, total: 2 },
        updatedAt: '2026-07-30T01:00:05.000Z'
      }));

    render(<App />);
    await approvePlan();
    vi.useFakeTimers();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', {
      name: '完成当前安全步骤后停止'
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    fireEvent.click(screen.getByRole('button', { name: '继续生成' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('正在写第 1 / 2 个场景')).toBeVisible();

    await act(async () => {
      oldCancel.resolve(chapterTask({
        taskId: taskAId,
        kind: 'drafting',
        status: 'cancelled',
        stage: 'scene_cards',
        completedStages: ['preparing'],
        canCancel: false,
        canRetry: true,
        updatedAt: '2026-07-30T01:00:06.000Z'
      }));
      await Promise.resolve();
    });

    expect(screen.getByText('正在写第 1 / 2 个场景')).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(api.chapter.get).toHaveBeenLastCalledWith({ taskId: taskBId });
  });

  test('continues draft polling after a temporary get failure', async () => {
    const api = installApi();
    api.chapter.startDrafting.mockResolvedValue(chapterTask({
      kind: 'drafting',
      stage: 'scene_cards',
      completedStages: ['preparing']
    }));
    api.chapter.get
      .mockRejectedValueOnce(new Error('/private/get unavailable'))
      .mockResolvedValue(chapterTask({
        kind: 'drafting',
        stage: 'scene_drafts',
        completedStages: ['preparing', 'scene_cards'],
        sceneProgress: { current: 1, total: 2 },
        updatedAt: '2026-07-30T01:00:02.000Z'
      }));

    render(<App />);
    await approvePlan();
    vi.useFakeTimers();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('正在安排本章场景')).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText(
      '暂时无法刷新进度，正在继续尝试。'
    )).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText('正在写第 1 / 2 个场景')).toBeVisible();
    expect(screen.queryByText(
      '暂时无法刷新进度，正在继续尝试。'
    )).not.toBeInTheDocument();
  });

  test('ignores an in-flight draft response after unmount', async () => {
    const api = installApi();
    const oldPoll = deferred<ReturnType<typeof chapterTask>>();
    api.chapter.startDrafting.mockResolvedValue(chapterTask({
      kind: 'drafting',
      stage: 'scene_cards',
      completedStages: ['preparing']
    }));
    api.chapter.get.mockReturnValue(oldPoll.promise);

    const rendered = render(<App />);
    await approvePlan();
    vi.useFakeTimers();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('正在安排本章场景')).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const inspectionsBeforeUnmount = api.chapter.inspect.mock.calls.length;
    rendered.unmount();

    await act(async () => {
      oldPoll.resolve(chapterTask({
        kind: 'drafting',
        status: 'succeeded',
        stage: 'completed',
        completedStages: ['preparing', 'scene_cards', 'scene_drafts',
          'draft_assembly', 'finalizing', 'completed'],
        canCancel: false,
        updatedAt: '2026-07-30T01:00:02.000Z'
      }));
      await Promise.resolve();
    });

    expect(api.chapter.inspect).toHaveBeenCalledTimes(inspectionsBeforeUnmount);
  });

  test('keeps success sticky and opens the initial draft after inspection', async () => {
    const api = installApi();
    api.chapter.startDrafting.mockResolvedValue(chapterTask({
      kind: 'drafting',
      stage: 'scene_drafts',
      completedStages: ['preparing', 'scene_cards'],
      sceneProgress: { current: 1, total: 2 }
    }));
    api.chapter.get.mockResolvedValue(chapterTask({
      kind: 'drafting',
      status: 'succeeded',
      stage: 'completed',
      completedStages: [
        'preparing',
        'scene_cards',
        'scene_drafts',
        'draft_assembly',
        'finalizing',
        'completed'
      ],
      sceneProgress: { current: 2, total: 2 },
      canCancel: false
    }));

    render(<App />);
    await approvePlan();
    vi.useFakeTimers();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('heading', {
      name: '第 1 章 凌晨三点十七分'
    })).toBeVisible();
    expect(api.chapter.inspect).toHaveBeenCalledWith({ projectKey });
  });
});
