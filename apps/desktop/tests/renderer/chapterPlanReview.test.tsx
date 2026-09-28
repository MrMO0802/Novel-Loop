import { createInertDiagnosticRevisionApi } from "./desktopApiFixtures";
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
import { StrictMode } from 'react';

import { App } from '../../src/renderer/src/App';
import type {
  ChapterAuthoringResult,
  ChapterPlanReviewResult
} from '../../src/shared/chapterContract';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import type { ProjectSummary } from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';
import {
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
const availablePlan = completeChapterPlan as Extract<
  ChapterPlanReviewResult,
  { available: true }
>;

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

async function openReview() {
  fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开《白箱循环》' }));
  fireEvent.click(await screen.findByRole('button', {
    name: '审阅第 1 章方向'
  }));
  await screen.findByRole('heading', { name: '审阅第 1 章方向' });
}

function planWithActive(directionIndex: number): ChapterPlanReviewResult {
  const direction = availablePlan.directions[directionIndex]!;
  return {
    ...availablePlan,
    reviewToken: `chapter_review_${'a'.repeat(48)}`,
    selectedPlan: {
      title: direction.title,
      markdown: direction.markdown
    },
    directions: availablePlan.directions.map((candidate, index) => ({
      ...candidate,
      active: index === directionIndex
    }))
  };
}

function planWithFreshBindings(directionIndex = 0): ChapterPlanReviewResult {
  const direction = availablePlan.directions[directionIndex]!;
  return {
    ...availablePlan,
    reviewToken: `chapter_review_${'c'.repeat(48)}`,
    mission: {
      ...availablePlan.mission,
      objectiveItems: availablePlan.mission.objectiveItems.map((item, index) => ({
        ...item,
        itemToken: `chapter_option_${String(index + 10).padStart(48, 'd')}`
      })),
      debtItems: availablePlan.mission.debtItems.map((item) => ({
        ...item,
        itemToken: `chapter_option_${'e'.repeat(48)}`
      })),
      characterDeltaItems: availablePlan.mission.characterDeltaItems.map((item) => ({
        ...item,
        participantToken: `chapter_option_${'f'.repeat(48)}`
      })),
      participantOptions: availablePlan.mission.participantOptions.map((item) => ({
        ...item,
        participantToken: `chapter_option_${'f'.repeat(48)}`
      }))
    },
    selectedPlan: {
      title: direction.title,
      markdown: direction.markdown
    },
    directions: availablePlan.directions.map((candidate, index) => ({
      ...candidate,
      optionToken: `chapter_option_${String(index + 20).padStart(48, 'a')}`,
      active: index === directionIndex
    }))
  };
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

describe('chapter plan review', () => {
  test('offers explicit replanning after adopting added participants instead of a read error', async () => {
    const api = installApi();
    render(<App />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: '编辑本章任务' }));
    fireEvent.click(screen.getByRole('button', { name: '添加人物' }));
    fireEvent.change(screen.getByRole('textbox', { name: '新人物 1 姓名' }), {
      target: { value: '周岚' }
    });
    fireEvent.change(screen.getByRole('textbox', { name: '新人物 1 角色' }), {
      target: { value: '事故目击者' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '采用此版' })).toBeEnabled());
    api.chapter.readPlan.mockResolvedValue({ available: false, reason: 'not_ready' });
    api.chapter.inspect.mockResolvedValue({ ...readyChapterInspection, phase: 'planning_partial' });
    fireEvent.click(screen.getByRole('button', { name: '采用此版' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用修订后的任务' }));

    const continueButton = await screen.findByRole('button', { name: '继续准备章节方向' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认方向并生成草稿' })).not.toBeInTheDocument();
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
    expect(api.chapter.startDrafting).not.toHaveBeenCalled();
    fireEvent.click(continueButton);
    expect(await screen.findByRole('button', { name: '开始准备章节方向' })).toBeVisible();
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始准备章节方向' }));
    await waitFor(() => expect(api.chapter.startPlanning).toHaveBeenCalledTimes(1));
  });

  test('recovers a previously invalidated plan on entry without automatically generating', async () => {
    const api = installApi();
    api.chapter.readPlan.mockResolvedValue({ available: false, reason: 'not_ready' });
    render(<App />);
    await openReview();
    // The overview observed an old plan; the review must check the current phase.
    api.chapter.inspect.mockResolvedValue({ ...readyChapterInspection, phase: 'planning_partial' });
    fireEvent.click(await screen.findByRole('button', { name: '重新读取章节方向' }));
    expect(await screen.findByRole('button', { name: '继续准备章节方向' })).toBeVisible();
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
  });

  test('renders every direction as a safe peer option with author controls', async () => {
    const api = installApi();
    api.chapter.readPlan.mockResolvedValue({
      ...availablePlan,
      directions: availablePlan.directions.map((direction, index) => index === 1
        ? {
            ...direction,
            title: 'Untitled Plan',
            markdown: '# Untitled Plan\n\n林默先追查三日前重复发生的交通事故。'
          }
        : direction)
    });
    render(<App />);
    await openReview();

    expect(screen.queryByText('Untitled Plan')).not.toBeInTheDocument();
    const choices = screen.getAllByRole('radio');
    expect(choices).toHaveLength(3);
    expect(choices[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('button', {
      name: '设为本章方向'
    })).toHaveLength(2);
    expect(screen.getAllByRole('button', {
      name: '编辑后使用'
    })).toHaveLength(3);
    for (const button of screen.getAllByRole('button', {
      name: '让 AI 调整此方向'
    })) {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('title');
    }
    expect(screen.getByRole('button', {
      name: '让 AI 调整本章任务'
    })).toBeEnabled();

    const activeDirection = screen.getByRole('radio', {
      name: '遗物中的异常报告'
    });
    expect(within(activeDirection).getByText('AI 推荐')).toBeVisible();
    expect(within(activeDirection).getByText('当前方向')).toBeVisible();
    expect(within(activeDirection).getByText(
      '林默在凌晨整理妹妹遗物，发现一份会自动消失的“白箱市异常回归测试”。'
    )).toBeVisible();
    expect(within(activeDirection).getByText(
      '<img src=x onerror=alert(1)>'
    )).toBeVisible();
    expect(screen.getByText(
      '林默先追查三日前重复发生的交通事故。'
    )).toBeVisible();
    expect(screen.getByText(
      '林默先发现同一段监控被重复覆盖。'
    )).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
    expect(document.body).not.toHaveTextContent(
      /chapter_(?:review|option|revision)_[a-f0-9]+|projectKey|taskId|run_|jsonl|ranking|schema\.json/i
    );
  });

  test('includes the AI recommendation in the radio description', async () => {
    installApi();
    render(<App />);
    await openReview();

    expect(screen.getByRole('radio', {
      description: /AI 推荐/u,
      name: '遗物中的异常报告'
    })).toBeVisible();
  });

  test('creates a pending AI plan comparison and keeps the active direction until adoption', async () => {
    const api = installApi();
    api.chapter.adjustPlan.mockResolvedValue({
      taskId: 'chapter_adjust_plan_01',
      projectKey,
      kind: 'plan_adjustment',
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
      resultRevisionToken: `chapter_revision_${'a'.repeat(48)}`,
      resultCandidate: {
        artifactKind: 'plan',
        title: '事故现场先行',
        markdown: '# 事故现场先行\n\n先展示重复事故，再核对被改写的记录。\n'
      }
    });
    render(<App />);
    await openReview();

    const direction = directionOption('从交通事故切入');
    const adjustmentTrigger = within(direction).getByRole('button', {
      name: '让 AI 调整此方向'
    });
    fireEvent.click(adjustmentTrigger);
    expect(screen.getByRole('heading', {
      name: '调整方向：从交通事故切入'
    })).toHaveFocus();
    expect(screen.getByRole('button', { name: '返回项目概览' }))
      .toBeDisabled();
    expect(screen.getByRole('button', { name: '确认方向并生成草稿' }))
      .toBeDisabled();
    expect(screen.getByText(
      'AI 只会按这条意见局部调整当前方向，并生成一个待比较、待采用的版本；不会自动更换方向或修改正式故事状态。'
    )).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: '调整意见' }), {
      target: { value: '把开场提前到事故现场，但不要新增人物。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始调整' }));

    await waitFor(() => expect(api.chapter.adjustPlan).toHaveBeenCalledWith({
      projectKey,
      reviewToken: availablePlan.reviewToken,
      optionToken: availablePlan.directions[1]!.optionToken,
      authorInstruction: '把开场提前到事故现场，但不要新增人物。'
    }));
    const comparison = await screen.findByRole('region', { name: '对比修改' });
    expect(within(comparison).getByRole('region', {
      name: '修订后的方向'
    })).toHaveTextContent('先展示重复事故，再核对被改写的记录。');
    expect(api.chapter.adoptRevision).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', {
      name: '遗物中的异常报告'
    })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '返回项目概览' }))
      .toBeDisabled();
    expect(screen.getByRole('button', { name: '确认方向并生成草稿' }))
      .toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '保留当前版' }));
    expect(screen.queryByRole('region', { name: '对比修改' }))
      .not.toBeInTheDocument();
    expect(api.chapter.adoptRevision).not.toHaveBeenCalled();
    await waitFor(() => expect(adjustmentTrigger).toHaveFocus());
  });

  test('cancels an in-flight AI adjustment through the opaque task ID', async () => {
    const api = installApi();
    api.chapter.adjustMission.mockResolvedValue({
      taskId: 'chapter_adjust_mission_01',
      projectKey,
      kind: 'mission_adjustment',
      chapterNumber: 1,
      status: 'running',
      stage: 'requesting_adjustment',
      completedStages: [],
      sceneProgress: null,
      startedAt: '2026-07-30T01:00:00.000Z',
      updatedAt: '2026-07-30T01:00:01.000Z',
      canCancel: true,
      canRetry: false,
      error: null
    });
    api.chapter.cancel.mockResolvedValue({
      taskId: 'chapter_adjust_mission_01',
      projectKey,
      kind: 'mission_adjustment',
      chapterNumber: 1,
      status: 'stop_requested',
      stage: 'requesting_adjustment',
      completedStages: [],
      sceneProgress: null,
      startedAt: '2026-07-30T01:00:00.000Z',
      updatedAt: '2026-07-30T01:00:02.000Z',
      canCancel: false,
      canRetry: false,
      error: null
    });
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', {
      name: '让 AI 调整本章任务'
    }));
    fireEvent.change(screen.getByRole('textbox', { name: '调整意见' }), {
      target: { value: '收紧本章任务。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始调整' }));
    expect(await screen.findByText('正在请求 AI 调整')).toBeVisible();
    expect(screen.getByRole('button', {
      name: '让 AI 调整本章任务'
    })).toBeDisabled();
    for (const trigger of screen.getAllByRole('button', {
      name: '让 AI 调整此方向'
    })) {
      expect(trigger).toBeDisabled();
    }
    fireEvent.click(screen.getByRole('button', { name: '取消调整' }));

    await waitFor(() => expect(api.chapter.cancel).toHaveBeenCalledWith({
      taskId: 'chapter_adjust_mission_01'
    }));
    expect(document.body).not.toHaveTextContent(
      /sourceHash|author_revision|provider|schema|\/private\//iu
    );
  });

  test('sanitizes an untitled direction in the chooser, editor, and preview', async () => {
    const api = installApi();
    api.chapter.readPlan.mockResolvedValue({
      ...availablePlan,
      directions: availablePlan.directions.map((direction, index) => index === 1
        ? {
            ...direction,
            title: 'Untitled Plan',
            markdown: '# Untitled Plan\n\n林默先追查交通事故。'
          }
        : direction)
    });
    render(<App />);
    await openReview();

    const sanitized = directionOption('方向 2');
    expect(document.body).not.toHaveTextContent('Untitled Plan');
    fireEvent.click(within(sanitized).getByRole('button', {
      name: '编辑后使用'
    }));
    expect(screen.getByRole('heading', {
      name: '编辑方向：方向 2'
    })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    expect(document.body).not.toHaveTextContent('Untitled Plan');
    expect(within(screen.getByRole('region', {
      name: '章节规划预览'
    })).getByRole('heading', { name: '方向 2' })).toBeVisible();
  });

  test('selects an alternative only after warning and restores focus on cancel', async () => {
    const api = installApi();
    api.chapter.readPlan
      .mockResolvedValueOnce(completeChapterPlan)
      .mockResolvedValue(planWithActive(1));
    render(<App />);
    await openReview();

    const trigger = within(directionOption('从交通事故切入'))
      .getByRole('button', { name: '设为本章方向' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('heading', {
      name: '确认更换本章方向'
    })).toHaveFocus();
    expect(screen.getByText('场景规划、场景草稿、章节初稿')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', {
      name: '确认设为本章方向'
    }));

    expect(api.chapter.selectDirection).toHaveBeenCalledWith({
      projectKey,
      reviewToken: availablePlan.reviewToken,
      optionToken: availablePlan.directions[1]!.optionToken
    });
    await waitFor(() => expect(screen.getByRole('radio', {
      name: '从交通事故切入'
    })).toHaveAttribute('aria-checked', 'true'));
    expect(within(screen.getByRole('radio', {
      name: '从交通事故切入'
    })).getByText('当前方向')).toBeVisible();
  });

  test('implements roving radio focus and keyboard selection without nested controls', async () => {
    installApi();
    render(<App />);
    await openReview();

    const choices = screen.getAllByRole('radio');
    const first = choices[0]!;
    const second = choices[1]!;
    expect(within(first).queryAllByRole('button')).toHaveLength(0);
    expect(within(second).queryAllByRole('button')).toHaveLength(0);

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    await waitFor(() => expect(second).toHaveAttribute('tabindex', '0'));
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(screen.getByRole('heading', {
      name: '确认更换本章方向'
    })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(second).toHaveFocus();

    fireEvent.keyDown(second, { key: ' ' });
    expect(screen.getByRole('heading', {
      name: '确认更换本章方向'
    })).toHaveFocus();
  });

  test('resets mission bindings when a successful refresh returns fresh tokens', async () => {
    const api = installApi();
    const fresh = planWithFreshBindings(1) as Extract<
      ChapterPlanReviewResult,
      { available: true }
    >;
    api.chapter.readPlan
      .mockResolvedValueOnce(completeChapterPlan)
      .mockResolvedValueOnce(fresh);
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: '编辑本章任务' }));
    fireEvent.click(within(directionOption('从交通事故切入'))
      .getByRole('button', { name: '设为本章方向' }));
    fireEvent.click(screen.getByRole('button', {
      name: '确认设为本章方向'
    }));

    await waitFor(() => expect(screen.queryByRole('heading', {
      name: '编辑本章任务'
    })).not.toBeInTheDocument());
    expect(screen.getByRole('radio', {
      name: '从交通事故切入'
    })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: '编辑本章任务' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.chapter.saveMissionWorkingCopy)
      .toHaveBeenCalledWith(expect.objectContaining({
        reviewToken: fresh.reviewToken,
        mission: expect.objectContaining({
          requiredObjectives: fresh.mission.objectiveItems.map((item) => ({
            itemToken: item.itemToken,
            text: item.text,
            type: item.type,
            priority: item.priority
          })),
          debtTokens: fresh.mission.debtItems.map(({ itemToken }) => itemToken),
          participantTokens: fresh.mission.participantOptions
            .filter(({ selected }) => selected)
            .map(({ participantToken }) => participantToken),
          characterDeltas: fresh.mission.characterDeltaItems.map((item) => ({
            participantToken: item.participantToken,
            from: item.from,
            to: item.to,
            evidenceRequired: item.evidenceRequired
          }))
        })
      })));

    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    fireEvent.click(within(directionOption('遗物中的异常报告'))
      .getByRole('button', { name: '编辑后使用' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.chapter.savePlanWorkingCopy)
      .toHaveBeenCalledWith({
        projectKey,
        reviewToken: fresh.reviewToken,
        optionToken: fresh.directions[0]!.optionToken,
        markdown: fresh.directions[0]!.markdown
      }));
  });

  test.each([
    ['读取失败', () => Promise.reject(new Error('/tmp/raw-review.jsonl'))],
    ['内容未就绪', () => Promise.resolve({
      available: false as const,
      reason: 'not_ready' as const
    })]
  ])('hides stale review content after refresh %s and offers bounded recovery', async (
    _label,
    nextRead
  ) => {
    const api = installApi();
    api.chapter.readPlan
      .mockResolvedValueOnce(completeChapterPlan)
      .mockImplementationOnce(nextRead)
      .mockResolvedValue(planWithFreshBindings(1));
    render(<App />);
    await openReview();

    fireEvent.click(within(directionOption('从交通事故切入'))
      .getByRole('button', { name: '设为本章方向' }));
    fireEvent.click(screen.getByRole('button', {
      name: '确认设为本章方向'
    }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '暂时无法读取章节方向，请重试。'
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('/tmp/raw-review.jsonl');
    fireEvent.click(screen.getByRole('button', { name: '重新读取章节方向' }));
    expect(await screen.findByRole('radio', {
      name: '从交通事故切入'
    })).toHaveAttribute('aria-checked', 'true');
  });

  test('ignores an older review response that completes after a fresh one', async () => {
    const api = installApi();
    const older = deferred<ChapterPlanReviewResult>();
    api.chapter.readPlan
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(planWithFreshBindings(1));
    render(<StrictMode><App /></StrictMode>);
    await openReview();

    expect(await screen.findByRole('radio', {
      name: '从交通事故切入'
    })).toHaveAttribute('aria-checked', 'true');
    await act(async () => older.resolve(completeChapterPlan));
    expect(screen.getByRole('radio', {
      name: '从交通事故切入'
    })).toHaveAttribute('aria-checked', 'true');
  });

  test('keeps the newest review when overlapping adoption refreshes finish out of order', async () => {
    const api = installApi();
    const selection = deferred<ChapterAuthoringResult>();
    const adoption = deferred<ChapterAuthoringResult>();
    const olderRefresh = deferred<ChapterPlanReviewResult>();
    api.chapter.selectDirection.mockReturnValue(selection.promise);
    api.chapter.adoptRevision.mockReturnValue(adoption.promise);
    api.chapter.readPlan
      .mockResolvedValueOnce(completeChapterPlan)
      .mockReturnValueOnce(olderRefresh.promise)
      .mockResolvedValueOnce(planWithFreshBindings(2));
    render(<App />);
    await openReview();

    fireEvent.click(within(directionOption('从交通事故切入'))
      .getByRole('button', { name: '编辑后使用' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('已保存，等待采用');
    fireEvent.click(screen.getByRole('button', { name: '对比修改' }));
    fireEvent.click(screen.getByRole('button', { name: '采用此版' }));

    fireEvent.click(within(directionOption('从监控记录切入'))
      .getByRole('button', { name: '设为本章方向' }));
    fireEvent.click(screen.getByRole('button', {
      name: '确认设为本章方向'
    }));
    fireEvent.click(screen.getByRole('button', {
      name: '确认采用修订后的方向'
    }));

    await act(async () => selection.resolve({ outcome: 'adopted' }));
    await waitFor(() => expect(api.chapter.readPlan).toHaveBeenCalledTimes(2));
    await act(async () => adoption.resolve({ outcome: 'adopted' }));
    expect(await screen.findByRole('radio', {
      name: '从监控记录切入'
    })).toHaveAttribute('aria-checked', 'true');

    await act(async () => olderRefresh.resolve(completeChapterPlan));
    expect(screen.getByRole('radio', {
      name: '从监控记录切入'
    })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', {
      name: '遗物中的异常报告'
    })).toHaveAttribute('aria-checked', 'false');
  });

  test('saves a structured mission with only opaque tokens and author values', async () => {
    const api = installApi();
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: '编辑本章任务' }));
    expect(screen.getByRole('heading', { name: '编辑本章任务' })).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox', { name: '本章目的' }), {
      target: { value: '让林默主动追查被删除的异常报告。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加人物' }));
    fireEvent.change(screen.getByRole('textbox', { name: '新人物 1 姓名' }), {
      target: { value: '周岚' }
    });
    fireEvent.change(screen.getByRole('textbox', { name: '新人物 1 角色' }), {
      target: { value: '事故目击者' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.chapter.saveMissionWorkingCopy)
      .toHaveBeenCalledWith({
        projectKey,
        reviewToken: availablePlan.reviewToken,
        mission: {
          chapterFunction: '让林默主动追查被删除的异常报告。',
          requiredObjectives: availablePlan.mission.objectiveItems.map((item) => ({
            itemToken: item.itemToken,
            text: item.text,
            type: item.type,
            priority: item.priority
          })),
          debtTokens: availablePlan.mission.debtItems.map(({ itemToken }) => itemToken),
          debtsToIntroduce: [],
          characterDeltas: availablePlan.mission.characterDeltaItems.map((item) => ({
            participantToken: item.participantToken,
            from: item.from,
            to: item.to,
            evidenceRequired: item.evidenceRequired
          })),
          participantTokens: [
            availablePlan.mission.participantOptions[0]!.participantToken
          ],
          newParticipants: [{ name: '周岚', role: '事故目击者' }],
          readerInformation: availablePlan.mission.readerInformation,
          forbiddenMoves: availablePlan.mission.forbiddenMoves,
          targetEmotionalCurve: availablePlan.mission.targetEmotionalCurve,
          targetWordCount: availablePlan.mission.targetWordCount
        }
      }));
    const savedStatus = screen.getByText('已保存，等待采用');
    expect(savedStatus).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: '对比修改' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '采用此版' })).toBeEnabled();
    expect(document.body).not.toHaveTextContent(/chapter_(?:option|revision)_/i);
  });

  test('keeps a mission unsaved when the author types after submitting a save', async () => {
    const api = installApi();
    const pending = deferred<ChapterAuthoringResult>();
    api.chapter.saveMissionWorkingCopy.mockReturnValue(pending.promise);
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: '编辑本章任务' }));
    const purpose = screen.getByRole('textbox', { name: '本章目的' });
    fireEvent.change(purpose, {
      target: { value: '提交时的本章目的。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.chapter.saveMissionWorkingCopy)
      .toHaveBeenCalledWith(expect.objectContaining({
        mission: expect.objectContaining({
          chapterFunction: '提交时的本章目的。'
        })
      })));
    fireEvent.change(purpose, {
      target: { value: '请求未完成时继续修改的本章目的。' }
    });
    await act(async () => pending.resolve({
      outcome: 'saved',
      revisionToken: `chapter_revision_${'8'.repeat(48)}`
    }));

    expect(purpose).toHaveValue('请求未完成时继续修改的本章目的。');
    expect(screen.getByText('未保存')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: '对比修改' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '采用此版' })).toBeDisabled();
    expect(api.chapter.adoptRevision).not.toHaveBeenCalled();
  });

  test('keeps bound debts canonical and compares exactly submitted debt values', async () => {
    const api = installApi();
    api.chapter.readPlan
      .mockResolvedValueOnce(completeChapterPlan)
      .mockResolvedValueOnce(planWithFreshBindings());
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: '编辑本章任务' }));
    const canonicalDebt = '推进“谁在删除异常报告”的悬念';
    expect(screen.getByRole('region', {
      name: '已有悬念与承诺'
    })).toHaveTextContent(canonicalDebt);
    expect(screen.getByText(
      '已有悬念与承诺来自当前故事状态，保存时会按原文保留。你可以在下方新增本章要引入的内容。'
    )).toBeVisible();
    expect(screen.queryByRole('textbox', {
      name: '推进的悬念与承诺 1'
    })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '添加悬念与承诺' }));
    fireEvent.change(screen.getByRole('textbox', {
      name: '新增悬念与承诺 1'
    }), {
      target: { value: '建立林夕留下第二份报告的新悬念' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.chapter.saveMissionWorkingCopy)
      .toHaveBeenCalledWith(expect.objectContaining({
        mission: expect.objectContaining({
          debtTokens: [availablePlan.mission.debtItems[0]!.itemToken],
          debtsToIntroduce: [{
            importance: 5,
            promise: '建立林夕留下第二份报告的新悬念',
            type: 'promise'
          }],
          characterDeltas: [{
            participantToken: availablePlan.mission.characterDeltaItems[0]!
              .participantToken,
            from: '逃避妹妹失踪',
            to: '主动追查循环',
            evidenceRequired: '亲手记下报告消失前的最后一行'
          }]
        })
      })));
    expect(api.chapter.adoptRevision).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '对比修改' }));
    const comparison = screen.getByRole('region', { name: '对比修改' });
    expect(within(comparison).getByRole('region', {
      name: '本章任务'
    })).toBeVisible();
    const candidate = within(comparison).getByRole('region', {
      name: '修订后的任务'
    });
    expect(candidate).toHaveTextContent(canonicalDebt);
    expect(candidate).toHaveTextContent('建立林夕留下第二份报告的新悬念');
    expect(candidate).not.toHaveTextContent(
      '建立林夕可能仍在下一轮循环中的故事承诺'
    );
    fireEvent.click(screen.getByRole('button', { name: '采用此版' }));
    expect(screen.getByRole('heading', {
      name: '确认采用修订后的任务'
    })).toHaveFocus();
    expect(screen.getByText(
      '采用后，方案候选、方向排序、选定方案、场景规划、场景草稿和章节初稿将按照修订后的任务重新构建。'
    )).toBeVisible();
    expect(screen.getByText(
      '方案候选、方向排序、选定方案、场景规划、场景草稿、章节初稿'
    )).toBeVisible();
    fireEvent.click(screen.getByRole('button', {
      name: '确认采用修订后的任务'
    }));
    await waitFor(() => expect(api.chapter.adoptRevision).toHaveBeenCalledWith({
      projectKey,
      revisionToken: `chapter_revision_${'8'.repeat(48)}`,
      confirmInvalidation: true
    }));
  });

  test('shows the canonical character binding submitted with a mission change', async () => {
    const api = installApi();
    const alternateParticipantToken = `chapter_option_${'6'.repeat(48)}`;
    api.chapter.readPlan.mockResolvedValue({
      ...availablePlan,
      mission: {
        ...availablePlan.mission,
        participantOptions: [
          ...availablePlan.mission.participantOptions,
          {
            name: '周岚',
            participantToken: alternateParticipantToken,
            role: '事故目击者',
            selected: true
          }
        ]
      }
    });
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: '编辑本章任务' }));
    fireEvent.change(screen.getByRole('combobox', {
      name: '人物变化 1 人物'
    }), {
      target: { value: '1' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.chapter.saveMissionWorkingCopy)
      .toHaveBeenCalledWith(expect.objectContaining({
        mission: expect.objectContaining({
          characterDeltas: [{
            evidenceRequired: '亲手记下报告消失前的最后一行',
            from: '逃避妹妹失踪',
            participantToken: alternateParticipantToken,
            to: '主动追查循环'
          }]
        })
      })));

    fireEvent.click(screen.getByRole('button', { name: '对比修改' }));
    const comparison = screen.getByRole('region', { name: '对比修改' });
    const candidate = within(comparison).getByRole('region', {
      name: '修订后的任务'
    });
    expect(candidate).toHaveTextContent(
      '周岚（事故目击者）：逃避妹妹失踪 → 主动追查循环；亲手记下报告消失前的最后一行'
    );
    expect(document.body).not.toHaveTextContent(alternateParticipantToken);
  });

  test('restores direct mission adoption cancel to the original editor trigger', async () => {
    const api = installApi();
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: '编辑本章任务' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('已保存，等待采用');
    const trigger = screen.getByRole('button', { name: '采用此版' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('heading', {
      name: '确认采用修订后的任务'
    })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toBeInTheDocument();
    expect(api.chapter.adoptRevision).not.toHaveBeenCalled();
  });

  test('rejects a partially blank character change with a field error', async () => {
    const api = installApi();
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: '编辑本章任务' }));
    const changedTo = screen.getByRole('textbox', {
      name: '人物变化 1 变化后'
    });
    fireEvent.change(changedTo, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '请完整填写每项人物变化的变化前、变化后和呈现依据。'
    );
    expect(changedTo).toHaveAttribute('aria-invalid', 'true');
    expect(api.chapter.saveMissionWorkingCopy).not.toHaveBeenCalled();
  });

  test('edits and previews any direction without selecting it first', async () => {
    const api = installApi();
    render(<App />);
    await openReview();

    const alternative = directionOption('从交通事故切入');
    fireEvent.click(within(alternative).getByRole('button', {
      name: '编辑后使用'
    }));
    expect(screen.getByRole('heading', {
      name: '编辑方向：从交通事故切入'
    })).toHaveFocus();

    const markdown = '# 事故现场\n\n林默提前到达事故现场。';
    const editor = screen.getByRole('textbox', { name: '章节规划 Markdown' });
    fireEvent.change(editor, { target: { value: markdown } });
    expect(screen.getByText('未保存')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(/^\d+ 字$/)).toBeVisible();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    expect(screen.getByText('林默提前到达事故现场。')).toBeVisible();
    expect(editor).toBeInTheDocument();
    expect(editor).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByRole('textbox', {
      name: '章节规划 Markdown'
    })).toBe(editor);
    expect(editor).toHaveValue(markdown);

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.chapter.savePlanWorkingCopy)
      .toHaveBeenCalledWith({
        projectKey,
        reviewToken: availablePlan.reviewToken,
        optionToken: availablePlan.directions[1]!.optionToken,
        markdown
      }));
    expect(api.chapter.selectDirection).not.toHaveBeenCalled();
    expect(api.chapter.adoptRevision).not.toHaveBeenCalled();
    expect(screen.getByText('已保存，等待采用')).toBeVisible();
    expect(screen.getByRole('radio', {
      name: '遗物中的异常报告'
    })).toHaveAttribute('aria-checked', 'true');
  });

  test('keeps a plan unsaved when the author types after submitting a save', async () => {
    const api = installApi();
    const pending = deferred<ChapterAuthoringResult>();
    api.chapter.savePlanWorkingCopy.mockReturnValue(pending.promise);
    render(<App />);
    await openReview();

    fireEvent.click(within(directionOption('从交通事故切入'))
      .getByRole('button', { name: '编辑后使用' }));
    const editor = screen.getByRole('textbox', { name: '章节规划 Markdown' });
    fireEvent.change(editor, {
      target: { value: '# 提交版\n\n这是提交时的章节规划。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.chapter.savePlanWorkingCopy)
      .toHaveBeenCalledWith({
        projectKey,
        reviewToken: availablePlan.reviewToken,
        optionToken: availablePlan.directions[1]!.optionToken,
        markdown: '# 提交版\n\n这是提交时的章节规划。'
      }));
    fireEvent.change(editor, {
      target: { value: '# 新修改\n\n请求未完成时继续写的内容。' }
    });
    await act(async () => pending.resolve({
      outcome: 'saved',
      revisionToken: `chapter_revision_${'9'.repeat(48)}`
    }));

    expect(editor).toHaveValue('# 新修改\n\n请求未完成时继续写的内容。');
    expect(screen.getByText('未保存')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: '对比修改' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '采用此版' })).toBeDisabled();
    expect(api.chapter.adoptRevision).not.toHaveBeenCalled();
  });

  test('compares a pending plan and adopts it only after a second confirmation', async () => {
    const api = installApi();
    api.chapter.readPlan
      .mockResolvedValueOnce(completeChapterPlan)
      .mockResolvedValue(planWithActive(1));
    render(<App />);
    await openReview();

    fireEvent.click(within(directionOption('从交通事故切入'))
      .getByRole('button', { name: '编辑后使用' }));
    const markdown = '# 事故现场\n\n林默提前到达事故现场。';
    fireEvent.change(screen.getByRole('textbox', {
      name: '章节规划 Markdown'
    }), { target: { value: markdown } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('已保存，等待采用');
    fireEvent.click(screen.getByRole('button', { name: '对比修改' }));

    expect(screen.getByRole('heading', { name: '对比修改' })).toHaveFocus();
    expect(screen.getByRole('region', { name: '当前方向' })).toHaveTextContent(
      '林默先追查三日前重复发生的交通事故。'
    );
    expect(screen.getByRole('region', { name: '修订后的方向' })).toHaveTextContent(
      '林默提前到达事故现场。'
    );
    fireEvent.click(screen.getByRole('button', { name: '返回编辑' }));
    expect(screen.getByRole('button', { name: '对比修改' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '对比修改' }));
    fireEvent.click(screen.getByRole('button', { name: '采用此版' }));
    expect(api.chapter.adoptRevision).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', {
      name: '确认采用修订后的方向'
    })).toHaveFocus();
    expect(screen.getByText(
      '采用后，后续场景规划、场景草稿和章节初稿将按照修订后的方向重新准备。'
    )).toBeVisible();
    expect(screen.getByText('场景规划、场景草稿、章节初稿')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {
      name: '确认采用修订后的方向'
    }));

    await waitFor(() => expect(api.chapter.adoptRevision).toHaveBeenCalledWith({
      projectKey,
      revisionToken: `chapter_revision_${'9'.repeat(48)}`,
      confirmInvalidation: true
    }));
    await waitFor(() => expect(screen.queryByRole('heading', {
      name: '编辑方向：从交通事故切入'
    })).not.toBeInTheDocument());
    expect(screen.getByRole('radio', {
      name: '从交通事故切入'
    })).toHaveAttribute('aria-checked', 'true');
  });

  test.each([
    [
      { outcome: 'stale', messageKey: 'stale_edit' },
      '内容已变化，请重新对比后采用。你的编辑草稿仍然保留。'
    ],
    [
      { outcome: 'blocked', messageKey: 'generation_busy' },
      '当前已有任务正在运行，请等待完成或先取消任务。'
    ],
    [
      { outcome: 'invalid', messageKey: 'invalid_output' },
      'AI 返回的内容暂时无法使用，请调整意见后重试。'
    ],
    [
      { outcome: 'invalid', messageKey: 'project_unavailable' },
      '当前项目暂时无法读取，请返回作品库后重新打开。'
    ]
  ] satisfies Array<[ChapterAuthoringResult, string]>) (
    'maps authoring response %j to safe Chinese copy',
    async (result, message) => {
      const api = installApi();
      api.chapter.savePlanWorkingCopy.mockResolvedValue(result);
      render(<App />);
      await openReview();

      fireEvent.click(within(directionOption('从交通事故切入'))
        .getByRole('button', { name: '编辑后使用' }));
      const editor = screen.getByRole('textbox', {
        name: '章节规划 Markdown'
      });
      fireEvent.change(editor, {
        target: { value: '# 保留草稿\n\n作者修改仍在这里。' }
      });
      fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(editor).toHaveValue('# 保留草稿\n\n作者修改仍在这里。');
      expect(document.body).not.toHaveTextContent(
        /stale_edit|generation_busy|invalid_output|project_unavailable/i
      );
    }
  );

  test('keeps the existing explicit confirmation before draft generation', async () => {
    const api = installApi();
    render(<App />);
    await openReview();

    const trigger = screen.getByRole('button', {
      name: '确认方向并生成草稿'
    });
    trigger.focus();
    fireEvent.click(trigger);
    expect(api.chapter.startDrafting).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', {
      name: '确认开始生成初稿'
    })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', {
      name: '确认方向并生成草稿'
    })).toHaveFocus();
  });

  test('blocks draft confirmation while an author working copy is open', async () => {
    installApi();
    render(<App />);
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: '编辑本章任务' }));

    expect(screen.getByRole('button', {
      name: '确认方向并生成草稿'
    })).toBeDisabled();
  });
});
