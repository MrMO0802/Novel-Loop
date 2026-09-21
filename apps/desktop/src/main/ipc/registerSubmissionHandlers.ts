import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  SubmissionCancelRequestSchema,
  SubmissionConfirmRequestSchema,
  SubmissionConfirmResultSchema,
  SubmissionGetRequestSchema,
  SubmissionPreviewResultSchema,
  SubmissionReadPreviewRequestSchema,
  SubmissionStartCheckRequestSchema,
  SubmissionStartCheckResultSchema,
  SubmissionTaskSchema,
  type SubmissionCancelRequest,
  type SubmissionConfirmRequest,
  type SubmissionConfirmResult,
  type SubmissionGetRequest,
  type SubmissionPreviewResult,
  type SubmissionReadPreviewRequest,
  type SubmissionStartCheckRequest,
  type SubmissionStartCheckResult,
  type SubmissionTask
} from '../../shared/submissionContract';
import { assertTrustedIpcSender } from './trustedSender';

export interface ProjectSubmissionServiceContract {
  startCheck(request: SubmissionStartCheckRequest): Promise<SubmissionStartCheckResult>;
  get(request: SubmissionGetRequest): Promise<SubmissionTask>;
  cancel(request: SubmissionCancelRequest): Promise<SubmissionTask>;
  readPreview(request: SubmissionReadPreviewRequest): Promise<SubmissionPreviewResult>;
  confirm(request: SubmissionConfirmRequest): Promise<SubmissionConfirmResult>;
}

interface SubmissionEvent {
  senderFrame: { url: string };
}

type SubmissionHandler = (event: SubmissionEvent, request: unknown) => Promise<
  SubmissionStartCheckResult | SubmissionTask | SubmissionPreviewResult | SubmissionConfirmResult
>;

export interface SubmissionIpcMainRegistrar {
  handle(channel: string, handler: SubmissionHandler): void;
}

export function registerSubmissionHandlers(
  registrar: SubmissionIpcMainRegistrar,
  service: ProjectSubmissionServiceContract,
  trustedRendererUrl: string
): void {
  registrar.handle(IPC_CHANNELS.submissionStartCheck, (event, request) => (
    safeSubmissionIpc(event, trustedRendererUrl, async () => {
      const parsedRequest = SubmissionStartCheckRequestSchema.parse(request);
      return SubmissionStartCheckResultSchema.parse(await service.startCheck(parsedRequest));
    })
  ));

  registrar.handle(IPC_CHANNELS.submissionGet, (event, request) => (
    safeSubmissionIpc(event, trustedRendererUrl, async () => {
      const parsedRequest = SubmissionGetRequestSchema.parse(request);
      return SubmissionTaskSchema.parse(await service.get(parsedRequest));
    })
  ));

  registrar.handle(IPC_CHANNELS.submissionCancel, (event, request) => (
    safeSubmissionIpc(event, trustedRendererUrl, async () => {
      const parsedRequest = SubmissionCancelRequestSchema.parse(request);
      return SubmissionTaskSchema.parse(await service.cancel(parsedRequest));
    })
  ));

  registrar.handle(IPC_CHANNELS.submissionReadPreview, (event, request) => (
    safeSubmissionIpc(event, trustedRendererUrl, async () => {
      const parsedRequest = SubmissionReadPreviewRequestSchema.parse(request);
      return SubmissionPreviewResultSchema.parse(await service.readPreview(parsedRequest));
    })
  ));

  registrar.handle(IPC_CHANNELS.submissionConfirm, (event, request) => (
    safeSubmissionIpc(event, trustedRendererUrl, async () => {
      const parsedRequest = SubmissionConfirmRequestSchema.parse(request);
      return SubmissionConfirmResultSchema.parse(await service.confirm(parsedRequest));
    })
  ));
}

async function safeSubmissionIpc<T>(
  event: SubmissionEvent,
  trustedRendererUrl: string,
  operation: () => Promise<T>
): Promise<T> {
  try {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    return await operation();
  } catch {
    // Neither backend errors nor schema diagnostics may cross the IPC boundary.
    throw new Error('submission.blocked');
  }
}
