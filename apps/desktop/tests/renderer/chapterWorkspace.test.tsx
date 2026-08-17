// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  return api;
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
  test('loads the canonical draft before lease-backed companion reads', async () => {
    const api = installApi();
    let resolveDraft: ((value: typeof completeChapterDraft) => void) | null = null;
    api.chapter.readDraft.mockImplementation(() => new Promise((resolve) => {
      resolveDraft = resolve;
    }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '进入作品库' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开《白箱循环》' }));
    fireEvent.click(await screen.findByRole('button', {
      name: '打开第 1 章初稿'
    }));

    await waitFor(() => expect(api.chapter.readDraft).toHaveBeenCalledTimes(1));
    expect(api.chapter.readDraftWorkingCopy).not.toHaveBeenCalled();
    expect(api.chapter.readPlan).not.toHaveBeenCalled();

    await act(async () => resolveDraft?.(completeChapterDraft));
    await screen.findByRole('heading', { name: '第 1 章 凌晨三点十七分' });
    expect(api.chapter.readDraftWorkingCopy).toHaveBeenCalledTimes(1);
    expect(api.chapter.readPlan).toHaveBeenCalledTimes(1);
  });

  test('presents a three-region author workspace with draft status and scene summaries', async () => {
    installApi();
    render(<App />);
    await openWorkspace();

    const workspace = screen.getByTestId('chapter-workspace');
    expect(workspace).toHaveClass('nl-chapter-workspace');
    expect(within(workspace).getByText('初稿')).toBeVisible();
    expect(within(workspace).getAllByText(/^\d+ 字$/)).toHaveLength(2);
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

  test('exposes draft editing without diagnostics, final, patch, or commit controls', async () => {
    installApi();
    render(<App />);
    await openWorkspace();

    expect(screen.getByRole('textbox', { name: '章节正文' })).toBeVisible();
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /诊断|定稿|提交/i }))
      .not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /canon_patch|story_state|mutation|jsonl|runId|taskId|artifact path/i
    );
  });

  test('reinitializes the editor after adoption recovery before allowing another save and adoption', async () => {
    if (!completeChapterDraft.available) {
      throw new Error('Expected the complete chapter draft fixture to be available.');
    }
    const api = installApi();
    api.chapter.adoptDraftRevision
      .mockResolvedValueOnce({
        outcome: 'recovery_required',
        nextAction: 'reload_chapter'
      })
      .mockResolvedValueOnce({ outcome: 'adopted' });
    render(<App />);
    await openWorkspace();

    const textbox = screen.getByRole('textbox', { name: '章节正文' });
    fireEvent.change(textbox, {
      target: { value: `${completeChapterDraft.markdown}\n\n第一次编辑。` }
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(api.chapter.saveDraftWorkingCopy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));
    expect(await screen.findByText('采用过程需要恢复后才能继续编辑。')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '重新载入本章' }));
    await waitFor(() => {
      expect(screen.queryByText('采用过程需要恢复后才能继续编辑。'))
        .not.toBeInTheDocument();
    });
    const reloadedTextbox = screen.getByRole('textbox', { name: '章节正文' });
    expect(reloadedTextbox).toBeEnabled();
    fireEvent.change(reloadedTextbox, {
      target: { value: `${completeChapterDraft.markdown}\n\n恢复后的编辑。` }
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(api.chapter.saveDraftWorkingCopy).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));
    await waitFor(() => expect(api.chapter.adoptDraftRevision).toHaveBeenCalledTimes(2));
  });

  test('reloads an adopted draft before reading its cleared working copy', async () => {
    if (!completeChapterDraft.available) {
      throw new Error('Expected the complete chapter draft fixture to be available.');
    }
    const api = installApi();
    const adoptedDraft = {
      ...completeChapterDraft,
      markdown: `${completeChapterDraft.markdown}\n\n作者采用内容。`,
      versionKind: 'author_adopted' as const
    };
    let resolveAdoptedDraft: ((value: typeof adoptedDraft) => void) | null = null;
    api.chapter.readDraft
      .mockResolvedValueOnce(completeChapterDraft)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAdoptedDraft = resolve;
      }));
    render(<App />);
    await openWorkspace();

    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), {
      target: { value: adoptedDraft.markdown }
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(api.chapter.saveDraftWorkingCopy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));

    await waitFor(() => expect(api.chapter.readDraft).toHaveBeenCalledTimes(2));
    expect(api.chapter.readDraftWorkingCopy).toHaveBeenCalledTimes(1);

    await act(async () => resolveAdoptedDraft?.(adoptedDraft));
    expect(await screen.findByText('作者采用修订')).toBeVisible();
    expect(api.chapter.readDraftWorkingCopy).toHaveBeenCalledTimes(2);
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
    expect(styles).toMatch(
      /\.nl-chapter-manuscript h1\s*\{[^}]*font-size:\s*40px;/s
    );
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\.nl-chapter-manuscript h1\s*\{[^}]*font-size:\s*30px;/s
    );
    expect(styles).not.toContain('3vw');
    expect(styles).not.toMatch(/gradient\(/i);
    expect(styles).not.toMatch(/border-radius:\s*(?:9|[1-9][0-9]+)px/i);
  });
});
