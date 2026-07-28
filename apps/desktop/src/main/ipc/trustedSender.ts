import { isTrustedRendererNavigation } from '../navigationPolicy';

export function assertTrustedIpcSender(
  senderUrl: string,
  trustedRendererUrl: string
): void {
  if (!isTrustedRendererNavigation(trustedRendererUrl, senderUrl)) {
    throw new Error('Untrusted renderer request.');
  }
}
