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
import type { ChapterPlanReviewResult } from '../../src/shared/chapterContract';
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
const availablePlan = completeChapterPlan as Extract<
  ChapterPlanReviewResult,
  { available: true }
>;
const noParticipantsPlan: ChapterPlanReviewResult = {
  ...availablePlan,
  mission: {
    ...availablePlan.mission,
    participantOptions: availablePlan.mission.participantOptions.map((item) => ({
      ...item,
      selected: false
    }))
  }
};

function installApi(plan: ChapterPlanReviewResult = completeChapterPlan) {
  const chapter = {
    ...createInertChapterApi(),
    inspect: vi.fn().mockResolvedValue({
      ...readyChapterInspection,
      phase: 'plan_ready' as const
    }),
    readPlan: vi.fn().mockResolvedValue(plan)
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

describe('chapter participant repair', () => {
  test('routes a missing draft participant roster back to the focused mission editor', async () => {
    const api = installApi(noParticipantsPlan);
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', {
      name: '确认方向并生成草稿'
    }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成草稿' }));

    expect(await screen.findByText(
      '本章还没有声明可参与场景的人物。请确认人物后再生成初稿。'
    )).toBeVisible();
    expect(api.chapter.startDrafting).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '补充本章人物' }));

    expect(await screen.findByRole('heading', {
      name: '编辑本章任务'
    })).toHaveFocus();
    expect(screen.getByRole('button', { name: '添加人物' })).toBeVisible();
  });

  test('offers participant repair when an authoring outcome reports the missing roster', async () => {
    const api = installApi();
    api.chapter.selectDirection.mockResolvedValue({
      outcome: 'blocked',
      messageKey: 'participant_roster_missing'
    });
    render(<App />);
    await openReview();

    fireEvent.click(within(screen.getByRole('radio', {
      name: '从交通事故切入'
    })).getByRole('button', { name: '设为本章方向' }));
    fireEvent.click(screen.getByRole('button', {
      name: '确认设为本章方向'
    }));

    expect(await screen.findByText(
      '本章还没有声明可参与场景的人物。请确认人物后再生成初稿。'
    )).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '补充本章人物' }));
    expect(screen.getByRole('heading', {
      name: '编辑本章任务'
    })).toHaveFocus();
  });
});
