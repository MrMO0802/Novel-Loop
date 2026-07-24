import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../src/app/App';

afterEach(cleanup);

const shellStyles = readFileSync('src/styles/shell.css', 'utf8');

function renderRoute(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

describe('prototype routes', () => {
  test.each([
    ['/setup?state=ready', '首次使用：准备就绪'],
    ['/setup?state=missing', '首次使用：需要安装'],
    ['/setup?state=login', '首次使用：需要登录'],
    ['/setup?state=warning', '首次使用：需要处理'],
    ['/library', '作品库'],
    ['/new', '新建作品'],
    ['/project/rain-radio', '雨夜电台'],
    ['/project/rain-radio/chapter/2', '第二章：收件地址'],
    ['/project/rain-radio/story-record', '故事档案'],
    ['/tasks', '任务中心'],
    ['/settings', '设置']
  ])('renders %s as %s', (path, heading) => {
    renderRoute(path);

    expect(screen.getByRole('heading', { name: heading })).toBeVisible();
  });

  test('hides project navigation outside a project workspace', () => {
    renderRoute('/library');

    expect(screen.queryByRole('navigation', { name: '作品导航' })).toBeNull();
  });

  test('closes the project navigation drawer after a destination is selected', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio');

    await user.click(screen.getByRole('button', { name: '打开作品导航' }));
    const drawer = screen.getByRole('dialog', { name: '雨夜电台' });
    await user.click(within(drawer).getByRole('link', { name: '第二章' }));

    expect(screen.queryByRole('dialog', { name: '雨夜电台' })).toBeNull();
    expect(screen.getByRole('heading', { name: '第二章：收件地址' })).toBeVisible();
  });
});

describe('command palette and shortcuts', () => {
  test('opens with Ctrl+K and returns focus to its invoker with Escape', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio');

    const invoker = screen.getByRole('button', { name: '打开命令面板' });
    invoker.focus();
    await user.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('dialog', { name: '快速操作' })).toBeVisible();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '快速操作' })).toBeNull();
    expect(invoker).toHaveFocus();
  });

  test.each([
    ['返回作品库', '/project/rain-radio', '作品库'],
    ['打开项目概览', '/library', '雨夜电台'],
    ['打开第二章', '/project/rain-radio', '第二章：收件地址'],
    ['打开故事档案', '/project/rain-radio', '故事档案'],
    ['打开任务中心', '/project/rain-radio', '任务中心'],
    ['打开设置', '/project/rain-radio', '设置']
  ])('navigates to %s', async (command, startPath, heading) => {
    const user = userEvent.setup();
    renderRoute(startPath);

    await user.click(screen.getByRole('button', { name: '打开命令面板' }));
    await user.click(screen.getByRole('button', { name: command }));

    expect(screen.getByRole('heading', { name: heading })).toBeVisible();
  });

  test('toggles focus mode from the command palette and Ctrl+Shift+Enter', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio');

    await user.click(screen.getByRole('button', { name: '打开命令面板' }));
    await user.click(screen.getByRole('button', { name: '切换专注模式' }));

    expect(screen.getByLabelText('应用框架')).toHaveClass('nl-application-shell--focus-mode');

    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}');

    expect(screen.getByLabelText('应用框架')).not.toHaveClass('nl-application-shell--focus-mode');
  });

  test('opens the current project chapter with Ctrl+P', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio');

    await user.keyboard('{Control>}p{/Control}');

    expect(screen.getByRole('heading', { name: '第二章：收件地址' })).toBeVisible();
  });

  test('does not trigger background shortcuts while the command palette is open', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio');

    await user.click(screen.getByRole('button', { name: '打开命令面板' }));
    await user.keyboard('{Control>}p{/Control}');

    expect(screen.getByRole('dialog', { name: '快速操作' })).toBeVisible();
    await user.keyboard('{Escape}');

    expect(screen.getByRole('heading', { name: '雨夜电台' })).toBeVisible();
  });

  test('does not reserve Ctrl+Shift+P', () => {
    renderRoute('/project/rain-radio');

    const dispatched = fireEvent.keyDown(document, { ctrlKey: true, key: 'p', shiftKey: true });

    expect(dispatched).toBe(true);
    expect(screen.getByRole('heading', { name: '雨夜电台' })).toBeVisible();
  });

  test.each([
    ['Ctrl+Shift+K', { ctrlKey: true, key: 'k', shiftKey: true }],
    ['Ctrl+Alt+K', { altKey: true, ctrlKey: true, key: 'k' }],
    ['Ctrl+Meta+K', { ctrlKey: true, key: 'k', metaKey: true }],
    ['Ctrl+Alt+P', { altKey: true, ctrlKey: true, key: 'p' }],
    ['Ctrl+Meta+P', { ctrlKey: true, key: 'p', metaKey: true }]
  ])('does not accept %s as a Ctrl+K or Ctrl+P shortcut', (_shortcut, eventInit) => {
    renderRoute('/project/rain-radio');

    const dispatched = fireEvent.keyDown(document, eventInit);

    expect(dispatched).toBe(true);
    expect(screen.queryByRole('dialog', { name: '快速操作' })).toBeNull();
    expect(screen.getByRole('heading', { name: '雨夜电台' })).toBeVisible();
  });

  test.each([
    ['Ctrl+Shift+Alt+Enter', { altKey: true, ctrlKey: true, key: 'Enter', shiftKey: true }],
    ['Ctrl+Shift+Meta+Enter', { ctrlKey: true, key: 'Enter', metaKey: true, shiftKey: true }]
  ])('does not accept %s as the focus-mode shortcut', (_shortcut, eventInit) => {
    renderRoute('/project/rain-radio');

    const dispatched = fireEvent.keyDown(document, eventInit);

    expect(dispatched).toBe(true);
    expect(screen.getByLabelText('应用框架')).not.toHaveClass('nl-application-shell--focus-mode');
  });

  test('suppresses Ctrl+P browser behavior while the command palette owns focus', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio');

    await user.click(screen.getByRole('button', { name: '打开命令面板' }));
    const dispatched = fireEvent.keyDown(document, { ctrlKey: true, key: 'p' });

    expect(dispatched).toBe(false);
    expect(screen.getByRole('dialog', { name: '快速操作' })).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: '雨夜电台' })).toBeVisible();
  });

  test('removes the global keydown listener when the shell unmounts', () => {
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderRoute('/project/rain-radio');

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    removeEventListener.mockRestore();
  });
});

describe('project navigation breakpoint source', () => {
  test('defines the drawer switch at 1024px without relying on computed CSS', () => {
    expect(shellStyles).toMatch(/@media \(max-width: 1024px\) \{[\s\S]*?\.nl-project-navigation--desktop \{\s*display: none;/);
    expect(shellStyles).toMatch(/@media \(max-width: 1024px\) \{[\s\S]*?\.nl-project-navigation__drawer-trigger \{\s*display: inline-flex;/);
  });
});
