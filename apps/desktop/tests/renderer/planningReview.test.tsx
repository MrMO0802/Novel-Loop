// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import type { PlanningReviewResult } from '../../src/shared/planningContract';
import type { ProjectSummary } from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';
import {
  createInertChapterApi,
  readyChapterInspection
} from './desktopApiFixtures';

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
  globalPlanAvailable: true
};
const planningStyles = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/planning.css'),
  'utf8'
);
const review: PlanningReviewResult = {
  available: true,
  documents: [
    {
      kind: 'global_outline',
      title: 'private/global_outline.md',
      markdown: '# 全书方向\n\n雾港邮差追索未来退信的来源。'
    },
    {
      kind: 'volume_outline',
      title: 'private/volume_01_outline.md',
      markdown: '# 第一卷\n\n第一卷围绕失踪邮袋展开。\n<img src=x onerror=alert(1)>'
    }
  ],
  arcs: [
    {
      id: 'arc_private_main',
      name: '未来退信',
      type: 'plot',
      summary: '追查退信为何早于寄出时间抵达。',
      startChapter: 1,
      targetEndChapter: 12,
      relatedCharacters: ['林雾', '周渠']
    },
    {
      id: 'arc_private_growth',
      name: '林雾的选择',
      type: 'character',
      summary: '从逃避旧案到主动承担。',
      startChapter: 2,
      relatedCharacters: ['林雾']
    }
  ],
  chapters: [
    {
      chapterNumber: 1,
      title: '夜班退信',
      status: 'planned',
      summary: '林雾收到日期来自明天的退信。',
      primaryFunction: '建立核心谜团'
    },
    {
      chapterNumber: 2,
      title: '封口的邮袋',
      status: 'planned',
      summary: '一只失踪邮袋重新出现。',
      primaryFunction: '扩大调查范围'
    }
  ]
};
function installApi(result: PlanningReviewResult = review) {
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
      read: vi.fn()
    },
    planning: {
      start: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      read: vi.fn().mockResolvedValue(result)
    },
    chapter: {
      ...createInertChapterApi(),
      inspect: vi.fn()
        .mockRejectedValueOnce(new Error('chapter inspection unavailable'))
        .mockResolvedValue(readyChapterInspection)
    }
  } satisfies NovelLoopDesktopApi;
  Object.defineProperty(window, 'novelLoop', {
    configurable: true,
    value: api
  });
  return api;
}

async function openPlanningReview() {
  fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开《雾港来信》' }));
  await screen.findByRole('heading', { name: '雾港来信' });
  fireEvent.click(await screen.findByRole('button', {
    name: '查看全局规划'
  }));
  await screen.findByRole('heading', { name: '全局规划' });
  await screen.findByRole('tablist', { name: '全局规划内容' });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'novelLoop');
});

describe('global planning review', () => {
  test('presents four accessible author-facing tabs without technical metadata', async () => {
    const api = installApi();
    render(<App />);
    await openPlanningReview();

    const tabs = within(screen.getByRole('tablist', {
      name: '全局规划内容'
    })).getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '全书方向',
      '第一卷',
      '故事线',
      '章节计划'
    ]);
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(4);
    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      expect(document.getElementById(panelId ?? '')).not.toBeNull();
    }
    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      '雾港邮差追索未来退信的来源。'
    );
    expect(api.planning.read).toHaveBeenCalledWith({ projectKey });
    expect(document.body).not.toHaveTextContent(
      /private\/|arc_private|global_outline|volume_01|planning\/|run_|jsonl|projectKey|taskId/i
    );
  });

  test('renders Markdown-like input as text without injecting HTML', async () => {
    installApi();
    render(<App />);
    await openPlanningReview();

    fireEvent.click(screen.getByRole('tab', { name: '第一卷' }));
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('第一卷围绕失踪邮袋展开。');
    expect(panel).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(panel.querySelector('img')).toBeNull();
  });

  test('renders arcs and chapters as semantic lists', async () => {
    installApi();
    render(<App />);
    await openPlanningReview();

    fireEvent.click(screen.getByRole('tab', { name: '故事线' }));
    const arcList = screen.getByRole('list', { name: '故事线' });
    expect(within(arcList).getAllByRole('listitem')).toHaveLength(2);
    expect(within(arcList).getByText('未来退信')).toBeVisible();
    expect(within(arcList).getByText('主线')).toBeVisible();
    expect(within(arcList).getByText('第 1 章至第 12 章')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: '章节计划' }));
    const chapterList = screen.getByRole('list', { name: '章节计划' });
    expect(within(chapterList).getAllByRole('listitem')).toHaveLength(2);
    expect(within(chapterList).getByRole('heading', {
      name: '第 1 章 夜班退信'
    })).toBeVisible();
    expect(within(chapterList).getByText('作用：建立核心谜团')).toBeVisible();
  });

  test('supports arrow, Home, and End keyboard tab navigation', async () => {
    installApi();
    render(<App />);
    await openPlanningReview();

    const first = screen.getByRole('tab', { name: '全书方向' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '第一卷' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      '第一卷围绕失踪邮袋展开。'
    );

    fireEvent.keyDown(screen.getByRole('tab', { name: '第一卷' }), {
      key: 'End'
    });
    expect(screen.getByRole('tab', { name: '章节计划' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: '章节计划' }), {
      key: 'Home'
    });
    expect(screen.getByRole('tab', { name: '全书方向' })).toHaveFocus();
  });

  test('opens the next chapter planning confirmation without changing Story State', async () => {
    installApi();
    render(<App />);
    await openPlanningReview();

    expect(screen.getByText(
      '这是一份创作规划，尚未提交章节，也没有修改正式故事状态。'
    )).toBeVisible();
    expect(screen.getByText(
      '先准备并审阅本章方向，确认后才会开始写初稿。'
    )).toBeVisible();
    fireEvent.click(screen.getByRole('button', {
      name: '创建第 1 章'
    }));
    expect(await screen.findByRole('heading', {
      name: '准备第 1 章方向'
    })).toBeVisible();
    expect(screen.getByText(
      '开始后会准备章节任务、比较不同方案并选出一个方向，不会写正文或修改正式故事状态。'
    )).toBeVisible();
  });

  test('keeps long arc and chapter values inside narrow layouts', () => {
    expect(planningStyles).toMatch(
      /\.nl-planning-arcs > li,\s*\.nl-planning-chapters > li\s*\{[^}]*min-width:\s*0;/s
    );
    expect(planningStyles).toMatch(
      /\.nl-planning-arc__details > div\s*\{[^}]*min-width:\s*0;/s
    );
    expect(planningStyles).toMatch(
      /\.nl-planning-arc__details dd\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s
    );
  });
});
