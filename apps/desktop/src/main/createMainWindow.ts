import { BrowserWindow } from 'electron';
import path from 'node:path';

import { installNavigationPolicy } from './navigationPolicy';
import { createSecureWindowOptions } from './windowPolicy';

export function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const mainWindow = new BrowserWindow(createSecureWindowOptions(preloadPath));

  installNavigationPolicy(mainWindow);
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}
