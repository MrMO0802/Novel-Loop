import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { App } from '../src/app/App';

afterEach(cleanup);

const pageStyles = readFileSync('src/styles/pages.css', 'utf8');

function renderRoute(query = '') {
  window.history.pushState({}, '', `/project/rain-radio/chapter/2${query}`);
  return render(<App />);
}

describe('chapter workspace', () => {
  test('keeps chapter navigation, manuscript, and chapter goal available in the default workspace', () => {
    renderRoute();

    const chapterNavigation = screen.getByRole('navigation', { name: '章节导航' });
    const editor = screen.getByRole('textbox', { name: '章节正文' });
    const assistant = screen.getByRole('complementary', { name: '本章写作提示' });

    expect(within(chapterNavigation).getByText('第一卷')).toBeVisible();
    expect(within(chapterNavigation).getByRole('link', { name: /第一章/ })).toBeVisible();
    expect(within(chapterNavigation).getByRole('link', { name: /第二章/ })).toHaveAttribute('aria-current', 'page');
    expect(within(chapterNavigation).getByRole('link', { name: /第三章/ })).toBeVisible();
    expect(within(chapterNavigation).getByRole('link', { name: '人物' })).toBeVisible();
    expect(within(chapterNavigation).getByRole('link', { name: '时间线' })).toBeVisible();
    expect(within(chapterNavigation).getByRole('link', { name: '待兑现悬念' })).toBeVisible();
    expect(editor).toBeVisible();
    expect(editor).not.toHaveAttribute('readonly');
    expect(within(assistant).getByRole('heading', { name: '本章目标' })).toBeVisible();
    expect(within(assistant).getByRole('heading', { name: '必须守住' })).toBeVisible();
    expect(within(assistant).getByRole('heading', { name: '本章检查' })).toBeVisible();
    expect(within(assistant).getByRole('button', { name: '比较修订' })).toBeVisible();
  });

  test('presents title, author-facing version, autosave, word count, and version selector as stable editor context', async () => {
    const user = userEvent.setup();
    renderRoute();

    expect(screen.getByRole('heading', { name: '第二章：收件地址' })).toBeVisible();
    expect(screen.getByText('草稿（可编辑）')).toBeVisible();
    expect(screen.getByText('已自动保存')).toBeVisible();
    expect(screen.getByText(/\d+ 字/)).toBeVisible();

    const versionSelector = screen.getByRole('combobox', { name: '查看章节版本' });
    expect(versionSelector).toHaveValue('draft');

    const editor = screen.getByRole('textbox', { name: '章节正文' });
    const originalValue = (editor as HTMLTextAreaElement).value;
    await user.type(editor, '雨声更近了。');

    expect(editor).not.toHaveValue(originalValue);
    expect(screen.getByText('正在保存')).toBeVisible();
  });

  test('uses distinct labels and editability for draft, candidate, Story Record preview, and committed versions', async () => {
    const user = userEvent.setup();
    renderRoute();

    const versionSelector = screen.getByRole('combobox', { name: '查看章节版本' });
    const editor = screen.getByRole('textbox', { name: '章节正文' });

    expect(screen.getByText('草稿（可编辑）')).toBeVisible();
    expect(editor).not.toHaveAttribute('readonly');

    await user.selectOptions(versionSelector, 'revision_candidate');
    expect(screen.getByText('修订候选（只读）')).toBeVisible();
    expect(editor).toHaveAttribute('readonly');

    await user.selectOptions(versionSelector, 'commit_preview');
    expect(screen.getByText('故事档案变更预览（尚未提交）')).toBeVisible();
    expect(editor).toHaveAttribute('readonly');

    await user.selectOptions(versionSelector, 'committed');
    expect(screen.getByText('已正式提交（只读）')).toBeVisible();
    expect(editor).toHaveAttribute('readonly');

    await user.selectOptions(versionSelector, 'draft');
    expect(screen.getByText('草稿（可编辑）')).toBeVisible();
    expect(editor).not.toHaveAttribute('readonly');
  });

  test('Focus Mode removes both page side panels but preserves all editing context and task status', async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole('button', { name: '进入专注模式' }));

    expect(screen.queryByRole('navigation', { name: '章节导航' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: '本章写作提示' })).toBeNull();
    expect(screen.getByRole('heading', { name: '第二章：收件地址' })).toBeVisible();
    expect(screen.getByText('草稿（可编辑）')).toBeVisible();
    expect(screen.getByText('已自动保存')).toBeVisible();
    expect(screen.getByText(/\d+ 字/)).toBeVisible();
    expect(screen.getByRole('combobox', { name: '查看章节版本' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '章节正文' })).toBeVisible();
    expect(screen.getByRole('button', { name: '退出专注模式' })).toBeVisible();
    expect(screen.getByRole('status', { name: '当前任务' })).toHaveTextContent('正在收集章节诊断证据');
  });
});

describe('Focus Mode keyboard contract', () => {
  test('exact Ctrl+Shift+Enter toggles Focus Mode through the shell', () => {
    renderRoute();

    const firstDispatch = fireEvent.keyDown(document, {
      ctrlKey: true,
      key: 'Enter',
      shiftKey: true
    });
    expect(firstDispatch).toBe(false);
    expect(screen.getByLabelText('应用框架')).toHaveClass('nl-application-shell--focus-mode');

    const secondDispatch = fireEvent.keyDown(document, {
      ctrlKey: true,
      key: 'Enter',
      shiftKey: true
    });
    expect(secondDispatch).toBe(false);
    expect(screen.getByLabelText('应用框架')).not.toHaveClass('nl-application-shell--focus-mode');
  });

  test.each([
    ['Ctrl+Enter', { ctrlKey: true, key: 'Enter' }],
    ['Shift+Enter', { key: 'Enter', shiftKey: true }],
    ['Ctrl+Shift+Alt+Enter', { altKey: true, ctrlKey: true, key: 'Enter', shiftKey: true }],
    ['Ctrl+Shift+Meta+Enter', { ctrlKey: true, key: 'Enter', metaKey: true, shiftKey: true }]
  ])('does not accept %s as Focus Mode', (_label, eventInit) => {
    renderRoute();

    const dispatched = fireEvent.keyDown(document, eventInit);

    expect(dispatched).toBe(true);
    expect(screen.getByLabelText('应用框架')).not.toHaveClass('nl-application-shell--focus-mode');
    expect(screen.getByRole('navigation', { name: '章节导航' })).toBeVisible();
  });
});

describe('chapter task tray fixtures', () => {
  test.each([
    ['?task=writing', '正在写第 2 个场景，共 3 个', true],
    ['?task=collecting', '正在收集章节诊断证据', true],
    ['?task=cancelling', '正在取消任务', false],
    ['?task=timeout', '写作任务用时比预期更长，已暂停。你的草稿和已经完成的步骤都已保留。', false]
  ])('renders %s without invented progress', (query, expectedText, canCancel) => {
    renderRoute(query);

    const tray = screen.getByRole('status', { name: '当前任务' });
    expect(tray).toHaveTextContent(expectedText);
    expect(within(tray).queryByRole('button', { name: '取消任务' }) !== null).toBe(canCancel);
    expect(tray).not.toHaveTextContent(/\d+\s*%/);
    expect(tray).not.toHaveTextContent(/进度\s*\d+/);
  });

  test('moves a running task into cancelling and removes the repeat cancel action', async () => {
    const user = userEvent.setup();
    renderRoute('?task=collecting');

    const tray = screen.getByRole('status', { name: '当前任务' });
    await user.click(within(tray).getByRole('button', { name: '取消任务' }));

    expect(tray).toHaveTextContent('正在取消任务');
    expect(within(tray).queryByRole('button', { name: '取消任务' })).toBeNull();
  });

  test('continues a recoverable timeout from the preserved stage', async () => {
    const user = userEvent.setup();
    renderRoute('?task=timeout');

    const tray = screen.getByRole('status', { name: '当前任务' });
    await user.click(within(tray).getByRole('button', { name: '继续此任务' }));

    expect(tray).toHaveTextContent('正在写第 2 个场景，共 3 个');
    expect(within(tray).getByRole('button', { name: '取消任务' })).toBeVisible();
  });
});

describe('1024px drawer contract and prototype boundaries', () => {
  test('keeps accessible chapter and assistant drawer triggers without removing the editor', async () => {
    const user = userEvent.setup();
    renderRoute();

    expect(pageStyles).toMatch(/@media \(max-width: 1024px\) \{[\s\S]*?\.nl-chapter-navigator--desktop,[\s\S]*?display: none;/);
    expect(pageStyles).toMatch(/@media \(max-width: 1024px\) \{[\s\S]*?\.nl-chapter-workspace__drawer-trigger[\s\S]*?display: inline-flex;/);

    const editor = screen.getByRole('textbox', { name: '章节正文' });
    const chapterTrigger = screen.getByRole('button', { name: '打开章节导航' });
    const assistantTrigger = screen.getByRole('button', { name: '打开本章写作提示' });
    expect(chapterTrigger).toHaveAttribute('title', '打开章节导航');
    expect(assistantTrigger).toHaveAttribute('title', '打开本章写作提示');

    await user.click(chapterTrigger);
    expect(screen.getByRole('dialog', { name: '章节导航' })).toBeVisible();
    expect(editor).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(assistantTrigger);
    expect(screen.getByRole('dialog', { name: '本章写作提示' })).toBeVisible();
    expect(editor).toBeInTheDocument();
  });

  test('does not render raw implementation language, internal identifiers, or JSON', () => {
    renderRoute('?task=timeout');

    expect(document.body).not.toHaveTextContent(
      /story_state|story state|runId|mutationId|artifact|queue|provider|token|jsonl|\.json|\/projects\//i
    );
    expect(document.body).not.toHaveTextContent(/^\s*[\[{].*[\]}]\s*$/);
  });
});
