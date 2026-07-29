import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  PlanningCancelRequestSchema,
  PlanningGetRequestSchema,
  PlanningReadRequestSchema,
  PlanningReviewResultSchema,
  PlanningStartRequestSchema,
  PlanningTaskSchema,
  type PlanningReviewResult,
  type PlanningTask
} from '../../shared/planningContract';
import type {
  PlanningApplicationService
} from '../planning/ProjectPlanningService';
import { assertTrustedIpcSender } from './trustedSender';

interface PlanningEvent {
  senderFrame: {
    url: string;
  };
}

type PlanningHandler = (
  event: PlanningEvent,
  request: unknown
) => Promise<PlanningTask | PlanningReviewResult>;

export interface PlanningIpcMainRegistrar {
  handle(channel: string, handler: PlanningHandler): void;
}

export function registerPlanningHandlers(
  registrar: PlanningIpcMainRegistrar,
  service: PlanningApplicationService,
  trustedRendererUrl: string
): void {
  registrar.handle(IPC_CHANNELS.planningStart, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = PlanningStartRequestSchema.parse(request);
    return PlanningTaskSchema.parse(await service.start(parsedRequest.projectKey));
  });

  registrar.handle(IPC_CHANNELS.planningGet, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = PlanningGetRequestSchema.parse(request);
    return PlanningTaskSchema.parse(await service.get(parsedRequest.taskId));
  });

  registrar.handle(IPC_CHANNELS.planningCancel, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = PlanningCancelRequestSchema.parse(request);
    return PlanningTaskSchema.parse(await service.cancel(parsedRequest.taskId));
  });

  registrar.handle(IPC_CHANNELS.planningRead, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = PlanningReadRequestSchema.parse(request);
    return PlanningReviewResultSchema.parse(await service.read(parsedRequest.projectKey));
  });
}
