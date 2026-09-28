import { randomBytes } from 'node:crypto';
import type { DiagnosticRevisionTask } from 'novel-loop-engine/desktop';
import { containsAuthorFacingInternalValue } from 'novel-loop-engine/author-facing';
import { DiagnosticRevisionIdentitySchema, DiagnosticRevisionReadSchema, DiagnosticRevisionResponseSchema, DiagnosticRevisionStartSchema, DiagnosticRevisionTaskRequestSchema, type DiagnosticRevisionApi, type DiagnosticRevisionResponse } from '../../shared/diagnosticRevisionContract';
import { SubmissionSafeErrorCodeSchema } from '../../shared/submissionContract';
import { EngineDiagnosticRevisionGateway } from './EngineDiagnosticRevisionGateway';
import type { ProjectSubmissionServiceDependencies } from './ProjectSubmissionService';

type Dependencies = Pick<ProjectSubmissionServiceDependencies, 'projects' | 'gateway' | 'workingCopies' | 'guard'> & { revisions?: EngineDiagnosticRevisionGateway };
type Active = { projectKey: string; root: string; chapterNumber: number; cancelled: boolean; task: DiagnosticRevisionTask };
export class ProjectDiagnosticRevisionService implements DiagnosticRevisionApi {
  private readonly active = new Map<string, Active>();
  private readonly finished = new Map<string, Active>();
  private readonly revisions: EngineDiagnosticRevisionGateway;
  constructor(private readonly dependencies: Dependencies) { this.revisions = dependencies.revisions ?? new EngineDiagnosticRevisionGateway(); }

  private async scope(projectKey: string, requireClean = true) {
    const root = await this.dependencies.projects.resolveRegisteredRootForRecovery(projectKey);
    if (!root) throw failure('project_unavailable');
    if ((await this.dependencies.gateway.readRecovery(root)).outcome === 'recovery_required') throw failure('recovery_required');
    if (await this.dependencies.projects.resolveProjectRoot(projectKey) !== root) throw failure('source_stale');
    const identity = await this.dependencies.gateway.readDraftIdentity(root);
    if (requireClean && await this.dependencies.workingCopies.hasPendingSubmissionEdit(projectKey, identity.chapterNumber)) throw failure('working_copy_pending');
    return { projectRoot: root, chapterNumber: identity.chapterNumber };
  }

  async start(request: Parameters<DiagnosticRevisionApi['start']>[0]): Promise<DiagnosticRevisionResponse> {
    let launch: Active | undefined;
    let diagnosticTaskId = '';
    const result = await this.safe(async () => {
      const parsed = DiagnosticRevisionStartSchema.parse(request);
      return this.dependencies.guard.runExclusive(parsed.projectKey, async () => {
        const existing = this.active.get(parsed.projectKey);
        if (existing) return projectTask(existing.task);
        const scope = await this.scope(parsed.projectKey);
        const facade = await this.revisions.load();
        for (const item of await facade.listDiagnosticRevisionTasks(scope)) {
          await facade.recoverInterruptedDiagnosticRevisionTask({ ...scope, taskId: item.task.taskId });
        }
        const tasks = (await this.dependencies.gateway.readTasks(scope.projectRoot)).filter(t => t.chapterNumber === scope.chapterNumber).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
        const selected = parsed.diagnosticTaskId === 'latest' ? tasks[0] : tasks.find(t => t.taskId === parsed.diagnosticTaskId);
        if (!selected || selected.safeErrorCode !== 'diagnostics_failed') throw failure('source_stale');
        diagnosticTaskId = selected.taskId;
        await facade.captureDiagnosticRevisionSource({ ...scope, diagnosticTaskId });
        const task: DiagnosticRevisionTask = { schemaVersion: 1, taskId: `dr_task_${randomBytes(24).toString('hex')}`, projectId: selected.projectId, chapterNumber: scope.chapterNumber, stage: 'checking_source', status: 'running', runId: 'pending', candidateId: null, startedAt: new Date().toISOString(), endedAt: null, safeErrorCode: null };
        launch = { projectKey: parsed.projectKey, root: scope.projectRoot, chapterNumber: scope.chapterNumber, cancelled: false, task };
        this.active.set(parsed.projectKey, launch);
        return projectTask(task);
      });
    });
    if (launch) void this.run(launch, diagnosticTaskId);
    return result;
  }
  private async run(active: Active, diagnosticTaskId: string) {
    try {
      const facade = await this.revisions.load();
      active.task = await facade.generateDiagnosticRevision({ projectRoot: active.root, chapterNumber: active.chapterNumber, taskId: active.task.taskId, diagnosticTaskId }, {
        shouldCancel: () => active.cancelled,
        onProgress: async task => {
          // Terminal status becomes visible only once generation releases its lease.
          if (task.status === 'running' || task.status === 'cancel_requested') {
            active.task = active.cancelled ? { ...task, status: 'cancel_requested' } : task;
          }
        },
        assertCanPublish: async () => {
          const scope = await this.scope(active.projectKey);
          if (scope.projectRoot !== active.root || scope.chapterNumber !== active.chapterNumber) throw failure('source_stale');
        }
      });
    } catch {
      active.task = { ...active.task, status: 'failed', candidateId: null, endedAt: new Date().toISOString(), safeErrorCode: 'unexpected' };
    } finally {
      this.active.delete(active.projectKey);
      this.finished.set(active.task.taskId, active);
      if (this.finished.size > 100) this.finished.delete(this.finished.keys().next().value!);
    }
  }
  async get(request: Parameters<DiagnosticRevisionApi['get']>[0]) {
    return this.safe(async () => {
      const parsed = DiagnosticRevisionTaskRequestSchema.parse(request);
      const local = this.active.get(parsed.projectKey) ?? this.finished.get(parsed.taskId);
      // Polling must not acquire the draft lease held by candidate publication.
      const root = await this.dependencies.projects.resolveRegisteredRootForRecovery(parsed.projectKey);
      if (!root) throw failure('project_unavailable');
      if (local?.projectKey === parsed.projectKey && local.root === root && local.task.taskId === parsed.taskId) return projectTask(local.task);
      const scope = await this.scope(parsed.projectKey, false);
      const task = await (await this.revisions.load()).recoverInterruptedDiagnosticRevisionTask({ ...scope, taskId: parsed.taskId });
      if (!task) throw failure('source_missing');
      return projectTask(task);
    });
  }
  async cancel(request: Parameters<DiagnosticRevisionApi['cancel']>[0]) {
    return this.safe(async () => {
      const parsed = DiagnosticRevisionTaskRequestSchema.parse(request);
      const root = await this.dependencies.projects.resolveRegisteredRootForRecovery(parsed.projectKey);
      if (!root) throw failure('project_unavailable');
      const active = this.active.get(parsed.projectKey);
      if (active?.task.taskId === parsed.taskId && active.root === root && ['running', 'cancel_requested'].includes(active.task.status)) {
        active.cancelled = true;
        active.task = { ...active.task, status: 'cancel_requested' };
        return projectTask(active.task);
      }
      return this.get(parsed);
    });
  }
  async read(request: Parameters<DiagnosticRevisionApi['read']>[0]) {
    return this.safe(async () => {
      const parsed = DiagnosticRevisionReadSchema.parse(request);
      const active = this.active.get(parsed.projectKey);
      if (!parsed.candidateId && active) return this.get({ projectKey: parsed.projectKey, taskId: active.task.taskId });
      const scope = await this.scope(parsed.projectKey, false);
      const facade = await this.revisions.load();
      if (!parsed.candidateId) {
        const active = this.active.get(parsed.projectKey);
        if (active) return projectTask(active.task);
        const latest = (await facade.listDiagnosticRevisionTasks(scope)).sort((a, b) => Date.parse(b.task.startedAt) - Date.parse(a.task.startedAt))[0]?.task;
        if (!latest) return { outcome: 'none' };
        if (!latest.candidateId) return this.get({ projectKey: parsed.projectKey, taskId: latest.taskId });
        parsed.candidateId = latest.candidateId;
      }
      const result = await facade.readDiagnosticRevisionCandidate({ ...scope, candidateId: parsed.candidateId });
      if (!request.candidateId && ['adopted', 'rejected'].includes(result.disposition.status)) {
        const latestCheck = (await this.dependencies.gateway.readTasks(scope.projectRoot)).filter(t => t.chapterNumber === scope.chapterNumber)
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
        if (latestCheck?.safeErrorCode === 'diagnostics_failed' && latestCheck.taskId !== result.binding.diagnosticTaskId) return { outcome: 'none' };
      }
      const clean = !(await this.dependencies.workingCopies.hasPendingSubmissionEdit(parsed.projectKey, scope.chapterNumber));
      return { outcome: 'candidate', candidate: { candidateId: result.candidate.candidateId, source: result.sourceText, markdown: result.candidateText,
        reasons: result.candidate.changes.map(change => containsAuthorFacingInternalValue(change.reason) ? '已生成修订建议，请对照正文核对。' : change.reason),
        status: result.disposition.status, canAdopt: result.canAdopt && clean } };
    });
  }
  async adopt(request: Parameters<DiagnosticRevisionApi['adopt']>[0]) { return this.decide(request, 'adopt'); }
  async reject(request: Parameters<DiagnosticRevisionApi['reject']>[0]) { return this.decide(request, 'reject'); }
  private async decide(request: Parameters<DiagnosticRevisionApi['adopt']>[0], operation: 'adopt' | 'reject') {
    return this.safe(async () => {
      const parsed = DiagnosticRevisionIdentitySchema.parse(request);
      return this.dependencies.guard.runExclusive(parsed.projectKey, async () => {
        if (this.active.has(parsed.projectKey)) throw failure('generation_busy');
        const scope = await this.scope(parsed.projectKey);
        const facade = await this.revisions.load();
        if (operation === 'adopt') await facade.adoptDiagnosticRevision({ ...scope, candidateId: parsed.candidateId });
        else await facade.rejectDiagnosticRevision({ ...scope, candidateId: parsed.candidateId });
        return { outcome: operation === 'adopt' ? 'adopted' : 'rejected' };
      });
    });
  }
  private async safe(operation: () => Promise<unknown>): Promise<DiagnosticRevisionResponse> {
    try { return DiagnosticRevisionResponseSchema.parse(await operation()); }
    catch (error) {
      const code = SubmissionSafeErrorCodeSchema.safeParse(typeof error === 'object' && error !== null && 'code' in error ? error.code : null);
      return { outcome: 'error', code: code.success ? code.data : 'unexpected' };
    }
  }
}
function projectTask(task: DiagnosticRevisionTask): DiagnosticRevisionResponse {
  return { outcome: 'task', task: { taskId: task.taskId, stage: task.stage, status: task.status, candidateId: task.candidateId, safeErrorCode: task.safeErrorCode } };
}
function failure(code: string) { return Object.assign(new Error('Revision unavailable'), { code }); }
