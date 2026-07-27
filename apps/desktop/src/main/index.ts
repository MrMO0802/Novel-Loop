import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createMainWindow } from './createMainWindow';
import { NativeProjectDialog } from './dialogs/NativeProjectDialog';
import { registerProjectHandlers } from './ipc/registerProjectHandlers';
import { registerSystemHandlers } from './ipc/registerSystemHandlers';
import { EngineProjectGateway } from './projects/EngineProjectGateway';
import {
  ProjectLibraryService
} from './projects/ProjectLibraryService';
import {
  FileProjectRegistryStore
} from './projects/ProjectRegistryStore';
import {
  EngineSystemReadinessService
} from './services/EngineSystemReadinessService';
import { SupportedDesktopPlatformSchema } from '../shared/systemContract';

app.enableSandbox();

void app.whenReady().then(() => {
  const trustedRendererUrl = process.env['ELECTRON_RENDERER_URL']
    ?? pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString();
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
    trustedRendererUrl
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
    trustedRendererUrl
  );

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    }
  );

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
