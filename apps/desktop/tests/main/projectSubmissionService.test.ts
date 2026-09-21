import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { DesktopSubmissionTask } from 'novel-loop-engine/desktop';
import { DraftWorkingCopyStore } from '../../src/main/chapter/DraftWorkingCopyStore';
import { ProjectSubmissionService } from '../../src/main/submission/ProjectSubmissionService';
import { ProjectSubmissionGuard } from '../../src/main/submission/ProjectSubmissionGuard';
import { SubmissionTokenStore } from '../../src/main/submission/SubmissionTokenStore';
import type { SubmissionEngineGateway, TrustedSubmissionPreview } from '../../src/main/submission/EngineSubmissionGateway';

const projectKey = 'project_test';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'submission-main-'));
  roots.push(root);
  const guard = new ProjectSubmissionGuard();
  const workingCopies = new DraftWorkingCopyStore(root);
  const preview: TrustedSubmissionPreview = {
    chapterNumber: 1, previewId: 'preview_1', manifestHash: 'a'.repeat(64),
    draft: { kind: 'adopted', label: 'Adopted draft', summary: 'Reviewed text.' },
    changes: [{ category: 'facts', summary: 'The letter arrived.', risk: 'low' }], warnings: []
  };
  const gateway = {
    readDraftIdentity: vi.fn(async () => ({ chapterNumber: 1, sourceHash: 'b'.repeat(64) })),
    readPreview: vi.fn(async () => preview as TrustedSubmissionPreview | null),
    readRecovery: vi.fn<SubmissionEngineGateway['readRecovery']>(async () => ({ outcome: 'none' })),
    readTasks: vi.fn<SubmissionEngineGateway['readTasks']>(async () => []),
    readIssues: vi.fn<SubmissionEngineGateway['readIssues']>(async () => []),
    check: vi.fn<SubmissionEngineGateway['check']>(async (input) => engineTask(input.taskId, 'ready')),
    confirm: vi.fn<SubmissionEngineGateway['confirm']>(async () => ({ chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: false, commitReportPath: 'chapters/chapter_001/commit_report.json' }))
  } satisfies SubmissionEngineGateway;
  const projects = {
    resolveProjectRoot: vi.fn(async () => root as string | null),
    resolveRegisteredRootForRecovery: vi.fn(async () => root as string | null),
    list: vi.fn(async () => ({ projects: [{ projectKey }] }))
  };
  let now = Date.parse('2026-09-21T00:00:00Z');
  const tokens = new SubmissionTokenStore({ now: () => now });
  const dependencies = { projects, gateway, workingCopies, guard, tokens, clock: () => new Date(now) };
  const service = new ProjectSubmissionService(dependencies);
  const issue = async () => {
    const result = await service.readPreview({ projectKey });
    if (result.outcome !== 'ready') throw new Error(JSON.stringify(result));
    return result.previewToken;
  };
  return { root, guard, workingCopies, gateway, projects, preview, service, dependencies, issue, expire: () => { now += 30 * 60 * 1000; } };
}

function engineTask(taskId: string, status: 'running' | 'ready' = 'running'): DesktopSubmissionTask {
  return { schemaVersion: 1, taskId, projectId: 'fixture', chapterNumber: 1,
    stage: status === 'ready' ? 'validating_patch' : 'diagnostics', status,
    runId: 'run_fixture', previewId: status === 'ready' ? 'preview_1' : null,
    startedAt: '2026-09-21T00:00:00Z', endedAt: status === 'ready' ? '2026-09-21T00:00:01Z' : null, safeErrorCode: null };
}

test('failed diagnostics survive live polling and restart preview without a ready manifest', async () => {
  const f = await fixture();
  const issues = [{ severity: 'error' as const, message: '人物提前得知了信中的秘密。', evidence: '他尚未打开信封。' }];
  const failed = (taskId: string): DesktopSubmissionTask => ({ ...engineTask(taskId), status: 'blocked', safeErrorCode: 'diagnostics_failed', endedAt: '2026-09-21T00:00:01Z' });
  f.gateway.readIssues.mockResolvedValue(issues);
  f.gateway.readPreview.mockResolvedValue(null);
  f.gateway.check.mockImplementation(async input => failed(input.taskId));
  const started = await f.service.startCheck({ projectKey });
  await vi.waitFor(async () => expect(await f.service.get(started)).toMatchObject({ status: 'blocked', issues }));
  expect(await f.service.readPreview({ projectKey })).toEqual({ outcome: 'blocked', messageKey: 'submission.diagnostics_failed', issues });
  f.gateway.readTasks.mockResolvedValue([failed(started.taskId)]);
  const restarted = new ProjectSubmissionService(f.dependencies);
  expect(await restarted.get(started)).toMatchObject({ status: 'blocked', issues });
  expect(await restarted.readPreview({ projectKey })).toEqual({ outcome: 'blocked', messageKey: 'submission.diagnostics_failed', issues });
  expect(f.gateway.check).toHaveBeenCalledTimes(1);
});

test('tampered diagnostic artifacts cannot leak errors or produce a ready preview on restart', async () => {
  const f = await fixture();
  const failed: DesktopSubmissionTask = { ...engineTask('task_bad_diagnostic'), status: 'blocked', safeErrorCode: 'diagnostics_failed', endedAt: '2026-09-21T00:00:01Z' };
  f.gateway.readTasks.mockResolvedValue([failed]);
  f.gateway.readIssues.mockRejectedValue(Object.assign(new Error('/private/sk-secret'), { code: 'invalid_output' }));
  const result = await f.service.readPreview({ projectKey });
  expect(result).toMatchObject({ outcome: 'blocked' });
  expect(JSON.stringify(result)).not.toMatch(/private|sk-secret/u);
  expect(f.gateway.readPreview).not.toHaveBeenCalled();
});

test('terminal polling cannot finish before verified diagnostic issues are attached', async () => {
  const f = await fixture(); const entered = deferred(); const finish = deferred();
  const issues = [{ severity: 'error' as const, message: '人物提前得知了信中的秘密。', evidence: '他尚未打开信封。' }];
  f.gateway.check.mockImplementation(async (input, options) => {
    const failed: DesktopSubmissionTask = { ...engineTask(input.taskId), status: 'blocked', safeErrorCode: 'diagnostics_failed', endedAt: '2026-09-21T00:00:01Z' };
    await options.onProgress(failed);
    return failed;
  });
  f.gateway.readIssues.mockImplementation(async () => { entered.resolve(); await finish.promise; return issues; });
  const started = await f.service.startCheck({ projectKey });
  await entered.promise;
  const pending = await f.service.get(started);
  finish.resolve();
  expect(pending.status).toBe('running');
  await vi.waitFor(async () => expect(await f.service.get(started)).toMatchObject({ status: 'blocked', issues }));
});

test('strict object API and fresh tokens bind exact manifest, project and real root', async () => {
  const f = await fixture();
  const token = await f.issue();
  expect(await f.issue()).not.toBe(token);
  await expect(f.service.startCheck({ projectKey, path: '/outside' } as never)).rejects.toThrow();
  expect(await f.service.confirm({ projectKey: 'project_other', previewToken: token, confirm: true })).toMatchObject({ outcome: 'stale' });
  f.preview.manifestHash = 'c'.repeat(64);
  expect(await f.service.confirm({ projectKey, previewToken: token, confirm: true })).toMatchObject({ outcome: 'stale' });
  expect(f.gateway.confirm).not.toHaveBeenCalled();
});

test.each(['dirty', 'stale'])('persisted %s draft blocks checking and confirmation', async (kind) => {
  const f = await fixture();
  const token = await f.issue();
  await f.workingCopies.save({ projectKey, chapterNumber: 1, sourceHash: (kind === 'dirty' ? 'b' : 'c').repeat(64), markdown: 'Unadopted edit', savedAt: '2026-09-21T00:00:00Z' });
  const started = await f.service.startCheck({ projectKey });
  expect(await f.service.get(started)).toMatchObject({ status: 'blocked', safeErrorCode: 'working_copy_pending' });
  expect(await f.service.confirm({ projectKey, previewToken: token, confirm: true })).toMatchObject({ outcome: 'blocked', messageKey: 'submission.working_copy_pending' });
  expect(f.gateway.check).not.toHaveBeenCalled();
  expect(f.gateway.confirm).not.toHaveBeenCalled();
});

test('quarantined pending edit cannot be treated as clean by a restarted submission service', async () => {
  const f = await fixture(); const token = await f.issue();
  const directory = path.join(f.root, 'working-copies', projectKey, 'chapter_001');
  await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'draft.json'), '{invalid');
  await f.workingCopies.read(projectKey, 1);
  const restarted = new ProjectSubmissionService({ ...f.dependencies, workingCopies: new DraftWorkingCopyStore(f.root) });
  expect(await restarted.readPreview({ projectKey })).toMatchObject({ outcome: 'blocked', messageKey: 'submission.working_copy_pending' });
  expect(await f.service.confirm({ projectKey, previewToken: token, confirm: true })).toMatchObject({ outcome: 'blocked', messageKey: 'submission.working_copy_pending' });
  expect(f.gateway.confirm).not.toHaveBeenCalled();
});

test('admission-read failure never turns into a clean working copy', async () => {
  const f = await fixture(); const token = await f.issue();
  vi.spyOn(f.workingCopies, 'hasPendingSubmissionEdit').mockRejectedValue(Object.assign(new Error('/private/edit'), { code: 'EACCES' }));
  expect(await f.service.confirm({ projectKey, previewToken: token, confirm: true })).toMatchObject({ outcome: 'blocked' });
  const task = await f.service.startCheck({ projectKey });
  expect(await f.service.get(task)).toMatchObject({ status: 'failed', safeErrorCode: 'io_error' });
  expect(f.gateway.confirm).not.toHaveBeenCalled(); expect(f.gateway.check).not.toHaveBeenCalled();
});

test('provider check releases shared guard and a later edit blocks ready publication', async () => {
  const f = await fixture();
  const entered = deferred(); const finish = deferred();
  f.gateway.check.mockImplementation(async input => { entered.resolve(); await finish.promise; return engineTask(input.taskId, 'ready'); });
  const task = await f.service.startCheck({ projectKey });
  await entered.promise;
  await f.guard.runExclusive(projectKey, () => f.workingCopies.save({ projectKey, chapterNumber: 1, sourceHash: 'b'.repeat(64), markdown: 'Changed', savedAt: '2026-09-21T00:00:00Z' }));
  finish.resolve();
  await vi.waitFor(async () => expect(await f.service.get(task)).toMatchObject({ status: 'blocked', safeErrorCode: 'working_copy_pending' }));
});

test('confirmation holds guard and burns token before calling local engine once', async () => {
  const f = await fixture(); const token = await f.issue();
  const entered = deferred(); const finish = deferred();
  f.gateway.confirm.mockImplementation(async () => { entered.resolve(); await finish.promise; return { chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: false, commitReportPath: 'report' }; });
  const request = { projectKey, previewToken: token, confirm: true as const };
  const first = f.service.confirm(request); await entered.promise;
  let edited = false;
  const edit = f.guard.runExclusive(projectKey, async () => { edited = true; });
  const second = f.service.confirm(request);
  await Promise.resolve(); expect(edited).toBe(false);
  finish.resolve();
  expect(await first).toMatchObject({ outcome: 'committed' });
  await edit; await second;
  expect(f.gateway.confirm).toHaveBeenCalledTimes(1);
  expect(f.gateway.check).not.toHaveBeenCalled();
  expect(f.gateway.confirm.mock.calls[0]?.[0]).toMatchObject({ expectedManifestHash: 'a'.repeat(64), confirm: true });
});

test('post-call uncertainty burns authorization and blocks fresh tokens until recovery is inspected', async () => {
  const f = await fixture(); const token = await f.issue();
  f.gateway.confirm.mockRejectedValue(new Error('/secret/sk-credential'));
  const result = await f.service.confirm({ projectKey, previewToken: token, confirm: true });
  expect(result).toEqual({ outcome: 'recovery_required', messageKey: 'submission.recovery_required' });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(await f.service.readPreview({ projectKey })).toMatchObject({ outcome: 'blocked', messageKey: 'submission.recovery_required' });
  await f.service.confirm({ projectKey, previewToken: token, confirm: true });
  expect(f.gateway.confirm).toHaveBeenCalledTimes(1);
});

test.each(['source_stale', 'generation_busy'] as const)('known engine preflight %s burns token but does not invent a partial write', async (code) => {
  const f = await fixture(); const token = await f.issue();
  f.gateway.confirm.mockRejectedValue(Object.assign(new Error('private'), { code }));
  expect(await f.service.confirm({ projectKey, previewToken: token, confirm: true })).toMatchObject({ outcome: code === 'source_stale' ? 'stale' : 'busy' });
  expect(await f.service.confirm({ projectKey, previewToken: token, confirm: true })).toMatchObject({ outcome: 'stale' });
  expect(await f.service.readPreview({ projectKey })).toMatchObject({ outcome: 'ready' });
  expect(f.gateway.confirm).toHaveBeenCalledTimes(1);
});

test('expired tokens and changed registered roots cannot submit', async () => {
  const f = await fixture(); const token = await f.issue(); f.expire();
  expect(await f.service.confirm({ projectKey, previewToken: token, confirm: true })).toMatchObject({ outcome: 'stale' });
  const next = await f.issue(); f.projects.resolveProjectRoot.mockResolvedValue(`${f.root}-other`);
  expect(await f.service.confirm({ projectKey, previewToken: next, confirm: true })).toMatchObject({ outcome: 'stale' });
  expect(f.gateway.confirm).not.toHaveBeenCalled();
});

test('restart discovers running tasks from registered roots as interrupted without provider', async () => {
  const f = await fixture();
  f.gateway.readTasks.mockResolvedValue([engineTask('task_restarted')]);
  const restarted = new ProjectSubmissionService({ ...f.dependencies, tokens: new SubmissionTokenStore() });
  expect(await restarted.get({ taskId: 'task_restarted' })).toMatchObject({ status: 'interrupted', safeErrorCode: 'interrupted' });
  expect(await restarted.cancel({ taskId: 'task_restarted' })).toMatchObject({ status: 'interrupted' });
  expect(f.gateway.check).not.toHaveBeenCalled();
});

test('restart retention keeps the newest task when the engine returns newest-first history', async () => {
  const f = await fixture();
  f.gateway.readTasks.mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({
    ...engineTask(`task_history_${index}`, 'ready'),
    startedAt: new Date(Date.parse('2026-09-21T00:00:00Z') - index * 1000).toISOString()
  })));
  expect(await f.service.get({ taskId: 'task_history_0' })).toMatchObject({ taskId: 'task_history_0' });
});

test('partial commit is diagnosed from registered root before full validation or next chapter lookup', async () => {
  const f = await fixture();
  f.projects.resolveProjectRoot.mockResolvedValue(null);
  f.gateway.readRecovery.mockResolvedValue({ outcome: 'recovery_required' });
  expect(await f.service.readPreview({ projectKey })).toMatchObject({ outcome: 'blocked', messageKey: 'submission.recovery_required' });
  expect(f.gateway.readDraftIdentity).not.toHaveBeenCalled();
  expect(f.projects.resolveProjectRoot).not.toHaveBeenCalled();
});

test('cancellation is cooperative and does not publish a ready task', async () => {
  const f = await fixture(); const entered = deferred(); const finish = deferred();
  f.gateway.check.mockImplementation(async (input, options) => {
    entered.resolve(); await finish.promise; expect(options.shouldCancel()).toBe(true);
    return { ...engineTask(input.taskId), status: 'cancelled', endedAt: '2026-09-21T00:00:01Z' };
  });
  const task = await f.service.startCheck({ projectKey }); await entered.promise;
  expect(await f.service.cancel(task)).toMatchObject({ status: 'cancel_requested' });
  finish.resolve();
  await vi.waitFor(async () => expect(await f.service.get(task)).toMatchObject({ status: 'cancelled' }));
});

test('completed journal wins over missing next draft and invalid normal project validation after restart', async () => {
  const f = await fixture(); const token = await f.issue();
  f.projects.resolveProjectRoot.mockResolvedValue(null);
  f.gateway.readRecovery.mockResolvedValue({ outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: false });
  f.gateway.readDraftIdentity.mockClear();
  const restarted = new ProjectSubmissionService({ ...f.dependencies, tokens: new SubmissionTokenStore() });
  expect(await restarted.readPreview({ projectKey })).toEqual({ outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: false });
  expect(f.gateway.readDraftIdentity).not.toHaveBeenCalled();
  expect(await restarted.confirm({ projectKey, previewToken: token, confirm: true })).toMatchObject({ outcome: 'stale' });
  expect(f.gateway.confirm).not.toHaveBeenCalled();
  expect(f.gateway.check).not.toHaveBeenCalled();
});

test('interrupted check without manifest exposes safe not-ready explanation', async () => {
  const f = await fixture();
  f.gateway.readTasks.mockResolvedValue([engineTask('task_interrupted')]);
  f.gateway.readPreview.mockResolvedValue(null);
  expect(await f.service.readPreview({ projectKey })).toMatchObject({ outcome: 'not_ready', issues: [{ severity: 'warning', message: expect.stringContaining('中断') }] });
  expect(await f.service.get({ taskId: 'task_interrupted' })).toMatchObject({ status: 'interrupted' });
});

test('newer persisted checks supersede prior completion without masking incomplete recovery', async () => {
  const f = await fixture();
  f.gateway.readRecovery.mockResolvedValue({ outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: true });
  f.gateway.readTasks.mockResolvedValue([{ ...engineTask('task_next', 'ready'), chapterNumber: 2 }]);
  f.gateway.readDraftIdentity.mockResolvedValue({ chapterNumber: 2, sourceHash: 'b'.repeat(64) });
  f.preview.chapterNumber = 2;
  expect(await f.service.readPreview({ projectKey })).toMatchObject({ outcome: 'ready', chapterNumber: 2 });
  f.gateway.readRecovery.mockResolvedValue({ outcome: 'recovery_required' });
  expect(await f.service.readPreview({ projectKey })).toMatchObject({ outcome: 'blocked', messageKey: 'submission.recovery_required' });
});

test('prepared next chapter without any submission task is available for its first check', async () => {
  const f = await fixture();
  f.gateway.readRecovery.mockResolvedValue({ outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: true });
  f.gateway.readTasks.mockResolvedValue([]);
  f.gateway.readDraftIdentity.mockResolvedValue({ chapterNumber: 2, sourceHash: 'b'.repeat(64) });
  f.gateway.readPreview.mockResolvedValue(null);
  expect(await f.service.readPreview({ projectKey })).toMatchObject({ outcome: 'not_ready' });
  f.gateway.check.mockImplementation(async input => ({ ...engineTask(input.taskId, 'ready'), chapterNumber: 2 }));
  f.gateway.readPreview.mockResolvedValue({ ...f.preview, chapterNumber: 2 });
  const task = await f.service.startCheck({ projectKey });
  await vi.waitFor(async () => expect(await f.service.get(task)).toMatchObject({ chapterNumber: 2, status: 'ready' }));
});

test('prior completion remains visible when the next draft is genuinely absent', async () => {
  const f = await fixture();
  const completed = { outcome: 'committed' as const, chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: true };
  f.gateway.readRecovery.mockResolvedValue(completed);
  f.gateway.readDraftIdentity.mockRejectedValue(Object.assign(new Error('No draft.'), { code: 'source_missing' }));
  expect(await f.service.readPreview({ projectKey })).toEqual(completed);
  expect(f.gateway.check).not.toHaveBeenCalled();
});

test('a pending edit in the prepared next chapter is not hidden behind old completion', async () => {
  const f = await fixture();
  f.gateway.readRecovery.mockResolvedValue({ outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: true });
  f.gateway.readDraftIdentity.mockResolvedValue({ chapterNumber: 2, sourceHash: 'b'.repeat(64) });
  await f.workingCopies.save({ projectKey, chapterNumber: 2, sourceHash: 'b'.repeat(64), markdown: '未采用', savedAt: '2026-09-21T00:00:00Z' });
  expect(await f.service.readPreview({ projectKey })).toMatchObject({ outcome: 'blocked', messageKey: 'submission.working_copy_pending' });
});

test('disk errors and malformed engine replies fail safely with no raw paths or credentials', async () => {
  const f = await fixture();
  f.gateway.check.mockRejectedValue(Object.assign(new Error('/secret/sk-key'), { code: 'ENOSPC' }));
  const task = await f.service.startCheck({ projectKey });
  await vi.waitFor(async () => expect(await f.service.get(task)).toMatchObject({ status: 'failed', safeErrorCode: 'io_error' }));
  expect(JSON.stringify(await f.service.get(task))).not.toContain('secret');
  const token = await f.issue();
  f.gateway.confirm.mockResolvedValue({ chapterNumber: 2, latestCommittedChapter: 2, hasNextChapter: true, commitReportPath: 'secret' });
  expect(await f.service.confirm({ projectKey, previewToken: token, confirm: true })).toMatchObject({ outcome: 'recovery_required' });
});

test('source identity changed during checking fails even without a pending working copy', async () => {
  const f = await fixture(); const entered = deferred(); const finish = deferred();
  f.gateway.check.mockImplementation(async input => { entered.resolve(); await finish.promise; return engineTask(input.taskId, 'ready'); });
  const task = await f.service.startCheck({ projectKey }); await entered.promise;
  f.gateway.readDraftIdentity.mockResolvedValue({ chapterNumber: 1, sourceHash: 'c'.repeat(64) });
  finish.resolve();
  await vi.waitFor(async () => expect(await f.service.get(task)).toMatchObject({ status: 'failed', safeErrorCode: 'source_stale' }));
});

test('double start shares one admitted check and uncertain recovery never launches a provider', async () => {
  const f = await fixture(); const finish = deferred();
  f.gateway.check.mockImplementation(async input => { await finish.promise; return engineTask(input.taskId, 'ready'); });
  const [a, b] = await Promise.all([f.service.startCheck({ projectKey }), f.service.startCheck({ projectKey })]);
  expect(a).toEqual(b); expect(f.gateway.check).toHaveBeenCalledTimes(1);
  finish.resolve();
  await vi.waitFor(async () => expect(await f.service.get(a)).toMatchObject({ status: 'ready' }));
  f.gateway.readRecovery.mockResolvedValue({ outcome: 'recovery_required' });
  const task = await f.service.startCheck({ projectKey });
  expect(await f.service.get(task)).toMatchObject({ status: 'blocked', safeErrorCode: 'recovery_required' });
  expect(f.gateway.check).toHaveBeenCalledTimes(1);
});
