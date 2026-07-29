import { describe, expect, test, vi } from 'vitest';

import { registerPlanningHandlers } from '../../src/main/ipc/registerPlanningHandlers';
import type {
  PlanningApplicationService
} from '../../src/main/planning/ProjectPlanningService';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';
import type {
  PlanningReviewResult,
  PlanningTask
} from '../../src/shared/planningContract';

type PlanningHandler = (
  event: { senderFrame: { url: string } },
  request: unknown
) => Promise<unknown>;

const trustedRendererUrl = 'http://127.0.0.1:5173';
const trustedEvent = {
  senderFrame: { url: `${trustedRendererUrl}/global-planning` }
};
const task: PlanningTask = {
  taskId: 'planning_0123456789abcdef',
  projectKey: 'project_0123456789abcdef01234567',
  status: 'running',
  stage: 'global_outline',
  completedStages: ['preparing'],
  startedAt: '2026-07-29T01:00:00.000Z',
  updatedAt: '2026-07-29T01:00:01.000Z',
  canCancel: true,
  canRetry: false,
  error: null
};
const review: PlanningReviewResult = {
  available: true,
  documents: [
    { kind: 'global_outline', title: 'Global Outline', markdown: '# Global Outline\n' },
    { kind: 'volume_outline', title: 'Volume Outline', markdown: '# Volume Outline\n' }
  ],
  arcs: [],
  chapters: []
};

function createService(): PlanningApplicationService {
  return {
    start: vi.fn(async () => task),
    get: vi.fn(async () => task),
    cancel: vi.fn(async () => task),
    read: vi.fn(async () => review)
  };
}

function register(service: PlanningApplicationService) {
  const registrations: Array<{
    channel: string;
    handler: PlanningHandler;
  }> = [];

  registerPlanningHandlers(
    {
      handle(channel, handler) {
        registrations.push({ channel, handler });
      }
    },
    service,
    trustedRendererUrl
  );

  const handlerFor = (channel: string): PlanningHandler => {
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

describe('global planning IPC handlers', () => {
  test('registers each fixed planning channel exactly once', () => {
    const { registrations } = register(createService());

    expect(registrations.map(({ channel }) => channel)).toEqual([
      IPC_CHANNELS.planningStart,
      IPC_CHANNELS.planningGet,
      IPC_CHANNELS.planningCancel,
      IPC_CHANNELS.planningRead
    ]);
    expect(new Set(registrations.map(({ channel }) => channel)).size).toBe(4);
  });

  test('trusted strict requests call their named planning service methods', async () => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS.planningStart)(
      trustedEvent,
      { projectKey: `  ${task.projectKey}  ` }
    )).resolves.toEqual(task);
    await expect(handlerFor(IPC_CHANNELS.planningGet)(
      trustedEvent,
      { taskId: `  ${task.taskId}  ` }
    )).resolves.toEqual(task);
    await expect(handlerFor(IPC_CHANNELS.planningCancel)(
      trustedEvent,
      { taskId: task.taskId }
    )).resolves.toEqual(task);
    await expect(handlerFor(IPC_CHANNELS.planningRead)(
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
      channel: IPC_CHANNELS.planningStart,
      request: { projectKey: task.projectKey, projectRoot: '/private/path' },
      serviceMethod: 'start'
    },
    {
      channel: IPC_CHANNELS.planningGet,
      request: { taskId: task.taskId, runId: 'run_private' },
      serviceMethod: 'get'
    },
    {
      channel: IPC_CHANNELS.planningCancel,
      request: { taskId: task.taskId, auth: 'secret' },
      serviceMethod: 'cancel'
    },
    {
      channel: IPC_CHANNELS.planningRead,
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

    await expect(handlerFor(IPC_CHANNELS.planningStart)(
      { senderFrame: { url: 'https://example.com' } },
      { projectKey: task.projectKey, projectRoot: '/private/path' }
    )).rejects.toThrow('Untrusted renderer request.');
    expect(service.start).not.toHaveBeenCalled();
  });

  test.each([
    {
      channel: IPC_CHANNELS.planningStart,
      replace: (service: PlanningApplicationService) => {
        service.start = vi.fn(async () => ({ ...task, projectRoot: '/private/path' }) as PlanningTask);
      }
    },
    {
      channel: IPC_CHANNELS.planningGet,
      replace: (service: PlanningApplicationService) => {
        service.get = vi.fn(async () => ({ ...task, runId: 'run_private' }) as PlanningTask);
      }
    },
    {
      channel: IPC_CHANNELS.planningCancel,
      replace: (service: PlanningApplicationService) => {
        service.cancel = vi.fn(async () => ({ ...task, auth: 'secret' }) as PlanningTask);
      }
    },
    {
      channel: IPC_CHANNELS.planningRead,
      replace: (service: PlanningApplicationService) => {
        service.read = vi.fn(async () => ({
          available: false,
          reason: 'not_ready',
          rawOutput: 'private'
        }) as PlanningReviewResult);
      }
    }
  ])('rejects invalid response data from $channel', async ({ channel, replace }) => {
    const service = createService();
    replace(service);
    const { handlerFor } = register(service);
    const request = channel === IPC_CHANNELS.planningRead
      ? { projectKey: task.projectKey }
      : channel === IPC_CHANNELS.planningStart
        ? { projectKey: task.projectKey }
        : { taskId: task.taskId };

    await expect(handlerFor(channel)(trustedEvent, request)).rejects.toThrow();
  });
});
