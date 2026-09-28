import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import type { LLMClient } from '../llm/LLMClient.js';
import { JsonResponseParser } from '../llm/JsonResponseParser.js';
import { ProviderFactory } from '../llm/ProviderFactory.js';
import { TelemetryLLMClient } from '../llm/TelemetryLLMClient.js';
import { RunLogger } from '../logging/RunLogger.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { PromptService } from '../prompts/PromptService.js';
import { normalizeCodexSlimOutput } from '../providers/codex/normalizers.js';
import { ProviderError } from '../providers/codexTextProvider.js';
import { DesktopSubmissionPatchProposalSchema } from '../schemas/desktopSubmissionPatchProposal.js';
import {
  CanonPatchSchema, ChapterMissionSchema, ConfigSchema, ConflictReportSchema,
  DesktopSubmissionPreviewSchema, DesktopSubmissionSourceSchema, DesktopSubmissionTaskSchema, DiagnosticsReportSchema,
  RunManifestV2Schema, StateDiffReportSchema, StoryStateSchema
} from '../schemas/index.js';
import type {
  DesktopSubmissionArtifactReference, DesktopSubmissionPreview, DesktopSubmissionSafeErrorCode,
  DesktopSubmissionStage, DesktopSubmissionTask
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { createRunId } from '../utils/ids.js';
import { applyCanonPatchToStoryState, checkPatchConflicts, detectPatchConflictItems } from './chapterCommit.js';
import { qualityGate } from './chapterRevisionLoop.js';
import { buildDiagnosticsContextManifest } from './codexDiagnosticsContextBuilder.js';
import { withProjectChapterOperationLease } from './projectOperationLease.js';
import { diffPatchPreview, summarizeChanges } from './stateDiff.js';
import {
  assertSubmissionPreviewRun, assertSubmissionPreviewTask, assertSubmissionSourceFresh, captureSubmissionSource,
  readExactSubmissionText, SubmissionError, submissionChapterPath, submissionHash, submissionStore
} from './desktopSubmissionSource.js';
import type { SubmissionProjectInput } from './desktopSubmissionSource.js';

export interface SubmissionCheckInput extends SubmissionProjectInput { taskId: string }
export interface SubmissionCheckOptions {
  fileStore?: FileStore;
  client?: LLMClient;
  shouldCancel: () => boolean;
  onProgress: (task: DesktopSubmissionTask) => Promise<void>;
}

class SubmissionCancelled extends Error {}

export async function checkSubmissionPreview(input: SubmissionCheckInput, options: SubmissionCheckOptions): Promise<DesktopSubmissionTask> {
  const projectRoot = path.resolve(input.projectRoot);
  const paths = new ProjectPaths(path.dirname(projectRoot), path.basename(projectRoot));
  const store = submissionStore(projectRoot, options.fileStore);
  const logger = new RunLogger(paths, store);
  let task = DesktopSubmissionTaskSchema.parse({
    schemaVersion: 1, taskId: input.taskId, projectId: paths.projectId, chapterNumber: input.chapterNumber,
    stage: 'checking_source', status: 'running', runId: null, previewId: null,
    startedAt: new Date().toISOString(), endedAt: null, safeErrorCode: null
  });
  let runStarted = false;
  let publicationStarted = false;
  const taskPath = () => path.join(paths.runDir(task.runId!), 'submission_task.json');
  const progress = async (stage: DesktopSubmissionStage) => {
    task = DesktopSubmissionTaskSchema.parse({ ...task, stage });
    if (runStarted) await store.writeJson(taskPath(), task, DesktopSubmissionTaskSchema);
    await options.onProgress({ ...task });
  };
  try {
    await store.assertSafePath(projectRoot);
    const { source, allocated } = await withProjectChapterOperationLease({ ...input, projectRoot, operation: 'desktop_submission_capture', allowStoryStateWrite: false }, async () => {
      task = { ...task, runId: createRunId() };
      await logger.startRun({ runId: task.runId!, command: 'desktop-submission-check', args: { chapterNumber: input.chapterNumber, provider: 'codex-text' } });
      runStarted = true;
      await progress('checking_source');
      if (options.shouldCancel()) throw new SubmissionCancelled();
      const source = await captureSubmissionSource(input, store);
      const allocated = await allocatePreview(paths, store, input.chapterNumber);
      return { source, allocated };
    });
    const boundary = async () => {
      if (options.shouldCancel()) throw new SubmissionCancelled();
      await assertSubmissionSourceFresh(source, projectRoot, store);
    };
    const readBound = async (ref: DesktopSubmissionArtifactReference) => {
      const text = await readExactSubmissionText(store, paths.projectArtifact(ref.path));
      if (submissionHash(text) !== ref.hash) throw new SubmissionError('source_stale');
      return text;
    };
    const draft = await readBound({ path: source.sourcePath, hash: source.sourceHash });
    const state = StoryStateSchema.parse(JSON.parse(await readBound(source.state)));
    const config = ConfigSchema.parse(JSON.parse(await readBound(source.config)));
    const mission = ChapterMissionSchema.parse(JSON.parse(await readBound(source.mission)));
    const selectedPlan = await readBound(source.selectedPlan);
    const root = allocated.relative;
    const previewId = `submission_ch${String(input.chapterNumber).padStart(3, '0')}_v${allocated.version}`;
    const artifact = (name: string) => path.posix.join(root, name);
    const record = async (relative: string, schemaName?: string) => {
      await logger.recordArtifact(task.runId!, relative, {
        stage: task.stage, sourcePaths: [source.sourcePath, source.state.path, source.mission.path, source.selectedPlan.path, source.config.path],
        ...(schemaName === undefined ? {} : { provenanceNote: `Isolated submission artifact validated with ${schemaName}.` })
      });
      return { path: relative, hash: submissionHash(await readExactSubmissionText(store, paths.projectArtifact(relative))) };
    };
    const write = async <T>(name: string, value: unknown, schema: z.ZodType<T>, schemaName?: string) => {
      const relative = artifact(name);
      await store.writeJson(paths.projectArtifact(relative), value, schema);
      return record(relative, schemaName);
    };
    await store.writeText(paths.projectArtifact(artifact('source.md')), draft);
    const sourceRef = await record(artifact('source.md'));
    await write('source_evidence.json', source, DesktopSubmissionSourceSchema, 'DesktopSubmissionSourceSchema');
    const context = await buildDiagnosticsContextManifest({
      projectId: paths.projectId, projectsRoot: paths.projectsRoot, chapterNumber: input.chapterNumber,
      mode: 'enhanced', draftPath: artifact('source.md'), outputDirectory: root,
      capturedContext: { storyState: state, mission, selectedPlan, draft }
    }, store);
    await record(context.manifestPath, 'DiagnosticsContextManifestSchema');
    await record(context.markdownPath);
    // Templates are packaged assets, not project paths. No optional bible/style inputs are read.
    const prompts = new PromptService('prompts/codex-text');
    const client = options.client === undefined
      ? ProviderFactory.create({ provider: 'codex-text', projectsRoot: paths.projectsRoot, projectId: paths.projectId, telemetry: { paths, runId: task.runId!, fileStore: store } })
      : new TelemetryLLMClient(options.client, { paths, runId: task.runId!, provider: 'injected', fileStore: store });
    const call = async (promptId: string, user: string) => {
      await boundary();
      const response = await client.complete({ promptId, system: 'Novel Loop Engine isolated desktop submission. Read only; return structured evidence, never edit files.', user, responseFormat: 'json', temperature: config.llm.temperature.diagnostics });
      await boundary();
      await writePromptRunArtifacts(store, paths, task.runId!, promptId, user, response.text, { env: { NLE_REDACT_PROMPT_ARTIFACTS: 'true' } });
      return response.json ?? new JsonResponseParser().parse(response.text);
    };
    await progress('diagnostics');
    const diagnosticsPrompt = await prompts.renderPrompt('diagnostics.diagnose_chapter_slim', {
      CHAPTER_NUMBER: input.chapterNumber, DRAFT_VERSION: 1, DRAFT_SUMMARY: draft,
      DIAGNOSTICS_CONTEXT: context.promptContext
    });
    const diagnostics = DiagnosticsReportSchema.parse(normalizeCodexSlimOutput('diagnostics.diagnose_chapter_slim', await call('diagnostics.diagnose_chapter_slim', diagnosticsPrompt), { projectId: paths.projectId, chapterNumber: input.chapterNumber }));
    // Preserve the normalizer's evidence, but never let score-floor coercion relax this gate.
    for (const warning of diagnostics.normalizationWarnings) {
      warning.artifactPath = artifact('diagnostics.json');
      const key = warning.field.replace(/^softScores\./u, '') as keyof typeof diagnostics.soft_scores;
      if (warning.field.startsWith('softScores.') && key in diagnostics.soft_scores) diagnostics.soft_scores[key] = warning.originalValue;
    }
    diagnostics.passed = diagnostics.hardFailures.length === 0 && qualityGate(diagnostics, config.qualityThreshold).passed;
    const diagnosticsRef = await write('diagnostics.json', diagnostics, DiagnosticsReportSchema, 'DiagnosticsReportSchema');
    if (diagnostics.chapterNumber !== input.chapterNumber || diagnostics.draftVersion !== 1) throw new SubmissionError('invalid_output');
    if (!diagnostics.passed || diagnostics.hardFailures.length > 0 || !qualityGate(diagnostics, config.qualityThreshold).passed) throw new SubmissionError('diagnostics_failed');
    await progress('proposing_patch');
    const finalPath = submissionChapterPath(input.chapterNumber, 'final.md');
    const patchPrompt = await prompts.renderPrompt('memory.extract_canon_patch_proposal_slim', {
      CHAPTER_NUMBER: input.chapterNumber, SOURCE_FINAL_PATH: finalPath,
      STORY_STATE_SUMMARY: JSON.stringify(state), FINAL_MARKDOWN: draft
    });
    const proposal = await call('memory.extract_canon_patch_proposal_slim', `${patchPrompt}\n<diagnostics_context>\n${context.promptContext}\n</diagnostics_context>`);
    const proposalRef = await write('patch_proposal.json', proposal, DesktopSubmissionPatchProposalSchema, 'DesktopSubmissionPatchProposalSchema');
    await progress('validating_patch');
    await boundary();
    const patch = normalizeSubmissionPatch(proposal, paths.projectId, input.chapterNumber);
    if (patch.chapterNumber !== input.chapterNumber || patch.sourceFinalPath !== finalPath) throw new SubmissionError('invalid_output');
    const patchRef = await write('normalized_patch.json', patch, CanonPatchSchema, 'CanonPatchSchema');
    const conflicts = checkPatchConflicts(state, patch);
    const conflictRef = await write('conflict_report.json', {
      reportId: `${previewId}_conflict`, projectId: paths.projectId, chapterNumber: input.chapterNumber,
      sourcePatchPath: patchRef.path, generatedAt: new Date().toISOString(), conflicts: detectPatchConflictItems(state, patch)
    }, ConflictReportSchema, 'ConflictReportSchema');
    const changes = diffPatchPreview(state, patch);
    const unsafeToCommit = conflicts.hard.length > 0 || (patch.latestCommittedChapter ?? patch.chapterNumber) !== input.chapterNumber;
    const diffRef = await write('state_diff.json', {
      diffId: `${previewId}_diff`, projectId: paths.projectId, mode: 'patch_preview', patchPath: patchRef.path,
      generatedAt: new Date().toISOString(), unsafeToCommit, summary: summarizeChanges(changes), changes
    }, StateDiffReportSchema, 'StateDiffReportSchema');
    if (unsafeToCommit) throw new SubmissionError('patch_conflict');
    StoryStateSchema.parse(applyCanonPatchToStoryState(state, patch).storyState);
    const preview = DesktopSubmissionPreviewSchema.parse({
      schemaVersion: 1, previewId, version: allocated.version, projectId: paths.projectId,
      chapterNumber: input.chapterNumber, source, runId: task.runId, createdAt: new Date().toISOString(), gatePassed: true,
      artifacts: { source: sourceRef, diagnostics: diagnosticsRef, patchProposal: proposalRef, patch: patchRef, conflict: conflictRef, diff: diffRef }
    });
    task = await withProjectChapterOperationLease({ ...input, projectRoot, operation: 'desktop_submission_publish', allowStoryStateWrite: false }, async () => {
      await boundary();
      await verifySubmissionPreview(preview, projectRoot, store, false);
      await logger.endRun(task.runId!, 'success');
      await boundary();
      // The manifest prepares publication; the matching durable ready task completes it.
      // Keep both writes under the lease and never downgrade evidence after either may persist.
      publicationStarted = true;
      await store.writeJson(paths.projectArtifact(artifact('manifest.json')), preview, DesktopSubmissionPreviewSchema);
      const ready = DesktopSubmissionTaskSchema.parse({ ...task, status: 'ready', previewId, endedAt: new Date().toISOString() });
      await store.writeJson(taskPath(), ready, DesktopSubmissionTaskSchema);
      return ready;
    });
  } catch (error) {
    if (publicationStarted) throw error;
    const cancelled = error instanceof SubmissionCancelled;
    const code = cancelled ? null : submissionErrorCode(error, task.stage);
    task = DesktopSubmissionTaskSchema.parse({ ...task, status: cancelled ? 'cancelled' : code === 'invalid_output' || code === 'unexpected' || code === 'io_error' ? 'failed' : 'blocked', safeErrorCode: code, endedAt: new Date().toISOString(), previewId: null });
    if (runStarted) {
      if (code !== null) await logger.recordError(task.runId!, { code, message: code, recoverable: true });
      const runStatus = cancelled ? 'cancelled' : task.status === 'blocked' ? 'blocked' : 'failed';
      try {
        await logger.endRun(task.runId!, runStatus);
      } catch {
        // Canonical context may now be unreadable. Finalize provenance without rereading it.
        const manifest = await logger.readManifestV2(task.runId!);
        await store.writeJson(paths.runManifest(task.runId!), {
          ...manifest, status: runStatus, endedAt: task.endedAt,
          durationMs: Math.max(0, Date.parse(task.endedAt!) - Date.parse(manifest.startedAt))
        }, RunManifestV2Schema);
      }
    }
  }
  if (runStarted && task.status !== 'ready') await store.writeJson(taskPath(), task, DesktopSubmissionTaskSchema);
  await options.onProgress({ ...task });
  return task;
}

export async function readSubmissionPreview(input: SubmissionProjectInput): Promise<DesktopSubmissionPreview | null> {
  const projectRoot = path.resolve(input.projectRoot);
  const paths = new ProjectPaths(path.dirname(projectRoot), path.basename(projectRoot));
  const store = submissionStore(projectRoot);
  await store.assertSafePath(projectRoot);
  return withProjectChapterOperationLease({ ...input, projectRoot, operation: 'desktop_submission_preview_read', allowStoryStateWrite: false }, async () => {
    const dir = paths.chapterArtifact(input.chapterNumber, 'submission_previews');
    if (!(await store.exists(dir))) return null;
    const versions = (await store.list(dir)).filter(name => /^preview_v[1-9]\d*$/u.test(name)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
    const latest = versions[0];
    if (latest === undefined) return null;
    const manifestPath = path.join(dir, latest, 'manifest.json');
    if (!(await store.exists(manifestPath))) return null;
    const preview = await store.readJson(manifestPath, DesktopSubmissionPreviewSchema);
    if (preview.projectId !== paths.projectId || preview.chapterNumber !== input.chapterNumber || `preview_v${preview.version}` !== latest) throw new SubmissionError('source_stale');
    await verifyDesktopSubmissionPreviewIntegrity(preview, projectRoot, store);
    return preview;
  });
}

async function allocatePreview(paths: ProjectPaths, store: FileStore, chapterNumber: number) {
  const parent = submissionChapterPath(chapterNumber, 'submission_previews');
  await store.ensureDir(paths.projectArtifact(parent));
  const names = await store.list(paths.projectArtifact(parent));
  // Validate all existing versions, including dangling symlinks, before allocating a new one.
  for (const name of names) await store.assertSafePath(paths.projectArtifact(path.posix.join(parent, name)));
  const versions = names.map(name => /^preview_v([1-9]\d*)$/u.exec(name)).filter(match => match !== null).map(match => Number(match[1]));
  const version = Math.max(0, ...versions) + 1;
  if (!Number.isSafeInteger(version)) throw new SubmissionError('io_error');
  const relative = path.posix.join(parent, `preview_v${version}`);
  if (await store.exists(paths.projectArtifact(relative))) throw new SubmissionError('generation_busy');
  await store.ensureDir(paths.projectArtifact(relative));
  return { version, relative };
}

export async function verifyDesktopSubmissionPreviewIntegrity(previewInput: DesktopSubmissionPreview, projectRoot: string, fileStore?: FileStore) {
  return verifySubmissionPreview(previewInput, projectRoot, fileStore, true);
}

async function verifySubmissionPreview(previewInput: DesktopSubmissionPreview, projectRoot: string, fileStore: FileStore | undefined, requirePublication: boolean) {
  const preview = DesktopSubmissionPreviewSchema.parse(previewInput);
  const root = path.resolve(projectRoot);
  const paths = new ProjectPaths(path.dirname(root), path.basename(root));
  const store = submissionStore(root, fileStore);
  await store.assertSafePath(root);
  return withProjectChapterOperationLease({ projectRoot: root, chapterNumber: preview.chapterNumber, operation: 'desktop_submission_verify', allowStoryStateWrite: false }, async () => {
    if (preview.projectId !== paths.projectId) throw new SubmissionError('source_stale');
    if (requirePublication) {
      const manifestPath = submissionChapterPath(preview.chapterNumber, 'submission_previews', `preview_v${preview.version}`, 'manifest.json');
      const persisted = DesktopSubmissionPreviewSchema.parse(JSON.parse(await readExactSubmissionText(store, paths.projectArtifact(manifestPath))));
      if (!isDeepStrictEqual(persisted, preview)) throw new SubmissionError('source_stale');
      assertSubmissionPreviewTask(preview, JSON.parse(await readExactSubmissionText(store, paths.projectArtifact(`runs/${preview.runId}/submission_task.json`))));
      assertSubmissionPreviewRun(preview, JSON.parse(await readExactSubmissionText(store, paths.runManifest(preview.runId))));
    }
    await assertSubmissionSourceFresh(preview.source, root, store);
    const texts = {} as Record<keyof DesktopSubmissionPreview['artifacts'], string>;
    for (const key of Object.keys(preview.artifacts) as (keyof typeof preview.artifacts)[]) {
      const ref = preview.artifacts[key];
      const text = await readExactSubmissionText(store, paths.projectArtifact(ref.path));
      if (submissionHash(text) !== ref.hash) throw new SubmissionError('source_stale');
      texts[key] = text;
    }
    const diagnostics = DiagnosticsReportSchema.parse(JSON.parse(texts.diagnostics));
    const config = await store.readJson(paths.config(), ConfigSchema);
    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    const patch = CanonPatchSchema.parse(JSON.parse(texts.patch));
    const patchProposal = DesktopSubmissionPatchProposalSchema.parse(JSON.parse(texts.patchProposal));
    const normalized = normalizeSubmissionPatch(patchProposal, paths.projectId, preview.chapterNumber);
    const conflict = ConflictReportSchema.parse(JSON.parse(texts.conflict));
    const diff = StateDiffReportSchema.parse(JSON.parse(texts.diff));
    const changes = diffPatchPreview(state, patch);
    if (!isDeepStrictEqual(normalized, patch) || diagnostics.chapterNumber !== preview.chapterNumber || diagnostics.draftVersion !== 1 || !diagnostics.passed || diagnostics.hardFailures.length > 0 || !qualityGate(diagnostics, config.qualityThreshold).passed
      || patch.chapterNumber !== preview.chapterNumber || (patch.latestCommittedChapter ?? patch.chapterNumber) !== preview.chapterNumber
      || patch.sourceFinalPath !== submissionChapterPath(preview.chapterNumber, 'final.md')
      || checkPatchConflicts(state, patch).hard.length > 0 || conflict.projectId !== paths.projectId || conflict.chapterNumber !== preview.chapterNumber || conflict.sourcePatchPath !== preview.artifacts.patch.path
      || !isDeepStrictEqual(conflict.conflicts, detectPatchConflictItems(state, patch)) || diff.projectId !== paths.projectId || diff.mode !== 'patch_preview' || diff.patchPath !== preview.artifacts.patch.path || diff.unsafeToCommit
      || !isDeepStrictEqual(diff.changes, changes) || !isDeepStrictEqual(diff.summary, summarizeChanges(changes))) throw new SubmissionError('source_stale');
    StoryStateSchema.parse(applyCanonPatchToStoryState(state, patch).storyState);
    await assertSubmissionSourceFresh(preview.source, root, store);
    return { sourceText: texts.source, diagnostics, patchProposal, patch, conflict, diff };
  });
}

export type DesktopSubmissionVerifiedPreview = Awaited<ReturnType<typeof verifyDesktopSubmissionPreviewIntegrity>>;

function normalizeSubmissionPatch(proposal: unknown, projectId: string, chapterNumber: number) {
  const identity = z.object({ chapterNumber: z.number().int(), latestCommittedChapter: z.number().int().optional() }).parse(proposal);
  if (identity.chapterNumber !== chapterNumber) throw new SubmissionError('invalid_output');
  // The shared normalizer rewrites these fields. Reject an out-of-order proposal before normalization.
  if (identity.latestCommittedChapter !== undefined && identity.latestCommittedChapter !== chapterNumber) throw new SubmissionError('patch_conflict');
  return CanonPatchSchema.parse(normalizeCodexSlimOutput('memory.extract_canon_patch_proposal_slim', proposal, { projectId, chapterNumber }));
}

export function submissionErrorCode(error: unknown, stage: DesktopSubmissionStage): DesktopSubmissionSafeErrorCode {
  if (error instanceof SubmissionError) return error.code;
  if (error instanceof ProviderError && error.classification !== undefined) return error.classification === 'unavailable' ? 'codex_unavailable' : error.classification;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code.includes('UNSAFE_PATH')) return 'unsafe_path';
  if (code.includes('LOCKED')) return 'generation_busy';
  if (code === 'PROJECT_OPERATION_TARGET_INVALID') return 'plan_missing';
  if (code.includes('STALE')) return 'source_stale';
  if (code.includes('USAGE_LIMIT')) return 'usage_limit';
  if (code.includes('TIMEOUT')) return 'timeout';
  if (code.includes('LOGIN') || code.includes('AUTH')) return 'login_required';
  if (code.includes('UPGRADE')) return 'upgrade_required';
  if (code.includes('UNAVAILABLE') || code.includes('NOT_FOUND')) return 'codex_unavailable';
  if (stage === 'checking_source' && (error instanceof z.ZodError || error instanceof SyntaxError || code === 'ENOENT')) return 'source_missing';
  if (error instanceof z.ZodError || error instanceof SyntaxError || code.includes('JSON') || code.includes('SCHEMA') || code === 'CODEX_REPAIR_FAILED') return 'invalid_output';
  if (code.startsWith('E')) return 'io_error';
  return 'unexpected';
}
