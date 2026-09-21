import { z } from 'zod';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_PAYLOAD_BYTES = 4 * 1024 * 1024;
const PLANNING_DOCUMENT_KINDS = ['global_outline', 'volume_outline'] as const;

export const PlanningProjectKeySchema = z.string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^project_[A-Za-z0-9_-]+$/);

export const PlanningTaskIdSchema = z.string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^planning_[0-9a-f]+$/);

export const PlanningTaskStatusSchema = z.enum([
  'queued',
  'running',
  'stop_requested',
  'succeeded',
  'failed',
  'cancelled'
]);

export const PlanningStageSchema = z.enum([
  'preparing',
  'global_outline',
  'volume_outline',
  'arc_map',
  'chapter_queue',
  'finalizing',
  'completed'
]);

export const PlanningErrorKindSchema = z.enum([
  'upgrade_required',
  'codex_unavailable',
  'login_required',
  'usage_limit',
  'timeout',
  'invalid_output',
  'foundation_missing',
  'project_unavailable',
  'already_complete',
  'generation_busy',
  'unexpected'
]);

const PlanningErrorSchema = z.object({
  kind: PlanningErrorKindSchema,
  message: z.string().trim().min(1).max(320)
}).strict();

export const PlanningTaskSchema = z.object({
  taskId: PlanningTaskIdSchema,
  projectKey: PlanningProjectKeySchema,
  status: PlanningTaskStatusSchema,
  stage: PlanningStageSchema,
  completedStages: z.array(PlanningStageSchema).max(7),
  startedAt: z.string().max(40).datetime(),
  updatedAt: z.string().max(40).datetime(),
  canCancel: z.boolean(),
  canRetry: z.boolean(),
  error: PlanningErrorSchema.nullable()
}).strict();

export const PlanningStartRequestSchema = z.object({
  projectKey: PlanningProjectKeySchema
}).strict();

export const PlanningGetRequestSchema = z.object({
  taskId: PlanningTaskIdSchema
}).strict();

export const PlanningCancelRequestSchema = PlanningGetRequestSchema;
export const PlanningReadRequestSchema = PlanningStartRequestSchema;

export const PlanningDocumentSchema = z.object({
  kind: z.enum(PLANNING_DOCUMENT_KINDS),
  title: z.string().trim().min(1).max(160),
  markdown: z.string()
    .max(MAX_MARKDOWN_BYTES)
    .refine(
      (markdown) => new TextEncoder().encode(markdown).byteLength <= MAX_MARKDOWN_BYTES,
      { message: 'Markdown exceeds the 2 MiB limit.' }
    )
}).strict();

export const PlanningArcSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(240),
  type: z.enum(['plot', 'character', 'relationship', 'world', 'theme']),
  summary: z.string().trim().min(1).max(8_000),
  startChapter: z.number().int().positive().optional(),
  targetEndChapter: z.number().int().positive().optional(),
  relatedCharacters: z.array(z.string().trim().min(1).max(160)).max(100)
}).strict();

export const PlanningChapterSchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  status: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(8_000),
  primaryFunction: z.string().trim().min(1).max(2_000)
}).strict();

export const PlanningReviewResultSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(false),
    reason: z.enum(['not_ready', 'project_unavailable'])
  }).strict(),
  z.object({
    available: z.literal(true),
    documents: z.array(PlanningDocumentSchema)
      .length(PLANNING_DOCUMENT_KINDS.length)
      .refine(
        (documents) => new Set(documents.map((document) => document.kind)).size === PLANNING_DOCUMENT_KINDS.length,
        { message: 'Review must contain exactly one document of each planning kind.' }
      ),
    arcs: z.array(PlanningArcSchema)
      .max(500)
      .refine((arcs) => new Set(arcs.map((arc) => arc.id)).size === arcs.length, {
        message: 'Review must not contain duplicate arcs.'
      }),
    chapters: z.array(PlanningChapterSchema)
      .max(2_000)
      .refine((chapters) => new Set(chapters.map((chapter) => chapter.chapterNumber)).size === chapters.length, {
        message: 'Review must not contain duplicate chapters.'
      })
  }).strict().superRefine((review, context) => {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(review)).byteLength;
    if (payloadBytes > MAX_REVIEW_PAYLOAD_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Review payload exceeds the 4 MiB total limit.'
      });
    }
  })
]);

export type PlanningTaskStatus = z.infer<typeof PlanningTaskStatusSchema>;
export type PlanningStage = z.infer<typeof PlanningStageSchema>;
export type PlanningErrorKind = z.infer<typeof PlanningErrorKindSchema>;
export type PlanningTask = z.infer<typeof PlanningTaskSchema>;
export type PlanningStartRequest = z.infer<typeof PlanningStartRequestSchema>;
export type PlanningGetRequest = z.infer<typeof PlanningGetRequestSchema>;
export type PlanningCancelRequest = z.infer<typeof PlanningCancelRequestSchema>;
export type PlanningReadRequest = z.infer<typeof PlanningReadRequestSchema>;
export type PlanningDocument = z.infer<typeof PlanningDocumentSchema>;
export type PlanningArc = z.infer<typeof PlanningArcSchema>;
export type PlanningChapter = z.infer<typeof PlanningChapterSchema>;
export type PlanningReviewResult = z.infer<typeof PlanningReviewResultSchema>;
