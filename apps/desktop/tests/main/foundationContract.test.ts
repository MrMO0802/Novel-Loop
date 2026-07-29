import { describe, expect, test } from 'vitest';

import {
  FoundationDocumentSchema,
  FoundationGetRequestSchema,
  FoundationReadRequestSchema,
  FoundationReviewResultSchema,
  FoundationStartRequestSchema,
  FoundationTaskSchema
} from '../../src/shared/foundationContract';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';

const runningTask = {
  taskId: 'foundation_0123456789abcdef',
  projectKey: 'project_0123456789abcdef01234567',
  status: 'running' as const,
  stage: 'story_bible' as const,
  completedStages: ['preparing' as const],
  startedAt: '2026-07-28T01:00:00.000Z',
  updatedAt: '2026-07-28T01:00:01.000Z',
  canCancel: true,
  canRetry: false,
  error: null
};

const documents = [
  { kind: 'story_bible', title: 'Story Bible', markdown: '# Story Bible\n' },
  { kind: 'genre_contract', title: 'Genre Contract', markdown: '# Genre Contract\n' },
  { kind: 'reader_promise', title: 'Reader Promise', markdown: '# Reader Promise\n' },
  { kind: 'style_guide', title: 'Style Guide', markdown: '# Style Guide\n' }
] as const;

describe('Story Foundation contract', () => {
  test('accepts an author-safe running task', () => {
    expect(FoundationTaskSchema.parse(runningTask)).toMatchObject({
      status: 'running'
    });
  });

  test('normalizes opaque request identifiers', () => {
    expect(FoundationStartRequestSchema.parse({
      projectKey: `  ${runningTask.projectKey}  `
    })).toEqual({ projectKey: runningTask.projectKey });
    expect(FoundationGetRequestSchema.parse({
      taskId: `  ${runningTask.taskId}  `
    })).toEqual({ taskId: runningTask.taskId });
  });

  test('rejects filesystem and provider details', () => {
    expect(() => FoundationTaskSchema.parse({
      ...runningTask,
      projectRoot: '/private/project',
      runId: 'run_secret',
      codexBin: '/usr/bin/codex'
    })).toThrow();
  });

  test('rejects unknown request fields', () => {
    expect(() => FoundationReadRequestSchema.parse({
      projectKey: runningTask.projectKey,
      projectRoot: '/private/project'
    })).toThrow();
  });

  test('bounds markdown to 2 MiB in UTF-8', () => {
    expect(() => FoundationDocumentSchema.parse({
      kind: 'story_bible',
      title: 'Story Bible',
      markdown: 'a'.repeat(2 * 1024 * 1024 + 1)
    })).toThrow();
    expect(() => FoundationDocumentSchema.parse({
      kind: 'story_bible',
      title: '故事圣经',
      markdown: '字'.repeat(Math.floor(2 * 1024 * 1024 / 3) + 1)
    })).toThrow();
  });

  test('requires exactly one document of each kind and preserves engine order', () => {
    const engineOrder = [documents[2], documents[0], documents[3], documents[1]];
    expect(FoundationReviewResultSchema.parse({
      available: true,
      documents: engineOrder
    })).toEqual({ available: true, documents: engineOrder });
    expect(() => FoundationReviewResultSchema.parse({
      available: true,
      documents: [documents[0], documents[1], documents[2], documents[0]]
    })).toThrow();
    expect(() => FoundationReviewResultSchema.parse({
      available: true,
      documents: documents.slice(0, 3)
    })).toThrow();
    expect(() => FoundationReviewResultSchema.parse({
      available: false,
      reason: 'not_ready',
      projectRoot: '/private/project'
    })).toThrow();
  });

  test('defines fixed foundation IPC channels', () => {
    expect({
      foundationStart: IPC_CHANNELS.foundationStart,
      foundationGet: IPC_CHANNELS.foundationGet,
      foundationCancel: IPC_CHANNELS.foundationCancel,
      foundationRead: IPC_CHANNELS.foundationRead
    }).toEqual({
      foundationStart: 'novel-loop:foundation:start',
      foundationGet: 'novel-loop:foundation:get',
      foundationCancel: 'novel-loop:foundation:cancel',
      foundationRead: 'novel-loop:foundation:read'
    });
  });
});
