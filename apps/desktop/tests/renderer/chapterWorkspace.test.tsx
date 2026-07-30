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
import type { ProjectSummary } from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';
import {
  completeChapterDraft,
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
    chapter: {
      ...createInertChapterApi(),
      inspect: vi.fn().mockResolvedValue({
        ...readyChapterInspection,
        phase: 'draft_ready'
      }),
      readPlan: vi.fn().mockResolvedValue({
        available: false,
        reason: 'not_ready'
      }),
      readDraft: vi.fn().mockResolvedValue(completeChapterDraft)
    }
  } satisfies NovelLoopDesktopApi;
  Object.defineProperty(window, 'novelLoop', {
    configurable: true,
    value: api
  });
}

async function openWorkspace() {
  fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开《白箱循环》' }));
  fireEvent.click(await screen.findByRole('button', {
    name: '打开第 1 章初稿'
  }));
  await screen.findByRole('heading', { name: '第 1 章 凌晨三点十七分' });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'novelLoop');
});

describe('initial chapter workspace', () => {
  test('presents a three-region author workspace with draft status and scene summaries', async () => {
    installApi();
    render(<App />);
    await openWorkspace();

    const workspace = screen.getByTestId('chapter-workspace');
    expect(workspace).toHaveClass('nl-chapter-workspace');
    expect(within(workspace).getByText('初稿')).toBeVisible();
    expect(within(workspace).getByText(/^\d+ 字$/)).toBeVisible();
    expect(within(workspace).getByRole('navigation', {
      name: '章节导航'
    })).toBeVisible();
    expect(within(workspace).getByRole('article')).toHaveTextContent(
      '屏幕上的“测试进行中”闪了一下'
    );
    const scenes = within(workspace).getByRole('list', { name: '场景摘要' });
    expect(within(scenes).getAllByRole('listitem')).toHaveLength(2);
    expect(within(workspace).getByText(
      '当前只是初稿，尚未写入正式故事状态。'
    )).toBeVisible();
  });

  test('does not expose editing, diagnostics, final, patch, or commit controls', async () => {
    installApi();
    render(<App />);
    await openWorkspace();

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /保存|诊断|修订|定稿|提交/i }))
      .not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /canon_patch|story_state|mutation|jsonl|runId|taskId|artifact path/i
    );
  });

  test('uses stable responsive tracks without gradients or oversized radii', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/styles/chapter.css'),
      'utf8'
    );
    expect(styles).toMatch(
      /\.nl-chapter-workspace\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(12rem,\s*15rem\)\s*minmax\(30rem,\s*1fr\)\s*minmax\(16rem,\s*20rem\);/s
    );
    expect(styles).toMatch(/@media\s*\(max-width:\s*1100px\)/);
    expect(styles).not.toMatch(/gradient\(/i);
    expect(styles).not.toMatch(/border-radius:\s*(?:9|[1-9][0-9]+)px/i);
  });
});
