import { describe, expect, test } from 'vitest';

import {
  SubmissionStartCheckRequestSchema, SubmissionReadPreviewRequestSchema,
  SubmissionGetRequestSchema, SubmissionCancelRequestSchema, SubmissionConfirmRequestSchema,
  SubmissionStartCheckResultSchema, SubmissionTaskSchema,
  SubmissionPreviewResultSchema, SubmissionConfirmResultSchema
} from '../../src/shared/submissionContract';

const projectKey = 'project_submission';
const taskId = 'submission_task_001';
const previewToken = `submission_${'a'.repeat(48)}`;
const startedAt = '2026-09-21T01:00:00Z';
const endedAt = '2026-09-21T01:00:01Z';
const issue = { severity: 'error', message: 'The witness contradicts an earlier account.', evidence: 'The door was locked.' };
const task = {
  taskId, projectKey, chapterNumber: 1, stage: 'diagnostics', status: 'running',
  startedAt, endedAt: null, safeErrorCode: null, issues: []
};
const ready = {
  outcome: 'ready', previewToken, chapterNumber: 1,
  draft: { kind: 'adopted', label: 'Adopted revision 1', summary: 'The witness follows the signal.' },
  changes: [{ category: 'facts', summary: 'The witness identifies the building.', risk: 'high' }],
  warnings: ['Review the witness account before confirming.']
};
const committed = { outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: true };

describe('submission IPC requests', () => {
  test('accepts only project keys, task ids and explicit opaque-token confirmation', () => {
    for (const schema of [SubmissionStartCheckRequestSchema, SubmissionReadPreviewRequestSchema]) {
      expect(schema.parse({ projectKey })).toEqual({ projectKey });
    }
    for (const schema of [SubmissionGetRequestSchema, SubmissionCancelRequestSchema]) {
      expect(schema.parse({ taskId })).toEqual({ taskId });
    }
    expect(SubmissionConfirmRequestSchema.parse({ projectKey, previewToken, confirm: true })).toEqual({ projectKey, previewToken, confirm: true });
    expect(SubmissionStartCheckResultSchema.parse({ taskId })).toEqual({ taskId });
  });

  test.each(['path', 'projectRoot', 'provider', 'patch', 'command', 'chapterNumber', 'extra'])('rejects injected %s on every request', (key) => {
    for (const [schema, value] of [
      [SubmissionStartCheckRequestSchema, { projectKey }], [SubmissionReadPreviewRequestSchema, { projectKey }],
      [SubmissionGetRequestSchema, { taskId }], [SubmissionCancelRequestSchema, { taskId }],
      [SubmissionConfirmRequestSchema, { projectKey, previewToken, confirm: true }]
    ] as const) expect(schema.safeParse({ ...value, [key]: 'untrusted' }).success).toBe(false);
  });

  test.each(['', 'submission_short', `submission_${'A'.repeat(48)}`, `submission_${'a'.repeat(47)}`, `submission_${'a'.repeat(49)}`, ` ${previewToken}`])('rejects malformed token %j', (token) => {
    expect(SubmissionConfirmRequestSchema.safeParse({ projectKey, previewToken: token, confirm: true }).success).toBe(false);
  });
  test('rejects absent or false confirmation and invalid identities', () => {
    for (const confirm of [false, undefined, 'true', 1]) {
      expect(SubmissionConfirmRequestSchema.safeParse({ projectKey, previewToken, confirm }).success).toBe(false);
    }
    for (const key of ['', ' ', '/tmp/project', 'a'.repeat(129)]) {
      expect(SubmissionStartCheckRequestSchema.safeParse({ projectKey: key }).success).toBe(false);
    }
    for (const id of ['', ' ', '../task', 'a'.repeat(129)]) {
      expect(SubmissionGetRequestSchema.safeParse({ taskId: id }).success).toBe(false);
    }
  });
});

describe('submission author-facing results', () => {
  test('completed-journal preview reports completion without restoring authorization', () => {
    expect(SubmissionPreviewResultSchema.parse(committed)).toEqual(committed);
    expect(SubmissionPreviewResultSchema.safeParse({ ...committed, previewToken }).success).toBe(false);
    expect(SubmissionPreviewResultSchema.safeParse({ ...committed, latestCommittedChapter: 2 }).success).toBe(false);
  });
  test('represents chapter advancement explicitly without mislabeling it as a plot thread', () => {
    expect(SubmissionPreviewResultSchema.safeParse({
      ...ready, changes: [{ category: 'progress', summary: '正式提交进度从第 0 章推进到第 1 章。', risk: 'high' }]
    }).success).toBe(true);
  });
  test('accepts each preview and confirmation outcome without exposing engine records', () => {
    expect(SubmissionTaskSchema.parse(task)).toEqual(task);
    expect(SubmissionPreviewResultSchema.parse(ready)).toEqual(ready);
    for (const outcome of ['not_ready', 'stale', 'blocked']) {
      expect(SubmissionPreviewResultSchema.safeParse({
        outcome, messageKey: outcome === 'stale' ? 'submission.stale' : 'submission.not_ready', issues: [issue]
      }).success).toBe(true);
    }
    expect(SubmissionConfirmResultSchema.parse(committed)).toEqual(committed);
    for (const outcome of ['stale', 'busy', 'blocked', 'recovery_required']) {
      expect(SubmissionConfirmResultSchema.safeParse({ outcome, messageKey: `submission.${outcome}` }).success).toBe(true);
    }
    for (const category of ['facts', 'characters', 'timeline', 'plot_threads', 'narrative_debts', 'foreshadowing', 'reader_information', 'relationships', 'world_rules']) {
      expect(SubmissionPreviewResultSchema.safeParse({ ...ready, changes: [{ ...ready.changes[0], category }] }).success).toBe(true);
    }
  });

  test('rejects extra fields at every output level and credentials outside ready previews', () => {
    for (const [schema, value] of [
      [SubmissionStartCheckResultSchema, { taskId }], [SubmissionTaskSchema, task],
      [SubmissionPreviewResultSchema, ready], [SubmissionConfirmResultSchema, committed]
    ] as const) {
      for (const key of ['extra', 'sourcePath', 'patch', 'runId']) {
        expect(schema.safeParse({ ...value, [key]: 'internal' }).success).toBe(false);
      }
    }
    expect(SubmissionTaskSchema.safeParse({ ...task, issues: [{ ...issue, path: '/tmp/secret' }] }).success).toBe(false);
    expect(SubmissionPreviewResultSchema.safeParse({ ...ready, draft: { ...ready.draft, revisionId: 'secret' } }).success).toBe(false);
    expect(SubmissionPreviewResultSchema.safeParse({ ...ready, changes: [{ ...ready.changes[0], path: '/state/canonFacts' }] }).success).toBe(false);
    for (const outcome of ['not_ready', 'stale', 'blocked']) {
      expect(SubmissionPreviewResultSchema.safeParse({ outcome, messageKey: 'submission.stale', issues: [], previewToken }).success).toBe(false);
    }
    for (const outcome of ['stale', 'busy', 'blocked', 'recovery_required']) {
      expect(SubmissionConfirmResultSchema.safeParse({ outcome, messageKey: `submission.${outcome}`, hasNextChapter: true }).success).toBe(false);
    }
  });

  test.each(['/home/user/.codex/auth.json', 'chapters/chapter_001/draft_v1.md', 'run_secret', 'a'.repeat(64), 'provider: codex-text', '%2Fhome%2Fuser%2Fsecret', 'Bearer secret123', 'sk-SECRET'])('rejects internal or credential text %j', (text) => {
    expect(SubmissionPreviewResultSchema.safeParse({ ...ready, warnings: [text] }).success).toBe(false);
    expect(SubmissionPreviewResultSchema.safeParse({ ...ready, draft: { ...ready.draft, summary: text } }).success).toBe(false);
    expect(SubmissionPreviewResultSchema.safeParse({ ...ready, changes: [{ ...ready.changes[0], summary: text }] }).success).toBe(false);
    expect(SubmissionTaskSchema.safeParse({ ...task, issues: [{ ...issue, message: text }] }).success).toBe(false);
    expect(SubmissionTaskSchema.safeParse({ ...task, issues: [{ ...issue, evidence: text }] }).success).toBe(false);
  });

  test('requires ready evidence, consistent completion and bounded readable values', () => {
    for (const change of [
      { previewToken: undefined }, { chapterNumber: 0 }, { draft: undefined },
      { changes: undefined }, { warnings: undefined },
      { draft: { ...ready.draft, label: ' ' } }, { warnings: ['a'.repeat(2001)] },
      { changes: [{ ...ready.changes[0], risk: 'unknown' }] }
    ]) expect(SubmissionPreviewResultSchema.safeParse({ ...ready, ...change }).success).toBe(false);
    expect(SubmissionConfirmResultSchema.safeParse({ ...committed, latestCommittedChapter: 2 }).success).toBe(false);
    expect(SubmissionConfirmResultSchema.safeParse({ ...committed, chapterNumber: -1 }).success).toBe(false);
    expect(SubmissionConfirmResultSchema.safeParse({ outcome: 'blocked', messageKey: 'raw error /tmp/secret' }).success).toBe(false);
    expect(SubmissionTaskSchema.safeParse({ ...task, status: 'ready' }).success).toBe(false);
    expect(SubmissionTaskSchema.safeParse({ ...task, endedAt }).success).toBe(false);
    expect(SubmissionTaskSchema.safeParse({ ...task, status: 'ready', stage: 'validating_patch', endedAt }).success).toBe(true);
    expect(SubmissionTaskSchema.safeParse({ ...task, status: 'failed', endedAt, safeErrorCode: 'usage_limit', issues: [issue] }).success).toBe(true);
    expect(SubmissionTaskSchema.safeParse({ ...task, status: 'failed', endedAt }).success).toBe(false);
  });
});
