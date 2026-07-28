import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { FoundationReviewResult } from '../../src/shared/foundationContract';
import type {
  FoundationEngineGateway,
  FoundationEngineProgressEvent
} from '../../src/main/foundation/EngineFoundationGateway';
import {
  ProjectFoundationService,
  type ProjectRootResolver
} from '../../src/main/foundation/ProjectFoundationService';

const projectKey = 'project_0123456789abcdef01234567';
const secondProjectKey = 'project_second';
const projectRoot = '/library/novel-20260728-010203-a1b2c3';
const secondProjectRoot = '/library/novel-20260728-010204-d4e5f6';
const temporaryDirectories: string[] = [];

const completeReview: FoundationReviewResult = {
  available: true,
  documents: [
    { kind: 'story_bible', title: 'Story Bible', markdown: '# Story Bible\n' },
    { kind: 'genre_contract', title: 'Genre Contract', markdown: '# Genre Contract\n' },
    { kind: 'reader_promise', title: 'Reader Promise', markdown: '# Reader Promise\n' },
    { kind: 'style_guide', title: 'Style Guide', markdown: '# Style Guide\n' }
  ]
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

class FakeProjectRootResolver implements ProjectRootResolver {
  readonly roots = new Map<string, string>();

  async resolveProjectRoot(key: string): Promise<string | null> {
    return this.roots.get(key) ?? null;
  }
}

class DeferredFoundationGateway implements FoundationEngineGateway {
  reviewResult: FoundationReviewResult = { available: false, reason: 'not_ready' };
  autoComplete = false;
  readonly builds: Array<DeferredBuild> = [];
  readonly build = vi.fn(async (input: {
    projectRoot: string;
    resumeIncomplete: boolean;
    onProgress(event: FoundationEngineProgressEvent): void;
    shouldStop(): boolean;
  }): Promise<void> => {
    const build = new DeferredBuild(input);
    this.builds.push(build);
    if (this.autoComplete) {
      build.resolve();
    }
    await build.promise;
  });
  readonly read = vi.fn(async (_projectRoot: string): Promise<FoundationReviewResult> => (
    this.reviewResult
  ));

  emit(event: FoundationEngineProgressEvent, index = 0): void {
    this.buildAt(index).input.onProgress(event);
  }

  complete(index = 0): void {
    this.buildAt(index).resolve();
  }

  completeWithCancellation(index = 0): void {
    const build = this.buildAt(index);
    expect(build.input.shouldStop()).toBe(true);
    build.reject(withCode('BUILD_BIBLE_CANCELLED', 'stop requested'));
  }

  fail(error: unknown, index = 0): void {
    this.buildAt(index).reject(error);
  }

  private buildAt(index: number): DeferredBuild {
    const build = this.builds[index];
    if (build === undefined) throw new Error(`No deferred build at index ${index}.`);
    return build;
  }
}

class DeferredBuild {
  readonly promise: Promise<void>;
  private resolvePromise!: () => void;
  private rejectPromise!: (error: unknown) => void;

  constructor(readonly input: {
    projectRoot: string;
    resumeIncomplete: boolean;
    onProgress(event: FoundationEngineProgressEvent): void;
    shouldStop(): boolean;
  }) {
    this.promise = new Promise<void>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(): void {
    this.resolvePromise();
  }

  reject(error: unknown): void {
    this.rejectPromise(error);
  }
}

function createService(options: {
  gateway?: DeferredFoundationGateway;
  resolver?: FakeProjectRootResolver;
} = {}) {
  const gateway = options.gateway ?? new DeferredFoundationGateway();
  const resolver = options.resolver ?? new FakeProjectRootResolver();
  resolver.roots.set(projectKey, projectRoot);
  resolver.roots.set(secondProjectKey, secondProjectRoot);
  let clockTick = 0;
  let randomTick = 0;
  const service = new ProjectFoundationService({
    gateway,
    projects: resolver,
    clock: () => new Date(Date.UTC(2026, 6, 28, 1, 0, clockTick++)),
    randomBytes: (size) => {
      const bytes = new Uint8Array(size);
      bytes[size - 1] = randomTick++;
      return bytes;
    }
  });
  return { gateway, resolver, service };
}

async function eventually(assertion: () => Promise<void> | void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

function withCode(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('ProjectFoundationService', () => {
  test('starts one background task and reports ordered progress', async () => {
    const { gateway, service } = createService();

    const started = await service.start(projectKey);

    expect(started).toMatchObject({ status: 'queued', stage: 'preparing' });
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.emit({ stage: 'preparing', state: 'started' });
    gateway.emit({ stage: 'preparing', state: 'completed' });
    gateway.emit({ stage: 'story_bible', state: 'started' });
    await eventually(async () => {
      await expect(service.get(started.taskId)).resolves.toMatchObject({
        status: 'running',
        stage: 'story_bible',
        completedStages: ['preparing']
      });
    });

    const duplicate = await service.start(projectKey);

    expect(duplicate.taskId).toBe(started.taskId);
    expect(gateway.build).toHaveBeenCalledTimes(1);
  });

  test('marks stop_requested and stops before the next stage', async () => {
    const { gateway, service } = createService();
    const task = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));

    await expect(service.cancel(task.taskId)).resolves.toMatchObject({
      status: 'stop_requested',
      canCancel: false
    });
    gateway.completeWithCancellation();

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'cancelled',
        canRetry: true,
        error: null
      });
    });
  });

  test('never starts when all four documents already exist', async () => {
    const gateway = new DeferredFoundationGateway();
    gateway.reviewResult = completeReview;
    const { service } = createService({ gateway });

    const task = await service.start(projectKey);

    expect(task).toMatchObject({
      status: 'failed',
      canRetry: false,
      error: { kind: 'already_complete' }
    });
    expect(gateway.build).not.toHaveBeenCalled();
  });

  test('isolates active tasks by project', async () => {
    const { gateway, service } = createService();
    const first = await service.start(projectKey);
    const second = await service.start(secondProjectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(2));

    await service.cancel(first.taskId);

    await expect(service.get(second.taskId)).resolves.toMatchObject({
      status: 'running',
      projectKey: secondProjectKey
    });
    expect(gateway.builds[1]?.input.shouldStop()).toBe(false);
    gateway.completeWithCancellation(0);
    gateway.complete(1);

    await eventually(async () => {
      await expect(service.get(second.taskId)).resolves.toMatchObject({ status: 'succeeded' });
    });
  });

  test('fails safely when the project is missing', async () => {
    const { gateway, resolver, service } = createService();
    resolver.roots.delete(projectKey);

    await expect(service.start(projectKey)).resolves.toMatchObject({
      status: 'failed',
      error: { kind: 'project_unavailable' }
    });
    expect(gateway.read).not.toHaveBeenCalled();
    expect(gateway.build).not.toHaveBeenCalled();
  });

  test('rejects unknown task identifiers without leaking task state', async () => {
    const { service } = createService();
    const unknownTaskId = 'foundation_unknown';

    await expect(service.get(unknownTaskId)).rejects.toThrow('Foundation task was not found.');
    await expect(service.cancel(unknownTaskId)).rejects.toThrow('Foundation task was not found.');
  });

  test('retries a partial foundation with resumeIncomplete enabled', async () => {
    const { gateway, service } = createService();
    const first = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.fail(withCode('BUILD_BIBLE_CANCELLED', 'partial foundation stopped'));
    await eventually(async () => {
      await expect(service.get(first.taskId)).resolves.toMatchObject({ status: 'cancelled' });
    });

    const retry = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(2));

    expect(retry.taskId).not.toBe(first.taskId);
    expect(gateway.builds[1]?.input.resumeIncomplete).toBe(true);
    gateway.complete(1);
  });

  test('does not mutate Story State while running a foundation task', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-foundation-state-'));
    temporaryDirectories.push(root);
    const statePath = path.join(root, 'state', 'story_state.json');
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, '{"chapter":0}\n', { encoding: 'utf8' });
    const before = createHash('sha256').update(await readFile(statePath)).digest('hex');
    const { gateway, resolver, service } = createService();
    resolver.roots.set(projectKey, root);

    const task = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.complete();
    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({ status: 'succeeded' });
    });

    expect(createHash('sha256').update(await readFile(statePath)).digest('hex')).toBe(before);
  });

  test('ignores stale progress after a task reaches a terminal state', async () => {
    const { gateway, service } = createService();
    const task = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.complete();
    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'succeeded',
        stage: 'completed'
      });
    });

    gateway.emit({ stage: 'story_bible', state: 'started' });

    await expect(service.get(task.taskId)).resolves.toMatchObject({
      status: 'succeeded',
      stage: 'completed'
    });
  });

  test.each([
    ['ENOENT', 'codex_unavailable'],
    ['CODEX_LOGIN_REQUIRED', 'login_required'],
    ['CODEX_USAGE_LIMIT', 'usage_limit'],
    ['CODEX_TIMEOUT', 'timeout'],
    ['CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', 'invalid_output'],
    ['PROJECT_NOT_FOUND', 'project_unavailable'],
    ['BRIEF_NOT_FOUND', 'project_unavailable'],
    ['DESKTOP_STORY_BIBLE_INCOMPLETE', 'invalid_output'],
    ['OTHER_FAILURE', 'unexpected']
  ] as const)('maps %s failures to the %s author-safe category', async (code, kind) => {
    const { gateway, service } = createService();
    const task = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));

    gateway.fail(withCode(code, '/private/project/internal failure'));

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'failed',
        error: { kind }
      });
    });
    const result = await service.get(task.taskId);
    expect(result.error?.message).not.toContain('/private/project');
  });

  test('contains a rejected background build and retains its terminal state', async () => {
    const { gateway, service } = createService();
    const unhandled = vi.fn();
    process.once('unhandledRejection', unhandled);
    try {
      const task = await service.start(projectKey);
      await eventually(() => expect(gateway.builds).toHaveLength(1));
      gateway.fail(withCode('OTHER_FAILURE', 'background rejection'));
      await eventually(async () => {
        await expect(service.get(task.taskId)).resolves.toMatchObject({ status: 'failed' });
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('retains only the latest one hundred terminal tasks', async () => {
    const gateway = new DeferredFoundationGateway();
    gateway.autoComplete = true;
    const { resolver, service } = createService({ gateway });
    const started = await Promise.all(Array.from({ length: 101 }, async (_, index) => {
      const key = `project_retention_${index}`;
      resolver.roots.set(key, `/library/novel-20260728-0200${index}-a1b2c3`);
      return service.start(key);
    }));

    await eventually(async () => {
      await expect(service.get(started[100]!.taskId)).resolves.toMatchObject({ status: 'succeeded' });
    });

    expect(new Set(started.map((task) => task.taskId)).size).toBe(101);
    await expect(service.get(started[0]!.taskId)).rejects.toThrow('Foundation task was not found.');
    await expect(service.get(started[1]!.taskId)).resolves.toMatchObject({ status: 'succeeded' });
  });
});
