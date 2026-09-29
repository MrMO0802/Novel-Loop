import path from 'node:path';
import type { z } from 'zod';

import { checkPatchConflicts } from './chapterCommit.js';
import { hashJson, RunLogger } from '../logging/RunLogger.js';
import {
  CanonPatchSchema,
  ChapterQueueSchema,
  CodexCommitConsistencyReportSchema,
  CodexPreviewCompletenessReportSchema,
  CodexPreviewFailureReportSchema,
  DiagnosticsReportSchema,
  RevisionPlanSchema,
  RunManifestSchema,
  StateDiffReportSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  CanonPatch,
  CodexErrorType,
  CodexPreviewArtifactCheck,
  CodexPreviewCompletenessReport,
  CodexPreviewFailureReport,
  CodexPreviewSubStageName,
  CodexPreviewSubStageTimelineItem,
  DiagnosticsReport,
  RunManifest,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';

export class CodexPreviewSubStageTracker {
  private readonly timeline = new Map<CodexPreviewSubStageName, CodexPreviewSubStageTimelineItem>();

  constructor(
    private readonly runLogger: RunLogger,
    private readonly runId: string,
    private readonly chapterNumber: number
  ) {}

  async start(name: CodexPreviewSubStageName): Promise<void> {
    const startedAt = new Date().toISOString();
    this.timeline.set(name, { name, status: 'started', startedAt, artifactPaths: [] });
    await this.runLogger.recordStageStatus(this.runId, {
      stage: stageName(name),
      status: 'started',
      chapterNumber: this.chapterNumber,
      payload: { subStage: name, status: 'started' }
    });
  }

  async complete(name: CodexPreviewSubStageName, artifactPaths: string[] = []): Promise<void> {
    const previous = this.timeline.get(name);
    const endedAt = new Date().toISOString();
    const startedAt = previous?.startedAt ?? endedAt;
    this.timeline.set(name, {
      name,
      status: 'completed',
      startedAt,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      artifactPaths
    });
    await this.runLogger.recordStageStatus(this.runId, {
      stage: stageName(name),
      status: 'completed',
      chapterNumber: this.chapterNumber,
      relatedArtifactPaths: artifactPaths,
      payload: { subStage: name, status: 'completed', artifactPaths }
    });
  }

  async fail(name: CodexPreviewSubStageName, errorCode: CodexErrorType, message: string, artifactPaths: string[] = []): Promise<void> {
    const previous = this.timeline.get(name);
    const endedAt = new Date().toISOString();
    const startedAt = previous?.startedAt ?? endedAt;
    this.timeline.set(name, {
      name,
      status: 'failed',
      startedAt,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      artifactPaths,
      errorCode,
      message
    });
    await this.runLogger.recordStageStatus(this.runId, {
      stage: stageName(name),
      status: 'failed',
      chapterNumber: this.chapterNumber,
      relatedArtifactPaths: artifactPaths,
      severity: 'error',
      payload: { subStage: name, status: 'failed', errorCode, message, artifactPaths }
    });
  }

  items(): CodexPreviewSubStageTimelineItem[] {
    return [...this.timeline.values()];
  }
}

export interface WriteCodexPreviewCompletenessInput {
  paths: ProjectPaths;
  fileStore: FileStore;
  runLogger?: RunLogger;
  chapterNumber: number;
  previewRunId: string;
  previewStage?: string;
  subStageTimeline?: CodexPreviewSubStageTimelineItem[];
  latestCommittedChapterBefore: number;
  latestCommittedChapterAfter: number;
  storyStateHashBefore: string;
  storyStateHashAfter: string;
}

export interface WriteCodexPreviewFailureInput extends WriteCodexPreviewCompletenessInput {
  completenessReportPath: string;
  completenessReport: CodexPreviewCompletenessReport;
  error?: unknown;
  errorCode?: CodexErrorType;
  failedSubStage?: CodexPreviewSubStageName;
  lastSuccessfulSubStage?: CodexPreviewSubStageName;
}

const PREVIEW_SUBSTAGES: CodexPreviewSubStageName[] = [
  'draft_ready_check',
  'diagnostics',
  'revision_plan',
  'final_generation_or_assembly',
  'quality_report',
  'canon_patch_proposal',
  'patch_normalization',
  'schema_validation',
  'conflict_check',
  'state_diff_preview',
  'completeness_check'
];

const CODE_PRIORITY: CodexErrorType[] = [
  'CODEX_PREVIEW_DIAGNOSTICS_MISSING',
  'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL',
  'CODEX_PREVIEW_FINAL_MISSING',
  'CODEX_PREVIEW_PATCH_PROPOSAL_MISSING',
  'CODEX_PREVIEW_PATCH_SCHEMA_INVALID',
  'CODEX_PREVIEW_PATCH_NORMALIZATION_FAILED',
  'CODEX_PREVIEW_CONFLICT_DETECTED',
  'CODEX_PREVIEW_STATE_DIFF_MISSING',
  'CODEX_PREVIEW_STATE_HASH_MISSING',
  'CODEX_PREVIEW_RUN_MANIFEST_MISSING',
  'CODEX_PREVIEW_EVENT_LOG_MISSING',
  'CODEX_PREVIEW_INCOMPLETE'
];

export async function writeCodexPreviewCompletenessReport(
  input: WriteCodexPreviewCompletenessInput
): Promise<{ report: CodexPreviewCompletenessReport; reportPath: string; markdownPath: string }> {
  const queue = await readQueueStatus(input.paths, input.fileStore, input.chapterNumber);
  const stateAfter = await input.fileStore.readJson(input.paths.storyState(), StoryStateSchema);
  const checks = await collectPreviewArtifactChecks(input, stateAfter);
  const missingArtifacts = checks.filter((check) => !check.exists && check.blocking);
  const invalidArtifacts = checks.filter((check) => check.exists && !check.schemaValid && check.blocking);
  const blockingReasons = classifyBlockingReasons(checks);
  const complete = blockingReasons.length === 0;
  const consistency = await readLatestConsistency(input.paths, input.fileStore, input.chapterNumber);
  const artifact = await nextVersionedChapterArtifact(input.paths, input.fileStore, input.chapterNumber, 'codex_preview_completeness_report');
  const report = await input.fileStore.writeJson(
    artifact.absolutePath,
    {
      reportId: `codex_preview_completeness_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
      projectId: input.paths.projectId,
      chapterNumber: input.chapterNumber,
      generatedAt: new Date().toISOString(),
      provider: 'codex-text',
      previewRunId: input.previewRunId,
      previewStage: input.previewStage ?? 'controlled_commit_preview',
      complete,
      missingArtifacts,
      invalidArtifacts,
      blockingReasons,
      warnings: collectWarnings(checks),
      suggestedRetryCommand: suggestedRetryCommand(input.paths.projectId, input.chapterNumber, blockingReasons[0], complete),
      suggestedInspectCommands: suggestedInspectCommands(input.paths.projectId, input.chapterNumber, input.previewRunId),
      subStageTimeline: input.subStageTimeline ?? [],
      ...(queue.before === undefined ? {} : { queueStatusBefore: queue.before }),
      ...(queue.after === undefined ? {} : { queueStatusAfter: queue.after }),
      latestCommittedChapterBefore: input.latestCommittedChapterBefore,
      latestCommittedChapterAfter: input.latestCommittedChapterAfter,
      storyStateMutated: input.storyStateHashBefore !== input.storyStateHashAfter,
      ...(consistency?.previewStoryStateHash === undefined ? {} : { previewStateHash: consistency.previewStoryStateHash }),
      previewStateHashRecorded: consistency?.previewStoryStateHash !== undefined,
      ...(blockingReasons.includes('CODEX_PREVIEW_CONFLICT_DETECTED') ? { conflictCheckPassed: false } : consistency === undefined ? {} : { conflictCheckPassed: true }),
      redacted: true
    },
    CodexPreviewCompletenessReportSchema
  );
  await input.fileStore.writeText(artifact.markdownPath, renderCompletenessMarkdown(report));
  await input.runLogger?.recordEvent(input.previewRunId, 'CODEX_PREVIEW_COMPLETENESS_REPORTED', {
    stage: 'preview.completeness_check',
    chapterNumber: input.chapterNumber,
    relatedArtifactPaths: [artifact.relativePath],
    payload: {
      complete: report.complete,
      blockingReasons: report.blockingReasons,
      missingArtifacts: report.missingArtifacts.length,
      invalidArtifacts: report.invalidArtifacts.length
    },
    severity: report.complete ? 'info' : 'warning'
  });
  return { report, reportPath: artifact.relativePath, markdownPath: artifact.relativeMarkdownPath };
}

export async function writeCodexPreviewFailureReport(
  input: WriteCodexPreviewFailureInput
): Promise<{ report: CodexPreviewFailureReport; reportPath: string; markdownPath: string }> {
  const run = await readRunManifest(input.paths, input.fileStore, input.previewRunId);
  const promptCalls = run !== undefined && 'schemaVersion' in run && run.schemaVersion === '2' ? run.promptCalls : [];
  const providerFailure = await readProviderFailure(input.paths, input.fileStore, input.previewRunId);
  const artifact = await nextVersionedChapterArtifact(input.paths, input.fileStore, input.chapterNumber, 'codex_preview_failure_report');
  const errorCode = input.errorCode ?? classifyCodexPreviewCompleteness(input.completenessReport);
  const finalOutputPath = lastDefined(promptCalls.map((call) => call.finalOutputPath)) ?? providerFailure?.finalOutputPath;
  const conflictReportPath = await latestArtifactPath(input.paths, input.fileStore, input.chapterNumber, 'conflict_report');
  const stateDiffPath = await latestStateDiffPath(input.paths, input.fileStore, input.chapterNumber);
  const report = await input.fileStore.writeJson(
    artifact.absolutePath,
    {
      reportId: `codex_preview_failure_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
      projectId: input.paths.projectId,
      runId: input.previewRunId,
      chapterNumber: input.chapterNumber,
      provider: 'codex-text',
      generatedAt: new Date().toISOString(),
      failureStage: input.previewStage ?? 'controlled_commit_preview',
      errorCode,
      previewCompletenessReportPath: input.completenessReportPath,
      ...(input.failedSubStage === undefined ? {} : { failedSubStage: input.failedSubStage }),
      ...(input.lastSuccessfulSubStage === undefined ? {} : { lastSuccessfulSubStage: input.lastSuccessfulSubStage }),
      rawOutputPaths: uniqueStrings([
        ...promptCalls.flatMap((call) => (call.rawOutputPath === undefined ? [] : [call.rawOutputPath])),
        ...(providerFailure?.rawOutputPath === undefined ? [] : [providerFailure.rawOutputPath])
      ]),
      ...(finalOutputPath === undefined ? {} : { finalOutputPath }),
      parsedOutputPaths: uniqueStrings(promptCalls.flatMap((call) => (call.parsedOutputPath === undefined ? [] : [call.parsedOutputPath]))),
      schemaErrorPaths: uniqueStrings(providerFailure?.schemaErrorPath === undefined ? [] : [providerFailure.schemaErrorPath]),
      normalizationErrorPaths: uniqueStrings(normalizationErrorPaths(input.error)),
      ...(conflictReportPath === undefined ? {} : { conflictReportPath }),
      ...(stateDiffPath === undefined ? {} : { stateDiffPath }),
      ...(run !== undefined && 'schemaVersion' in run && run.schemaVersion === '2' && run.resolvedContext.queueStatusBefore !== undefined ? { queueStatusBefore: run.resolvedContext.queueStatusBefore } : {}),
      ...(run !== undefined && 'schemaVersion' in run && run.schemaVersion === '2' && run.resolvedContext.queueStatusAfter !== undefined ? { queueStatusAfter: run.resolvedContext.queueStatusAfter } : {}),
      latestCommittedChapterBefore: input.latestCommittedChapterBefore,
      latestCommittedChapterAfter: input.latestCommittedChapterAfter,
      storyStateMutated: input.storyStateHashBefore !== input.storyStateHashAfter,
      suggestedRetryCommand: suggestedRetryCommand(input.paths.projectId, input.chapterNumber, errorCode, false),
      suggestedResumeCommand: suggestedRetryCommand(input.paths.projectId, input.chapterNumber, errorCode, false),
      suggestedInspectCommands: suggestedInspectCommands(input.paths.projectId, input.chapterNumber, input.previewRunId),
      redacted: true
    },
    CodexPreviewFailureReportSchema
  );
  await input.fileStore.writeText(artifact.markdownPath, renderFailureMarkdown(report));
  await input.runLogger?.recordEvent(input.previewRunId, 'CODEX_PREVIEW_FAILURE_REPORTED', {
    stage: 'preview.completeness_check',
    chapterNumber: input.chapterNumber,
    relatedArtifactPaths: [artifact.relativePath, input.completenessReportPath],
    payload: {
      errorCode: report.errorCode,
      failedSubStage: report.failedSubStage,
      previewCompletenessReportPath: input.completenessReportPath
    },
    severity: 'error'
  });
  return { report, reportPath: artifact.relativePath, markdownPath: artifact.relativeMarkdownPath };
}

export function classifyCodexPreviewCompleteness(report: CodexPreviewCompletenessReport): CodexErrorType {
  for (const code of CODE_PRIORITY) {
    if (report.blockingReasons.includes(code)) return code;
  }
  return report.complete ? 'CODEX_PREVIEW_INCOMPLETE' : 'CODEX_PREVIEW_INCOMPLETE';
}

export async function readLatestCodexPreviewCompletenessReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number
): Promise<{ report: CodexPreviewCompletenessReport; relativePath: string } | undefined> {
  const artifact = await findLatestVersionedChapterArtifact(paths, fileStore, chapterNumber, 'codex_preview_completeness_report');
  if (artifact === undefined) return undefined;
  return {
    report: await fileStore.readJson(artifact.absolutePath, CodexPreviewCompletenessReportSchema),
    relativePath: artifact.relativePath
  };
}

export async function readLatestCodexPreviewFailureReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number
): Promise<{ report: CodexPreviewFailureReport; relativePath: string } | undefined> {
  const artifact = await findLatestVersionedChapterArtifact(paths, fileStore, chapterNumber, 'codex_preview_failure_report');
  if (artifact === undefined) return undefined;
  return {
    report: await fileStore.readJson(artifact.absolutePath, CodexPreviewFailureReportSchema),
    relativePath: artifact.relativePath
  };
}

async function collectPreviewArtifactChecks(input: WriteCodexPreviewCompletenessInput, storyState: StoryState): Promise<CodexPreviewArtifactCheck[]> {
  const checks: CodexPreviewArtifactCheck[] = [];
  const diagnosticsPath = relativeChapterArtifact(input.chapterNumber, 'diagnostics_v1.json');
  const diagnostics = await checkJsonArtifact(input.paths, input.fileStore, 'diagnostics', diagnosticsPath, DiagnosticsReportSchema, true);
  checks.push(diagnostics.check);
  const diagnosticsValue = diagnostics.value;
  const diagnosticsHardFailures =
    diagnosticsValue === undefined ? [] : Object.entries(diagnosticsValue.hard_checks).filter(([, result]) => !result.passed).map(([key]) => key);
  if (diagnosticsValue !== undefined && diagnosticsHardFailures.length > 0) {
    checks.push({
      artifactType: 'diagnostics',
      expectedPath: diagnosticsPath,
      exists: true,
      schemaValid: false,
      reason: `diagnostics hard check failure: ${diagnosticsHardFailures.join(', ')}`,
      requiredForPreview: true,
      blocking: true
    });
  }

  const finalPath = relativeChapterArtifact(input.chapterNumber, 'final.md');
  checks.push(await checkTextArtifact(input.paths, input.fileStore, 'final', finalPath, true));

  const revisionRequired = diagnosticsValue === undefined || diagnosticsHardFailures.length > 0 || diagnosticsValue.scores.total < 8;
  if (revisionRequired) {
    checks.push((await checkJsonArtifact(input.paths, input.fileStore, 'revision_plan', relativeChapterArtifact(input.chapterNumber, 'revision_plan_v1.json'), RevisionPlanSchema, true)).check);
  }

  const qualityArtifact = await findLatestVersionedChapterArtifact(input.paths, input.fileStore, input.chapterNumber, 'codex_chapter_quality_report');
  checks.push(
    qualityArtifact === undefined
      ? missingCheck('final_quality_report', relativeChapterArtifact(input.chapterNumber, 'codex_chapter_quality_report_vN.json'), 'final quality report is missing', true)
      : validExistingCheck('final_quality_report', qualityArtifact.relativePath)
  );

  const proposal = await findLatestVersionedChapterArtifact(input.paths, input.fileStore, input.chapterNumber, 'canon_patch_codex_proposal');
  const proposalCheck =
    proposal === undefined
      ? { check: missingCheck('canon_patch_codex_proposal', relativeChapterArtifact(input.chapterNumber, 'canon_patch_codex_proposal_vN.json'), 'Codex patch proposal is missing', true), value: undefined }
      : await checkJsonArtifact(input.paths, input.fileStore, 'canon_patch_codex_proposal', proposal.relativePath, CanonPatchSchema, true);
  checks.push(proposalCheck.check);

  const normalized = await findLatestVersionedChapterArtifact(input.paths, input.fileStore, input.chapterNumber, 'canon_patch_codex_normalized');
  const normalizedCheck =
    normalized === undefined
      ? { check: missingCheck('canon_patch_codex_normalized', relativeChapterArtifact(input.chapterNumber, 'canon_patch_codex_normalized_vN.json'), 'Codex patch normalization output is missing', true), value: undefined }
      : await checkJsonArtifact(input.paths, input.fileStore, 'canon_patch_codex_normalized', normalized.relativePath, CanonPatchSchema, true);
  checks.push(normalizedCheck.check);

  const patch = normalizedCheck.value ?? proposalCheck.value;
  if (patch !== undefined) {
    const conflicts = checkPatchConflicts(storyState, patch);
    if (conflicts.hard.length > 0) {
      checks.push({
        artifactType: 'conflict_check',
        expectedPath: normalizedCheck.value === undefined ? proposalCheck.check.expectedPath : normalizedCheck.check.expectedPath,
        exists: true,
        schemaValid: false,
        reason: `blocking conflict detected: ${conflicts.hard.join('; ')}`,
        requiredForPreview: true,
        blocking: true
      });
    }
  }

  const consistency = await readLatestConsistency(input.paths, input.fileStore, input.chapterNumber);
  if (consistency === undefined) {
    checks.push(missingCheck('state_diff_preview', 'diffs/state_diff_*.json', 'state diff preview is missing', true));
    checks.push(missingCheck('preview_state_hash', relativeChapterArtifact(input.chapterNumber, 'codex_commit_consistency_report_vN.json'), 'preview state hash is missing', true));
  } else {
    checks.push(await checkJsonArtifact(input.paths, input.fileStore, 'state_diff_preview', consistency.previewStateDiffPath, StateDiffReportSchema, true).then((result) => result.check));
    checks.push(
      consistency.previewStoryStateHash === undefined
        ? missingCheck('preview_state_hash', consistency.previewStateDiffPath, 'preview state hash is missing from consistency report', true)
        : validExistingCheck('preview_state_hash', consistency.previewStateDiffPath)
    );
  }

  checks.push(await checkJsonArtifact(input.paths, input.fileStore, 'preview_run_manifest', path.posix.join('runs', input.previewRunId, 'run_manifest.json'), RunManifestSchema, true).then((result) => result.check));
  checks.push(await checkTextArtifact(input.paths, input.fileStore, 'preview_event_log', path.posix.join('runs', input.previewRunId, 'events.ndjson'), true));

  const queueStatus = await readCurrentQueueStatus(input.paths, input.fileStore, input.chapterNumber);
  if (queueStatus === 'committed') {
    checks.push({
      artifactType: 'chapter_queue',
      expectedPath: 'planning/chapter_queue.json',
      exists: true,
      schemaValid: false,
      reason: 'queue status is committed after preview failure',
      requiredForPreview: true,
      blocking: true
    });
  }
  if (input.latestCommittedChapterBefore !== input.latestCommittedChapterAfter || input.storyStateHashBefore !== input.storyStateHashAfter) {
    checks.push({
      artifactType: 'story_state',
      expectedPath: 'state/story_state.json',
      exists: true,
      schemaValid: false,
      reason: 'Story State changed during preview',
      requiredForPreview: true,
      blocking: true
    });
  }
  return checks;
}

function classifyBlockingReasons(checks: CodexPreviewArtifactCheck[]): CodexErrorType[] {
  const codes: CodexErrorType[] = [];
  for (const check of checks.filter((candidate) => candidate.blocking && (!candidate.exists || !candidate.schemaValid))) {
    const code = codeForCheck(check);
    if (!codes.includes(code)) codes.push(code);
  }
  return codes.sort((left, right) => CODE_PRIORITY.indexOf(left) - CODE_PRIORITY.indexOf(right));
}

function codeForCheck(check: CodexPreviewArtifactCheck): CodexErrorType {
  if (check.artifactType === 'diagnostics' && !check.exists) return 'CODEX_PREVIEW_DIAGNOSTICS_MISSING';
  if (check.artifactType === 'diagnostics' && check.reason.includes('hard check')) return 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL';
  if (check.artifactType === 'final') return 'CODEX_PREVIEW_FINAL_MISSING';
  if (check.artifactType === 'canon_patch_codex_proposal' && !check.exists) return 'CODEX_PREVIEW_PATCH_PROPOSAL_MISSING';
  if (check.artifactType === 'canon_patch_codex_proposal') return 'CODEX_PREVIEW_PATCH_SCHEMA_INVALID';
  if (check.artifactType === 'canon_patch_codex_normalized' && !check.exists) return 'CODEX_PREVIEW_PATCH_NORMALIZATION_FAILED';
  if (check.artifactType === 'canon_patch_codex_normalized') return 'CODEX_PREVIEW_PATCH_SCHEMA_INVALID';
  if (check.artifactType === 'conflict_check') return 'CODEX_PREVIEW_CONFLICT_DETECTED';
  if (check.artifactType === 'state_diff_preview') return 'CODEX_PREVIEW_STATE_DIFF_MISSING';
  if (check.artifactType === 'preview_state_hash') return 'CODEX_PREVIEW_STATE_HASH_MISSING';
  if (check.artifactType === 'preview_run_manifest') return 'CODEX_PREVIEW_RUN_MANIFEST_MISSING';
  if (check.artifactType === 'preview_event_log') return 'CODEX_PREVIEW_EVENT_LOG_MISSING';
  return 'CODEX_PREVIEW_INCOMPLETE';
}

function collectWarnings(checks: CodexPreviewArtifactCheck[]): string[] {
  return checks.filter((check) => !check.blocking && (!check.exists || !check.schemaValid)).map((check) => `${check.artifactType}: ${check.reason}`);
}

async function checkTextArtifact(paths: ProjectPaths, fileStore: FileStore, artifactType: string, relativePath: string, blocking: boolean): Promise<CodexPreviewArtifactCheck> {
  const exists = await fileStore.exists(paths.projectArtifact(relativePath));
  return {
    artifactType,
    expectedPath: relativePath,
    exists,
    schemaValid: exists,
    reason: exists ? 'ok' : `${artifactType} is missing`,
    requiredForPreview: blocking,
    blocking
  };
}

async function checkJsonArtifact<T>(
  paths: ProjectPaths,
  fileStore: FileStore,
  artifactType: string,
  relativePath: string,
  schema: z.ZodType<T>,
  blocking: boolean
): Promise<{ check: CodexPreviewArtifactCheck; value?: T }> {
  const absolutePath = paths.projectArtifact(relativePath);
  if (!(await fileStore.exists(absolutePath))) {
    return {
      check: missingCheck(artifactType, relativePath, `${artifactType} is missing`, blocking)
    };
  }
  try {
    const value = await fileStore.readJson(absolutePath, schema);
    return {
      check: validExistingCheck(artifactType, relativePath),
      value
    };
  } catch (error) {
    return {
      check: {
        artifactType,
        expectedPath: relativePath,
        exists: true,
        schemaValid: false,
        reason: getErrorMessage(error),
        requiredForPreview: blocking,
        blocking
      }
    };
  }
}

function missingCheck(artifactType: string, expectedPath: string, reason: string, blocking: boolean): CodexPreviewArtifactCheck {
  return {
    artifactType,
    expectedPath,
    exists: false,
    schemaValid: false,
    reason,
    requiredForPreview: blocking,
    blocking
  };
}

function validExistingCheck(artifactType: string, expectedPath: string): CodexPreviewArtifactCheck {
  return {
    artifactType,
    expectedPath,
    exists: true,
    schemaValid: true,
    reason: 'ok',
    requiredForPreview: true,
    blocking: true
  };
}

async function readLatestConsistency(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number) {
  const artifact = await findLatestVersionedChapterArtifact(paths, fileStore, chapterNumber, 'codex_commit_consistency_report');
  if (artifact === undefined) return undefined;
  try {
    return fileStore.readJson(artifact.absolutePath, CodexCommitConsistencyReportSchema);
  } catch {
    return undefined;
  }
}

async function readQueueStatus(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<{ before?: string; after?: string }> {
  const runIds = await findLatestCodexPreviewRun(paths, fileStore, chapterNumber);
  if (runIds === undefined) return {};
  const manifest = await readRunManifest(paths, fileStore, runIds);
  if (manifest === undefined || !('schemaVersion' in manifest) || manifest.schemaVersion !== '2') return {};
  return {
    ...(manifest.resolvedContext.queueStatusBefore === undefined ? {} : { before: manifest.resolvedContext.queueStatusBefore }),
    ...(manifest.resolvedContext.queueStatusAfter === undefined ? {} : { after: manifest.resolvedContext.queueStatusAfter })
  };
}

async function readCurrentQueueStatus(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<string | undefined> {
  if (!(await fileStore.exists(paths.chapterQueue()))) return undefined;
  const queue = await fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema);
  return queue.chapters.find((chapter) => chapter.chapterNumber === chapterNumber)?.status;
}

async function findLatestCodexPreviewRun(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<string | undefined> {
  if (!(await fileStore.exists(paths.chapterQueue()))) return undefined;
  const queue = await fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema);
  return queue.chapters.find((chapter) => chapter.chapterNumber === chapterNumber)?.latestRunId ?? undefined;
}

async function readRunManifest(paths: ProjectPaths, fileStore: FileStore, runId: string): Promise<RunManifest | undefined> {
  if (!(await fileStore.exists(paths.runManifest(runId)))) return undefined;
  return fileStore.readJson(paths.runManifest(runId), RunManifestSchema);
}

async function readProviderFailure(paths: ProjectPaths, fileStore: FileStore, runId: string): Promise<{ rawOutputPath?: string; finalOutputPath?: string; schemaErrorPath?: string } | undefined> {
  const relativePath = path.posix.join('codex', 'failures', runId, 'codex_failure_report.json');
  if (!(await fileStore.exists(paths.projectArtifact(relativePath)))) return undefined;
  try {
    const parsed = JSON.parse(await fileStore.readText(paths.projectArtifact(relativePath))) as Record<string, unknown>;
    return {
      ...(typeof parsed.rawOutputPath === 'string' ? { rawOutputPath: parsed.rawOutputPath } : {}),
      ...(typeof parsed.finalOutputPath === 'string' ? { finalOutputPath: parsed.finalOutputPath } : {}),
      ...(typeof parsed.schemaErrorPath === 'string' ? { schemaErrorPath: parsed.schemaErrorPath } : {})
    };
  } catch {
    return undefined;
  }
}

async function latestArtifactPath(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string): Promise<string | undefined> {
  return (await findLatestVersionedChapterArtifact(paths, fileStore, chapterNumber, baseName))?.relativePath;
}

async function latestStateDiffPath(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<string | undefined> {
  const consistency = await readLatestConsistency(paths, fileStore, chapterNumber);
  return consistency?.previewStateDiffPath;
}

function normalizationErrorPaths(error: unknown): string[] {
  if (error instanceof AppError && typeof error.details?.normalizationErrorPath === 'string') return [error.details.normalizationErrorPath];
  return [];
}

function lastDefined(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => value !== undefined).at(-1);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function stageName(name: CodexPreviewSubStageName): string {
  return `preview.${name}`;
}

function suggestedRetryCommand(projectId: string, chapterNumber: number, errorCode: CodexErrorType | undefined, complete: boolean): string {
  if (complete) {
    return `corepack pnpm novel-loop chapter ${projectId} ${chapterNumber} --provider codex-text --max-revisions 2 --commit --confirm-codex-commit`;
  }
  const resumeFrom =
    errorCode === 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL'
      ? 'revision_plan'
      : errorCode === 'CODEX_PREVIEW_PATCH_SCHEMA_INVALID' || errorCode === 'CODEX_PREVIEW_PATCH_NORMALIZATION_FAILED'
        ? 'patch_normalization'
        : errorCode === 'CODEX_PREVIEW_PATCH_PROPOSAL_MISSING'
          ? 'canon_patch_proposal'
          : 'diagnostics';
  return `corepack pnpm novel-loop chapter ${projectId} ${chapterNumber} --provider codex-text --commit --codex-profile clean --codex-json-retries 2 --codex-json-repair --resume-from ${resumeFrom}`;
}

function suggestedInspectCommands(projectId: string, chapterNumber: number, runId: string): string[] {
  return [
    `corepack pnpm novel-loop review ${projectId} ${chapterNumber} --diagnostics --artifacts --suggest-next`,
    `corepack pnpm novel-loop run ${projectId} ${runId} --events`,
    `corepack pnpm novel-loop artifacts ${projectId} --chapter ${chapterNumber}`,
    `corepack pnpm novel-loop codex runtime-gap ${projectId}`
  ];
}

function renderCompletenessMarkdown(report: CodexPreviewCompletenessReport): string {
  return [
    `# Codex Preview Completeness Chapter ${report.chapterNumber}`,
    '',
    `complete: ${String(report.complete)}`,
    `previewRunId: ${report.previewRunId}`,
    `blockingReasons: ${report.blockingReasons.join(', ') || 'none'}`,
    `storyStateMutated: ${String(report.storyStateMutated)}`,
    '',
    '## Missing Artifacts',
    ...(report.missingArtifacts.length === 0 ? ['none'] : report.missingArtifacts.map((artifact) => `- ${artifact.artifactType}: ${artifact.expectedPath} (${artifact.reason})`)),
    '',
    '## Invalid Artifacts',
    ...(report.invalidArtifacts.length === 0 ? ['none'] : report.invalidArtifacts.map((artifact) => `- ${artifact.artifactType}: ${artifact.expectedPath} (${artifact.reason})`)),
    '',
    '## Suggested Retry',
    report.suggestedRetryCommand
  ].join('\n') + '\n';
}

function renderFailureMarkdown(report: CodexPreviewFailureReport): string {
  return [
    `# Codex Preview Failure Chapter ${report.chapterNumber}`,
    '',
    `errorCode: ${report.errorCode}`,
    `failedSubStage: ${report.failedSubStage ?? 'unknown'}`,
    `lastSuccessfulSubStage: ${report.lastSuccessfulSubStage ?? 'none'}`,
    `previewCompletenessReportPath: ${report.previewCompletenessReportPath}`,
    `storyStateMutated: ${String(report.storyStateMutated)}`,
    '',
    '## Suggested Retry',
    report.suggestedRetryCommand,
    '',
    '## Inspect Commands',
    ...report.suggestedInspectCommands.map((command) => `- ${command}`)
  ].join('\n') + '\n';
}

async function nextVersionedChapterArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string
): Promise<{ version: number; absolutePath: string; markdownPath: string; relativePath: string; relativeMarkdownPath: string }> {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFileName = `${baseName}_v${version}.json`;
    const absolutePath = paths.chapterArtifact(chapterNumber, jsonFileName);
    if (!(await fileStore.exists(absolutePath))) {
      const mdFileName = `${baseName}_v${version}.md`;
      return {
        version,
        absolutePath,
        markdownPath: paths.chapterArtifact(chapterNumber, mdFileName),
        relativePath: relativeChapterArtifact(chapterNumber, jsonFileName),
        relativeMarkdownPath: relativeChapterArtifact(chapterNumber, mdFileName)
      };
    }
  }
  throw new AppError('CHAPTER_ARTIFACT_VERSION_EXHAUSTED', `Could not allocate ${baseName} version for chapter ${chapterNumber}.`, 1, {
    chapterNumber,
    stage: 'commit'
  });
}

async function findLatestVersionedChapterArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string
): Promise<{ version: number; absolutePath: string; relativePath: string } | undefined> {
  if (!(await fileStore.exists(paths.chapterDir(chapterNumber)))) return undefined;
  const pattern = new RegExp(`^${escapeRegExp(baseName)}_v(\\d+)\\.json$`);
  let latest: { version: number; absolutePath: string; relativePath: string } | undefined;
  for (const entry of await fileStore.list(paths.chapterDir(chapterNumber))) {
    const match = pattern.exec(entry);
    if (match === null) continue;
    const version = Number.parseInt(match[1]!, 10);
    if (latest === undefined || version > latest.version) {
      latest = {
        version,
        absolutePath: paths.chapterArtifact(chapterNumber, entry),
        relativePath: relativeChapterArtifact(chapterNumber, entry)
      };
    }
  }
  return latest;
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.posix.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, fileName).split(path.sep).join(path.posix.sep);
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
