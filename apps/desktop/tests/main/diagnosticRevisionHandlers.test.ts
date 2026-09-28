import { expect, test, vi } from 'vitest';
import { registerDiagnosticRevisionHandlers } from '../../src/main/ipc/registerDiagnosticRevisionHandlers';
import type { DiagnosticRevisionApi } from '../../src/shared/diagnosticRevisionContract';

test('all revision IPC handlers reject foreign senders and extra request fields', async () => {
  const handlers = new Map<string, (event: { senderFrame: { url: string } }, request: unknown) => Promise<unknown>>();
  const service: DiagnosticRevisionApi = { start: vi.fn(), get: vi.fn(), cancel: vi.fn(), read: vi.fn(), adopt: vi.fn(), reject: vi.fn() };
  registerDiagnosticRevisionHandlers({ handle: (name, handler) => handlers.set(name, handler) }, service, 'http://127.0.0.1:5173');
  expect(handlers.size).toBe(6);
  for (const handler of handlers.values()) await expect(handler({ senderFrame: { url: 'https://untrusted.example' } }, { projectKey: 'project_test' })).rejects.toThrow('submission.blocked');
  await expect(handlers.get('novel-loop:diagnostic-revision:start')!({ senderFrame: { url: 'http://127.0.0.1:5173' } }, { projectKey: 'project_test', diagnosticTaskId: 'latest', shell: true })).rejects.toThrow('submission.blocked');
  expect(service.start).not.toHaveBeenCalled();
});
