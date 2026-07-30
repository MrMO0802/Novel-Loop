import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  ChapterCancelRequestSchema,
  ChapterDraftReviewResultSchema,
  ChapterGetRequestSchema,
  ChapterInspectRequestSchema,
  ChapterInspectionSchema,
  ChapterPlanReviewResultSchema,
  ChapterReadDraftRequestSchema,
  ChapterReadPlanRequestSchema,
  ChapterStartDraftingRequestSchema,
  ChapterStartPlanningRequestSchema,
  ChapterTaskSchema,
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
}
