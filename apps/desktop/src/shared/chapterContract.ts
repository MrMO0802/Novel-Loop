import { z } from 'zod';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_ALTERNATIVES = 10;
const MAX_MISSION_ITEMS = 100;
const MAX_SCENES = 100;

export const ChapterProjectKeySchema = z.string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^project_[A-Za-z0-9_-]+$/);

export const ChapterTaskIdSchema = z.string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^chapter_[A-Za-z0-9_-]+$/);

export const ChapterProjectRequestSchema = z.object({
  projectKey: ChapterProjectKeySchema
}).strict();

export const ChapterTaskRequestSchema = z.object({
  taskId: ChapterTaskIdSchema
}).strict();

export const ChapterInspectRequestSchema = ChapterProjectRequestSchema;
export const ChapterStartRequestSchema = ChapterProjectRequestSchema;
export const ChapterStartPlanningRequestSchema = ChapterStartRequestSchema;
export const ChapterStartDraftingRequestSchema = ChapterStartRequestSchema;
export const ChapterGetRequestSchema = ChapterTaskRequestSchema;
export const ChapterCancelRequestSchema = ChapterTaskRequestSchema;
export const ChapterReadPlanRequestSchema = ChapterProjectRequestSchema;
export const ChapterReadDraftRequestSchema = ChapterProjectRequestSchema;

export const ChapterTaskKindSchema = z.enum(['planning', 'drafting']);

export const ChapterTaskStatusSchema = z.enum([
  'queued',
  'running',
  'stop_requested',
  'succeeded',
  'failed',
  'cancelled'
]);

export const ChapterTaskStageSchema = z.enum([
  'preparing',
  'mission',
  'plan_candidates',
  'ranking',
  'scene_cards',
  'scene_drafts',
  'draft_assembly',
  'finalizing',
  'completed'
]);

export const ChapterErrorKindSchema = z.enum([
  'codex_unavailable',
  'login_required',
  'usage_limit',
  'timeout',
  'invalid_output',
  'plan_missing',
  'project_unavailable',
  'stale_chapter',
  'already_complete',
  'generation_busy',
  'unexpected'
]);

const ChapterErrorSchema = z.object({
  kind: ChapterErrorKindSchema,
  message: z.string().trim().min(1).max(320)
}).strict();

export const ChapterSceneProgressSchema = z.object({
  current: z.number().int().positive(),
  total: z.number().int().positive()
}).strict().refine(
  ({ current, total }) => current <= total,
  { message: 'Scene progress cannot exceed the scene total.' }
);

export const ChapterTaskSchema = z.object({
  taskId: ChapterTaskIdSchema,
  projectKey: ChapterProjectKeySchema,
  kind: ChapterTaskKindSchema,
  chapterNumber: z.number().int().positive(),
  status: ChapterTaskStatusSchema,
  stage: ChapterTaskStageSchema,
  completedStages: z.array(ChapterTaskStageSchema)
    .max(ChapterTaskStageSchema.options.length)
    .refine(
      (stages) => new Set(stages).size === stages.length,
      { message: 'Completed chapter stages must be unique.' }
    ),
  sceneProgress: ChapterSceneProgressSchema.nullable(),
  startedAt: z.string().max(40).datetime(),
  updatedAt: z.string().max(40).datetime(),
  canCancel: z.boolean(),
  canRetry: z.boolean(),
  error: ChapterErrorSchema.nullable()
}).strict();

export const ChapterPhaseSchema = z.enum([
  'not_started',
  'planning_partial',
  'plan_ready',
  'drafting_partial',
  'draft_ready'
]);

export const ChapterInspectionSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(false),
    reason: z.enum([
      'global_plan_missing',
      'chapter_missing',
      'project_unavailable',
      'stale_chapter',
      'invalid_output'
    ])
  }).strict(),
  z.object({
    available: z.literal(true),
    chapterNumber: z.number().int().positive(),
    title: boundedText(240),
    phase: ChapterPhaseSchema
  }).strict()
]);

const ChapterMissionReviewSchema = z.object({
  chapterFunction: boundedText(8_000),
  objectives: boundedTextArray(MAX_MISSION_ITEMS, 8_000),
  readerKnowledge: boundedTextArray(MAX_MISSION_ITEMS, 8_000),
  readerQuestions: boundedTextArray(MAX_MISSION_ITEMS, 8_000),
  forbiddenMoves: boundedTextArray(MAX_MISSION_ITEMS, 8_000)
}).strict();

const ChapterPlanDocumentSchema = z.object({
  title: boundedText(240),
  markdown: markdownSchema()
}).strict();

const ChapterPlanAlternativeSchema = z.object({
  title: boundedText(240),
  excerpt: z.string().max(8_000),
  strengths: boundedTextArray(MAX_MISSION_ITEMS, 2_000),
  risks: boundedTextArray(MAX_MISSION_ITEMS, 2_000)
}).strict();

export const ChapterPlanReviewResultSchema = z.discriminatedUnion('available', [
  unavailableReviewSchema(),
  z.object({
    available: z.literal(true),
    chapterNumber: z.number().int().positive(),
    title: boundedText(240),
    mission: ChapterMissionReviewSchema,
    selectedPlan: ChapterPlanDocumentSchema,
    alternatives: z.array(ChapterPlanAlternativeSchema).max(MAX_ALTERNATIVES)
  }).strict().superRefine(enforceReviewPayloadLimit)
]);

const ChapterSceneReviewSchema = z.object({
  summary: boundedText(8_000)
}).strict();

export const ChapterDraftReviewResultSchema = z.discriminatedUnion('available', [
  unavailableReviewSchema(),
  z.object({
    available: z.literal(true),
    chapterNumber: z.number().int().positive(),
    title: boundedText(240),
    markdown: markdownSchema(),
    scenes: z.array(ChapterSceneReviewSchema).max(MAX_SCENES)
  }).strict().superRefine(enforceReviewPayloadLimit)
]);

export type ChapterTaskKind = z.infer<typeof ChapterTaskKindSchema>;
export type ChapterProjectRequest = z.infer<
  typeof ChapterProjectRequestSchema
>;
export type ChapterTaskRequest = z.infer<typeof ChapterTaskRequestSchema>;
export type ChapterInspectRequest = z.infer<
  typeof ChapterInspectRequestSchema
>;
export type ChapterStartRequest = z.infer<typeof ChapterStartRequestSchema>;
export type ChapterStartPlanningRequest = z.infer<
  typeof ChapterStartPlanningRequestSchema
>;
export type ChapterStartDraftingRequest = z.infer<
  typeof ChapterStartDraftingRequestSchema
>;
export type ChapterGetRequest = z.infer<typeof ChapterGetRequestSchema>;
export type ChapterCancelRequest = z.infer<typeof ChapterCancelRequestSchema>;
export type ChapterReadPlanRequest = z.infer<
  typeof ChapterReadPlanRequestSchema
>;
export type ChapterReadDraftRequest = z.infer<
  typeof ChapterReadDraftRequestSchema
>;
export type ChapterTaskStatus = z.infer<typeof ChapterTaskStatusSchema>;
export type ChapterTaskStage = z.infer<typeof ChapterTaskStageSchema>;
export type ChapterErrorKind = z.infer<typeof ChapterErrorKindSchema>;
export type ChapterSceneProgress = z.infer<typeof ChapterSceneProgressSchema>;
export type ChapterTask = z.infer<typeof ChapterTaskSchema>;
export type ChapterPhase = z.infer<typeof ChapterPhaseSchema>;
export type ChapterInspection = z.infer<typeof ChapterInspectionSchema>;
export type ChapterPlanReviewResult = z.infer<
  typeof ChapterPlanReviewResultSchema
>;
export type ChapterDraftReviewResult = z.infer<
  typeof ChapterDraftReviewResultSchema
>;

function boundedText(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

function boundedTextArray(maxItems: number, maxLength: number) {
  return z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);
}

function markdownSchema() {
  return z.string()
    .max(MAX_MARKDOWN_BYTES)
    .refine(
      (markdown) => new TextEncoder().encode(markdown).byteLength
        <= MAX_MARKDOWN_BYTES,
      { message: 'Markdown exceeds the 2 MiB limit.' }
    );
}

function unavailableReviewSchema() {
  return z.object({
    available: z.literal(false),
    reason: z.enum(['not_ready', 'project_unavailable'])
  }).strict();
}

function enforceReviewPayloadLimit(
  review: unknown,
  context: z.RefinementCtx
): void {
  if (
    new TextEncoder().encode(JSON.stringify(review)).byteLength
      > MAX_REVIEW_PAYLOAD_BYTES
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Chapter review exceeds the 4 MiB total limit.'
    });
  }
}
