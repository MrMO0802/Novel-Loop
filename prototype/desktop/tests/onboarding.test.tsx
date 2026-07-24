import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { App } from '../src/app/App';

afterEach(cleanup);

const onboardingStyles = readFileSync('src/styles/onboarding.css', 'utf8');

function renderRoute(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

describe('first launch readiness', () => {
  test('ready state enables Continue', () => {
    renderRoute('/setup?state=ready');

    expect(screen.getByText('Codex 已准备好')).toBeVisible();
    expect(screen.getByRole('button', { name: '继续' })).toBeEnabled();
  });

  test('missing state offers the guide and another check', () => {
    renderRoute('/setup?state=missing');

    expect(screen.getByText('未找到 Codex')).toBeVisible();
    expect(screen.getByRole('button', { name: '打开指南' })).toBeVisible();
    expect(screen.getByRole('button', { name: '重新检查' })).toBeVisible();
  });

  test('login state never exposes credentials, paths, or terminal arguments', () => {
    renderRoute('/setup?state=login');

    expect(screen.getByText('Codex 需要登录')).toBeVisible();
    expect(screen.getByRole('button', { name: '查看登录说明' })).toBeVisible();
    expect(document.body).not.toHaveTextContent(/token|auth\.json|\.codex|--json|--full-auto/i);
  });

  test('doctor warning remains non-blocking', () => {
    renderRoute('/setup?state=warning');

    expect(screen.getByText('写作功能可以使用')).toBeVisible();
    expect(screen.getByText('这项提醒不会阻止你继续。')).toBeVisible();
    expect(screen.getByRole('button', { name: '继续' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '重新检查' })).toBeVisible();
  });
});

describe('project library', () => {
  test('project-free pages span the full shell workspace', () => {
    expect(onboardingStyles).toMatch(
      /\.nl-application-shell__workspace > \.nl-application-shell__main:only-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/
    );
  });

  test('presents the current work and projects as a readable list', () => {
    renderRoute('/library');

    const continuePanel = screen.getByLabelText('继续创作');
    expect(within(continuePanel).getByRole('heading', { name: '雨夜电台' })).toBeVisible();
    expect(within(continuePanel).getByRole('button', { name: '审阅第二章' })).toBeVisible();

    const projectList = screen.getByRole('list', { name: '我的作品' });
    expect(within(projectList).getByText('42,680 字')).toBeVisible();
    expect(within(projectList).getByText('1 项待审阅')).toBeVisible();
    expect(screen.getByText('已归档作品（1）')).toBeVisible();
  });

  test('reveals archived projects only after opening the disclosure', async () => {
    const user = userEvent.setup();
    renderRoute('/library');

    expect(screen.getByText('纸月亮')).not.toBeVisible();

    await user.click(screen.getByText('已归档作品（1）'));

    expect(screen.getByText('纸月亮')).toBeVisible();
  });

  test('empty state has one New Novel action', () => {
    renderRoute('/library?state=empty');

    expect(screen.getByText('还没有作品')).toBeVisible();
    expect(screen.getAllByRole('button', { name: '新建小说' })).toHaveLength(1);
  });
});

describe('new novel wizard', () => {
  test('retains core idea input while moving between named stages', async () => {
    const user = userEvent.setup();
    renderRoute('/new');

    const centralSituation = screen.getByLabelText('故事的核心处境是什么？');
    await user.clear(centralSituation);
    await user.type(centralSituation, '一名送餐员收到一台没有电源的收音机发来的求救。');
    await user.click(screen.getByRole('button', { name: '下一项' }));

    expect(screen.getByRole('heading', { name: '类型与读者' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.getByRole('heading', { name: '核心创意' })).toBeVisible();
    expect(screen.getByLabelText('故事的核心处境是什么？')).toHaveValue(
      '一名送餐员收到一台没有电源的收音机发来的求救。'
    );
    expect(screen.queryByText(/步骤\s*1|Step\s*1/i)).toBeNull();
  });

  test('keeps every creative stage named', () => {
    renderRoute('/new');

    const stages = screen.getByRole('navigation', { name: '创作阶段' });
    for (const name of ['核心创意', '类型与读者', '主角', '世界观', '风格', '篇幅与章节计划', '确认创作简报', '故事圣经']) {
      expect(within(stages).getByRole('button', { name })).toBeVisible();
    }
  });

  test('offers an editable fixture Story Bible review', async () => {
    const user = userEvent.setup();
    renderRoute('/new');

    await user.click(screen.getByRole('button', { name: '故事圣经' }));

    expect(screen.getByRole('heading', { name: '审阅故事圣经' })).toBeVisible();
    expect(screen.getByLabelText<HTMLTextAreaElement>('故事圣经草稿').value).toContain('林澈');
    expect(screen.getByText('草稿，创建作品前仍可修改')).toBeVisible();
  });
});
