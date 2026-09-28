import { expect, test } from 'vitest';
import { DiagnosticRevisionOutputSchema, DiagnosticRevisionTaskSchema, DiagnosticRevisionDispositionSchema } from '../../src/schemas/desktopDiagnosticRevision.js';
import { submissionErrorCode } from '../../src/app/desktopSubmissionPreview.js';
import { ProviderError } from '../../src/providers/codexTextProvider.js';

test('exhausted JSON repair is shown as invalid output rather than unexpected failure', () => {
  expect(submissionErrorCode(new ProviderError('CODEX_REPAIR_FAILED', 'private provider payload'), 'diagnostics')).toBe('invalid_output');
});

test('validates bounded candidate output and rejects unknown fields', () => {
  expect(DiagnosticRevisionOutputSchema.safeParse({ markdown: '# 正文\n\n红伞落地。', changes: [{ issueIndex: 0, reason: '统一位置' }] }).success).toBe(true);
  for (const value of [
    { markdown: '', changes: [] },
    { markdown: '文'.repeat(800000), changes: [{ issueIndex: 0, reason: 'fix' }] },
    { markdown: 'text', changes: [{ issueIndex: -1, reason: 'fix' }] },
    { markdown: 'text', changes: [{ issueIndex: 0, reason: 'fix' }], commit: true }
  ]) expect(DiagnosticRevisionOutputSchema.safeParse(value).success).toBe(false);
});

const task = { schemaVersion: 1, taskId: 'dr_task_test', projectId: 'test', chapterNumber: 1, stage: 'checking_source', status: 'running', runId: 'run_test', candidateId: null, startedAt: '2026-09-28T00:00:00Z', endedAt: null, safeErrorCode: null };
test('validates task publication and time order', () => {
  expect(DiagnosticRevisionTaskSchema.safeParse(task).success).toBe(true);
  expect(DiagnosticRevisionTaskSchema.safeParse({ ...task, status: 'ready' }).success).toBe(false);
  expect(DiagnosticRevisionTaskSchema.safeParse({ ...task, status: 'failed', safeErrorCode: 'invalid_output', endedAt: '2026-09-27T00:00:00Z' }).success).toBe(false);
});
test('adopted dispositions require a bound author revision', () => {
  const value = { schemaVersion: 1, candidateId: 'dr_candidate_test', status: 'pending', sourceHash: 'a'.repeat(64), candidateHash: 'b'.repeat(64), authorRevisionId: null, decidedAt: null };
  expect(DiagnosticRevisionDispositionSchema.safeParse(value).success).toBe(true);
  expect(DiagnosticRevisionDispositionSchema.safeParse({ ...value, status: 'adopted' }).success).toBe(false);
});
