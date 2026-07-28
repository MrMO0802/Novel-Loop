import {
  SystemReadinessRequestSchema,
  SystemReadinessSchema,
  type SystemReadiness
} from '../../shared/systemContract';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { SystemReadinessService } from '../services/SystemReadinessService';
import { assertTrustedIpcSender } from './trustedSender';

interface ReadinessEvent {
  senderFrame: {
    url: string;
  };
}

type ReadinessHandler = (
  event: ReadinessEvent,
  request: unknown
) => Promise<SystemReadiness>;

export interface IpcMainRegistrar {
  handle(channel: string, handler: ReadinessHandler): void;
}

export function registerSystemHandlers(
  registrar: IpcMainRegistrar,
  service: SystemReadinessService,
  trustedRendererUrl: string
): void {
  registrar.handle(
    IPC_CHANNELS.systemGetReadiness,
    async (event, request) => {
      assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
      SystemReadinessRequestSchema.parse(request);
      const response = await service.getReadiness();
      return SystemReadinessSchema.parse(response);
    }
  );
}
