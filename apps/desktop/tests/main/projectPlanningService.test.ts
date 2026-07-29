import { describe, expect, test, vi } from 'vitest';

import type { PlanningReviewResult } from '../../src/shared/planningContract';
import type {
  PlanningEngineGateway,
  PlanningEngineProgressEvent
} from '../../src/main/planning/EnginePlanningGateway';
import {
  ProjectPlanningService,
  type ProjectRootResolver
} from '../../src/main/planning/ProjectPlanningService';

const projectKey = 'project_0123456789abcdef01234567';
const secondProjectKey = 'project_second';
const projectRoot = '/library/novel-20260729-010203-a1b2c3';
const secondProjectRoot = '/library/novel-20260729-010204-d4e5f6';

const completedReview: PlanningReviewResult = {
  available: true,
  documents: [
    { kind: 'global_outline', title: 'Global Outline', markdown: '# Global\n' },
    { kind: 'volume_outline', title: 'Volume 01', markdown: '# Volume\n' }
  ],
  arcs: [],
  chapters: []
};

class FakeProjectRootResolver implements ProjectRootResolver {
  readonly roots = new Map<string, string>();

  async resolveProjectRoot(key: string): Promise<string | null> {
    return this.roots.get(key) ?? null;
  }
}

class DeferredPlanningGateway implements PlanningEngineGateway {
  reviewResult: PlanningReviewResult = { available: false, reason: 'not_ready' };
  reviewError: unknown = null;
  autoComplete = false;
  readonly builds: DeferredBuild[] = [];
  readonly build = vi.fn(async (input: {
    projectRoot: string;
    resumeIncomplete: boolean;
    replaceInvalidComplete: boolean;
    onProgress(event: PlanningEngineProgressEvent): void;
    shouldStop(): boolean;
  }): Promise<void> => {
    const build = new DeferredBuild(input);
    this.builds.push(build);
    if (this.autoComplete) this.complete(this.builds.length - 1);
    await build.promise;
  });
  readonly read = vi.fn(async (_projectRoot: string): Promise<PlanningReviewResult> => {
    if (this.reviewError !== null) throw this.reviewError;
    return this.reviewResult;
  });

  emit(event: PlanningEngineProgressEvent, index = 0): void {
    this.buildAt(index).input.onProgress(event);
  }

  complete(index = 0): void {
    this.reviewError = null;
    this.reviewResult = completedReview;
    this.buildAt(index).resolve();
  }

  completeWithInvalidReview(error: unknown, index = 0): void {
    this.reviewError = error;
    this.buildAt(index).resolve();
  }

  completeWithoutReview(index = 0): void {
    this.buildAt(index).resolve();
  }

  cancel(index = 0): void {
    const build = this.buildAt(index);
    expect(build.input.shouldStop()).toBe(true);
    build.reject(withCode('PLAN_GLOBAL_CANCELLED', 'stop requested'));
  }

  fail(error: unknown, index = 0): void {
    this.buildAt(index).reject(error);
  }

  private buildAt(index: number): DeferredBuild {
    const build = this.builds[index];
    if (build === undefined) throw new Error(`No deferred planning build at index ${index}.`);
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
    replaceInvalidComplete: boolean;
    onProgress(event: PlanningEngineProgressEvent): void;
    shouldStop(): boolean;
  }) {
    this.promise = new Promise<void>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(): void { this.resolvePromise(); }
  reject(error: unknown): void { this.rejectPromise(error); }
}

function createService(options: {
  gateway?: DeferredPlanningGateway;
  resolver?: FakeProjectRootResolver;
} = {}) {
  const gateway = options.gateway ?? new DeferredPlanningGateway();
  const resolver = options.resolver ?? new FakeProjectRootResolver();
  resolver.roots.set(projectKey, projectRoot);
  resolver.roots.set(secondProjectKey, secondProjectRoot);
  let clockTick = 0;
  let randomTick = 0;
  const service = new ProjectPlanningService({
    gateway,
    projects: resolver,
    clock: () => new Date(Date.UTC(2026, 6, 29, 1, 0, clockTick++)),
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

describe('ProjectPlanningService', () => {
  test('deduplicates concurrent starts and reports ordered progress for one active project task', async () => {
    const { gateway, service } = createService();
    const [first, duplicate] = await Promise.all([service.start(projectKey), service.start(projectKey)]);

    expect(first.taskId).toBe(duplicate.taskId);
    expect(first).toMatchObject({ status: 'queued', stage: 'preparing' });
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.emit({ stage: 'preparing', state: 'completed' });
    gateway.emit({ stage: 'global_outline', state: 'started' });
    await eventually(async () => {
      await expect(service.get(first.taskId)).resolves.toMatchObject({
        status: 'running',
        stage: 'global_outline',
        completedStages: ['preparing']
      });
    });
  });

  test('requests a stop idempotently and transitions to a retryable cancellation', async () => {
    const { gateway, service } = createService();
    const task = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));

    await expect(service.cancel(task.taskId)).resolves.toMatchObject({ status: 'stop_requested', canCancel: false });
    await expect(service.cancel(task.taskId)).resolves.toMatchObject({ status: 'stop_requested', canCancel: false });
    gateway.cancel();

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'cancelled', canRetry: true, error: null
      });
    });
  });

  test('succeeds when the in-flight final stage completes after a stop request', async () => {
    const { gateway, service } = createService();
    const task = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.emit({ stage: 'chapter_queue', state: 'started' });
    await service.cancel(task.taskId);
    gateway.complete();

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'succeeded', stage: 'completed', canRetry: false, error: null
      });
    });
  });

  test('retries incomplete planning with resumeIncomplete enabled', async () => {
    const { gateway, service } = createService();
    const first = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.fail(withCode('PLAN_GLOBAL_CANCELLED', 'partial plan stopped'));
    await eventually(async () => expect((await service.get(first.taskId)).status).toBe('cancelled'));

    const retry = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(2));
    expect(retry.taskId).not.toBe(first.taskId);
    expect(gateway.builds[1]?.input.resumeIncomplete).toBe(true);
    expect(gateway.builds[1]?.input.replaceInvalidComplete).toBe(false);
    gateway.complete(1);
  });

  test('fails before success when complete output is unreadable, then retries with internal replacement', async () => {
    const { gateway, service } = createService();
    const first = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.completeWithInvalidReview(withCode(
      'DESKTOP_GLOBAL_PLANNING_INVALID_OUTPUT',
      'duplicate arc IDs'
    ));

    await eventually(async () => {
      await expect(service.get(first.taskId)).resolves.toMatchObject({
        status: 'failed',
        canRetry: true,
        error: { kind: 'invalid_output' }
      });
    });

    const retry = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(2));
    expect(gateway.builds[1]?.input).toMatchObject({
      resumeIncomplete: true,
      replaceInvalidComplete: true
    });
    gateway.complete(1);
    await eventually(async () => {
      await expect(service.get(retry.taskId)).resolves.toMatchObject({
        status: 'succeeded',
        canRetry: false
      });
    });
  });

  test('does not report success when a completed build still has no readable review', async () => {
    const { gateway, service } = createService();
    const task = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.completeWithoutReview();

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'failed',
        canRetry: true,
        error: { kind: 'invalid_output' }
      });
    });
  });

  test('does not start when complete planning is already available', async () => {
    const gateway = new DeferredPlanningGateway();
    gateway.reviewResult = completedReview;
    const { service } = createService({ gateway });

    await expect(service.start(projectKey)).resolves.toMatchObject({
      status: 'failed', canRetry: false, error: { kind: 'already_complete' }
    });
    expect(gateway.build).not.toHaveBeenCalled();
  });

  test('fails safely for an unavailable project and exposes no internal details', async () => {
    const { gateway, resolver, service } = createService();
    resolver.roots.delete(projectKey);

    await expect(service.start(projectKey)).resolves.toMatchObject({
      status: 'failed', error: { kind: 'project_unavailable' }
    });
    expect(gateway.read).not.toHaveBeenCalled();
    expect(gateway.build).not.toHaveBeenCalled();
  });

  test.each([
    ['ENOENT', 'codex_unavailable'],
    ['CODEX_TIMEOUT', 'timeout'],
    ['CODEX_BINARY_NOT_FOUND', 'codex_unavailable'],
    ['CODEX_OUTPUT_MISSING', 'invalid_output'],
    ['CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', 'invalid_output'],
    ['CODEX_REPAIR_FAILED', 'invalid_output'],
    ['DESKTOP_GLOBAL_PLANNING_INCOMPLETE', 'invalid_output'],
    ['BRIEF_NOT_FOUND', 'foundation_missing'],
    ['GENRE_CONTRACT_NOT_FOUND', 'foundation_missing'],
    ['READER_PROMISE_NOT_FOUND', 'foundation_missing'],
    ['STYLE_GUIDE_NOT_FOUND', 'foundation_missing'],
    ['STORY_BIBLE_MISSING', 'foundation_missing'],
    ['PROJECT_NOT_FOUND', 'project_unavailable'],
    ['ARTIFACT_ALREADY_EXISTS', 'already_complete'],
    ['PLAN_GLOBAL_LOCKED', 'generation_busy'],
    ['OTHER_FAILURE', 'unexpected']
  ] as const)('maps %s provider and engine failures to %s', async (code, kind) => {
    const { gateway, service } = createService();
    const task = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.fail(withCode(code, '/private/project/internal failure'));

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'failed', error: { kind }
      });
    });
    expect((await service.get(task.taskId)).error?.message).not.toContain('/private/project');
  });

  test('maps explicit provider classifications before internal error codes', async () => {
    const { gateway, service } = createService();
    const task = await service.start(projectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(1));
    gateway.fail(Object.assign(new Error('secret /home/private'), {
      code: 'OTHER_FAILURE', classification: 'usage_limit'
    }));

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'failed', error: { kind: 'usage_limit' }
      });
    });
  });

  test('keeps separate active tasks for separate projects', async () => {
    const { gateway, service } = createService();
    const first = await service.start(projectKey);
    const second = await service.start(secondProjectKey);
    await eventually(() => expect(gateway.builds).toHaveLength(2));
    expect(first.taskId).not.toBe(second.taskId);
    gateway.complete(0);
    gateway.complete(1);
  });

  test('retains only the latest one hundred terminal tasks', async () => {
    const gateway = new DeferredPlanningGateway();
    gateway.autoComplete = true;
    const { resolver, service } = createService({ gateway });
    const started = await Promise.all(Array.from({ length: 101 }, async (_, index) => {
      const key = `project_retention_${index}`;
      resolver.roots.set(key, `/library/novel-${index}`);
      return service.start(key);
    }));

    await eventually(async () => expect((await service.get(started[100]!.taskId)).status).toBe('succeeded'));
    await expect(service.get(started[0]!.taskId)).rejects.toThrow('Planning task was not found.');
    await expect(service.get(started[1]!.taskId)).resolves.toMatchObject({ status: 'succeeded' });
  });
});
