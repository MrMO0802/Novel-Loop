import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { App } from '../src/app/App';
import { chapterTwoCommitPreview } from '../src/fixtures/commitPreview';
import { rainRadio } from '../src/fixtures/rainRadio';

const commitPreviewPath = '/project/rain-radio/chapter/2/commit-preview';
const revisionPath = '/project/rain-radio/chapter/2/revision';

afterEach(cleanup);

function renderRoute(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

async function renderAcceptedCommitPreview(path = commitPreviewPath) {
  const user = userEvent.setup();
  renderRoute(revisionPath);
  fireEvent.click(screen.getByRole('button', { name: '接受候选' }));
  fireEvent.click(screen.getByRole('button', { name: '审阅故事档案变更' }));

  if (path !== commitPreviewPath) {
    window.history.pushState({}, '', path);
    fireEvent.popState(window);
  }

  await screen.findByRole('heading', { name: '审阅第二章的故事档案变更' });
  return user;
}

describe('controlled commit preview', () => {
  test('blocks the preview when no revision candidate has been accepted', () => {
    renderRoute(commitPreviewPath);

    expect(screen.getByText('还没有已接受的修订草稿')).toBeVisible();
    expect(screen.getByText(/请先比较并接受修订候选/)).toBeVisible();
    expect(screen.getByRole('button', { name: '正式提交本章' })).toBeDisabled();
    expect(screen.queryByText('已接受草稿与本次预览来源一致')).toBeNull();
  });

  test('presents the exact Story Record changes as read-only author-facing groups', async () => {
    await renderAcceptedCommitPreview();

    expect(screen.getByRole('heading', { name: '审阅第二章的故事档案变更' })).toBeVisible();
    expect(screen.getByText('第二章和尚未更新的故事档案仍保持不变')).toBeVisible();
    expect(screen.getByText('本页只是只读预览，尚未正式提交任何内容。')).toBeVisible();

    const expectedGroups = [
      ['新增故事事实', 5],
      ['人物变化', 1],
      ['时间线变化', 4],
      ['待兑现悬念', 1],
      ['伏笔', 2],
      ['读者认知', 4]
    ] as const;

    for (const [label, count] of expectedGroups) {
      const group = screen.getByRole('region', { name: label });
      expect(within(group).getAllByRole('listitem')).toHaveLength(count);
      expect(within(group).getByText(`${count} 项`)).toBeVisible();
    }

    expect(screen.getByRole('region', { name: '高风险变化' })).toBeVisible();
  });

  test('requires an explicit high-risk decision before formal commit is available', async () => {
    const user = await renderAcceptedCommitPreview();

    const highRisk = screen.getByRole('region', { name: '高风险变化' });
    expect(within(highRisk).getByText('临江里三栋不存在的十七层在哪里？')).toBeVisible();
    expect(within(highRisk).getByText('从“正在推进”变为“出现实体证据”')).toBeVisible();
    expect(within(highRisk).getByText(/登记表、按钮挡板和写有林遥姓名的小票/)).toBeVisible();
    expect(within(highRisk).getByRole('radio', { name: '批准这项变化' })).not.toBeChecked();
    expect(within(highRisk).getByRole('radio', { name: '返回修改这项变化' })).not.toBeChecked();
    expect(within(highRisk).getByRole('radio', { name: '拒绝这项变化' })).not.toBeChecked();

    const commitButton = screen.getByRole('button', { name: '正式提交本章' });
    expect(commitButton).toBeDisabled();
    expect(screen.getByText('请先决定如何处理 1 项高风险变化。')).toBeVisible();

    await user.click(within(highRisk).getByRole('radio', { name: '批准这项变化' }));

    expect(commitButton).toBeEnabled();
    expect(screen.getByText('高风险变化已完成审阅，可以进入最终确认。')).toBeVisible();
  });

  test.each([
    [
      '返回修改这项变化',
      '这项变化需要先返回章节修改，再重新生成提交预览；当前不能正式提交。'
    ],
    [
      '拒绝这项变化',
      '拒绝不会从预览中静默移除这项变化；请返回章节调整内容，再重新生成提交预览。'
    ]
  ])(
    'keeps formal commit blocked after choosing %s',
    async (decisionLabel, explanation) => {
      const user = await renderAcceptedCommitPreview();

      await user.click(screen.getByRole('radio', { name: decisionLabel }));

      expect(screen.getByRole('button', { name: '正式提交本章' })).toBeDisabled();
      expect(screen.getByText(explanation)).toBeVisible();
      expect(screen.getByRole('button', { name: '返回本章修改' })).toBeVisible();
    }
  );

  test('keeps technical identifiers absent until details are explicitly opened', async () => {
    const user = await renderAcceptedCommitPreview();

    expect(screen.queryByText('preview.chapter-2.accepted-draft.v1')).toBeNull();
    expect(screen.queryByText('mystery.radio-caller.transition')).toBeNull();

    await user.click(screen.getByText('技术详情'));

    expect(screen.getByText('preview.chapter-2.accepted-draft.v1')).toBeVisible();
    expect(screen.getByText('mystery.radio-caller.transition')).toBeVisible();
  });

  test('confirms canonical effects and restores focus on cancel', async () => {
    await renderAcceptedCommitPreview();

    fireEvent.click(screen.getByRole('radio', { name: '批准这项变化' }));
    const commitButton = screen.getByRole('button', { name: '正式提交本章' });
    fireEvent.click(commitButton);

    const dialog = screen.getByRole('dialog', { name: '最终确认正式提交' });
    expect(
      within(dialog).getByRole('button', { name: '返回继续审阅' })
    ).toHaveFocus();
    expect(within(dialog).getByText(/真实提交会创建正式故事内容/)).toBeVisible();
    expect(within(dialog).getByText(/操作前后创建安全还原点/)).toBeVisible();

    fireEvent.click(within(dialog).getByRole('button', { name: '返回继续审阅' }));
    await waitFor(() => expect(commitButton).toHaveFocus());
  });

  test('only reports a simulation after final confirmation', async () => {
    await renderAcceptedCommitPreview();

    fireEvent.click(screen.getByRole('radio', { name: '批准这项变化' }));
    const commitButton = screen.getByRole('button', { name: '正式提交本章' });
    fireEvent.click(commitButton);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '最终确认正式提交' }))
        .getByRole('button', { name: '提交第二章并创建安全还原点' })
    );

    expect(screen.getByText('交互模拟完成，真实故事档案仍未改变')).toBeVisible();
    expect(screen.getByText('第二章仍未正式提交；重新打开本页会回到审阅状态。')).toBeVisible();
    expect(screen.queryByText('故事档案已更新')).toBeNull();
    expect(screen.queryByText('本章已正式提交')).toBeNull();
  });

  test('keeps a stale preview blocked and offers safe refresh and inspection actions', async () => {
    await renderAcceptedCommitPreview(`${commitPreviewPath}?state=stale`);

    expect(screen.getByText('这份提交预览已经过期')).toBeVisible();
    expect(screen.getByText('故事档案在预览生成后发生了变化；没有内容被正式提交。')).toBeVisible();
    expect(screen.getByRole('button', { name: '正式提交本章' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '刷新提交预览' })).toBeVisible();
    expect(screen.getByRole('button', { name: '查看最近的故事档案变化' })).toBeVisible();

    const readiness = screen.getByRole('region', { name: '提交准备情况' });
    expect(
      within(readiness).getByText('需要刷新：故事档案已在这份预览生成后发生变化。')
    ).toBeVisible();
    expect(within(readiness).getByLabelText('未通过')).toBeVisible();
    expect(
      within(readiness).queryByText('当前故事档案是生成预览时的版本')
    ).toBeNull();
  });

  test('resets stale review state before showing a refreshed preview', async () => {
    const user = await renderAcceptedCommitPreview(`${commitPreviewPath}?state=stale`);

    const approve = screen.getByRole('radio', { name: '批准这项变化' });
    await user.click(approve);
    expect(approve).toBeChecked();
    expect(screen.getByRole('button', { name: '正式提交本章' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '刷新提交预览' }));

    expect(screen.getByRole('radio', { name: '批准这项变化' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '返回修改这项变化' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '拒绝这项变化' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '正式提交本章' })).toBeDisabled();
    expect(screen.getByText('请先决定如何处理 1 项高风险变化。')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: '最终确认正式提交' })).toBeNull();
    expect(screen.queryByText('交互模拟完成，真实故事档案仍未改变')).toBeNull();
  });

  test('continues naturally from an accepted revision into commit preview', async () => {
    await renderAcceptedCommitPreview();

    expect(screen.getByRole('heading', { name: '审阅第二章的故事档案变更' })).toBeVisible();
    expect(screen.getByText('已接受草稿 · 尚未正式提交')).toBeVisible();
  });

  test('invalidates the preview when the accepted draft buffer changes after acceptance', () => {
    renderRoute(revisionPath);

    fireEvent.click(screen.getByRole('button', { name: '接受候选' }));
    const acceptedEditor = screen.getByRole('textbox', { name: '已接受的修订草稿' });
    fireEvent.change(acceptedEditor, {
      target: {
        value: `${(acceptedEditor as HTMLTextAreaElement).value}\n\n林澈补记了新的雨声。`
      }
    });
    fireEvent.click(screen.getByRole('button', { name: '审阅故事档案变更' }));

    expect(screen.getByText('已接受草稿在预览生成后发生了变化')).toBeVisible();
    expect(screen.getByRole('button', { name: '正式提交本章' })).toBeDisabled();
    expect(screen.queryByText('已接受草稿与本次预览来源一致')).toBeNull();
    expect(screen.getByText('需要刷新：已接受草稿与预览来源不再一致。')).toBeVisible();
  });

  test('regenerates the preview from the edited accepted draft before commit review can continue', async () => {
    renderRoute(revisionPath);

    fireEvent.click(screen.getByRole('button', { name: '接受候选' }));
    const acceptedEditor = screen.getByRole('textbox', { name: '已接受的修订草稿' });
    fireEvent.change(acceptedEditor, {
      target: {
        value: `${(acceptedEditor as HTMLTextAreaElement).value}\n\n林澈补记了新的雨声。`
      }
    });
    fireEvent.click(screen.getByRole('button', { name: '审阅故事档案变更' }));

    fireEvent.click(screen.getByRole('button', { name: '根据当前草稿刷新预览' }));

    expect(screen.queryByText('已接受草稿在预览生成后发生了变化')).toBeNull();
    expect(screen.getByText('已接受草稿与本次预览来源一致')).toBeVisible();
    expect(screen.getByRole('button', { name: '正式提交本章' })).toBeDisabled();
    expect(screen.getByText('请先决定如何处理 1 项高风险变化。')).toBeVisible();
  });

  test('uses the accepted post-midnight candidate as the only Chapter 2 narrative source', () => {
    const acceptedCandidate = rainRadio.chapterWorkspace.versions.revision_candidate;
    const pendingPreview = JSON.stringify(rainRadio.pendingChanges);
    const formalPreview = JSON.stringify(chapterTwoCommitPreview.groups);
    const contradictorySequence = /下午|15:50|16:00|天亮|包裹交接|站点后门/;

    expect(acceptedCandidate).toMatch(/零点四十分后/);
    expect(acceptedCandidate).toMatch(/交接只发生过一次/);
    expect(acceptedCandidate).not.toMatch(contradictorySequence);
    expect(pendingPreview).not.toMatch(contradictorySequence);
    expect(formalPreview).not.toMatch(contradictorySequence);

    for (const expected of ['林澈', '许雯', '林遥', '零点四十分', '十七层']) {
      expect(pendingPreview).toContain(expected);
      expect(formalPreview).toContain(expected);
    }
    expect(pendingPreview).toMatch(/00:50|零点五十分/);
    expect(formalPreview).toMatch(/00:50|零点五十分/);
  });
});
