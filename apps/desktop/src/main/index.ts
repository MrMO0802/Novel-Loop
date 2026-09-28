import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';

import { createMainWindow } from './createMainWindow';
import { NativeProjectDialog } from './dialogs/NativeProjectDialog';
import { EngineChapterGateway } from './chapter/EngineChapterGateway';
import { ChapterReviewTokenStore } from './chapter/ChapterReviewTokenStore';
import { DraftWorkingCopyStore } from './chapter/DraftWorkingCopyStore';
import { ProjectChapterService } from './chapter/ProjectChapterService';
import { ProjectSubmissionGuard } from './submission/ProjectSubmissionGuard';
import { EngineSubmissionGateway } from './submission/EngineSubmissionGateway';
import { ProjectSubmissionService } from './submission/ProjectSubmissionService';
import { ProjectDiagnosticRevisionService } from './submission/ProjectDiagnosticRevisionService';
import { registerDiagnosticRevisionHandlers } from './ipc/registerDiagnosticRevisionHandlers';
import { EngineFoundationGateway } from './foundation/EngineFoundationGateway';
import { ProjectFoundationService } from './foundation/ProjectFoundationService';
import { registerChapterHandlers } from './ipc/registerChapterHandlers';
import { registerFoundationHandlers } from './ipc/registerFoundationHandlers';
import { registerPlanningHandlers } from './ipc/registerPlanningHandlers';
import { registerProjectHandlers } from './ipc/registerProjectHandlers';
import { registerSystemHandlers } from './ipc/registerSystemHandlers';
import { registerSubmissionHandlers } from './ipc/registerSubmissionHandlers';
import { EngineProjectGateway } from './projects/EngineProjectGateway';
import { EnginePlanningGateway } from './planning/EnginePlanningGateway';
import { ProjectPlanningService } from './planning/ProjectPlanningService';
import {
  ProjectLibraryService
} from './projects/ProjectLibraryService';
import {
  FileProjectRegistryStore
} from './projects/ProjectRegistryStore';
import { selectRendererTarget } from './rendererTarget';
import {
  EngineSystemReadinessService
} from './services/EngineSystemReadinessService';
import { installSessionPermissionDenial } from './sessionPermissionPolicy';
import { installSingleInstancePolicy } from './singleInstancePolicy';
import { SupportedDesktopPlatformSchema } from '../shared/systemContract';

app.enableSandbox();

const isPrimaryInstance = installSingleInstancePolicy({
  requestLock: () => app.requestSingleInstanceLock(),
  quit: () => app.quit(),
  onSecondInstance: (listener) => {
    app.on('second-instance', listener);
  },
  getWindows: () => BrowserWindow.getAllWindows()
});

if (isPrimaryInstance) {
void app.whenReady().then(() => {
  const rendererTarget = selectRendererTarget({
    environmentUrl: process.env['ELECTRON_RENDERER_URL'],
    isDevelopment: import.meta.env.DEV,
    packagedRendererPath: path.join(__dirname, '../renderer/index.html')
  });
  const systemService = new EngineSystemReadinessService(
    app.getVersion(),
    SupportedDesktopPlatformSchema.parse(process.platform)
  );
  const registryPath = path.join(
    app.getPath('userData'),
    'project-library.json'
  );
  const registry = new FileProjectRegistryStore(registryPath);
  const projectDialog = new NativeProjectDialog();
  const projectGateway = new EngineProjectGateway();
  const projectService = new ProjectLibraryService({
    registry,
    dialog: projectDialog,
    gateway: projectGateway
  });
  const foundationService = new ProjectFoundationService({
    projects: projectService,
    gateway: new EngineFoundationGateway()
  });
  const planningService = new ProjectPlanningService({
    projects: projectService,
    gateway: new EnginePlanningGateway()
  });
  const submissionGuard = new ProjectSubmissionGuard();
  const workingCopies = new DraftWorkingCopyStore(app.getPath('userData'));
  const chapterService = new ProjectChapterService({
    projects: projectService,
    gateway: new EngineChapterGateway(),
    tokenStore: new ChapterReviewTokenStore(),
    workingCopies,
    submissionGuard
  });
  const submissionService = new ProjectSubmissionService({
    projects: projectService,
    gateway: new EngineSubmissionGateway(),
    workingCopies,
    guard: submissionGuard
  });

  registerSystemHandlers(
    {
      handle: (channel, handler) => {
        ipcMain.handle(channel, (event, request) => handler(
          { senderFrame: { url: event.senderFrame?.url ?? '' } },
          request
        ));
      }
    },
    systemService,
    rendererTarget.trustedRendererUrl
  );

  registerProjectHandlers(
    {
      handle: (channel, handler) => {
        ipcMain.handle(channel, (event, request) => handler(
          { senderFrame: { url: event.senderFrame?.url ?? '' } },
          request
        ));
      }
    },
    projectService,
    rendererTarget.trustedRendererUrl
  );

  registerFoundationHandlers(
    {
      handle: (channel, handler) => {
        ipcMain.handle(channel, (event, request) => handler(
          { senderFrame: { url: event.senderFrame?.url ?? '' } },
          request
        ));
      }
    },
    foundationService,
    rendererTarget.trustedRendererUrl
  );

  registerPlanningHandlers(
    {
      handle: (channel, handler) => {
        ipcMain.handle(channel, (event, request) => handler(
          { senderFrame: { url: event.senderFrame?.url ?? '' } },
          request
        ));
      }
    },
    planningService,
    rendererTarget.trustedRendererUrl
  );

  registerChapterHandlers(
    {
      handle: (channel, handler) => {
        ipcMain.handle(channel, (event, request) => handler(
          { senderFrame: { url: event.senderFrame?.url ?? '' } },
          request
        ));
      }
    },
    chapterService,
    rendererTarget.trustedRendererUrl
  );

  registerSubmissionHandlers(
    {
      handle: (channel, handler) => {
        ipcMain.handle(channel, (event, request) => handler(
          { senderFrame: { url: event.senderFrame?.url ?? '' } },
          request
        ));
      }
    },
    submissionService,
    rendererTarget.trustedRendererUrl
  );

  installSessionPermissionDenial(session.defaultSession);
  registerDiagnosticRevisionHandlers({ handle: (channel, handler) => {
    ipcMain.handle(channel, (event, request) => handler({ senderFrame: { url: event.senderFrame?.url ?? '' } }, request));
  } }, new ProjectDiagnosticRevisionService({ projects: projectService, gateway: new EngineSubmissionGateway(), workingCopies, guard: submissionGuard }), rendererTarget.trustedRendererUrl);

  createMainWindow(rendererTarget);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(rendererTarget);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
}
