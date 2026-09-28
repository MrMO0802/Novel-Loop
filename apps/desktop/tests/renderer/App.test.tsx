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

import { App } from '../../src/renderer/src/App';
import type {
  NovelLoopDesktopApi
} from '../../src/shared/desktopApi';
import { chapterTask, completeChapterDraft, createInertChapterApi, createInertSubmissionApi, deferred, readyChapterInspection } from './desktopApiFixtures';
import { SubmissionConfirmResultSchema, SubmissionPreviewResultSchema, SubmissionTaskSchema } from '../../src/shared/submissionContract';
import type {
  ProjectSummary
} from '../../src/shared/projectContract';
import type {
  SystemReadiness
} from '../../src/shared/systemContract';
import { SystemReadinessSchema } from '../../src/shared/systemContract';

const baseReadiness: SystemReadiness = {
  app: {
    name: 'Novel Loop',
    platform: 'linux',
    version: '0.1.0'
  },
  checkedAt: '2026-07-27T03:00:00.000Z',
  codex: {
    canRunSmoke: true,
    status: 'ready',
    summary: '本地 Codex 已准备好。',
    version: 'codex-cli 1.2.3'
  }
};

const incompleteProject: ProjectSummary = {
  projectKey: 'project_0123456789abcdef01234567',
  title: '状态边界',
  latestCommittedChapter: 0,
  health: 'ready',
  lastOpenedAt: '2026-07-28T03:00:00.000Z',
  briefExcerpt: '故事基础只能生成策略文档。',
  locationLabel: '测试作品库',
  storyBibleAvailable: false,
  globalPlanAvailable: false
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'novelLoop');
});

function installReadiness(
  response: SystemReadiness | Promise<SystemReadiness>
) {
  const getReadiness = vi.fn().mockImplementation(async () => response);
  Object.defineProperty(window, 'novelLoop', {
    configurable: true,
    value: {
      system: {
        getReadiness
      },
      projects: {
        list: vi.fn().mockResolvedValue({
          projects: [],
          defaultLocation: {
            configured: false,
            locationLabel: null
          },
          warning: null
        }),
        chooseDefaultLibrary: vi.fn(),
        create: vi.fn(),
        openExisting: vi.fn(),
        open: vi.fn(),
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
      chapter: createInertChapterApi(),
      diagnosticRevision: createInertDiagnosticRevisionApi(),
    submission: createInertSubmissionApi()
    } satisfies NovelLoopDesktopApi
  });
  return getReadiness;
}

function installProjectApi(project: ProjectSummary) {
  const api = {
    system: { getReadiness: vi.fn().mockResolvedValue(baseReadiness) },
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
    chapter: createInertChapterApi(),
    diagnosticRevision: createInertDiagnosticRevisionApi(),
    submission: createInertSubmissionApi()
  } satisfies NovelLoopDesktopApi;
  Object.defineProperty(window, 'novelLoop', {
    configurable: true,
    value: api
  });
  return api;
}

async function openProjectFromLibrary(project: ProjectSummary) {
  fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
  fireEvent.click(await screen.findByRole('button', {
    name: `打开《${project.title}》`
  }));
  await screen.findByRole('heading', { name: project.title });
}

describe('production first-launch readiness', () => {
  test('explains an incomplete installation and rechecks successfully after repair', async () => {
    const getReadiness = installReadiness(SystemReadinessSchema.parse({
      ...baseReadiness,
      codex: {
        status: 'installation_incomplete',
        canRunSmoke: false,
        summary: 'private provider output must not be rendered',
        version: null
      }
    }));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Codex 安装不完整' })).toBeVisible();
    expect(screen.getByText('请修复或重新安装本机 Codex，然后点击重新检查。你的小说项目不会受到影响。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '进入作品库' })).not.toBeInTheDocument();
    expect(screen.queryByText(/private provider/)).not.toBeInTheDocument();
    getReadiness.mockResolvedValue(baseReadiness);
    fireEvent.click(screen.getByRole('button', { name: '修复后重新检查' }));
    fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
    expect(await screen.findByRole('heading', { name: '作品库', level: 1 })).toBeVisible();
  });

  test('announces loading while the local check is running', () => {
    installReadiness(new Promise(() => {}));

    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent(
      '正在检查本地创作环境'
    );
    expect(screen.getByRole('heading', {
      name: '正在确认这台电脑是否已经准备好'
    })).toBeVisible();
  });

  test('offers the project library when Codex is ready', async () => {
    installReadiness({
      ...baseReadiness,
      codex: {
        ...baseReadiness.codex,
        summary: 'CODEX_READY at /private/auth/token.json'
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', {
      name: '本地创作环境已准备好'
    })).toBeVisible();
    expect(screen.getByText('codex-cli 1.2.3')).toBeVisible();
    expect(screen.getByRole('button', { name: '进入作品库' })).toBeEnabled();
    expect(document.body).not.toHaveTextContent(
      /CODEX_READY|private|auth|token|json/i
    );
  });

  test('enters the real project library from readiness', async () => {
    installReadiness(baseReadiness);

    render(<App />);

    fireEvent.click(await screen.findByRole('button', {
      name: '进入作品库'
    }));
    expect(await screen.findByRole('heading', {
      level: 1,
      name: '作品库'
    })).toHaveFocus();
    expect(screen.getByRole('button', { name: '新建小说' })).toBeEnabled();
    expect(screen.getByRole('button', {
      name: '打开已有项目'
    })).toBeEnabled();
  });

  test('returns from the library with focus on the readiness heading', async () => {
    installReadiness(baseReadiness);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', {
      name: '进入作品库'
    }));
    fireEvent.click(await screen.findByRole('button', {
      name: '返回环境检查'
    }));

    expect(screen.getByRole('heading', {
      level: 1,
      name: '本地创作环境已准备好'
    })).toHaveFocus();
  });

  test('shows Story Foundation state protection before generation begins', async () => {
    const foundationStart = vi.fn();
    Object.defineProperty(window, 'novelLoop', {
      configurable: true,
      value: {
        system: { getReadiness: vi.fn().mockResolvedValue(baseReadiness) },
        projects: {
          list: vi.fn().mockResolvedValue({
            projects: [incompleteProject],
            defaultLocation: { configured: true, locationLabel: '测试作品库' },
            warning: null
          }),
          chooseDefaultLibrary: vi.fn(),
          create: vi.fn(),
          openExisting: vi.fn(),
          open: vi.fn().mockResolvedValue({ outcome: 'opened', project: incompleteProject }),
          remove: vi.fn()
        },
        foundation: {
          start: foundationStart,
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
        chapter: createInertChapterApi(),
        diagnosticRevision: createInertDiagnosticRevisionApi(),
    submission: createInertSubmissionApi()
      } satisfies NovelLoopDesktopApi
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开《状态边界》' }));
    await screen.findByRole('heading', { name: '状态边界' });
    fireEvent.click(screen.getByRole('button', { name: '准备生成故事基础' }));

    expect(screen.getByText('生成通常需要几分钟，期间不会写入正式故事状态。'))
      .toBeVisible();
    expect(foundationStart).not.toHaveBeenCalled();
  });

  test('routes a complete Story Foundation with incomplete planning to preparation', async () => {
    const project = { ...incompleteProject, storyBibleAvailable: true };
    const api = installProjectApi(project);

    render(<App />);
    await openProjectFromLibrary(project);

    expect(screen.getByRole('heading', { name: '准备全局规划' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '准备生成全局规划' }));

    expect(screen.getByRole('heading', { name: '生成全局规划' })).toBeVisible();
    expect(api.planning.start).not.toHaveBeenCalled();
  });

  test('routes a complete global plan to its author-facing review', async () => {
    const project = {
      ...incompleteProject,
      storyBibleAvailable: true,
      globalPlanAvailable: true
    };
    const api = installProjectApi(project);
    api.planning.read.mockResolvedValue({
      available: true,
      documents: [
        {
          kind: 'global_outline',
          title: '全书方向',
          markdown: '# 全书方向\n\n追索一封来自未来的退信。'
        },
        {
          kind: 'volume_outline',
          title: '第一卷',
          markdown: '# 第一卷\n\n从雾港失踪案开始。'
        }
      ],
      arcs: [],
      chapters: []
    });

    render(<App />);
    await openProjectFromLibrary(project);

    expect(await screen.findByRole('heading', {
      name: '阅读全局规划'
    })).toBeVisible();
    fireEvent.click(await screen.findByRole('button', {
      name: '查看全局规划'
    }));

    expect(await screen.findByRole('heading', { name: '全局规划' })).toBeVisible();
    expect(api.planning.read).toHaveBeenCalledWith({
      projectKey: project.projectKey
    });
  });

  test('keeps the next chapter action disabled until inspection settles', async () => {
    const project = {
      ...incompleteProject,
      storyBibleAvailable: true,
      globalPlanAvailable: true
    };
    const api = installProjectApi(project);
    let resolveInspection: ((value: {
      available: true;
      chapterNumber: number;
      title: string;
      phase: 'not_started';
    }) => void) | undefined;
    api.chapter.inspect.mockReturnValue(new Promise((resolve) => {
      resolveInspection = resolve;
    }));

    render(<App />);
    await openProjectFromLibrary(project);

    expect(screen.getByRole('heading', {
      name: '正在确认下一步'
    })).toBeVisible();
    expect(screen.getByRole('button', {
      name: '正在检查章节进度'
    })).toBeDisabled();
    expect(screen.queryByRole('button', {
      name: '查看全局规划'
    })).not.toBeInTheDocument();

    await act(async () => {
      resolveInspection?.({
        available: true,
        chapterNumber: 1,
        title: '第一章',
        phase: 'not_started'
      });
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: '创建第 1 章' })).toBeEnabled();
  });

  test.each([
    {
      action: '安装完成后重新检查',
      heading: '尚未检测到本地 Codex',
      status: 'not_installed' as const,
      summary: '尚未检测到本地 Codex。'
    },
    {
      action: '登录完成后重新检查',
      heading: 'Codex 尚未登录',
      status: 'not_logged_in' as const,
      summary: 'Codex 已安装，但尚未登录。'
    }
  ])('shows non-technical guidance for $status', async ({
    action,
    heading,
    status,
    summary
  }) => {
    installReadiness({
      ...baseReadiness,
      codex: {
        canRunSmoke: false,
        status,
        summary,
        version: status === 'not_installed' ? null : 'codex-cli 1.2.3'
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
    expect(screen.getByRole('button', { name: action })).toBeEnabled();
    expect(document.body).not.toHaveTextContent(/--codex|auth|token|json/i);
  });

  test('keeps a usable doctor warning non-blocking', async () => {
    installReadiness({
      ...baseReadiness,
      codex: {
        canRunSmoke: true,
        status: 'warning',
        summary: 'Codex 可以使用，但环境检查返回了提醒。',
        version: 'codex-cli 1.2.3'
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', {
      name: 'Codex 可以使用，但有一项提醒'
    })).toBeVisible();
    expect(screen.getByRole('button', { name: '仍然进入作品库' })).toBeEnabled();
  });

  test('recovers from an unavailable check by running it again', async () => {
    const getReadiness = installReadiness({
      ...baseReadiness,
      codex: {
        canRunSmoke: false,
        status: 'unavailable',
        summary: '暂时无法检查本地 Codex 状态。',
        version: null
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', {
      name: '暂时无法完成环境检查'
    })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));

    expect(getReadiness).toHaveBeenCalledTimes(2);
  });

  test('maps rejected preload calls to a safe message without leaking details', async () => {
    const getReadiness = vi.fn().mockRejectedValue(
      new Error('CODEX_EXEC_FAILED at /private/auth/token.json')
    );
    Object.defineProperty(window, 'novelLoop', {
      configurable: true,
      value: { system: { getReadiness } }
    });

    render(<App />);

    expect(await screen.findByRole('heading', {
      name: '暂时无法完成环境检查'
    })).toBeVisible();
    expect(document.body).not.toHaveTextContent(
      /CODEX_EXEC_FAILED|private|auth|token|json/i
    );
  });

  test('leaves an indefinitely pending check with a recoverable timeout state', async () => {
    vi.useFakeTimers();
    installReadiness(new Promise(() => {}));

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(screen.getByRole('heading', {
      name: '环境检查用时比预期更长'
    })).toBeVisible();
    expect(screen.getByRole('button', { name: '重新检查' })).toBeEnabled();
  });
});

const submissionProject: ProjectSummary = {
  ...incompleteProject,
  storyBibleAvailable: true,
  globalPlanAvailable: true
};
const reviewedPreview = SubmissionPreviewResultSchema.parse({
  outcome: 'ready', previewToken: `submission_${'a'.repeat(48)}`, chapterNumber: 1,
  draft: { kind: 'adopted', label: '作者采用的正文', summary: '林默保留了异常报告。' },
  changes: [{ category: 'facts', summary: '异常报告已被保留。', risk: 'low' }], warnings: []
});

function installSubmissionFlow(hasNextChapter = true) {
  const api = installProjectApi(submissionProject);
  api.chapter.inspect.mockResolvedValue({ ...readyChapterInspection, phase: 'draft_ready' });
  api.chapter.readDraft.mockResolvedValue(completeChapterDraft);
  api.submission.readPreview.mockResolvedValue(reviewedPreview);
  api.submission.confirm.mockResolvedValue(SubmissionConfirmResultSchema.parse({
    outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter
  }));
  api.planning.read.mockResolvedValue({
    available: true, documents: [{ kind: 'global_outline', title: '全书方向', markdown: '# 全书方向\n\n本卷规划已经完成。' }],
    arcs: [], chapters: []
  });
  return api;
}

async function openSubmissionFromWorkspace() {
  await openProjectFromLibrary(submissionProject);
  fireEvent.click(await screen.findByRole('button', { name: '打开第 1 章初稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '检查并提交' }));
}

async function confirmReviewedChapter() {
  const submit = await screen.findByRole('button', { name: '正式提交第 1 章' });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '我已审阅正文版本和全部故事变化' }));
  fireEvent.click(submit);
  const dialog = screen.getByRole('dialog', { name: '确认正式提交第 1 章？' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认正式提交' }));
  expect(await screen.findByRole('heading', { name: '第 1 章已正式提交' })).toBeVisible();
}

describe('controlled submission app integration', () => {
  test.each(['rejected', 'stale'] as const)('retries only the project read after a %s post-commit refresh', async (failure) => {
    const api = installSubmissionFlow();
    render(<App />);
    await openSubmissionFromWorkspace();
    await confirmReviewedChapter();
    if (failure === 'rejected') api.projects.open.mockRejectedValueOnce(new Error('private refresh failure'));
    else api.projects.open.mockResolvedValueOnce({ outcome: 'opened', project: submissionProject });
    fireEvent.click(screen.getByRole('button', { name: '创作下一章' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('本章已正式提交，但项目进度暂时无法刷新');
    expect(document.body).not.toHaveTextContent('private refresh failure');
    expect(screen.queryByRole('button', { name: '开始准备章节方向' })).not.toBeInTheDocument();
    api.projects.open.mockResolvedValue({ outcome: 'opened', project: { ...submissionProject, latestCommittedChapter: 1 } });
    api.chapter.inspect.mockResolvedValue({ available: true, chapterNumber: 2, title: '下一轮', phase: 'not_started' });
    fireEvent.click(screen.getByRole('button', { name: '重新读取项目' }));
    expect(await screen.findByRole('button', { name: '开始准备章节方向' })).toBeEnabled();
    expect(api.projects.open).toHaveBeenCalledTimes(3);
    expect(api.submission.confirm).toHaveBeenCalledTimes(1);
    expect(api.submission.startCheck).not.toHaveBeenCalled();
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
  });

  test('does not navigate away from the library when an abandoned refresh finishes', async () => {
    const api = installSubmissionFlow();
    render(<App />);
    await openSubmissionFromWorkspace();
    await confirmReviewedChapter();
    api.projects.open.mockRejectedValueOnce(new Error('refresh failed'));
    fireEvent.click(screen.getByRole('button', { name: '创作下一章' }));
    await screen.findByRole('alert');
    const refreshed = deferred<Awaited<ReturnType<NovelLoopDesktopApi['projects']['open']>>>();
    api.projects.open.mockReturnValueOnce(refreshed.promise);
    fireEvent.click(screen.getByRole('button', { name: '重新读取项目' }));
    fireEvent.click(screen.getByRole('button', { name: '返回作品库' }));
    expect(await screen.findByRole('heading', { name: '作品库', level: 1 })).toBeVisible();
    await act(async () => refreshed.resolve({ outcome: 'opened', project: { ...submissionProject, latestCommittedChapter: 1 } }));
    expect(screen.getByRole('heading', { name: '作品库', level: 1 })).toBeVisible();
    expect(api.submission.confirm).toHaveBeenCalledTimes(1);
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
  });

  test('requires explicit check and reviewed confirmation before refreshing into the existing next-chapter confirmation', async () => {
    const api = installSubmissionFlow();
    api.submission.readPreview.mockResolvedValueOnce({ outcome: 'not_ready', messageKey: 'submission.not_ready', issues: [] });
    api.submission.startCheck.mockResolvedValue({ taskId: 'submission_check_app' });
    api.submission.get.mockResolvedValue(SubmissionTaskSchema.parse({
      taskId: 'submission_check_app', projectKey: submissionProject.projectKey,
      chapterNumber: 1, stage: 'validating_patch', status: 'ready',
      startedAt: '2026-09-21T08:00:00.000Z', endedAt: '2026-09-21T08:00:01.000Z',
      safeErrorCode: null, issues: []
    }));
    render(<App />);
    await openSubmissionFromWorkspace();
    const start = await screen.findByRole('button', { name: '开始检查' });
    expect(api.submission.startCheck).not.toHaveBeenCalled();
    fireEvent.click(start);
    expect(await screen.findByText('异常报告已被保留。', {}, { timeout: 2_000 })).toBeVisible();
    expect(api.submission.startCheck).toHaveBeenCalledExactlyOnceWith({ projectKey: submissionProject.projectKey });
    expect(api.submission.get).toHaveBeenCalledWith({ taskId: 'submission_check_app' });
    expect(api.submission.confirm).not.toHaveBeenCalled();
    await confirmReviewedChapter();
    expect(api.submission.confirm).toHaveBeenCalledExactlyOnceWith({
      projectKey: submissionProject.projectKey, previewToken: `submission_${'a'.repeat(48)}`, confirm: true
    });
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
    api.projects.open.mockResolvedValue({ outcome: 'opened', project: { ...submissionProject, latestCommittedChapter: 1 } });
    api.chapter.inspect.mockResolvedValue({ available: true, chapterNumber: 2, title: '下一轮', phase: 'not_started' });
    api.chapter.startPlanning.mockResolvedValue(chapterTask({ chapterNumber: 2 }));
    fireEvent.click(screen.getByRole('button', { name: '创作下一章' }));
    expect(await screen.findByRole('heading', { name: '准备第 2 章方向' })).toBeVisible();
    const prepare = await screen.findByRole('button', { name: '开始准备章节方向' });
    expect(prepare).toBeEnabled();
    expect(api.projects.open).toHaveBeenCalledTimes(2);
    expect(api.projects.open).toHaveBeenLastCalledWith(submissionProject.projectKey);
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
    expect(api.chapter.startDrafting).not.toHaveBeenCalled();
    fireEvent.click(prepare);
    await waitFor(() => expect(api.chapter.startPlanning).toHaveBeenCalledExactlyOnceWith({ projectKey: submissionProject.projectKey }));
    expect(api.submission.confirm).toHaveBeenCalledTimes(1);
  });

  test('refreshes the committed overview and returns to global planning when there is no next outline', async () => {
    const api = installSubmissionFlow(false);
    render(<App />);
    await openSubmissionFromWorkspace();
    await confirmReviewedChapter();
    expect(screen.queryByRole('button', { name: '创作下一章' })).not.toBeInTheDocument();
    api.projects.open.mockResolvedValue({ outcome: 'opened', project: { ...submissionProject, latestCommittedChapter: 1 } });
    api.chapter.inspect.mockResolvedValue({ available: false, reason: 'chapter_missing' });
    fireEvent.click(screen.getByRole('button', { name: '返回全局规划' }));
    expect(await screen.findByRole('heading', { name: '全局规划' })).toBeVisible();
    expect(api.planning.read).toHaveBeenCalledWith({ projectKey: submissionProject.projectKey });
    expect(api.projects.open).toHaveBeenCalledTimes(2);
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
    expect(api.planning.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回项目概览' }));
    expect(await screen.findByRole('heading', { name: submissionProject.title })).toBeVisible();
    const chapterRow = screen.getByText('最新正式章节').closest('div');
    expect(chapterRow).toHaveTextContent('第 1 章');
    expect(screen.queryByRole('button', { name: '打开第 1 章初稿' })).not.toBeInTheDocument();
  });

  test.each([true, false])('routes verified persisted completion without checking or replaying confirmation (next=%s)', async (hasNextChapter) => {
    const api = installSubmissionFlow(hasNextChapter);
    api.submission.readPreview.mockResolvedValue(SubmissionPreviewResultSchema.parse({
      outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter
    }));
    render(<App />);
    await openSubmissionFromWorkspace();
    expect(await screen.findByRole('heading', { name: '第 1 章已正式提交' })).toBeVisible();
    api.projects.open.mockResolvedValue({ outcome: 'opened', project: { ...submissionProject, latestCommittedChapter: 1 } });
    api.chapter.inspect.mockResolvedValue({ available: true, chapterNumber: 2, title: '下一轮', phase: 'not_started' });
    fireEvent.click(screen.getByRole('button', { name: hasNextChapter ? '创作下一章' : '返回全局规划' }));
    expect(await screen.findByRole('heading', { name: hasNextChapter ? '准备第 2 章方向' : '全局规划' })).toBeVisible();
    expect(api.projects.open).toHaveBeenCalledTimes(2);
    expect(api.submission.startCheck).not.toHaveBeenCalled();
    expect(api.submission.confirm).not.toHaveBeenCalled();
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
  });

  test('waits for the project refresh and suppresses duplicate next actions', async () => {
    const api = installSubmissionFlow();
    render(<App />);
    await openSubmissionFromWorkspace();
    await confirmReviewedChapter();
    const refreshed = deferred<Awaited<ReturnType<NovelLoopDesktopApi['projects']['open']>>>();
    api.projects.open.mockReturnValueOnce(refreshed.promise);
    api.chapter.inspect.mockResolvedValue({ available: true, chapterNumber: 2, title: '下一轮', phase: 'not_started' });
    const next = screen.getByRole('button', { name: '创作下一章' });
    fireEvent.click(next);
    fireEvent.click(next);
    await waitFor(() => expect(api.projects.open).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('heading', { name: '准备第 2 章方向' })).not.toBeInTheDocument();
    expect(api.chapter.startPlanning).not.toHaveBeenCalled();
    await act(async () => refreshed.resolve({ outcome: 'opened', project: { ...submissionProject, latestCommittedChapter: 1 } }));
    expect(await screen.findByRole('heading', { name: '准备第 2 章方向' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '返回项目概览' }));
    expect(await screen.findByRole('heading', { name: submissionProject.title })).toBeVisible();
    const chapterRow = screen.getByText('最新正式章节').closest('div');
    expect(chapterRow).toHaveTextContent('第 1 章');
    expect(await screen.findByRole('button', { name: '创建第 2 章' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '打开第 1 章初稿' })).not.toBeInTheDocument();
    expect(api.submission.confirm).toHaveBeenCalledTimes(1);
  });
});
