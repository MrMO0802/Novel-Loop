import { describe, expect, test } from 'vitest';

import { isTrustedRendererNavigation } from '../../src/main/navigationPolicy';

describe('renderer navigation policy', () => {
  test('allows navigation within the exact loopback development origin', () => {
    expect(isTrustedRendererNavigation(
      'http://127.0.0.1:5173/project/rain-radio',
      'http://127.0.0.1:5173/project/rain-radio/chapter/2'
    )).toBe(true);
  });

  test('allows only query or hash navigation for the packaged renderer file', () => {
    expect(isTrustedRendererNavigation(
      'file:///opt/Novel%20Loop/resources/app.asar/out/renderer/index.html',
      'file:///opt/Novel%20Loop/resources/app.asar/out/renderer/index.html#/library'
    )).toBe(true);
    expect(isTrustedRendererNavigation(
      'file:///opt/Novel%20Loop/resources/app.asar/out/renderer/index.html',
      'file:///tmp/other.html'
    )).toBe(false);
  });

  test.each([
    'https://example.com',
    'http://example.com',
    'javascript:alert(1)',
    'data:text/html,unsafe'
  ])('blocks an untrusted destination: %s', (destination) => {
    expect(isTrustedRendererNavigation(
      'http://127.0.0.1:5173/library',
      destination
    )).toBe(false);
  });

  test('does not trust localhost aliases or a different loopback port', () => {
    expect(isTrustedRendererNavigation(
      'http://127.0.0.1:5173/library',
      'http://localhost:5173/library'
    )).toBe(false);
    expect(isTrustedRendererNavigation(
      'http://127.0.0.1:5173/library',
      'http://127.0.0.1:5174/library'
    )).toBe(false);
  });
});
