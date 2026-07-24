import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { App } from '../src/app/App';

afterEach(cleanup);

function renderRoute(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

describe('project overview', () => {
  test('reads as an editorial project briefing with one recommended next action', () => {
    renderRoute('/project/rain-radio');

    expect(screen.getByRole('heading', { name: '雨夜电台' })).toBeVisible();
    expect(screen.getByText('第一卷 · 2 / 30 章')).toBeVisible();
    expect(screen.getByRole('heading', { name: '最新章节' })).toBeVisible();
    expect(screen.getByText('第二章：收件地址')).toBeVisible();
    expect(screen.getByRole('heading', { name: '主要人物' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '待兑现悬念' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '最近动态' })).toBeVisible();

    const recommendation = screen.getByRole('complementary', { name: '建议下一步' });
    expect(within(recommendation).getAllByRole('button')).toHaveLength(1);
    expect(within(recommendation).getByRole('button', { name: '审阅故事档案变更' })).toBeVisible();
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });
});

describe('Story Record', () => {
  test('uses every approved author-facing concept label without leaking implementation details', () => {
    renderRoute('/project/rain-radio/story-record');

    for (const label of [
      '故事档案',
      '人物',
      '时间线',
      '读者认知',
      '待兑现悬念',
      '伏笔',
      '人物关系',
      '世界规则',
      '已确认事实'
    ]) {
      expect(screen.getByText(label, { selector: 'h1, [role="tab"]' })).toBeVisible();
    }

    expect(document.body).not.toHaveTextContent(
      /story_state|narrative_debt|reader_state|canon_patch|character_id|mystery_id|\.json|\/projects\//i
    );
    expect(document.body).not.toHaveTextContent(/^\s*[\[{].*[\]}]\s*$/);
  });

  test('selecting 时间线 replaces character detail with the chronological story view', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/story-record');

    expect(screen.getByRole('heading', { name: '林澈' })).toBeVisible();
    expect(screen.getByText('调查广播信号，同时避免引起不必要的注意。')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: '时间线' }));

    expect(screen.getByRole('tab', { name: '时间线' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: '故事时间线' })).toBeVisible();
    expect(screen.getAllByRole('listitem', { name: /时间线事件/ })).toHaveLength(6);
    expect(screen.queryByText('调查广播信号，同时避免引起不必要的注意。')).toBeNull();
  });

  test('selecting 待兑现悬念 shows four open questions with author-facing status and evidence', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/story-record');

    await user.click(screen.getByRole('tab', { name: '待兑现悬念' }));

    expect(screen.getByRole('heading', { name: '待兑现悬念' })).toBeVisible();
    expect(screen.getAllByRole('article', { name: /悬念：/ })).toHaveLength(4);
    expect(screen.getByText('需要留意')).toBeVisible();
    expect(screen.getByText('正在推进')).toBeVisible();
    expect(screen.getAllByText('证据来自第一章')).toHaveLength(3);
    expect(screen.getByText('广播里的求救者为什么知道林澈姐姐的名字？')).toBeVisible();
  });

  test('foreshadowing filters preserve an author-facing empty state', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/story-record');

    await user.click(screen.getByRole('tab', { name: '伏笔' }));
    expect(screen.getAllByRole('article', { name: /伏笔：/ })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '已回收' }));

    expect(screen.getByText('还没有已回收的伏笔。')).toBeVisible();
    expect(screen.getByText('故事推进后，已完成作用的线索会整理在这里。')).toBeVisible();
  });

  test('relationship view is an accessible list rather than a decorative graph', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/story-record');

    await user.click(screen.getByRole('tab', { name: '人物关系' }));

    const relationships = screen.getByRole('list', { name: '人物关系' });
    expect(within(relationships).getAllByRole('listitem')).toHaveLength(3);
    expect(within(relationships).getByText('姐弟 · 失踪前关系疏远')).toBeVisible();
    expect(document.querySelector('canvas')).toBeNull();
    expect(document.querySelector('svg[aria-label*="关系"]')).toBeNull();
  });

  test('searching a pending Chapter 2 change does not show a contradictory empty state', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/story-record');

    await user.click(screen.getByRole('tab', { name: '已确认事实' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索当前视图' }), '值班表');

    expect(screen.getByText('值班表新增了十七层夜间巡查的书面记录。')).toBeVisible();
    expect(screen.queryByText('没有找到匹配内容。')).toBeNull();
  });
});
