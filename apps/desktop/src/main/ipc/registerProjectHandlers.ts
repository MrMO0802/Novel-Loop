import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  ChooseDefaultLibraryRequestSchema,
  CreateProjectRequestSchema,
  LibraryLocationSelectionSchema,
  OpenExistingProjectRequestSchema,
  OpenProjectRequestSchema,
  ProjectLibraryResultSchema,
  ProjectListRequestSchema,
  ProjectOpenResultSchema,
  RemoveProjectRequestSchema
} from '../../shared/projectContract';
import type {
  ProjectLibraryResult,
  ProjectOpenResult
} from '../../shared/projectContract';
import type {
  ProjectLibraryApplicationService
} from '../projects/ProjectLibraryService';
import { assertTrustedIpcSender } from './trustedSender';

interface ProjectEvent {
  senderFrame: {
    url: string;
  };
}

type ProjectHandler = (
  event: ProjectEvent,
  request: unknown
) => Promise<ProjectLibraryResult | ProjectOpenResult | {
  selection: 'selected';
  locationLabel: string;
} | {
  selection: 'cancelled' | 'location_unavailable';
}>;

export interface ProjectIpcMainRegistrar {
  handle(channel: string, handler: ProjectHandler): void;
}

export function registerProjectHandlers(
  registrar: ProjectIpcMainRegistrar,
  service: ProjectLibraryApplicationService,
  trustedRendererUrl: string
): void {
  registrar.handle(IPC_CHANNELS.projectsList, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = ProjectListRequestSchema.parse(request);
    const response = await service.list();
    void parsedRequest;
    return ProjectLibraryResultSchema.parse(response);
  });

  registrar.handle(
    IPC_CHANNELS.projectsChooseDefaultLibrary,
    async (event, request) => {
      assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
      const parsedRequest = ChooseDefaultLibraryRequestSchema.parse(request);
      const response = await service.chooseDefaultLibrary();
      void parsedRequest;
      return LibraryLocationSelectionSchema.parse(response);
    }
  );

  registrar.handle(IPC_CHANNELS.projectsCreate, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = CreateProjectRequestSchema.parse(request);
    const response = await service.create(parsedRequest);
    return ProjectOpenResultSchema.parse(response);
  });

  registrar.handle(
    IPC_CHANNELS.projectsOpenExisting,
    async (event, request) => {
      assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
      const parsedRequest = OpenExistingProjectRequestSchema.parse(request);
      const response = await service.openExisting();
      void parsedRequest;
      return ProjectOpenResultSchema.parse(response);
    }
  );

  registrar.handle(IPC_CHANNELS.projectsOpen, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = OpenProjectRequestSchema.parse(request);
    const response = await service.open(parsedRequest.projectKey);
    return ProjectOpenResultSchema.parse(response);
  });

  registrar.handle(IPC_CHANNELS.projectsRemove, async (event, request) => {
    assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
    const parsedRequest = RemoveProjectRequestSchema.parse(request);
    const response = await service.remove(parsedRequest.projectKey);
    return ProjectLibraryResultSchema.parse(response);
  });
}
