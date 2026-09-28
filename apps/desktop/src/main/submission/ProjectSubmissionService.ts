import { randomBytes } from 'node:crypto';
import type { DesktopSubmissionTask } from 'novel-loop-engine/desktop';
import {
  SubmissionStartCheckRequestSchema, SubmissionGetRequestSchema, SubmissionCancelRequestSchema,
  SubmissionReadPreviewRequestSchema, SubmissionConfirmRequestSchema, SubmissionTaskSchema,
  SubmissionPreviewResultSchema, SubmissionConfirmResultSchema, SubmissionSafeErrorCodeSchema,
  type SubmissionStartCheckRequest, type SubmissionGetRequest, type SubmissionCancelRequest,
  type SubmissionReadPreviewRequest, type SubmissionConfirmRequest, type SubmissionTask,
  type SubmissionPreviewResult, type SubmissionConfirmResult, type SubmissionSafeErrorCode,
  type SubmissionMessageKey
} from '../../shared/submissionContract';
import type { ProjectSubmissionServiceContract } from '../ipc/registerSubmissionHandlers';
import type { DraftWorkingCopyStore } from '../chapter/DraftWorkingCopyStore';
import type { ProjectSubmissionGuardContract } from './ProjectSubmissionGuard';
import { SubmissionTokenStore, type SubmissionTokenBinding, type SubmissionTokenStoreContract } from './SubmissionTokenStore';
import type { SubmissionEngineGateway, TrustedSubmissionPreview } from './EngineSubmissionGateway';

export interface ProjectSubmissionServiceDependencies {
  projects: {
    resolveProjectRoot(projectKey: string): Promise<string | null>;
    resolveRegisteredRootForRecovery(projectKey: string): Promise<string | null>;
    list(): Promise<{ projects: { projectKey: string }[] }>;
  };
  gateway: SubmissionEngineGateway;
  workingCopies: Pick<DraftWorkingCopyStore, 'hasPendingSubmissionEdit'>;
  guard: ProjectSubmissionGuardContract;
  tokens?: SubmissionTokenStoreContract;
  clock?: () => Date;
}

interface InternalTask {
  task: SubmissionTask;
  cancelled: boolean;
  root: string;
  sourceHash: string;
}

export class ProjectSubmissionService implements ProjectSubmissionServiceContract {
  private readonly tasks = new Map<string, InternalTask>();
  private readonly active = new Map<string, string>();
  private readonly uncertain = new Set<string>();
  private readonly bindings = new Map<string, { binding: SubmissionTokenBinding; expiresAt: number }>();
  private readonly tokens: SubmissionTokenStoreContract;
  private readonly clock: () => Date;

  constructor(private readonly dependencies: ProjectSubmissionServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.tokens = dependencies.tokens ?? new SubmissionTokenStore({ now: () => this.clock().getTime() });
  }

  async startCheck(request: SubmissionStartCheckRequest) {
    const { projectKey } = SubmissionStartCheckRequestSchema.parse(request);
    let admitted: InternalTask | undefined;
    const result = await this.dependencies.guard.runExclusive(projectKey, async () => {
      const activeId = this.active.get(projectKey);
      if (activeId !== undefined) return { taskId: activeId };
      const internal = this.createTask(projectKey);
      try {
        const recoveryRoot = await this.recoveryRoot(projectKey);
        const recovery = await this.dependencies.gateway.readRecovery(recoveryRoot);
        if (this.uncertain.has(projectKey) || recovery.outcome === 'recovery_required') throw failure('recovery_required');
        const root = await this.validRoot(projectKey);
        if (root !== recoveryRoot) throw failure('source_stale');
        const identity = await this.admitDraft(projectKey, root);
        internal.root = root;
        internal.sourceHash = identity.sourceHash;
        internal.task.chapterNumber = identity.chapterNumber;
        this.active.set(projectKey, internal.task.taskId);
        admitted = internal;
      } catch (error) {
        this.finishError(internal, safeCode(error));
      }
      this.retain(internal);
      return { taskId: internal.task.taskId };
    });
    // Do not keep the non-reentrant editor guard while waiting for a provider.
    if (admitted !== undefined) void this.run(admitted).catch(() => undefined);
    return result;
  }

  async get(request: SubmissionGetRequest): Promise<SubmissionTask> {
    const { taskId } = SubmissionGetRequestSchema.parse(request);
    if (!this.tasks.has(taskId)) {
      const library = await this.dependencies.projects.list();
      for (const { projectKey } of library.projects) {
        await this.dependencies.guard.runExclusive(projectKey, async () => {
          const root = await this.dependencies.projects.resolveRegisteredRootForRecovery(projectKey);
          if (root !== null) await this.restoreTasks(projectKey, root);
        });
        if (this.tasks.has(taskId)) break;
      }
    }
    const internal = this.tasks.get(taskId);
    if (internal === undefined) throw new Error('submission.not_ready');
    return SubmissionTaskSchema.parse(internal.task);
  }

  async cancel(request: SubmissionCancelRequest): Promise<SubmissionTask> {
    const parsed = SubmissionCancelRequestSchema.parse(request);
    await this.get(parsed);
    const internal = this.tasks.get(parsed.taskId)!;
    if (isActive(internal.task)) {
      internal.cancelled = true;
      internal.task = SubmissionTaskSchema.parse({ ...internal.task, status: 'cancel_requested' });
    }
    return SubmissionTaskSchema.parse(internal.task);
  }

  async readPreview(request: SubmissionReadPreviewRequest): Promise<SubmissionPreviewResult> {
    const { projectKey } = SubmissionReadPreviewRequestSchema.parse(request);
    return this.dependencies.guard.runExclusive(projectKey, async () => {
      try {
        // Recovery precedes normal validation and latest+1 lookup, even after partial state writes.
        const root = await this.recoveryRoot(projectKey);
        const recovery = await this.dependencies.gateway.readRecovery(root);
        if (recovery.outcome === 'recovery_required') throw failure('recovery_required');
        await this.restoreTasks(projectKey, root);
        if (recovery.outcome === 'committed' && !this.newerTask(projectKey, recovery.chapterNumber)
          && !(recovery.hasNextChapter && await this.hasPreparedNextDraft(projectKey, root, recovery.chapterNumber))) {
          this.uncertain.delete(projectKey);
          return SubmissionPreviewResultSchema.parse(recovery);
        }
        if (this.uncertain.has(projectKey)) throw failure('recovery_required');
        if (await this.validRoot(projectKey) !== root) throw failure('source_stale');
        const identity = await this.admitDraft(projectKey, root);
        const active = this.active.get(projectKey);
        if (active !== undefined) return previewUnavailable('not_ready', 'submission.busy');
        const preview = await this.dependencies.gateway.readPreview({ projectRoot: root, chapterNumber: identity.chapterNumber });
        if (preview === null) {
          const latest = [...this.tasks.values()].filter(item => item.task.projectKey === projectKey && item.task.chapterNumber === identity.chapterNumber)
            .sort((a, b) => Date.parse(b.task.startedAt) - Date.parse(a.task.startedAt))[0]?.task;
          if (latest?.safeErrorCode === 'diagnostics_failed') {
            return SubmissionPreviewResultSchema.parse({ outcome: 'blocked', messageKey: 'submission.diagnostics_failed', issues: latest.issues });
          }
          return SubmissionPreviewResultSchema.parse({
            outcome: 'not_ready', messageKey: 'submission.not_ready',
            issues: latest?.status === 'interrupted' ? [{ severity: 'warning', message: '上次检查已中断，未自动恢复。准备好后可重新检查。', evidence: null }] : []
          });
        }
        if (preview.chapterNumber !== identity.chapterNumber) throw failure('source_stale');
        this.pruneBindings();
        const binding = this.binding(projectKey, root, preview);
        const previewToken = this.tokens.issue(binding);
        const result = SubmissionPreviewResultSchema.parse({
          outcome: 'ready', previewToken, chapterNumber: preview.chapterNumber,
          draft: preview.draft, changes: preview.changes, warnings: preview.warnings
        });
        this.bindings.set(previewToken, { binding, expiresAt: this.clock().getTime() + 30 * 60 * 1000 });
        return result;
      } catch (error) {
        const code = safeCode(error);
        return previewUnavailable(code === 'source_stale' ? 'stale' : 'blocked',
          code === 'invalid_output' || code === 'unexpected' || code === 'io_error' ? 'submission.readFailed' : messageKey(code));
      }
    });
  }

  async confirm(request: SubmissionConfirmRequest): Promise<SubmissionConfirmResult> {
    const parsed = SubmissionConfirmRequestSchema.parse(request);
    return this.dependencies.guard.runExclusive(parsed.projectKey, async () => {
      this.pruneBindings();
      const issued = this.bindings.get(parsed.previewToken);
      if (issued === undefined || issued.binding.projectKey !== parsed.projectKey) return stale();
      try {
        if (this.uncertain.has(parsed.projectKey)) return recoveryRequired();
        const diagnosticRoot = await this.recoveryRoot(parsed.projectKey);
        if (diagnosticRoot !== issued.binding.projectRoot) return stale();
        const recovery = await this.dependencies.gateway.readRecovery(diagnosticRoot);
        if (recovery.outcome === 'recovery_required') return recoveryRequired();
        if (recovery.outcome === 'committed' && recovery.chapterNumber >= issued.binding.chapterNumber) return stale();
        const root = await this.validRoot(parsed.projectKey);
        if (root !== issued.binding.projectRoot) return stale();
        if (this.active.has(parsed.projectKey)) return { outcome: 'busy', messageKey: 'submission.busy' };
        const identity = await this.admitDraft(parsed.projectKey, root);
        if (identity.chapterNumber !== issued.binding.chapterNumber) return stale();
        const preview = await this.dependencies.gateway.readPreview({ projectRoot: root, chapterNumber: identity.chapterNumber });
        if (preview === null) return stale();
        const reservation = this.tokens.reserve(parsed.previewToken, this.binding(parsed.projectKey, root, preview));
        if (reservation === null) return stale();
        try { reservation.markMutationStarted(); }
        catch { reservation.invalidate(); return stale(); }
        this.bindings.delete(parsed.previewToken);
        try {
          const result = await this.dependencies.gateway.confirm({
            projectRoot: root, chapterNumber: identity.chapterNumber, previewId: preview.previewId,
            expectedManifestHash: preview.manifestHash, approvalId: `approval_${randomBytes(24).toString('hex')}`, confirm: true
          });
          if (result.chapterNumber !== identity.chapterNumber) throw failure('recovery_required');
          const committed = SubmissionConfirmResultSchema.parse({
            outcome: 'committed', chapterNumber: result.chapterNumber,
            latestCommittedChapter: result.latestCommittedChapter, hasNextChapter: result.hasNextChapter
          });
          reservation.consume();
          return committed;
        } catch (error) {
          reservation.invalidate();
          // The local facade converts every write-phase failure to recovery_required.
          const code = safeCode(error);
          if (code === 'source_stale' || code === 'already_committed') return stale();
          if (code === 'generation_busy') return { outcome: 'busy', messageKey: 'submission.busy' };
          if (code === 'working_copy_pending' || code === 'plan_missing' || code === 'patch_conflict') {
            return { outcome: 'blocked', messageKey: messageKey(code) };
          }
          this.uncertain.add(parsed.projectKey);
          return recoveryRequired();
        }
      } catch (error) {
        const code = safeCode(error);
        if (code === 'source_stale' || code === 'already_committed') return stale();
        if (code === 'recovery_required') return recoveryRequired();
        return { outcome: 'blocked', messageKey: messageKey(code) };
      }
    });
  }

  private async run(internal: InternalTask): Promise<void> {
    const { taskId, projectKey, chapterNumber } = internal.task;
    try {
      const result = await this.dependencies.gateway.check({ projectRoot: internal.root, chapterNumber, taskId }, {
        shouldCancel: () => internal.cancelled,
        onProgress: async task => {
          // Publish terminal status only after its verified evidence is ready for the final poll.
          if (task.status !== 'running' && task.status !== 'cancel_requested') return;
          this.acceptTask(internal, task);
          if (internal.cancelled && isActive(internal.task)) internal.task.status = 'cancel_requested';
        }
      });
      await this.dependencies.guard.runExclusive(projectKey, async () => {
        const completed = { ...internal };
        this.acceptTask(completed, result);
        if (!internal.cancelled) {
          if (completed.task.status === 'ready') {
            if (await this.validRoot(projectKey) !== internal.root) throw failure('source_stale');
            const identity = await this.admitDraft(projectKey, internal.root);
            if (identity.chapterNumber !== chapterNumber || identity.sourceHash !== internal.sourceHash) throw failure('source_stale');
            const preview = await this.dependencies.gateway.readPreview({ projectRoot: internal.root, chapterNumber });
            if (preview === null || preview.previewId !== result.previewId) throw failure('source_stale');
          } else await this.attachIssues(completed, result);
        }
        if (internal.cancelled) {
          completed.task = SubmissionTaskSchema.parse({ ...completed.task, status: 'cancelled', endedAt: this.endTime(internal), safeErrorCode: null, issues: [] });
        }
        internal.task = completed.task;
      });
    } catch (error) {
      this.finishError(internal, safeCode(error));
    } finally {
      if (this.active.get(projectKey) === taskId) this.active.delete(projectKey);
      this.retain(internal);
    }
  }

  private async admitDraft(projectKey: string, root: string) {
    const identity = await this.dependencies.gateway.readDraftIdentity(root);
    if (await this.dependencies.workingCopies.hasPendingSubmissionEdit(projectKey, identity.chapterNumber)) throw failure('working_copy_pending');
    return identity;
  }

  private async restoreTasks(projectKey: string, root: string) {
    const disk = await this.dependencies.gateway.readTasks(root);
    for (const task of disk) {
      if (this.tasks.has(task.taskId)) continue;
      const internal: InternalTask = { task: publicTask(projectKey, task), root, sourceHash: '', cancelled: false };
      if (isActive(internal.task)) this.finishError(internal, 'interrupted');
      else await this.attachIssues(internal, task);
      this.retain(internal);
    }
  }

  private async attachIssues(internal: InternalTask, task: DesktopSubmissionTask) {
    if (task.safeErrorCode !== 'diagnostics_failed') return;
    const issues = await this.dependencies.gateway.readIssues(internal.root, task);
    internal.task = SubmissionTaskSchema.parse({ ...internal.task, issues });
  }

  private newerTask(projectKey: string, chapterNumber: number) {
    return [...this.tasks.values()].some(item => item.task.projectKey === projectKey && item.task.chapterNumber > chapterNumber);
  }

  private async hasPreparedNextDraft(projectKey: string, root: string, committedChapter: number): Promise<boolean> {
    const validRoot = await this.dependencies.projects.resolveProjectRoot(projectKey);
    if (validRoot === null) return false;
    if (validRoot !== root) throw failure('source_stale');
    try {
      const draft = await this.dependencies.gateway.readDraftIdentity(root);
      return draft.chapterNumber === committedChapter + 1;
    } catch (error) {
      if (safeCode(error) === 'source_missing') return false;
      throw error;
    }
  }

  private acceptTask(internal: InternalTask, task: DesktopSubmissionTask) {
    if (task.taskId !== internal.task.taskId || task.chapterNumber !== internal.task.chapterNumber) throw failure('invalid_output');
    internal.task = publicTask(internal.task.projectKey, task);
  }

  private createTask(projectKey: string): InternalTask {
    return { root: '', sourceHash: '', cancelled: false, task: SubmissionTaskSchema.parse({
      taskId: `submission_task_${randomBytes(24).toString('hex')}`, projectKey, chapterNumber: 1,
      stage: 'checking_source', status: 'running', startedAt: this.clock().toISOString(),
      endedAt: null, safeErrorCode: null, issues: []
    }) };
  }

  private finishError(internal: InternalTask, code: SubmissionSafeErrorCode) {
    internal.task = SubmissionTaskSchema.parse({ ...internal.task,
      status: code === 'interrupted' ? 'interrupted' : ['working_copy_pending', 'recovery_required', 'plan_missing'].includes(code) ? 'blocked' : 'failed',
      endedAt: this.endTime(internal), safeErrorCode: code, issues: []
    });
  }

  private endTime(internal: InternalTask) {
    return new Date(Math.max(this.clock().getTime(), Date.parse(internal.task.startedAt))).toISOString();
  }

  private retain(internal: InternalTask) {
    this.tasks.set(internal.task.taskId, internal);
    const terminal = [...this.tasks.values()].filter(item => !isActive(item.task))
      .sort((left, right) => Date.parse(left.task.startedAt) - Date.parse(right.task.startedAt));
    for (const item of terminal.slice(0, Math.max(0, terminal.length - 100))) this.tasks.delete(item.task.taskId);
  }

  private binding(projectKey: string, projectRoot: string, preview: TrustedSubmissionPreview): SubmissionTokenBinding {
    return { projectKey, projectRoot, chapterNumber: preview.chapterNumber, previewId: preview.previewId, manifestHash: preview.manifestHash };
  }

  private pruneBindings() {
    for (const [token, item] of this.bindings) if (this.clock().getTime() >= item.expiresAt) this.bindings.delete(token);
  }

  private async recoveryRoot(projectKey: string) {
    const root = await this.dependencies.projects.resolveRegisteredRootForRecovery(projectKey);
    if (root === null) throw failure('project_unavailable');
    return root;
  }

  private async validRoot(projectKey: string) {
    const root = await this.dependencies.projects.resolveProjectRoot(projectKey);
    if (root === null) throw failure('project_unavailable');
    return root;
  }
}

function publicTask(projectKey: string, task: DesktopSubmissionTask): SubmissionTask {
  return SubmissionTaskSchema.parse({
    taskId: task.taskId, projectKey, chapterNumber: task.chapterNumber, stage: task.stage,
    status: task.status, startedAt: task.startedAt, endedAt: task.endedAt, safeErrorCode: task.safeErrorCode, issues: []
  });
}
function isActive(task: SubmissionTask) { return task.status === 'running' || task.status === 'cancel_requested'; }
function failure(code: SubmissionSafeErrorCode) { return Object.assign(new Error('Submission unavailable.'), { code }); }
function safeCode(error: unknown): SubmissionSafeErrorCode {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  const parsed = SubmissionSafeErrorCodeSchema.safeParse(code);
  if (parsed.success) return parsed.data;
  if (typeof code === 'string' && code.startsWith('DRAFT_WORKING_COPY')) return 'working_copy_pending';
  if (code === 'ENOSPC' || code === 'EIO' || code === 'EACCES') return 'io_error';
  if (code === 'PROJECT_OPERATION_LOCKED' || code === 'PROJECT_OPERATION_BUSY') return 'generation_busy';
  return 'unexpected';
}
function messageKey(code: SubmissionSafeErrorCode) {
  switch (code) {
    case 'working_copy_pending': return 'submission.working_copy_pending' as const;
    case 'recovery_required': return 'submission.recovery_required' as const;
    case 'source_stale': return 'submission.stale' as const;
    case 'plan_missing': return 'submission.plan_missing' as const;
    case 'project_unavailable': return 'submission.project_unavailable' as const;
    case 'diagnostics_failed': return 'submission.diagnostics_failed' as const;
    case 'generation_busy': return 'submission.busy' as const;
    default: return 'submission.blocked' as const;
  }
}
function previewUnavailable(outcome: 'not_ready' | 'blocked' | 'stale', key: SubmissionMessageKey): SubmissionPreviewResult {
  return SubmissionPreviewResultSchema.parse({ outcome, messageKey: key, issues: [] });
}
function stale(): SubmissionConfirmResult { return { outcome: 'stale', messageKey: 'submission.stale' }; }
function recoveryRequired(): SubmissionConfirmResult { return { outcome: 'recovery_required', messageKey: 'submission.recovery_required' }; }
