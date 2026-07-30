import { randomBytes as nodeRandomBytes } from 'node:crypto';

import {
  ChapterDraftReviewResultSchema,
  ChapterInspectionSchema,
  ChapterPlanReviewResultSchema,
  ChapterTaskSchema,
  type ChapterDraftReviewResult,
  type ChapterErrorKind,
  type ChapterInspection,
  type ChapterPlanReviewResult,
  type ChapterTask,
  type ChapterTaskKind,
  type ChapterTaskStage
} from '../../shared/chapterContract';
import type {
  ChapterEngineGateway,
  ChapterEngineProgressEvent
} from './EngineChapterGateway';

const MAX_TERMINAL_TASKS = 100;

export interface ChapterProjectRootResolver {
  resolveProjectRoot(projectKey: string): Promise<string | null>;
}

export interface ChapterApplicationService {
  inspect(projectKey: string): Promise<ChapterInspection>;
  startPlanning(projectKey: string): Promise<ChapterTask>;
  startDrafting(projectKey: string): Promise<ChapterTask>;
  get(taskId: string): Promise<ChapterTask>;
  cancel(taskId: string): Promise<ChapterTask>;
  readPlan(projectKey: string): Promise<ChapterPlanReviewResult>;
  readDraft(projectKey: string): Promise<ChapterDraftReviewResult>;
}

export interface ProjectChapterServiceDependencies {
  projects: ChapterProjectRootResolver;
  gateway: ChapterEngineGateway;
  clock?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
}

interface InternalChapterTask {
  task: ChapterTask;
  stopRequested: boolean;
  terminal: boolean;
  retained: boolean;
}

interface StartingTask {
  kind: ChapterTaskKind;
  promise: Promise<ChapterTask>;
}

export class ProjectChapterService implements ChapterApplicationService {
  private readonly clock: () => Date;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly tasks = new Map<string, InternalChapterTask>();
  private readonly activeByProject = new Map<string, string>();
  private readonly startingByProject = new Map<string, StartingTask>();
  private readonly terminalTaskIds: string[] = [];

  constructor(private readonly dependencies: ProjectChapterServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  }

  async inspect(projectKey: string): Promise<ChapterInspection> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return ChapterInspectionSchema.parse({
        available: false,
        reason: 'project_unavailable'
      });
    }

    try {
      return ChapterInspectionSchema.parse(
        await this.dependencies.gateway.inspect(projectRoot)
      );
    } catch (error) {
      const kind = toInspectionErrorKind(error);
      return ChapterInspectionSchema.parse({
        available: false,
        reason: kind
      });
    }
  }

  async startPlanning(projectKey: string): Promise<ChapterTask> {
    return this.start(projectKey, 'planning');
  }

  async startDrafting(projectKey: string): Promise<ChapterTask> {
    return this.start(projectKey, 'drafting');
  }

  async get(taskId: string): Promise<ChapterTask> {
    return this.requireTask(taskId);
  }

  async cancel(taskId: string): Promise<ChapterTask> {
    const internal = this.tasks.get(taskId);
    if (internal === undefined) throw new Error('Chapter task was not found.');
    if (internal.terminal || internal.stopRequested) {
      return this.copyTask(internal);
    }

    internal.stopRequested = true;
    this.updateTask(internal, {
      status: 'stop_requested',
      canCancel: false,
      canRetry: false,
      error: null
    });
    return this.copyTask(internal);
  }

  async readPlan(projectKey: string): Promise<ChapterPlanReviewResult> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return ChapterPlanReviewResultSchema.parse({
        available: false,
        reason: 'project_unavailable'
      });
    }
    try {
      return ChapterPlanReviewResultSchema.parse(
        await this.dependencies.gateway.readPlan(projectRoot)
      );
    } catch (error) {
      return ChapterPlanReviewResultSchema.parse({
        available: false,
        reason: toReviewUnavailableReason(error)
      });
    }
  }

  async readDraft(projectKey: string): Promise<ChapterDraftReviewResult> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return ChapterDraftReviewResultSchema.parse({
        available: false,
        reason: 'project_unavailable'
      });
    }
    try {
      return ChapterDraftReviewResultSchema.parse(
        await this.dependencies.gateway.readDraft(projectRoot)
      );
    } catch (error) {
      return ChapterDraftReviewResultSchema.parse({
        available: false,
        reason: toReviewUnavailableReason(error)
      });
    }
  }

  private async start(
    projectKey: string,
    kind: ChapterTaskKind
  ): Promise<ChapterTask> {
    const active = this.activeTask(projectKey);
    if (active !== null) {
      return active.task.kind === kind
        ? this.copyTask(active)
        : this.createFailedTask(
          projectKey,
          kind,
          active.task.chapterNumber,
          'generation_busy'
        );
    }

    const starting = this.startingByProject.get(projectKey);
    if (starting !== undefined) {
      if (starting.kind === kind) return starting.promise;
      const pendingTask = await starting.promise;
      const activeAfterStart = this.activeTask(projectKey);
      if (activeAfterStart !== null) {
        return this.createFailedTask(
          projectKey,
          kind,
          activeAfterStart.task.chapterNumber,
          'generation_busy'
        );
      }
      if (!isTerminalStatus(pendingTask.status)) {
        return this.createFailedTask(
          projectKey,
          kind,
          pendingTask.chapterNumber,
          'generation_busy'
        );
      }
      return this.start(projectKey, kind);
    }

    const promise = this.begin(projectKey, kind).finally(() => {
      const current = this.startingByProject.get(projectKey);
      if (current?.promise === promise) {
        this.startingByProject.delete(projectKey);
      }
    });
    this.startingByProject.set(projectKey, { kind, promise });
    return promise;
  }

  private async begin(
    projectKey: string,
    kind: ChapterTaskKind
  ): Promise<ChapterTask> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return this.createFailedTask(
        projectKey,
        kind,
        1,
        'project_unavailable'
      );
    }

    let inspection: ChapterInspection;
    try {
      inspection = ChapterInspectionSchema.parse(
        await this.dependencies.gateway.inspect(projectRoot)
      );
    } catch (error) {
      return this.createFailedTask(
        projectKey,
        kind,
        1,
        toChapterStartErrorKind(error, kind)
      );
    }

    if (!inspection.available) {
      return this.createFailedTask(
        projectKey,
        kind,
        1,
        kind === 'drafting' ? 'plan_missing' : 'project_unavailable'
      );
    }

    const blockedKind = blockedByArtifacts(kind, inspection.phase);
    if (blockedKind !== null) {
      return this.createFailedTask(
        projectKey,
        kind,
        inspection.chapterNumber,
        blockedKind
      );
    }

    const active = this.activeTask(projectKey);
    if (active !== null) {
      return active.task.kind === kind
        ? this.copyTask(active)
        : this.createFailedTask(
          projectKey,
          kind,
          inspection.chapterNumber,
          'generation_busy'
        );
    }

    const internal = this.createTask(
      projectKey,
      kind,
      inspection.chapterNumber
    );
    this.tasks.set(internal.task.taskId, internal);
    this.activeByProject.set(projectKey, internal.task.taskId);
    const task = this.copyTask(internal);
    void this.run(internal, projectRoot).catch(() => undefined);
    return task;
  }

  private async run(
    internal: InternalChapterTask,
    projectRoot: string
  ): Promise<void> {
    try {
      this.updateTask(internal, {
        status: 'running',
        canCancel: true,
        canRetry: false,
        error: null
      });
      const input = {
        projectRoot,
        onProgress: (event: ChapterEngineProgressEvent) => {
          this.reportProgress(internal, event);
        },
        shouldStop: () => internal.stopRequested
      };
      if (internal.task.kind === 'planning') {
        await this.dependencies.gateway.plan(input);
        const review = ChapterPlanReviewResultSchema.parse(
          await this.dependencies.gateway.readPlan(projectRoot)
        );
        requireMatchingReview(review, internal.task.chapterNumber);
      } else {
        await this.dependencies.gateway.draft(input);
        const review = ChapterDraftReviewResultSchema.parse(
          await this.dependencies.gateway.readDraft(projectRoot)
        );
        requireMatchingReview(review, internal.task.chapterNumber);
      }
      this.finishSucceeded(internal);
    } catch (error) {
      if (isCancellation(error)) {
        this.finishCancelled(internal);
      } else {
        this.finishFailed(
          internal,
          toChapterRunErrorKind(error, internal.task.kind)
        );
      }
    } finally {
      if (
        this.activeByProject.get(internal.task.projectKey)
          === internal.task.taskId
      ) {
        this.activeByProject.delete(internal.task.projectKey);
      }
      this.retainTerminalTask(internal);
    }
  }

  private reportProgress(
    internal: InternalChapterTask,
    event: ChapterEngineProgressEvent
  ): void {
    if (internal.terminal) return;
    if (event.stage === 'completed') return;
    const completedStages = event.state === 'completed'
      ? addCompletedStage(internal.task.completedStages, event.stage)
      : internal.task.completedStages;
    const sceneProgress = event.stage === 'scene_drafts'
      && event.state === 'progress'
      && event.current !== undefined
      && event.total !== undefined
      ? { current: event.current, total: event.total }
      : event.stage === 'scene_drafts'
        ? internal.task.sceneProgress
        : null;
    this.updateTask(internal, {
      stage: event.stage,
      completedStages,
      sceneProgress
    });
  }

  private finishSucceeded(internal: InternalChapterTask): void {
    if (internal.terminal) return;
    this.updateTask(internal, {
      status: 'succeeded',
      stage: 'completed',
      completedStages: addCompletedStage(
        internal.task.completedStages,
        'completed'
      ),
      sceneProgress: null,
      canCancel: false,
      canRetry: false,
      error: null
    });
    internal.terminal = true;
  }

  private finishCancelled(internal: InternalChapterTask): void {
    if (internal.terminal) return;
    this.updateTask(internal, {
      status: 'cancelled',
      canCancel: false,
      canRetry: true,
      error: null
    });
    internal.terminal = true;
  }

  private finishFailed(
    internal: InternalChapterTask,
    kind: ChapterErrorKind
  ): void {
    if (internal.terminal) return;
    this.updateTask(internal, {
      status: 'failed',
      canCancel: false,
      canRetry: canRetry(kind),
      error: { kind, message: chapterErrorMessage(kind) }
    });
    internal.terminal = true;
  }

  private createFailedTask(
    projectKey: string,
    taskKind: ChapterTaskKind,
    chapterNumber: number,
    errorKind: ChapterErrorKind
  ): ChapterTask {
    const internal = this.createTask(projectKey, taskKind, chapterNumber);
    this.tasks.set(internal.task.taskId, internal);
    this.finishFailed(internal, errorKind);
    this.retainTerminalTask(internal);
    return this.copyTask(internal);
  }

  private createTask(
    projectKey: string,
    kind: ChapterTaskKind,
    chapterNumber: number
  ): InternalChapterTask {
    const now = this.clock().toISOString();
    return {
      task: ChapterTaskSchema.parse({
        taskId: `chapter_${Buffer.from(this.randomBytes(12)).toString('hex')}`,
        projectKey,
        kind,
        chapterNumber,
        status: 'queued',
        stage: 'preparing',
        completedStages: [],
        sceneProgress: null,
        startedAt: now,
        updatedAt: now,
        canCancel: true,
        canRetry: false,
        error: null
      }),
      stopRequested: false,
      terminal: false,
      retained: false
    };
  }

  private updateTask(
    internal: InternalChapterTask,
    update: Partial<Omit<
      ChapterTask,
      'taskId' | 'projectKey' | 'kind' | 'chapterNumber'
        | 'startedAt' | 'updatedAt'
    >>
  ): void {
    internal.task = ChapterTaskSchema.parse({
      ...internal.task,
      ...update,
      updatedAt: this.clock().toISOString()
    });
  }

  private retainTerminalTask(internal: InternalChapterTask): void {
    if (!internal.terminal || internal.retained) return;
    internal.retained = true;
    this.terminalTaskIds.push(internal.task.taskId);
    while (this.terminalTaskIds.length > MAX_TERMINAL_TASKS) {
      const expiredTaskId = this.terminalTaskIds.shift();
      if (expiredTaskId !== undefined) this.tasks.delete(expiredTaskId);
    }
  }

  private activeTask(projectKey: string): InternalChapterTask | null {
    const taskId = this.activeByProject.get(projectKey);
    if (taskId === undefined) return null;
    const internal = this.tasks.get(taskId);
    if (internal === undefined || internal.terminal) return null;
    return internal;
  }

  private requireTask(taskId: string): ChapterTask {
    const internal = this.tasks.get(taskId);
    if (internal === undefined) throw new Error('Chapter task was not found.');
    return this.copyTask(internal);
  }

  private copyTask(internal: InternalChapterTask): ChapterTask {
    return ChapterTaskSchema.parse(internal.task);
  }

  private async resolveProjectRoot(projectKey: string): Promise<string | null> {
    try {
      return await this.dependencies.projects.resolveProjectRoot(projectKey);
    } catch {
      return null;
    }
  }
}

function blockedByArtifacts(
  kind: ChapterTaskKind,
  phase: Extract<ChapterInspection, { available: true }>['phase']
): ChapterErrorKind | null {
  if (kind === 'planning') {
    return phase === 'plan_ready'
      || phase === 'drafting_partial'
      || phase === 'draft_ready'
      ? 'already_complete'
      : null;
  }
  if (phase === 'draft_ready') return 'already_complete';
  return phase === 'plan_ready' || phase === 'drafting_partial'
    ? null
    : 'plan_missing';
}

function requireMatchingReview(
  review: ChapterPlanReviewResult | ChapterDraftReviewResult,
  chapterNumber: number
): void {
  if (!review.available || review.chapterNumber !== chapterNumber) {
    throw Object.assign(
      new Error('The completed chapter review is unavailable or mismatched.'),
      { code: 'DESKTOP_CHAPTER_INVALID_OUTPUT' }
    );
  }
}

function addCompletedStage(
  completedStages: ChapterTaskStage[],
  stage: ChapterTaskStage
): ChapterTaskStage[] {
  return completedStages.includes(stage)
    ? completedStages
    : [...completedStages, stage];
}

function isCancellation(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'CHAPTER_PLANNING_CANCELLED'
    || code === 'CHAPTER_DRAFT_CANCELLED';
}

function toInspectionErrorKind(
  error: unknown
): 'project_unavailable' | 'stale_chapter' | 'invalid_output' {
  const code = errorCode(error);
  if (code === 'DESKTOP_CHAPTER_STALE') return 'stale_chapter';
  if (isInvalidOutputError(error)) return 'invalid_output';
  return 'project_unavailable';
}

function toChapterStartErrorKind(
  error: unknown,
  taskKind: ChapterTaskKind
): ChapterErrorKind {
  const code = errorCode(error);
  if (code === 'DESKTOP_CHAPTER_STALE') return 'stale_chapter';
  if (isInvalidOutputError(error)) return 'invalid_output';
  if (
    code === 'PROJECT_NOT_FOUND'
    || code === 'ENOENT'
    || code.includes('PROJECT_UNAVAILABLE')
    || code.includes('PROJECT_DATA_INVALID')
  ) {
    return 'project_unavailable';
  }
  return toChapterRunErrorKind(error, taskKind);
}

function toChapterRunErrorKind(
  error: unknown,
  taskKind: ChapterTaskKind
): ChapterErrorKind {
  const classification = providerClassification(error);
  if (classification === 'login_required') return 'login_required';
  if (classification === 'usage_limit') return 'usage_limit';
  if (classification === 'invalid_output') return 'invalid_output';
  if (classification === 'unavailable') return 'codex_unavailable';

  const code = errorCode(error);
  if (code.includes('LOGIN') || code.includes('AUTH')) return 'login_required';
  if (code.includes('USAGE_LIMIT') || code.includes('RATE_LIMIT')) {
    return 'usage_limit';
  }
  if (code.includes('TIMEOUT')) return 'timeout';
  if (code === 'DESKTOP_CHAPTER_STALE') return 'stale_chapter';
  if (code === 'DESKTOP_CHAPTER_UNAVAILABLE') {
    return taskKind === 'drafting' ? 'plan_missing' : 'project_unavailable';
  }
  if (isInvalidOutputError(error)) return 'invalid_output';
  if (
    code === 'ENOENT'
    || code === 'CODEX_BINARY_NOT_FOUND'
    || code.includes('CODEX_UNAVAILABLE')
    || code.includes('CODEX_EXEC_FAILED')
  ) {
    return 'codex_unavailable';
  }
  if (
    code === 'PROJECT_NOT_FOUND'
    || code.includes('PROJECT_UNAVAILABLE')
    || code.includes('PROJECT_DATA_INVALID')
  ) {
    return 'project_unavailable';
  }
  if (code.includes('LOCKED') || code.includes('BUSY')) {
    return 'generation_busy';
  }
  return 'unexpected';
}

function isInvalidOutputError(error: unknown): boolean {
  const code = errorCode(error);
  return errorName(error) === 'ZodError'
    || code === 'CODEX_OUTPUT_MISSING'
    || code === 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    || code.includes('SCHEMA')
    || code.includes('INVALID_JSON')
    || code.includes('INVALID_OUTPUT')
    || code.includes('REPAIR_FAILED');
}

function toReviewUnavailableReason(
  error: unknown
): 'not_ready' | 'invalid_output' | 'project_unavailable' {
  if (isInvalidOutputError(error)) return 'invalid_output';
  if (errorCode(error) === 'DESKTOP_CHAPTER_UNAVAILABLE') return 'not_ready';
  return 'project_unavailable';
}

function providerClassification(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'classification' in error) {
    const classification = (error as { classification?: unknown })
      .classification;
    if (typeof classification === 'string') return classification;
  }
  return '';
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code.toUpperCase();
  }
  return '';
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

function isTerminalStatus(status: ChapterTask['status']): boolean {
  return status === 'succeeded'
    || status === 'failed'
    || status === 'cancelled';
}

function canRetry(kind: ChapterErrorKind): boolean {
  return kind !== 'project_unavailable'
    && kind !== 'stale_chapter'
    && kind !== 'already_complete';
}

function chapterErrorMessage(kind: ChapterErrorKind): string {
  switch (kind) {
    case 'codex_unavailable':
      return 'Codex is unavailable on this device.';
    case 'login_required':
      return 'Sign in to Codex before generating this chapter.';
    case 'usage_limit':
      return 'Codex usage limit reached. Try again later.';
    case 'timeout':
      return 'Chapter generation timed out. Try again.';
    case 'invalid_output':
      return 'Codex returned invalid chapter content.';
    case 'plan_missing':
      return 'Complete the chapter plan before drafting.';
    case 'project_unavailable':
      return 'This project is unavailable.';
    case 'stale_chapter':
      return 'This chapter needs history recovery before generation.';
    case 'already_complete':
      return 'This chapter stage is already complete.';
    case 'generation_busy':
      return 'Another chapter task is already running for this project.';
    case 'unexpected':
      return 'Chapter generation failed unexpectedly.';
  }
}
