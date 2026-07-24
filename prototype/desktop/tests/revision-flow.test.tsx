import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { App } from '../src/app/App';

afterEach(cleanup);

function renderRoute(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

describe('Chapter 2 diagnostics', () => {
  test('explains the blocking timeline finding with exact paragraph evidence', () => {
    renderRoute('/project/rain-radio/chapter/2/review');

    const finding = screen.getByRole('article', {
      name: '同一份送达发生在两个不相容的时间'
    });

    expect(within(finding).getByText('需要先处理')).toBeVisible();
    expect(within(finding).getByText(/同一次送达/)).toBeVisible();
    expect(within(finding).getByRole('heading', { name: '为什么重要' })).toBeVisible();
    expect(within(finding).getByText(/人物行动的先后关系/)).toBeVisible();

    for (const paragraph of [2, 11, 20, 32]) {
      expect(within(finding).getByText(`第 ${paragraph} 段`)).toBeVisible();
    }

    expect(within(finding).getByRole('button', { name: '在正文中查看' })).toBeVisible();
    expect(screen.getByRole('article', { name: '交接动作可以再明确一些' })).toBeVisible();
    expect(screen.getByText('建议留意')).toBeVisible();
    expect(screen.getByText('当前故事档案保持不变')).toBeVisible();
  });

  test('keeps internal rule names hidden until technical details are expanded', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/chapter/2/review');

    expect(screen.queryByText('timeline_delivery_single_clock')).toBeNull();

    const finding = screen.getByRole('article', {
      name: '同一份送达发生在两个不相容的时间'
    });
    await user.click(within(finding).getByText('技术详情'));

    expect(screen.getByText('timeline_delivery_single_clock')).toBeVisible();
  });

  test('moves focus into cited evidence and returns it to the invoking control', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/chapter/2/review');

    const finding = screen.getByRole('article', {
      name: '同一份送达发生在两个不相容的时间'
    });
    const trigger = within(finding).getByRole('button', { name: '在正文中查看' });

    await user.click(trigger);

    const evidence = within(finding).getByRole('region', { name: '正文依据' });
    expect(evidence).toHaveFocus();

    await user.click(within(evidence).getByRole('button', { name: '返回检查结果' }));

    expect(trigger).toHaveFocus();
  });
});

describe('revision candidate comparison', () => {
  test('offers side-by-side and unified reading with textual change labels', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/chapter/2/revision');

    expect(screen.getByText('修订候选')).toBeVisible();
    expect(screen.getByRole('heading', { name: '我的草稿' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '修订候选稿' })).toBeVisible();

    const sideBySide = screen.getByRole('button', { name: '并排比较' });
    const unified = screen.getByRole('button', { name: '连续阅读' });
    expect(sideBySide).toHaveAttribute('aria-pressed', 'true');
    expect(unified).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByText('− 已删除').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+ 已新增').length).toBeGreaterThan(0);

    await user.click(unified);

    expect(sideBySide).toHaveAttribute('aria-pressed', 'false');
    expect(unified).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: '连续阅读比较' })).toBeVisible();
  });

  test('summarizes the resolved conflict and confirms no new story instruction', () => {
    renderRoute('/project/rain-radio/chapter/2/revision');

    expect(screen.getByText('时间冲突已解决')).toBeVisible();
    expect(screen.getByText('重复交接已删除')).toBeVisible();
    expect(screen.getByText('没有新增指令或收件人')).toBeVisible();
    expect(screen.getByText('没有发现新的问题')).toBeVisible();
    expect(screen.getByText('故事档案不会因本页操作而改变')).toBeVisible();
  });

  test('accepts the candidate as an editable accepted draft without committing it', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/chapter/2/revision');

    await user.click(screen.getByRole('button', { name: '接受候选' }));

    expect(screen.getByText('已接受草稿')).toBeVisible();
    expect(screen.getByText('这仍是草稿，尚未正式提交。')).toBeVisible();
    expect(screen.getByRole('textbox', { name: '已接受的修订草稿' })).not.toHaveAttribute('readonly');
    expect(screen.queryByText('本章已正式提交')).toBeNull();
    expect(screen.queryByText('故事档案已更新')).toBeNull();
  });

  test('rejects the candidate and keeps the original draft active', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/chapter/2/revision');

    await user.click(screen.getByRole('button', { name: '拒绝候选' }));

    expect(screen.getByText('候选已拒绝')).toBeVisible();
    expect(screen.getByText('当前仍使用我的草稿')).toBeVisible();
    expect(screen.getByRole('heading', { name: '我的草稿' })).toBeVisible();
    expect(screen.getByText('原稿没有被替换。')).toBeVisible();
    expect(screen.queryByText('本章已正式提交')).toBeNull();
  });

  test('keeps both choices while leaving the original draft active', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/chapter/2/revision');

    await user.click(screen.getByRole('button', { name: '保留为备选版本' }));

    expect(screen.getByText('已保留两个版本')).toBeVisible();
    expect(screen.getByText('当前使用：我的草稿')).toBeVisible();
    expect(screen.getByText('备选版本：修订候选')).toBeVisible();
    expect(screen.queryByText('本章已正式提交')).toBeNull();
  });
});

describe('revision flow navigation', () => {
  test('opens the comparison from Chapter 2 and returns focus to the review action', async () => {
    const user = userEvent.setup();
    renderRoute('/project/rain-radio/chapter/2');

    await user.click(screen.getByRole('button', { name: '比较修订' }));

    expect(screen.getByRole('heading', { name: '比较第二章修订' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: '返回本章' }));

    expect(screen.getByRole('heading', { name: '第二章：收件地址' })).toBeVisible();
    expect(screen.getByRole('button', { name: '比较修订' })).toHaveFocus();
  });
});
