// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ChapterDraftEditor } from '../../src/renderer/src/features/chapter/ChapterDraftEditor';
import type { ChapterDraftReviewResult } from '../../src/shared/chapterContract';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import { completeChapterDraft, createInertChapterApi } from './desktopApiFixtures';

const draft = completeChapterDraft as Extract<
  ChapterDraftReviewResult,
  { available: true }
>;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'novelLoop');
});

function installApi() {
  const chapter = {
    ...createInertChapterApi(),
    saveDraftWorkingCopy: vi.fn().mockResolvedValue({
      saveState: 'saved',
      revisionToken: `chapter_revision_${'a'.repeat(48)}`
    }),
    discardDraftWorkingCopy: vi.fn().mockResolvedValue({ discarded: true }),
    adoptDraftRevision: vi.fn().mockResolvedValue({ outcome: 'adopted' })
  };
  Object.defineProperty(window, 'novelLoop', {
    configurable: true,
    value: { chapter } satisfies Pick<NovelLoopDesktopApi, 'chapter'>
  });
  return chapter;
}

describe('ChapterDraftEditor', () => {
  test('autosaves edited markdown after 750 ms and reports the saved state', async () => {
    vi.useFakeTimers();
    const api = installApi();
    render(<ChapterDraftEditor
      projectKey="project_author_draft"
      draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }}
      onAdopted={vi.fn()}
    />);

    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), {
      target: { value: '# 第一章\n\n新的正文。' }
    });
    expect(screen.getByText('尚未保存')).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(api.saveDraftWorkingCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('已自动保存');
  });

  test('requires an explicit recovery choice before exposing a recovered draft', () => {
    installApi();
    render(<ChapterDraftEditor
      projectKey="project_author_draft"
      draft={draft}
      workingCopy={{
        recoveryAvailable: true,
        stale: false,
        markdown: '# 第一章\n\n恢复的正文。',
        savedAt: '2026-08-04T01:00:00.000Z',
        revisionToken: `chapter_revision_${'b'.repeat(48)}`
      }}
      onAdopted={vi.fn()}
    />);

    expect(screen.getByText('已恢复上次未采用的编辑草稿')).toBeVisible();
    expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveValue(
      draft.markdown
    );
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveValue(
      '# 第一章\n\n恢复的正文。'
    );
  });
});
