// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

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

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'novelLoop');
});

describe('chapter plan review', () => {
  test('renders every direction as a safe peer option with author controls', async () => {
    const api = installApi();
    api.chapter.readPlan.mockResolvedValue({
      ...availablePlan,
      selectedPlan: {
        ...availablePlan.selectedPlan,
        title: 'Untitled Plan'
      }
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
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', '将在下一阶段开放');
    }

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

  test('selects an alternative only after warning and restores focus on cancel', async () => {
    const api = installApi();
    api.chapter.readPlan
      .mockResolvedValueOnce(completeChapterPlan)
      .mockResolvedValue(planWithActive(1));
    render(<App />);
    await openReview();

    const trigger = within(screen.getByRole('radio', {
      name: '从交通事故切入'
    })).getByRole('button', { name: '设为本章方向' });
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
          debtTokens: [],
          debtsToIntroduce: [],
          characterDeltas: [],
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

  test('edits and previews any direction without selecting it first', async () => {
    const api = installApi();
    render(<App />);
    await openReview();

    const alternative = screen.getByRole('radio', { name: '从交通事故切入' });
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
    fireEvent.click(screen.getByRole('tab', { name: '预览' }));
    expect(screen.getByText('林默提前到达事故现场。')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '编辑' }));
    expect(screen.getByRole('textbox', {
      name: '章节规划 Markdown'
    })).toHaveValue(markdown);

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.chapter.savePlanWorkingCopy)
      .toHaveBeenCalledWith({
        projectKey,
        reviewToken: availablePlan.reviewToken,
        optionToken: availablePlan.directions[1]!.optionToken,
        markdown
      }));
    expect(api.chapter.selectDirection).not.toHaveBeenCalled();
    expect(screen.getByText('已保存，等待采用')).toBeVisible();
    expect(screen.getByRole('radio', {
      name: '遗物中的异常报告'
    })).toHaveAttribute('aria-checked', 'true');
  });

  test('compares a pending plan and adopts it only after a second confirmation', async () => {
    const api = installApi();
    api.chapter.readPlan
      .mockResolvedValueOnce(completeChapterPlan)
      .mockResolvedValue(planWithActive(1));
    render(<App />);
    await openReview();

    fireEvent.click(within(screen.getByRole('radio', {
      name: '从交通事故切入'
    })).getByRole('button', { name: '编辑后使用' }));
    const markdown = '# 事故现场\n\n林默提前到达事故现场。';
    fireEvent.change(screen.getByRole('textbox', {
      name: '章节规划 Markdown'
    }), { target: { value: markdown } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('已保存，等待采用');
    fireEvent.click(screen.getByRole('button', { name: '对比修改' }));

    expect(screen.getByRole('heading', { name: '对比修改' })).toHaveFocus();
    expect(screen.getByRole('region', { name: '原方向' })).toHaveTextContent(
      '林默先追查三日前重复发生的交通事故。'
    );
    expect(screen.getByRole('region', { name: '修改后' })).toHaveTextContent(
      '林默提前到达事故现场。'
    );
    fireEvent.click(screen.getByRole('button', { name: '采用此版' }));
    expect(api.chapter.adoptRevision).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '确认采用此版' })).toHaveFocus();
    expect(screen.getByText('场景规划、场景草稿、章节初稿')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认采用此版' }));

    await waitFor(() => expect(api.chapter.adoptRevision).toHaveBeenCalledWith({
      projectKey,
      revisionToken: `chapter_revision_${'9'.repeat(48)}`,
      confirmInvalidation: true
    }));
    expect(await screen.findByText('已采用')).toHaveAttribute(
      'aria-live',
      'polite'
    );
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
    ]
  ] satisfies Array<[ChapterAuthoringResult, string]>) (
    'maps authoring response %j to safe Chinese copy',
    async (result, message) => {
      const api = installApi();
      api.chapter.savePlanWorkingCopy.mockResolvedValue(result);
      render(<App />);
      await openReview();

      fireEvent.click(within(screen.getByRole('radio', {
        name: '从交通事故切入'
      })).getByRole('button', { name: '编辑后使用' }));
      const editor = screen.getByRole('textbox', {
        name: '章节规划 Markdown'
      });
      fireEvent.change(editor, {
        target: { value: '# 保留草稿\n\n作者修改仍在这里。' }
      });
      fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(editor).toHaveValue('# 保留草稿\n\n作者修改仍在这里。');
      expect(document.body).not.toHaveTextContent(/stale_edit|generation_busy|invalid_output/i);
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
});
