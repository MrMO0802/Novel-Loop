import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import { ChapterReviewTokenStore } from '../../src/main/chapter/ChapterReviewTokenStore';

import type {
  ChapterDraftReviewResult,
  ChapterInspection,
  ChapterTaskKind
} from '../../src/shared/chapterContract';
import type {
  ChapterEngineGateway,
  ChapterEngineProgressEvent,
  RunChapterInput,
  TrustedChapterPlanReview
} from '../../src/main/chapter/EngineChapterGateway';
import { EngineChapterGateway } from '../../src/main/chapter/EngineChapterGateway';
import {
  ProjectChapterService,
  type ChapterProjectRootResolver
} from '../../src/main/chapter/ProjectChapterService';

const projectKey = 'project_radio';
const secondProjectKey = 'project_building';
const projectRoot = '/library/radio';
const secondProjectRoot = '/library/building';

const engineDesktopMocks = vi.hoisted(() => ({
  readDesktopChapterPlan: vi.fn()
}));

vi.mock('novel-loop-engine/desktop', async (importOriginal) => ({
  ...await importOriginal<typeof import('novel-loop-engine/desktop')>(),
  readDesktopChapterPlan: engineDesktopMocks.readDesktopChapterPlan
}));

const planReview: Extract<TrustedChapterPlanReview, { available: true }> = {
  available: true,
  chapterNumber: 1,
  title: 'The Radio Wakes',
  latestCommittedChapter: 0,
  reviewHash: 'a'.repeat(64),
  missionHash: 'b'.repeat(64),
  mission: {
    chapterFunction: 'Open the impossible broadcast.',
    requiredObjectives: [{
      id: 'obj_secret',
      text: 'Introduce the powerless radio.',
      type: 'plot',
      priority: 'must'
    }],
    debtsToPayOrAdvance: [{
      id: 'debt_secret',
      promise: 'Advance the mystery of the impossible signal.'
    }],
    debtsToIntroduce: [],
    characterDeltas: [{
      characterId: 'char_secret',
      characterName: 'Lin Cheng',
      from: 'skeptical',
      to: 'alert',
      evidenceRequired: 'He records the frequency.'
    }],
    participants: [{
      characterId: 'char_secret',
      name: 'Lin Cheng',
      role: 'protagonist',
      origin: 'committed',
      selected: true
    }],
    readerInformationDelta: {
      newKnowledge: ['The radio works without power.'],
      newSuspicions: [],
      questionsToMaintain: ['Who is calling?'],
      questionsToAnswer: []
    },
    forbiddenMoves: ['Do not reveal the caller.'],
    targetEmotionalCurve: ['unease', 'resolve'],
    targetWordCount: 3_000
  },
  directions: [{
    candidateId: 'plan_001',
    title: 'Signal First',
    markdown: '# Signal First\n\nThe radio speaks first.\n',
    excerpt: 'The radio speaks first.',
    strengths: ['Immediate hook.'],
    risks: ['Needs a grounded reaction.'],
    aiRecommended: true,
    active: true
  }, {
    candidateId: 'plan_002',
    title: 'Building First',
    markdown: '# Building First\n\nOpen at the abandoned building.\n',
    excerpt: 'Open at the abandoned building.',
    strengths: ['Immediate atmosphere.'],
    risks: ['Delays the radio hook.'],
    aiRecommended: false,
    active: false
  }]
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

interface AdjustmentResult {
  revisionId: string;
  sourceHash: string;
  candidate: {
    artifactKind: 'mission' | 'plan';
    title: string;
    markdown: string;
  };
}

interface DeferredAdjustment {
  input: {
    projectRoot: string;
    chapterNumber: number;
    authorInstruction: string;
    expectedSourceHash: string;
    shouldStop(): boolean;
    onStage(stage: 'requesting_adjustment' | 'validating_adjustment' | 'ready_for_review'): void;
  };
  kind: 'mission' | 'plan';
  resolve(value: AdjustmentResult): void;
  reject(error: unknown): void;
}

class DeferredChapterGateway implements ChapterEngineGateway {
  readonly inspections = new Map<string, ChapterInspection>();
  readonly planReviews = new Map<string, TrustedChapterPlanReview>();
  readonly draftReviews = new Map<string, ChapterDraftReviewResult>();
  readonly runs: DeferredRun[] = [];
  readonly selections: unknown[] = [];
  readonly missionRevisions: unknown[] = [];
  readonly planRevisions: unknown[] = [];
  readonly adoptions: unknown[] = [];
  readonly adjustments: DeferredAdjustment[] = [];
  autoComplete = false;
  inspectError: unknown;
  planReviewError: unknown;
  draftReviewError: unknown;
  authoringError: unknown;

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

  async adjustMission(input: DeferredAdjustment['input']) {
    return this.startAdjustment('mission', input);
  }

  async adjustPlan(input: DeferredAdjustment['input'] & {
    sourcePlan: {
      candidateId: string;
      content: string;
      active: boolean;
    };
  }) {
    return this.startAdjustment('plan', input);
  }

  async readPlan(root: string): Promise<TrustedChapterPlanReview> {
    if (this.planReviewError !== undefined) throw this.planReviewError;
    return this.planReviews.get(root) ?? { available: false, reason: 'not_ready' };
  }

  async readDraft(root: string): Promise<ChapterDraftReviewResult> {
    if (this.draftReviewError !== undefined) throw this.draftReviewError;
    return this.draftReviews.get(root) ?? { available: false, reason: 'not_ready' };
  }

  async selectDirection(input: unknown): Promise<void> {
    if (this.authoringError !== undefined) throw this.authoringError;
    this.selections.push(input);
  }

  async createMissionRevision(input: unknown): Promise<{
    revisionId: string;
    sourceHash: string;
  }> {
    if (this.authoringError !== undefined) throw this.authoringError;
    this.missionRevisions.push(input);
    return {
      revisionId: `author_revision_ch001_mission_v${this.missionRevisions.length}`,
      sourceHash: 'b'.repeat(64)
    };
  }

  async createPlanRevision(input: unknown): Promise<{
    revisionId: string;
    sourceHash: string;
  }> {
    if (this.authoringError !== undefined) throw this.authoringError;
    this.planRevisions.push(input);
    return {
      revisionId: `author_revision_ch001_plan_v${this.planRevisions.length}`,
      sourceHash: 'c'.repeat(64)
    };
  }

  async adoptRevision(input: unknown): Promise<void> {
    if (this.authoringError !== undefined) throw this.authoringError;
    this.adoptions.push(input);
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
        reviewHash: 'not-a-hash'
      });
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

  emitAdjustment(
    index: number,
    stage: 'requesting_adjustment' | 'validating_adjustment' | 'ready_for_review'
  ): void {
    this.adjustments[index]?.input.onStage(stage);
  }

  succeedAdjustment(index: number): void {
    const adjustment = this.adjustments[index];
    if (adjustment === undefined) throw new Error(`Expected adjustment ${index}.`);
    adjustment.resolve({
      revisionId: adjustment.kind === 'mission'
        ? 'author_revision_ch001_mission_v1'
        : 'author_revision_ch001_plan_v1',
      sourceHash: adjustment.input.expectedSourceHash,
      candidate: adjustment.kind === 'mission'
        ? {
            artifactKind: 'mission',
            title: '调整后的本章任务',
            markdown: '## 本章目的\n\n收紧本章任务。\n'
          }
        : {
            artifactKind: 'plan',
            title: '事故现场先行',
            markdown: '# 事故现场先行\n\n先展示重复事故。\n'
          }
    });
  }

  failAdjustment(index: number, error: unknown): void {
    const adjustment = this.adjustments[index];
    if (adjustment === undefined) throw new Error(`Expected adjustment ${index}.`);
    adjustment.reject(error);
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

  private async startAdjustment(
    kind: 'mission' | 'plan',
    input: DeferredAdjustment['input']
  ): Promise<AdjustmentResult> {
    return new Promise((resolve, reject) => {
      this.adjustments.push({
        input,
        kind,
        resolve,
        reject
      });
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
    emitEngineCompletion(gateway, 0);
    gateway.succeedWithoutReview(0);
    await eventually(async () => {
      const failed = await service.get(missing.taskId);
      expect(failed).toMatchObject({
        status: 'failed',
        stage: 'finalizing',
        error: { kind: 'invalid_output' }
      });
      expect(failed.completedStages).not.toContain('completed');
    });

    gateway.inspections.set(projectRoot, availableInspection('planning_partial'));
    const invalid = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(2));
    emitEngineCompletion(gateway, 1);
    gateway.succeedWithInvalidReview(1);
    await eventually(async () => {
      const failed = await service.get(invalid.taskId);
      expect(failed).toMatchObject({
        status: 'failed',
        stage: 'finalizing',
        error: { kind: 'invalid_output' }
      });
      expect(failed.completedStages).not.toContain('completed');
    });
  });

  test('classifies unavailable plan and draft reviews without exposing internal errors', async () => {
    const notReady = createService();
    await expect(notReady.service.readPlan(projectKey)).resolves.toEqual({
      available: false,
      reason: 'not_ready'
    });

    const invalidPlan = createService();
    invalidPlan.gateway.planReviewError = withCode(
      'DESKTOP_CHAPTER_INVALID_OUTPUT',
      '/private/library/radio/planning/ranking.json is invalid'
    );
    await expect(invalidPlan.service.readPlan(projectKey)).resolves.toEqual({
      available: false,
      reason: 'invalid_output'
    });

    const invalidDraft = createService();
    invalidDraft.gateway.draftReviewError = withCode(
      'ZOD_INVALID_OUTPUT',
      '/private/library/radio/chapters/chapter_001/draft_v1.md is invalid'
    );
    await expect(invalidDraft.service.readDraft(projectKey)).resolves.toEqual({
      available: false,
      reason: 'invalid_output'
    });

    const unavailable = createService();
    unavailable.gateway.planReviewError = withCode(
      'ENOENT',
      '/private/library/radio disappeared'
    );
    const result = await unavailable.service.readPlan(projectKey);
    expect(result).toEqual({
      available: false,
      reason: 'project_unavailable'
    });
    expect(JSON.stringify(result)).not.toMatch(/private|ranking\.json|draft_v1\.md/i);
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

  test.each([
    ['planning', 'project_unavailable'],
    ['drafting', 'plan_missing']
  ] as const)(
    'maps a late unavailable engine result for %s to %s',
    async (taskKind, errorKind) => {
      const { gateway, service } = createService();
      if (taskKind === 'drafting') {
        gateway.inspections.set(projectRoot, availableInspection('plan_ready'));
      }
      const task = taskKind === 'planning'
        ? await service.startPlanning(projectKey)
        : await service.startDrafting(projectKey);
      await eventually(() => expect(gateway.runs).toHaveLength(1));
      gateway.fail(0, withCode(
        'DESKTOP_CHAPTER_UNAVAILABLE',
        '/private/project artifacts disappeared'
      ));

      await eventually(async () => {
        const failed = await service.get(task.taskId);
        expect(failed).toMatchObject({
          status: 'failed',
          error: { kind: errorKind }
        });
        expect(failed.error?.message).not.toContain('/private/project');
        if (taskKind === 'planning') {
          expect(failed.error?.message).not.toMatch(/plan before drafting/i);
        }
      });
    }
  );

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

  test('maps trusted plan, mission, and participant bindings to opaque renderer tokens', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);

    const review = await readAvailablePlan(service);
    expect(review.reviewToken).toMatch(/^chapter_review_[a-f0-9]{48}$/u);
    expect(review.directions).toHaveLength(2);
    expect(review.directions.every(({ optionToken }) => (
      /^chapter_option_[a-f0-9]{48}$/u.test(optionToken)
    ))).toBe(true);
    expect(review.selectedPlan).toEqual({
      title: 'Signal First',
      markdown: '# Signal First\n\nThe radio speaks first.\n'
    });
    expect(review.alternatives).toEqual([{
      title: 'Building First',
      excerpt: 'Open at the abandoned building.',
      strengths: ['Immediate atmosphere.'],
      risks: ['Delays the radio hook.']
    }]);
    expect(JSON.stringify(review)).not.toMatch(
      /\/library\/|plan_\d|obj_secret|debt_secret|char_secret|[a-f0-9]{64}|schema|runId|provider|profile|auth/iu
    );
  });

  test('resolves direction tokens before selection or alternative plan save', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const alternative = review.directions.find(({ active }) => !active)!;

    await expect(service.selectDirection({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: alternative.optionToken
    })).resolves.toEqual({ outcome: 'adopted' });
    expect(gateway.selections).toEqual([{
      projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_002',
      expectedReviewHash: 'a'.repeat(64)
    }]);

    const saved = await service.savePlanWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: alternative.optionToken,
      markdown: '# Building revised\n\nThe radio waits upstairs.\n'
    });
    expect(saved).toMatchObject({
      outcome: 'saved',
      revisionToken: expect.stringMatching(/^chapter_revision_[a-f0-9]{48}$/u)
    });
    expect(gateway.planRevisions).toEqual([{
      projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_002',
      expectedReviewHash: 'a'.repeat(64),
      markdown: '# Building revised\n\nThe radio waits upstairs.\n'
    }]);
  });

  test('runs mission and plan adjustments as cancellable tasks with opaque ready revisions', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const alternative = review.directions.find(({ active }) => !active)!;

    const missionTask = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));
    expect(missionTask).toMatchObject({
      kind: 'mission_adjustment',
      status: 'queued'
    });
    expect(gateway.adjustments[0]?.input).toMatchObject({
      projectRoot,
      chapterNumber: 1,
      expectedSourceHash: 'b'.repeat(64),
      authorInstruction: '收紧本章任务。'
    });
    gateway.emitAdjustment(0, 'requesting_adjustment');
    gateway.emitAdjustment(0, 'validating_adjustment');
    gateway.succeedAdjustment(0);
    await eventually(async () => {
      const completed = await service.get(missionTask.taskId);
      expect(completed).toMatchObject({
        kind: 'mission_adjustment',
        status: 'succeeded',
        stage: 'ready_for_review',
        resultRevisionToken: expect.stringMatching(
          /^chapter_revision_[a-f0-9]{48}$/u
        ),
        resultCandidate: {
          artifactKind: 'mission',
          title: '调整后的本章任务'
        }
      });
      expect(JSON.stringify(completed)).not.toMatch(
        /author_revision|sourceHash|plan_\d|\/library\//iu
      );
    });

    const planTask = await service.adjustPlan({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: alternative.optionToken,
      authorInstruction: '把开场提前到事故现场。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(2));
    expect(gateway.adjustments[1]?.input).toMatchObject({
      projectRoot,
      chapterNumber: 1,
      expectedSourceHash: sha256(planReview.directions[1]!.markdown),
      authorInstruction: '把开场提前到事故现场。',
      sourcePlan: {
        candidateId: 'plan_002',
        content: planReview.directions[1]!.markdown,
        active: false
      }
    });
    gateway.succeedAdjustment(1);
    await eventually(async () => {
      await expect(service.get(planTask.taskId)).resolves.toMatchObject({
        kind: 'plan_adjustment',
        status: 'succeeded',
        stage: 'ready_for_review',
        resultCandidate: { artifactKind: 'plan', title: '事故现场先行' }
      });
    });
    expect(gateway.adoptions).toHaveLength(0);
  });

  test('cancels an adjustment through the shared task lifecycle without creating a token', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));

    await expect(service.cancel(task.taskId)).resolves.toMatchObject({
      status: 'stop_requested',
      canCancel: false
    });
    expect(gateway.adjustments[0]!.input.shouldStop()).toBe(true);
    gateway.failAdjustment(0, withCode(
      'CHAPTER_ADJUSTMENT_CANCELLED',
      '/private/internal cancellation'
    ));

    await eventually(async () => {
      const cancelled = await service.get(task.taskId);
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        canRetry: true
      });
      expect(cancelled.resultRevisionToken).toBeUndefined();
    });
  });

  test('resolves mission item tokens while new participants remain name and role only', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const objective = review.mission.objectiveItems[0]!;
    const debt = review.mission.debtItems[0]!;
    const participant = review.mission.participantOptions[0]!;

    const result = await service.saveMissionWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      mission: {
        chapterFunction: review.mission.chapterFunction,
        requiredObjectives: [{
          itemToken: objective.itemToken,
          text: objective.text,
          type: objective.type,
          priority: objective.priority
        }, {
          itemToken: null,
          text: 'Make the radio answer a second time.',
          type: 'foreshadowing',
          priority: 'should'
        }],
        debtTokens: [debt.itemToken],
        debtsToIntroduce: [{
          type: 'mystery',
          promise: 'The caller remembers tomorrow.',
          importance: 8
        }],
        characterDeltas: [{
          participantToken: participant.participantToken,
          from: 'skeptical',
          to: 'alert',
          evidenceRequired: 'He records the frequency.'
        }],
        participantTokens: [participant.participantToken],
        newParticipants: [{ name: 'Mara', role: 'caller' }],
        readerInformation: review.mission.readerInformation,
        forbiddenMoves: review.mission.forbiddenMoves,
        targetEmotionalCurve: review.mission.targetEmotionalCurve,
        targetWordCount: review.mission.targetWordCount
      }
    });

    expect(result.outcome).toBe('saved');
    expect(gateway.missionRevisions).toEqual([{
      projectRoot,
      chapterNumber: 1,
      edit: {
        sourceMissionHash: 'b'.repeat(64),
        chapterFunction: 'Open the impossible broadcast.',
        requiredObjectives: [{
          sourceObjectiveId: 'obj_secret',
          text: 'Introduce the powerless radio.',
          type: 'plot',
          priority: 'must'
        }, {
          sourceObjectiveId: null,
          text: 'Make the radio answer a second time.',
          type: 'foreshadowing',
          priority: 'should'
        }],
        debtsToPayOrAdvance: ['debt_secret'],
        debtsToIntroduce: [{
          type: 'mystery',
          promise: 'The caller remembers tomorrow.',
          importance: 8
        }],
        characterDeltas: [{
          characterId: 'char_secret',
          from: 'skeptical',
          to: 'alert',
          evidenceRequired: 'He records the frequency.'
        }],
        participatingCharacterIds: ['char_secret'],
        newCharacters: [{ name: 'Mara', role: 'caller' }],
        readerInformationDelta: review.mission.readerInformation,
        forbiddenMoves: review.mission.forbiddenMoves,
        targetEmotionalCurve: review.mission.targetEmotionalCurve,
        targetWordCount: 3_000
      }
    }]);
  });

  test('rejects cross-project review tokens and consumes adoption tokens once', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    gateway.planReviews.set(secondProjectRoot, planReview);
    const review = await readAvailablePlan(service);
    const active = review.directions.find(({ active }) => active)!;

    await expect(service.selectDirection({
      projectKey: secondProjectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(gateway.selections).toHaveLength(0);

    const saved = await service.savePlanWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken,
      markdown: '# Signal revised\n\nThe radio speaks twice.\n'
    });
    if (saved.outcome !== 'saved') throw new Error('Expected a saved revision.');
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'adopted' });
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(gateway.adoptions).toHaveLength(1);
  });

  test('keeps a revision token retryable after busy adoption and consumes it on success', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const active = review.directions.find(({ active }) => active)!;
    const saved = await service.savePlanWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken,
      markdown: '# Retryable revision\n\nThe radio speaks twice.\n'
    });
    if (saved.outcome !== 'saved') throw new Error('Expected a saved revision.');

    gateway.authoringError = withCode('PROJECT_OPERATION_BUSY', 'lease busy');
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'blocked', messageKey: 'generation_busy' });

    gateway.authoringError = undefined;
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'adopted' });
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(gateway.adoptions).toHaveLength(1);
  });

  test('protects a reserved oldest revision at capacity through busy release and retry', async () => {
    const tokenContext = createTokenStore();
    const revisions = Array.from({ length: 500 }, (_, index) => (
      tokenContext.store.createRevision(revisionTokenInput(index))
    ));
    const gateway = new DeferredChapterGateway();
    gateway.planReviews.set(projectRoot, planReview);
    const service = new ProjectChapterService({
      gateway,
      projects: new MemoryProjectResolver(),
      tokenStore: tokenContext.store
    });
    let reportAdoptionStarted!: () => void;
    const adoptionStarted = new Promise<void>((resolve) => {
      reportAdoptionStarted = resolve;
    });
    let releaseBusyAdoption!: () => void;
    const busyAdoption = new Promise<void>((resolve) => {
      releaseBusyAdoption = resolve;
    });
    const successfulAdoption = gateway.adoptRevision.bind(gateway);
    gateway.adoptRevision = async () => {
      reportAdoptionStarted();
      await busyAdoption;
      throw withCode('PROJECT_OPERATION_BUSY', 'lease busy');
    };

    const firstAttempt = service.adoptRevision({
      projectKey,
      revisionToken: revisions[0]!,
      confirmInvalidation: true
    });
    await adoptionStarted;
    expect(tokenContext.store.reserveRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(tokenContext.store.reserveRevision({
      projectKey: secondProjectKey,
      projectRoot: secondProjectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });

    const replacement = tokenContext.store.createRevision({
      ...revisionTokenInput(500),
      projectKey: secondProjectKey,
      projectRoot: secondProjectRoot
    });
    releaseBusyAdoption();
    await expect(firstAttempt).resolves.toEqual({
      outcome: 'blocked',
      messageKey: 'generation_busy'
    });

    gateway.adoptRevision = successfulAdoption;
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: revisions[0]!,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'adopted' });
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: revisions[0]!,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(gateway.adoptions).toHaveLength(1);
    expect(tokenContext.store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[1]!,
      currentLatestCommittedChapter: 0
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(tokenContext.store.consumeRevision({
      projectKey: secondProjectKey,
      projectRoot: secondProjectRoot,
      revisionToken: replacement,
      currentLatestCommittedChapter: 0
    }).outcome).toBe('resolved');
  });

  test('keeps a stale-source revision token retryable after a non-mutating failure', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const active = review.directions.find(({ active }) => active)!;
    const saved = await service.savePlanWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken,
      markdown: '# Stale source revision\n\nThe radio speaks twice.\n'
    });
    if (saved.outcome !== 'saved') throw new Error('Expected a saved revision.');

    gateway.authoringError = withCode(
      'DESKTOP_CHAPTER_EDIT_STALE',
      'source changed'
    );
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });

    gateway.authoringError = undefined;
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'adopted' });
  });

  test('blocks authoring during active and starting generation operations', async () => {
    const { gateway, resolver, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const active = review.directions.find(({ active }) => active)!;

    const task = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));
    await expect(service.selectDirection({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken
    })).resolves.toEqual({
      outcome: 'blocked',
      messageKey: 'generation_busy'
    });
    gateway.succeed(0);
    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'succeeded'
      });
    });

    let releaseRoot!: () => void;
    const rootGate = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    let gateRoot = true;
    const originalResolve = resolver.resolveProjectRoot.bind(resolver);
    resolver.resolveProjectRoot = async (key) => {
      if (gateRoot) await rootGate;
      return originalResolve(key);
    };
    gateway.inspections.set(projectRoot, availableInspection('planning_partial'));
    const starting = service.startPlanning(projectKey);
    await Promise.resolve();
    await expect(service.savePlanWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken,
      markdown: '# Busy edit\n'
    })).resolves.toEqual({
      outcome: 'blocked',
      messageKey: 'generation_busy'
    });
    gateRoot = false;
    releaseRoot();
    const startingTask = await starting;
    await eventually(() => expect(gateway.runs).toHaveLength(2));
    gateway.succeed(1);
    await eventually(async () => {
      await expect(service.get(startingTask.taskId)).resolves.toMatchObject({
        status: 'succeeded'
      });
    });
  });

  test.each([
    ['DESKTOP_CHAPTER_EDIT_STALE', 'stale', 'stale_edit'],
    ['CHAPTER_PARTICIPANT_ROSTER_MISSING', 'blocked', 'participant_roster_missing'],
    ['DESKTOP_CHAPTER_INVALID_OUTPUT', 'invalid', 'invalid_output'],
    ['PROJECT_OPERATION_BUSY', 'blocked', 'generation_busy']
  ] as const)('maps %s without exposing engine errors', async (
    code,
    outcome,
    messageKey
  ) => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const active = review.directions.find(({ active }) => active)!;
    gateway.authoringError = withCode(code, '/home/author/private engine error');

    const result = await service.selectDirection({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken
    });
    expect(result).toEqual({ outcome, messageKey });
    expect(JSON.stringify(result)).not.toMatch(/home|private|engine/i);
  });
});

describe('EngineChapterGateway plan candidate containment', () => {
  test('rejects a traversal candidate ID before reading candidate Markdown', async () => {
    const fixture = await createGatewayArtifactFixture('../../../outside/secret');
    await mkdir(path.join(fixture.projectRoot, 'outside'), { recursive: true });
    await writeFile(
      path.join(fixture.projectRoot, 'outside', 'secret.md'),
      '# Outside\n\nThis must never be read.\n',
      'utf8'
    );

    try {
      await expect(new EngineChapterGateway().readPlan(fixture.projectRoot))
        .rejects.toMatchObject({ code: 'DESKTOP_CHAPTER_INVALID_OUTPUT' });
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true });
    }
  });

  test('rejects a plan_candidates root reached through an ancestor symlink', async () => {
    const fixture = await createGatewayArtifactFixture('plan_001', false);
    const outsideCandidates = path.join(fixture.tempRoot, 'outside-candidates');
    await mkdir(outsideCandidates, { recursive: true });
    await writeFile(
      path.join(outsideCandidates, 'plan_001.md'),
      '# Outside\n\nThis must never be read.\n',
      'utf8'
    );
    await symlink(outsideCandidates, fixture.candidatesRoot, 'dir');

    try {
      await expect(new EngineChapterGateway().readPlan(fixture.projectRoot))
        .rejects.toMatchObject({ code: 'DESKTOP_CHAPTER_INVALID_OUTPUT' });
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true });
    }
  });
});

describe('ChapterReviewTokenStore', () => {
  test('creates 192-bit project-bound and purpose-bound review options', () => {
    const { store } = createTokenStore();
    const created = store.createReview({
      projectKey,
      projectRoot,
      chapterNumber: 1,
      latestCommittedChapter: 0,
      reviewHash: 'a'.repeat(64),
      missionHash: 'b'.repeat(64),
      options: [
        { purpose: 'direction', trustedId: 'plan_001' },
        { purpose: 'objective', trustedId: 'obj_secret' }
      ]
    });

    expect(created.reviewToken).toMatch(/^chapter_review_[a-f0-9]{48}$/u);
    expect(created.options).toHaveLength(2);
    expect(created.options[0]?.optionToken)
      .toMatch(/^chapter_option_[a-f0-9]{48}$/u);

    expect(store.resolveOption({
      projectKey,
      projectRoot,
      reviewToken: created.reviewToken,
      optionToken: created.options[0]!.optionToken,
      purpose: 'direction',
      currentLatestCommittedChapter: 0,
      currentReviewHash: 'a'.repeat(64)
    })).toMatchObject({
      outcome: 'resolved',
      value: {
        chapterNumber: 1,
        trustedId: 'plan_001',
        missionHash: 'b'.repeat(64)
      }
    });
    expect(store.resolveOption({
      projectKey,
      projectRoot,
      reviewToken: created.reviewToken,
      optionToken: created.options[0]!.optionToken,
      purpose: 'objective',
      currentLatestCommittedChapter: 0,
      currentReviewHash: 'a'.repeat(64)
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
  });

  test('returns fresh stale results for cross-project, re-bound, changed, and expired reviews', () => {
    const context = createTokenStore();
    const created = context.store.createReview(reviewTokenInput());
    const base = {
      projectKey,
      projectRoot,
      reviewToken: created.reviewToken,
      currentLatestCommittedChapter: 0,
      currentReviewHash: 'a'.repeat(64)
    };

    const failures = [
      context.store.resolveReview({ ...base, projectKey: secondProjectKey }),
      context.store.resolveReview({ ...base, projectRoot: secondProjectRoot }),
      context.store.resolveReview({
        ...base,
        currentLatestCommittedChapter: 1
      }),
      context.store.resolveReview({ ...base, currentReviewHash: 'c'.repeat(64) })
    ];
    for (const failure of failures) {
      expect(failure).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    }
    expect(failures[0]).not.toBe(failures[1]);

    context.advance(30 * 60 * 1_000);
    expect(context.store.resolveReview(base)).toEqual({
      outcome: 'stale',
      messageKey: 'stale_edit'
    });
  });

  test('retains at most two hundred review bindings', () => {
    const { store } = createTokenStore();
    const reviews = Array.from({ length: 201 }, (_, index) => (
      store.createReview({
        ...reviewTokenInput(),
        chapterNumber: index + 1
      })
    ));
    const resolution = (reviewToken: string) => store.resolveReview({
      projectKey,
      projectRoot,
      reviewToken,
      currentLatestCommittedChapter: 0,
      currentReviewHash: 'a'.repeat(64)
    });

    expect(resolution(reviews[0]!.reviewToken).outcome).toBe('stale');
    expect(resolution(reviews[1]!.reviewToken).outcome).toBe('resolved');
    expect(resolution(reviews[200]!.reviewToken).outcome).toBe('resolved');
  });

  test('retains five hundred revision bindings and consumes adoption once', () => {
    const { store } = createTokenStore();
    const revisions = Array.from({ length: 501 }, (_, index) => (
      store.createRevision({
        projectKey,
        projectRoot,
        chapterNumber: 1,
        latestCommittedChapter: 0,
        purpose: index % 2 === 0 ? 'plan' : 'mission',
        sourceHash: String(index).padStart(64, '0'),
        revisionId: `author_revision_${index + 1}`
      })
    ));

    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    }).outcome).toBe('stale');
    expect(store.consumeRevision({
      projectKey: secondProjectKey,
      projectRoot,
      revisionToken: revisions[500]!,
      currentLatestCommittedChapter: 0
    }).outcome).toBe('stale');

    const consumed = store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[500]!,
      currentLatestCommittedChapter: 0
    });
    expect(consumed).toMatchObject({
      outcome: 'resolved',
      value: {
        purpose: 'plan',
        revisionId: 'author_revision_501'
      }
    });
    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[500]!,
      currentLatestCommittedChapter: 0
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
  });

  test('rejects revision tokens after chapter advance or thirty-minute expiry', () => {
    const context = createTokenStore();
    const revisionToken = context.store.createRevision({
      projectKey,
      projectRoot,
      chapterNumber: 1,
      latestCommittedChapter: 0,
      purpose: 'plan',
      sourceHash: 'c'.repeat(64),
      revisionId: 'author_revision_ch001_plan_v1'
    });

    expect(context.store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken,
      currentLatestCommittedChapter: 1
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    context.advance(30 * 60 * 1_000);
    expect(context.store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken,
      currentLatestCommittedChapter: 0
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
  });

  test('fails bounded allocation when every revision binding is reserved', () => {
    const { store } = createTokenStore();
    const revisions = Array.from({ length: 500 }, (_, index) => {
      const secondProject = index % 2 === 1;
      const input = {
        ...revisionTokenInput(index),
        ...(secondProject
          ? { projectKey: secondProjectKey, projectRoot: secondProjectRoot }
          : {})
      };
      const revisionToken = store.createRevision(input);
      expect(store.reserveRevision({
        projectKey: input.projectKey,
        projectRoot: input.projectRoot,
        revisionToken,
        currentLatestCommittedChapter: 0
      }).outcome).toBe('resolved');
      return { input, revisionToken };
    });

    expect(() => store.createRevision(revisionTokenInput(500)))
      .toThrow('Chapter revision token capacity is fully reserved.');
    for (const { revisionToken } of revisions) {
      store.releaseRevision(revisionToken);
    }
    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!.revisionToken,
      currentLatestCommittedChapter: 0
    }).outcome).toBe('resolved');
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
    tokenStore: createTokenStore().store,
    clock: () => new Date(Date.UTC(2026, 6, 30, 1, 0, tick++)),
    randomBytes: (size) => new Uint8Array(size).fill(tick % 255)
  });
  return { gateway, resolver, service };
}

async function createGatewayArtifactFixture(
  candidateId: string,
  createCandidatesRoot = true
): Promise<{
  tempRoot: string;
  projectRoot: string;
  candidatesRoot: string;
}> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'chapter-gateway-security-'));
  const projectRoot = path.join(tempRoot, 'gateway-project');
  const chapterRoot = path.join(projectRoot, 'chapters', 'chapter_001');
  const candidatesRoot = path.join(chapterRoot, 'plan_candidates');
  await Promise.all([
    mkdir(path.join(projectRoot, 'state'), { recursive: true }),
    mkdir(path.join(projectRoot, 'planning'), { recursive: true }),
    mkdir(chapterRoot, { recursive: true }),
    ...(createCandidatesRoot
      ? [mkdir(candidatesRoot, { recursive: true })]
      : [])
  ]);
  await Promise.all([
    writeFile(path.join(projectRoot, 'state', 'story_state.json'), JSON.stringify({
      projectId: 'gateway-project',
      latestCommittedChapter: 0,
      characters: [{ id: 'char_main', name: 'Lin', role: 'lead' }],
      narrativeDebts: []
    }), 'utf8'),
    writeFile(path.join(projectRoot, 'planning', 'chapter_queue.json'), '{}', 'utf8'),
    writeFile(path.join(chapterRoot, 'mission.json'), JSON.stringify({
      chapterNumber: 1,
      chapterFunction: 'Open the signal.',
      requiredObjectives: [],
      debtsToPayOrAdvance: [],
      debtsToIntroduce: [],
      characterDeltas: [],
      participatingCharacterIds: ['char_main'],
      charactersToIntroduce: [],
      readerInformationDelta: {
        newKnowledge: [],
        newSuspicions: [],
        questionsToMaintain: [],
        questionsToAnswer: []
      },
      forbiddenMoves: [],
      targetEmotionalCurve: []
    }), 'utf8'),
    writeFile(path.join(chapterRoot, 'ranking.json'), JSON.stringify({
      chapterNumber: 1,
      selectedCandidateId: candidateId,
      candidates: [{ candidateId, strengths: [], risks: [] }]
    }), 'utf8'),
    writeFile(
      path.join(chapterRoot, 'selected_plan.md'),
      '# Selected\n\nThe selected plan.\n',
      'utf8'
    )
  ]);
  engineDesktopMocks.readDesktopChapterPlan.mockResolvedValue({
    available: true,
    chapterNumber: 1,
    title: 'Gateway Project'
  });
  return { tempRoot, projectRoot, candidatesRoot };
}

async function readAvailablePlan(service: ProjectChapterService) {
  const review = await service.readPlan(projectKey);
  if (!review.available) throw new Error('Expected an available plan review.');
  return review;
}

function createTokenStore() {
  let now = 1_000;
  let sequence = 0;
  const store = new ChapterReviewTokenStore({
    now: () => now,
    randomBytes: (size) => {
      expect(size).toBe(24);
      const bytes = new Uint8Array(size);
      sequence += 1;
      new DataView(bytes.buffer).setUint32(0, sequence);
      return bytes;
    }
  });
  return {
    store,
    advance(milliseconds: number) {
      now += milliseconds;
    }
  };
}

function reviewTokenInput() {
  return {
    projectKey,
    projectRoot,
    chapterNumber: 1,
    latestCommittedChapter: 0,
    reviewHash: 'a'.repeat(64),
    missionHash: 'b'.repeat(64),
    options: [{ purpose: 'direction' as const, trustedId: 'plan_001' }]
  };
}

function revisionTokenInput(index: number) {
  return {
    projectKey,
    projectRoot,
    chapterNumber: 1,
    latestCommittedChapter: 0,
    purpose: 'plan' as const,
    sourceHash: String(index).padStart(64, '0'),
    revisionId: `author_revision_${index + 1}`
  };
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emitEngineCompletion(
  gateway: DeferredChapterGateway,
  index: number
): void {
  gateway.emit(index, { stage: 'finalizing', state: 'completed' });
  gateway.emit(index, { stage: 'completed', state: 'completed' });
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
