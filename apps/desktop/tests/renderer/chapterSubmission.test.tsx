// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ChapterSubmissionView } from '../../src/renderer/src/features/submission/ChapterSubmissionView';
import { SubmissionChanges } from '../../src/renderer/src/features/submission/SubmissionChanges';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import {
  SubmissionChangeSchema,
  SubmissionPreviewResultSchema,
  SubmissionTaskSchema,
  type SubmissionChange,
  type SubmissionConfirmResult,
  type SubmissionTask
} from '../../src/shared/submissionContract';
import { createInertSubmissionApi, deferred } from './desktopApiFixtures';

const projectKey = 'project_submission_fixture';
const taskId = 'submission_check_fixture';
const previewToken = `submission_${'a'.repeat(48)}`;
const ready = SubmissionPreviewResultSchema.parse({
  outcome: 'ready', previewToken, chapterNumber: 1,
  draft: { kind: 'adopted', label: '作者采用的第二版正文', summary: '林默留下了报告的副本。' },
  changes: [
    { category: 'facts', summary: '报告副本已经留存。', risk: 'low' },
    { category: 'characters', summary: '林默决定追查报告来源。', risk: 'high' }
  ],
  warnings: ['人物动机变化较大，请核对。']
});
const committed = {
  outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: true
} satisfies SubmissionConfirmResult;

function task(overrides: Partial<SubmissionTask> = {}): SubmissionTask {
  return SubmissionTaskSchema.parse({
    taskId, projectKey, chapterNumber: 1, stage: 'checking_source', status: 'running',
    startedAt: '2026-09-21T08:00:00.000Z', endedAt: null, safeErrorCode: null,
    issues: [], ...overrides
  });
}

function installApi() {
  const submission = createInertSubmissionApi();
  submission.readPreview.mockResolvedValue({
    outcome: 'not_ready', messageKey: 'submission.not_ready', issues: []
  });
  submission.startCheck.mockResolvedValue({ taskId });
  submission.get.mockResolvedValue(task());
  submission.cancel.mockResolvedValue(task({ status: 'cancel_requested' }));
  submission.confirm.mockResolvedValue(committed);
  vi.stubGlobal('novelLoop', { submission } satisfies Pick<NovelLoopDesktopApi, 'submission'>);
  return submission;
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

async function tick(milliseconds = 1_000) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

async function mount() {
  const onBack = vi.fn();
  const onCommitted = vi.fn();
  const view = render(<ChapterSubmissionView projectKey={projectKey} onBack={onBack} onCommitted={onCommitted} />);
  await flush();
  return { ...view, onBack, onCommitted };
}

async function start() {
  fireEvent.click(screen.getByRole('button', { name: '开始检查' }));
  await flush();
}

function openConfirmation() {
  fireEvent.click(screen.getByRole('checkbox', { name: '我已审阅正文版本和全部故事变化' }));
  fireEvent.click(screen.getByRole('button', { name: '正式提交第 1 章' }));
  return screen.getByRole('dialog', { name: '确认正式提交第 1 章？' });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-21T08:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('isolated chapter submission', () => {
  test('a display failure can be reread without regenerating or submitting the adopted draft', async () => {
    const api = installApi();
    api.readPreview.mockResolvedValueOnce({ outcome: 'blocked', messageKey: 'submission.readFailed', issues: [] });
    await mount();
    expect(screen.getByRole('alert')).toHaveTextContent('暂时无法读取检查记录');
    expect(screen.queryByText('检查未通过，请核对问题后返回修改。')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '让 AI 根据检查结果修订' })).not.toBeInTheDocument();
    api.readPreview.mockResolvedValue(ready);
    fireEvent.click(screen.getByRole('button', { name: '重新读取检查记录' }));
    await flush();
    expect(screen.getByRole('button', { name: '正式提交第 1 章' })).toBeDisabled();
    expect(api.startCheck).not.toHaveBeenCalled();
    expect(api.confirm).not.toHaveBeenCalled();
    openConfirmation();
    expect(api.confirm).not.toHaveBeenCalled();
  });

  test('reads only on mount and requires explicit start, with request objects and a duplicate guard', async () => {
    const api = installApi();
    const pending = deferred<{ taskId: string }>();
    api.startCheck.mockReturnValue(pending.promise);
    await mount();
    expect(api.readPreview).toHaveBeenCalledWith({ projectKey });
    expect(api.startCheck).not.toHaveBeenCalled();
    expect(api.confirm).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: '开始检查' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.startCheck).toHaveBeenCalledExactlyOnceWith({ projectKey });
    expect(button).toBeDisabled();
    await act(async () => { pending.resolve({ taskId }); });
    await tick();
    expect(api.get).toHaveBeenCalledWith({ taskId });
  });

  test('shows stages and elapsed time, requests safe cancellation and polls until cancelled', async () => {
    const api = installApi();
    await mount();
    await start();
    await tick();
    expect(screen.getByRole('list', { name: '检查进度' })).toHaveTextContent('核对正文');
    api.get.mockResolvedValue(task({ stage: 'diagnostics' }));
    await tick(2_000);
    expect(within(screen.getByRole('list', { name: '检查进度' })).getByText('检查一致性').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText(/已用时/)).toHaveTextContent('3 秒');
    fireEvent.click(screen.getByRole('button', { name: '完成当前安全步骤后停止' }));
    await flush();
    expect(api.cancel).toHaveBeenCalledExactlyOnceWith({ taskId });
    expect(screen.getByRole('status')).toHaveTextContent('已请求停止');
    api.get.mockResolvedValue(task({ status: 'cancelled', endedAt: '2026-09-21T08:00:04.000Z' }));
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('检查已停止');
    const calls = api.get.mock.calls.length;
    await tick(5_000);
    expect(api.get).toHaveBeenCalledTimes(calls);
    expect(api.confirm).not.toHaveBeenCalled();
  });

  test('renders blocked diagnostics and short evidence with a return-to-edit action', async () => {
    const api = installApi();
    api.get.mockResolvedValue(task({
      status: 'blocked', stage: 'diagnostics', safeErrorCode: 'diagnostics_failed',
      endedAt: '2026-09-21T08:00:01.000Z',
      issues: [{ severity: 'error', message: '人物行动与前文矛盾。', evidence: '前文尚未拿到报告。' }]
    }));
    const view = await mount();
    await start();
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('检查未通过');
    expect(screen.getByText('人物行动与前文矛盾。')).toBeVisible();
    expect(screen.getByText('前文尚未拿到报告。')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    expect(view.onBack).toHaveBeenCalledOnce();
    expect(api.confirm).not.toHaveBeenCalled();
  });

  test('reads the full ready review after polling, without automatically committing', async () => {
    const api = installApi();
    await mount();
    api.readPreview.mockResolvedValue(ready);
    api.get.mockResolvedValue(task({ status: 'ready', stage: 'validating_patch', endedAt: '2026-09-21T08:00:01.000Z' }));
    await start();
    await tick();
    expect(screen.getByText('作者采用的第二版正文')).toBeVisible();
    expect(screen.getByText('林默留下了报告的副本。')).toBeVisible();
    expect(screen.getByText('人物动机变化较大，请核对。')).toBeVisible();
    expect(screen.getByText('高风险')).toBeVisible();
    expect(screen.getByRole('region', { name: '提交内容与检查结果' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: '正式提交第 1 章' })).toBeDisabled();
    expect(api.confirm).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent(/submission_[a-f0-9]{48}|project_submission_fixture|characters/);
  });

  test('requires the checkbox and a separate modal click; traps and restores focus without an Enter default', async () => {
    const api = installApi();
    api.readPreview.mockResolvedValue(ready);
    await mount();
    const dialog = openConfirmation();
    const cancel = within(dialog).getByRole('button', { name: '继续审阅' });
    const confirm = within(dialog).getByRole('button', { name: '确认正式提交' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(api.confirm).not.toHaveBeenCalled();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正式提交第 1 章' })).toHaveFocus();
    expect(api.confirm).not.toHaveBeenCalled();
  });

  test.each([true, false])('disables duplicate confirmation and hands the committed result to the next action (next=%s)', async (hasNextChapter) => {
    const api = installApi();
    api.readPreview.mockResolvedValue(ready);
    const pending = deferred<SubmissionConfirmResult>();
    api.confirm.mockReturnValue(pending.promise);
    const view = await mount();
    const dialog = openConfirmation();
    const confirm = within(dialog).getByRole('button', { name: '确认正式提交' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(api.confirm).toHaveBeenCalledExactlyOnceWith({ projectKey, previewToken, confirm: true });
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '继续审阅' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeVisible();
    const result = { ...committed, hasNextChapter };
    await act(async () => { pending.resolve(result); });
    expect(screen.getByRole('heading', { name: '第 1 章已正式提交' })).toBeVisible();
    expect(view.onCommitted).not.toHaveBeenCalled();
    const nextAction = screen.getByRole('button', { name: hasNextChapter ? '创作下一章' : '返回全局规划' });
    fireEvent.click(nextAction);
    fireEvent.click(nextAction);
    expect(view.onCommitted).toHaveBeenCalledExactlyOnceWith(result);
    expect(api.startCheck).not.toHaveBeenCalled();
  });

  test.each(['stale', 'recovery_required'] as const)('invalidates approval on %s without retrying automatically', async (outcome) => {
    const api = installApi();
    api.readPreview.mockResolvedValue(ready);
    api.confirm.mockResolvedValue({ outcome, messageKey: `submission.${outcome}` });
    await mount();
    fireEvent.click(within(openConfirmation()).getByRole('button', { name: '确认正式提交' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(outcome === 'stale'
      ? '正文或故事档案已变化，请重新检查' : '提交中断，需要检查');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '正式提交第 1 章' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '检查并提交' })).toHaveFocus();
    if (outcome === 'recovery_required') {
      expect(screen.queryByRole('button', { name: '重新检查' })).not.toBeInTheDocument();
    } else {
      fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
      await flush();
      expect(api.startCheck).toHaveBeenCalledOnce();
    }
    await tick(5_000);
    expect(api.confirm).toHaveBeenCalledTimes(1);
  });

  test('treats a lost confirmation response as uncertain, hides raw errors and offers no resubmit', async () => {
    const api = installApi();
    api.readPreview.mockResolvedValue(ready);
    api.confirm.mockRejectedValue(new Error('/private/project/source.md secret submission_abc'));
    await mount();
    fireEvent.click(within(openConfirmation()).getByRole('button', { name: '确认正式提交' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('暂时无法确认提交结果');
    expect(document.body).not.toHaveTextContent(/private|source.md|secret/);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新检查' })).not.toBeInTheDocument();
    await tick(10_000);
    expect(api.confirm).toHaveBeenCalledOnce();
  });

  test('recovers a durable committed outcome on mount without provider or confirmation calls', async () => {
    const api = installApi();
    api.readPreview.mockResolvedValue(SubmissionPreviewResultSchema.parse(committed));
    const view = await mount();
    expect(screen.getByRole('heading', { name: '第 1 章已正式提交' })).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创作下一章' }));
    expect(view.onCommitted).toHaveBeenCalledExactlyOnceWith(committed);
    expect(api.startCheck).not.toHaveBeenCalled();
    expect(api.confirm).not.toHaveBeenCalled();
  });

  test('recovers a lost confirmation response through read-only refresh, never replaying confirmation', async () => {
    const api = installApi();
    api.readPreview.mockResolvedValueOnce(ready).mockResolvedValue(committed);
    api.confirm.mockRejectedValue(new Error('response lost'));
    await mount();
    fireEvent.click(within(openConfirmation()).getByRole('button', { name: '确认正式提交' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '重新读取检查记录' }));
    await flush();
    expect(screen.getByRole('heading', { name: '第 1 章已正式提交' })).toBeVisible();
    expect(api.confirm).toHaveBeenCalledTimes(1);
    expect(api.startCheck).not.toHaveBeenCalled();
  });

  test('never regresses the stage when an older cancellation response follows a newer poll', async () => {
    const api = installApi();
    const pending = deferred<SubmissionTask>();
    api.cancel.mockReturnValue(pending.promise);
    await mount();
    await start();
    fireEvent.click(screen.getByRole('button', { name: '完成当前安全步骤后停止' }));
    api.get.mockResolvedValue(task({ stage: 'proposing_patch' }));
    await tick();
    await act(async () => { pending.resolve(task({ status: 'cancel_requested', stage: 'diagnostics' })); });
    const list = screen.getByRole('list', { name: '检查进度' });
    expect(within(list).getByText('整理故事变化').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('status')).toHaveTextContent('已请求停止');
  });

  test('keeps an acknowledged stop when the cancellation response is lost', async () => {
    const api = installApi();
    const pending = deferred<SubmissionTask>();
    api.cancel.mockReturnValue(pending.promise);
    await mount();
    await start();
    fireEvent.click(screen.getByRole('button', { name: '完成当前安全步骤后停止' }));
    api.get.mockResolvedValue(task({ stage: 'diagnostics', status: 'cancel_requested' }));
    await tick();
    await act(async () => { pending.reject(new Error('/private/cancel')); });
    expect(screen.getByRole('status')).toHaveTextContent('已请求停止');
    expect(screen.getByRole('button', { name: '完成当前安全步骤后停止' })).toBeDisabled();
    expect(screen.getByRole('status')).not.toHaveTextContent('暂时无法请求停止');
  });

  test('ignores a late cancel from a terminal task and allows cancellation of a new check', async () => {
    const api = installApi();
    const pending = deferred<SubmissionTask>();
    api.cancel.mockReturnValueOnce(pending.promise);
    await mount();
    await start();
    fireEvent.click(screen.getByRole('button', { name: '完成当前安全步骤后停止' }));
    api.get.mockResolvedValue(task({ status: 'failed', safeErrorCode: 'timeout', endedAt: '2026-09-21T08:00:01.000Z' }));
    await tick();
    api.startCheck.mockResolvedValue({ taskId: 'check_second' });
    api.get.mockResolvedValue(task({ taskId: 'check_second', stage: 'diagnostics' }));
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    await flush();
    expect(screen.getByRole('button', { name: '完成当前安全步骤后停止' })).toBeEnabled();
    await act(async () => { pending.resolve(task({ status: 'cancelled', endedAt: '2026-09-21T08:00:01.000Z' })); });
    expect(screen.getByRole('status')).toHaveTextContent('检查一致性');
    api.cancel.mockResolvedValue(task({ taskId: 'check_second', status: 'cancel_requested' }));
    fireEvent.click(screen.getByRole('button', { name: '完成当前安全步骤后停止' }));
    await flush();
    expect(api.cancel).toHaveBeenLastCalledWith({ taskId: 'check_second' });
  });

  test('keeps cancellation monotonic when an older running poll arrives late', async () => {
    const api = installApi();
    const pending = deferred<SubmissionTask>();
    api.get.mockReturnValueOnce(pending.promise);
    await mount();
    await start();
    fireEvent.click(screen.getByRole('button', { name: '完成当前安全步骤后停止' }));
    await flush();
    await act(async () => { pending.resolve(task({ stage: 'diagnostics' })); });
    expect(screen.getByRole('status')).toHaveTextContent('已请求停止');
    expect(screen.getByRole('button', { name: '完成当前安全步骤后停止' })).toBeDisabled();
  });

  test('pauses failed polling and resumes only on a read-progress action', async () => {
    const api = installApi();
    api.get.mockRejectedValueOnce(new Error('/private/progress'));
    await mount();
    await start();
    expect(screen.getByRole('status')).toHaveTextContent('暂时无法读取进度');
    await tick(15_000);
    expect(api.get).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重新读取进度' }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('核对正文');
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.startCheck).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent('/private/');
  });

  test('offers cancellation again on failure while keeping progress active', async () => {
    const api = installApi();
    api.cancel.mockRejectedValueOnce(new Error('/private/stop'));
    await mount();
    await start();
    fireEvent.click(screen.getByRole('button', { name: '完成当前安全步骤后停止' }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('暂时无法请求停止');
    expect(screen.getByRole('button', { name: '完成当前安全步骤后停止' })).toBeEnabled();
    api.get.mockResolvedValue(task({ stage: 'diagnostics' }));
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('检查一致性');
  });

  test('does not read or update a late ready task after unmount', async () => {
    const api = installApi();
    const pending = deferred<SubmissionTask>();
    api.get.mockReturnValue(pending.promise);
    const view = await mount();
    await start();
    view.unmount();
    await act(async () => { pending.resolve(task({ status: 'ready', stage: 'validating_patch', endedAt: '2026-09-21T08:00:01.000Z' })); });
    await tick(5_000);
    expect(api.readPreview).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(view.onCommitted).not.toHaveBeenCalled();
  });

  test('discards old project approvals and ignores a late old-project preview', async () => {
    const api = installApi();
    const pending = deferred<ReturnType<typeof SubmissionPreviewResultSchema.parse>>();
    api.readPreview.mockReturnValueOnce(pending.promise);
    const view = await mount();
    view.rerender(<ChapterSubmissionView projectKey="project_other_fixture" onBack={view.onBack} onCommitted={view.onCommitted} />);
    await flush();
    await act(async () => { pending.resolve(ready); });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始检查' })).toBeEnabled();
    expect(api.readPreview).toHaveBeenLastCalledWith({ projectKey: 'project_other_fixture' });
    expect(api.confirm).not.toHaveBeenCalled();
  });

  test('a stale recheck replaces the review and clears prior consent', async () => {
    const api = installApi();
    api.readPreview.mockResolvedValue(ready);
    api.confirm.mockResolvedValue({ outcome: 'stale', messageKey: 'submission.stale' });
    await mount();
    fireEvent.click(within(openConfirmation()).getByRole('button', { name: '确认正式提交' }));
    await flush();
    api.get.mockResolvedValue(task({ status: 'ready', stage: 'validating_patch', endedAt: '2026-09-21T08:00:01.000Z' }));
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    await flush();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: '正式提交第 1 章' })).toBeDisabled();
    expect(api.confirm).toHaveBeenCalledTimes(1);
  });

  test.each(['submission.recovery_required', 'submission.working_copy_pending'] as const)('blocks starting or confirming a restored %s record', async (messageKey) => {
    const api = installApi();
    api.readPreview.mockResolvedValue({ outcome: 'blocked', messageKey, issues: [] });
    await mount();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /开始检查|重新检查/ })).not.toBeInTheDocument();
    expect(api.startCheck).not.toHaveBeenCalled();
    expect(api.confirm).not.toHaveBeenCalled();
  });

  test('replaces obsolete issues when a read-only refresh returns a new ready review', async () => {
    const api = installApi();
    api.readPreview.mockResolvedValueOnce({
      outcome: 'blocked', messageKey: 'submission.diagnostics_failed',
      issues: [{ severity: 'error', message: '旧检查中的问题。', evidence: null }]
    }).mockResolvedValue(ready);
    await mount();
    expect(screen.getByText('旧检查中的问题。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新读取检查记录' }));
    await flush();
    expect(screen.queryByText('旧检查中的问题。')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  test.each(['source_stale', 'recovery_required', 'working_copy_pending', 'usage_limit', 'interrupted'] as const)('maps task error %s to safe Chinese and respects restart gates', async (safeErrorCode) => {
    const api = installApi();
    api.get.mockResolvedValue(task({
      status: 'failed', safeErrorCode, endedAt: '2026-09-21T08:00:01.000Z'
    }));
    await mount();
    await start();
    expect(screen.getByRole('alert')).toHaveTextContent(/[\u4e00-\u9fff]/);
    expect(document.body).not.toHaveTextContent(safeErrorCode);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const retry = screen.queryByRole('button', { name: '重新检查' });
    if (safeErrorCode === 'recovery_required' || safeErrorCode === 'working_copy_pending') expect(retry).toBeNull();
    else expect(retry).toBeEnabled();
    await tick(10_000);
    expect(api.startCheck).toHaveBeenCalledTimes(1);
    expect(api.confirm).not.toHaveBeenCalled();
  });

  test('keeps a failed initial read safe and does not start a check during recovery', async () => {
    const api = installApi();
    api.readPreview.mockRejectedValueOnce(new Error('/private/preview'));
    await mount();
    expect(screen.getByRole('alert')).toHaveTextContent('暂时无法读取检查记录');
    expect(screen.queryByRole('button', { name: '开始检查' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('/private/');
    fireEvent.click(screen.getByRole('button', { name: '重新读取检查记录' }));
    await flush();
    expect(screen.getByRole('button', { name: '开始检查' })).toBeEnabled();
    expect(api.startCheck).not.toHaveBeenCalled();
  });

  test('does not automatically retry an uncertain start or continue polling after its unmount', async () => {
    const api = installApi();
    api.startCheck.mockRejectedValueOnce(new Error('/private/start'));
    const view = await mount();
    await start();
    expect(screen.getByRole('alert')).toHaveTextContent('暂时无法确认检查是否开始');
    expect(screen.queryByRole('button', { name: '重新检查' })).not.toBeInTheDocument();
    await tick(10_000);
    expect(api.startCheck).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重新读取检查记录' }));
    await flush();
    const pending = deferred<{ taskId: string }>();
    api.startCheck.mockReturnValue(pending.promise);
    await start();
    view.unmount();
    await act(async () => { pending.resolve({ taskId }); });
    expect(api.get).not.toHaveBeenCalled();
  });

  test('rejects a mismatched task without displaying its diagnostic text', async () => {
    const api = installApi();
    api.get.mockResolvedValue(task({
      projectKey: 'project_other_fixture', status: 'blocked', safeErrorCode: 'diagnostics_failed',
      endedAt: '2026-09-21T08:00:01.000Z',
      issues: [{ severity: 'error', message: '其他作品的检查问题。', evidence: null }]
    }));
    await mount();
    await start();
    expect(screen.getByRole('status')).toHaveTextContent('暂时无法读取进度');
    expect(screen.queryByText('其他作品的检查问题。')).not.toBeInTheDocument();
    expect(api.confirm).not.toHaveBeenCalled();
  });
});

test('renders chapter progress mutations alongside story changes without exposing internal field names', () => {
  const progress = SubmissionChangeSchema.parse({
    category: 'progress', summary: '正式章节从第 1 章推进到第 2 章。', risk: 'low'
  });
  render(<SubmissionChanges changes={[
    { category: 'facts', summary: '林默保存了报告。', risk: 'low' },
    progress
  ]} />);
  const heading = screen.getByRole('heading', { name: '章节进度' });
  expect(heading).toBeVisible();
  expect(heading.parentElement).toHaveTextContent('正式章节从第 1 章推进到第 2 章。');
  expect(screen.getByText('林默保存了报告。')).toBeVisible();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(document.body).not.toHaveTextContent(/latestCommittedChapter|progress/);
});

test('renders every change in Chinese categories with no truncation or interpreted markup', () => {
  const categories = ['facts', 'characters', 'timeline', 'plot_threads', 'narrative_debts', 'foreshadowing', 'reader_information', 'relationships', 'world_rules', 'progress'] as const;
  const labels = ['事实', '人物', '时间线', '悬念', '叙事承诺', '伏笔', '读者信息', '人物关系', '世界规则', '章节进度'];
  const changes: SubmissionChange[] = Array.from({ length: 1_000 }, (_, i) => ({
    category: categories[i % categories.length]!, summary: `变化内容第 ${i + 1} 项`, risk: i === 999 ? 'high' : 'low'
  }));
  changes[0]!.summary = '<img src=x onerror=alert(1)>';
  const view = render(<SubmissionChanges changes={changes} />);
  for (const label of labels) expect(screen.getByRole('heading', { name: label })).toBeVisible();
  expect(screen.getAllByRole('listitem')).toHaveLength(1_000);
  expect(screen.getByText('变化内容第 1000 项')).toBeVisible();
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(view.container.querySelector('img')).toBeNull();
});
