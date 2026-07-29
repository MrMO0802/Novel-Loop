import { describe, expect, test } from 'vitest';

import {
  PlanningDocumentSchema,
  PlanningGetRequestSchema,
  PlanningReadRequestSchema,
  PlanningReviewResultSchema,
  PlanningStartRequestSchema,
  PlanningTaskSchema
} from '../../src/shared/planningContract';

const runningTask = {
  taskId: 'planning_0123456789abcdef',
  projectKey: 'project_0123456789abcdef01234567',
  status: 'running' as const,
  stage: 'global_outline' as const,
  completedStages: ['preparing' as const],
  startedAt: '2026-07-29T01:00:00.000Z',
  updatedAt: '2026-07-29T01:00:01.000Z',
  canCancel: true,
  canRetry: false,
  error: null
};

const documents = [
  { kind: 'global_outline', title: 'Global Outline', markdown: '# Global Outline\n' },
  { kind: 'volume_outline', title: 'Volume 01 Outline', markdown: '# Volume 01\n' }
] as const;

const arcs = [
  {
    id: 'arc_radio',
    name: 'Radio Signal',
    type: 'plot' as const,
    summary: 'The signal draws the protagonist to the old building.',
    relatedCharacters: ['Lin Cheng']
  }
];

const chapters = [
  {
    chapterNumber: 1,
    title: 'The Radio Wakes',
    status: 'planned',
    summary: 'A powerless radio speaks.',
    primaryFunction: 'Open the mystery.'
  }
];

describe('global planning contract', () => {
  test('accepts an author-safe running task with the fixed lifecycle stages', () => {
    expect(PlanningTaskSchema.parse(runningTask)).toMatchObject({
      status: 'running',
      stage: 'global_outline'
    });
  });

  test('accepts every author-facing planning error category with a bounded message', () => {
    const kinds = [
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
    ] as const;

    for (const kind of kinds) {
      expect(PlanningTaskSchema.parse({
        ...runningTask,
        status: 'failed',
        canCancel: false,
        canRetry: true,
        error: { kind, message: 'A concise author-facing planning message.' }
      }).error?.kind).toBe(kind);
    }

    expect(() => PlanningTaskSchema.parse({
      ...runningTask,
      error: { kind: 'unexpected', message: 'x'.repeat(321) }
    })).toThrow();
  });

  test('normalizes opaque identifiers and rejects task ids outside planning hex format', () => {
    expect(PlanningStartRequestSchema.parse({
      projectKey: `  ${runningTask.projectKey}  `
    })).toEqual({ projectKey: runningTask.projectKey });
    expect(PlanningGetRequestSchema.parse({
      taskId: `  ${runningTask.taskId}  `
    })).toEqual({ taskId: runningTask.taskId });
    expect(() => PlanningGetRequestSchema.parse({ taskId: 'planning_not-hex' })).toThrow();
    expect(() => PlanningGetRequestSchema.parse({ taskId: 'foundation_0123456789abcdef' })).toThrow();
  });

  test('rejects paths, run metadata, and unknown request fields', () => {
    expect(() => PlanningTaskSchema.parse({
      ...runningTask,
      projectRoot: '/private/project',
      runId: 'run_secret',
      artifactPath: 'planning/global_outline.md'
    })).toThrow();
    expect(() => PlanningReadRequestSchema.parse({
      projectKey: runningTask.projectKey,
      projectRoot: '/private/project'
    })).toThrow();
  });

  test('bounds Markdown review payloads in UTF-8 bytes', () => {
    expect(() => PlanningDocumentSchema.parse({
      kind: 'global_outline', title: 'Global Outline', markdown: 'a'.repeat(2 * 1024 * 1024 + 1)
    })).toThrow();
    expect(() => PlanningDocumentSchema.parse({
      kind: 'global_outline', title: '全书方向', markdown: '字'.repeat(Math.floor(2 * 1024 * 1024 / 3) + 1)
    })).toThrow();
  });

  test('bounds the complete serialized available review payload including structure records', () => {
    const structureHeavyChapters = Array.from({ length: 2_000 }, (_, index) => ({
      chapterNumber: index + 1,
      title: `Chapter ${index + 1}`,
      status: 'planned',
      summary: 'x'.repeat(3_000),
      primaryFunction: 'Advance the story.'
    }));

    expect(() => PlanningReviewResultSchema.parse({
      available: true,
      documents,
      arcs,
      chapters: structureHeavyChapters
    })).toThrow('Review payload exceeds the 4 MiB total limit.');
  });

  test('requires two distinct documents and rejects duplicate arcs and chapters', () => {
    expect(PlanningReviewResultSchema.parse({
      available: true,
      documents,
      arcs,
      chapters
    })).toEqual({ available: true, documents, arcs, chapters });

    expect(() => PlanningReviewResultSchema.parse({
      available: true,
      documents: [documents[0], documents[0]],
      arcs,
      chapters
    })).toThrow();
    expect(() => PlanningReviewResultSchema.parse({
      available: true,
      documents,
      arcs: [...arcs, arcs[0]],
      chapters
    })).toThrow();
    expect(() => PlanningReviewResultSchema.parse({
      available: true,
      documents,
      arcs,
      chapters: [...chapters, chapters[0]]
    })).toThrow();
  });
});
