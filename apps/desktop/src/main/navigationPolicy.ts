import type { BrowserWindow } from 'electron';

export function isTrustedRendererNavigation(
  currentUrl: string,
  destinationUrl: string
): boolean {
  try {
    const current = new URL(currentUrl);
    const destination = new URL(destinationUrl);

    if (current.protocol === 'file:') {
      return destination.protocol === 'file:'
        && destination.pathname === current.pathname;
    }

    return current.protocol === 'http:'
      && current.hostname === '127.0.0.1'
      && destination.protocol === 'http:'
      && destination.origin === current.origin;
  } catch {
    return false;
  }
}

export function installNavigationPolicy(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, destinationUrl) => {
    if (!isTrustedRendererNavigation(window.webContents.getURL(), destinationUrl)) {
      event.preventDefault();
    }
  });
}
