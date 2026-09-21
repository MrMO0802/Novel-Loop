import { containsAuthorFacingInternalValue } from 'novel-loop-engine/author-facing';
import { z } from 'zod';

const ProjectKeySchema = z.string().min(1).max(128).regex(/^project_[A-Za-z0-9_-]+$/u);
const TaskIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const ChapterNumberSchema = z.number().int().positive();
const TimestampSchema = z.string().max(40).datetime({ offset: true });

export const SubmissionPreviewTokenSchema = z.string().regex(/^submission_[a-f0-9]{48}$/u);
export const SubmissionStartCheckRequestSchema = z.object({ projectKey: ProjectKeySchema }).strict();
export const SubmissionReadPreviewRequestSchema = SubmissionStartCheckRequestSchema;
export const SubmissionGetRequestSchema = z.object({ taskId: TaskIdSchema }).strict();
export const SubmissionCancelRequestSchema = SubmissionGetRequestSchema;
export const SubmissionConfirmRequestSchema = z.object({
  projectKey: ProjectKeySchema,
  previewToken: SubmissionPreviewTokenSchema,
  confirm: z.literal(true)
}).strict();

export const SubmissionStageSchema = z.enum([
  'checking_source', 'diagnostics', 'proposing_patch', 'validating_patch'
]);
export const SubmissionStatusSchema = z.enum([
  'running', 'cancel_requested', 'cancelled', 'failed', 'blocked', 'ready', 'interrupted'
]);
export const SubmissionSafeErrorCodeSchema = z.enum([
  'upgrade_required', 'codex_unavailable', 'login_required', 'usage_limit', 'timeout',
  'invalid_output', 'project_unavailable', 'source_missing', 'source_stale',
  'working_copy_pending', 'plan_missing', 'already_committed', 'diagnostics_failed',
  'patch_conflict', 'generation_busy', 'unsafe_path', 'io_error', 'recovery_required',
  'interrupted', 'unexpected'
]);
export const SubmissionMessageKeySchema = z.enum([
  'submission.not_ready', 'submission.stale', 'submission.busy', 'submission.blocked',
  'submission.recovery_required', 'submission.working_copy_pending',
  'submission.plan_missing', 'submission.project_unavailable', 'submission.diagnostics_failed'
]);

export const SubmissionIssueSchema = z.object({
  severity: z.enum(['warning', 'error']),
  message: authorText(2_000),
  evidence: authorText(1_000).nullable()
}).strict();

export const SubmissionChangeSchema = z.object({
  category: z.enum([
    'facts', 'characters', 'timeline', 'plot_threads', 'narrative_debts',
    'foreshadowing', 'reader_information', 'relationships', 'world_rules', 'progress'
  ]),
  summary: authorText(4_000),
  risk: z.enum(['low', 'medium', 'high'])
}).strict();

export const SubmissionDraftSummarySchema = z.object({
  kind: z.enum(['generated', 'adopted']),
  label: authorText(240),
  summary: authorText(4_000)
}).strict();

export const SubmissionStartCheckResultSchema = z.object({ taskId: TaskIdSchema }).strict();
export const SubmissionTaskSchema = z.object({
  taskId: TaskIdSchema,
  projectKey: ProjectKeySchema,
  chapterNumber: ChapterNumberSchema,
  stage: SubmissionStageSchema,
  status: SubmissionStatusSchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable(),
  safeErrorCode: SubmissionSafeErrorCodeSchema.nullable(),
  issues: z.array(SubmissionIssueSchema).max(100)
}).strict().superRefine((task, context) => {
  const active = task.status === 'running' || task.status === 'cancel_requested';
  const error = task.status === 'failed' || task.status === 'blocked' || task.status === 'interrupted';
  if (active !== (task.endedAt === null) || (task.endedAt !== null && Date.parse(task.endedAt) < Date.parse(task.startedAt))) {
    context.addIssue({ code: 'custom', path: ['endedAt'], message: 'Terminal task timestamps must be consistent.' });
  }
  if (task.status === 'ready' && task.stage !== 'validating_patch') {
    context.addIssue({ code: 'custom', path: ['stage'], message: 'Ready tasks must have reached patch validation.' });
  }
  if (error !== (task.safeErrorCode !== null)) {
    context.addIssue({ code: 'custom', path: ['safeErrorCode'], message: 'Failed, blocked and interrupted tasks require a safe error code.' });
  }
});

export const SubmissionPreviewResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('committed'),
    chapterNumber: ChapterNumberSchema,
    latestCommittedChapter: ChapterNumberSchema,
    hasNextChapter: z.boolean()
  }).strict(),
  z.object({
    outcome: z.literal('ready'),
    previewToken: SubmissionPreviewTokenSchema,
    chapterNumber: ChapterNumberSchema,
    draft: SubmissionDraftSummarySchema,
    changes: z.array(SubmissionChangeSchema).max(1_000),
    warnings: z.array(authorText(2_000)).max(100)
  }).strict(),
  z.object({
    outcome: z.literal('not_ready'), messageKey: SubmissionMessageKeySchema,
    issues: z.array(SubmissionIssueSchema).max(100)
  }).strict(),
  z.object({
    outcome: z.literal('stale'), messageKey: SubmissionMessageKeySchema,
    issues: z.array(SubmissionIssueSchema).max(100)
  }).strict(),
  z.object({
    outcome: z.literal('blocked'), messageKey: SubmissionMessageKeySchema,
    issues: z.array(SubmissionIssueSchema).max(100)
  }).strict()
]).superRefine((result, context) => {
  if (result.outcome === 'committed' && result.chapterNumber !== result.latestCommittedChapter) {
    context.addIssue({ code: 'custom', path: ['latestCommittedChapter'], message: 'Completion must report exactly the chapter committed.' });
  }
});

export const SubmissionConfirmResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('committed'),
    chapterNumber: ChapterNumberSchema,
    latestCommittedChapter: ChapterNumberSchema,
    hasNextChapter: z.boolean()
  }).strict(),
  z.object({ outcome: z.literal('stale'), messageKey: SubmissionMessageKeySchema }).strict(),
  z.object({ outcome: z.literal('busy'), messageKey: SubmissionMessageKeySchema }).strict(),
  z.object({ outcome: z.literal('blocked'), messageKey: SubmissionMessageKeySchema }).strict(),
  z.object({ outcome: z.literal('recovery_required'), messageKey: SubmissionMessageKeySchema }).strict()
]).superRefine((result, context) => {
  if (result.outcome === 'committed' && result.chapterNumber !== result.latestCommittedChapter) {
    context.addIssue({ code: 'custom', path: ['latestCommittedChapter'], message: 'Confirmation must report exactly the chapter just committed.' });
  }
});

// Reject accidental internal data; main must still map errors and sanitize model text.
function authorText(max: number) {
  return z.string().trim().min(1).max(max).refine((text) => (
    !containsAuthorFacingInternalValue(text)
    && !/\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]+|submission_[a-f0-9]{48})\b/iu.test(text)
  ), 'Expected author-facing text without internal values or credentials.');
}

export type SubmissionStartCheckRequest = z.infer<typeof SubmissionStartCheckRequestSchema>;
export type SubmissionReadPreviewRequest = z.infer<typeof SubmissionReadPreviewRequestSchema>;
export type SubmissionGetRequest = z.infer<typeof SubmissionGetRequestSchema>;
export type SubmissionCancelRequest = z.infer<typeof SubmissionCancelRequestSchema>;
export type SubmissionConfirmRequest = z.infer<typeof SubmissionConfirmRequestSchema>;
export type SubmissionStage = z.infer<typeof SubmissionStageSchema>;
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;
export type SubmissionSafeErrorCode = z.infer<typeof SubmissionSafeErrorCodeSchema>;
export type SubmissionMessageKey = z.infer<typeof SubmissionMessageKeySchema>;
export type SubmissionIssue = z.infer<typeof SubmissionIssueSchema>;
export type SubmissionChange = z.infer<typeof SubmissionChangeSchema>;
export type SubmissionDraftSummary = z.infer<typeof SubmissionDraftSummarySchema>;
export type SubmissionStartCheckResult = z.infer<typeof SubmissionStartCheckResultSchema>;
export type SubmissionTask = z.infer<typeof SubmissionTaskSchema>;
export type SubmissionPreviewResult = z.infer<typeof SubmissionPreviewResultSchema>;
export type SubmissionConfirmResult = z.infer<typeof SubmissionConfirmResultSchema>;
