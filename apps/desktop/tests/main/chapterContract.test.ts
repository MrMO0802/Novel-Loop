import { describe, expect, test } from 'vitest';

import * as chapterContract from '../../src/shared/chapterContract';
import {
  ChapterDraftReviewResultSchema,
  ChapterInspectionSchema,
  ChapterPlanReviewResultSchema,
  ChapterTaskSchema
} from '../../src/shared/chapterContract';

const validPlanReview = {
  available: true,
  chapterNumber: 1,
  title: 'The Radio Wakes',
  mission: {
    chapterFunction: 'Open the impossible broadcast.',
    objectives: ['Introduce the powerless radio.'],
    readerKnowledge: ['The radio can speak without power.'],
    readerQuestions: ['Who is calling?'],
    narrativePromises: ['Advance the mystery of the impossible signal.'],
    characterDeltas: ['Lin Cheng moves from skeptical to alert.'],
    forbiddenMoves: ['Do not reveal the caller.']
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
