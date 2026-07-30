import { describe, expect, test } from 'vitest';

import type {
  ChapterDraftReviewResult,
  ChapterInspection,
  ChapterPlanReviewResult,
  ChapterTaskKind
} from '../../src/shared/chapterContract';
import type {
  ChapterEngineGateway,
  ChapterEngineProgressEvent,
  RunChapterInput
} from '../../src/main/chapter/EngineChapterGateway';
import {
  ProjectChapterService,
  type ChapterProjectRootResolver
} from '../../src/main/chapter/ProjectChapterService';

const projectKey = 'project_radio';
const secondProjectKey = 'project_building';
const projectRoot = '/library/radio';
const secondProjectRoot = '/library/building';

const planReview: Extract<ChapterPlanReviewResult, { available: true }> = {
  available: true,
  chapterNumber: 1,
  title: 'The Radio Wakes',
  mission: {
    chapterFunction: 'Open the impossible broadcast.',
    objectives: ['Introduce the powerless radio.'],
    readerKnowledge: ['The radio works without power.'],
    readerQuestions: ['Who is calling?'],
    forbiddenMoves: ['Do not reveal the caller.']
  },
  selectedPlan: {
    title: 'Signal First',
    markdown: '# Signal First\n\nThe radio speaks first.\n'
  },
  alternatives: []
};

const draftReview: Extract<ChapterDraftReviewResult, { available: true }> = {
  available: true,
  chapterNumber: 1,
  title: 'The Radio Wakes',
  markdown: '# The Radio Wakes\n\nThe radio clicked once.\n',
  scenes: [{ summary: 'The radio names the old building.' }]
};

class MemoryProjectResolver implements ChapterProjectRootResolver {
  readonly roots = new Map([
    [projectKey, projectRoot],
    [secondProjectKey, secondProjectRoot]
  ]);

  async resolveProjectRoot(key: string): Promise<string | null> {
    return this.roots.get(key) ?? null;
  }
}

interface DeferredRun {
  input: RunChapterInput;
  kind: ChapterTaskKind;
  resolve(): void;
  reject(error: unknown): void;
}

class DeferredChapterGateway implements ChapterEngineGateway {
  readonly inspections = new Map<string, ChapterInspection>();
  readonly planReviews = new Map<string, ChapterPlanReviewResult>();
  readonly draftReviews = new Map<string, ChapterDraftReviewResult>();
  readonly runs: DeferredRun[] = [];
  autoComplete = false;
  inspectError: unknown;

  constructor() {
    this.inspections.set(projectRoot, availableInspection('not_started'));
    this.inspections.set(secondProjectRoot, availableInspection('not_started'));
  }

  async inspect(root: string): Promise<ChapterInspection> {
    if (this.inspectError !== undefined) throw this.inspectError;
    return this.inspections.get(root) ?? { available: false, reason: 'chapter_missing' };
  }

  async plan(input: RunChapterInput): Promise<void> {
    return this.startRun('planning', input);
  }

  async draft(input: RunChapterInput): Promise<void> {
    return this.startRun('drafting', input);
  }

  async readPlan(root: string): Promise<ChapterPlanReviewResult> {
    return this.planReviews.get(root) ?? { available: false, reason: 'not_ready' };
  }

  async readDraft(root: string): Promise<ChapterDraftReviewResult> {
    return this.draftReviews.get(root) ?? { available: false, reason: 'not_ready' };
  }

  emit(index: number, event: ChapterEngineProgressEvent): void {
    this.runs[index]?.input.onProgress(event);
  }

  succeed(index: number): void {
    const run = this.requireRun(index);
    if (run.kind === 'planning') {
      this.planReviews.set(run.input.projectRoot, planReview);
      this.inspections.set(run.input.projectRoot, availableInspection('plan_ready'));
    } else {
      this.draftReviews.set(run.input.projectRoot, draftReview);
      this.inspections.set(run.input.projectRoot, availableInspection('draft_ready'));
    }
    run.resolve();
  }

  succeedWithoutReview(index: number): void {
    this.requireRun(index).resolve();
  }

  succeedWithInvalidReview(index: number): void {
    const run = this.requireRun(index);
    if (run.kind === 'planning') {
      this.planReviews.set(run.input.projectRoot, {
        ...planReview,
        projectRoot: '/private/library/radio'
      } as unknown as ChapterPlanReviewResult);
    } else {
      this.draftReviews.set(run.input.projectRoot, {
        ...draftReview,
        runId: 'secret-run'
      } as unknown as ChapterDraftReviewResult);
    }
    run.resolve();
  }

  cancel(index: number): void {
    const run = this.requireRun(index);
    run.reject(withCode(
      run.kind === 'planning'
        ? 'CHAPTER_PLANNING_CANCELLED'
        : 'CHAPTER_DRAFT_CANCELLED',
      'internal cancellation'
    ));
  }

  fail(index: number, error: unknown): void {
    this.requireRun(index).reject(error);
  }

  private async startRun(kind: ChapterTaskKind, input: RunChapterInput): Promise<void> {
    if (this.autoComplete) {
      if (kind === 'planning') {
        this.planReviews.set(input.projectRoot, {
          ...planReview,
          chapterNumber: inspectionChapterNumber(
            this.inspections.get(input.projectRoot)
          )
        });
      } else {
        this.draftReviews.set(input.projectRoot, {
          ...draftReview,
          chapterNumber: inspectionChapterNumber(
            this.inspections.get(input.projectRoot)
          )
        });
      }
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.runs.push({ input, kind, resolve, reject });
    });
  }

  private requireRun(index: number): DeferredRun {
    const run = this.runs[index];
    if (run === undefined) throw new Error(`Expected chapter run ${index}.`);
    return run;
  }
}

describe('ProjectChapterService', () => {
  test('returns the same active task for repeated starts of the same kind', async () => {
    const { gateway, service } = createService();

    const [first, second] = await Promise.all([
      service.startPlanning(projectKey),
      service.startPlanning(projectKey)
    ]);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    expect(second.taskId).toBe(first.taskId);
    expect(second.kind).toBe('planning');
    gateway.succeed(0);
  });

  test('shares one project mutex across planning and drafting', async () => {
    const { gateway, service } = createService();

    const [planning, drafting] = await Promise.all([
      service.startPlanning(projectKey),
      service.startDrafting(projectKey)
    ]);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    expect(planning.kind).toBe('planning');
    expect(drafting).toMatchObject({
      kind: 'drafting',
      status: 'failed',
      error: { kind: 'generation_busy' }
    });
    expect(gateway.runs).toHaveLength(1);
    gateway.succeed(0);
  });

  test('refuses drafting unless artifact inspection reports a complete plan', async () => {
    const { gateway, service } = createService();
    gateway.inspections.set(projectRoot, availableInspection('planning_partial'));

    await expect(service.startDrafting(projectKey)).resolves.toMatchObject({
      kind: 'drafting',
      status: 'failed',
      canRetry: true,
      error: { kind: 'plan_missing' }
    });
    expect(gateway.runs).toHaveLength(0);
  });

  test.each(['plan_ready', 'drafting_partial'] as const)(
    'allows drafting from the %s artifact phase',
    async (phase) => {
      const { gateway, service } = createService();
      gateway.inspections.set(projectRoot, availableInspection(phase));

      const task = await service.startDrafting(projectKey);
      await eventually(() => expect(gateway.runs).toHaveLength(1));

      expect(task.kind).toBe('drafting');
      gateway.succeed(0);
    }
  );

  test('keeps a successful terminal state sticky after a delayed cancellation', async () => {
    const { gateway, service } = createService();
    const task = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));
    gateway.succeed(0);
    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'succeeded',
        stage: 'completed'
      });
    });

    await expect(service.cancel(task.taskId)).resolves.toMatchObject({
      status: 'succeeded',
      stage: 'completed',
      canCancel: false,
      canRetry: false
    });
  });

  test('allows an in-flight success to win after stop was requested', async () => {
    const { gateway, service } = createService();
    const task = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    await expect(service.cancel(task.taskId)).resolves.toMatchObject({
      status: 'stop_requested',
      canCancel: false
    });
    gateway.succeed(0);

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'succeeded',
        error: null
      });
    });
  });

  test.each([
    ['planning', 'CHAPTER_PLANNING_CANCELLED'],
    ['drafting', 'CHAPTER_DRAFT_CANCELLED']
  ] as const)('maps %s engine cancellation to cancelled', async (kind, code) => {
    const { gateway, service } = createService();
    if (kind === 'drafting') {
      gateway.inspections.set(projectRoot, availableInspection('plan_ready'));
    }
    const task = kind === 'planning'
      ? await service.startPlanning(projectKey)
      : await service.startDrafting(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    await service.cancel(task.taskId);
    gateway.fail(0, withCode(code, '/private/project cancellation'));

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'cancelled',
        canRetry: true,
        error: null
      });
    });
  });

  test('requires a fresh schema-valid available review before reporting success', async () => {
    const { gateway, service } = createService();
    const missing = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));
    gateway.succeedWithoutReview(0);
    await eventually(async () => {
      await expect(service.get(missing.taskId)).resolves.toMatchObject({
        status: 'failed',
        error: { kind: 'invalid_output' }
      });
    });

    gateway.inspections.set(projectRoot, availableInspection('planning_partial'));
    const invalid = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(2));
    gateway.succeedWithInvalidReview(1);
    await eventually(async () => {
      await expect(service.get(invalid.taskId)).resolves.toMatchObject({
        status: 'failed',
        error: { kind: 'invalid_output' }
      });
    });
  });

  test.each([
    [Object.assign(new Error('secret login path'), {
      classification: 'login_required'
    }), 'login_required'],
    [Object.assign(new Error('secret quota details'), {
      classification: 'usage_limit'
    }), 'usage_limit'],
    [withCode('CODEX_TIMEOUT', '/private/project timed out'), 'timeout'],
    [withCode('DESKTOP_CHAPTER_INVALID_OUTPUT', '/private/project invalid'), 'invalid_output'],
    [withCode('CODEX_BINARY_NOT_FOUND', '/private/codex absent'), 'codex_unavailable'],
    [withCode('OTHER_FAILURE', '/private/project exploded'), 'unexpected']
  ] as const)('maps engine failures to author-safe %s errors', async (error, kind) => {
    const { gateway, service } = createService();
    const task = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));
    gateway.fail(0, error);

    await eventually(async () => {
      const failed = await service.get(task.taskId);
      expect(failed).toMatchObject({
        status: 'failed',
        error: { kind }
      });
      expect(failed.error?.message).not.toMatch(/private|secret|codex absent/i);
    });
  });

  test('maps missing plans, unavailable projects, and stale chapters safely', async () => {
    const missing = createService();
    missing.gateway.inspections.set(projectRoot, {
      available: false,
      reason: 'global_plan_missing'
    });
    await expect(missing.service.startDrafting(projectKey)).resolves.toMatchObject({
      error: { kind: 'plan_missing' }
    });

    const unavailable = createService();
    unavailable.resolver.roots.delete(projectKey);
    await expect(unavailable.service.startPlanning(projectKey)).resolves.toMatchObject({
      error: { kind: 'project_unavailable' }
    });

    const stale = createService();
    stale.gateway.inspectError = withCode(
      'DESKTOP_CHAPTER_STALE',
      '/private/project stale details'
    );
    const staleTask = await stale.service.startPlanning(projectKey);
    expect(staleTask).toMatchObject({
      status: 'failed',
      canRetry: false,
      error: { kind: 'stale_chapter' }
    });
    expect(staleTask.error?.message).not.toContain('/private/project');
  });

  test('reconstructs restart inspection and start routing from artifacts alone', async () => {
    const gateway = new DeferredChapterGateway();
    gateway.inspections.set(projectRoot, availableInspection('drafting_partial'));

    const firstProcess = createService({ gateway }).service;
    await expect(firstProcess.inspect(projectKey)).resolves.toEqual(
      availableInspection('drafting_partial')
    );

    const restartedProcess = createService({ gateway }).service;
    const resumed = await restartedProcess.startDrafting(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    expect(resumed).toMatchObject({
      kind: 'drafting',
      chapterNumber: 1
    });
    gateway.succeed(0);
  });

  test('reports bounded drafting scene progress through the strict task schema', async () => {
    const { gateway, service } = createService();
    gateway.inspections.set(projectRoot, availableInspection('plan_ready'));
    const task = await service.startDrafting(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    gateway.emit(0, {
      stage: 'scene_drafts',
      state: 'progress',
      current: 1,
      total: 2
    });

    await expect(service.get(task.taskId)).resolves.toMatchObject({
      stage: 'scene_drafts',
      sceneProgress: { current: 1, total: 2 }
    });
    gateway.succeed(0);
  });

  test('retains only the latest one hundred terminal tasks', async () => {
    const gateway = new DeferredChapterGateway();
    gateway.autoComplete = true;
    const { resolver, service } = createService({ gateway });
    const started = await Promise.all(Array.from({ length: 101 }, async (_, index) => {
      const key = `project_retention_${index}`;
      const root = `/library/retention-${index}`;
      resolver.roots.set(key, root);
      gateway.inspections.set(root, {
        ...availableInspection('not_started'),
        chapterNumber: index + 1
      });
      return service.startPlanning(key);
    }));

    await eventually(async () => {
      await expect(service.get(started[100]!.taskId)).resolves.toMatchObject({
        status: 'succeeded'
      });
    });
    await expect(service.get(started[0]!.taskId))
      .rejects.toThrow('Chapter task was not found.');
    await expect(service.get(started[1]!.taskId))
      .resolves.toMatchObject({ status: 'succeeded' });
  });
});

function createService(overrides: {
  gateway?: DeferredChapterGateway;
  resolver?: MemoryProjectResolver;
} = {}) {
  const gateway = overrides.gateway ?? new DeferredChapterGateway();
  const resolver = overrides.resolver ?? new MemoryProjectResolver();
  let tick = 0;
  const service = new ProjectChapterService({
    gateway,
    projects: resolver,
    clock: () => new Date(Date.UTC(2026, 6, 30, 1, 0, tick++)),
    randomBytes: (size) => new Uint8Array(size).fill(tick % 255)
  });
  return { gateway, resolver, service };
}

function availableInspection(
  phase: Extract<ChapterInspection, { available: true }>['phase']
): Extract<ChapterInspection, { available: true }> {
  return {
    available: true,
    chapterNumber: 1,
    title: 'The Radio Wakes',
    phase
  };
}

function inspectionChapterNumber(
  inspection: ChapterInspection | undefined
): number {
  return inspection?.available ? inspection.chapterNumber : 1;
}

function withCode(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function eventually(assertion: () => void | Promise<void>): Promise<void> {
  const deadline = Date.now() + 2_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}
