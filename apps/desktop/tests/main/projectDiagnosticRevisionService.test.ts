import { expect, test, vi } from 'vitest';
import { ProjectDiagnosticRevisionService } from '../../src/main/submission/ProjectDiagnosticRevisionService';
import { ProjectSubmissionGuard } from '../../src/main/submission/ProjectSubmissionGuard';
import type { SubmissionEngineGateway } from '../../src/main/submission/EngineSubmissionGateway';
import type { EngineDiagnosticRevisionGateway } from '../../src/main/submission/EngineDiagnosticRevisionGateway';

function setup(pending = false) {
  const load = vi.fn<EngineDiagnosticRevisionGateway['load']>();
  const gateway: SubmissionEngineGateway = {
    readDraftIdentity: vi.fn().mockResolvedValue({ chapterNumber: 1, sourceHash: 'a'.repeat(64) }),
    readRecovery: vi.fn().mockResolvedValue({ outcome: 'none' }),
    readTasks: vi.fn().mockResolvedValue([]), check: vi.fn(), readPreview: vi.fn(), confirm: vi.fn(), readIssues: vi.fn()
  };
  const projects = { resolveProjectRoot: async (key: string) => key === 'project_test' ? '/registered/test' : null, resolveRegisteredRootForRecovery: async (key: string) => key === 'project_test' ? '/registered/test' : null, list: async () => ({ projects: [] }) };
  const service = new ProjectDiagnosticRevisionService({ projects, gateway, workingCopies: { hasPendingSubmissionEdit: async () => pending }, guard: new ProjectSubmissionGuard(), revisions: { load } });
  return { service, gateway, load };
}
test('pending author edits block generation before engine/provider load', async () => {
  const { service, load } = setup(true);
  expect(await service.start({ projectKey: 'project_test', diagnosticTaskId: 'latest' })).toEqual({ outcome: 'error', code: 'working_copy_pending' });
  expect(load).not.toHaveBeenCalled();
});
test('unknown projects and incomplete commits cannot start or adopt candidates', async () => {
  const { service, load, gateway } = setup();
  expect(await service.start({ projectKey: 'project_other', diagnosticTaskId: 'latest' })).toEqual({ outcome: 'error', code: 'project_unavailable' });
  vi.mocked(gateway.readRecovery).mockResolvedValue({ outcome: 'recovery_required' });
  expect(await service.adopt({ projectKey: 'project_test', candidateId: 'candidate_one' })).toEqual({ outcome: 'error', code: 'recovery_required' });
  expect(load).not.toHaveBeenCalled();
});
test('unexpected backend failures never cross the API as raw messages', async () => {
  const { service, gateway } = setup();
  vi.mocked(gateway.readRecovery).mockRejectedValue(new Error('Bearer private-token /home/private'));
  expect(await service.read({ projectKey: 'project_test' })).toEqual({ outcome: 'error', code: 'unexpected' });
});

test('polling and cancelling an owned task do not compete for the draft lease', async () => {
  const { service, gateway, load } = setup();
  const engine = await import('novel-loop-engine/desktop');
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  let terminalReported!: () => void;
  const terminal = new Promise<void>(resolve => { terminalReported = resolve; });
  const task = { schemaVersion: 1 as const, taskId: 'diagnostic_one', projectId: 'test', chapterNumber: 1,
    status: 'blocked' as const, stage: 'diagnostics' as const, runId: 'run_one', previewId: null,
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), safeErrorCode: 'diagnostics_failed' as const };
  vi.mocked(gateway.readTasks).mockResolvedValue([task]);
  load.mockResolvedValue({ ...engine, listDiagnosticRevisionTasks: async () => [],
    captureDiagnosticRevisionSource: vi.fn(),
    generateDiagnosticRevision: async (input, options) => {
      await options.onProgress({ schemaVersion: 1, taskId: input.taskId, projectId: 'test', chapterNumber: 1,
        stage: 'validating_candidate', status: 'ready', runId: 'run_one', candidateId: 'candidate_one',
        startedAt: task.startedAt, endedAt: task.endedAt, safeErrorCode: null });
      terminalReported();
      await held;
      return { schemaVersion: 1, taskId: input.taskId, projectId: 'test', chapterNumber: 1, stage: 'checking_source',
        status: options.shouldCancel() ? 'cancelled' : 'failed', runId: 'run_one', candidateId: null,
        startedAt: task.startedAt, endedAt: task.endedAt, safeErrorCode: null };
    } });
  const started = await service.start({ projectKey: 'project_test', diagnosticTaskId: 'latest' });
  expect(started.outcome).toBe('task');
  if (started.outcome !== 'task') throw new Error('Expected started task');
  await terminal;
  vi.mocked(gateway.readDraftIdentity).mockRejectedValue(new Error('PROJECT_OPERATION_LOCKED'));
  try {
    expect(await service.get({ projectKey: 'project_test', taskId: started.task.taskId })).toMatchObject({ outcome: 'task', task: { status: 'running' } });
    expect(await service.cancel({ projectKey: 'project_test', taskId: started.task.taskId })).toMatchObject({ outcome: 'task', task: { status: 'cancel_requested' } });
  } finally { finish(); }
});
