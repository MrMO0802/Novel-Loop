import { randomBytes as nodeRandomBytes } from 'node:crypto';

import {
  FoundationReviewResultSchema,
  FoundationTaskSchema,
  type FoundationErrorKind,
  type FoundationReviewResult,
  type FoundationStage,
  type FoundationTask
} from '../../shared/foundationContract';
import type {
  BuildBibleProgressEvent,
  FoundationEngineGateway
} from './EngineFoundationGateway';

const MAX_TERMINAL_TASKS = 100;

export interface ProjectRootResolver {
  resolveProjectRoot(projectKey: string): Promise<string | null>;
}

export interface ProjectFoundationApplicationService {
  start(projectKey: string): Promise<FoundationTask>;
  get(taskId: string): Promise<FoundationTask>;
  cancel(taskId: string): Promise<FoundationTask>;
  read(projectKey: string): Promise<FoundationReviewResult>;
}

export interface ProjectFoundationServiceDependencies {
  projects: ProjectRootResolver;
  gateway: FoundationEngineGateway;
  clock?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
}

interface InternalFoundationTask {
  task: FoundationTask;
  stopRequested: boolean;
  terminal: boolean;
  retained: boolean;
}

export class ProjectFoundationService implements ProjectFoundationApplicationService {
  private readonly clock: () => Date;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly tasks = new Map<string, InternalFoundationTask>();
  private readonly activeByProject = new Map<string, string>();
  private readonly startingByProject = new Map<string, Promise<FoundationTask>>();
  private readonly terminalTaskIds: string[] = [];

  constructor(private readonly dependencies: ProjectFoundationServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  }

  async start(projectKey: string): Promise<FoundationTask> {
    const activeTaskId = this.activeByProject.get(projectKey);
    if (activeTaskId !== undefined) return this.requireTask(activeTaskId);

    const pendingStart = this.startingByProject.get(projectKey);
    if (pendingStart !== undefined) return pendingStart;

    const started = this.begin(projectKey).finally(() => {
      this.startingByProject.delete(projectKey);
    });
    this.startingByProject.set(projectKey, started);
    return started;
  }

  async get(taskId: string): Promise<FoundationTask> {
    return this.requireTask(taskId);
  }

  async cancel(taskId: string): Promise<FoundationTask> {
    const internal = this.tasks.get(taskId);
    if (internal === undefined) throw new Error('Foundation task was not found.');
    if (internal.terminal || internal.stopRequested) return this.copyTask(internal);

    internal.stopRequested = true;
    this.updateTask(internal, {
      status: 'stop_requested',
      canCancel: false,
      canRetry: false,
      error: null
    });
    return this.copyTask(internal);
  }

  async read(projectKey: string): Promise<FoundationReviewResult> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return FoundationReviewResultSchema.parse({
        available: false,
        reason: 'project_unavailable'
      });
    }

    try {
      return FoundationReviewResultSchema.parse(await this.dependencies.gateway.read(projectRoot));
    } catch {
      return FoundationReviewResultSchema.parse({
        available: false,
        reason: 'project_unavailable'
      });
    }
  }

  private async begin(projectKey: string): Promise<FoundationTask> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return this.createFailedTask(projectKey, 'project_unavailable');
    }

    let review: FoundationReviewResult;
    try {
      review = FoundationReviewResultSchema.parse(await this.dependencies.gateway.read(projectRoot));
    } catch (error) {
      return this.createFailedTask(projectKey, toFoundationErrorKind(error));
    }
    if (review.available) {
      return this.createFailedTask(projectKey, 'already_complete');
    }

    const activeTaskId = this.activeByProject.get(projectKey);
    if (activeTaskId !== undefined) return this.requireTask(activeTaskId);

    const internal = this.createTask(projectKey);
    this.tasks.set(internal.task.taskId, internal);
    this.activeByProject.set(projectKey, internal.task.taskId);
    const task = this.copyTask(internal);
    void this.run(internal, projectRoot, true).catch(() => undefined);
    return task;
  }

  private async run(
    internal: InternalFoundationTask,
    projectRoot: string,
    resumeIncomplete: boolean
  ): Promise<void> {
    try {
      this.updateTask(internal, {
        status: 'running',
        canCancel: true,
        canRetry: false,
        error: null
      });
      await this.dependencies.gateway.build({
        projectRoot,
        resumeIncomplete,
        onProgress: (event) => this.reportProgress(internal, event),
        shouldStop: () => internal.stopRequested
      });
      this.finishSucceeded(internal);
    } catch (error) {
      if (isCancellation(error)) {
        this.finishCancelled(internal);
      } else {
        this.finishFailed(internal, toFoundationErrorKind(error));
      }
    } finally {
      if (this.activeByProject.get(internal.task.projectKey) === internal.task.taskId) {
        this.activeByProject.delete(internal.task.projectKey);
      }
      this.retainTerminalTask(internal);
    }
  }

  private reportProgress(
    internal: InternalFoundationTask,
    event: BuildBibleProgressEvent
  ): void {
    if (internal.terminal) return;
    const completedStages = event.state === 'completed'
      ? addCompletedStage(internal.task.completedStages, event.stage)
      : internal.task.completedStages;
    this.updateTask(internal, {
      stage: event.stage,
      completedStages
    });
  }

  private finishSucceeded(internal: InternalFoundationTask): void {
    if (internal.terminal) return;
    this.updateTask(internal, {
      status: 'succeeded',
      stage: 'completed',
      completedStages: addCompletedStage(internal.task.completedStages, 'completed'),
      canCancel: false,
      canRetry: false,
      error: null
    });
    internal.terminal = true;
  }

  private finishCancelled(internal: InternalFoundationTask): void {
    if (internal.terminal) return;
    this.updateTask(internal, {
      status: 'cancelled',
      canCancel: false,
      canRetry: true,
      error: null
    });
    internal.terminal = true;
  }

  private finishFailed(internal: InternalFoundationTask, kind: FoundationErrorKind): void {
    if (internal.terminal) return;
    this.updateTask(internal, {
      status: 'failed',
      canCancel: false,
      canRetry: canRetry(kind),
      error: { kind, message: foundationErrorMessage(kind) }
    });
    internal.terminal = true;
  }

  private createFailedTask(projectKey: string, kind: FoundationErrorKind): FoundationTask {
    const internal = this.createTask(projectKey);
    this.tasks.set(internal.task.taskId, internal);
    this.finishFailed(internal, kind);
    this.retainTerminalTask(internal);
    return this.copyTask(internal);
  }

  private createTask(projectKey: string): InternalFoundationTask {
    const now = this.clock().toISOString();
    return {
      task: FoundationTaskSchema.parse({
        taskId: `foundation_${Buffer.from(this.randomBytes(12)).toString('hex')}`,
        projectKey,
        status: 'queued',
        stage: 'preparing',
        completedStages: [],
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
    internal: InternalFoundationTask,
    update: Partial<Omit<FoundationTask, 'taskId' | 'projectKey' | 'startedAt' | 'updatedAt'>>
  ): void {
    internal.task = FoundationTaskSchema.parse({
      ...internal.task,
      ...update,
      updatedAt: this.clock().toISOString()
    });
  }

  private retainTerminalTask(internal: InternalFoundationTask): void {
    if (!internal.terminal || internal.retained) return;
    internal.retained = true;
    this.terminalTaskIds.push(internal.task.taskId);
    while (this.terminalTaskIds.length > MAX_TERMINAL_TASKS) {
      const expiredTaskId = this.terminalTaskIds.shift();
      if (expiredTaskId !== undefined) this.tasks.delete(expiredTaskId);
    }
  }

  private requireTask(taskId: string): FoundationTask {
    const internal = this.tasks.get(taskId);
    if (internal === undefined) throw new Error('Foundation task was not found.');
    return this.copyTask(internal);
  }

  private copyTask(internal: InternalFoundationTask): FoundationTask {
    return FoundationTaskSchema.parse(internal.task);
  }

  private async resolveProjectRoot(projectKey: string): Promise<string | null> {
    try {
      return await this.dependencies.projects.resolveProjectRoot(projectKey);
    } catch {
      return null;
    }
  }
}

function addCompletedStage(
  completedStages: FoundationStage[],
  stage: FoundationStage
): FoundationStage[] {
  return completedStages.includes(stage) ? completedStages : [...completedStages, stage];
}

function isCancellation(error: unknown): boolean {
  return errorCode(error) === 'BUILD_BIBLE_CANCELLED';
}

function toFoundationErrorKind(error: unknown): FoundationErrorKind {
  const classification = providerClassification(error);
  if (classification === 'login_required') return 'login_required';
  if (classification === 'usage_limit') return 'usage_limit';
  if (classification === 'invalid_output') return 'invalid_output';
  if (classification === 'unavailable') return 'codex_unavailable';

  const code = errorCode(error);
  if (code === 'ARTIFACT_ALREADY_EXISTS') return 'already_complete';
  if (code === 'BUILD_BIBLE_LOCKED') return 'generation_busy';
  if (code.includes('LOGIN') || code.includes('AUTH')) return 'login_required';
  if (code.includes('USAGE_LIMIT') || code.includes('RATE_LIMIT')) return 'usage_limit';
  if (code.includes('TIMEOUT')) return 'timeout';
  if (code === 'CODEX_OUTPUT_MISSING'
    || code === 'DESKTOP_STORY_BIBLE_INCOMPLETE'
    || code.includes('SCHEMA')
    || code.includes('INVALID_JSON')
    || code.includes('INVALID_OUTPUT')) {
    return 'invalid_output';
  }
  if (code === 'ENOENT'
    || code === 'CODEX_BINARY_NOT_FOUND'
    || code.includes('CODEX_UNAVAILABLE')
    || code.includes('CODEX_EXEC_FAILED')) {
    return 'codex_unavailable';
  }
  if (code === 'PROJECT_NOT_FOUND'
    || code === 'BRIEF_NOT_FOUND'
    || code.includes('PROJECT_UNAVAILABLE')
    || code.includes('PROJECT_DATA_INVALID')) {
    return 'project_unavailable';
  }
  return 'unexpected';
}

function providerClassification(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'classification' in error) {
    const classification = (error as { classification?: unknown }).classification;
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

function canRetry(kind: FoundationErrorKind): boolean {
  return kind !== 'already_complete' && kind !== 'project_unavailable';
}

function foundationErrorMessage(kind: FoundationErrorKind): string {
  switch (kind) {
    case 'codex_unavailable':
      return 'Codex is unavailable on this device.';
    case 'login_required':
      return 'Sign in to Codex before generating the Story Foundation.';
    case 'usage_limit':
      return 'Codex usage limit reached. Try again later.';
    case 'timeout':
      return 'Story Foundation generation timed out. Try again.';
    case 'invalid_output':
      return 'Codex returned invalid Story Foundation content.';
    case 'project_unavailable':
      return 'This project is unavailable.';
    case 'already_complete':
      return 'Story Foundation is already complete.';
    case 'generation_busy':
      return 'Story Foundation generation is already running for this project.';
    case 'unexpected':
      return 'Story Foundation generation failed unexpectedly.';
  }
}
