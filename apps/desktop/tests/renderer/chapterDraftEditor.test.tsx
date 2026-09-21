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

import { ChapterDraftEditor } from '../../src/renderer/src/features/chapter/ChapterDraftEditor';
import type { ChapterDraftReviewResult, ChapterDraftWorkingCopyResult } from '../../src/shared/chapterContract';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import { completeChapterDraft, createInertChapterApi, createInertSubmissionApi } from './desktopApiFixtures';

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
    value: { chapter, submission: createInertSubmissionApi() } satisfies Pick<NovelLoopDesktopApi, 'chapter' | 'submission'>
  });
  return chapter;
}

describe('ChapterDraftEditor', () => {
  test('does not offer adoption or create a working copy when nothing has changed', async () => {
    const api = installApi();
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('当前草稿已保存');
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(screen.getByRole('status')).toHaveTextContent('已保存');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await act(async () => { await Promise.resolve(); });
    expect(api.saveDraftWorkingCopy).not.toHaveBeenCalled();
    expect(api.adoptDraftRevision).not.toHaveBeenCalled();
  });

  test('offers immediate manual saving and a retry after a failed save', async () => {
    const api = installApi();
    api.saveDraftWorkingCopy.mockRejectedValueOnce(new Error('disk unavailable'));
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), { target: { value: '# 第一章\n\n手动保存的正文。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('编辑草稿暂时无法保存');
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存'));
    expect(api.saveDraftWorkingCopy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.adoptDraftRevision).not.toHaveBeenCalled();
  });

  test('switches to preview after adoption and blocks a second adoption until another edit', async () => {
    const api = installApi();
    const onAdopted = vi.fn();
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={onAdopted} />);
    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), { target: { value: '# 第一章\n\n新修订正文。' } });
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));
    await waitFor(() => expect(onAdopted).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('修订已采用，尚未正式提交。')).toBeVisible();
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.adoptDraftRevision).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('tab', { name: '编辑' }));
    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), { target: { value: '# 第一章\n\n再次修改正文。' } });
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeEnabled();
    expect(screen.queryByText('修订已采用，尚未正式提交。')).not.toBeInTheDocument();
  });

  test('reopens an adopted revision in preview without asking to save or adopt it again', () => {
    installApi();
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={{ ...draft, versionKind: 'author_adopted' }}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);
    expect(screen.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('修订已采用，尚未正式提交。')).toBeVisible();
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeDisabled();
  });

  test('waits for an in-flight manual save before adopting exactly its token', async () => {
    const api = installApi();
    const saved = deferred<{ saveState: 'saved'; revisionToken: string }>();
    api.saveDraftWorkingCopy.mockImplementationOnce(() => saved.promise);
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), { target: { value: '# 第一章\n\n等待保存。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('正在保存'));
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));
    expect(api.adoptDraftRevision).not.toHaveBeenCalled();
    const token = `chapter_revision_${'e'.repeat(48)}`;
    await act(async () => saved.resolve({ saveState: 'saved', revisionToken: token }));
    await waitFor(() => expect(api.adoptDraftRevision).toHaveBeenCalledWith({
      projectKey: 'project_author_draft', revisionToken: token, confirmAdoption: true
    }));
    expect(api.saveDraftWorkingCopy).toHaveBeenCalledTimes(1);
  });

  test('blocks further edits if adoption succeeded but refreshing the canonical draft failed', async () => {
    const api = installApi();
    const onAdopted = vi.fn().mockRejectedValueOnce(new Error('read failed'));
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: `chapter_revision_${'f'.repeat(48)}` }} onAdopted={onAdopted} />);
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));
    expect(await screen.findByText('修订已采用，但界面暂时无法刷新。重新进入本章即可查看。')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '采用此修订' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新载入本章' })).toBeVisible();
    expect(api.adoptDraftRevision).toHaveBeenCalledTimes(1);
  });

  test('hides only the generated leading English placeholder in preview without changing the source', () => {
    const api = installApi();
    const markdown = '# Chapter 001 Draft\n\n原样保留正文 Chapter 001 Draft。\n\n## 作者的小标题';
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={{ ...draft, markdown }}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '预览' }));
    expect(screen.queryByRole('heading', { name: 'Chapter 001 Draft' })).not.toBeInTheDocument();
    expect(screen.getByText('原样保留正文 Chapter 001 Draft。')).toBeVisible();
    expect(screen.getByRole('heading', { name: '作者的小标题' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '编辑' }));
    expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveValue(markdown);
    expect(api.saveDraftWorkingCopy).not.toHaveBeenCalled();
  });
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
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(screen.getByRole('status')).toHaveTextContent('已保存');
    expect(api.saveDraftWorkingCopy).toHaveBeenCalledTimes(1);
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

  test('persists a third edit when an older queued save starts after that edit', async () => {
    vi.useFakeTimers();
    const first = deferred<{ saveState: 'saved'; revisionToken: string }>();
    const second = deferred<{ saveState: 'saved'; revisionToken: string }>();
    const third = deferred<{ saveState: 'saved'; revisionToken: string }>();
    const api = installApi();
    api.saveDraftWorkingCopy
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);

    const textbox = screen.getByRole('textbox', { name: '章节正文' });
    fireEvent.change(textbox, { target: { value: '# 第一章\n\nA' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    fireEvent.change(textbox, { target: { value: '# 第一章\n\nB' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    fireEvent.change(textbox, { target: { value: '# 第一章\n\nC' } });
    expect(screen.getByRole('status')).toHaveTextContent('尚未保存');

    first.resolve({ saveState: 'saved', revisionToken: `chapter_revision_${'1'.repeat(48)}` });
    await act(async () => { await Promise.resolve(); });
    expect(api.saveDraftWorkingCopy).toHaveBeenNthCalledWith(2, {
      projectKey: 'project_author_draft',
      markdown: '# 第一章\n\nB'
    });
    expect(screen.getByRole('status')).toHaveTextContent('尚未保存');

    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(api.saveDraftWorkingCopy).toHaveBeenCalledTimes(2);
    second.resolve({ saveState: 'saved', revisionToken: `chapter_revision_${'2'.repeat(48)}` });
    await act(async () => { await Promise.resolve(); });
    expect(api.saveDraftWorkingCopy).toHaveBeenNthCalledWith(3, {
      projectKey: 'project_author_draft',
      markdown: '# 第一章\n\nC'
    });
    expect(screen.getByRole('status')).toHaveTextContent('正在保存');

    third.resolve({ saveState: 'saved', revisionToken: `chapter_revision_${'3'.repeat(48)}` });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('已自动保存');
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));
    expect(api.adoptDraftRevision).toHaveBeenCalledWith(expect.objectContaining({
      revisionToken: `chapter_revision_${'3'.repeat(48)}`
    }));
  });

  test('deduplicates Ctrl+S and the pending autosave for the same edit generation', async () => {
    vi.useFakeTimers();
    const api = installApi();
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), {
      target: { value: '# 第一章\n\n只保存一次。' }
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await act(async () => { await Promise.resolve(); });
    expect(api.saveDraftWorkingCopy).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(api.saveDraftWorkingCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('已保存');
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

  test('keeps one textarea node and its selection across preview toggles', () => {
    installApi();
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);

    const textarea = screen.getByRole('textbox', { name: '章节正文' }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '# 第一章\n\n保留撤销历史的正文。' } });
    textarea.focus();
    textarea.setSelectionRange(8, 12);

    fireEvent.click(screen.getByRole('tab', { name: '预览' }));
    expect(textarea.isConnected).toBe(true);
    expect(document.querySelector('textarea')).toBe(textarea);
    expect(textarea).not.toBeVisible();

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('textbox', { name: '章节正文' })).toBe(textarea);
    expect(textarea).toHaveValue('# 第一章\n\n保留撤销历史的正文。');
    expect(textarea.selectionStart).toBe(8);
    expect(textarea.selectionEnd).toBe(12);
  });

  test('focuses the enabled textarea after continuing or discarding recovery', async () => {
    const api = installApi();
    const { unmount } = render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{
        recoveryAvailable: true,
        stale: false,
        markdown: '# 第一章\n\n恢复的正文。',
        savedAt: '2026-08-04T01:00:00.000Z',
        revisionToken: `chapter_revision_${'d'.repeat(48)}`
      }} onAdopted={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveFocus());

    unmount();
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{
        recoveryAvailable: true,
        stale: true,
        markdown: null,
        savedAt: '2026-08-04T01:00:00.000Z',
        revisionToken: null
      }} onAdopted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '放弃恢复' }));
    await waitFor(() => expect(api.discardDraftWorkingCopy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveFocus());
  });

  test('restores focus to the discard opener only after the dialog closes and controls re-enable', async () => {
    installApi();
    render(<ChapterDraftEditor projectKey="project_author_draft" draft={draft}
      workingCopy={{ recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null }} onAdopted={vi.fn()} />);

    const opener = screen.getByRole('button', { name: '放弃草稿' });
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: '确认放弃' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '放弃草稿确认' })).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toBeEnabled());
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
    expect(screen.getByRole('button', { name: '重新载入本章' })).toHaveFocus();
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

function renderSubmissionEditor(overrides: {
  draft?: typeof draft;
  workingCopy?: ChapterDraftWorkingCopyResult;
  onAdopted?: () => void | Promise<void>;
} = {}) {
  const onCheckSubmission = vi.fn();
  const props = {
    projectKey: 'project_author_draft',
    draft,
    workingCopy: { recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null },
    onAdopted: vi.fn(),
    onCheckSubmission,
    ...overrides
  };
  render(<ChapterDraftEditor {...props} />);
  return onCheckSubmission;
}

describe('submission entry gates', () => {
  test.each(['generated', 'author_adopted'] as const)('opens review for a clean %s draft without saving, adopting or committing', (versionKind) => {
    const api = installApi();
    const onCheckSubmission = renderSubmissionEditor({ draft: { ...draft, versionKind } });
    const check = screen.getByRole('button', { name: '检查并提交' });
    expect(check).toBeVisible();
    expect(check).toBeEnabled();
    expect(screen.queryByRole('button', { name: /正式提交第/ })).not.toBeInTheDocument();
    fireEvent.click(check);
    expect(onCheckSubmission).toHaveBeenCalledExactlyOnceWith();
    expect(api.saveDraftWorkingCopy).not.toHaveBeenCalled();
    expect(api.adoptDraftRevision).not.toHaveBeenCalled();
    expect(window.novelLoop.submission.startCheck).not.toHaveBeenCalled();
    expect(window.novelLoop.submission.confirm).not.toHaveBeenCalled();
  });

  test('blocks dirty and autosaved unadopted edits while retaining explicit save without an empty revision', async () => {
    vi.useFakeTimers();
    const api = installApi();
    const onCheckSubmission = renderSubmissionEditor();
    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), {
      target: { value: '# 第一章\n\n等待作者采用的正文。' }
    });
    const check = screen.getByRole('button', { name: '检查并提交' });
    expect(check).toBeDisabled();
    expect(screen.getByText(/未采用.*采用.*放弃/)).toBeVisible();
    fireEvent.click(check);
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(screen.getByRole('status')).toHaveTextContent('已自动保存');
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(screen.getByRole('status')).toHaveTextContent('已保存');
    expect(api.saveDraftWorkingCopy).toHaveBeenCalledTimes(1);
    expect(check).toBeDisabled();
    expect(screen.getByText(/未采用.*采用.*放弃/)).toBeVisible();
    expect(screen.queryByText(/请先保存/)).not.toBeInTheDocument();
    fireEvent.click(check);
    expect(onCheckSubmission).not.toHaveBeenCalled();
    expect(api.adoptDraftRevision).not.toHaveBeenCalled();
    expect(window.novelLoop.submission.confirm).not.toHaveBeenCalled();
  });

  test('blocks entry while saving and adopting, then enables it only after the adopted draft refresh', async () => {
    const api = installApi();
    const saved = deferred<{ saveState: 'saved'; revisionToken: string }>();
    const adopted = deferred<{ outcome: 'adopted' }>();
    const refreshed = deferred<void>();
    api.saveDraftWorkingCopy.mockReturnValueOnce(saved.promise);
    api.adoptDraftRevision.mockReturnValueOnce(adopted.promise);
    const onAdopted = vi.fn(() => refreshed.promise);
    const onCheckSubmission = renderSubmissionEditor({ onAdopted });
    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), { target: { value: '# 第一章\n\n待采用版本。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('正在保存'));
    const check = screen.getByRole('button', { name: '检查并提交' });
    expect(check).toBeDisabled();
    fireEvent.click(check);
    await act(async () => saved.resolve({ saveState: 'saved', revisionToken: `chapter_revision_${'a'.repeat(48)}` }));
    expect(check).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    expect(check).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));
    await waitFor(() => expect(api.adoptDraftRevision).toHaveBeenCalledTimes(1));
    expect(check).toBeDisabled();
    await act(async () => adopted.resolve({ outcome: 'adopted' }));
    expect(onAdopted).toHaveBeenCalledOnce();
    expect(check).toBeDisabled();
    fireEvent.click(check);
    expect(onCheckSubmission).not.toHaveBeenCalled();
    await act(async () => refreshed.resolve());
    expect(screen.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('修订已采用，尚未正式提交。')).toBeVisible();
    expect(check).toBeEnabled();
    expect(window.novelLoop.submission.confirm).not.toHaveBeenCalled();
    fireEvent.click(check);
    expect(onCheckSubmission).toHaveBeenCalledOnce();
  });

  test.each(['rejected', 'recovery_required', 'refresh_failed'] as const)('keeps submission blocked after adoption %s', async (failure) => {
    const api = installApi();
    if (failure === 'rejected') api.adoptDraftRevision.mockRejectedValueOnce(new Error('adoption failed'));
    if (failure === 'recovery_required') api.adoptDraftRevision.mockResolvedValueOnce({ outcome: 'recovery_required', nextAction: 'reload_chapter' });
    const onAdopted = failure === 'refresh_failed'
      ? vi.fn().mockRejectedValueOnce(new Error('refresh failed')) : vi.fn();
    const onCheckSubmission = renderSubmissionEditor({
      workingCopy: { recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: `chapter_revision_${'b'.repeat(48)}` },
      onAdopted
    });
    fireEvent.click(screen.getByRole('button', { name: '采用此修订' }));
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));
    await screen.findByText(failure === 'rejected'
      ? '此修订暂时无法采用，请重新检查当前草稿。'
      : failure === 'recovery_required' ? '采用过程需要恢复后才能继续编辑。'
        : '修订已采用，但界面暂时无法刷新。重新进入本章即可查看。');
    const check = screen.getByRole('button', { name: '检查并提交' });
    expect(check).toBeDisabled();
    fireEvent.click(check);
    expect(onCheckSubmission).not.toHaveBeenCalled();
    expect(window.novelLoop.submission.confirm).not.toHaveBeenCalled();
  });

  test.each([false, true])('blocks unresolved working-copy recovery (stale=%s)', (stale) => {
    installApi();
    const onCheckSubmission = renderSubmissionEditor({ workingCopy: {
      recoveryAvailable: true, stale, markdown: stale ? null : '# 第一章\n\n恢复正文。',
      savedAt: '2026-09-21T08:00:00.000Z', revisionToken: stale ? null : `chapter_revision_${'c'.repeat(48)}`
    } });
    const check = screen.getByRole('button', { name: '检查并提交' });
    expect(check).toBeDisabled();
    fireEvent.click(check);
    expect(onCheckSubmission).not.toHaveBeenCalled();
  });

  test('reenables checking only after pending discard completes', async () => {
    const api = installApi();
    const discarded = deferred<{ discarded: true }>();
    api.discardDraftWorkingCopy.mockReturnValueOnce(discarded.promise);
    const onCheckSubmission = renderSubmissionEditor();
    fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), { target: { value: '# 第一章\n\n放弃的正文。' } });
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '确认放弃' }));
    const check = screen.getByRole('button', { name: '检查并提交' });
    expect(check).toBeDisabled();
    fireEvent.click(check);
    expect(onCheckSubmission).not.toHaveBeenCalled();
    await act(async () => discarded.resolve({ discarded: true }));
    expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveValue(draft.markdown);
    expect(check).toBeEnabled();
    fireEvent.click(check);
    expect(onCheckSubmission).toHaveBeenCalledOnce();
    expect(api.adoptDraftRevision).not.toHaveBeenCalled();
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
