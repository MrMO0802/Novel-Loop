// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react';
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
    const api = installApi();
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
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    expect(api.adoptDraftRevision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveValue(
      '# 第一章\n\n恢复的正文。'
    );
  });

  test('does not overlap deferred saves or restore an obsolete save token', async () => {
    vi.useFakeTimers();
    const first = deferred<{ saveState: 'saved'; revisionToken: string }>();
    const second = deferred<{ saveState: 'saved'; revisionToken: string }>();
    const api = installApi();
    api.saveDraftWorkingCopy.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);

    const textbox = screen.getByRole('textbox', { name: '章节正文' });
    fireEvent.change(textbox, { target: { value: '# 第一章\n\nA' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    fireEvent.change(textbox, { target: { value: '# 第一章\n\nB' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(api.saveDraftWorkingCopy).toHaveBeenCalledTimes(1);

    first.resolve({ saveState: 'saved', revisionToken: `chapter_revision_${'1'.repeat(48)}` });
    await act(async () => { await Promise.resolve(); });
    expect(api.saveDraftWorkingCopy).toHaveBeenCalledTimes(2);
    second.resolve({ saveState: 'saved', revisionToken: `chapter_revision_${'2'.repeat(48)}` });
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));
    expect(api.adoptDraftRevision).toHaveBeenCalledWith(expect.objectContaining({
      revisionToken: `chapter_revision_${'2'.repeat(48)}`
    }));
  });

  test('keeps stale recovery gated until durable discard succeeds', async () => {
    const discard = deferred<{ discarded: true }>();
    const api = installApi();
    api.discardDraftWorkingCopy.mockImplementationOnce(() => discard.promise);
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: true, stale: true, markdown: null, savedAt: '2026-08-04T01:00:00.000Z', revisionToken: null }} onAdopted={vi.fn()} />);

    expect(screen.getByText('上次编辑草稿基于旧版本，无法恢复。')).toBeVisible();
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '查看对比' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '放弃恢复' }));
    expect(screen.getByRole('button', { name: '放弃恢复' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeDisabled();

    discard.reject(new Error('discard failed'));
    await act(async () => { await discard.promise.catch(() => undefined); });
    expect(screen.getByText('上次编辑草稿基于旧版本，无法恢复。')).toBeVisible();
    expect(screen.getByRole('button', { name: '放弃恢复' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeDisabled();
  });

  test('renders manuscript preview blocks and restores focus to the exact opener on Escape', () => {
    installApi();
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '预览' }));
    const preview = screen.getByTestId('draft-manuscript-preview');
    expect(within(preview).getAllByText(/.+/u).length).toBeGreaterThan(1);
    expect(preview.querySelector('p')).not.toBeNull();

    const opener = screen.getByRole('button', { name: '查看对比' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: '草稿对比' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '草稿对比' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  test('cancels a pending autosave before discarding so the working copy is not recreated', async () => {
    vi.useFakeTimers();
    const discard = deferred<{ discarded: true }>();
    const api = installApi();
    api.discardDraftWorkingCopy.mockImplementationOnce(() => discard.promise);
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), {
      target: { value: '# 第一章\n\n即将放弃的正文。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '确认放弃' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    discard.resolve({ discarded: true });
    await act(async () => { await discard.promise; });

    expect(api.discardDraftWorkingCopy).toHaveBeenCalledTimes(1);
    expect(api.saveDraftWorkingCopy).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveValue(draft.markdown);
  });

  test('shows an explicit recovery-required action when adoption returns a durable failure result', async () => {
    const api = installApi();
    const onAdopted = vi.fn();
    api.adoptDraftRevision.mockResolvedValueOnce({
      outcome: 'recovery_required',
      nextAction: 'reload_chapter'
    });
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{
        recoveryAvailable: false,
        stale: false,
        markdown: null,
        savedAt: null,
        revisionToken: `chapter_revision_${'c'.repeat(48)}`
      }} onAdopted={onAdopted} />);

    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));

    expect(await screen.findByText('采用过程需要恢复后才能继续编辑。')).toBeVisible();
    expect(onAdopted).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(fireEvent.keyDown(window, { key: 's', ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, {
      key: 'p',
      ctrlKey: true,
      shiftKey: true
    })).toBe(false);
    expect(api.saveDraftWorkingCopy).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: '编辑' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新载入本章' }));
    expect(onAdopted).toHaveBeenCalledTimes(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
