import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  ChapterAdjustMissionRequestSchema,
  ChapterAdjustPlanRequestSchema,
  ChapterAdoptRevisionRequestSchema,
  ChapterAuthoringResultSchema,
  ChapterCancelRequestSchema,
  ChapterDraftReviewResultSchema,
  ChapterDraftWorkingCopyResultSchema,
  ChapterDraftWorkingCopySaveResultSchema,
  ChapterDiscardDraftWorkingCopyResultSchema,
  ChapterDraftAdoptionResultSchema,
  ChapterGetRequestSchema,
  ChapterInspectRequestSchema,
  ChapterInspectionSchema,
  ChapterPlanReviewResultSchema,
  ChapterReadDraftRequestSchema,
  ChapterReadDraftWorkingCopyRequestSchema,
  ChapterReadPlanRequestSchema,
  ChapterSaveMissionWorkingCopyRequestSchema,
  ChapterSaveDraftWorkingCopyRequestSchema,
  ChapterDiscardDraftWorkingCopyRequestSchema,
  ChapterAdoptDraftRevisionRequestSchema,
  ChapterSavePlanWorkingCopyRequestSchema,
  ChapterSelectDirectionRequestSchema,
  ChapterStartDraftingRequestSchema,
  ChapterStartPlanningRequestSchema,
  ChapterTaskSchema,
  type ChapterAuthoringResult,
  type ChapterDraftReviewResult,
  type ChapterInspection,
  type ChapterPlanReviewResult,
  type ChapterTask
} from '../../shared/chapterContract';
import type {
  ChapterApplicationService
} from '../chapter/ProjectChapterService';
import { assertTrustedIpcSender } from './trustedSender';

interface ChapterEvent {
  senderFrame: {
    url: string;
  };
}

type ChapterHandler = (
  event: ChapterEvent,
  request: unknown
) => Promise<
  | ChapterDraftReviewResult
  | ReturnType<typeof ChapterDraftWorkingCopyResultSchema.parse>
  | ReturnType<typeof ChapterDraftWorkingCopySaveResultSchema.parse>
  | ReturnType<typeof ChapterDiscardDraftWorkingCopyResultSchema.parse>
  | ReturnType<typeof ChapterDraftAdoptionResultSchema.parse>
  | ChapterAuthoringResult
  | ChapterInspection
  | ChapterPlanReviewResult
  | ChapterTask
>;

export interface ChapterIpcMainRegistrar {
  handle(channel: string, handler: ChapterHandler): void;
}

export function registerChapterHandlers(
  registrar: ChapterIpcMainRegistrar,
  service: ChapterApplicationService,
  trustedRendererUrl: string
): void {
  registrar.handle(IPC_CHANNELS.chapterInspect, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterInspectRequestSchema.parse(request);
    return ChapterInspectionSchema.parse(await service.inspect(parsedRequest.projectKey));
  });

  registrar.handle(IPC_CHANNELS.chapterStartPlanning, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterStartPlanningRequestSchema.parse(request);
    return ChapterTaskSchema.parse(await service.startPlanning(parsedRequest.projectKey));
  });

  registrar.handle(IPC_CHANNELS.chapterStartDrafting, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterStartDraftingRequestSchema.parse(request);
    return ChapterTaskSchema.parse(await service.startDrafting(parsedRequest.projectKey));
  });

  registrar.handle(IPC_CHANNELS.chapterAdjustMission, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterAdjustMissionRequestSchema.parse(request);
    return ChapterTaskSchema.parse(await service.adjustMission(parsedRequest));
  });

  registrar.handle(IPC_CHANNELS.chapterAdjustPlan, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterAdjustPlanRequestSchema.parse(request);
    return ChapterTaskSchema.parse(await service.adjustPlan(parsedRequest));
  });

  registrar.handle(IPC_CHANNELS.chapterGet, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterGetRequestSchema.parse(request);
    return ChapterTaskSchema.parse(await service.get(parsedRequest.taskId));
  });

  registrar.handle(IPC_CHANNELS.chapterCancel, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterCancelRequestSchema.parse(request);
    return ChapterTaskSchema.parse(await service.cancel(parsedRequest.taskId));
  });

  registrar.handle(IPC_CHANNELS.chapterReadPlan, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterReadPlanRequestSchema.parse(request);
    return ChapterPlanReviewResultSchema.parse(await service.readPlan(parsedRequest.projectKey));
  });

  registrar.handle(IPC_CHANNELS.chapterReadDraft, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterReadDraftRequestSchema.parse(request);
    return ChapterDraftReviewResultSchema.parse(await service.readDraft(parsedRequest.projectKey));
  });

  registrar.handle(IPC_CHANNELS.chapterReadDraftWorkingCopy, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterReadDraftWorkingCopyRequestSchema.parse(request);
    return safeDraftIpc(async () => ChapterDraftWorkingCopyResultSchema.parse(
      await service.readDraftWorkingCopy(parsedRequest)
    ));
  });

  registrar.handle(IPC_CHANNELS.chapterSaveDraftWorkingCopy, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterSaveDraftWorkingCopyRequestSchema.parse(request);
    return safeDraftIpc(async () => ChapterDraftWorkingCopySaveResultSchema.parse(
      await service.saveDraftWorkingCopy(parsedRequest)
    ));
  });

  registrar.handle(IPC_CHANNELS.chapterDiscardDraftWorkingCopy, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterDiscardDraftWorkingCopyRequestSchema.parse(request);
    return safeDraftIpc(async () => ChapterDiscardDraftWorkingCopyResultSchema.parse(
      await service.discardDraftWorkingCopy(parsedRequest)
    ));
  });

  registrar.handle(IPC_CHANNELS.chapterAdoptDraftRevision, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterAdoptDraftRevisionRequestSchema.parse(request);
    return safeDraftAdoptionIpc(async () => ChapterDraftAdoptionResultSchema.parse(
      await service.adoptDraftRevision(parsedRequest)
    ));
  });

  registrar.handle(IPC_CHANNELS.chapterSelectDirection, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterSelectDirectionRequestSchema.parse(request);
    return ChapterAuthoringResultSchema.parse(
      await service.selectDirection(parsedRequest)
    );
  });

  registrar.handle(
    IPC_CHANNELS.chapterSaveMissionWorkingCopy,
    async (event, request) => {
      assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
      const parsedRequest = ChapterSaveMissionWorkingCopyRequestSchema
        .parse(request);
      return ChapterAuthoringResultSchema.parse(
        await service.saveMissionWorkingCopy(parsedRequest)
      );
    }
  );

  registrar.handle(
    IPC_CHANNELS.chapterSavePlanWorkingCopy,
    async (event, request) => {
      assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
      const parsedRequest = ChapterSavePlanWorkingCopyRequestSchema
        .parse(request);
      return ChapterAuthoringResultSchema.parse(
        await service.savePlanWorkingCopy(parsedRequest)
      );
    }
  );

  registrar.handle(IPC_CHANNELS.chapterAdoptRevision, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ChapterAdoptRevisionRequestSchema.parse(request);
    return ChapterAuthoringResultSchema.parse(
      await service.adoptRevision(parsedRequest)
    );
  });
}

async function safeDraftAdoptionIpc(
  operation: () => Promise<ReturnType<typeof ChapterDraftAdoptionResultSchema.parse>>
): Promise<ReturnType<typeof ChapterDraftAdoptionResultSchema.parse>> {
  try {
    return await operation();
  } catch (error) {
    if (errorCode(error) === 'DRAFT_ADOPTION_RECOVERY_REQUIRED') {
      return ChapterDraftAdoptionResultSchema.parse({
        outcome: 'recovery_required',
        nextAction: 'reload_chapter'
      });
    }
    throw new Error('The local chapter draft operation could not be completed.');
  }
}

async function safeDraftIpc<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error('The local chapter draft operation could not be completed.');
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : '';
}
