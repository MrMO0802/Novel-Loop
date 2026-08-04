// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/renderer/src/App';
import {
  ChapterPlanReview
} from '../../src/renderer/src/features/chapter/ChapterPlanReview';
import type { ChapterPlanReviewResult } from '../../src/shared/chapterContract';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import type { ProjectSummary } from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';
import {
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

function directionOption(name: string): HTMLElement {
  const option = screen.getByRole('radio', { name });
  const article = option.closest('article');
  expect(article).not.toBeNull();
  return article!;
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

  test('keeps deferred participant repair focus in the mission editor', async () => {
    const api = installApi(noParticipantsPlan);
    const repairRead = deferred<ChapterPlanReviewResult>();
    api.chapter.readPlan.mockReturnValueOnce(repairRead.promise);
    const props = {
      onBack: vi.fn(),
      onGenerateDraft: vi.fn(),
      project
    };
    const { rerender } = render(
      <ChapterPlanReview initialEditor="mission" {...props} />
    );

    expect(screen.getByRole('heading', {
      name: '审阅第 1 章方向'
    })).not.toHaveFocus();
    await act(async () => repairRead.resolve(noParticipantsPlan));
    const editorHeading = await screen.findByRole('heading', {
      name: '编辑本章任务'
    });
    expect(editorHeading).toHaveFocus();

    rerender(<ChapterPlanReview {...props} />);
    await waitFor(() => expect(api.chapter.readPlan).toHaveBeenCalledTimes(2));

    expect(editorHeading).toHaveFocus();
    expect(screen.getByRole('heading', {
      name: '审阅第 1 章方向'
    })).not.toHaveFocus();
  });

  test('offers participant repair when an authoring outcome reports the missing roster', async () => {
    const api = installApi();
    api.chapter.selectDirection.mockResolvedValue({
      outcome: 'blocked',
      messageKey: 'participant_roster_missing'
    });
    render(<App />);
    await openReview();

    fireEvent.click(within(directionOption('从交通事故切入'))
      .getByRole('button', { name: '设为本章方向' }));
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

  test('uses the fixed AI participant repair instruction and leaves the result pending adoption', async () => {
    const api = installApi();
    api.chapter.selectDirection.mockResolvedValue({
      outcome: 'blocked',
      messageKey: 'participant_roster_missing'
    });
    api.chapter.adjustMission.mockResolvedValue({
      taskId: 'chapter_adjust_participants_01',
      projectKey,
      kind: 'mission_adjustment',
      chapterNumber: 1,
      status: 'succeeded',
      stage: 'ready_for_review',
      completedStages: [
        'requesting_adjustment',
        'validating_adjustment',
        'ready_for_review'
      ],
      sceneProgress: null,
      startedAt: '2026-07-30T01:00:00.000Z',
      updatedAt: '2026-07-30T01:00:01.000Z',
      canCancel: false,
      canRetry: false,
      error: null,
      resultRevisionToken: `chapter_revision_${'d'.repeat(48)}`,
      resultCandidate: {
        artifactKind: 'mission',
        title: '调整后的本章任务',
        markdown: '## 本章人物\n\n- 林默（主角）\n'
      }
    });
    render(<App />);
    await openReview();

    fireEvent.click(within(directionOption('从交通事故切入'))
      .getByRole('button', { name: '设为本章方向' }));
    fireEvent.click(screen.getByRole('button', {
      name: '确认设为本章方向'
    }));
    fireEvent.click(await screen.findByRole('button', {
      name: 'AI 补全本章人物'
    }));

    await waitFor(() => expect(api.chapter.adjustMission).toHaveBeenCalledWith({
      projectKey,
      reviewToken: availablePlan.reviewToken,
      authorInstruction: '补全本章场景所需人物，只声明已有或本章首次出场人物，不新增剧情事实。'
    }));
    expect(await screen.findByRole('region', { name: '对比修改' }))
      .toBeVisible();
    expect(api.chapter.adoptRevision).not.toHaveBeenCalled();
  });

  test.each([
    ['无法读取', { kind: 'unavailable' as const }],
    ['读取被拒绝', { kind: 'rejected' as const }]
  ])('fails closed when participant preflight %s', async (_label, failure) => {
    const api = installApi();
    api.chapter.readPlan.mockResolvedValueOnce(completeChapterPlan);
    if (failure.kind === 'unavailable') {
      api.chapter.readPlan.mockResolvedValueOnce({
        available: false,
        reason: 'not_ready'
      });
    } else {
      api.chapter.readPlan.mockRejectedValueOnce(
        new Error('/tmp/internal-plan.jsonl')
      );
    }
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', {
      name: '确认方向并生成草稿'
    }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成草稿' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '暂时无法核对本章人物，请返回章节方向后重试。'
    );
    expect(api.chapter.startDrafting).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('/tmp/internal-plan.jsonl');
    fireEvent.click(screen.getByRole('button', { name: '返回章节方向' }));
    expect(await screen.findByRole('heading', {
      name: '审阅第 1 章方向'
    })).toHaveFocus();
  });
});
