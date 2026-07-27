import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  selectRendererTarget
} from '../../src/main/rendererTarget';

const packagedRendererPath = path.resolve(
  '/opt/novel-loop',
  'renderer',
  'index.html'
);

describe('renderer target selection', () => {
  test('accepts one exact HTTP loopback origin in explicit development mode', () => {
    expect(selectRendererTarget({
      environmentUrl: 'http://127.0.0.1:5173',
      isDevelopment: true,
      packagedRendererPath
    })).toEqual({
      kind: 'url',
      location: 'http://127.0.0.1:5173',
      trustedRendererUrl: 'http://127.0.0.1:5173'
    });
  });

  test.each([
    'http://user:secret@127.0.0.1:5173',
    'http://127.0.0.1:5173/library',
    'http://127.0.0.1:5173?source=external',
    'http://127.0.0.1:5173#fragment',
    'http://localhost:5173',
    'http://127.0.0.2:5173',
    'https://127.0.0.1:5173',
    'javascript:alert(1)'
  ])('rejects a non-origin development renderer URL: %s', (environmentUrl) => {
    const target = selectRendererTarget({
      environmentUrl,
      isDevelopment: true,
      packagedRendererPath
    });

    expect(target).toEqual({
      kind: 'file',
      location: packagedRendererPath,
      trustedRendererUrl: pathToFileURL(packagedRendererPath).toString()
    });
    expect(JSON.stringify(target)).not.toContain(environmentUrl);
  });

  test('ignores the development renderer environment URL outside development mode', () => {
    expect(selectRendererTarget({
      environmentUrl: 'http://127.0.0.1:5173',
      isDevelopment: false,
      packagedRendererPath
    })).toEqual({
      kind: 'file',
      location: packagedRendererPath,
      trustedRendererUrl: pathToFileURL(packagedRendererPath).toString()
    });
  });
});
