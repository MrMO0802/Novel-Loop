import { z } from 'zod';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

export const ProjectKeySchema = z.string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^project_[A-Za-z0-9_-]+$/);

export const FoundationTaskIdSchema = z.string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^foundation_[A-Za-z0-9_-]+$/);

export const FoundationTaskStatusSchema = z.enum([
  'queued',
  'running',
  'stop_requested',
  'succeeded',
  'failed',
  'cancelled'
]);

export const FoundationStageSchema = z.enum([
  'preparing',
  'story_bible',
  'genre_contract',
  'reader_promise',
  'style_guide',
  'finalizing',
  'completed'
]);

export const FoundationErrorKindSchema = z.enum([
  'codex_unavailable',
  'login_required',
  'usage_limit',
  'timeout',
  'invalid_output',
  'project_unavailable',
  'already_complete',
  'unexpected'
]);

const FoundationErrorSchema = z.object({
  kind: FoundationErrorKindSchema,
  message: z.string().trim().min(1).max(320)
}).strict();

export const FoundationTaskSchema = z.object({
  taskId: FoundationTaskIdSchema,
  projectKey: ProjectKeySchema,
  status: FoundationTaskStatusSchema,
  stage: FoundationStageSchema,
  completedStages: z.array(FoundationStageSchema).max(7),
  startedAt: z.string().max(40).datetime(),
  updatedAt: z.string().max(40).datetime(),
  canCancel: z.boolean(),
  canRetry: z.boolean(),
  error: FoundationErrorSchema.nullable()
}).strict();

export const FoundationStartRequestSchema = z.object({
  projectKey: ProjectKeySchema
}).strict();

export const FoundationGetRequestSchema = z.object({
  taskId: FoundationTaskIdSchema
}).strict();

export const FoundationCancelRequestSchema = FoundationGetRequestSchema;
export const FoundationReadRequestSchema = FoundationStartRequestSchema;

export const FoundationDocumentSchema = z.object({
  kind: z.enum([
    'story_bible',
    'genre_contract',
    'reader_promise',
    'style_guide'
  ]),
  title: z.string().trim().min(1).max(160),
  markdown: z.string()
    .max(MAX_MARKDOWN_BYTES)
    .refine(
      (markdown) => new TextEncoder().encode(markdown).byteLength <= MAX_MARKDOWN_BYTES,
      { message: 'Markdown exceeds the 2 MiB limit.' }
    )
}).strict();

export const FoundationReviewResultSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(false),
    reason: z.enum(['not_ready', 'project_unavailable'])
  }).strict(),
  z.object({
    available: z.literal(true),
    documents: z.array(FoundationDocumentSchema).length(4)
  }).strict()
]);

export type FoundationTaskStatus = z.infer<typeof FoundationTaskStatusSchema>;
export type FoundationStage = z.infer<typeof FoundationStageSchema>;
export type FoundationErrorKind = z.infer<typeof FoundationErrorKindSchema>;
export type FoundationTask = z.infer<typeof FoundationTaskSchema>;
export type FoundationStartRequest = z.infer<typeof FoundationStartRequestSchema>;
export type FoundationGetRequest = z.infer<typeof FoundationGetRequestSchema>;
export type FoundationCancelRequest = z.infer<typeof FoundationCancelRequestSchema>;
export type FoundationReadRequest = z.infer<typeof FoundationReadRequestSchema>;
export type FoundationDocument = z.infer<typeof FoundationDocumentSchema>;
export type FoundationReviewResult = z.infer<typeof FoundationReviewResultSchema>;
