import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { LLMClient } from '../llm/LLMClient.js';
import { ProviderFactory } from '../llm/ProviderFactory.js';
import { TelemetryLLMClient } from '../llm/TelemetryLLMClient.js';
import { PromptService } from '../prompts/PromptService.js';
import { RunLogger } from '../logging/RunLogger.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { RunManifestV2Schema } from '../schemas/index.js';
import type { DiagnosticsReport } from '../schemas/index.js';
import { DiagnosticRevisionBindingSchema, DiagnosticRevisionCandidateSchema, DiagnosticRevisionDispositionSchema, DiagnosticRevisionOutputSchema, DiagnosticRevisionTaskSchema, type DiagnosticRevisionTask } from '../schemas/desktopDiagnosticRevision.js';
import { createRunId } from '../utils/ids.js';
import { withProjectChapterOperationLease } from './projectOperationLease.js';
import { submissionErrorCode } from './desktopSubmissionPreview.js';
import { readDesktopSubmissionDiagnostics } from './desktopSubmissionDiagnostics.js';
import { readExactSubmissionText, submissionHash, submissionStore, SubmissionError } from './desktopSubmissionSource.js';
import { assertDiagnosticRevisionSourceFresh, captureDiagnosticRevisionSource, DiagnosticRevisionScopeSchema, DiagnosticRevisionSourceInputSchema, type DiagnosticRevisionScope, type DiagnosticRevisionSourceInput } from './desktopDiagnosticRevisionSource.js';

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const Identity = DiagnosticRevisionScopeSchema.extend({ candidateId: Id }).strict();
const TaskInput = DiagnosticRevisionScopeSchema.extend({ taskId: Id }).strict();
export type DiagnosticRevisionIdentity = z.infer<typeof Identity>;
export type DiagnosticRevisionTaskInput = z.infer<typeof TaskInput>;
export interface DiagnosticRevisionRunOptions {
  client?: LLMClient;
  shouldCancel(): boolean;
  onProgress(task: DiagnosticRevisionTask): Promise<void>;
  assertCanPublish?(): Promise<void>;
}
class Cancelled extends Error {}

export function diagnosticRevisionStore(value: DiagnosticRevisionScope) {
  const input = DiagnosticRevisionScopeSchema.parse(value);
  const root = path.resolve(input.projectRoot);
  const paths = new ProjectPaths(path.dirname(root), path.basename(root));
  return { paths, store: submissionStore(root), parent: paths.chapterArtifact(input.chapterNumber, 'diagnostic_revisions') };
}

export async function listDiagnosticRevisionTasks(input: DiagnosticRevisionScope) {
  const { paths, store, parent } = diagnosticRevisionStore(input);
  const result: { directory: string; task: DiagnosticRevisionTask }[] = [];
  if (!(await store.exists(parent))) return result;
  for (const name of await store.list(parent)) {
    if (!/^revision_v[1-9]\d*$/u.test(name)) continue;
    const directory = path.join(parent, name);
    const file = path.join(directory, 'task.json');
    if (!(await store.exists(file))) continue;
    const task = DiagnosticRevisionTaskSchema.parse(JSON.parse(await readExactSubmissionText(store, file)));
    if (task.projectId !== paths.projectId || task.chapterNumber !== input.chapterNumber) throw new SubmissionError('invalid_output');
    result.push({ directory, task });
  }
  if (new Set(result.map(item => item.task.taskId)).size !== result.length) throw new SubmissionError('invalid_output');
  return result;
}
export async function readDiagnosticRevisionTask(value: DiagnosticRevisionTaskInput) {
  const input = TaskInput.parse(value);
  return (await listDiagnosticRevisionTasks({ projectRoot: input.projectRoot, chapterNumber: input.chapterNumber })).find(item => item.task.taskId === input.taskId)?.task ?? null;
}
export async function cancelDiagnosticRevision(value: DiagnosticRevisionTaskInput) {
  const input = TaskInput.parse(value);
  const scope = { projectRoot: input.projectRoot, chapterNumber: input.chapterNumber };
  return withProjectChapterOperationLease({ ...scope, operation: 'diagnostic_revision_cancel', allowStoryStateWrite: false }, async () => {
    const item = (await listDiagnosticRevisionTasks(scope)).find(item => item.task.taskId === input.taskId);
    if (!item) throw new SubmissionError('source_missing');
    if (!['running', 'cancel_requested'].includes(item.task.status)) return item.task;
    const task = DiagnosticRevisionTaskSchema.parse({ ...item.task, status: 'cancel_requested' });
    await diagnosticRevisionStore(scope).store.writeJson(path.join(item.directory, 'task.json'), task, DiagnosticRevisionTaskSchema);
    return task;
  });
}

export async function recoverInterruptedDiagnosticRevisionTask(value: DiagnosticRevisionTaskInput) {
  const input = TaskInput.parse(value);
  const scope = { projectRoot: input.projectRoot, chapterNumber: input.chapterNumber };
  return withProjectChapterOperationLease({ ...scope, operation: 'diagnostic_revision_recovery', allowStoryStateWrite: false }, async () => {
    const item = (await listDiagnosticRevisionTasks(scope)).find(entry => entry.task.taskId === input.taskId);
    if (!item) return null;
    if (!['running', 'cancel_requested'].includes(item.task.status)) return item.task;
    if (item.task.ownerPid) {
      try { process.kill(item.task.ownerPid, 0); return item.task; }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) return item.task; }
    }
    const task = DiagnosticRevisionTaskSchema.parse({ ...item.task, status: 'interrupted', candidateId: null, endedAt: new Date().toISOString(), safeErrorCode: 'interrupted' });
    const { store, paths } = diagnosticRevisionStore(scope);
    const run = await store.readJson(paths.runManifest(task.runId), RunManifestV2Schema);
    await store.writeJson(paths.runManifest(task.runId), { ...run, status: 'failed', endedAt: task.endedAt, durationMs: Math.max(0, Date.parse(task.endedAt!) - Date.parse(run.startedAt)) }, RunManifestV2Schema);
    await store.writeJson(path.join(item.directory, 'task.json'), task, DiagnosticRevisionTaskSchema);
    return task;
  });
}

export async function generateDiagnosticRevision(value: DiagnosticRevisionSourceInput & { taskId: string }, options: DiagnosticRevisionRunOptions): Promise<DiagnosticRevisionTask> {
  const input = DiagnosticRevisionSourceInputSchema.extend({ taskId: Id }).strict().parse(value);
  const scope = { projectRoot: input.projectRoot, chapterNumber: input.chapterNumber };
  const { paths, store, parent } = diagnosticRevisionStore(scope);
  const logger = new RunLogger(paths, store);
  let directory = '';
  let task = DiagnosticRevisionTaskSchema.parse({ schemaVersion: 1, taskId: input.taskId, projectId: paths.projectId, chapterNumber: input.chapterNumber, stage: 'checking_source', status: 'running', runId: createRunId(), candidateId: null, startedAt: new Date().toISOString(), endedAt: null, safeErrorCode: null, ownerPid: process.pid });
  let started = false;
  const save = async () => { if (directory) await store.writeJson(path.join(directory, 'task.json'), task, DiagnosticRevisionTaskSchema); await options.onProgress(task); };
  try {
    const allocated = await withProjectChapterOperationLease({ ...scope, operation: 'diagnostic_revision_capture', allowStoryStateWrite: false }, async () => {
      if ((await listDiagnosticRevisionTasks(scope)).some(item => ['running', 'cancel_requested'].includes(item.task.status))) throw new SubmissionError('generation_busy');
      const binding = await captureDiagnosticRevisionSource({ ...scope, diagnosticTaskId: input.diagnosticTaskId });
      if (options.shouldCancel()) throw new Cancelled();
      await store.ensureDir(parent);
      const names = await store.list(parent);
      const version = Math.max(0, ...names.map(name => /^revision_v([1-9]\d*)$/u.exec(name)).filter(m => m !== null).map(m => Number(m[1]))) + 1;
      if (!Number.isSafeInteger(version)) throw new SubmissionError('io_error');
      directory = path.join(parent, `revision_v${version}`);
      await store.ensureDir(directory);
      await logger.startRun({ runId: task.runId, command: 'desktop-diagnostic-revision', args: { chapterNumber: input.chapterNumber, provider: 'codex-text', diagnosticTaskId: input.diagnosticTaskId } });
      started = true;
      await save();
      return { binding, version };
    });
    const { binding, version } = allocated;
    const boundary = async () => {
      const disk = await readDiagnosticRevisionTask({ ...scope, taskId: input.taskId });
      if (options.shouldCancel() || disk?.status === 'cancel_requested') throw new Cancelled();
      await assertDiagnosticRevisionSourceFresh(scope, binding);
    };
    const record = async (name: string) => {
      const relative = path.relative(paths.projectRoot, path.join(directory, name)).split(path.sep).join('/');
      await logger.recordArtifact(task.runId, relative, { stage: task.stage, sourcePaths: [binding.source.sourcePath, binding.diagnostics.path] });
    };
    const evidence = await readDesktopSubmissionDiagnostics({ projectRoot: input.projectRoot, taskId: input.diagnosticTaskId });
    if (!evidence) throw new SubmissionError('source_stale');
    const sourceText = evidence.sourceText;
    await store.writeJson(path.join(directory, 'source_binding.json'), binding, DiagnosticRevisionBindingSchema);
    await store.writeText(path.join(directory, 'source.md'), sourceText);
    await record('source_binding.json'); await record('source.md');
    const issues = diagnosticRevisionIssues(evidence.diagnostics);
    const readBound = async (ref: { path: string; hash: string }) => {
      const text = await readExactSubmissionText(store, paths.projectArtifact(ref.path));
      if (submissionHash(text) !== ref.hash) throw new SubmissionError('source_stale');
      return text;
    };
    const prompt = await new PromptService('prompts').renderPrompt('revision.desktop_diagnostic_revision', {
      DRAFT: sourceText, ISSUES: JSON.stringify(issues), MISSION: await readBound(binding.source.mission),
      PLAN: await readBound(binding.source.selectedPlan), STATE: await readBound(binding.source.state)
    });
    if (Buffer.byteLength(prompt) > 2 * 1024 * 1024) throw new SubmissionError('invalid_output');
    await boundary();
    task = DiagnosticRevisionTaskSchema.parse({ ...task, stage: 'generating_revision' }); await save();
    const telemetry = { paths, runId: task.runId, fileStore: store };
    const client = options.client ? new TelemetryLLMClient(options.client, { ...telemetry, provider: 'injected' }) : ProviderFactory.create({ provider: 'codex-text', projectsRoot: paths.projectsRoot, projectId: paths.projectId, telemetry });
    const response = await client.complete({ promptId: 'revision.desktop_diagnostic_revision', system: 'Revise only the checked chapter. Return JSON; never edit files or story state.', user: prompt, responseFormat: 'json' });
    await boundary();
    await writePromptRunArtifacts(store, paths, task.runId, 'revision.desktop_diagnostic_revision', prompt, response.text, { env: { NLE_REDACT_PROMPT_ARTIFACTS: 'true' } });
    const output = DiagnosticRevisionOutputSchema.parse(response.json ?? JSON.parse(response.text));
    if (output.changes.some(change => change.issueIndex >= issues.length)) throw new SubmissionError('invalid_output');
    const title = (text: string) => text.split(/\r?\n/u).find(line => /^#\s/u.test(line)) ?? null;
    if (title(sourceText) !== title(output.markdown)) throw new SubmissionError('invalid_output');
    task = DiagnosticRevisionTaskSchema.parse({ ...task, stage: 'validating_candidate' }); await save();
    await withProjectChapterOperationLease({ ...scope, operation: 'diagnostic_revision_publish', allowStoryStateWrite: false }, async () => {
      await boundary(); await options.assertCanPublish?.();
      const candidateId = `dr_candidate_${randomBytes(24).toString('hex')}`;
      const candidate = DiagnosticRevisionCandidateSchema.parse({ schemaVersion: 1, candidateId, taskId: task.taskId, runId: task.runId, projectId: paths.projectId, chapterNumber: input.chapterNumber, version,
        bindingHash: submissionHash(await readExactSubmissionText(store, path.join(directory, 'source_binding.json'))), sourceHash: binding.source.sourceHash, candidateHash: submissionHash(output.markdown), changes: output.changes, createdAt: new Date().toISOString() });
      await store.writeText(path.join(directory, 'candidate.md'), output.markdown);
      await store.writeJson(path.join(directory, 'candidate.json'), candidate, DiagnosticRevisionCandidateSchema);
      await store.writeJson(path.join(directory, 'disposition.json'), { schemaVersion: 1, candidateId, status: 'pending', sourceHash: candidate.sourceHash, candidateHash: candidate.candidateHash, authorRevisionId: null, decidedAt: null }, DiagnosticRevisionDispositionSchema);
      await record('candidate.md'); await record('candidate.json');
      await boundary();
      await logger.endRun(task.runId, 'success');
      task = DiagnosticRevisionTaskSchema.parse({ ...task, status: 'ready', candidateId, endedAt: new Date().toISOString() });
      await save();
    });
  } catch (error) {
    const cancelled = error instanceof Cancelled || options.shouldCancel();
    task = DiagnosticRevisionTaskSchema.parse({ ...task, status: cancelled ? 'cancelled' : 'failed', candidateId: null, endedAt: new Date().toISOString(), safeErrorCode: cancelled ? null : submissionErrorCode(error, 'diagnostics') });
    if (started) {
      if (!cancelled) await logger.recordError(task.runId, { code: task.safeErrorCode!, message: task.safeErrorCode!, recoverable: true });
      const manifest = await logger.readManifestV2(task.runId);
      await store.writeJson(paths.runManifest(task.runId), { ...manifest, status: cancelled ? 'cancelled' : 'failed', endedAt: task.endedAt, durationMs: Math.max(0, Date.parse(task.endedAt!) - Date.parse(manifest.startedAt)) }, RunManifestV2Schema);
    }
    await save();
  }
  return task;
}

export function diagnosticRevisionIssues(diagnostics: DiagnosticsReport): string[] {
  return [...diagnostics.hardFailures.map(item => `${item.message} ${item.evidence}`), ...diagnostics.issues.map(item => JSON.stringify(item)),
    ...Object.entries(diagnostics.hard_checks).filter(([, value]) => !value.passed).map(([key, value]) => `${key}: ${value.message}`)];
}

export async function readDiagnosticRevisionCandidate(value: DiagnosticRevisionIdentity) {
  const input = Identity.parse(value);
  const scope = { projectRoot: input.projectRoot, chapterNumber: input.chapterNumber };
  const { paths, store } = diagnosticRevisionStore(scope);
  const entries = (await listDiagnosticRevisionTasks(scope)).filter(item => item.task.candidateId === input.candidateId && item.task.status === 'ready');
  if (entries.length !== 1) throw new SubmissionError('source_missing');
  const { directory, task } = entries[0]!;
  const text = (name: string) => readExactSubmissionText(store, path.join(directory, name));
  const candidate = DiagnosticRevisionCandidateSchema.parse(JSON.parse(await text('candidate.json')));
  const bindingText = await text('source_binding.json');
  const binding = DiagnosticRevisionBindingSchema.parse(JSON.parse(bindingText));
  const sourceText = await text('source.md');
  const candidateText = await text('candidate.md');
  const disposition = DiagnosticRevisionDispositionSchema.parse(JSON.parse(await text('disposition.json')));
  if (candidate.candidateId !== input.candidateId || candidate.taskId !== task.taskId || candidate.runId !== task.runId || candidate.projectId !== paths.projectId || candidate.chapterNumber !== input.chapterNumber
    || path.basename(directory) !== `revision_v${candidate.version}` || candidate.bindingHash !== submissionHash(bindingText)
    || candidate.sourceHash !== submissionHash(sourceText) || candidate.sourceHash !== binding.source.sourceHash || candidate.candidateHash !== submissionHash(candidateText)
    || disposition.candidateId !== candidate.candidateId || disposition.sourceHash !== candidate.sourceHash || disposition.candidateHash !== candidate.candidateHash) throw new SubmissionError('invalid_output');
  const run = await store.readJson(paths.runManifest(task.runId), RunManifestV2Schema);
  if (run.runId !== task.runId || run.projectId !== paths.projectId || run.command !== 'desktop-diagnostic-revision' || run.status !== 'success' || run.stateMutations.length !== 0) throw new SubmissionError('invalid_output');
  for (const name of ['candidate.json', 'candidate.md', 'source.md', 'source_binding.json']) {
    const relative = path.relative(paths.projectRoot, path.join(directory, name)).split(path.sep).join('/');
    const refs = run.artifacts.filter(ref => ref.path === relative);
    const bytes = await text(name);
    if (refs.length !== 1 || refs[0]!.sha256 !== submissionHash(bytes) || refs[0]!.sizeBytes !== Buffer.byteLength(bytes)) throw new SubmissionError('invalid_output');
  }
  let canAdopt = disposition.status === 'pending';
  try { await assertDiagnosticRevisionSourceFresh(scope, binding); } catch { canAdopt = false; }
  return { directory, task, candidate, binding, sourceText, candidateText, disposition, canAdopt };
}
