import path from 'node:path';

import { checkPatchConflicts, detectPatchConflictItems } from './chapterCommit.js';
import { evaluateCodexChapterQuality } from './codexChapterQuality.js';
import { sha256 } from './codexDiagnosticsEvidenceRules.js';
import { buildDiagnosticsContextManifest } from './codexDiagnosticsContextBuilder.js';
import { CodexPreviewSubStageTracker, writeCodexPreviewFailureReport } from './codexPreviewDiagnostics.js';
import { writePatchPreviewDiff } from './stateDiff.js';
import { ProviderFactory } from '../llm/ProviderFactory.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import { normalizeCodexSlimOutput } from '../providers/codex/normalizers.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import {
  CanonPatchSchema,
  ChapterQueueSchema,
  CodexCandidatePreviewReportSchema,
  CodexPreviewCompletenessReportSchema,
  ConflictReportSchema,
  DiagnosticsReportSchema,
  DraftAdoptionManifestSchema,
  DraftSelectionSchema,
  RevisionCandidateAdoptionApprovalSchema,
  StateDiffReportSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  CanonPatch,
  ChapterQueue,
  CodexCandidatePreviewReport,
  CodexErrorType,
  CodexPreviewArtifactCheck,
  CodexPreviewCompletenessReport,
  DiagnosticsReport,
  DraftAdoptionManifest,
  DraftSelection,
  RevisionCandidateAdoptionApproval,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface CodexCandidatePreviewInput {
  projectId: string;
  projectsRoot?: string;
  promptRoot?: string;
  chapterNumber: number;
  draft: string;
  approval?: string;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
  runId?: string;
}

export interface CodexCandidatePreviewResult {
  runId: string;
  reportPath: string;
  markdownPath: string;
  report: CodexCandidatePreviewReport;
}

interface CandidatePreviewSources {
  approvalPath: string;
  approvalText: string;
  approval: RevisionCandidateAdoptionApproval;
  manifestPath: string;
  manifest: DraftAdoptionManifest;
  selectionPath: string;
  selection: DraftSelection;
  candidateText: string;
  adoptedDraftText: string;
  originalDraftText: string;
  experimentText: string;
  storyStateText: string;
  storyState: StoryState;
  queueText: string;
  queue: ChapterQueue;
  queueStatus: string;
}

interface PatchArtifacts {
  proposalPath: string;
  normalizedPath: string;
  patch: CanonPatch;
}

interface CandidateCompletenessResult {
  reportPath: string;
  markdownPath: string;
  report: CodexPreviewCompletenessReport;
  absolutePath: string;
  absoluteMarkdownPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DRAFT_VERSION = 2;
const HARD_CHECK_KEYS = [
  'timeline_consistency',
  'character_knowledge_consistency',
  'world_rule_consistency',
  'no_unplanned_reveal'
] as const;

export async function runCodexCandidatePreview(
  input: CodexCandidatePreviewInput,
  fileStore = new FileStore()
): Promise<CodexCandidatePreviewResult> {
  if (input.draft !== 'draft_v2') {
    throw new AppError('CODEX_CANDIDATE_PREVIEW_STALE', 'D3 preview must use --draft draft_v2.', 2);
  }
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const sources = await loadAndValidateSources(paths, fileStore, input);
  await ensurePreviewArtifactsAbsent(paths, fileStore, input.chapterNumber);
  const runId = input.runId ?? `${createRunId()}_codex_candidate_preview_ch${pad(input.chapterNumber)}`;
  const runLogger = new RunLogger(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex.resume-preview-with-candidate',
    args: {
      chapterNumber: input.chapterNumber,
      provider: 'codex-text',
      draftVersion: DRAFT_VERSION,
      candidatePath: sources.manifest.candidatePath,
      candidateApprovalPath: sources.approvalPath,
      previewOnly: true,
      commitAllowed: false,
      queueMutationAllowed: false,
      storyStateMutationAllowed: false,
      snapshotAllowed: false,
      canonicalPatchAllowed: false,
      codexProfile: input.codexProfile ?? 'default'
    }
  });
  const tracker = new CodexPreviewSubStageTracker(runLogger, runId, input.chapterNumber);
  const generatedArtifacts: string[] = [];
  try {
    await tracker.start('draft_ready_check');
    await tracker.complete('draft_ready_check', [sources.selection.selectedDraftPath, sources.manifestPath, sources.approvalPath]);

    const context = await buildDiagnosticsContextManifest({
      projectId: paths.projectId,
      projectsRoot: paths.projectsRoot,
      chapterNumber: input.chapterNumber,
      mode: 'enhanced',
      draftPath: sources.selection.selectedDraftPath
    }, fileStore);
    await recordArtifacts(runLogger, runId, generatedArtifacts, [context.manifestPath, context.markdownPath], 'diagnostics', [sources.selection.selectedDraftPath]);

    await tracker.start('diagnostics');
    const diagnostics = await generateStandardDiagnostics(input, paths, fileStore, runLogger, runId, context.promptContext, sources.adoptedDraftText);
    await recordArtifacts(runLogger, runId, generatedArtifacts, [diagnostics.path], 'diagnostics', [sources.selection.selectedDraftPath, context.manifestPath]);
    const diagnosticsPassed = diagnostics.value.passed && HARD_CHECK_KEYS.every((key) => diagnostics.value.hard_checks[key].passed) && diagnostics.value.hardFailures.length === 0;
    if (!diagnosticsPassed) {
      await tracker.fail('diagnostics', 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL', 'Standard diagnostics on draft_v2 failed a blocking hard check.', [diagnostics.path]);
      const result = await finishIncompletePreview({
        input,
        paths,
        fileStore,
        runLogger,
        runId,
        tracker,
        sources,
        diagnosticsContextManifestPath: context.manifestPath,
        diagnosticsPath: diagnostics.path,
        errorCode: 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL',
        errorReason: `hardFailures=${HARD_CHECK_KEYS.filter((key) => !diagnostics.value.hard_checks[key].passed).join(', ') || 'unknown'}`,
        recommendedNextStep: 'diagnostics_review'
      });
      await runLogger.endRun(runId, 'human_review_required');
      return result;
    }
    await tracker.complete('diagnostics', [diagnostics.path]);

    await tracker.start('final_generation_or_assembly');
    const finalPath = relativeChapterArtifact(input.chapterNumber, 'final_candidate_preview_v2.md');
    await fileStore.writeText(paths.projectArtifact(finalPath), sources.adoptedDraftText);
    await recordArtifacts(runLogger, runId, generatedArtifacts, [finalPath], 'final', [sources.selection.selectedDraftPath]);
    await tracker.complete('final_generation_or_assembly', [finalPath]);

    await tracker.start('canon_patch_proposal');
    const patch = await generatePatchProposal(input, paths, fileStore, runId, sources.storyState, finalPath);
    await recordArtifacts(runLogger, runId, generatedArtifacts, [patch.proposalPath], 'canon_patch', [finalPath]);
    await tracker.complete('canon_patch_proposal', [patch.proposalPath]);
    await tracker.start('patch_normalization');
    await recordArtifacts(runLogger, runId, generatedArtifacts, [patch.normalizedPath], 'canon_patch', [patch.proposalPath]);
    await tracker.complete('patch_normalization', [patch.normalizedPath]);
    await tracker.start('schema_validation');
    CanonPatchSchema.parse(patch.patch);
    await tracker.complete('schema_validation', [patch.normalizedPath]);

    await tracker.start('conflict_check');
    const conflicts = checkPatchConflicts(sources.storyState, patch.patch);
    let conflictReportPath: string | null = null;
    if (conflicts.hard.length === 0) {
      await tracker.complete('conflict_check', [patch.normalizedPath]);
    } else {
      conflictReportPath = await writeConflictReport(paths, fileStore, input.chapterNumber, patch.patch, patch.normalizedPath);
      await recordArtifacts(runLogger, runId, generatedArtifacts, [conflictReportPath], 'conflict', [patch.normalizedPath]);
      await tracker.fail('conflict_check', 'CODEX_PREVIEW_CONFLICT_DETECTED', conflicts.hard.join('; '), [conflictReportPath]);
    }

    await tracker.start('state_diff_preview');
    const rawDiff = await writePatchPreviewDiff({
      projectId: paths.projectId,
      paths,
      patch: patch.patch,
      patchPath: patch.normalizedPath,
      unsafeToCommit: conflicts.hard.length > 0,
      baseStoryState: sources.storyState
    }, fileStore);
    const stateDiffPath = relativeChapterArtifact(input.chapterNumber, 'state_diff_codex_preview_v2.json');
    const stateDiffMarkdownPath = relativeChapterArtifact(input.chapterNumber, 'state_diff_codex_preview_v2.md');
    await fileStore.writeJson(paths.projectArtifact(stateDiffPath), rawDiff.report, StateDiffReportSchema);
    await fileStore.writeText(paths.projectArtifact(stateDiffMarkdownPath), await fileStore.readText(rawDiff.markdownPath));
    await recordArtifacts(runLogger, runId, generatedArtifacts, [rawDiff.relativeJsonPath, rawDiff.relativeMarkdownPath, stateDiffPath, stateDiffMarkdownPath], 'diff', [patch.normalizedPath]);
    await tracker.complete('state_diff_preview', [stateDiffPath, stateDiffMarkdownPath]);

    await tracker.start('quality_report');
    const quality = await evaluateCodexChapterQuality({
      projectId: paths.projectId,
      projectsRoot: paths.projectsRoot,
      chapterNumber: input.chapterNumber,
      runId,
      finalChapterPath: finalPath,
      canonPatchPath: patch.normalizedPath,
      diagnosticsPath: diagnostics.path,
      reportVersion: DRAFT_VERSION
    }, fileStore);
    generatedArtifacts.push(quality.reportPath, quality.markdownPath);
    const qualityPassed = !quality.blocking && quality.report.criticalIssues.length === 0;
    if (qualityPassed) {
      await tracker.complete('quality_report', [quality.reportPath, quality.markdownPath]);
    } else {
      await tracker.fail('quality_report', 'CODEX_PREVIEW_INCOMPLETE', quality.criticalIssues.join('; ') || 'candidate quality report blocked preview', [quality.reportPath]);
    }

    await tracker.start('completeness_check');
    const previewComplete = diagnosticsPassed && qualityPassed && conflicts.hard.length === 0;
    const errorCode: CodexErrorType | null = previewComplete ? null : conflicts.hard.length > 0 ? 'CODEX_PREVIEW_CONFLICT_DETECTED' : 'CODEX_PREVIEW_INCOMPLETE';
    const completeness = await writeCandidateCompleteness({
      paths,
      fileStore,
      chapterNumber: input.chapterNumber,
      runId,
      tracker,
      sources,
      complete: previewComplete,
      errorCode,
      diagnosticsPath: diagnostics.path,
      finalPath,
      qualityReportPath: quality.reportPath,
      proposalPath: patch.proposalPath,
      normalizedPath: patch.normalizedPath,
      stateDiffPath,
      conflictCheckPassed: conflicts.hard.length === 0
    });
    let failureReason: string | null = null;
    if (previewComplete) {
      await tracker.complete('completeness_check', [completeness.reportPath]);
    } else {
      failureReason = conflicts.hard.join('; ') || quality.criticalIssues.join('; ') || 'candidate preview incomplete';
      await tracker.fail('completeness_check', errorCode!, failureReason, [completeness.reportPath]);
      await attachFailureReport({ input, paths, fileStore, runLogger, runId, tracker, sources, completeness, errorCode: errorCode!, errorReason: failureReason });
    }
    await recordArtifacts(runLogger, runId, generatedArtifacts, [completeness.reportPath, completeness.markdownPath], 'commit', [diagnostics.path, finalPath, patch.normalizedPath, stateDiffPath]);

    const report = await writeCandidatePreviewReport({
      paths,
      fileStore,
      runId,
      chapterNumber: input.chapterNumber,
      sources,
      diagnosticsContextManifestPath: context.manifestPath,
      diagnosticsPath: diagnostics.path,
      finalPath,
      qualityReportPath: quality.reportPath,
      patchProposalPath: patch.proposalPath,
      normalizedPatchPath: patch.normalizedPath,
      conflictReportPath,
      stateDiffPath,
      completenessReportPath: completeness.reportPath,
      previewComplete,
      diagnosticsPassed,
      qualityPassed,
      patchSchemaValid: true,
      conflictCheckPassed: conflicts.hard.length === 0,
      stateDiffGenerated: true,
      failureCode: errorCode,
      failureReason,
      recommendedNextStep: previewComplete ? 'human_commit_review' : conflicts.hard.length > 0 ? 'patch_review' : 'human_review'
    });
    await recordArtifacts(runLogger, runId, generatedArtifacts, [report.reportPath, report.markdownPath], 'commit', [completeness.reportPath]);
    await assertProtectedUnchanged(paths, fileStore, input.chapterNumber, sources);
    await runLogger.recordEvent(runId, 'CODEX_CANDIDATE_PREVIEW_CREATED', {
      stage: 'commit',
      chapterNumber: input.chapterNumber,
      relatedArtifactPaths: [report.reportPath, completeness.reportPath, stateDiffPath],
      payload: { previewComplete, draftVersion: DRAFT_VERSION, previewOnly: true, storyStateMutated: false, queueCommitted: false }
    });
    await runLogger.endRun(runId, previewComplete ? 'completed' : 'human_review_required');
    return { runId, reportPath: report.reportPath, markdownPath: report.markdownPath, report: report.report };
  } catch (error) {
    await runLogger.recordError(runId, { code: error instanceof AppError ? error.code : 'CODEX_CANDIDATE_PREVIEW_FAILED', message: getErrorMessage(error), recoverable: true });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

async function generateStandardDiagnostics(
  input: CodexCandidatePreviewInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  runLogger: RunLogger,
  runId: string,
  promptContext: string,
  draftText: string
): Promise<{ path: string; value: DiagnosticsReport }> {
  const promptService = createPromptService(input, fileStore);
  const rendered = await promptService.renderPrompt('diagnostics.diagnose_chapter_slim', {
    CHAPTER_NUMBER: input.chapterNumber,
    DRAFT_VERSION,
    DRAFT_SUMMARY: summarizeText(draftText),
    DIAGNOSTICS_CONTEXT: promptContext
  });
  const response = await createProvider(input, paths, fileStore, runId).complete({
    promptId: 'diagnostics.diagnose_chapter_slim',
    system: 'Novel Loop Engine standard candidate diagnostics. Read only; do not edit files or lower hard checks.',
    user: `STANDARD_DIAGNOSTICS: true\nSELECTED_DRAFT_PATH: ${relativeChapterArtifact(input.chapterNumber, 'draft_v2.md')}\n\n${rendered}`,
    responseFormat: 'json'
  });
  await writePromptRunArtifacts(fileStore, paths, runId, 'diagnostics.diagnose_chapter_slim', rendered, response.text);
  const normalized = normalizeCodexSlimOutput('diagnostics.diagnose_chapter_slim', response.json, {
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber
  });
  const parsed = DiagnosticsReportSchema.parse(normalized);
  const artifactPath = relativeChapterArtifact(input.chapterNumber, 'diagnostics_v2.json');
  const passed = HARD_CHECK_KEYS.every((key) => parsed.hard_checks[key].passed) &&
    parsed.hardFailures.length === 0 &&
    parsed.missionSatisfaction.allRequiredSatisfied;
  const value = DiagnosticsReportSchema.parse({ ...parsed, draftVersion: DRAFT_VERSION, passed });
  if (value.normalizationWarnings !== undefined) {
    value.normalizationWarnings = value.normalizationWarnings.map((warning) => ({ ...warning, artifactPath }));
  }
  await fileStore.writeJson(paths.projectArtifact(artifactPath), value, DiagnosticsReportSchema);
  void runLogger;
  return { path: artifactPath, value };
}

async function generatePatchProposal(
  input: CodexCandidatePreviewInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  runId: string,
  storyState: StoryState,
  finalPath: string
): Promise<PatchArtifacts> {
  const finalText = await fileStore.readText(paths.projectArtifact(finalPath));
  const promptService = createPromptService(input, fileStore);
  const rendered = await promptService.renderPrompt('memory.extract_canon_patch_proposal_slim', {
    CHAPTER_NUMBER: input.chapterNumber,
    SOURCE_FINAL_PATH: finalPath,
    STORY_STATE_SUMMARY: JSON.stringify(summarizeStoryState(storyState)),
    FINAL_MARKDOWN: finalText
  });
  const response = await createProvider(input, paths, fileStore, runId).complete({
    promptId: 'memory.extract_canon_patch_proposal_slim',
    system: 'Novel Loop Engine candidate preview patch proposal. Read only; return a proposal and never edit Story State.',
    user: rendered,
    responseFormat: 'json'
  });
  await writePromptRunArtifacts(fileStore, paths, runId, 'memory.extract_canon_patch_proposal_slim', rendered, response.text);
  const normalized = normalizeCodexSlimOutput('memory.extract_canon_patch_proposal_slim', response.json, {
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber
  });
  const patch = CanonPatchSchema.parse(normalized);
  if (patch.sourceFinalPath !== finalPath) {
    throw new AppError('CANON_PATCH_SOURCE_MISMATCH', `Candidate patch sourceFinalPath must be ${finalPath}.`, 2);
  }
  const proposalPath = relativeChapterArtifact(input.chapterNumber, 'canon_patch_codex_proposal_v2.json');
  const normalizedPath = relativeChapterArtifact(input.chapterNumber, 'canon_patch_codex_normalized_v2.json');
  await fileStore.writeJson(paths.projectArtifact(proposalPath), patch, CanonPatchSchema);
  const written = await fileStore.writeJson(paths.projectArtifact(normalizedPath), patch, CanonPatchSchema);
  return { proposalPath, normalizedPath, patch: written };
}

async function loadAndValidateSources(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: CodexCandidatePreviewInput
): Promise<CandidatePreviewSources> {
  const approvalArtifact = await resolveVersionedArtifact(paths, fileStore, input.chapterNumber, 'revision_candidate_adoption_approval', input.approval ?? 'latest');
  const manifestArtifact = await requiredLatestArtifact(paths, fileStore, input.chapterNumber, 'draft_adoption_manifest');
  const selectionArtifact = await requiredLatestArtifact(paths, fileStore, input.chapterNumber, 'draft_selection');
  const [approvalText, manifest, selection] = await Promise.all([
    fileStore.readText(approvalArtifact.absolutePath),
    fileStore.readJson(manifestArtifact.absolutePath, DraftAdoptionManifestSchema),
    fileStore.readJson(selectionArtifact.absolutePath, DraftSelectionSchema)
  ]);
  const approval = RevisionCandidateAdoptionApprovalSchema.parse(JSON.parse(approvalText) as unknown);
  const [candidateText, adoptedDraftText, originalDraftText, experimentText, storyStateText, queueText, storyState, queue] = await Promise.all([
    fileStore.readText(paths.projectArtifact(manifest.candidatePath)),
    fileStore.readText(paths.projectArtifact(manifest.adoptedDraftPath)),
    fileStore.readText(paths.projectArtifact(manifest.originalDraftPath)),
    fileStore.readText(paths.projectArtifact(manifest.experimentPath)),
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue()),
    fileStore.readJson(paths.storyState(), StoryStateSchema),
    fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema)
  ]);
  const queueItem = queue.chapters.find((item) => item.chapterNumber === input.chapterNumber);
  const stale =
    manifest.approvalPath !== approvalArtifact.relativePath || manifest.approvalHash !== sha256(approvalText) ||
    manifest.candidateHash !== sha256(candidateText) || manifest.adoptedDraftHash !== sha256(adoptedDraftText) || candidateText !== adoptedDraftText ||
    manifest.originalDraftHash !== sha256(originalDraftText) || manifest.experimentHash !== sha256(experimentText) ||
    manifest.sourceStateHash !== sha256(storyStateText) || manifest.sourceQueueHash !== sha256(queueText) ||
    approval.candidateHash !== manifest.candidateHash || approval.sourceStateHash !== sha256(storyStateText) || approval.sourceQueueHash !== sha256(queueText) ||
    approval.sourceDraftHash !== sha256(originalDraftText) || selection.adoptionManifestPath !== manifestArtifact.relativePath ||
    selection.approvalPath !== approvalArtifact.relativePath || selection.selectedDraftPath !== manifest.adoptedDraftPath ||
    selection.selectedDraftHash !== manifest.adoptedDraftHash || selection.scope !== 'preview_only' || approval.approvalScope !== 'preview_only' ||
    storyState.latestCommittedChapter !== input.chapterNumber - 1 || queueItem === undefined || ['committed', 'recommitted'].includes(queueItem.status);
  if (stale) {
    throw new AppError('CODEX_CANDIDATE_PREVIEW_STALE', 'Candidate preview sources changed after adoption approval.', 2, { chapterNumber: input.chapterNumber });
  }
  return {
    approvalPath: approvalArtifact.relativePath,
    approvalText,
    approval,
    manifestPath: manifestArtifact.relativePath,
    manifest,
    selectionPath: selectionArtifact.relativePath,
    selection,
    candidateText,
    adoptedDraftText,
    originalDraftText,
    experimentText,
    storyStateText,
    storyState,
    queueText,
    queue,
    queueStatus: queueItem.status
  };
}

async function ensurePreviewArtifactsAbsent(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  const protectedNames = [
    'diagnostics_v2.json',
    'final_candidate_preview_v2.md',
    'canon_patch_codex_proposal_v2.json',
    'canon_patch_codex_normalized_v2.json',
    'state_diff_codex_preview_v2.json',
    'codex_preview_completeness_report_v2.json'
  ];
  for (const fileName of protectedNames) {
    if (await fileStore.exists(paths.chapterArtifact(chapterNumber, fileName))) {
      throw new AppError('CODEX_CANDIDATE_PREVIEW_STALE', `${fileName} already exists; D3 will not overwrite preview provenance.`, 2);
    }
  }
}

async function finishIncompletePreview(input: {
  input: CodexCandidatePreviewInput;
  paths: ProjectPaths;
  fileStore: FileStore;
  runLogger: RunLogger;
  runId: string;
  tracker: CodexPreviewSubStageTracker;
  sources: CandidatePreviewSources;
  diagnosticsContextManifestPath: string;
  diagnosticsPath: string;
  errorCode: CodexErrorType;
  errorReason: string;
  recommendedNextStep: CodexCandidatePreviewReport['recommendedNextStep'];
}): Promise<CodexCandidatePreviewResult> {
  const completeness = await writeCandidateCompleteness({
    paths: input.paths,
    fileStore: input.fileStore,
    chapterNumber: input.input.chapterNumber,
    runId: input.runId,
    tracker: input.tracker,
    sources: input.sources,
    complete: false,
    errorCode: input.errorCode,
    diagnosticsPath: input.diagnosticsPath,
    finalPath: null,
    qualityReportPath: null,
    proposalPath: null,
    normalizedPath: null,
    stateDiffPath: null,
    conflictCheckPassed: false
  });
  await attachFailureReport({
    input: input.input,
    paths: input.paths,
    fileStore: input.fileStore,
    runLogger: input.runLogger,
    runId: input.runId,
    tracker: input.tracker,
    sources: input.sources,
    completeness,
    errorCode: input.errorCode,
    errorReason: input.errorReason
  });
  await recordArtifacts(input.runLogger, input.runId, [], [completeness.reportPath, completeness.markdownPath], 'commit', [input.diagnosticsPath]);
  const report = await writeCandidatePreviewReport({
    paths: input.paths,
    fileStore: input.fileStore,
    runId: input.runId,
    chapterNumber: input.input.chapterNumber,
    sources: input.sources,
    diagnosticsContextManifestPath: input.diagnosticsContextManifestPath,
    diagnosticsPath: input.diagnosticsPath,
    finalPath: null,
    qualityReportPath: null,
    patchProposalPath: null,
    normalizedPatchPath: null,
    conflictReportPath: null,
    stateDiffPath: null,
    completenessReportPath: completeness.reportPath,
    previewComplete: false,
    diagnosticsPassed: false,
    qualityPassed: false,
    patchSchemaValid: false,
    conflictCheckPassed: false,
    stateDiffGenerated: false,
    failureCode: input.errorCode,
    failureReason: input.errorReason,
    recommendedNextStep: input.recommendedNextStep
  });
  await recordArtifacts(input.runLogger, input.runId, [], [report.reportPath, report.markdownPath], 'commit', [completeness.reportPath]);
  await assertProtectedUnchanged(input.paths, input.fileStore, input.input.chapterNumber, input.sources);
  return { runId: input.runId, reportPath: report.reportPath, markdownPath: report.markdownPath, report: report.report };
}

async function writeCandidateCompleteness(input: {
  paths: ProjectPaths;
  fileStore: FileStore;
  chapterNumber: number;
  runId: string;
  tracker: CodexPreviewSubStageTracker;
  sources: CandidatePreviewSources;
  complete: boolean;
  errorCode: CodexErrorType | null;
  diagnosticsPath: string;
  finalPath: string | null;
  qualityReportPath: string | null;
  proposalPath: string | null;
  normalizedPath: string | null;
  stateDiffPath: string | null;
  conflictCheckPassed: boolean;
}): Promise<CandidateCompletenessResult> {
  const invalidArtifacts: CodexPreviewArtifactCheck[] = input.errorCode === null ? [] : [{
    artifactType: input.errorCode === 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL' ? 'diagnostics' : 'candidate_preview',
    expectedPath: input.diagnosticsPath,
    exists: true,
    schemaValid: input.errorCode !== 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL',
    reason: input.errorCode,
    requiredForPreview: true,
    blocking: true
  }];
  const reportPath = relativeChapterArtifact(input.chapterNumber, 'codex_preview_completeness_report_v2.json');
  const markdownPath = relativeChapterArtifact(input.chapterNumber, 'codex_preview_completeness_report_v2.md');
  const report = await input.fileStore.writeJson(input.paths.projectArtifact(reportPath), {
    reportId: `codex_preview_completeness_ch${pad(input.chapterNumber)}_v2`,
    projectId: input.paths.projectId,
    chapterNumber: input.chapterNumber,
    generatedAt: new Date().toISOString(),
    provider: 'codex-text',
    previewRunId: input.runId,
    previewStage: 'candidate_preview_v2',
    complete: input.complete,
    missingArtifacts: [],
    invalidArtifacts,
    blockingReasons: input.errorCode === null ? [] : [input.errorCode],
    warnings: [],
    suggestedRetryCommand: `corepack pnpm novel-loop review ${input.paths.projectId} ${input.chapterNumber} --diagnostics --artifacts --state --suggest-next`,
    suggestedInspectCommands: [
      `corepack pnpm novel-loop review ${input.paths.projectId} ${input.chapterNumber} --diagnostics --artifacts --state`,
      `corepack pnpm novel-loop run ${input.paths.projectId} ${input.runId}`
    ],
    subStageTimeline: input.tracker.items(),
    queueStatusBefore: input.sources.queueStatus,
    queueStatusAfter: input.sources.queueStatus,
    latestCommittedChapterBefore: input.sources.storyState.latestCommittedChapter,
    latestCommittedChapterAfter: input.sources.storyState.latestCommittedChapter,
    storyStateMutated: false,
    previewStateHash: sha256(input.sources.storyStateText),
    previewStateHashRecorded: true,
    conflictCheckPassed: input.conflictCheckPassed,
    redacted: true
  }, CodexPreviewCompletenessReportSchema);
  await input.fileStore.writeText(input.paths.projectArtifact(markdownPath), renderCompleteness(report, input));
  return {
    reportPath,
    markdownPath,
    report,
    absolutePath: input.paths.projectArtifact(reportPath),
    absoluteMarkdownPath: input.paths.projectArtifact(markdownPath)
  };
}

async function attachFailureReport(input: {
  input: CodexCandidatePreviewInput;
  paths: ProjectPaths;
  fileStore: FileStore;
  runLogger: RunLogger;
  runId: string;
  tracker: CodexPreviewSubStageTracker;
  sources: CandidatePreviewSources;
  completeness: CandidateCompletenessResult;
  errorCode: CodexErrorType;
  errorReason: string;
}): Promise<void> {
  const failure = await writeCodexPreviewFailureReport({
    paths: input.paths,
    fileStore: input.fileStore,
    runLogger: input.runLogger,
    chapterNumber: input.input.chapterNumber,
    previewRunId: input.runId,
    previewStage: 'candidate_preview_v2',
    subStageTimeline: input.tracker.items(),
    latestCommittedChapterBefore: input.sources.storyState.latestCommittedChapter,
    latestCommittedChapterAfter: input.sources.storyState.latestCommittedChapter,
    storyStateHashBefore: sha256(input.sources.storyStateText),
    storyStateHashAfter: sha256(input.sources.storyStateText),
    completenessReportPath: input.completeness.reportPath,
    completenessReport: input.completeness.report,
    errorCode: input.errorCode,
    error: new AppError(input.errorCode, input.errorReason),
    failedSubStage: input.errorCode === 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL' ? 'diagnostics' : 'completeness_check'
  });
  const updated = CodexPreviewCompletenessReportSchema.parse({ ...input.completeness.report, failureReportPath: failure.reportPath });
  await input.fileStore.writeJson(input.completeness.absolutePath, updated, CodexPreviewCompletenessReportSchema);
  await input.fileStore.writeText(input.completeness.absoluteMarkdownPath, renderCompleteness(updated, {
    diagnosticsPath: relativeChapterArtifact(input.input.chapterNumber, 'diagnostics_v2.json'),
    finalPath: null,
    qualityReportPath: null,
    proposalPath: null,
    normalizedPath: null,
    stateDiffPath: null
  }));
  input.completeness.report = updated;
}

async function writeCandidatePreviewReport(input: {
  paths: ProjectPaths;
  fileStore: FileStore;
  runId: string;
  chapterNumber: number;
  sources: CandidatePreviewSources;
  diagnosticsContextManifestPath: string;
  diagnosticsPath: string;
  finalPath: string | null;
  qualityReportPath: string | null;
  patchProposalPath: string | null;
  normalizedPatchPath: string | null;
  conflictReportPath: string | null;
  stateDiffPath: string | null;
  completenessReportPath: string;
  previewComplete: boolean;
  diagnosticsPassed: boolean;
  qualityPassed: boolean;
  patchSchemaValid: boolean;
  conflictCheckPassed: boolean;
  stateDiffGenerated: boolean;
  failureCode: string | null;
  failureReason: string | null;
  recommendedNextStep: CodexCandidatePreviewReport['recommendedNextStep'];
}) {
  const artifact = await nextVersionedArtifact(input.paths, input.fileStore, input.chapterNumber, 'codex_candidate_preview_report');
  const currentState = await input.fileStore.readJson(input.paths.storyState(), StoryStateSchema);
  const currentQueue = await input.fileStore.readJson(input.paths.chapterQueue(), ChapterQueueSchema);
  const queueStatus = currentQueue.chapters.find((item) => item.chapterNumber === input.chapterNumber)?.status ?? 'missing';
  const report = await input.fileStore.writeJson(artifact.absolutePath, {
    reportId: `codex_candidate_preview_ch${pad(input.chapterNumber)}_v${artifact.version}`,
    projectId: input.paths.projectId,
    chapterNumber: input.chapterNumber,
    runId: input.runId,
    candidatePath: input.sources.manifest.candidatePath,
    candidateHash: input.sources.manifest.candidateHash,
    adoptedDraftPath: input.sources.manifest.adoptedDraftPath,
    adoptedDraftHash: input.sources.manifest.adoptedDraftHash,
    adoptionApprovalPath: input.sources.approvalPath,
    adoptionApprovalHash: sha256(input.sources.approvalText),
    draftAdoptionManifestPath: input.sources.manifestPath,
    draftSelectionPath: input.sources.selectionPath,
    experimentPath: input.sources.manifest.experimentPath,
    experimentHash: input.sources.manifest.experimentHash,
    diagnosticsContextManifestPath: input.diagnosticsContextManifestPath,
    diagnosticsPath: input.diagnosticsPath,
    finalPath: input.finalPath,
    qualityReportPath: input.qualityReportPath,
    patchProposalPath: input.patchProposalPath,
    normalizedPatchPath: input.normalizedPatchPath,
    conflictReportPath: input.conflictReportPath,
    stateDiffPath: input.stateDiffPath,
    completenessReportPath: input.completenessReportPath,
    previewComplete: input.previewComplete,
    diagnosticsPassed: input.diagnosticsPassed,
    standardDiagnosticsReexecuted: true,
    abDiagnosticsReused: false,
    qualityPassed: input.qualityPassed,
    patchSchemaValid: input.patchSchemaValid,
    conflictCheckPassed: input.conflictCheckPassed,
    stateDiffGenerated: input.stateDiffGenerated,
    sourceStateHash: input.sources.manifest.sourceStateHash,
    sourceQueueHash: input.sources.manifest.sourceQueueHash,
    latestCommittedChapterBefore: input.sources.storyState.latestCommittedChapter,
    latestCommittedChapterAfter: currentState.latestCommittedChapter,
    queueStatusBefore: input.sources.queueStatus,
    queueStatusAfter: queueStatus,
    storyStateMutated: false,
    queueCommitted: false,
    commitStarted: false,
    snapshotCreated: false,
    canonicalPatchGenerated: false,
    failureCode: input.failureCode,
    failureReason: input.failureReason,
    recommendedNextStep: input.recommendedNextStep,
    generatedAt: new Date().toISOString()
  }, CodexCandidatePreviewReportSchema);
  await input.fileStore.writeText(artifact.markdownPath, renderCandidatePreview(report));
  return { reportPath: artifact.relativePath, markdownPath: artifact.relativeMarkdownPath, report };
}

async function writeConflictReport(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, patch: CanonPatch, patchPath: string): Promise<string> {
  const artifact = await nextVersionedArtifact(paths, fileStore, chapterNumber, 'conflict_report');
  await fileStore.writeJson(artifact.absolutePath, {
    reportId: `candidate_preview_conflict_ch${pad(chapterNumber)}_v${artifact.version}`,
    projectId: paths.projectId,
    chapterNumber,
    sourcePatchPath: patchPath,
    generatedAt: new Date().toISOString(),
    conflicts: detectPatchConflictItems(await fileStore.readJson(paths.storyState(), StoryStateSchema), patch)
  }, ConflictReportSchema);
  return artifact.relativePath;
}

async function assertProtectedUnchanged(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, sources: CandidatePreviewSources): Promise<void> {
  const after = await Promise.all([
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue()),
    fileStore.readText(paths.chapterArtifact(chapterNumber, 'draft_v1.md')),
    fileStore.readText(paths.projectArtifact(sources.manifest.candidatePath))
  ]);
  if (after[0] !== sources.storyStateText || after[1] !== sources.queueText || after[2] !== sources.originalDraftText || after[3] !== sources.candidateText) {
    throw new AppError('CODEX_CANDIDATE_PREVIEW_STALE', 'Candidate preview changed a protected canonical source.', 1);
  }
}

function createProvider(input: CodexCandidatePreviewInput, paths: ProjectPaths, fileStore: FileStore, runId: string) {
  return ProviderFactory.create({
    provider: 'codex-text',
    projectsRoot: paths.projectsRoot,
    projectId: paths.projectId,
    ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
    ...(input.codexProfile === undefined ? {} : { codexProfile: input.codexProfile }),
    ...(input.codexJsonRetries === undefined ? {} : { codexJsonRetries: input.codexJsonRetries }),
    ...(input.codexJsonRepair === undefined ? {} : { codexJsonRepair: input.codexJsonRepair }),
    ...(input.codexJsonRepairRetries === undefined ? {} : { codexJsonRepairRetries: input.codexJsonRepairRetries }),
    ...(input.codexTimeoutMs === undefined ? {} : { codexTimeoutMs: input.codexTimeoutMs }),
    telemetry: { paths, runId, fileStore }
  });
}

function createPromptService(input: CodexCandidatePreviewInput, fileStore: FileStore): PromptService {
  return new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
}

async function recordArtifacts(
  runLogger: RunLogger,
  runId: string,
  bucket: string[],
  artifacts: string[],
  stage: string,
  derivedFrom: string[]
): Promise<void> {
  for (const artifact of artifacts) {
    if (!bucket.includes(artifact)) bucket.push(artifact);
    await runLogger.recordArtifact(runId, artifact, { action: 'generated', stage, derivedFrom, provenanceNote: 'candidate preview v2 isolated artifact' });
  }
}

async function resolveVersionedArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string,
  selector: string
) {
  if (selector !== 'latest') {
    const relativePath = selector.split(/[\\/]+/).join(path.sep);
    return { absolutePath: paths.projectArtifact(relativePath), relativePath };
  }
  return requiredLatestArtifact(paths, fileStore, chapterNumber, baseName);
}

async function requiredLatestArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  const artifacts = await listVersionedArtifacts(paths, fileStore, chapterNumber, baseName);
  const latest = artifacts.at(-1);
  if (latest === undefined) throw new AppError('CODEX_CANDIDATE_PREVIEW_STALE', `Missing ${baseName} artifact.`, 2);
  return latest;
}

async function nextVersionedArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  const artifacts = await listVersionedArtifacts(paths, fileStore, chapterNumber, baseName);
  const version = (artifacts.at(-1)?.version ?? 0) + 1;
  const fileName = `${baseName}_v${version}.json`;
  return {
    version,
    absolutePath: paths.chapterArtifact(chapterNumber, fileName),
    markdownPath: paths.chapterArtifact(chapterNumber, `${baseName}_v${version}.md`),
    relativePath: relativeChapterArtifact(chapterNumber, fileName),
    relativeMarkdownPath: relativeChapterArtifact(chapterNumber, `${baseName}_v${version}.md`)
  };
}

async function listVersionedArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  if (!(await fileStore.exists(paths.chapterDir(chapterNumber)))) return [];
  const pattern = new RegExp(`^${escapeRegExp(baseName)}_v(\\d+)\\.json$`);
  const artifacts = [];
  for (const entry of await fileStore.list(paths.chapterDir(chapterNumber))) {
    const match = pattern.exec(entry);
    if (match === null) continue;
    artifacts.push({
      version: Number.parseInt(match[1]!, 10),
      absolutePath: paths.chapterArtifact(chapterNumber, entry),
      relativePath: relativeChapterArtifact(chapterNumber, entry)
    });
  }
  return artifacts.sort((left, right) => left.version - right.version);
}

function renderCompleteness(report: CodexPreviewCompletenessReport, paths: {
  diagnosticsPath: string;
  finalPath: string | null;
  qualityReportPath: string | null;
  proposalPath: string | null;
  normalizedPath: string | null;
  stateDiffPath: string | null;
}): string {
  return [
    '# Codex Candidate Preview Completeness', '',
    `complete: ${String(report.complete)}`,
    `diagnostics: ${paths.diagnosticsPath}`,
    `final: ${paths.finalPath ?? 'none'}`,
    `quality: ${paths.qualityReportPath ?? 'none'}`,
    `patchProposal: ${paths.proposalPath ?? 'none'}`,
    `normalizedPatch: ${paths.normalizedPath ?? 'none'}`,
    `stateDiff: ${paths.stateDiffPath ?? 'none'}`,
    `blockingReasons: ${report.blockingReasons.join(', ') || 'none'}`,
    `storyStateMutated: ${String(report.storyStateMutated)}`
  ].join('\n') + '\n';
}

function renderCandidatePreview(report: CodexCandidatePreviewReport): string {
  return [
    '# Codex Candidate Preview Report', '',
    `candidate: ${report.candidatePath}`,
    `draft: ${report.adoptedDraftPath}`,
    `previewComplete: ${String(report.previewComplete)}`,
    `diagnosticsPassed: ${String(report.diagnosticsPassed)}`,
    `qualityPassed: ${String(report.qualityPassed)}`,
    `patchSchemaValid: ${String(report.patchSchemaValid)}`,
    `conflictCheckPassed: ${String(report.conflictCheckPassed)}`,
    `stateDiffGenerated: ${String(report.stateDiffGenerated)}`,
    `storyStateMutated: ${String(report.storyStateMutated)}`,
    `queueCommitted: ${String(report.queueCommitted)}`,
    `recommendedNextStep: ${report.recommendedNextStep}`
  ].join('\n') + '\n';
}

function summarizeStoryState(storyState: StoryState) {
  return {
    latestCommittedChapter: storyState.latestCommittedChapter,
    canonFacts: storyState.canonFacts.slice(-8),
    timeline: storyState.timeline.slice(-8),
    openNarrativeDebts: storyState.narrativeDebts.filter((item) => item.status !== 'resolved'),
    readerState: storyState.readerState
  };
}

function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized;
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.posix.join('chapters', `chapter_${pad(chapterNumber)}`, fileName);
}

function pad(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
