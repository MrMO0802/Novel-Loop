import { DiagnosticRevisionIdentitySchema, DiagnosticRevisionReadSchema, DiagnosticRevisionResponseSchema, DiagnosticRevisionStartSchema, DiagnosticRevisionTaskRequestSchema, type DiagnosticRevisionApi } from '../../shared/diagnosticRevisionContract';
import { assertTrustedIpcSender } from './trustedSender';

export function registerDiagnosticRevisionHandlers(registrar: { handle(channel: string, handler: (event: { senderFrame: { url: string } }, request: unknown) => Promise<unknown>): void }, service: DiagnosticRevisionApi, url: string) {
  const schemas = { start: DiagnosticRevisionStartSchema, get: DiagnosticRevisionTaskRequestSchema, cancel: DiagnosticRevisionTaskRequestSchema, read: DiagnosticRevisionReadSchema, adopt: DiagnosticRevisionIdentitySchema, reject: DiagnosticRevisionIdentitySchema };
  for (const name of Object.keys(schemas) as (keyof DiagnosticRevisionApi)[]) {
    registrar.handle(`novel-loop:diagnostic-revision:${name}`, async (event, request) => {
      try {
        assertTrustedIpcSender(event.senderFrame.url, url);
        // Keep method-specific types paired with their strict request schemas.
        const invoke = async () => {
          switch (name) {
            case 'start': return service.start(schemas.start.parse(request));
            case 'get': return service.get(schemas.get.parse(request));
            case 'cancel': return service.cancel(schemas.cancel.parse(request));
            case 'read': return service.read(schemas.read.parse(request));
            case 'adopt': return service.adopt(schemas.adopt.parse(request));
            case 'reject': return service.reject(schemas.reject.parse(request));
          }
        };
        return DiagnosticRevisionResponseSchema.parse(await invoke());
      } catch { throw new Error('submission.blocked'); }
    });
  }
}
