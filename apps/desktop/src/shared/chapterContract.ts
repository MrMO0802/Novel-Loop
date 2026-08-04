import { z } from 'zod';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_ALTERNATIVES = 10;
const MAX_MISSION_ITEMS = 100;
const MAX_PARTICIPANTS = 32;
const MAX_SCENES = 100;

export const ChapterReviewTokenSchema = opaqueToken('chapter_review');
export const ChapterOptionTokenSchema = opaqueToken('chapter_option');
export const ChapterRevisionTokenSchema = opaqueToken('chapter_revision');

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

export const ChapterSelectDirectionRequestSchema = z.object({
  projectKey: ChapterProjectKeySchema,
  reviewToken: ChapterReviewTokenSchema,
  optionToken: ChapterOptionTokenSchema
}).strict();

export const ChapterSavePlanWorkingCopyRequestSchema = z.object({
  projectKey: ChapterProjectKeySchema,
  reviewToken: ChapterReviewTokenSchema,
  optionToken: ChapterOptionTokenSchema,
  markdown: markdownSchema()
}).strict();

const ChapterObjectiveTypeSchema = z.enum([
  'plot',
  'character',
  'relationship',
  'world',
  'debt',
  'foreshadowing',
  'reader'
]);

const ChapterObjectivePrioritySchema = z.enum(['must', 'should', 'could']);

const ChapterDebtTypeSchema = z.enum([
  'mystery',
  'character',
  'relationship',
  'power',
  'revenge',
  'theme',
  'world',
  'promise'
]);

const ChapterReaderInformationSchema = z.object({
  newKnowledge: boundedTextArray(MAX_MISSION_ITEMS, 8_000),
  newSuspicions: boundedTextArray(MAX_MISSION_ITEMS, 8_000),
  questionsToMaintain: boundedTextArray(MAX_MISSION_ITEMS, 8_000),
  questionsToAnswer: boundedTextArray(MAX_MISSION_ITEMS, 8_000)
}).strict();

const ChapterMissionWorkingCopySchema = z.object({
  chapterFunction: boundedText(8_000),
  requiredObjectives: z.array(z.object({
    itemToken: ChapterOptionTokenSchema.nullable(),
    text: boundedText(8_000),
    type: ChapterObjectiveTypeSchema,
    priority: ChapterObjectivePrioritySchema
  }).strict()).max(MAX_MISSION_ITEMS),
  debtTokens: uniqueTokenArray(MAX_MISSION_ITEMS),
  debtsToIntroduce: z.array(z.object({
    type: ChapterDebtTypeSchema,
    promise: boundedText(2_000),
    importance: z.number().min(1).max(10)
  }).strict()).max(MAX_MISSION_ITEMS),
  characterDeltas: z.array(z.object({
    participantToken: ChapterOptionTokenSchema,
    from: boundedText(2_000),
    to: boundedText(2_000),
    evidenceRequired: boundedText(2_000)
  }).strict()).max(MAX_MISSION_ITEMS),
  participantTokens: uniqueTokenArray(MAX_PARTICIPANTS),
  newParticipants: z.array(z.object({
    name: boundedText(120),
    role: boundedText(120)
  }).strict()).max(8),
  readerInformation: ChapterReaderInformationSchema,
  forbiddenMoves: boundedTextArray(MAX_MISSION_ITEMS, 8_000),
  targetEmotionalCurve: boundedTextArray(MAX_MISSION_ITEMS, 2_000),
  targetWordCount: z.number().int().positive().max(1_000_000).nullable()
}).strict();

export const ChapterSaveMissionWorkingCopyRequestSchema = z.object({
  projectKey: ChapterProjectKeySchema,
  reviewToken: ChapterReviewTokenSchema,
  mission: ChapterMissionWorkingCopySchema
}).strict();

export const ChapterAdoptRevisionRequestSchema = z.object({
  projectKey: ChapterProjectKeySchema,
  revisionToken: ChapterRevisionTokenSchema,
  confirmInvalidation: z.literal(true)
}).strict();

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
  message: boundedText(320)
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
  narrativePromises: authorTextArray(MAX_MISSION_ITEMS, 2_000),
  characterDeltas: authorTextArray(MAX_MISSION_ITEMS, 2_000),
  forbiddenMoves: boundedTextArray(MAX_MISSION_ITEMS, 8_000),
  objectiveItems: z.array(z.object({
    itemToken: ChapterOptionTokenSchema,
    text: boundedText(8_000),
    type: ChapterObjectiveTypeSchema,
    priority: ChapterObjectivePrioritySchema
  }).strict()).max(MAX_MISSION_ITEMS),
  debtItems: z.array(z.object({
    itemToken: ChapterOptionTokenSchema,
    promise: boundedText(2_000)
  }).strict()).max(MAX_MISSION_ITEMS),
  introducedDebts: z.array(z.object({
    type: ChapterDebtTypeSchema,
    promise: boundedText(2_000),
    importance: z.number().min(1).max(10)
  }).strict()).max(MAX_MISSION_ITEMS),
  characterDeltaItems: z.array(z.object({
    participantToken: ChapterOptionTokenSchema,
    participantName: boundedText(120),
    from: boundedText(2_000),
    to: boundedText(2_000),
    evidenceRequired: boundedText(2_000)
  }).strict()).max(MAX_MISSION_ITEMS),
  participantOptions: z.array(z.object({
    participantToken: ChapterOptionTokenSchema,
    name: boundedText(120),
    role: boundedText(120),
    selected: z.boolean()
  }).strict()).max(MAX_PARTICIPANTS),
  readerInformation: ChapterReaderInformationSchema,
  targetEmotionalCurve: boundedTextArray(MAX_MISSION_ITEMS, 2_000),
  targetWordCount: z.number().int().positive().max(1_000_000).nullable()
}).strict();

const ChapterPlanDocumentSchema = z.object({
  title: boundedText(240),
  markdown: markdownSchema()
}).strict();

const ChapterPlanAlternativeSchema = z.object({
  title: boundedText(240),
  excerpt: boundedExcerpt(8_000),
  strengths: boundedTextArray(MAX_MISSION_ITEMS, 2_000),
  risks: boundedTextArray(MAX_MISSION_ITEMS, 2_000)
}).strict();

export const ChapterPlanDirectionSchema = z.object({
  optionToken: ChapterOptionTokenSchema,
  title: boundedText(240),
  markdown: markdownSchema(),
  excerpt: boundedExcerpt(8_000),
  strengths: boundedTextArray(MAX_MISSION_ITEMS, 2_000),
  risks: boundedTextArray(MAX_MISSION_ITEMS, 2_000),
  aiRecommended: z.boolean(),
  active: z.boolean()
}).strict();

export const ChapterPlanReviewResultSchema = z.discriminatedUnion('available', [
  unavailableReviewSchema(),
  z.object({
    available: z.literal(true),
    chapterNumber: z.number().int().positive(),
    title: boundedText(240),
    reviewToken: ChapterReviewTokenSchema,
    mission: ChapterMissionReviewSchema,
    selectedPlan: ChapterPlanDocumentSchema,
    alternatives: z.array(ChapterPlanAlternativeSchema).max(MAX_ALTERNATIVES),
    directions: z.array(ChapterPlanDirectionSchema)
      .min(1)
      .max(MAX_ALTERNATIVES)
  }).strict().superRefine(enforcePlanReview)
]);

export const ChapterAuthoringMessageKeySchema = z.enum([
  'stale_edit',
  'participant_roster_missing',
  'invalid_output',
  'generation_busy',
  'project_unavailable'
]);

export const ChapterAuthoringResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('saved'),
    revisionToken: ChapterRevisionTokenSchema
  }).strict(),
  z.object({ outcome: z.literal('adopted') }).strict(),
  z.object({
    outcome: z.literal('stale'),
    messageKey: z.literal('stale_edit')
  }).strict(),
  z.object({
    outcome: z.literal('blocked'),
    messageKey: z.enum([
      'participant_roster_missing',
      'generation_busy'
    ])
  }).strict(),
  z.object({
    outcome: z.literal('invalid'),
    messageKey: z.enum(['invalid_output', 'project_unavailable'])
  }).strict()
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
export type ChapterSelectDirectionRequest = z.infer<
  typeof ChapterSelectDirectionRequestSchema
>;
export type ChapterSaveMissionWorkingCopyRequest = z.infer<
  typeof ChapterSaveMissionWorkingCopyRequestSchema
>;
export type ChapterSavePlanWorkingCopyRequest = z.infer<
  typeof ChapterSavePlanWorkingCopyRequestSchema
>;
export type ChapterAdoptRevisionRequest = z.infer<
  typeof ChapterAdoptRevisionRequestSchema
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
export type ChapterAuthoringMessageKey = z.infer<
  typeof ChapterAuthoringMessageKeySchema
>;
export type ChapterAuthoringResult = z.infer<
  typeof ChapterAuthoringResultSchema
>;

function boundedText(maxLength: number) {
  return z.string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((text) => !containsInternalValue(text), {
      message: 'Author-facing text contains an internal value.'
    });
}

function boundedTextArray(maxItems: number, maxLength: number) {
  return z.array(boundedText(maxLength)).max(maxItems);
}

function authorTextArray(maxItems: number, maxLength: number) {
  return boundedTextArray(maxItems, maxLength);
}

function boundedExcerpt(maxLength: number) {
  return z.string()
    .trim()
    .max(maxLength)
    .refine((text) => !containsInternalValue(text), {
      message: 'Author-facing excerpt contains an internal value.'
    });
}

function markdownSchema() {
  return z.string()
    .max(MAX_MARKDOWN_BYTES)
    .refine(
      (markdown) => new TextEncoder().encode(markdown).byteLength
        <= MAX_MARKDOWN_BYTES,
      { message: 'Markdown exceeds the 2 MiB limit.' }
    )
    .refine(
      (markdown) => !containsInternalValue(markdown),
      { message: 'Markdown contains an internal value.' }
    );
}

function opaqueToken(prefix: string) {
  return z.string().regex(
    new RegExp(`^${prefix}_[a-f0-9]{48}$`, 'u')
  );
}

function uniqueTokenArray(maxItems: number) {
  return z.array(ChapterOptionTokenSchema)
    .max(maxItems)
    .refine((tokens) => new Set(tokens).size === tokens.length, {
      message: 'Opaque item tokens must be unique.'
    });
}

function unavailableReviewSchema() {
  return z.object({
    available: z.literal(false),
    reason: z.enum(['not_ready', 'invalid_output', 'project_unavailable'])
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

function enforcePlanReview(
  review: {
    directions: Array<{
      optionToken: string;
      aiRecommended: boolean;
      active: boolean;
    }>;
  },
  context: z.RefinementCtx
): void {
  if (review.directions.filter(({ aiRecommended }) => aiRecommended).length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['directions'],
      message: 'Exactly one direction must be AI-recommended.'
    });
  }
  if (review.directions.filter(({ active }) => active).length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['directions'],
      message: 'Exactly one direction must be active.'
    });
  }
  if (
    new Set(review.directions.map(({ optionToken }) => optionToken)).size
      !== review.directions.length
  ) {
    context.addIssue({
      code: 'custom',
      path: ['directions'],
      message: 'Direction option tokens must be unique.'
    });
  }
  enforceReviewPayloadLimit(review, context);
}

function containsInternalValue(text: string): boolean {
  const normalized = normalizeLeakageText(text);
  const withoutWebUrls = normalized.replace(
    /\bhttps?:\/\/[^\s<>{}\[\]"']+/giu,
    ' '
  );
  return (
    /\bfile:\/\//iu.test(normalized)
    ||
    /(?:^|[\s([{"'=])\/(?!\/)[^\s<>{}\[\]]+/u.test(withoutWebUrls)
    || /(?:^|[\s([{"'=])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/])[^\s<>{}\[\]]*/u
      .test(withoutWebUrls)
    || /(?:^|[\s([{"'=])(?:\.{1,2}[\\/])?(?:[A-Za-z0-9_.-]+[\\/])+(?:[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,12})(?=$|[\s)\]}>.,;:!?])/u
      .test(withoutWebUrls)
    || /(?:^|[\s([{"'=])(?:[A-Za-z0-9_.-]+[\\/]){2,}[A-Za-z0-9_.-]+(?=$|[\s)\]}>.,;:!?])/u
      .test(withoutWebUrls)
    || /\b(?:author_revision|candidate|chapter|character|char|debt|event|mission|objective|obj|plan|revision|run|scene|task)_[A-Za-z0-9][A-Za-z0-9_-]*\b/iu
      .test(normalized)
    || /\b[a-f0-9]{64}\b/iu.test(normalized)
    || /\b[A-Za-z0-9_.-]+\.schema(?:\.json)?\b/iu.test(normalized)
    || /\b(?:auth|authorization|candidateId|profile|provider|runId|sourceHash|taskId)\s*[:=]/iu
      .test(normalized)
  );
}

function normalizeLeakageText(text: string): string {
  let normalized = text.normalize('NFKC');
  for (let pass = 0; pass < 3; pass += 1) {
    const previous = normalized;
    normalized = normalized
      .replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/giu, (
        entity,
        hexadecimal: string | undefined,
        decimal: string | undefined
      ) => decodeNumericEntity(entity, hexadecimal, decimal))
      .replace(/&(amp|bsol|colon|period|sol);/giu, (entity, name: string) => ({
        amp: '&',
        bsol: '\\',
        colon: ':',
        period: '.',
        sol: '/'
      })[name.toLowerCase()] ?? entity);
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      normalized = normalized.replace(
        /%(25|2e|2f|3a|5c|5f)/giu,
        (_encoded, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))
      );
    }
    normalized = normalized.replace(/\\([/._:#?%])/gu, '$1');
    if (normalized === previous) break;
  }
  return normalized;
}

function decodeNumericEntity(
  entity: string,
  hexadecimal: string | undefined,
  decimal: string | undefined
): string {
  const codePoint = Number.parseInt(hexadecimal ?? decimal ?? '', hexadecimal === undefined ? 10 : 16);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return entity;
  }
  return String.fromCodePoint(codePoint);
}
