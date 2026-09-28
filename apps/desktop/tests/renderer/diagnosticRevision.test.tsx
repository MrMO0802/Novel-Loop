// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { DiagnosticRevisionView } from '../../src/renderer/src/features/submission/DiagnosticRevisionView';
import type { DiagnosticRevisionApi } from '../../src/shared/diagnosticRevisionContract';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('requires explicit confirmation and shows adopted result before rechecking', async () => {
  const api: DiagnosticRevisionApi = {
    read: vi.fn().mockResolvedValue({ outcome: 'candidate', candidate: { candidateId: 'candidate_one', source: '# 标题\n\n原文', markdown: '# 标题\n\n修订', reasons: ['统一细节'], status: 'pending', canAdopt: true } }),
    start: vi.fn(), get: vi.fn(), cancel: vi.fn(), adopt: vi.fn().mockResolvedValue({ outcome: 'adopted' }), reject: vi.fn()
  };
  vi.stubGlobal('novelLoop', { diagnosticRevision: api });
  const recheck = vi.fn();
  render(<DiagnosticRevisionView projectKey="project_test" onBack={() => {}} onRecheck={recheck} />);
  fireEvent.click(await screen.findByRole('button', { name: '采用此修订' }));
  expect(api.adopt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认采用修订' }));
  await screen.findByText('修订已采用，尚未正式提交。');
  expect(api.adopt).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
  expect(recheck).toHaveBeenCalledTimes(1);
});

test('stale candidate cannot be adopted and reasons are not interpreted as HTML', async () => {
  const adopt = vi.fn();
  vi.stubGlobal('novelLoop', { diagnosticRevision: { read: async () => ({ outcome: 'candidate', candidate: { candidateId: 'candidate_one', source: '原文', markdown: '<script>bad()</script>', reasons: ['<img onerror=bad()>'], status: 'pending', canAdopt: false } }), adopt } });
  render(<DiagnosticRevisionView projectKey="project_test" onBack={() => {}} onRecheck={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '采用此修订' })).toBeDisabled());
  expect(document.querySelector('script')).toBeNull();
  expect(adopt).not.toHaveBeenCalled();
});

test('leaving a project ignores its pending read response', async () => {
  let resolve!: (value: unknown) => void;
  const oldRead = new Promise(done => { resolve = done; });
  const read = vi.fn().mockImplementation(({ projectKey }) => projectKey === 'project_old' ? oldRead : Promise.resolve({ outcome: 'none' }));
  vi.stubGlobal('novelLoop', { diagnosticRevision: { read } });
  const view = render(<DiagnosticRevisionView projectKey="project_old" onBack={() => {}} onRecheck={() => {}} />);
  view.rerender(<DiagnosticRevisionView projectKey="project_new" onBack={() => {}} onRecheck={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '生成修订候选' })).toBeEnabled());
  await act(async () => resolve({ outcome: 'candidate', candidate: { candidateId: 'old_candidate', source: 'OLD_PRIVATE_SOURCE', markdown: 'OLD_PRIVATE_CANDIDATE', reasons: [], status: 'pending', canAdopt: true } }));
  expect(screen.queryByText('OLD_PRIVATE_CANDIDATE')).toBeNull();
  expect(screen.queryByRole('button', { name: '采用此修订' })).toBeNull();
});

test('explicit start is single-flight and cancellation never adopts a candidate', async () => {
  let resolve!: (value: unknown) => void;
  const held = new Promise(done => { resolve = done; });
  const task = { taskId: 'task_one', stage: 'generating_revision', status: 'running', candidateId: null, safeErrorCode: null };
  const api = { read: vi.fn().mockResolvedValue({ outcome: 'none' }), start: vi.fn().mockReturnValue(held),
    get: vi.fn().mockResolvedValue({ outcome: 'task', task }),
    cancel: vi.fn().mockResolvedValue({ outcome: 'task', task: { ...task, status: 'cancelled' } }), adopt: vi.fn() };
  vi.stubGlobal('novelLoop', { diagnosticRevision: api });
  render(<DiagnosticRevisionView projectKey="project_test" onBack={() => {}} onRecheck={() => {}} />);
  const button = await screen.findByRole('button', { name: '生成修订候选' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button); fireEvent.click(button);
  expect(api.start).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ outcome: 'task', task }));
  fireEvent.click(await screen.findByRole('button', { name: '取消生成' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '取消生成' })).toBeNull());
  expect(api.cancel).toHaveBeenCalledTimes(1); expect(api.adopt).not.toHaveBeenCalled();
});
