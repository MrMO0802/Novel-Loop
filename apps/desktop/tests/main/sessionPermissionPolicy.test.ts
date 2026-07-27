import { describe, expect, test, vi } from 'vitest';

import {
  installSessionPermissionDenial,
  type PermissionPolicySession
} from '../../src/main/sessionPermissionPolicy';

describe('session permission policy', () => {
  test('denies permission requests, permission checks, and device permissions', () => {
    const session = {
      setDevicePermissionHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn()
    } satisfies PermissionPolicySession;

    installSessionPermissionDenial(session);

    expect(session.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(session.setPermissionCheckHandler).toHaveBeenCalledOnce();
    expect(session.setDevicePermissionHandler).toHaveBeenCalledOnce();

    const requestHandler = session.setPermissionRequestHandler.mock.calls[0]?.[0];
    const requestCallback = vi.fn();
    requestHandler?.({} as never, 'notifications' as never, requestCallback);
    expect(requestCallback).toHaveBeenCalledWith(false);

    const checkHandler = session.setPermissionCheckHandler.mock.calls[0]?.[0];
    expect(checkHandler?.({} as never, 'notifications' as never, '', {} as never))
      .toBe(false);

    const deviceHandler = session.setDevicePermissionHandler.mock.calls[0]?.[0];
    expect(deviceHandler?.({} as never)).toBe(false);
  });
});
