import { describe, expect, test } from 'vitest';

import { createSecureWindowOptions } from '../../src/main/windowPolicy';

describe('secure Electron window policy', () => {
  test('keeps the renderer sandboxed and isolated from Node.js', () => {
    const options = createSecureWindowOptions('/trusted/preload.js');

    expect(options.webPreferences).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: '/trusted/preload.js',
      sandbox: true,
      webSecurity: true
    });
  });

  test('waits for ready-to-show and enforces stable desktop dimensions', () => {
    const options = createSecureWindowOptions('/trusted/preload.js');

    expect(options).toMatchObject({
      height: 900,
      minHeight: 720,
      minWidth: 1024,
      show: false,
      width: 1440
    });
  });
});
