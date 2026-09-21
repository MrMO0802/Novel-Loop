import { z } from 'zod';

import { ProjectIdSchema } from './config.js';

const IdentifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const TimestampSchema = z.string().max(40).datetime({ offset: true });
const ChapterNumberSchema = z.number().int().positive();

// Lexical containment only; callers must still reject symlinks and verify real paths.
const RelativePathSchema = z.string().min(1).max(1024).refine((value) => (
  !/[\\:\u0000-\u001f\u007f]/u.test(value)
  && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
), 'Expected a canonical project-relative path.');

export const DesktopSubmissionArtifactReferenceSchema = z.object({
  path: RelativePathSchema,
  hash: Sha256Schema
}).strict();

export const DesktopSubmissionStageSchema = z.enum([
  'checking_source', 'diagnostics', 'proposing_patch', 'validating_patch'
]);
export const DesktopSubmissionStatusSchema = z.enum([
  'running', 'cancel_requested', 'cancelled', 'failed', 'blocked', 'ready', 'interrupted'
]);
export const DesktopSubmissionSafeErrorCodeSchema = z.enum([
  'upgrade_required', 'codex_unavailable', 'login_required', 'usage_limit', 'timeout',
  'invalid_output', 'project_unavailable', 'source_missing', 'source_stale',
  'working_copy_pending', 'plan_missing', 'already_committed', 'diagnostics_failed',
  'patch_conflict', 'generation_busy', 'unsafe_path', 'io_error', 'recovery_required',
  'interrupted', 'unexpected'
]);

export const DesktopSubmissionSourceSchema = z.object({
  projectId: ProjectIdSchema,
  chapterNumber: ChapterNumberSchema,
  sourceKind: z.enum(['generated', 'adopted']),
  sourcePath: RelativePathSchema,
  sourceHash: Sha256Schema,
  revisionId: IdentifierSchema.nullable(),
  revisionRecord: DesktopSubmissionArtifactReferenceSchema.nullable(),
  state: DesktopSubmissionArtifactReferenceSchema,
  queue: DesktopSubmissionArtifactReferenceSchema,
  mission: DesktopSubmissionArtifactReferenceSchema,
  selectedPlan: DesktopSubmissionArtifactReferenceSchema,
  config: DesktopSubmissionArtifactReferenceSchema,
  additionalInputs: z.array(DesktopSubmissionArtifactReferenceSchema).max(4096).optional()
}).strict().superRefine((source, context) => {
  const chapter = String(source.chapterNumber).padStart(3, '0');
  const chapterRoot = `chapters/chapter_${chapter}`;
  if (source.sourceKind === 'generated') {
    if (source.revisionId !== null || source.revisionRecord !== null
      || source.sourcePath !== `${chapterRoot}/draft_v1.md`) {
      context.addIssue({ code: 'custom', path: ['sourcePath'], message: 'Generated sources must bind the original draft without a revision.' });
    }
  } else {
    const match = /^author_revision_ch(\d{3,})_draft_v([1-9]\d*)$/u.exec(source.revisionId ?? '');
    const revisionRoot = `${chapterRoot}/author_revisions/draft_revision_v${match?.[2]}`;
    if (match?.[1] !== chapter || source.sourcePath !== `${revisionRoot}.md`
      || source.revisionRecord?.path !== `${revisionRoot}.json`) {
      context.addIssue({ code: 'custom', path: ['revisionId'], message: 'Adopted sources must bind matching chapter draft content and revision record.' });
    }
  }
});

export const DesktopSubmissionPreviewSchema = z.object({
  schemaVersion: z.literal(1),
  previewId: IdentifierSchema,
  version: z.number().int().positive(),
  projectId: ProjectIdSchema,
  chapterNumber: ChapterNumberSchema,
  source: DesktopSubmissionSourceSchema,
  createdAt: TimestampSchema,
  runId: IdentifierSchema,
  artifacts: z.object({
    source: DesktopSubmissionArtifactReferenceSchema,
    diagnostics: DesktopSubmissionArtifactReferenceSchema,
    patchProposal: DesktopSubmissionArtifactReferenceSchema,
    patch: DesktopSubmissionArtifactReferenceSchema,
    conflict: DesktopSubmissionArtifactReferenceSchema,
    diff: DesktopSubmissionArtifactReferenceSchema
  }).strict(),
  gatePassed: z.literal(true)
}).strict().superRefine((preview, context) => {
  if (preview.source.projectId !== preview.projectId || preview.source.chapterNumber !== preview.chapterNumber) {
    context.addIssue({ code: 'custom', path: ['source'], message: 'Preview and source scopes must match.' });
  }
  const root = `chapters/chapter_${String(preview.chapterNumber).padStart(3, '0')}/submission_previews/preview_v${preview.version}`;
  const files = {
    source: 'source.md', diagnostics: 'diagnostics.json', patchProposal: 'patch_proposal.json',
    patch: 'normalized_patch.json', conflict: 'conflict_report.json', diff: 'state_diff.json'
  } as const;
  for (const key of Object.keys(files) as (keyof typeof files)[]) {
    if (preview.artifacts[key].path !== `${root}/${files[key]}`) {
      context.addIssue({ code: 'custom', path: ['artifacts', key, 'path'], message: 'Preview artifacts must belong to this isolated chapter version.' });
    }
  }
  if (preview.artifacts.source.hash !== preview.source.sourceHash) {
    context.addIssue({ code: 'custom', path: ['artifacts', 'source', 'hash'], message: 'Preview text must match the exact captured source.' });
  }
});

export const DesktopSubmissionApprovalSchema = z.object({
  schemaVersion: z.literal(1),
  approvalId: IdentifierSchema,
  previewId: IdentifierSchema,
  projectId: ProjectIdSchema,
  chapterNumber: ChapterNumberSchema,
  sourceHash: Sha256Schema,
  manifestHash: Sha256Schema,
  patchHash: Sha256Schema,
  diffHash: Sha256Schema,
  confirmed: z.literal(true),
  approvedAt: TimestampSchema,
  runId: IdentifierSchema
}).strict();

export const DesktopSubmissionTaskSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: IdentifierSchema,
  projectId: ProjectIdSchema,
  chapterNumber: ChapterNumberSchema,
  stage: DesktopSubmissionStageSchema,
  status: DesktopSubmissionStatusSchema,
  runId: IdentifierSchema.nullable(),
  previewId: IdentifierSchema.nullable(),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable(),
  safeErrorCode: DesktopSubmissionSafeErrorCodeSchema.nullable()
}).strict().superRefine((task, context) => {
  const active = task.status === 'running' || task.status === 'cancel_requested';
  const ready = task.status === 'ready';
  const error = task.status === 'failed' || task.status === 'blocked' || task.status === 'interrupted';
  if (active !== (task.endedAt === null) || (task.endedAt !== null && Date.parse(task.endedAt) < Date.parse(task.startedAt))) {
    context.addIssue({ code: 'custom', path: ['endedAt'], message: 'Only terminal tasks have an end time, at or after their start.' });
  }
  if (ready !== (task.previewId !== null) || (ready && (task.runId === null || task.stage !== 'validating_patch'))) {
    context.addIssue({ code: 'custom', path: ['previewId'], message: 'Only ready tasks publish a preview after patch validation with run provenance.' });
  }
  if (error !== (task.safeErrorCode !== null)) {
    context.addIssue({ code: 'custom', path: ['safeErrorCode'], message: 'Failed, blocked and interrupted tasks require a safe error code.' });
  }
});

export type DesktopSubmissionArtifactReference = z.infer<typeof DesktopSubmissionArtifactReferenceSchema>;
export type DesktopSubmissionStage = z.infer<typeof DesktopSubmissionStageSchema>;
export type DesktopSubmissionStatus = z.infer<typeof DesktopSubmissionStatusSchema>;
export type DesktopSubmissionSafeErrorCode = z.infer<typeof DesktopSubmissionSafeErrorCodeSchema>;
export type DesktopSubmissionSource = z.infer<typeof DesktopSubmissionSourceSchema>;
export type DesktopSubmissionPreview = z.infer<typeof DesktopSubmissionPreviewSchema>;
export type DesktopSubmissionApproval = z.infer<typeof DesktopSubmissionApprovalSchema>;
export type DesktopSubmissionTask = z.infer<typeof DesktopSubmissionTaskSchema>;
