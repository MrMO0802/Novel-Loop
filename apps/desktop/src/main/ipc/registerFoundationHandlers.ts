import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  FoundationCancelRequestSchema,
  FoundationGetRequestSchema,
  FoundationReadRequestSchema,
  FoundationReviewResultSchema,
  FoundationStartRequestSchema,
  FoundationTaskSchema,
  type FoundationReviewResult,
  type FoundationTask
} from '../../shared/foundationContract';
import type {
  ProjectFoundationApplicationService
} from '../foundation/ProjectFoundationService';
import { assertTrustedIpcSender } from './trustedSender';

interface FoundationEvent {
  senderFrame: {
    url: string;
  };
}

type FoundationHandler = (
  event: FoundationEvent,
  request: unknown
) => Promise<FoundationTask | FoundationReviewResult>;

export interface FoundationIpcMainRegistrar {
  handle(channel: string, handler: FoundationHandler): void;
}

export function registerFoundationHandlers(
  registrar: FoundationIpcMainRegistrar,
  service: ProjectFoundationApplicationService,
  trustedRendererUrl: string
): void {
  registrar.handle(IPC_CHANNELS.foundationStart, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = FoundationStartRequestSchema.parse(request);
    return FoundationTaskSchema.parse(await service.start(parsedRequest.projectKey));
  });

  registrar.handle(IPC_CHANNELS.foundationGet, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = FoundationGetRequestSchema.parse(request);
    return FoundationTaskSchema.parse(await service.get(parsedRequest.taskId));
  });

  registrar.handle(IPC_CHANNELS.foundationCancel, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = FoundationCancelRequestSchema.parse(request);
    return FoundationTaskSchema.parse(await service.cancel(parsedRequest.taskId));
  });

  registrar.handle(IPC_CHANNELS.foundationRead, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = FoundationReadRequestSchema.parse(request);
    return FoundationReviewResultSchema.parse(
      await service.read(parsedRequest.projectKey)
    );
  });
}
