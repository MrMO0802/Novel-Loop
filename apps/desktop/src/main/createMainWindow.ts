import { BrowserWindow } from 'electron';
import path from 'node:path';

import { installNavigationPolicy } from './navigationPolicy';
import type { RendererTarget } from './rendererTarget';
import { createSecureWindowOptions } from './windowPolicy';

export function createMainWindow(target: RendererTarget): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const mainWindow = new BrowserWindow(createSecureWindowOptions(preloadPath));

  installNavigationPolicy(mainWindow);
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (target.kind === 'url') {
    void mainWindow.loadURL(target.location);
  } else {
    void mainWindow.loadFile(target.location);
  }

  return mainWindow;
}
