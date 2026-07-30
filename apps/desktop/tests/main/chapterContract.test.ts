import { describe, expect, test } from 'vitest';

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
  test('parses valid plan and draft reviews', () => {
    expect(ChapterPlanReviewResultSchema.parse(validPlanReview)).toEqual(validPlanReview);
    expect(ChapterDraftReviewResultSchema.parse(validDraftReview)).toEqual(validDraftReview);
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

  test.each([
    { current: -1, total: 2 },
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
});
