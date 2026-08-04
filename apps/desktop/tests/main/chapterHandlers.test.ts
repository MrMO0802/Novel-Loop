import { describe, expect, test, vi } from 'vitest';

import { registerChapterHandlers } from '../../src/main/ipc/registerChapterHandlers';
import type {
  ChapterApplicationService
} from '../../src/main/chapter/ProjectChapterService';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';
import type {
  ChapterAdoptRevisionRequest,
  ChapterAuthoringResult,
  ChapterDraftReviewResult,
  ChapterInspection,
  ChapterPlanReviewResult,
  ChapterSaveMissionWorkingCopyRequest,
  ChapterSavePlanWorkingCopyRequest,
  ChapterSelectDirectionRequest,
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
const savedResult: ChapterAuthoringResult = {
  outcome: 'saved',
  revisionToken: `chapter_revision_${'3'.repeat(48)}`
};
const adoptedResult: ChapterAuthoringResult = { outcome: 'adopted' };
const reviewToken = `chapter_review_${'1'.repeat(48)}`;
const optionToken = `chapter_option_${'2'.repeat(48)}`;
const participantToken = `chapter_option_${'4'.repeat(48)}`;

const selectDirectionRequest: ChapterSelectDirectionRequest = {
  projectKey: task.projectKey,
  reviewToken,
  optionToken
};
const savePlanRequest: ChapterSavePlanWorkingCopyRequest = {
  ...selectDirectionRequest,
  markdown: '# Revised direction\n\nThe radio speaks twice.\n'
};
const saveMissionRequest: ChapterSaveMissionWorkingCopyRequest = {
  projectKey: task.projectKey,
  reviewToken,
  mission: {
    chapterFunction: 'Open the impossible broadcast.',
    requiredObjectives: [],
    debtTokens: [],
    debtsToIntroduce: [],
    characterDeltas: [],
    participantTokens: [participantToken],
    newParticipants: [],
    readerInformation: {
      newKnowledge: [],
      newSuspicions: [],
      questionsToMaintain: ['Who is calling?'],
      questionsToAnswer: []
    },
    forbiddenMoves: [],
    targetEmotionalCurve: [],
    targetWordCount: null
  }
};
const adoptRequest: ChapterAdoptRevisionRequest = {
  projectKey: task.projectKey,
  revisionToken: `chapter_revision_${'3'.repeat(48)}`,
  confirmInvalidation: true
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
    readDraft: vi.fn(async () => draftReview),
    selectDirection: vi.fn(async () => adoptedResult),
    saveMissionWorkingCopy: vi.fn(async () => savedResult),
    savePlanWorkingCopy: vi.fn(async () => savedResult),
    adoptRevision: vi.fn(async () => adoptedResult)
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
  },
  {
    channel: 'chapterSelectDirection',
    request: selectDirectionRequest,
    invalidRequest: { ...selectDirectionRequest, candidateId: 'plan_001' },
    serviceMethod: 'selectDirection',
    response: adoptedResult,
    invalidResponse: { ...adoptedResult, selectedCandidateId: 'plan_001' }
  },
  {
    channel: 'chapterSaveMissionWorkingCopy',
    request: saveMissionRequest,
    invalidRequest: { ...saveMissionRequest, sourceMissionHash: 'a'.repeat(64) },
    serviceMethod: 'saveMissionWorkingCopy',
    response: savedResult,
    invalidResponse: { ...savedResult, revisionId: 'author_revision_ch001_mission_v1' }
  },
  {
    channel: 'chapterSavePlanWorkingCopy',
    request: savePlanRequest,
    invalidRequest: { ...savePlanRequest, path: 'chapters/chapter_001/selected_plan.md' },
    serviceMethod: 'savePlanWorkingCopy',
    response: savedResult,
    invalidResponse: { ...savedResult, sourceHash: 'a'.repeat(64) }
  },
  {
    channel: 'chapterAdoptRevision',
    request: adoptRequest,
    invalidRequest: { ...adoptRequest, confirmInvalidation: false },
    serviceMethod: 'adoptRevision',
    response: adoptedResult,
    invalidResponse: { ...adoptedResult, invalidationReportPath: '/private/report.json' }
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
    expect(IPC_CHANNELS.chapterSelectDirection)
      .toBe('novel-loop:chapter:select-direction');
    expect(IPC_CHANNELS.chapterSaveMissionWorkingCopy)
      .toBe('novel-loop:chapter:save-mission-working-copy');
    expect(IPC_CHANNELS.chapterSavePlanWorkingCopy)
      .toBe('novel-loop:chapter:save-plan-working-copy');
    expect(IPC_CHANNELS.chapterAdoptRevision)
      .toBe('novel-loop:chapter:adopt-revision');
    expect(registrations.map(({ channel }) => channel)).toEqual([
      'novel-loop:chapter:inspect',
      'novel-loop:chapter:start-planning',
      'novel-loop:chapter:start-drafting',
      'novel-loop:chapter:get',
      'novel-loop:chapter:cancel',
      'novel-loop:chapter:read-plan',
      'novel-loop:chapter:read-draft',
      'novel-loop:chapter:select-direction',
      'novel-loop:chapter:save-mission-working-copy',
      'novel-loop:chapter:save-plan-working-copy',
      'novel-loop:chapter:adopt-revision'
    ]);
    expect(new Set(registrations.map(({ channel }) => channel)).size).toBe(11);
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

    const expectedArgument = [
      'selectDirection',
      'saveMissionWorkingCopy',
      'savePlanWorkingCopy',
      'adoptRevision'
    ].includes(serviceMethod)
      ? request
      : 'projectKey' in request
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
