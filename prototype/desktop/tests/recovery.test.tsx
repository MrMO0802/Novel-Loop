import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { App } from '../src/app/App';

afterEach(cleanup);

function renderRoute(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

const recoveryStates = [
  {
    key: 'codex-missing',
    title: '这台电脑上还没有找到 Codex',
    protected: '作品内容和故事档案都没有改变。',
    safest: '查看安装说明',
    second: '重新检查',
    technical: 'readiness.codex.not-found'
  },
  {
    key: 'login-required',
    title: 'Codex 需要先完成登录',
    protected: '登录信息不会显示在 Novel Loop 中，作品也没有改变。',
    safest: '查看登录说明',
    second: '重新检查',
    technical: 'readiness.codex.login-required'
  },
  {
    key: 'doctor-warning',
    title: '写作功能可用，但有一项配置提醒',
    protected: '当前作品可以继续编辑，已有内容不会受这项提醒影响。',
    safest: '继续写作',
    second: '查看处理建议',
    technical: 'readiness.doctor.warning'
  },
  {
    key: 'timeout',
    title: '写作任务用时超过预期',
    protected: '你的草稿和已经完成的阶段都已保留。',
    safest: '从上一个安全阶段继续',
    second: '重新尝试',
    technical: 'task.chapter-3.timeout'
  },
  {
    key: 'usage-limit',
    title: '当前暂时无法继续使用 Codex',
    protected: '草稿已经保留，故事档案没有任何变化。',
    safest: '继续手动编辑',
    second: '稍后再试',
    technical: 'task.chapter-3.usage-unavailable'
  },
  {
    key: 'invalid-output',
    title: '返回的内容无法安全使用',
    protected: '这次返回没有应用到草稿或故事档案。',
    safest: '继续手动编辑',
    second: '重新生成',
    technical: 'task.chapter-3.structured-response-invalid'
  },
  {
    key: 'diagnostics-hard-failure',
    title: '第二章仍有关键一致性问题',
    protected: '本章保持为草稿，正式提交入口已经暂停。',
    safest: '查看正文依据',
    second: '创建针对性修订',
    technical: 'review.chapter-2.blocking'
  },
  {
    key: 'no-improvement',
    title: '这份修订没有解决选中的问题',
    protected: '原稿保持不变，候选稿没有替换任何内容。',
    safest: '返回手动修改',
    second: '保留为备选版本',
    technical: 'revision.chapter-2.no-improvement'
  },
  {
    key: 'candidate-stale',
    title: '修订候选已经过期',
    protected: '你后来修改的草稿已经保留，旧候选不会覆盖它。',
    safest: '重新生成候选',
    second: '比较生成依据',
    technical: 'revision.chapter-2.source-changed'
  },
  {
    key: 'commit-stale',
    title: '提交预览已经过期',
    protected: '第二章和故事档案都没有被正式提交。',
    safest: '刷新提交预览',
    second: '查看最近的故事档案变化',
    technical: 'commit-preview.chapter-2.story-record-changed'
  },
  {
    key: 'project-damage',
    title: '作品结构需要先检查',
    protected: '作品已用保护模式打开，正式内容写入已暂停。',
    safest: '检查作品',
    second: '从安全还原点恢复',
    technical: 'project.rain-radio.structure-mismatch'
  },
  {
    key: 'incomplete-journal',
    title: '上一次正式提交没有完整结束',
    protected: '新的正式提交已被阻止，提交前的内容仍可恢复。',
    safest: '查看恢复摘要',
    second: '恢复提交前状态',
    technical: 'commit.chapter-2.journal-incomplete'
  },
  {
    key: 'cancellation',
    title: '任务已经取消',
    protected: '已完成的内容得到保留，故事档案没有改变。',
    safest: '查看已保留内容',
    second: '继续此任务',
    technical: 'task.chapter-3.cancelled-by-author'
  },
  {
    key: 'crash',
    title: '上次关闭前有工作尚未结束',
    protected: '自动保存的草稿和安全阶段都已保留；不会自动继续 AI 写作，也不会自动正式提交。',
    safest: '查看恢复摘要',
    second: '恢复自动保存草稿',
    technical: 'session.previous-close.incomplete'
  }
] as const;

describe('Run Center', () => {
  test('shows the current task, last safe stage, destination, controls, and chronological history', async () => {
    const user = userEvent.setup();
    renderRoute('/tasks');

    expect(screen.getByRole('heading', { name: '任务中心' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '当前任务' })).toBeVisible();
    expect(screen.getByText('第三章草稿')).toBeVisible();
    expect(screen.getByText('已暂停在第 2 个场景，共 3 个')).toBeVisible();
    expect(screen.getByText('已进行 3 分钟')).toBeVisible();
    expect(screen.getByText('上一个安全阶段：场景一草稿已保存')).toBeVisible();
    expect(screen.getByText('完成后会放入第三章草稿，不会自动正式提交。')).toBeVisible();
    expect(screen.getByRole('button', { name: '继续此任务' })).toBeVisible();
    expect(screen.getByRole('button', { name: '取消任务' })).toBeVisible();

    const recent = screen.getByRole('region', { name: '最近任务' });
    expect(within(recent).getByText('第二章检查')).toBeVisible();
    expect(within(recent).getByText('第二章修订')).toBeVisible();
    expect(within(recent).getByText('第一章提交预览')).toBeVisible();
    expect(within(recent).getByText('未完成')).toBeVisible();

    expect(screen.queryByText('task.chapter-3.scene-2')).toBeNull();
    await user.click(screen.getByText('技术详情'));
    expect(screen.getByText('task.chapter-3.scene-2')).toBeVisible();
  });

  test('resumes a paused task and then records an honest cancellation transition', async () => {
    const user = userEvent.setup();
    renderRoute('/tasks');

    expect(screen.getByText('可恢复')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '继续此任务' }));

    expect(screen.getByText('进行中')).toBeVisible();
    expect(screen.getByText('正在写第 2 个场景，共 3 个')).toBeVisible();
    expect(
      screen.getByText('交互模拟：任务已从上一个安全阶段继续，真实任务队列没有改变。')
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: '继续此任务' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '取消任务' }));

    expect(screen.getByText('正在取消')).toBeVisible();
    expect(screen.getByText('正在安全停止当前任务')).toBeVisible();
    expect(
      screen.getByText('交互模拟：取消请求已记录，真实任务队列和作品内容没有改变。')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: '取消任务' })).toBeDisabled();
  });
});

describe('recovery guidance', () => {
  test.each(recoveryStates)(
    'explains happened, protected, and safest next action for $key',
    async ({ key, protected: protectedCopy, safest, second, technical, title }) => {
      const user = userEvent.setup();
      renderRoute(`/tasks?recovery=${key}`);

      const dialog = screen.getByRole('dialog', { name: title });
      expect(within(dialog).getByRole('button', { name: safest })).toHaveFocus();
      expect(within(dialog).getByRole('heading', { name: title })).toBeVisible();
      expect(within(dialog).getByText(protectedCopy)).toBeVisible();
      expect(within(dialog).getByRole('button', { name: safest })).toBeVisible();
      expect(within(dialog).getByRole('button', { name: second })).toBeVisible();

      const firstAction = within(dialog).getByRole('button', { name: safest });
      const secondAction = within(dialog).getByRole('button', { name: second });
      expect(
        firstAction.compareDocumentPosition(secondAction) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      expect(screen.queryByText(technical)).toBeNull();
      expect(dialog).not.toHaveTextContent(/token|JSONL|\/home\/|\.json|codex login/i);

      await user.click(within(dialog).getByText('技术详情'));
      expect(within(dialog).getByText(technical)).toBeVisible();
    }
  );

  test('treats the doctor warning as non-blocking and allows writing to continue', () => {
    renderRoute('/tasks?recovery=doctor-warning');

    const dialog = screen.getByRole('dialog', {
      name: '写作功能可用，但有一项配置提醒'
    });
    expect(within(dialog).getByText('这项提醒不会阻止继续创作。')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '继续写作' })).toBeEnabled();
    expect(within(dialog).getAllByRole('status')).toHaveLength(2);
  });

  test('completes a non-destructive recovery action with an explicit live simulation result', async () => {
    const user = userEvent.setup();
    renderRoute('/tasks?recovery=doctor-warning');

    await user.click(screen.getByRole('button', { name: '继续写作' }));

    expect(
      screen.queryByRole('dialog', { name: '写作功能可用，但有一项配置提醒' })
    ).toBeNull();
    expect(
      screen.getByRole('status', {
        name: '恢复操作结果'
      })
    ).toHaveTextContent(
      '已模拟“继续写作”。当前作品仍保持受保护状态，真实任务和故事档案没有改变。'
    );
  });

  test.each([
    ['project-damage', '作品结构需要先检查'],
    ['incomplete-journal', '上一次正式提交没有完整结束']
  ])('announces %s as blocking and prevents canonical writes', (key, title) => {
    renderRoute(`/tasks?recovery=${key}`);

    const dialog = screen.getByRole('dialog', { name: title });
    expect(within(dialog).getByRole('alert')).toBeVisible();
    expect(within(dialog).getByText(/正式内容写入已暂停|新的正式提交已被阻止/)).toBeVisible();
  });

  test('does not automatically resume AI work or commit after a crash', () => {
    renderRoute('/tasks?recovery=crash');

    const dialog = screen.getByRole('dialog', {
      name: '上次关闭前有工作尚未结束'
    });
    expect(within(dialog).getByText(/不会自动继续 AI 写作，也不会自动正式提交/)).toBeVisible();
    expect(within(dialog).queryByText(/正在继续|正在提交/)).toBeNull();
  });

  test.each([
    ['crash', '上次关闭前有工作尚未结束'],
    ['incomplete-journal', '上一次正式提交没有完整结束']
  ])('shows a dated safe restore point inside the %s recovery summary', async (key, title) => {
    const user = userEvent.setup();
    renderRoute(`/tasks?recovery=${key}`);

    const dialog = screen.getByRole('dialog', { name: title });
    await user.click(within(dialog).getByRole('button', { name: '查看恢复摘要' }));

    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole('heading', { name: '恢复摘要' })).toBeVisible();
    expect(within(dialog).getByText('安全还原点')).toBeVisible();
    expect(within(dialog).getByText(/2026 年 7 月 24 日 \d{2}:\d{2}/)).toBeVisible();
    expect(
      within(dialog).getAllByText(/第二章提交前|第二章自动保存草稿/).length
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('status', { name: '恢复操作结果' })).toBeNull();
  });

  test.each([
    ['project-damage', '从安全还原点恢复', '确认使用安全还原点恢复？', '恢复并保留当前诊断副本'],
    ['crash', '放弃未完成任务', '确认放弃未完成任务？', '放弃任务并保留草稿']
  ])(
    'requires a second explicit confirmation for destructive action in %s',
    async (key, action, title, confirmation) => {
      const user = userEvent.setup();
      renderRoute(`/tasks?recovery=${key}`);

      await user.click(screen.getByRole('button', { name: action }));

      const confirmationDialog = screen.getByRole('alertdialog', { name: title });
      expect(within(confirmationDialog).getByRole('button', { name: confirmation })).toBeVisible();
      expect(within(confirmationDialog).getByRole('button', { name: '返回恢复建议' })).toBeVisible();
      expect(within(confirmationDialog).queryByRole('button', { name: /^(是|确定)$/ })).toBeNull();
    }
  );

  test('completes destructive confirmation as a protected simulation and closes both dialogs', async () => {
    const user = userEvent.setup();
    renderRoute('/tasks?recovery=project-damage');

    await user.click(screen.getByRole('button', { name: '从安全还原点恢复' }));
    await user.click(
      within(
        screen.getByRole('alertdialog', {
          name: '确认使用安全还原点恢复？'
        })
      ).getByRole('button', { name: '恢复并保留当前诊断副本' })
    );

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(
      screen.queryByRole('dialog', { name: '作品结构需要先检查' })
    ).toBeNull();
    expect(
      screen.getByRole('status', {
        name: '恢复操作结果'
      })
    ).toHaveTextContent(
      '已模拟“恢复并保留当前诊断副本”。作品仍处于保护状态，真实正式内容没有改变。'
    );
  });

  test('returns focus to the recovery invoker when the dialog closes', async () => {
    const user = userEvent.setup();
    renderRoute('/tasks?recovery=timeout');

    const trigger = screen.getByRole(
      'button',
      { hidden: true, name: '查看写作任务恢复建议' }
    );
    await user.click(
      within(screen.getByRole('dialog', { name: '写作任务用时超过预期' }))
        .getByRole('button', { name: '关闭恢复说明' })
    );

    expect(trigger).toHaveFocus();
  });
});
