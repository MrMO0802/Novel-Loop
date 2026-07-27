import type { BrowserWindowConstructorOptions } from 'electron';

export function createSecureWindowOptions(
  preloadPath: string
): BrowserWindowConstructorOptions {
  return {
    autoHideMenuBar: true,
    backgroundColor: '#f3f5f1',
    height: 900,
    minHeight: 720,
    minWidth: 1024,
    show: false,
    title: 'Novel Loop',
    width: 1440,
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      spellcheck: true,
      webSecurity: true
    }
  };
}
