import path from 'node:path';

import { ChapterQueueStore } from './chapterQueue.js';
import { generateChapterContextSummary } from './chapterContextSummary.js';
import { evaluateCodexChapterQuality } from './codexChapterQuality.js';
import {
  CodexPreviewSubStageTracker,
  classifyCodexPreviewCompleteness,
  writeCodexPreviewCompletenessReport,
  writeCodexPreviewFailureReport
} from './codexPreviewDiagnostics.js';
import { assembleFinalLocally } from './finalAssembly.js';
import { recordCommitJournalPhase, startCommitJournal } from './commitJournal.js';
import type { CommitJournalHandle } from './commitJournal.js';
import { applyCanonPatchToStoryState, checkPatchConflicts, detectPatchConflictItems } from './chapterCommit.js';
import { qualityGate } from './chapterRevisionLoop.js';
import { writePatchPreviewDiff } from './stateDiff.js';
import { ProviderFactory } from '../llm/ProviderFactory.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { hashJson, RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import { normalizeCodexSlimOutput } from '../providers/codex/normalizers.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import {
  ApprovalRecordSchema,
  CanonPatchSchema,
  CodexCommitConsistencyReportSchema,
  CodexCommitReportSchema,
  CodexJsonFailureReportSchema,
  CodexPatchFailureReportSchema,
  CommitReportSchema,
  ConfigSchema,
  ConflictReportSchema,
  DiagnosticsReportSchema,
  RevisionPlanSchema,
  StateDiffReportSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  ApprovalRecord,
  CanonPatch,
  ChapterQueueStage,
  CodexCommitConsistencyReport,
  CodexCommitReport,
  CodexErrorType,
  CodexPreviewSubStageName,
  CommitReport,
  ConflictReport,
  DiagnosticsReport,
  RevisionPlan,
  StateDiffReport,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { SnapshotStore } from '../storage/SnapshotStore.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface CodexControlledCommitInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  promptRoot?: string;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
  maxRevisions?: number;
  commit?: boolean;
  confirmCodexCommit?: boolean;
  rerunCodexOnConfirm?: boolean;
  codexFinalMode?: 'codex' | 'local-assemble' | 'light-polish';
  runId?: string;
  regenerateStale?: boolean;
}

export interface CodexControlledCommitResult {
  projectId: string;
  chapterNumber: number;
  runId: string;
  status: 'codex_commit_preview' | 'committed' | 'needs_human_review';
  previewOnly: boolean;
  artifacts: string[];
  generatedArtifacts: string[];
  reusedArtifacts: string[];
  finalDraftVersion: number;
  previousStatus?: string;
  newStatus?: string;
  currentStage?: ChapterQueueStage;
  commitStatus: 'preview' | 'committed' | 'needs_human_review';
  codexPatchPath?: string;
  stateDiffPath?: string;
  stateDiffMarkdownPath?: string;
  approvalRecordPath?: string;
  commitReportPath?: string;
  codexCommitReportPath?: string;
  conflictReportPath?: string;
  beforeSnapshotId?: string;
  afterSnapshotId?: string;
  suggestedNextCommand?: string;
  reusedPreviewArtifacts?: boolean;
  reusedPatchPath?: string;
  reusedStateDiffPath?: string;
  normalizedPatchPath?: string;
  consistencyReportPath?: string;
  qualityReportPath?: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const HARD_CHECK_KEYS = [
  'timeline_consistency',
  'character_knowledge_consistency',
  'world_rule_consistency',
  'no_unplanned_reveal'
] as const;

interface PatchResult {
  artifact: string;
  normalizedArtifact?: string;
  value: CanonPatch;
}

interface DiffReference {
  relativeJsonPath: string;
  relativeMarkdownPath?: string;
  report?: StateDiffReport;
}

interface ReusablePreviewArtifacts {
  diagnostics: { artifact: string; value: DiagnosticsReport };
  revisionPlan: { artifact: string; value: RevisionPlan };
  finalArtifact: string;
  patchResult: PatchResult;
  diff: DiffReference;
  consistencyReportPath: string;
  consistencyReport: CodexCommitConsistencyReport;
}

export async function runCodexControlledCommit(input: CodexControlledCommitInput, fileStore = new FileStore()): Promise<CodexControlledCommitResult> {
  if (input.regenerateStale === true) {
    throw new AppError('CODEX_TEXT_STALE_REGEN_COMMIT_BLOCKED', 'codex-text controlled commit cannot regenerate stale chapters in M24.', 2, {
      chapterNumber: input.chapterNumber,
      stage: 'commit',
      reason: 'M24 only allows normal next uncommitted chapter controlled commits.',
      suggestedNextCommand: `corepack pnpm novel-loop chapter ${input.projectId} next --provider mock --regenerate-stale --commit`
    });
  }

  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const runId = input.runId ?? createRunId();
  const runLogger = new RunLogger(paths, fileStore);
  const queueStore = new ChapterQueueStore(paths, fileStore);
  const artifacts: string[] = [];
  const generatedArtifacts: string[] = [];
  const reusedArtifacts: string[] = [];
  let activeStage: ChapterQueueStage = 'diagnostics';
  let activePreviewSubStage: CodexPreviewSubStageName = 'draft_ready_check';
  let commitJournal: CommitJournalHandle | undefined;
  let previewTracker: CodexPreviewSubStageTracker | undefined;
  let previewFailureArtifactsWritten = false;

  await ensureCodexPrerequisites(paths, fileStore, input.chapterNumber);
  const storyStateBefore = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  if (input.chapterNumber !== storyStateBefore.latestCommittedChapter + 1) {
    throw new AppError('CODEX_TEXT_CONTROLLED_COMMIT_SCOPE_BLOCKED', 'codex-text controlled commit is only allowed for the normal next uncommitted chapter.', 2, {
      chapterNumber: input.chapterNumber,
      stage: 'commit',
      reason: `historical recommit and out-of-order commit remain blocked for codex-text; latestCommittedChapter=${storyStateBefore.latestCommittedChapter}.`
    });
  }

  const previousQueueItem = await queueStore.getRequiredChapter(input.chapterNumber);
  if (previousQueueItem.status === 'committed' || previousQueueItem.status === 'recommitted') {
    throw new AppError('CHAPTER_ALREADY_COMMITTED', `Chapter ${input.chapterNumber} is already committed.`, 2, {
      chapterNumber: input.chapterNumber,
      stage: 'commit'
    });
  }

  await runLogger.startRun({
    runId,
    command: 'chapter',
    args: {
      chapterNumber: input.chapterNumber,
      provider: 'codex-text',
      commit: true,
      confirmCodexCommit: input.confirmCodexCommit === true,
      rerunCodexOnConfirm: input.rerunCodexOnConfirm === true,
      codexFinalMode: input.codexFinalMode ?? 'codex',
      codexProfile: input.codexProfile ?? 'default'
    }
  });
  previewTracker = new CodexPreviewSubStageTracker(runLogger, runId, input.chapterNumber);

  try {
    await previewTracker.start('draft_ready_check');
    await previewTracker.complete('draft_ready_check', [
      relativeChapterArtifact(input.chapterNumber, 'mission.json'),
      relativeChapterArtifact(input.chapterNumber, 'draft_v1.md')
    ]);
    const config = await fileStore.readJson(paths.config(), ConfigSchema);
    const reusablePreview =
      input.confirmCodexCommit === true && input.rerunCodexOnConfirm !== true
        ? await readReusablePreviewArtifacts(paths, fileStore, input.chapterNumber, storyStateBefore)
        : undefined;
    const reusedPreviewArtifacts = reusablePreview !== undefined;

    activePreviewSubStage = 'diagnostics';
    await previewTracker.start('diagnostics');
    const diagnostics = reusablePreview?.diagnostics ?? (await generateCodexDiagnostics(input, paths, fileStore, runId));
    recordArtifact(artifacts, diagnostics.artifact, reusedPreviewArtifacts ? reusedArtifacts : generatedArtifacts);
    await runLogger.recordArtifact(runId, diagnostics.artifact, reusedPreviewArtifacts ? 'reused' : 'generated');
    await queueStore.markStageComplete(input.chapterNumber, 'diagnosing', 'diagnostics', runId);

    const gate = qualityGate(diagnostics.value, config.qualityThreshold);
    if (!gate.passed) {
      await previewTracker.fail('diagnostics', 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL', `Diagnostics quality gate failed: ${gate.failedHardChecks.join(', ') || 'soft scores'}`, [diagnostics.artifact]);
      const failed = await queueStore.markNeedsHumanReview(input.chapterNumber, 'diagnostics', runId);
      await runLogger.recordStateMutation(runId, {
        mutationType: 'codex_controlled_commit',
        chapterNumber: input.chapterNumber,
        latestCommittedChapterBefore: storyStateBefore.latestCommittedChapter,
        latestCommittedChapterAfter: storyStateBefore.latestCommittedChapter,
        conflictCheckPassed: false,
        schemaValidationPassed: true,
        applied: false,
        blockedReason: `Diagnostics quality gate failed: ${gate.failedHardChecks.join(', ') || 'soft scores'}`
      });
      const previewFailure = await writePreviewFailureArtifacts({
        paths,
        fileStore,
        runLogger,
        input,
        runId,
        previewTracker,
        storyStateBefore,
        errorCode: 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL',
        failedSubStage: 'diagnostics',
        lastSuccessfulSubStage: 'draft_ready_check',
        error: new AppError('CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL', `Diagnostics quality gate failed: ${gate.failedHardChecks.join(', ') || 'soft scores'}`)
      });
      previewFailureArtifactsWritten = true;
      for (const artifact of previewFailure.artifacts) {
        recordArtifact(artifacts, artifact, generatedArtifacts);
        await runLogger.recordArtifact(runId, artifact, {
          action: 'generated',
          stage: 'commit',
          provenanceNote: 'codex-text controlled preview failure diagnostics'
        });
      }
      await runLogger.endRun(runId, 'human_review_required');
      return {
        projectId: paths.projectId,
        chapterNumber: input.chapterNumber,
        runId,
        status: 'needs_human_review',
        previewOnly: false,
        artifacts,
        generatedArtifacts,
        reusedArtifacts,
        finalDraftVersion: 1,
        previousStatus: previousQueueItem.status,
        newStatus: failed.status,
        currentStage: failed.currentStage,
        commitStatus: 'needs_human_review'
      };
    }
    await previewTracker.complete('diagnostics', [diagnostics.artifact]);

    activeStage = 'revision';
    activePreviewSubStage = 'revision_plan';
    await previewTracker.start('revision_plan');
    const revisionPlan = reusablePreview?.revisionPlan ?? (await generateCodexRevisionPlan(input, paths, fileStore, runId, diagnostics.value));
    recordArtifact(artifacts, revisionPlan.artifact, reusedPreviewArtifacts ? reusedArtifacts : generatedArtifacts);
    await runLogger.recordArtifact(runId, revisionPlan.artifact, reusedPreviewArtifacts ? 'reused' : 'generated');
    await previewTracker.complete('revision_plan', [revisionPlan.artifact]);

    activeStage = 'final';
    activePreviewSubStage = 'final_generation_or_assembly';
    await previewTracker.start('final_generation_or_assembly');
    const final =
      reusablePreview === undefined
        ? await generateFinal(input, paths, fileStore, runId, revisionPlan.value)
        : { artifact: reusablePreview.finalArtifact };
    recordArtifact(artifacts, final.artifact, reusedPreviewArtifacts ? reusedArtifacts : generatedArtifacts);
    await runLogger.recordArtifact(runId, final.artifact, reusedPreviewArtifacts ? 'reused' : 'generated');
    if (hasFinalAssemblyReport(final)) {
      recordArtifact(artifacts, final.reportPath, generatedArtifacts);
      recordArtifact(artifacts, final.markdownPath, generatedArtifacts);
      await runLogger.recordArtifact(runId, final.reportPath, {
        action: 'generated',
        stage: 'final',
        derivedFrom: final.sourceScenePaths,
        provenanceNote: 'local deterministic final chapter assembly report'
      });
      await runLogger.recordArtifact(runId, final.markdownPath, {
        action: 'generated',
        stage: 'final',
        derivedFrom: [final.reportPath],
        provenanceNote: 'local deterministic final chapter assembly markdown report'
      });
    }
    await queueStore.markStageComplete(input.chapterNumber, 'final_ready', 'final', runId);
    await previewTracker.complete('final_generation_or_assembly', [final.artifact]);

    activeStage = 'canon_patch';
    activePreviewSubStage = 'canon_patch_proposal';
    await previewTracker.start('canon_patch_proposal');
    const patchResult = reusablePreview?.patchResult ?? (await generateCodexCanonPatchProposal(input, paths, fileStore, runId, storyStateBefore));
    recordArtifact(artifacts, patchResult.artifact, reusedPreviewArtifacts ? reusedArtifacts : generatedArtifacts);
    await runLogger.recordArtifact(runId, patchResult.artifact, reusedPreviewArtifacts ? 'reused' : 'generated');
    await previewTracker.complete('canon_patch_proposal', [patchResult.artifact]);
    if (patchResult.normalizedArtifact !== undefined) {
      activePreviewSubStage = 'patch_normalization';
      await previewTracker.start('patch_normalization');
      recordArtifact(artifacts, patchResult.normalizedArtifact, reusedPreviewArtifacts ? reusedArtifacts : generatedArtifacts);
      await runLogger.recordArtifact(runId, patchResult.normalizedArtifact, reusedPreviewArtifacts ? 'reused' : 'generated');
      await previewTracker.complete('patch_normalization', [patchResult.normalizedArtifact]);
    }

    activePreviewSubStage = 'schema_validation';
    await previewTracker.start('schema_validation');
    await previewTracker.complete('schema_validation', [patchResult.normalizedArtifact ?? patchResult.artifact]);

    activePreviewSubStage = 'conflict_check';
    await previewTracker.start('conflict_check');
    const conflicts = checkPatchConflicts(storyStateBefore, patchResult.value);
    if (conflicts.hard.length === 0) {
      await previewTracker.complete('conflict_check', [patchResult.normalizedArtifact ?? patchResult.artifact]);
    }
    activePreviewSubStage = 'state_diff_preview';
    await previewTracker.start('state_diff_preview');
    const diff =
      reusablePreview?.diff ??
      (await writePatchPreviewDiff(
        {
          projectId: paths.projectId,
          paths,
          patch: patchResult.value,
          patchPath: patchResult.artifact,
          unsafeToCommit: conflicts.hard.length > 0
        },
        fileStore
      ));
    recordArtifact(artifacts, diff.relativeJsonPath, reusedPreviewArtifacts ? reusedArtifacts : generatedArtifacts);
    if (diff.relativeMarkdownPath !== undefined) {
      recordArtifact(artifacts, diff.relativeMarkdownPath, reusedPreviewArtifacts ? reusedArtifacts : generatedArtifacts);
    }
    await runLogger.recordArtifact(runId, diff.relativeJsonPath, reusedPreviewArtifacts ? 'reused' : 'generated');
    if (diff.relativeMarkdownPath !== undefined) {
      await runLogger.recordArtifact(runId, diff.relativeMarkdownPath, reusedPreviewArtifacts ? 'reused' : 'generated');
    }
    await queueStore.markStageComplete(input.chapterNumber, 'patch_extracted', 'canon_patch', runId);
    await previewTracker.complete('state_diff_preview', [diff.relativeJsonPath, ...(diff.relativeMarkdownPath === undefined ? [] : [diff.relativeMarkdownPath])]);

    const consistencyReportPath =
      reusablePreview?.consistencyReportPath ??
      (await writeCodexCommitConsistencyReport(paths, fileStore, input.chapterNumber, {
        previewPatchPath: patchResult.artifact,
        ...(patchResult.normalizedArtifact === undefined ? {} : { previewNormalizedPatchPath: patchResult.normalizedArtifact }),
        previewStateDiffPath: diff.relativeJsonPath,
        ...(diff.relativeMarkdownPath === undefined ? {} : { previewStateDiffMarkdownPath: diff.relativeMarkdownPath }),
        previewStoryStateHash: hashJson(storyStateBefore)
      }));
    if (!artifacts.includes(consistencyReportPath) && !(input.confirmCodexCommit === true && reusedPreviewArtifacts)) {
      recordArtifact(artifacts, consistencyReportPath, reusedPreviewArtifacts ? reusedArtifacts : generatedArtifacts);
      await runLogger.recordArtifact(runId, consistencyReportPath, reusedPreviewArtifacts ? 'reused' : 'generated');
    }

    if (conflicts.hard.length > 0) {
      await previewTracker.fail('conflict_check', 'CODEX_PREVIEW_CONFLICT_DETECTED', `Codex patch proposal conflict: ${conflicts.hard.join('; ')}`, [patchResult.artifact]);
      const conflictReport = await writeCodexConflictReport(paths, fileStore, input.chapterNumber, storyStateBefore, patchResult.value, patchResult.artifact);
      recordArtifact(artifacts, conflictReport.path, generatedArtifacts);
      await runLogger.recordArtifact(runId, conflictReport.path, 'generated');
      await queueStore.markBlocked(input.chapterNumber, 'commit', runId, `Codex patch proposal conflict: ${conflicts.hard.join('; ')}`);
      await runLogger.recordStateMutation(runId, {
        mutationType: 'codex_controlled_commit',
        chapterNumber: input.chapterNumber,
        patchPath: patchResult.artifact,
        latestCommittedChapterBefore: storyStateBefore.latestCommittedChapter,
        latestCommittedChapterAfter: storyStateBefore.latestCommittedChapter,
        conflictCheckPassed: false,
        schemaValidationPassed: true,
        applied: false,
        stateDiffPath: diff.relativeJsonPath,
        blockedReason: conflicts.hard.join('; ')
      });
      const previewFailure = await writePreviewFailureArtifacts({
        paths,
        fileStore,
        runLogger,
        input,
        runId,
        previewTracker,
        storyStateBefore,
        errorCode: 'CODEX_PREVIEW_CONFLICT_DETECTED',
        failedSubStage: 'conflict_check',
        lastSuccessfulSubStage: 'schema_validation',
        error: new AppError('CODEX_PREVIEW_CONFLICT_DETECTED', conflicts.hard.join('; '))
      });
      previewFailureArtifactsWritten = true;
      for (const artifact of previewFailure.artifacts) {
        recordArtifact(artifacts, artifact, generatedArtifacts);
        await runLogger.recordArtifact(runId, artifact, {
          action: 'generated',
          stage: 'commit',
          provenanceNote: 'codex-text controlled preview conflict diagnostics'
        });
      }
      await runLogger.endRun(runId, 'blocked');
      throw new AppError('CANON_PATCH_CONFLICT', `Codex patch proposal has ${conflicts.hard.length} blocking conflict(s).`, 2, {
        chapterNumber: input.chapterNumber,
        stage: 'commit',
        conflictReportPath: conflictReport.path,
        reason: `codex patch proposal failed local conflict checks; stateDiffPath=${diff.relativeJsonPath}`
      });
    }

    activePreviewSubStage = 'quality_report';
    await previewTracker.start('quality_report');
    const quality = await evaluateCodexChapterQuality(
      {
        projectId: paths.projectId,
        projectsRoot: paths.projectsRoot,
        chapterNumber: input.chapterNumber,
        runId,
        finalChapterPath: final.artifact,
        canonPatchPath: patchResult.normalizedArtifact ?? patchResult.artifact,
        diagnosticsPath: diagnostics.artifact
      },
      fileStore
    );
    recordArtifact(artifacts, quality.reportPath, generatedArtifacts);
    recordArtifact(artifacts, quality.markdownPath, generatedArtifacts);
    await previewTracker.complete('quality_report', [quality.reportPath, quality.markdownPath]);
    if (quality.blocking) {
      await previewTracker.fail('quality_report', 'CODEX_PREVIEW_INCOMPLETE', `Codex chapter quality blocked commit: ${quality.criticalIssues.join('; ')}`, [quality.reportPath]);
      await queueStore.markFailed(input.chapterNumber, 'commit', runId, new AppError('CODEX_CHAPTER_QUALITY_BLOCKED', quality.criticalIssues.join('; '), 2));
      await runLogger.recordStateMutation(runId, {
        mutationType: 'codex_controlled_commit',
        chapterNumber: input.chapterNumber,
        patchPath: patchResult.artifact,
        latestCommittedChapterBefore: storyStateBefore.latestCommittedChapter,
        latestCommittedChapterAfter: storyStateBefore.latestCommittedChapter,
        conflictCheckPassed: true,
        schemaValidationPassed: true,
        applied: false,
        stateDiffPath: diff.relativeJsonPath,
        blockedReason: `Codex chapter quality blocked commit: ${quality.criticalIssues.join('; ')}`
      });
      await runLogger.endRun(runId, 'failed');
      throw new AppError('CODEX_CHAPTER_QUALITY_BLOCKED', quality.criticalIssues.join('; '), 2, {
        chapterNumber: input.chapterNumber,
        stage: 'commit',
        reason: `qualityReportPath=${quality.reportPath}`
      });
    }

    if (input.confirmCodexCommit !== true) {
      activePreviewSubStage = 'completeness_check';
      await previewTracker.start('completeness_check');
      await previewTracker.complete('completeness_check');
      const stateAfterPreview = await fileStore.readJson(paths.storyState(), StoryStateSchema);
      const completeness = await writeCodexPreviewCompletenessReport({
        paths,
        fileStore,
        runLogger,
        chapterNumber: input.chapterNumber,
        previewRunId: runId,
        previewStage: 'controlled_commit_preview',
        subStageTimeline: previewTracker.items(),
        latestCommittedChapterBefore: storyStateBefore.latestCommittedChapter,
        latestCommittedChapterAfter: stateAfterPreview.latestCommittedChapter,
        storyStateHashBefore: hashJson(storyStateBefore),
        storyStateHashAfter: hashJson(stateAfterPreview)
      });
      for (const artifact of [completeness.reportPath, completeness.markdownPath]) {
        recordArtifact(artifacts, artifact, generatedArtifacts);
        await runLogger.recordArtifact(runId, artifact, {
          action: 'generated',
          stage: 'commit',
          provenanceNote: 'codex-text controlled preview completeness report'
        });
      }
      await runLogger.recordStateMutation(runId, {
        mutationType: 'codex_controlled_commit',
        chapterNumber: input.chapterNumber,
        patchPath: patchResult.artifact,
        latestCommittedChapterBefore: storyStateBefore.latestCommittedChapter,
        latestCommittedChapterAfter: storyStateBefore.latestCommittedChapter,
        conflictCheckPassed: true,
        schemaValidationPassed: true,
        applied: false,
        stateDiffPath: diff.relativeJsonPath,
        blockedReason: 'preview only; --confirm-codex-commit not provided'
      });
      await runLogger.recordEvent(runId, 'CODEX_COMMIT_PREVIEW_CREATED', {
        stage: 'commit',
        chapterNumber: input.chapterNumber,
        relatedArtifactPaths: [patchResult.artifact, diff.relativeJsonPath],
        payload: {
          previewOnly: true,
          oldLatestCommittedChapter: storyStateBefore.latestCommittedChapter,
          proposedNewLatestCommittedChapter: input.chapterNumber,
          stateDiffPath: diff.relativeJsonPath,
          canonPatchPath: patchResult.artifact
        }
      });
      await runLogger.endRun(runId, 'completed');
      const queueItem = await queueStore.getRequiredChapter(input.chapterNumber);
      return {
        projectId: paths.projectId,
        chapterNumber: input.chapterNumber,
        runId,
        status: 'codex_commit_preview',
        previewOnly: true,
        artifacts,
        generatedArtifacts,
        reusedArtifacts,
        finalDraftVersion: 1,
        previousStatus: previousQueueItem.status,
        newStatus: queueItem.status,
        currentStage: queueItem.currentStage,
        commitStatus: 'preview',
        codexPatchPath: patchResult.artifact,
        ...(patchResult.normalizedArtifact === undefined ? {} : { normalizedPatchPath: patchResult.normalizedArtifact }),
        stateDiffPath: diff.relativeJsonPath,
        ...(diff.relativeMarkdownPath === undefined ? {} : { stateDiffMarkdownPath: diff.relativeMarkdownPath }),
        consistencyReportPath,
        qualityReportPath: quality.reportPath,
        reusedPreviewArtifacts: false,
        suggestedNextCommand: `corepack pnpm novel-loop chapter ${paths.projectId} ${input.chapterNumber} --provider codex-text --max-revisions ${input.maxRevisions ?? 2} --commit --confirm-codex-commit`
      };
    }

    activeStage = 'commit';
    await queueStore.markStageStart(input.chapterNumber, 'committing', 'commit', runId);
    commitJournal = await startCommitJournal({
      paths,
      fileStore,
      chapterNumber: input.chapterNumber,
      commitKind: 'codex_controlled_commit',
      provider: 'codex-text',
      runId,
      canonPatchPath: patchResult.artifact,
      latestCommittedChapterBefore: storyStateBefore.latestCommittedChapter,
      latestCommittedChapterAfter: patchResult.value.latestCommittedChapter ?? patchResult.value.chapterNumber
    });
    recordArtifact(artifacts, commitJournal.relativePath, generatedArtifacts);

    const approvalRecord = await writeCodexApprovalRecord(paths, fileStore, input.chapterNumber, patchResult.artifact, diff.relativeJsonPath);
    recordArtifact(artifacts, approvalRecord.path, generatedArtifacts);
    await runLogger.recordArtifact(runId, approvalRecord.path, 'generated');
    await runLogger.recordEvent(runId, 'CODEX_COMMIT_APPROVAL_RECORDED', {
      stage: 'commit',
      chapterNumber: input.chapterNumber,
      relatedArtifactPaths: [approvalRecord.path, patchResult.artifact, diff.relativeJsonPath],
        payload: approvalRecord.record
      });
    await recordCommitJournalPhase(commitJournal, fileStore, 'approval_recorded');

    const canonicalPatchPath = relativeChapterArtifact(input.chapterNumber, 'canon_patch.json');
    await fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, 'canon_patch.json'), patchResult.value, CanonPatchSchema);
    recordArtifact(artifacts, canonicalPatchPath, generatedArtifacts);
    await runLogger.recordArtifact(runId, canonicalPatchPath, {
      action: 'generated',
      derivedFrom: [patchResult.artifact],
      stage: 'commit',
      provenanceNote: 'accepted local copy of codex patch proposal'
    });
    await recordCommitJournalPhase(commitJournal, fileStore, 'canonical_patch_written', {
      canonPatchPath: canonicalPatchPath
    });

    const snapshotStore = new SnapshotStore(paths, fileStore);
    const beforeSnapshot = await snapshotStore.createSnapshot(storyStateBefore, {
      reason: `before_chapter_${formatChapterNumber(input.chapterNumber)}_codex_controlled_commit`,
      sourceChapter: input.chapterNumber,
      runId
    });
    await runLogger.recordSnapshot(runId, beforeSnapshot, storyStateBefore);
    recordArtifact(artifacts, relativeSnapshotArtifact(beforeSnapshot.path), generatedArtifacts);
    await recordCommitJournalPhase(commitJournal, fileStore, 'before_snapshot_created', {
      beforeSnapshotId: beforeSnapshot.snapshotId
    });

    const applied = applyCanonPatchToStoryState(storyStateBefore, patchResult.value);
    await fileStore.writeJson(paths.storyState(), applied.storyState, StoryStateSchema);
    recordArtifact(artifacts, path.join('state', 'story_state.json'), generatedArtifacts);
    await runLogger.recordArtifact(runId, path.join('state', 'story_state.json'), {
      action: 'generated',
      derivedFrom: [patchResult.artifact],
      stage: 'commit',
      provenanceNote: 'Story State updated by local controlled commit apply'
    });
    await recordCommitJournalPhase(commitJournal, fileStore, 'story_state_written', {
      stateWriteCompleted: true,
      latestCommittedChapterAfter: applied.storyState.latestCommittedChapter
    });

    const afterSnapshot = await snapshotStore.createSnapshot(applied.storyState, {
      reason: `after_chapter_${formatChapterNumber(input.chapterNumber)}_codex_controlled_commit`,
      sourceChapter: input.chapterNumber,
      runId
    });
    await runLogger.recordSnapshot(runId, afterSnapshot, applied.storyState);
    recordArtifact(artifacts, relativeSnapshotArtifact(afterSnapshot.path), generatedArtifacts);
    await recordCommitJournalPhase(commitJournal, fileStore, 'after_snapshot_created', {
      afterSnapshotId: afterSnapshot.snapshotId
    });

    await runLogger.recordStateMutation(runId, {
      mutationType: 'codex_controlled_commit',
      chapterNumber: input.chapterNumber,
      patchPath: patchResult.artifact,
      beforeSnapshotId: beforeSnapshot.snapshotId,
      afterSnapshotId: afterSnapshot.snapshotId,
      beforeStateHash: hashJson(storyStateBefore),
      afterStateHash: hashJson(applied.storyState),
      latestCommittedChapterBefore: storyStateBefore.latestCommittedChapter,
      latestCommittedChapterAfter: applied.storyState.latestCommittedChapter,
      conflictCheckPassed: true,
      schemaValidationPassed: true,
      applied: true,
      stateDiffPath: diff.relativeJsonPath
    });
    await recordCommitJournalPhase(commitJournal, fileStore, 'state_mutation_recorded');

    const commitReport = await writeCompatibleCommitReport(paths, fileStore, input.chapterNumber, canonicalPatchPath, beforeSnapshot, afterSnapshot, conflicts, applied.appliedChanges);
    recordArtifact(artifacts, commitReport.path, generatedArtifacts);
    await runLogger.recordArtifact(runId, commitReport.path, 'generated');
    await recordCommitJournalPhase(commitJournal, fileStore, 'commit_report_written', {
      commitReportPath: commitReport.path
    });

    const codexCommitReport = await writeCodexCommitReport(paths, fileStore, input.chapterNumber, {
      canonPatchPath: patchResult.artifact,
      stateDiffPath: diff.relativeJsonPath,
      approvalRecordPath: approvalRecord.path,
      commitReportPath: commitReport.path,
      beforeSnapshotId: beforeSnapshot.snapshotId,
      afterSnapshotId: afterSnapshot.snapshotId,
      latestCommittedChapterBefore: storyStateBefore.latestCommittedChapter,
      latestCommittedChapterAfter: applied.storyState.latestCommittedChapter,
      committed: true,
      confirmed: true
    });
    recordArtifact(artifacts, codexCommitReport.path, generatedArtifacts);
    await runLogger.recordArtifact(runId, codexCommitReport.path, 'generated');
    await recordCommitJournalPhase(commitJournal, fileStore, 'codex_commit_report_written', {
      codexCommitReportPath: codexCommitReport.path
    });

    const updatedConsistencyReportPath = await updateCodexCommitConsistencyReport(paths, fileStore, input.chapterNumber, consistencyReportPath, {
      confirmedPatchPath: patchResult.artifact,
      confirmedStateDiffPath: diff.relativeJsonPath,
      confirmedStoryStateHash: hashJson(storyStateBefore),
      patchesEquivalent: reusedPreviewArtifacts ? true : await patchesEquivalent(paths, fileStore, consistencyReportPath, patchResult.value),
      stateDiffsEquivalent: await stateDiffsEquivalent(paths, fileStore, consistencyReportPath, diff.relativeJsonPath),
      reusedPreviewArtifacts
    });
    if (!artifacts.includes(updatedConsistencyReportPath)) {
      recordArtifact(artifacts, updatedConsistencyReportPath, generatedArtifacts);
    }
    await runLogger.recordArtifact(runId, updatedConsistencyReportPath, 'generated');

    try {
      const summary = await generateChapterContextSummary(
        {
          projectId: paths.projectId,
          projectsRoot: paths.projectsRoot,
          chapterNumber: input.chapterNumber
        },
        fileStore
      );
      recordArtifact(artifacts, summary.jsonPath, generatedArtifacts);
      recordArtifact(artifacts, summary.markdownPath, generatedArtifacts);
      await runLogger.recordArtifact(runId, summary.jsonPath, {
        action: 'generated',
        stage: 'context',
        derivedFrom: [final.artifact, canonicalPatchPath],
        provenanceNote: 'local deterministic chapter summary for future Codex context'
      });
      await runLogger.recordArtifact(runId, summary.markdownPath, {
        action: 'generated',
        stage: 'context',
        derivedFrom: [summary.jsonPath],
        provenanceNote: 'markdown summary for future Codex context'
      });
    } catch (error) {
      await runLogger.recordError(runId, {
        code: 'CODEX_CONTEXT_SUMMARY_FAILED',
        message: getErrorMessage(error),
        recoverable: true
      });
    }

    await queueStore.markStageComplete(input.chapterNumber, 'patch_extracted', 'canon_patch', runId);
    await queueStore.markCommitted(input.chapterNumber, runId);
    await recordCommitJournalPhase(commitJournal, fileStore, 'queue_committed', { queueCommitted: true });
    await recordCommitJournalPhase(commitJournal, fileStore, 'completed');
    await runLogger.recordArtifact(runId, commitJournal.relativePath, {
      action: 'generated',
      stage: 'commit',
      provenanceNote: 'completed controlled commit safety journal'
    });
    await runLogger.endRun(runId, 'completed');
    const finalQueueItem = await queueStore.getRequiredChapter(input.chapterNumber);
    return {
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      runId,
      status: 'committed',
      previewOnly: false,
      artifacts,
      generatedArtifacts,
      reusedArtifacts,
      finalDraftVersion: 1,
      previousStatus: previousQueueItem.status,
      newStatus: finalQueueItem.status,
      currentStage: finalQueueItem.currentStage,
      commitStatus: 'committed',
      codexPatchPath: patchResult.artifact,
      ...(patchResult.normalizedArtifact === undefined ? {} : { normalizedPatchPath: patchResult.normalizedArtifact }),
      stateDiffPath: diff.relativeJsonPath,
      ...(diff.relativeMarkdownPath === undefined ? {} : { stateDiffMarkdownPath: diff.relativeMarkdownPath }),
      approvalRecordPath: approvalRecord.path,
      commitReportPath: commitReport.path,
      codexCommitReportPath: codexCommitReport.path,
      consistencyReportPath: updatedConsistencyReportPath,
      qualityReportPath: quality.reportPath,
      reusedPreviewArtifacts,
      ...(reusedPreviewArtifacts ? { reusedPatchPath: patchResult.artifact, reusedStateDiffPath: diff.relativeJsonPath } : {}),
      beforeSnapshotId: beforeSnapshot.snapshotId,
      afterSnapshotId: afterSnapshot.snapshotId
    };
  } catch (error) {
    if (commitJournal !== undefined) {
      await recordCommitJournalPhase(commitJournal, fileStore, 'failed', {}, getErrorMessage(error));
      try {
        await runLogger.recordArtifact(runId, commitJournal.relativePath, {
          action: 'generated',
          stage: 'commit',
          provenanceNote: 'failed controlled commit safety journal'
        });
      } catch {
        // Preserve the original failure if journal lineage recording fails.
      }
    }
    const patchFailureReportPath = shouldWriteCodexPatchFailureReport(error, activeStage)
      ? await writeCodexPatchFailureReport(paths, fileStore, input, runId, activeStage, error)
      : undefined;
    if (patchFailureReportPath !== undefined) {
      try {
        await runLogger.recordArtifact(runId, patchFailureReportPath, {
          action: 'generated',
          stage: 'commit',
          provenanceNote: 'codex-text controlled commit patch failure report'
        });
      } catch {
        // Preserve the original failure if provenance recording itself is unavailable.
      }
    }
    if (previewTracker !== undefined && !previewFailureArtifactsWritten) {
      try {
        const previewErrorCode = previewCodeForError(error, activePreviewSubStage);
        await previewTracker.fail(activePreviewSubStage, previewErrorCode, getErrorMessage(error));
        const lastSuccessfulSubStage = lastSuccessfulPreviewSubStage(previewTracker.items());
        const previewFailure = await writePreviewFailureArtifacts({
          paths,
          fileStore,
          runLogger,
          input,
          runId,
          previewTracker,
        storyStateBefore,
        errorCode: previewErrorCode,
        failedSubStage: activePreviewSubStage,
        ...(lastSuccessfulSubStage === undefined ? {} : { lastSuccessfulSubStage }),
        error
      });
        previewFailureArtifactsWritten = true;
        for (const artifact of previewFailure.artifacts) {
          recordArtifact(artifacts, artifact, generatedArtifacts);
          await runLogger.recordArtifact(runId, artifact, {
            action: 'generated',
            stage: 'commit',
            provenanceNote: 'codex-text controlled preview failure diagnostics'
          });
        }
      } catch {
        // Preserve the original controlled commit failure if diagnostics writing fails.
      }
    }
    if (!(error instanceof AppError && error.code === 'CANON_PATCH_CONFLICT')) {
      await queueStore.markFailed(input.chapterNumber, activeStage, runId, error);
    }
    await runLogger.recordError(runId, {
      code: 'CODEX_CONTROLLED_COMMIT_FAILED',
      message: getErrorMessage(error),
      recoverable: false
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

function shouldWriteCodexPatchFailureReport(error: unknown, activeStage: ChapterQueueStage): boolean {
  if (activeStage === 'canon_patch') return true;
  if (!(error instanceof AppError) && !(error instanceof Error && 'code' in error)) return false;
  const code = errorCode(error);
  return [
    'CODEX_SCHEMA_VALIDATION_FAILED',
    'CODEX_REPAIR_FAILED',
    'CODEX_INVALID_JSON',
    'SCHEMA_VALIDATION_FAILED',
    'CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED',
    'CANON_PATCH_SOURCE_MISMATCH'
  ].includes(code);
}

async function writeCodexPatchFailureReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: CodexControlledCommitInput,
  runId: string,
  activeStage: ChapterQueueStage,
  error: unknown
): Promise<string> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'codex_patch_failure_report');
  const providerFailurePath = path.join('codex', 'failures', runId, 'codex_failure_report.json');
  const providerFailure = (await fileStore.exists(paths.projectArtifact(providerFailurePath)))
    ? await fileStore.readJson(paths.projectArtifact(providerFailurePath), CodexJsonFailureReportSchema)
    : undefined;
  const schemaErrors = await readFailureMessages(paths, fileStore, providerFailure?.schemaErrorPath);
  const normalizationErrors = await readFailureMessages(paths, fileStore, error instanceof AppError ? error.details?.normalizationErrorPath : undefined);
  const latestConflictReport = await findLatestVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'conflict_report');
  const latestConsistencyReport = await findLatestVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'codex_commit_consistency_report');
  const stateDiffPath =
    latestConsistencyReport === undefined
      ? undefined
      : (await fileStore.readJson(latestConsistencyReport.absolutePath, CodexCommitConsistencyReportSchema)).previewStateDiffPath;
  await fileStore.writeJson(
    artifact.absolutePath,
    {
      reportId: `codex_patch_failure_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
      projectId: paths.projectId,
      runId,
      chapterNumber: input.chapterNumber,
      stage: activeStage,
      provider: 'codex-text',
      codexProfile: input.codexProfile ?? 'default',
      command: `chapter ${paths.projectId} ${input.chapterNumber} --provider codex-text --commit${input.confirmCodexCommit === true ? ' --confirm-codex-commit' : ''}`,
      errorCode: errorCode(error),
      ...(providerFailure?.errorType === undefined ? {} : { providerErrorType: providerFailure.errorType }),
      stderrExcerptRedacted: redactFailureMessage(providerFailure?.stderrExcerpt ?? getErrorMessage(error)).slice(0, 4000),
      ...(providerFailure?.rawOutputPath === undefined ? {} : { rawOutputPath: providerFailure.rawOutputPath }),
      ...(providerFailure?.finalOutputPath === undefined ? {} : { finalOutputPath: providerFailure.finalOutputPath }),
      ...(providerFailure?.parseErrorPath === undefined ? {} : { parsedOutputPath: providerFailure.parseErrorPath }),
      ...(providerFailure?.outputSchemaPath === undefined ? {} : { schemaPath: providerFailure.outputSchemaPath }),
      schemaErrors,
      normalizationErrors,
      ...(latestConflictReport === undefined ? {} : { conflictReportPath: latestConflictReport.relativePath }),
      ...(stateDiffPath === undefined ? {} : { stateDiffPath }),
      suggestedFixes: [
        'rerun with --codex-profile debug',
        'increase --codex-json-retries',
        'enable --codex-json-repair',
        `inspect codex/failures/${runId}`,
        'run audit --strict',
        'run review'
      ],
      suggestedRetryCommand: `corepack pnpm novel-loop chapter ${paths.projectId} ${input.chapterNumber} --provider codex-text --commit --codex-profile debug --codex-json-retries ${Math.max(input.codexJsonRetries ?? 1, 2)} --codex-json-repair`,
      generatedAt: new Date().toISOString(),
      storyStateMutated: false,
      redacted: true
    },
    CodexPatchFailureReportSchema
  );
  return artifact.relativePath;
}

async function readFailureMessages(paths: ProjectPaths, fileStore: FileStore, relativePath: string | undefined): Promise<string[]> {
  if (relativePath === undefined || !(await fileStore.exists(paths.projectArtifact(relativePath)))) {
    return [];
  }
  try {
    const raw = JSON.parse(await fileStore.readText(paths.projectArtifact(relativePath))) as unknown;
    if (raw !== null && typeof raw === 'object' && 'message' in raw && typeof (raw as { message?: unknown }).message === 'string') {
      return [redactFailureMessage((raw as { message: string }).message)];
    }
    return [redactFailureMessage(JSON.stringify(raw)).slice(0, 4000)];
  } catch {
    return [];
  }
}

async function writePreviewFailureArtifacts(input: {
  paths: ProjectPaths;
  fileStore: FileStore;
  runLogger: RunLogger;
  input: CodexControlledCommitInput;
  runId: string;
  previewTracker: CodexPreviewSubStageTracker;
  storyStateBefore: StoryState;
  errorCode: CodexErrorType;
  failedSubStage: CodexPreviewSubStageName;
  lastSuccessfulSubStage?: CodexPreviewSubStageName;
  error: unknown;
}): Promise<{ artifacts: string[]; completenessReportPath: string; failureReportPath: string; errorCode: CodexErrorType }> {
  await input.previewTracker.start('completeness_check');
  await input.previewTracker.complete('completeness_check');
  const stateAfter = await input.fileStore.readJson(input.paths.storyState(), StoryStateSchema);
  const completeness = await writeCodexPreviewCompletenessReport({
    paths: input.paths,
    fileStore: input.fileStore,
    runLogger: input.runLogger,
    chapterNumber: input.input.chapterNumber,
    previewRunId: input.runId,
    previewStage: 'controlled_commit_preview',
    subStageTimeline: input.previewTracker.items(),
    latestCommittedChapterBefore: input.storyStateBefore.latestCommittedChapter,
    latestCommittedChapterAfter: stateAfter.latestCommittedChapter,
    storyStateHashBefore: hashJson(input.storyStateBefore),
    storyStateHashAfter: hashJson(stateAfter)
  });
  const primaryErrorCode = input.errorCode ?? classifyCodexPreviewCompleteness(completeness.report);
  const failure = await writeCodexPreviewFailureReport({
    paths: input.paths,
    fileStore: input.fileStore,
    runLogger: input.runLogger,
    chapterNumber: input.input.chapterNumber,
    previewRunId: input.runId,
    previewStage: 'controlled_commit_preview',
    subStageTimeline: input.previewTracker.items(),
    latestCommittedChapterBefore: input.storyStateBefore.latestCommittedChapter,
    latestCommittedChapterAfter: stateAfter.latestCommittedChapter,
    storyStateHashBefore: hashJson(input.storyStateBefore),
    storyStateHashAfter: hashJson(stateAfter),
    completenessReportPath: completeness.reportPath,
    completenessReport: completeness.report,
    errorCode: primaryErrorCode,
    failedSubStage: input.failedSubStage,
    ...(input.lastSuccessfulSubStage === undefined ? {} : { lastSuccessfulSubStage: input.lastSuccessfulSubStage }),
    error: input.error
  });
  return {
    artifacts: [completeness.reportPath, completeness.markdownPath, failure.reportPath, failure.markdownPath],
    completenessReportPath: completeness.reportPath,
    failureReportPath: failure.reportPath,
    errorCode: primaryErrorCode
  };
}

function previewCodeForError(error: unknown, activePreviewSubStage: CodexPreviewSubStageName): CodexErrorType {
  const code = errorCode(error);
  if (code.startsWith('CODEX_PREVIEW_')) return code as CodexErrorType;
  if (code === 'CODEX_EXEC_FAILED' || code === 'CODEX_TIMEOUT' || code === 'CODEX_NO_FINAL_MESSAGE') return code as CodexErrorType;
  if (code === 'CANON_PATCH_CONFLICT') return 'CODEX_PREVIEW_CONFLICT_DETECTED';
  if (/SCHEMA|VALIDATION|CANON_PATCH_SOURCE_MISMATCH/.test(code)) return 'CODEX_PREVIEW_PATCH_SCHEMA_INVALID';
  if (activePreviewSubStage === 'conflict_check') return 'CODEX_PREVIEW_CONFLICT_DETECTED';
  if (activePreviewSubStage === 'state_diff_preview') return 'CODEX_PREVIEW_STATE_DIFF_MISSING';
  if (activePreviewSubStage === 'final_generation_or_assembly') return 'CODEX_PREVIEW_FINAL_MISSING';
  if (activePreviewSubStage === 'canon_patch_proposal') return 'CODEX_PREVIEW_PATCH_PROPOSAL_MISSING';
  if (activePreviewSubStage === 'patch_normalization') return 'CODEX_PREVIEW_PATCH_NORMALIZATION_FAILED';
  if (activePreviewSubStage === 'schema_validation') return 'CODEX_PREVIEW_PATCH_SCHEMA_INVALID';
  if (activePreviewSubStage === 'diagnostics') return 'CODEX_PREVIEW_DIAGNOSTICS_MISSING';
  return 'CODEX_PREVIEW_INCOMPLETE';
}

function lastSuccessfulPreviewSubStage(timeline: Array<{ name: CodexPreviewSubStageName; status: string }>): CodexPreviewSubStageName | undefined {
  return timeline.filter((item) => item.status === 'completed').map((item) => item.name).at(-1);
}

function errorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return 'UNKNOWN_ERROR';
}

function redactFailureMessage(message: string): string {
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/["']?[^"'\s,]*auth\.json["']?/g, '"[REDACTED_AUTH_FILE]"');
}

async function generateCodexDiagnostics(
  input: CodexControlledCommitInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  runId: string
): Promise<{ artifact: string; value: DiagnosticsReport }> {
  const draftText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, 'draft_v1.md'));
  const promptService = createCodexPromptService(input, fileStore);
  const renderedPrompt = await promptService.renderPrompt('diagnostics.diagnose_chapter_slim', {
    CHAPTER_NUMBER: input.chapterNumber,
    DRAFT_VERSION: 1,
    DRAFT_SUMMARY: summarizeText(draftText)
  });
  const response = await createCodexLlmClient(input, paths, fileStore, runId).complete({
    promptId: 'diagnostics.diagnose_chapter_slim',
    system: 'Novel Loop Engine codex-text diagnostics module',
    user: renderedPrompt,
    responseFormat: 'json'
  });
  await writePromptRunArtifacts(fileStore, paths, runId, 'diagnostics.diagnose_chapter_slim', renderedPrompt, response.text);
  const normalized = normalizeCodexSlimOutput('diagnostics.diagnose_chapter_slim', response.json, {
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber
  });
  const artifact = relativeChapterArtifact(input.chapterNumber, 'diagnostics_v1.json');
  if (
    typeof normalized === 'object' &&
    normalized !== null &&
    'normalizationWarnings' in normalized &&
    Array.isArray((normalized as DiagnosticsReport).normalizationWarnings)
  ) {
    (normalized as DiagnosticsReport).normalizationWarnings = (normalized as DiagnosticsReport).normalizationWarnings.map((warning) => ({
      ...warning,
      artifactPath: artifact
    }));
  }
  const value = await fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, 'diagnostics_v1.json'), normalized, DiagnosticsReportSchema);
  return { artifact, value };
}

async function generateCodexRevisionPlan(
  input: CodexControlledCommitInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  runId: string,
  diagnostics: DiagnosticsReport
): Promise<{ artifact: string; value: RevisionPlan }> {
  const draftText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, 'draft_v1.md'));
  const promptService = createCodexPromptService(input, fileStore);
  const renderedPrompt = await promptService.renderPrompt('revision.create_revision_plan_slim', {
    CHAPTER_NUMBER: input.chapterNumber,
    DRAFT_VERSION: 1,
    DIAGNOSTICS_SUMMARY: JSON.stringify({
      hardFailures: HARD_CHECK_KEYS.filter((key) => !diagnostics.hard_checks[key].passed),
      issues: diagnostics.issues.map((issue) => issue.message),
      totalScore: diagnostics.scores.total
    }),
    DRAFT_SUMMARY: summarizeText(draftText)
  });
  const response = await createCodexLlmClient(input, paths, fileStore, runId).complete({
    promptId: 'revision.create_revision_plan_slim',
    system: 'Novel Loop Engine codex-text revision planning module',
    user: renderedPrompt,
    responseFormat: 'json'
  });
  await writePromptRunArtifacts(fileStore, paths, runId, 'revision.create_revision_plan_slim', renderedPrompt, response.text);
  const normalized = normalizeCodexSlimOutput('revision.create_revision_plan_slim', response.json, {
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber
  });
  const artifact = relativeChapterArtifact(input.chapterNumber, 'revision_plan_v1.json');
  const value = await fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, 'revision_plan_v1.json'), normalized, RevisionPlanSchema);
  return { artifact, value };
}

async function generateCodexFinal(
  input: CodexControlledCommitInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  runId: string,
  revisionPlan: RevisionPlan
): Promise<{ artifact: string }> {
  const draftText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, 'draft_v1.md'));
  const promptService = createCodexPromptService(input, fileStore);
  const renderedPrompt = await promptService.renderPrompt('revision.final_chapter', {
    CHAPTER_NUMBER: input.chapterNumber,
    DRAFT_MARKDOWN: draftText,
    REVISION_PLAN_SUMMARY: JSON.stringify(revisionPlan.operations.map((operation) => operation.concrete_instruction))
  });
  const response = await createCodexLlmClient(input, paths, fileStore, runId).complete({
    promptId: 'revision.final_chapter',
    system: 'Novel Loop Engine codex-text finalization module',
    user: renderedPrompt,
    responseFormat: 'markdown'
  });
  await writePromptRunArtifacts(fileStore, paths, runId, 'revision.final_chapter', renderedPrompt, response.text);
  const artifact = relativeChapterArtifact(input.chapterNumber, 'final.md');
  await fileStore.writeText(paths.chapterArtifact(input.chapterNumber, 'final.md'), response.text);
  return { artifact };
}

async function generateFinal(
  input: CodexControlledCommitInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  runId: string,
  revisionPlan: RevisionPlan
): Promise<{ artifact: string } | { artifact: string; reportPath: string; markdownPath: string; sourceScenePaths: string[] }> {
  if (input.codexFinalMode === 'local-assemble' || input.codexFinalMode === 'light-polish') {
    const assembled = await assembleFinalLocally(
      {
        projectId: paths.projectId,
        projectsRoot: paths.projectsRoot,
        chapterNumber: input.chapterNumber,
        mode: input.codexFinalMode
      },
      fileStore
    );
    void runId;
    void revisionPlan;
    return {
      artifact: assembled.artifact,
      reportPath: assembled.reportPath,
      markdownPath: assembled.markdownPath,
      sourceScenePaths: assembled.report.sourceScenePaths
    };
  }
  return generateCodexFinal(input, paths, fileStore, runId, revisionPlan);
}

function hasFinalAssemblyReport(
  result: { artifact: string } | { artifact: string; reportPath: string; markdownPath: string; sourceScenePaths: string[] }
): result is { artifact: string; reportPath: string; markdownPath: string; sourceScenePaths: string[] } {
  return 'reportPath' in result;
}

async function generateCodexCanonPatchProposal(
  input: CodexControlledCommitInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  runId: string,
  storyStateBefore: StoryState
): Promise<PatchResult> {
  const finalText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, 'final.md'));
  const promptService = createCodexPromptService(input, fileStore);
  const sourceFinalPath = relativeChapterArtifact(input.chapterNumber, 'final.md');
  const renderedPrompt = await promptService.renderPrompt('memory.extract_canon_patch_proposal_slim', {
    CHAPTER_NUMBER: input.chapterNumber,
    SOURCE_FINAL_PATH: sourceFinalPath,
    STORY_STATE_SUMMARY: JSON.stringify(summarizeStoryState(storyStateBefore)),
    FINAL_MARKDOWN: finalText
  });
  const response = await createCodexLlmClient(input, paths, fileStore, runId).complete({
    promptId: 'memory.extract_canon_patch_proposal_slim',
    system: 'Novel Loop Engine codex-text canon patch proposal module',
    user: renderedPrompt,
    responseFormat: 'json'
  });
  await writePromptRunArtifacts(fileStore, paths, runId, 'memory.extract_canon_patch_proposal_slim', renderedPrompt, response.text);
  const normalized = normalizeCodexSlimOutput('memory.extract_canon_patch_proposal_slim', response.json, {
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber
  });
  const patch = CanonPatchSchema.parse(normalized);
  if (patch.sourceFinalPath !== sourceFinalPath) {
    throw new AppError('CANON_PATCH_SOURCE_MISMATCH', `Codex patch proposal sourceFinalPath must be ${sourceFinalPath}.`, 2, {
      chapterNumber: input.chapterNumber,
      stage: 'canon_patch'
    });
  }
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'canon_patch_codex_proposal');
  const value = await fileStore.writeJson(artifact.absolutePath, patch, CanonPatchSchema);
  const normalizedArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'canon_patch_codex_normalized');
  const normalizedValue = await fileStore.writeJson(normalizedArtifact.absolutePath, value, CanonPatchSchema);
  return { artifact: artifact.relativePath, normalizedArtifact: normalizedArtifact.relativePath, value: normalizedValue };
}

async function readReusablePreviewArtifacts(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  currentStoryState: StoryState
): Promise<ReusablePreviewArtifacts | undefined> {
  const reportArtifact = await findLatestVersionedChapterArtifact(paths, fileStore, chapterNumber, 'codex_commit_consistency_report');
  if (reportArtifact === undefined) {
    return undefined;
  }
  const report = await fileStore.readJson(reportArtifact.absolutePath, CodexCommitConsistencyReportSchema);
  const currentStateHash = hashJson(currentStoryState);
  if (report.previewStoryStateHash !== currentStateHash) {
    throw new AppError('CODEX_PREVIEW_STALE', 'Codex preview artifacts were generated from a different Story State.', 2, {
      chapterNumber,
      stage: 'commit',
      reason: `previewStoryStateHash=${report.previewStoryStateHash}; currentStoryStateHash=${currentStateHash}`
    });
  }

  const requiredPaths = [
    relativeChapterArtifact(chapterNumber, 'diagnostics_v1.json'),
    relativeChapterArtifact(chapterNumber, 'revision_plan_v1.json'),
    relativeChapterArtifact(chapterNumber, 'final.md'),
    report.previewPatchPath,
    report.previewStateDiffPath
  ];
  for (const relativePath of requiredPaths) {
    if (!(await fileStore.exists(paths.projectArtifact(relativePath)))) {
      return undefined;
    }
  }
  if (report.previewNormalizedPatchPath !== undefined && !(await fileStore.exists(paths.projectArtifact(report.previewNormalizedPatchPath)))) {
    return undefined;
  }

  const diagnosticsArtifact = relativeChapterArtifact(chapterNumber, 'diagnostics_v1.json');
  const revisionPlanArtifact = relativeChapterArtifact(chapterNumber, 'revision_plan_v1.json');
  const finalArtifact = relativeChapterArtifact(chapterNumber, 'final.md');
  const patchPath = report.previewNormalizedPatchPath ?? report.previewPatchPath;
  const patch = await fileStore.readJson(paths.projectArtifact(patchPath), CanonPatchSchema);
  const diffReport = await fileStore.readJson(paths.projectArtifact(report.previewStateDiffPath), StateDiffReportSchema);

  return {
    diagnostics: {
      artifact: diagnosticsArtifact,
      value: await fileStore.readJson(paths.projectArtifact(diagnosticsArtifact), DiagnosticsReportSchema)
    },
    revisionPlan: {
      artifact: revisionPlanArtifact,
      value: await fileStore.readJson(paths.projectArtifact(revisionPlanArtifact), RevisionPlanSchema)
    },
    finalArtifact,
    patchResult: {
      artifact: report.previewPatchPath,
      ...(report.previewNormalizedPatchPath === undefined ? {} : { normalizedArtifact: report.previewNormalizedPatchPath }),
      value: patch
    },
    diff: {
      relativeJsonPath: report.previewStateDiffPath,
      ...(report.previewStateDiffMarkdownPath === undefined ? {} : { relativeMarkdownPath: report.previewStateDiffMarkdownPath }),
      report: diffReport
    },
    consistencyReportPath: reportArtifact.relativePath,
    consistencyReport: report
  };
}

async function writeCodexCommitConsistencyReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  input: {
    previewPatchPath: string;
    previewNormalizedPatchPath?: string;
    previewStateDiffPath: string;
    previewStateDiffMarkdownPath?: string;
    previewStoryStateHash: string;
  }
): Promise<string> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, chapterNumber, 'codex_commit_consistency_report');
  await fileStore.writeJson(
    artifact.absolutePath,
    {
      reportId: `codex_commit_consistency_ch${formatChapterNumber(chapterNumber)}_v${artifact.version}`,
      projectId: paths.projectId,
      chapterNumber,
      generatedAt: new Date().toISOString(),
      warnings: [],
      ...input
    },
    CodexCommitConsistencyReportSchema
  );
  return artifact.relativePath;
}

async function updateCodexCommitConsistencyReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  reportPath: string,
  input: {
    confirmedPatchPath: string;
    confirmedStateDiffPath: string;
    confirmedStoryStateHash: string;
    patchesEquivalent: boolean;
    stateDiffsEquivalent: boolean;
    reusedPreviewArtifacts: boolean;
  }
): Promise<string> {
  const existing = await fileStore.readJson(paths.projectArtifact(reportPath), CodexCommitConsistencyReportSchema);
  const warnings = [...existing.warnings];
  if (!input.patchesEquivalent) {
    warnings.push('Preview and confirmed canon patch proposals are not equivalent.');
  }
  if (!input.stateDiffsEquivalent) {
    warnings.push('Preview and confirmed state diffs are not equivalent.');
  }
  await fileStore.writeJson(
    paths.projectArtifact(reportPath),
    {
      ...existing,
      ...input,
      warnings,
      updatedAt: new Date().toISOString()
    },
    CodexCommitConsistencyReportSchema
  );
  void chapterNumber;
  return reportPath;
}

async function patchesEquivalent(paths: ProjectPaths, fileStore: FileStore, reportPath: string, confirmedPatch: CanonPatch): Promise<boolean> {
  const report = await fileStore.readJson(paths.projectArtifact(reportPath), CodexCommitConsistencyReportSchema);
  const previewPatch = await fileStore.readJson(paths.projectArtifact(report.previewNormalizedPatchPath ?? report.previewPatchPath), CanonPatchSchema);
  return stableJson(previewPatch) === stableJson(confirmedPatch);
}

async function stateDiffsEquivalent(paths: ProjectPaths, fileStore: FileStore, reportPath: string, confirmedStateDiffPath: string): Promise<boolean> {
  const report = await fileStore.readJson(paths.projectArtifact(reportPath), CodexCommitConsistencyReportSchema);
  if (report.previewStateDiffPath === confirmedStateDiffPath) {
    return true;
  }
  const preview = await fileStore.readJson(paths.projectArtifact(report.previewStateDiffPath), StateDiffReportSchema);
  const confirmed = await fileStore.readJson(paths.projectArtifact(confirmedStateDiffPath), StateDiffReportSchema);
  return stableJson({ summary: preview.summary, changes: preview.changes }) === stableJson({ summary: confirmed.summary, changes: confirmed.changes });
}

function createCodexPromptService(input: CodexControlledCommitInput, fileStore: FileStore): PromptService {
  return new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
}

function createCodexLlmClient(input: CodexControlledCommitInput, paths: ProjectPaths, fileStore: FileStore, runId: string) {
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
    telemetry: {
      paths,
      runId,
      fileStore
    }
  });
}

async function writeCodexApprovalRecord(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  canonPatchPath: string,
  stateDiffPath: string
): Promise<{ path: string; record: ApprovalRecord }> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, chapterNumber, 'codex_approval_record');
  const record = await fileStore.writeJson(
    artifact.absolutePath,
    {
      approvalId: `codex_approval_ch${formatChapterNumber(chapterNumber)}_v${artifact.version}`,
      projectId: paths.projectId,
      chapterNumber,
      action: 'codex_controlled_commit',
      provider: 'codex-text',
      stateDiffPath,
      canonPatchPath,
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      note: 'Local user confirmed codex-text controlled commit after preview.',
      operator: 'local_user',
      command: `chapter ${paths.projectId} ${chapterNumber} --provider codex-text --commit --confirm-codex-commit`,
      riskAcknowledged: true
    },
    ApprovalRecordSchema
  );
  return { path: artifact.relativePath, record };
}

async function writeCompatibleCommitReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  canonPatchPath: string,
  beforeSnapshot: CommitReport['beforeSnapshot'],
  afterSnapshot: CommitReport['afterSnapshot'],
  conflicts: CommitReport['conflicts'],
  appliedChanges: CommitReport['appliedChanges']
): Promise<{ path: string; report: CommitReport }> {
  const report = await fileStore.writeJson(
    paths.chapterArtifact(chapterNumber, 'commit_report.json'),
    {
      chapterNumber,
      status: 'committed',
      canonPatchPath,
      storyStatePath: path.join('state', 'story_state.json'),
      beforeSnapshot,
      afterSnapshot,
      conflicts,
      repaired: false,
      originalPatchPath: canonPatchPath,
      appliedChanges,
      committedAt: new Date().toISOString()
    },
    CommitReportSchema
  );
  return { path: relativeChapterArtifact(chapterNumber, 'commit_report.json'), report };
}

async function writeCodexCommitReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  input: Omit<CodexCommitReport, 'reportId' | 'projectId' | 'chapterNumber' | 'provider' | 'controlledCommit' | 'generatedAt' | 'previewOnly' | 'schemaValidationPassed' | 'conflictCheckPassed'>
): Promise<{ path: string; report: CodexCommitReport }> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, chapterNumber, 'codex_commit_report');
  const report = await fileStore.writeJson(
    artifact.absolutePath,
    {
      reportId: `codex_commit_ch${formatChapterNumber(chapterNumber)}_v${artifact.version}`,
      projectId: paths.projectId,
      chapterNumber,
      provider: 'codex-text',
      controlledCommit: true,
      schemaValidationPassed: true,
      conflictCheckPassed: true,
      previewOnly: !input.committed,
      generatedAt: new Date().toISOString(),
      ...input
    },
    CodexCommitReportSchema
  );
  return { path: artifact.relativePath, report };
}

async function writeCodexConflictReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  storyState: StoryState,
  patch: CanonPatch,
  patchPath: string
): Promise<{ path: string; report: ConflictReport }> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, chapterNumber, 'conflict_report');
  const report = await fileStore.writeJson(
    artifact.absolutePath,
    {
      reportId: `codex_conflict_ch${formatChapterNumber(chapterNumber)}_v${artifact.version}`,
      projectId: paths.projectId,
      chapterNumber,
      sourcePatchPath: patchPath,
      generatedAt: new Date().toISOString(),
      conflicts: detectPatchConflictItems(storyState, patch)
    },
    ConflictReportSchema
  );
  return { path: artifact.relativePath, report };
}

async function nextVersionedChapterArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string
): Promise<{ version: number; absolutePath: string; relativePath: string }> {
  for (let version = 1; version < 1000; version += 1) {
    const fileName = `${baseName}_v${version}.json`;
    const absolutePath = paths.chapterArtifact(chapterNumber, fileName);
    if (!(await fileStore.exists(absolutePath))) {
      return {
        version,
        absolutePath,
        relativePath: relativeChapterArtifact(chapterNumber, fileName)
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
  if (!(await fileStore.exists(paths.chapterDir(chapterNumber)))) {
    return undefined;
  }
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

async function ensureCodexPrerequisites(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  for (const artifact of ['mission.json', 'draft_v1.md']) {
    if (!(await fileStore.exists(paths.chapterArtifact(chapterNumber, artifact)))) {
      throw new AppError('CODEX_CONTROLLED_COMMIT_PREREQUISITE_MISSING', `${artifact} is required before codex-text controlled commit.`, 2, {
        chapterNumber,
        stage: 'commit'
      });
    }
  }
}

function recordArtifact(allArtifacts: string[], artifact: string, bucket: string[]): void {
  if (!allArtifacts.includes(artifact)) {
    allArtifacts.push(artifact);
  }
  if (!bucket.includes(artifact)) {
    bucket.push(artifact);
  }
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, fileName);
}

function relativeSnapshotArtifact(snapshotPath: string): string {
  const index = snapshotPath.lastIndexOf(`${path.sep}snapshots${path.sep}`);
  if (index === -1) return path.join('snapshots', path.basename(snapshotPath));
  return snapshotPath.slice(index + 1).split(path.sep).join(path.posix.sep);
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized;
}

function summarizeStoryState(storyState: StoryState): unknown {
  return {
    latestCommittedChapter: storyState.latestCommittedChapter,
    canonFactIds: storyState.canonFacts.map((fact) => fact.id),
    timelineEventIds: storyState.timeline.map((event) => event.id),
    openNarrativeDebtIds: storyState.narrativeDebts.filter((debt) => debt.status !== 'resolved').map((debt) => debt.id),
    readerKnows: storyState.readerState.readerKnows,
    readerSuspects: storyState.readerState.readerSuspects,
    readerQuestions: storyState.readerState.readerQuestions
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
