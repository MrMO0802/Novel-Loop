import type { Session } from 'electron';

export type PermissionPolicySession = Pick<
  Session,
  | 'setDevicePermissionHandler'
  | 'setPermissionCheckHandler'
  | 'setPermissionRequestHandler'
>;

export function installSessionPermissionDenial(
  session: PermissionPolicySession
): void {
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    }
  );
}
