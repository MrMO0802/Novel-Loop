import { access, readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

import {
  DesktopSubmissionApprovalSchema,
  DesktopSubmissionPreviewSchema,
  DesktopSubmissionSourceSchema,
  DesktopSubmissionTaskSchema
} from '../../src/schemas/index.js';
import { readLatestAdoptedDraft } from '../../src/app/chapterAuthorRevision.js';
import { ChapterQueueSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { createDesktopSubmissionFixture } from '../helpers/desktopSubmissionFixture.js';

const hash = 'a'.repeat(64);
const startedAt = '2026-09-21T01:00:00.000Z';
const endedAt = '2026-09-21T01:00:01.000Z';
const reference = (path: string) => ({ path, hash });
const source = {
  projectId: 'submission-test', chapterNumber: 1,
  sourceKind: 'adopted',
  sourcePath: 'chapters/chapter_001/author_revisions/draft_revision_v1.md',
  sourceHash: hash, revisionId: 'author_revision_ch001_draft_v1',
  revisionRecord: reference('chapters/chapter_001/author_revisions/draft_revision_v1.json'),
  state: reference('state/story_state.json'),
  queue: reference('planning/chapter_queue.json'),
  mission: reference('chapters/chapter_001/mission.json'),
  selectedPlan: reference('chapters/chapter_001/selected_plan.md'),
  config: reference('config.json')
};
const previewRoot = 'chapters/chapter_001/submission_previews/preview_v1';
const preview = {
  schemaVersion: 1, previewId: 'submission_preview_001', version: 1,
  projectId: source.projectId, chapterNumber: 1, source,
  createdAt: endedAt, runId: 'run_submission_001', gatePassed: true,
  artifacts: {
    source: reference(`${previewRoot}/source.md`),
    diagnostics: reference(`${previewRoot}/diagnostics.json`),
    patchProposal: reference(`${previewRoot}/patch_proposal.json`),
    patch: reference(`${previewRoot}/normalized_patch.json`),
    conflict: reference(`${previewRoot}/conflict_report.json`),
    diff: reference(`${previewRoot}/state_diff.json`)
  }
};
const approval = {
  schemaVersion: 1, approvalId: 'submission_approval_001',
  previewId: preview.previewId, projectId: source.projectId, chapterNumber: 1,
  sourceHash: hash, manifestHash: hash, patchHash: hash, diffHash: hash,
  confirmed: true, approvedAt: endedAt, runId: preview.runId
};
const task = {
  schemaVersion: 1, taskId: 'submission_task_001', projectId: source.projectId,
  chapterNumber: 1, stage: 'validating_patch', status: 'ready',
  runId: preview.runId, previewId: preview.previewId,
  startedAt, endedAt, safeErrorCode: null
};

describe('desktop submission persisted schemas', () => {
  test('exports complete strict records and preserves exact evidence without defaults', () => {
    expect(DesktopSubmissionSourceSchema.parse(source)).toEqual(source);
    expect(DesktopSubmissionPreviewSchema.parse(preview)).toEqual(preview);
    expect(DesktopSubmissionApprovalSchema.parse(approval)).toEqual(approval);
    expect(DesktopSubmissionTaskSchema.parse(task)).toEqual(task);
    expect(DesktopSubmissionSourceSchema.parse({
      ...source, sourceKind: 'generated', revisionId: null, revisionRecord: null,
      sourcePath: 'chapters/chapter_001/draft_v1.md'
    }).revisionId).toBeNull();
  });

  test.each(['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)])('rejects invalid hash %s everywhere', (badHash) => {
    expect(DesktopSubmissionSourceSchema.safeParse({ ...source, sourceHash: badHash }).success).toBe(false);
    for (const key of ['state', 'queue', 'mission', 'selectedPlan', 'config', 'revisionRecord'] as const) {
      expect(DesktopSubmissionSourceSchema.safeParse({
        ...source, [key]: { ...source[key], hash: badHash }
      }).success).toBe(false);
    }
    for (const key of Object.keys(preview.artifacts) as (keyof typeof preview.artifacts)[]) {
      expect(DesktopSubmissionPreviewSchema.safeParse({
        ...preview, artifacts: { ...preview.artifacts, [key]: { ...preview.artifacts[key], hash: badHash } }
      }).success).toBe(false);
    }
    for (const key of ['sourceHash', 'manifestHash', 'patchHash', 'diffHash']) {
      expect(DesktopSubmissionApprovalSchema.safeParse({ ...approval, [key]: badHash }).success).toBe(false);
    }
  });

  test.each(['../escape', '/tmp/file', 'C:\\temp\\file', 'C:relative', '\\\\host\\file',
    './config.json', 'state/../config.json', 'state//file', 'state/', 'state/./file',
    'state/\u0000file', 'state/file\n', 'file:///tmp/file'])('rejects unsafe relative path %j', (badPath) => {
    expect(DesktopSubmissionSourceSchema.safeParse({ ...source, sourcePath: badPath }).success).toBe(false);
    for (const key of ['state', 'queue', 'mission', 'selectedPlan', 'config', 'revisionRecord'] as const) {
      expect(DesktopSubmissionSourceSchema.safeParse({
        ...source, [key]: reference(badPath)
      }).success).toBe(false);
    }
    expect(DesktopSubmissionPreviewSchema.safeParse({
      ...preview, artifacts: { ...preview.artifacts, diff: reference(badPath) }
    }).success).toBe(false);
  });

  test('rejects missing context, inconsistent draft identity and preview scope', () => {
    for (const key of ['state', 'queue', 'mission', 'selectedPlan', 'config'] as const) {
      expect(DesktopSubmissionSourceSchema.safeParse({ ...source, [key]: undefined }).success).toBe(false);
    }
    for (const change of [
      { sourceKind: 'generated' }, { revisionId: null }, { revisionRecord: null },
      { revisionRecord: reference('chapters/chapter_002/author_revisions/draft_revision_v1.json') },
      { revisionId: 'author_revision_ch002_draft_v1' },
      { revisionId: 'author_revision_ch001_plan_v1' },
      { sourcePath: 'chapters/chapter_001/draft_v1.md' }
    ]) expect(DesktopSubmissionSourceSchema.safeParse({ ...source, ...change }).success).toBe(false);
    for (const change of [
      { projectId: 'other-project' }, { chapterNumber: 2 }, { version: 0 },
      { version: 2 }, { gatePassed: false }, { schemaVersion: '1' },
      { artifacts: { ...preview.artifacts, source: { ...preview.artifacts.source, hash: 'b'.repeat(64) } } },
      { artifacts: { ...preview.artifacts, patch: reference('chapters/chapter_001/canon_patch.json') } },
      { artifacts: { ...preview.artifacts, diagnostics: undefined } }
    ]) expect(DesktopSubmissionPreviewSchema.safeParse({ ...preview, ...change }).success).toBe(false);
  });

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid chapter %s', (chapterNumber) => {
    for (const [schema, value] of [
      [DesktopSubmissionSourceSchema, source], [DesktopSubmissionPreviewSchema, preview],
      [DesktopSubmissionApprovalSchema, approval], [DesktopSubmissionTaskSchema, task]
    ] as const) expect(schema.safeParse({ ...value, chapterNumber }).success).toBe(false);
  });

  test('requires explicit approval and never persists a credential or extra fields', () => {
    expect(DesktopSubmissionApprovalSchema.safeParse({ ...approval, confirmed: false }).success).toBe(false);
    expect(DesktopSubmissionApprovalSchema.safeParse({ ...approval, confirmed: undefined }).success).toBe(false);
    for (const [schema, value] of [
      [DesktopSubmissionSourceSchema, source], [DesktopSubmissionPreviewSchema, preview],
      [DesktopSubmissionApprovalSchema, approval], [DesktopSubmissionTaskSchema, task]
    ] as const) {
      for (const key of ['extra', 'previewToken', 'token']) {
        expect(schema.safeParse({ ...value, [key]: 'secret' }).success).toBe(false);
      }
    }
    expect(DesktopSubmissionSourceSchema.safeParse({ ...source, state: { ...source.state, extra: true } }).success).toBe(false);
    expect(DesktopSubmissionPreviewSchema.safeParse({ ...preview, source: { ...source, extra: true } }).success).toBe(false);
    expect(DesktopSubmissionPreviewSchema.safeParse({ ...preview, artifacts: { ...preview.artifacts, extra: true } }).success).toBe(false);
    expect(DesktopSubmissionPreviewSchema.safeParse({
      ...preview, artifacts: { ...preview.artifacts, diff: { ...preview.artifacts.diff, extra: true } }
    }).success).toBe(false);
  });

  test('validates every stage and terminal status without publishing failed previews', () => {
    for (const stage of ['checking_source', 'diagnostics', 'proposing_patch', 'validating_patch']) {
      for (const status of ['running', 'cancel_requested']) {
        expect(DesktopSubmissionTaskSchema.safeParse({
          ...task, stage, status, previewId: null, endedAt: null
        }).success).toBe(true);
      }
    }
    for (const status of ['cancelled', 'failed', 'blocked', 'interrupted']) {
      expect(DesktopSubmissionTaskSchema.safeParse({
        ...task, status, previewId: null,
        safeErrorCode: status === 'cancelled' ? null : 'invalid_output'
      }).success).toBe(true);
      expect(DesktopSubmissionTaskSchema.safeParse({ ...task, status }).success).toBe(false);
    }
    expect(DesktopSubmissionTaskSchema.safeParse({
      ...task, stage: 'checking_source', status: 'running', runId: null, previewId: null, endedAt: null
    }).success).toBe(true);
  });

  test.each([
    { previewId: null }, { previewId: undefined }, { runId: null }, { endedAt: null },
    { endedAt: '2026-09-20T01:00:00Z' }, { startedAt: 'yesterday' },
    { stage: 'diagnostics' }, { status: 'committed' }, { safeErrorCode: 'raw error /tmp/auth' },
    { status: 'running' }, { status: 'failed', previewId: null, safeErrorCode: null }
  ])('rejects inconsistent task %j', (change) => {
    expect(DesktopSubmissionTaskSchema.safeParse({ ...task, ...change }).success).toBe(false);
  });
});

describe('desktop submission temporary project fixture', () => {
  test('generates A and adopts distinct B through real project APIs without committing', async () => {
    const fixture = await createDesktopSubmissionFixture();
    try {
      const { paths, store, originalText, adoptedText, revisionId } = fixture;
      expect(originalText).not.toContain('DESKTOP_SUBMISSION_ADOPTED_B');
      expect(adoptedText).toContain('DESKTOP_SUBMISSION_ADOPTED_B');
      expect(adoptedText).not.toBe(originalText);
      expect(await readFile(paths.chapterArtifact(1, 'draft_v1.md'))).toEqual(Buffer.from(originalText));
      const adopted = await readLatestAdoptedDraft({ projectRoot: fixture.projectRoot, chapterNumber: 1 });
      expect(adopted?.record.revisionId).toBe(revisionId);
      expect(adopted?.content).toBe(adoptedText);
      expect((await store.readJson(paths.storyState(), StoryStateSchema)).latestCommittedChapter).toBe(0);
      expect((await store.readJson(paths.chapterQueue(), ChapterQueueSchema)).chapters[0]?.status).not.toBe('committed');
      for (const file of ['mission.json', 'selected_plan.md']) {
        expect(await store.exists(paths.chapterArtifact(1, file))).toBe(true);
      }
      for (const file of ['final.md', 'canon_patch.json', 'commit_report.json', 'commit_journal_v1.json']) {
        expect(await store.exists(paths.chapterArtifact(1, file))).toBe(false);
      }
      expect(await readFile(fixture.fake.argsLogPath, 'utf8')).toContain('exec');
    } finally {
      await fixture.cleanup();
    }
    await expect(access(fixture.projectsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
