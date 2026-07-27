import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createMainWindow } from './createMainWindow';
import { registerSystemHandlers } from './ipc/registerSystemHandlers';
import { BootstrapSystemReadinessService } from './services/SystemReadinessService';
import { SupportedDesktopPlatformSchema } from '../shared/systemContract';

app.enableSandbox();

void app.whenReady().then(() => {
  const trustedRendererUrl = process.env['ELECTRON_RENDERER_URL']
    ?? pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString();
  const service = new BootstrapSystemReadinessService(
    app.getVersion(),
    SupportedDesktopPlatformSchema.parse(process.platform)
  );

  registerSystemHandlers(
    {
      handle: (channel, handler) => {
        ipcMain.handle(channel, (event, request) => handler(
          { senderFrame: { url: event.senderFrame?.url ?? '' } },
          request
        ));
      }
    },
    service,
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
