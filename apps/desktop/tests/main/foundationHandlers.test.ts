import { describe, expect, test, vi } from 'vitest';

import { registerFoundationHandlers } from '../../src/main/ipc/registerFoundationHandlers';
import type {
  ProjectFoundationApplicationService
} from '../../src/main/foundation/ProjectFoundationService';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';
import type {
  FoundationReviewResult,
  FoundationTask
} from '../../src/shared/foundationContract';

type FoundationHandler = (
  event: { senderFrame: { url: string } },
  request: unknown
) => Promise<unknown>;

const trustedRendererUrl = 'http://127.0.0.1:5173';
const trustedEvent = {
  senderFrame: { url: `${trustedRendererUrl}/story-foundation` }
};
const task: FoundationTask = {
  taskId: 'foundation_0123456789abcdef',
  projectKey: 'project_0123456789abcdef01234567',
  status: 'running',
  stage: 'story_bible',
  completedStages: ['preparing'],
  startedAt: '2026-07-28T01:00:00.000Z',
  updatedAt: '2026-07-28T01:00:01.000Z',
  canCancel: true,
  canRetry: false,
  error: null
};
const review: FoundationReviewResult = {
  available: true,
  documents: [
    { kind: 'story_bible', title: 'Story Bible', markdown: '# Story Bible\n' },
    { kind: 'genre_contract', title: 'Genre Contract', markdown: '# Genre Contract\n' },
    { kind: 'reader_promise', title: 'Reader Promise', markdown: '# Reader Promise\n' },
    { kind: 'style_guide', title: 'Style Guide', markdown: '# Style Guide\n' }
  ]
};

function createService(): ProjectFoundationApplicationService {
  return {
    start: vi.fn(async () => task),
    get: vi.fn(async () => task),
    cancel: vi.fn(async () => task),
    read: vi.fn(async () => review)
  };
}

function register(service: ProjectFoundationApplicationService) {
  const registrations: Array<{
    channel: string;
    handler: FoundationHandler;
  }> = [];

  registerFoundationHandlers(
    {
      handle(channel, handler) {
        registrations.push({ channel, handler });
      }
    },
    service,
    trustedRendererUrl
  );

  const handlerFor = (channel: string): FoundationHandler => {
    const registration = registrations.find((candidate) => (
      candidate.channel === channel
    ));
    if (registration === undefined) {
      throw new Error(`Expected a handler for ${channel}.`);
    }
    return registration.handler;
  };

  return { registrations, handlerFor };
}

describe('Story Foundation IPC handlers', () => {
  test('registers each fixed Foundation channel exactly once', () => {
    const { registrations } = register(createService());

    expect(registrations.map(({ channel }) => channel)).toEqual([
      IPC_CHANNELS.foundationStart,
      IPC_CHANNELS.foundationGet,
      IPC_CHANNELS.foundationCancel,
      IPC_CHANNELS.foundationRead
    ]);
    expect(new Set(registrations.map(({ channel }) => channel)).size).toBe(4);
  });

  test('trusted strict requests call their named Foundation service methods', async () => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS.foundationStart)(
      trustedEvent,
      { projectKey: `  ${task.projectKey}  ` }
    )).resolves.toEqual(task);
    await expect(handlerFor(IPC_CHANNELS.foundationGet)(
      trustedEvent,
      { taskId: `  ${task.taskId}  ` }
    )).resolves.toEqual(task);
    await expect(handlerFor(IPC_CHANNELS.foundationCancel)(
      trustedEvent,
      { taskId: task.taskId }
    )).resolves.toEqual(task);
    await expect(handlerFor(IPC_CHANNELS.foundationRead)(
      trustedEvent,
      { projectKey: task.projectKey }
    )).resolves.toEqual(review);

    expect(service.start).toHaveBeenCalledWith(task.projectKey);
    expect(service.get).toHaveBeenCalledWith(task.taskId);
    expect(service.cancel).toHaveBeenCalledWith(task.taskId);
    expect(service.read).toHaveBeenCalledWith(task.projectKey);
  });

  test.each([
    {
      channel: IPC_CHANNELS.foundationStart,
      request: { projectKey: task.projectKey, projectRoot: '/private/path' },
      serviceMethod: 'start'
    },
    {
      channel: IPC_CHANNELS.foundationGet,
      request: { taskId: task.taskId, runId: 'run_private' },
      serviceMethod: 'get'
    },
    {
      channel: IPC_CHANNELS.foundationCancel,
      request: { taskId: task.taskId, auth: 'secret' },
      serviceMethod: 'cancel'
    },
    {
      channel: IPC_CHANNELS.foundationRead,
      request: { projectKey: task.projectKey, rawOutput: 'private' },
      serviceMethod: 'read'
    }
  ] as const)('rejects unknown fields before calling $serviceMethod', async ({
    channel,
    request,
    serviceMethod
  }) => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(channel)(trustedEvent, request)).rejects.toThrow();
    expect(service[serviceMethod]).not.toHaveBeenCalled();
  });

  test('rejects an untrusted sender before parsing or calling the service', async () => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS.foundationStart)(
      { senderFrame: { url: 'https://example.com' } },
      { projectKey: task.projectKey, projectRoot: '/private/path' }
    )).rejects.toThrow('Untrusted renderer request.');
    expect(service.start).not.toHaveBeenCalled();
  });

  test.each([
    {
      channel: IPC_CHANNELS.foundationStart,
      replace: (service: ProjectFoundationApplicationService) => {
        service.start = vi.fn(async () => ({ ...task, projectRoot: '/private/path' }) as FoundationTask);
      }
    },
    {
      channel: IPC_CHANNELS.foundationGet,
      replace: (service: ProjectFoundationApplicationService) => {
        service.get = vi.fn(async () => ({ ...task, runId: 'run_private' }) as FoundationTask);
      }
    },
    {
      channel: IPC_CHANNELS.foundationCancel,
      replace: (service: ProjectFoundationApplicationService) => {
        service.cancel = vi.fn(async () => ({ ...task, auth: 'secret' }) as FoundationTask);
      }
    },
    {
      channel: IPC_CHANNELS.foundationRead,
      replace: (service: ProjectFoundationApplicationService) => {
        service.read = vi.fn(async () => ({
          available: false,
          reason: 'not_ready',
          rawOutput: 'private'
        }) as FoundationReviewResult);
      }
    }
  ])('rejects invalid response data from $channel', async ({ channel, replace }) => {
    const service = createService();
    replace(service);
    const { handlerFor } = register(service);
    const request = channel === IPC_CHANNELS.foundationRead
      ? { projectKey: task.projectKey }
      : channel === IPC_CHANNELS.foundationStart
        ? { projectKey: task.projectKey }
        : { taskId: task.taskId };

    await expect(handlerFor(channel)(trustedEvent, request)).rejects.toThrow();
  });
});
