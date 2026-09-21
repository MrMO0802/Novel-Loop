import { describe, expect, test, vi } from 'vitest';

import {
  registerSubmissionHandlers,
  type ProjectSubmissionServiceContract
} from '../../src/main/ipc/registerSubmissionHandlers';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';
import type {
  SubmissionConfirmResult,
  SubmissionPreviewResult,
  SubmissionTask
} from '../../src/shared/submissionContract';

const trustedRendererUrl = 'http://127.0.0.1:5173';
const trustedEvent = { senderFrame: { url: `${trustedRendererUrl}/chapter-workspace` } };
const projectRequest = { projectKey: 'project_radio' };
const taskRequest = { taskId: 'submission_check_123' };
const confirmRequest = {
  ...projectRequest,
  previewToken: `submission_${'a'.repeat(48)}`,
  confirm: true as const
};
const task: SubmissionTask = {
  ...projectRequest,
  ...taskRequest,
  chapterNumber: 1,
  stage: 'checking_source',
  status: 'running',
  startedAt: '2026-09-21T00:00:00.000Z',
  endedAt: null,
  safeErrorCode: null,
  issues: []
};
const preview: SubmissionPreviewResult = {
  outcome: 'ready',
  previewToken: confirmRequest.previewToken,
  chapterNumber: 1,
  draft: { kind: 'adopted', label: 'Adopted draft', summary: 'The broadcast returns.' },
  changes: [{ category: 'facts', summary: 'The radio speaks twice.', risk: 'high' }],
  warnings: ['Review the changed fact.']
};
const committed: SubmissionConfirmResult = {
  outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: true
};

function createService(): ProjectSubmissionServiceContract {
  return {
    startCheck: vi.fn(async () => taskRequest),
    get: vi.fn(async () => task),
    cancel: vi.fn(async () => ({ ...task, status: 'cancel_requested' as const })),
    readPreview: vi.fn(async () => preview),
    confirm: vi.fn(async () => committed)
  };
}

type Handler = (event: typeof trustedEvent, request: unknown) => Promise<unknown>;

function register(service: ProjectSubmissionServiceContract, rendererUrl = trustedRendererUrl) {
  const handlers = new Map<string, Handler>();
  registerSubmissionHandlers({
    handle(channel, handler) {
      expect(handlers.has(channel)).toBe(false);
      handlers.set(channel, handler);
    }
  }, service, rendererUrl);
  return {
    handlers,
    handlerFor(channel: string): Handler {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing handler: ${channel}`);
      return handler;
    }
  };
}

const cases = [
  { channel: 'submissionStartCheck', method: 'startCheck', request: projectRequest, result: taskRequest },
  { channel: 'submissionGet', method: 'get', request: taskRequest, result: task },
  { channel: 'submissionCancel', method: 'cancel', request: taskRequest, result: { ...task, status: 'cancel_requested' } },
  { channel: 'submissionReadPreview', method: 'readPreview', request: projectRequest, result: preview },
  { channel: 'submissionConfirm', method: 'confirm', request: confirmRequest, result: committed }
] as const;

describe('submission IPC handlers', () => {
  test('registers only the five fixed submission channels, once each', () => {
    expect([...register(createService()).handlers.keys()]).toEqual([
      'novel-loop:submission:start-check',
      'novel-loop:submission:get',
      'novel-loop:submission:cancel',
      'novel-loop:submission:read-preview',
      'novel-loop:submission:confirm'
    ]);
  });

  test.each(cases)('$method accepts only its request object and returns its parsed result', async ({ channel, method, request, result }) => {
    const service = createService();
    const { handlerFor } = register(service);
    await expect(handlerFor(IPC_CHANNELS[channel])(trustedEvent, request)).resolves.toEqual(result);
    expect(service[method]).toHaveBeenCalledExactlyOnceWith(request);
    for (const other of cases.filter((entry) => entry.method !== method)) {
      expect(service[other.method]).not.toHaveBeenCalled();
    }
  });

  describe.each(cases)('$method boundary', ({ channel, method, request, result }) => {
    test.each(['path', 'projectRoot', 'provider', 'patch', 'command', 'prompt', 'chapterNumber', 'extra'])('rejects the extra %s field before service access', async (field) => {
      const service = createService();
      await expect(register(service).handlerFor(IPC_CHANNELS[channel])(
        trustedEvent, { ...request, [field]: '/private/prompt-secret' }
      )).rejects.toThrow(/^submission\.blocked$/u);
      expect(service[method]).not.toHaveBeenCalled();
    });

    test.each([null, {}, [], { projectKey: '/private/project' }, { taskId: '../task' }])('rejects malformed input %j', async (input) => {
      const service = createService();
      await expect(register(service).handlerFor(IPC_CHANNELS[channel])(trustedEvent, input))
        .rejects.toThrow(/^submission\.blocked$/u);
      expect(service[method]).not.toHaveBeenCalled();
    });

    test.each(['https://example.com', 'http://127.0.0.1:5174', 'file:///private/frame.html', 'about:blank'])('rejects an untrusted sender frame %s even when the top-level sender is trusted', async (url) => {
      const service = createService();
      const event = { senderFrame: { url }, sender: { getURL: () => trustedRendererUrl } };
      await expect(register(service).handlerFor(IPC_CHANNELS[channel])(event, request))
        .rejects.toThrow(/^submission\.blocked$/u);
      expect(service[method]).not.toHaveBeenCalled();
    });

    test('checks the sender before reading the request', async () => {
      const service = createService();
      const read = vi.fn(() => { throw new Error('Request must not be read.'); });
      const payload = new Proxy({}, { get: read, ownKeys: read });
      await expect(register(service).handlerFor(IPC_CHANNELS[channel])(
        { senderFrame: { url: 'https://example.com' } }, payload
      )).rejects.toThrow(/^submission\.blocked$/u);
      expect(read).not.toHaveBeenCalled();
      expect(service[method]).not.toHaveBeenCalled();
    });

    test.each([undefined, null, {}, { ...result, privatePath: '/private/prompt-secret' }])('rejects malformed or overbroad service results %j without leaking validation details', async (invalidResult) => {
      const service = createService();
      // Deliberately violate the typed backend contract at the runtime boundary.
      vi.spyOn(service, method).mockResolvedValueOnce(invalidResult as never);
      await expect(register(service).handlerFor(IPC_CHANNELS[channel])(trustedEvent, request))
        .rejects.toThrow(/^submission\.blocked$/u);
    });

    test('redacts thrown backend errors', async () => {
      const service = createService();
      vi.spyOn(service, method).mockRejectedValueOnce(new Error(`EACCES /private/project prompt-secret ${confirmRequest.previewToken}`));
      await expect(register(service).handlerFor(IPC_CHANNELS[channel])(trustedEvent, request))
        .rejects.toThrow(/^submission\.blocked$/u);
    });
  });

  test('accepts the packaged renderer file but not another file', async () => {
    const service = createService();
    const url = 'file:///opt/novel-loop/out/renderer/index.html';
    const handler = register(service, url).handlerFor(IPC_CHANNELS.submissionStartCheck);
    await expect(handler({ senderFrame: { url: `${url}#chapter` } }, projectRequest)).resolves.toEqual(taskRequest);
    await expect(handler({ senderFrame: { url: 'file:///opt/novel-loop/other.html' } }, projectRequest))
      .rejects.toThrow(/^submission\.blocked$/u);
    expect(service.startCheck).toHaveBeenCalledTimes(1);
  });

  test.each([
    { ...confirmRequest, confirm: false },
    { projectKey: projectRequest.projectKey, previewToken: confirmRequest.previewToken },
    { ...confirmRequest, previewToken: 'invalid-token' }
  ])('requires explicit confirmation and an opaque token: %j', async (request) => {
    const service = createService();
    await expect(register(service).handlerFor(IPC_CHANNELS.submissionConfirm)(trustedEvent, request))
      .rejects.toThrow(/^submission\.blocked$/u);
    expect(service.confirm).not.toHaveBeenCalled();
  });

  test.each(['not_ready', 'stale', 'blocked'] as const)('preserves the %s preview outcome', async (outcome) => {
    const service = createService();
    const result: SubmissionPreviewResult = { outcome, messageKey: 'submission.not_ready', issues: [] };
    vi.spyOn(service, 'readPreview').mockResolvedValueOnce(result);
    await expect(register(service).handlerFor(IPC_CHANNELS.submissionReadPreview)(trustedEvent, projectRequest))
      .resolves.toEqual(result);
  });

  test.each(['stale', 'busy', 'blocked', 'recovery_required'] as const)('preserves the %s confirm outcome', async (outcome) => {
    const service = createService();
    const result: SubmissionConfirmResult = { outcome, messageKey: `submission.${outcome}` };
    vi.spyOn(service, 'confirm').mockResolvedValueOnce(result);
    await expect(register(service).handlerFor(IPC_CHANNELS.submissionConfirm)(trustedEvent, confirmRequest))
      .resolves.toEqual(result);
  });

  test('forwards a cross-project token unchanged and preserves the service rejection', async () => {
    const service = createService();
    vi.spyOn(service, 'confirm').mockResolvedValueOnce({ outcome: 'stale', messageKey: 'submission.stale' });
    const request = { ...confirmRequest, projectKey: 'project_other' };
    await expect(register(service).handlerFor(IPC_CHANNELS.submissionConfirm)(trustedEvent, request))
      .resolves.toEqual({ outcome: 'stale', messageKey: 'submission.stale' });
    expect(service.confirm).toHaveBeenCalledExactlyOnceWith(request);
  });

  test.each([
    { method: 'get', channel: 'submissionGet', request: taskRequest, result: { ...task, issues: [{ severity: 'error', message: '/private/project', evidence: null }] } },
    { method: 'cancel', channel: 'submissionCancel', request: taskRequest, result: { ...task, status: 'ready' } },
    { method: 'readPreview', channel: 'submissionReadPreview', request: projectRequest, result: { ...preview, changes: [{ category: 'facts', summary: 'A change', risk: 'low', patch: {} }] } },
    { method: 'readPreview', channel: 'submissionReadPreview', request: projectRequest, result: { ...preview, warnings: [confirmRequest.previewToken] } },
    { method: 'confirm', channel: 'submissionConfirm', request: confirmRequest, result: { ...committed, latestCommittedChapter: 2 } },
    { method: 'confirm', channel: 'submissionConfirm', request: confirmRequest, result: { outcome: 'blocked', messageKey: '/private/project' } }
  ] as const)('enforces nested and cross-field result constraints for $method', async ({ method, channel, request, result }) => {
    const service = createService();
    vi.spyOn(service, method).mockResolvedValueOnce(result as never);
    await expect(register(service).handlerFor(IPC_CHANNELS[channel])(trustedEvent, request))
      .rejects.toThrow(/^submission\.blocked$/u);
  });
});
