// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/renderer/src/App';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import type { ProjectSummary } from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';
import {
  completeChapterPlan,
  createInertChapterApi,
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
    inspect: vi.fn().mockResolvedValue({
      ...readyChapterInspection,
      phase: 'plan_ready' as const
    }),
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

async function openReview() {
  fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开《白箱循环》' }));
  fireEvent.click(await screen.findByRole('button', {
    name: '审阅第 1 章方向'
  }));
  await screen.findByRole('heading', { name: '审阅第 1 章方向' });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'novelLoop');
});

describe('chapter plan review', () => {
  test('renders the complete mission and safe selected plan without internals', async () => {
    installApi();
    render(<App />);
    await openReview();

    expect(screen.getByRole('heading', { name: '本章任务' })).toBeVisible();
    expect(screen.getByText(completeChapterPlan.available
      ? completeChapterPlan.mission.chapterFunction
      : '')).toBeVisible();
    for (const heading of [
      '必须完成',
      '读者会知道',
      '读者会追问',
      '本章不能做'
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeVisible();
    }
    expect(screen.getByRole('heading', {
      name: '选定方向：遗物中的异常报告'
    })).toBeVisible();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
    expect(document.body).not.toHaveTextContent(
      /projectKey|taskId|run_|jsonl|ranking|score|private\//i
    );
  });

  test('keeps alternatives collapsed and keyboard reachable', async () => {
    installApi();
    render(<App />);
    await openReview();

    const alternatives = screen.getByRole('group', { name: '其他可选方向' });
    const firstSummary = within(alternatives).getByText('从交通事故切入');
    expect(firstSummary.closest('details')).not.toHaveAttribute('open');
    firstSummary.focus();
    fireEvent.keyDown(firstSummary, { key: 'Enter' });
    expect(firstSummary.closest('details')).toHaveAttribute('open');
    expect(within(alternatives).getByText('行动开场更直接')).toBeVisible();
  });

  test('does not start drafting before the second explicit confirmation', async () => {
    const api = installApi();
    render(<App />);
    await openReview();

    expect(api.chapter.startDrafting).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {
      name: '确认方向并生成草稿'
    }));
    expect(api.chapter.startDrafting).not.toHaveBeenCalled();
    expect(screen.getByText(
      '下一步会生成场景和初稿，正式故事状态仍不会改变。'
    )).toBeVisible();

    api.chapter.startDrafting.mockResolvedValue({
      taskId: 'chapter_0123456789abcdef',
      projectKey,
      kind: 'drafting',
      chapterNumber: 1,
      status: 'running',
      stage: 'preparing',
      completedStages: [],
      sceneProgress: null,
      startedAt: '2026-07-30T01:00:00.000Z',
      updatedAt: '2026-07-30T01:00:01.000Z',
      canCancel: true,
      canRetry: false,
      error: null
    });
    fireEvent.click(screen.getByRole('button', { name: '开始生成草稿' }));
    expect(api.chapter.startDrafting).toHaveBeenCalledWith({ projectKey });
  });
});
