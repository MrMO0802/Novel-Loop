import { expect, test } from 'vitest';
import { DiagnosticRevisionStartSchema, DiagnosticRevisionIdentitySchema, DiagnosticRevisionResponseSchema } from '../../src/shared/diagnosticRevisionContract';

test('accepts only scoped opaque identities, never paths or provider arguments', () => {
  expect(DiagnosticRevisionStartSchema.safeParse({ projectKey: 'project_test', diagnosticTaskId: 'latest' }).success).toBe(true);
  expect(DiagnosticRevisionStartSchema.safeParse({ projectKey: 'project_test', diagnosticTaskId: '../outside' }).success).toBe(false);
  expect(DiagnosticRevisionStartSchema.safeParse({ projectKey: 'project_test', diagnosticTaskId: 'latest', shell: true }).success).toBe(false);
  expect(DiagnosticRevisionIdentitySchema.safeParse({ projectKey: 'project_test', candidateId: '/etc/passwd' }).success).toBe(false);
  expect(DiagnosticRevisionResponseSchema.safeParse({ outcome: 'error', code: 'source_stale', raw: 'secret' }).success).toBe(false);
});
