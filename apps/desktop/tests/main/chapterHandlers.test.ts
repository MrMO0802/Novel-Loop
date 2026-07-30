import { describe, expect, test, vi } from 'vitest';

import { registerChapterHandlers } from '../../src/main/ipc/registerChapterHandlers';
import type {
  ChapterApplicationService
} from '../../src/main/chapter/ProjectChapterService';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';
import type {
  ChapterDraftReviewResult,
  ChapterInspection,
  ChapterPlanReviewResult,
  ChapterTask
} from '../../src/shared/chapterContract';

type ChapterHandler = (
  event: { senderFrame: { url: string } },
  request: unknown
) => Promise<unknown>;

const trustedRendererUrl = 'http://127.0.0.1:5173';
const trustedEvent = {
  senderFrame: { url: `${trustedRendererUrl}/chapter-workspace` }
};
const task: ChapterTask = {
  taskId: 'chapter_0123456789abcdef',
  projectKey: 'project_radio',
  kind: 'planning',
  chapterNumber: 1,
  status: 'running',
  stage: 'mission',
  completedStages: ['preparing'],
  sceneProgress: null,
  startedAt: '2026-07-30T01:00:00.000Z',
  updatedAt: '2026-07-30T01:00:01.000Z',
  canCancel: true,
  canRetry: false,
  error: null
};
const inspection: ChapterInspection = {
  available: true,
  chapterNumber: 1,
  title: 'The Radio Wakes',
  phase: 'not_started'
};
const planReview: ChapterPlanReviewResult = {
  available: false,
  reason: 'not_ready'
};
const draftReview: ChapterDraftReviewResult = {
  available: false,
  reason: 'not_ready'
};

function createService(): ChapterApplicationService {
  return {
    inspect: vi.fn(async () => inspection),
    startPlanning: vi.fn(async () => task),
    startDrafting: vi.fn(async (): Promise<ChapterTask> => ({
      ...task,
      kind: 'drafting'
    })),
    get: vi.fn(async () => task),
    cancel: vi.fn(async () => task),
    readPlan: vi.fn(async () => planReview),
    readDraft: vi.fn(async () => draftReview)
  };
}

function register(service: ChapterApplicationService) {
  const registrations: Array<{
    channel: string;
    handler: ChapterHandler;
  }> = [];

  registerChapterHandlers(
    {
      handle(channel, handler) {
        registrations.push({ channel, handler });
      }
    },
    service,
    trustedRendererUrl
  );

  const handlerFor = (channel: string): ChapterHandler => {
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

const cases = [
  {
    channel: 'chapterInspect',
    request: { projectKey: task.projectKey },
    invalidRequest: { projectKey: task.projectKey, path: '/private/chapter' },
    serviceMethod: 'inspect',
    response: inspection,
    invalidResponse: { ...inspection, path: '/private/chapter' }
  },
  {
    channel: 'chapterStartPlanning',
    request: { projectKey: task.projectKey },
    invalidRequest: { projectKey: task.projectKey, provider: 'codex-text' },
    serviceMethod: 'startPlanning',
    response: task,
    invalidResponse: { ...task, provider: 'codex-text' }
  },
  {
    channel: 'chapterStartDrafting',
    request: { projectKey: task.projectKey },
    invalidRequest: { projectKey: task.projectKey, chapterNumber: 1 },
    serviceMethod: 'startDrafting',
    response: { ...task, kind: 'drafting' },
    invalidResponse: { ...task, kind: 'drafting', chapterNumberInput: 1 }
  },
  {
    channel: 'chapterGet',
    request: { taskId: task.taskId },
    invalidRequest: { taskId: task.taskId, prompt: 'Write the chapter.' },
    serviceMethod: 'get',
    response: task,
    invalidResponse: { ...task, prompt: 'private prompt' }
  },
  {
    channel: 'chapterCancel',
    request: { taskId: task.taskId },
    invalidRequest: { taskId: task.taskId, command: 'cancel --force' },
    serviceMethod: 'cancel',
    response: task,
    invalidResponse: { ...task, command: 'private command' }
  },
  {
    channel: 'chapterReadPlan',
    request: { projectKey: task.projectKey },
    invalidRequest: { projectKey: task.projectKey, commit: 'abc123' },
    serviceMethod: 'readPlan',
    response: planReview,
    invalidResponse: { ...planReview, commit: 'abc123' }
  },
  {
    channel: 'chapterReadDraft',
    request: { projectKey: task.projectKey },
    invalidRequest: { projectKey: task.projectKey, path: '/private/draft.md' },
    serviceMethod: 'readDraft',
    response: draftReview,
    invalidResponse: { ...draftReview, path: '/private/draft.md' }
  }
] as const;

describe('chapter workspace IPC handlers', () => {
  test('registers each fixed chapter channel exactly once', () => {
    const { registrations } = register(createService());

    expect(IPC_CHANNELS.chapterInspect).toBe('novel-loop:chapter:inspect');
    expect(IPC_CHANNELS.chapterStartPlanning).toBe('novel-loop:chapter:start-planning');
    expect(IPC_CHANNELS.chapterStartDrafting).toBe('novel-loop:chapter:start-drafting');
    expect(IPC_CHANNELS.chapterGet).toBe('novel-loop:chapter:get');
    expect(IPC_CHANNELS.chapterCancel).toBe('novel-loop:chapter:cancel');
    expect(IPC_CHANNELS.chapterReadPlan).toBe('novel-loop:chapter:read-plan');
    expect(IPC_CHANNELS.chapterReadDraft).toBe('novel-loop:chapter:read-draft');
    expect(registrations.map(({ channel }) => channel)).toEqual([
      'novel-loop:chapter:inspect',
      'novel-loop:chapter:start-planning',
      'novel-loop:chapter:start-drafting',
      'novel-loop:chapter:get',
      'novel-loop:chapter:cancel',
      'novel-loop:chapter:read-plan',
      'novel-loop:chapter:read-draft'
    ]);
    expect(new Set(registrations.map(({ channel }) => channel)).size).toBe(7);
  });

  test.each(cases)('trusted $channel requests call only $serviceMethod', async ({
    channel,
    request,
    serviceMethod,
    response
  }) => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS[channel])(trustedEvent, request))
      .resolves.toEqual(response);

    const expectedArgument = 'projectKey' in request
      ? request.projectKey
      : request.taskId;
    expect(service[serviceMethod]).toHaveBeenCalledWith(expectedArgument);
  });

  test.each(cases)('rejects hostile fields before calling $serviceMethod', async ({
    channel,
    invalidRequest,
    serviceMethod
  }) => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS[channel])(trustedEvent, invalidRequest))
      .rejects.toThrow();
    expect(service[serviceMethod]).not.toHaveBeenCalled();
  });

  test.each(cases)('rejects an untrusted sender before parsing or calling $serviceMethod', async ({
    channel,
    serviceMethod
  }) => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS[channel])(
      { senderFrame: { url: 'https://example.com' } },
      null
    )).rejects.toThrow('Untrusted renderer request.');
    expect(service[serviceMethod]).not.toHaveBeenCalled();
  });

  test.each(cases)('schema-parses invalid $channel responses', async ({
    channel,
    request,
    serviceMethod,
    invalidResponse
  }) => {
    const service = createService();
    service[serviceMethod] = vi.fn(async () => invalidResponse) as never;
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS[channel])(trustedEvent, request))
      .rejects.toThrow();
  });
});
