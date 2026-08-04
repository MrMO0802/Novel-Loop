import { describe, expect, test } from 'vitest';

import * as chapterContract from '../../src/shared/chapterContract';
import {
  ChapterAdoptRevisionRequestSchema,
  ChapterAuthoringResultSchema,
  ChapterDraftReviewResultSchema,
  ChapterInspectionSchema,
  ChapterPlanReviewResultSchema,
  ChapterSaveMissionWorkingCopyRequestSchema,
  ChapterSavePlanWorkingCopyRequestSchema,
  ChapterSelectDirectionRequestSchema,
  ChapterTaskSchema
} from '../../src/shared/chapterContract';

const reviewToken = 'chapter_review_0123456789abcdef01234567';
const activeOptionToken = 'chapter_option_0123456789abcdef01234567';
const alternativeOptionToken = 'chapter_option_89abcdef0123456701234567';
const objectiveToken = 'chapter_option_111111111111111111111111';
const participantToken = 'chapter_option_222222222222222222222222';
const debtToken = 'chapter_option_333333333333333333333333';

const validPlanReview = {
  available: true,
  chapterNumber: 1,
  title: 'The Radio Wakes',
  reviewToken,
  mission: {
    chapterFunction: 'Open the impossible broadcast.',
    objectives: ['Introduce the powerless radio.'],
    readerKnowledge: ['The radio can speak without power.'],
    readerQuestions: ['Who is calling?'],
    narrativePromises: ['Advance the mystery of the impossible signal.'],
    characterDeltas: ['Lin Cheng moves from skeptical to alert.'],
    forbiddenMoves: ['Do not reveal the caller.'],
    objectiveItems: [{
      itemToken: objectiveToken,
      text: 'Introduce the powerless radio.',
      type: 'plot',
      priority: 'must'
    }],
    debtItems: [{
      itemToken: debtToken,
      promise: 'Who powers the impossible signal?'
    }],
    introducedDebts: [],
    characterDeltaItems: [{
      participantToken,
      participantName: 'Lin Cheng',
      from: 'skeptical',
      to: 'alert',
      evidenceRequired: 'He records the frequency.'
    }],
    participantOptions: [{
      participantToken,
      name: 'Lin Cheng',
      role: 'protagonist',
      selected: true
    }],
    readerInformation: {
      newKnowledge: ['The radio works without power.'],
      newSuspicions: [],
      questionsToMaintain: ['Who is calling?'],
      questionsToAnswer: []
    },
    targetEmotionalCurve: ['unease', 'resolve'],
    targetWordCount: 3_000
  },
  selectedPlan: {
    title: 'Signal First',
    markdown: '# Signal First\n\nThe radio speaks before dawn.\n'
  },
  alternatives: [
    {
      title: 'Building First',
      excerpt: 'Open at the abandoned building.',
      strengths: ['Immediate atmosphere.'],
      risks: ['Delays the radio hook.']
    }
  ],
  directions: [
    {
      optionToken: activeOptionToken,
      title: 'Signal First',
      markdown: '# Signal First\n\nThe radio speaks before dawn.\n',
      excerpt: 'The radio speaks before dawn.',
      strengths: ['Immediate hook.'],
      risks: ['Needs a grounded reaction.'],
      aiRecommended: true,
      active: true
    },
    {
      optionToken: alternativeOptionToken,
      title: 'Building First',
      markdown: '# Building First\n\nOpen at the abandoned building.\n',
      excerpt: 'Open at the abandoned building.',
      strengths: ['Immediate atmosphere.'],
      risks: ['Delays the radio hook.'],
      aiRecommended: false,
      active: false
    }
  ]
} as const;

const validDraftReview = {
  available: true,
  chapterNumber: 1,
  title: 'The Radio Wakes',
  markdown: '# The Radio Wakes\n\nThe powerless radio clicked once.\n',
  scenes: [
    { summary: 'Lin Cheng hears the radio.' },
    { summary: 'The signal names an address.' }
  ]
} as const;

const validTask = {
  taskId: 'chapter_0123456789abcdef',
  projectKey: 'project_radio',
  kind: 'drafting',
  chapterNumber: 1,
  status: 'running',
  stage: 'scene_drafts',
  completedStages: ['preparing', 'scene_cards'],
  sceneProgress: { current: 1, total: 2 },
  startedAt: '2026-07-30T01:00:00.000Z',
  updatedAt: '2026-07-30T01:01:00.000Z',
  canCancel: true,
  canRetry: false,
  error: null
} as const;

describe('chapter workspace contract', () => {
  test('exports strict request objects for all seven service operations', () => {
    const cases = [
      ['ChapterInspectRequestSchema', { projectKey: 'project_radio' }, {
        projectKey: 'project_radio',
        path: '/private/library/radio'
      }],
      ['ChapterStartPlanningRequestSchema', { projectKey: 'project_radio' }, {
        projectKey: 'project_radio',
        provider: 'codex-text'
      }],
      ['ChapterStartDraftingRequestSchema', { projectKey: 'project_radio' }, {
        projectKey: 'project_radio',
        chapterNumber: 1
      }],
      ['ChapterGetRequestSchema', { taskId: 'chapter_0123456789abcdef' }, {
        taskId: 'chapter_0123456789abcdef',
        command: 'status'
      }],
      ['ChapterCancelRequestSchema', { taskId: 'chapter_0123456789abcdef' }, {
        taskId: 'chapter_0123456789abcdef',
        provider: 'codex-text'
      }],
      ['ChapterReadPlanRequestSchema', { projectKey: 'project_radio' }, {
        projectKey: 'project_radio',
        command: 'cat'
      }],
      ['ChapterReadDraftRequestSchema', { projectKey: 'project_radio' }, {
        projectKey: 'project_radio',
        path: '/private/chapter.md'
      }]
    ] as const;

    for (const [exportName, valid, withExtra] of cases) {
      const schema = (
        chapterContract as unknown as Record<string, RequestObjectSchema>
      )[exportName];
      expect(schema, `${exportName} must be exported`).toBeDefined();
      if (schema === undefined) continue;
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse(withExtra).success).toBe(false);
    }
  });

  test('parses valid plan and draft reviews', () => {
    expect(ChapterPlanReviewResultSchema.parse(validPlanReview)).toEqual(validPlanReview);
    expect(ChapterDraftReviewResultSchema.parse(validDraftReview)).toEqual(validDraftReview);
  });

  test('accepts only opaque authoring request fields', () => {
    const selectRequest = ChapterSelectDirectionRequestSchema.parse({
      projectKey: 'project_radio',
      reviewToken,
      optionToken: alternativeOptionToken
    });
    expect(() => ChapterSelectDirectionRequestSchema.parse({
      ...selectRequest,
      candidateId: 'plan_002'
    })).toThrow();

    expect(ChapterSavePlanWorkingCopyRequestSchema.parse({
      projectKey: 'project_radio',
      reviewToken,
      optionToken: alternativeOptionToken,
      markdown: '# Revised direction\n\nThe radio speaks twice.\n'
    })).toBeDefined();
    expect(() => ChapterSavePlanWorkingCopyRequestSchema.parse({
      projectKey: 'project_radio',
      reviewToken,
      optionToken: alternativeOptionToken,
      markdown: '# Revised direction',
      sourceHash: 'a'.repeat(64)
    })).toThrow();

    expect(ChapterAdoptRevisionRequestSchema.parse({
      projectKey: 'project_radio',
      revisionToken: 'chapter_revision_0123456789abcdef01234567',
      confirmInvalidation: true
    })).toBeDefined();
    expect(() => ChapterAdoptRevisionRequestSchema.parse({
      projectKey: 'project_radio',
      revisionToken: 'chapter_revision_0123456789abcdef01234567',
      confirmInvalidation: false
    })).toThrow();
  });

  test('accepts structured mission edits without trusted identifiers', () => {
    const request = ChapterSaveMissionWorkingCopyRequestSchema.parse({
      projectKey: 'project_radio',
      reviewToken,
      mission: {
        chapterFunction: 'Open the impossible broadcast.',
        requiredObjectives: [{
          itemToken: objectiveToken,
          text: 'Introduce the powerless radio.',
          type: 'plot',
          priority: 'must'
        }, {
          itemToken: null,
          text: 'Show a second impossible pulse.',
          type: 'foreshadowing',
          priority: 'should'
        }],
        debtTokens: [debtToken],
        debtsToIntroduce: [{
          type: 'mystery',
          promise: 'The caller knows tomorrow.',
          importance: 8
        }],
        characterDeltas: [{
          participantToken,
          from: 'skeptical',
          to: 'alert',
          evidenceRequired: 'He records the frequency.'
        }],
        participantTokens: [participantToken],
        newParticipants: [{ name: 'Mara', role: 'caller' }],
        readerInformation: {
          newKnowledge: ['The radio works without power.'],
          newSuspicions: [],
          questionsToMaintain: ['Who is calling?'],
          questionsToAnswer: []
        },
        forbiddenMoves: ['Do not reveal the caller.'],
        targetEmotionalCurve: ['unease', 'resolve'],
        targetWordCount: 3_000
      }
    });
    expect(request.mission.newParticipants).toEqual([
      { name: 'Mara', role: 'caller' }
    ]);
    expect(() => ChapterSaveMissionWorkingCopyRequestSchema.parse({
      ...request,
      mission: {
        ...request.mission,
        participatingCharacterIds: ['char_secret']
      }
    })).toThrow();
  });

  test('requires one active and one AI-recommended full direction', () => {
    const parsed = ChapterPlanReviewResultSchema.parse(validPlanReview);
    if (!parsed.available) throw new Error('Expected an available plan review.');

    expect(parsed.directions).toHaveLength(2);
    expect(parsed.directions.every(({ markdown, optionToken }) => (
      markdown.length > 0 && optionToken.startsWith('chapter_option_')
    ))).toBe(true);
    expect(parsed.directions.filter(({ active }) => active)).toHaveLength(1);
    expect(parsed.directions.filter(({ aiRecommended }) => aiRecommended))
      .toHaveLength(1);

    expect(ChapterPlanReviewResultSchema.safeParse({
      ...validPlanReview,
      directions: validPlanReview.directions.map((direction) => ({
        ...direction,
        active: false
      }))
    }).success).toBe(false);
    expect(ChapterPlanReviewResultSchema.safeParse({
      ...validPlanReview,
      directions: validPlanReview.directions.map((direction) => ({
        ...direction,
        aiRecommended: true
      }))
    }).success).toBe(false);
  });

  test.each([
    { candidateId: 'plan_002' },
    { path: '/home/author/private-plan.md' },
    { sourceHash: 'a'.repeat(64) },
    { schemaName: 'planning.plan_candidates.schema.json' },
    { runId: 'run_private' },
    { provider: 'codex-text' },
    { profile: 'author-machine' },
    { auth: 'secret' }
  ])('rejects internal direction fields: %j', (internal) => {
    expect(ChapterPlanReviewResultSchema.safeParse({
      ...validPlanReview,
      directions: [{ ...validPlanReview.directions[0], ...internal }]
    }).success).toBe(false);
  });

  test.each([
    '/home/author/private-plan.md',
    'chapters/chapter_001/selected_plan.md',
    'Use plan_002 as the source.',
    `Source hash: ${'a'.repeat(64)}`,
    'run_private produced this direction.',
    'planning.plan_candidates.schema.json'
  ])('rejects internal values embedded in author Markdown: %s', (internal) => {
    expect(ChapterPlanReviewResultSchema.safeParse({
      ...validPlanReview,
      directions: validPlanReview.directions.map((direction, index) => (
        index === 0 ? { ...direction, markdown: internal } : direction
      ))
    }).success).toBe(false);
  });

  test('exposes only bounded authoring outcomes and message keys', () => {
    expect(ChapterAuthoringResultSchema.parse({
      outcome: 'saved',
      revisionToken: 'chapter_revision_0123456789abcdef01234567'
    })).toBeDefined();
    expect(ChapterAuthoringResultSchema.parse({
      outcome: 'blocked',
      messageKey: 'generation_busy'
    })).toBeDefined();
    expect(() => ChapterAuthoringResultSchema.parse({
      outcome: 'stale',
      message: '/home/author/private stale hash'
    })).toThrow();
  });

  test('requires bounded natural-language mission promises and character deltas', () => {
    const withoutPromises = {
      ...validPlanReview,
      mission: {
        chapterFunction: validPlanReview.mission.chapterFunction,
        objectives: validPlanReview.mission.objectives,
        readerKnowledge: validPlanReview.mission.readerKnowledge,
        readerQuestions: validPlanReview.mission.readerQuestions,
        characterDeltas: validPlanReview.mission.characterDeltas,
        forbiddenMoves: validPlanReview.mission.forbiddenMoves
      }
    };
    expect(ChapterPlanReviewResultSchema.safeParse(withoutPromises).success)
      .toBe(false);
    expect(ChapterPlanReviewResultSchema.safeParse({
      ...validPlanReview,
      mission: {
        ...validPlanReview.mission,
        characterDeltas: [{ characterId: 'char_secret', from: 'a', to: 'b' }]
      }
    }).success).toBe(false);
    expect(ChapterPlanReviewResultSchema.safeParse({
      ...validPlanReview,
      mission: {
        ...validPlanReview.mission,
        narrativePromises: Array.from({ length: 101 }, () => 'A promise.')
      }
    }).success).toBe(false);
  });

  test.each([
    [
      'project paths',
      ChapterInspectionSchema,
      {
        available: true,
        chapterNumber: 1,
        title: 'The Radio Wakes',
        phase: 'not_started',
        projectRoot: '/private/library/radio'
      }
    ],
    [
      'run identifiers',
      ChapterTaskSchema,
      { ...validTask, runId: 'chapter_run_secret' }
    ],
    [
      'provider details',
      ChapterPlanReviewResultSchema,
      { ...validPlanReview, provider: 'codex-text' }
    ]
  ])('rejects unrecognized %s', (_label, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  test('rejects oversized UTF-8 Markdown even when the character count is below the byte limit', () => {
    const oversized = '界'.repeat(700_000);

    expect(oversized.length).toBeLessThan(2 * 1024 * 1024);
    expect(ChapterPlanReviewResultSchema.safeParse({
      ...validPlanReview,
      selectedPlan: {
        ...validPlanReview.selectedPlan,
        markdown: oversized
      }
    }).success).toBe(false);
    expect(ChapterDraftReviewResultSchema.safeParse({
      ...validDraftReview,
      markdown: oversized
    }).success).toBe(false);
  });

  test('rejects more than ten plan alternatives', () => {
    expect(ChapterPlanReviewResultSchema.safeParse({
      ...validPlanReview,
      alternatives: Array.from({ length: 11 }, (_, index) => ({
        title: `Alternative ${index + 1}`,
        excerpt: 'A bounded excerpt.',
        strengths: [],
        risks: []
      }))
    }).success).toBe(false);
  });

  test('rejects a plan review whose aggregate payload exceeds four MiB', () => {
    const repeatedReviewText = Array.from(
      { length: 100 },
      () => 'x'.repeat(1_100)
    );
    const oversizedReview = {
      ...validPlanReview,
      selectedPlan: {
        ...validPlanReview.selectedPlan,
        markdown: 'x'.repeat(2 * 1024 * 1024)
      },
      alternatives: Array.from({ length: 10 }, (_, index) => ({
        title: `Alternative ${index + 1}`,
        excerpt: 'A bounded excerpt.',
        strengths: repeatedReviewText,
        risks: repeatedReviewText
      }))
    };

    expect(new TextEncoder().encode(JSON.stringify(oversizedReview)).byteLength)
      .toBeGreaterThan(4 * 1024 * 1024);
    expect(ChapterPlanReviewResultSchema.safeParse(oversizedReview).success)
      .toBe(false);
  });

  test.each([
    { current: -1, total: 2 },
    { current: 0, total: 2 },
    { current: 1, total: 0 },
    { current: 3, total: 2 },
    { current: 0.5, total: 2 }
  ])('rejects invalid scene progress: %j', (sceneProgress) => {
    expect(ChapterTaskSchema.safeParse({
      ...validTask,
      sceneProgress
    }).success).toBe(false);
  });

  test('keeps alternative records identifier-free', () => {
    const parsed = ChapterPlanReviewResultSchema.parse(validPlanReview);
    if (!parsed.available) throw new Error('Expected an available plan review.');

    expect(parsed.alternatives[0]).toEqual({
      title: 'Building First',
      excerpt: 'Open at the abandoned building.',
      strengths: ['Immediate atmosphere.'],
      risks: ['Delays the radio hook.']
    });
    expect(ChapterPlanReviewResultSchema.safeParse({
      ...validPlanReview,
      alternatives: [{
        ...validPlanReview.alternatives[0],
        candidateId: 'plan_002'
      }]
    }).success).toBe(false);
  });

  test('rejects engine scene identifiers from draft scene summaries', () => {
    expect(ChapterDraftReviewResultSchema.safeParse({
      ...validDraftReview,
      scenes: [{
        summary: 'Lin Cheng hears the radio.',
        sceneId: 'scene_001'
      }]
    }).success).toBe(false);
  });
});

interface RequestObjectSchema {
  safeParse(value: unknown): { success: boolean };
}
