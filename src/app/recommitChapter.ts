import path from 'node:path';

import { ZodError } from 'zod';

import { ChapterQueueStore } from './chapterQueue.js';
import { applyCanonPatch, applyCanonPatchToStoryState, checkPatchConflicts } from './chapterCommit.js';
import { blockCodexTextUnsafeOperation } from './codexTextSafety.js';
import { createInitialStoryState } from './initProject.js';
import { generateRegenerationPlan } from './regenerationPlan.js';
import { writePatchPreviewDiff } from './stateDiff.js';
import { ProviderFactory, type ProviderName } from '../llm/ProviderFactory.js';
import { hashJson, RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import {
  ApprovalRecordSchema,
  CanonPatchSchema,
  ConflictReportSchema,
  DownstreamInvalidationReportSchema,
  HistoricalRecommitReportSchema,
  ManualReviewReportSchema,
  RecommitReportSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  ApprovalRecord,
  CanonPatch,
  ConflictItem,
  ConflictReport,
  DownstreamInvalidationReport,
  HistoricalRecommitReport,
  InvalidatedChapter,
  ManualReviewReport,
  RecommitReport,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { SnapshotStore } from '../storage/SnapshotStore.js';
import { AppError } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface RecommitChapterInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  sourceType: 'final' | 'patch';
  patchPath?: string;
  provider?: ProviderName;
  promptRoot?: string;
  fixturesRoot?: string;
  confirm?: boolean;
  mockScenario?: string;
  allowHistoricalRecommit?: boolean;
  markDownstreamStale?: boolean;
  runId?: string;
}

export interface RecommitChapterResult {
  projectId: string;
  chapterNumber: number;
  previewOnly: boolean;
  committed: boolean;
  generatedPatchPath: string;
  stateDiffPath: string;
  stateDiffMarkdownPath: string;
  manualReviewReportPath: string;
  recommitReportPath: string;
  approvalRecordPath?: string;
  beforeSnapshotId?: string;
  afterSnapshotId?: string;
  queueStatus: string;
  historicalRecommit?: boolean;
  oldLatestCommittedChapter?: number;
  newLatestCommittedChapter?: number;
  baseSnapshotId?: string;
  downstreamInvalidationReportPath?: string;
  historicalRecommitReportPath?: string;
  regenerationPlanPath?: string;
  staleChapters?: number[];
  suggestedNextCommand?: string;
  runId?: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DEFAULT_FIXTURES_ROOT = './fixtures/llm';

export async function recommitChapter(input: RecommitChapterInput, fileStore = new FileStore()): Promise<RecommitChapterResult> {
  if (input.provider === 'codex-text') {
    const historicalMessage = input.allowHistoricalRecommit === true;
    throw new AppError(
      historicalMessage ? 'CODEX_TEXT_HISTORICAL_RECOMMIT_BLOCKED' : 'CODEX_TEXT_RECOMMIT_BLOCKED',
      historicalMessage
        ? 'codex-text controlled commit cannot perform historical recommit in M24.'
        : 'codex-text controlled commit cannot perform recommit in M24.',
      2,
      {
        chapterNumber: input.chapterNumber,
        stage: 'commit',
        reason: 'M24 only allows codex-text controlled commit for the normal next uncommitted chapter.',
        suggestedNextCommand: `corepack pnpm novel-loop chapter ${input.projectId} ${input.chapterNumber} --provider codex-text --commit`
      }
    );
  }
  blockCodexTextUnsafeOperation({
    provider: input.provider,
    projectId: input.projectId,
    chapterNumber: input.chapterNumber,
    operation: 'chapter recommit',
    suggestedNextCommand: `corepack pnpm novel-loop chapter ${input.projectId} ${input.chapterNumber} --provider codex-text --until draft`
  });
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const queueStore = new ChapterQueueStore(paths, fileStore);
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const queueItem = await queueStore.getRequiredChapter(input.chapterNumber);
  const historicalRecommit = input.chapterNumber < storyState.latestCommittedChapter;

  if (historicalRecommit && input.allowHistoricalRecommit !== true) {
    throw new AppError('HISTORICAL_RECOMMIT_BLOCKED', `Historical recommit for chapter ${input.chapterNumber} is blocked by default.`, 2, {
      chapterNumber: input.chapterNumber,
      stage: 'commit',
      reason: 'chapterNumber is lower than latestCommittedChapter',
      suggestedNextCommand: `corepack pnpm novel-loop recommit ${paths.projectId} ${input.chapterNumber} --from-final --allow-historical-recommit --mark-downstream-stale --confirm`
    });
  }
  if (historicalRecommit && input.markDownstreamStale !== true) {
    throw new AppError('DOWNSTREAM_STALE_MARK_REQUIRED', 'Historical recommit requires --mark-downstream-stale.', 2, {
      chapterNumber: input.chapterNumber,
      stage: 'commit',
      reason: `downstream chapters must be marked stale before a historical recommit can proceed; oldLatestCommittedChapter=${storyState.latestCommittedChapter}`,
      suggestedNextCommand: `corepack pnpm novel-loop recommit ${paths.projectId} ${input.chapterNumber} --from-final --allow-historical-recommit --mark-downstream-stale`
    });
  }
  const historicalBase = historicalRecommit ? await resolveHistoricalBaseState(paths, fileStore, input.chapterNumber) : undefined;
  const conflictBaseState = historicalBase?.storyState ?? storyState;
  const runId = input.runId ?? createRunId();
  const runLogger = new RunLogger(paths, fileStore);
  const runInput: RecommitChapterInput = { ...input, runId };
  await runLogger.startRun({
    runId,
    command: 'recommit',
    args: {
      chapterNumber: input.chapterNumber,
      provider: input.provider ?? 'mock',
      sourceType: input.sourceType,
      confirm: input.confirm === true,
      allowHistoricalRecommit: input.allowHistoricalRecommit === true,
      markDownstreamStale: input.markDownstreamStale === true,
      mockScenario: input.mockScenario
    }
  });

  await fileStore.ensureDir(paths.chapterDir(input.chapterNumber));
  await fileStore.ensureDir(paths.diffsDir());

  try {
  const manualReviewReportPath = await writeManualReviewReport(paths, fileStore, runInput, queueItem.status);
  const patch = await createManualPatch(paths, fileStore, runInput, conflictBaseState);
  const generatedPatchPath = patch.path;
  const conflicts = checkRecommitPatchConflicts(conflictBaseState, patch.value);
  if (conflicts.hard.length > 0) {
    const conflictReport = await writeManualConflictReport(paths, fileStore, runInput, generatedPatchPath, conflicts.hard);
    if (!historicalRecommit) {
      await queueStore.markBlocked(input.chapterNumber, 'commit', runId, `Manual recommit conflict: ${conflicts.hard.join('; ')}`);
    }
    await runLogger.recordArtifact(runId, conflictReport.path, 'generated');
    throw new AppError('MANUAL_RECOMMIT_CONFLICT', `Manual recommit has ${conflicts.hard.length} blocking conflict(s).`, 2, {
      chapterNumber: input.chapterNumber,
      stage: 'commit',
      conflictCount: conflictReport.report.conflicts.length,
      highestSeverity: 'high',
      conflictReportPath: conflictReport.path,
      reason: 'manual patch failed conflict checks',
      suggestedNextCommand: `corepack pnpm novel-loop review ${paths.projectId} ${input.chapterNumber} --conflicts --suggest-next`
    });
  }

  const diff = await writePatchPreviewDiff(
    {
      projectId: paths.projectId,
      paths,
      patch: patch.value,
      patchPath: generatedPatchPath,
      unsafeToCommit: false,
      ...(historicalBase === undefined ? {} : { baseStoryState: historicalBase.storyState })
    },
    fileStore
  );

  const invalidatedChapters =
    historicalRecommit && historicalBase !== undefined
      ? await buildInvalidatedChapters(paths, fileStore, queueStore, input.chapterNumber, storyState.latestCommittedChapter)
      : [];
  let downstreamInvalidationPreviewPath: string | undefined;
  if (historicalRecommit && historicalBase !== undefined && input.confirm !== true) {
    downstreamInvalidationPreviewPath = await writeDownstreamInvalidationReport(paths, fileStore, runInput, {
      oldLatestCommittedChapter: storyState.latestCommittedChapter,
      newLatestCommittedChapter: input.chapterNumber,
      baseSnapshotId: historicalBase.baseSnapshotId,
      invalidatedChapters
    });
  }

  if (input.confirm !== true) {
    if (historicalRecommit && historicalBase !== undefined) {
      const reportPath = await writeRecommitReport(paths, fileStore, runInput, {
        sourcePath: sourcePath(input),
        generatedPatchPath,
        stateDiffPath: diff.relativeJsonPath,
        conflictsDetected: 0,
        committed: false,
        confirmed: false,
        historicalRecommit: true,
        oldLatestCommittedChapter: storyState.latestCommittedChapter,
        newLatestCommittedChapter: input.chapterNumber,
        baseSnapshotId: historicalBase.baseSnapshotId,
        ...(downstreamInvalidationPreviewPath === undefined ? {} : { downstreamInvalidationReportPath: downstreamInvalidationPreviewPath }),
        downstreamInvalidated: false
      });
      await recordRecommitRunArtifacts(runLogger, runId, [manualReviewReportPath, generatedPatchPath, diff.relativeJsonPath, diff.relativeMarkdownPath, reportPath, downstreamInvalidationPreviewPath]);
      await runLogger.endRun(runId, 'completed');
      return {
        projectId: paths.projectId,
        chapterNumber: input.chapterNumber,
        previewOnly: true,
        committed: false,
        generatedPatchPath,
        stateDiffPath: diff.relativeJsonPath,
        stateDiffMarkdownPath: diff.relativeMarkdownPath,
        manualReviewReportPath,
        recommitReportPath: reportPath,
        runId,
        queueStatus: queueItem.status,
        historicalRecommit: true,
        oldLatestCommittedChapter: storyState.latestCommittedChapter,
        newLatestCommittedChapter: input.chapterNumber,
        baseSnapshotId: historicalBase.baseSnapshotId,
        ...(downstreamInvalidationPreviewPath === undefined ? {} : { downstreamInvalidationReportPath: downstreamInvalidationPreviewPath }),
        staleChapters: invalidatedChapters.map((chapter) => chapter.chapterNumber),
        suggestedNextCommand: `corepack pnpm novel-loop recommit ${paths.projectId} ${input.chapterNumber} --from-final --provider mock --allow-historical-recommit --mark-downstream-stale --confirm`
      };
    }

    const reportPath = await writeRecommitReport(paths, fileStore, runInput, {
      sourcePath: sourcePath(input),
      generatedPatchPath,
      stateDiffPath: diff.relativeJsonPath,
      conflictsDetected: 0,
      committed: false,
      confirmed: false,
      historicalRecommit: false,
      downstreamInvalidated: false
    });
    await recordRecommitRunArtifacts(runLogger, runId, [manualReviewReportPath, generatedPatchPath, diff.relativeJsonPath, diff.relativeMarkdownPath, reportPath]);
    await runLogger.endRun(runId, 'completed');
    return {
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      previewOnly: true,
      committed: false,
      generatedPatchPath,
      stateDiffPath: diff.relativeJsonPath,
      stateDiffMarkdownPath: diff.relativeMarkdownPath,
      manualReviewReportPath,
      recommitReportPath: reportPath,
      runId,
      queueStatus: queueItem.status,
      historicalRecommit: false
    };
  }

  if (historicalRecommit && historicalBase !== undefined) {
    const result = await commitHistoricalRecommit({
      input: runInput,
      paths,
      fileStore,
      queueStore,
      storyState,
      baseSnapshotId: historicalBase.baseSnapshotId,
      baseStoryState: historicalBase.storyState,
      queueStatus: queueItem.status,
      manualReviewReportPath,
      patch: patch.value,
      generatedPatchPath,
      diffPath: diff.relativeJsonPath,
      diffMarkdownPath: diff.relativeMarkdownPath,
      invalidatedChapters
    });
    await recordRecommitRunArtifacts(runLogger, runId, [
      manualReviewReportPath,
      generatedPatchPath,
      diff.relativeJsonPath,
      diff.relativeMarkdownPath,
      result.recommitReportPath,
      result.approvalRecordPath,
      result.downstreamInvalidationReportPath,
      result.historicalRecommitReportPath,
      result.regenerationPlanPath
    ]);
    await runLogger.endRun(runId, 'completed');
    return { ...result, runId };
  }

  await queueStore.markRecommitting(input.chapterNumber, runId);
  const snapshotStore = new SnapshotStore(paths, fileStore);
  const beforeSnapshot = await snapshotStore.createSnapshot(storyState, {
    reason: `before_chapter_${formatChapterNumber(input.chapterNumber)}_recommit`,
    sourceChapter: input.chapterNumber,
    runId
  });
  await runLogger.recordSnapshot(runId, beforeSnapshot, storyState);
  const applied = await applyCanonPatch(
    {
      projectId: paths.projectId,
      projectsRoot: paths.projectsRoot,
      chapterNumber: input.chapterNumber
    },
    patch.value,
    fileStore
  );
  const afterSnapshot = await snapshotStore.createSnapshot(applied.storyState, {
    reason: `after_chapter_${formatChapterNumber(input.chapterNumber)}_recommit`,
    sourceChapter: input.chapterNumber,
    runId
  });
  await runLogger.recordSnapshot(runId, afterSnapshot, applied.storyState);
  await runLogger.recordStateMutation(runId, {
    mutationType: 'recommit_patch',
    chapterNumber: input.chapterNumber,
    patchPath: generatedPatchPath,
    beforeSnapshotId: beforeSnapshot.snapshotId,
    afterSnapshotId: afterSnapshot.snapshotId,
    beforeStateHash: hashJson(storyState),
    afterStateHash: hashJson(applied.storyState),
    latestCommittedChapterBefore: storyState.latestCommittedChapter,
    latestCommittedChapterAfter: applied.storyState.latestCommittedChapter,
    conflictCheckPassed: true,
    schemaValidationPassed: true,
    applied: true,
    stateDiffPath: diff.relativeJsonPath
  });
  const approvalRecordPath = await writeApprovalRecord(paths, fileStore, runInput, sourcePath(runInput));
  const recommitReportPath = await writeRecommitReport(paths, fileStore, runInput, {
    sourcePath: sourcePath(input),
    generatedPatchPath,
    stateDiffPath: diff.relativeJsonPath,
    beforeSnapshotId: beforeSnapshot.snapshotId,
    afterSnapshotId: afterSnapshot.snapshotId,
    conflictsDetected: 0,
    committed: true,
    confirmed: true,
    historicalRecommit,
    downstreamInvalidated: false
  });
  const finalQueueItem =
    input.chapterNumber === storyState.latestCommittedChapter
      ? await queueStore.markRecommitted(input.chapterNumber, runId)
      : await queueStore.markCommitted(input.chapterNumber, runId);

  await recordRecommitRunArtifacts(runLogger, runId, [
    manualReviewReportPath,
    generatedPatchPath,
    diff.relativeJsonPath,
    diff.relativeMarkdownPath,
    approvalRecordPath,
    recommitReportPath,
    path.posix.join('state', 'story_state.json')
  ]);
  await runLogger.endRun(runId, 'completed');
  return {
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    previewOnly: false,
    committed: true,
    generatedPatchPath,
    stateDiffPath: diff.relativeJsonPath,
    stateDiffMarkdownPath: diff.relativeMarkdownPath,
    manualReviewReportPath,
    recommitReportPath,
    approvalRecordPath,
    runId,
    beforeSnapshotId: beforeSnapshot.snapshotId,
    afterSnapshotId: afterSnapshot.snapshotId,
    queueStatus: finalQueueItem.status
  };
  } catch (error) {
    await runLogger.recordError(runId, {
      code: 'RECOMMIT_FAILED',
      message: error instanceof Error ? error.message : String(error),
      recoverable: false
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

interface HistoricalBaseState {
  baseSnapshotId: string;
  storyState: StoryState;
}

interface CommitHistoricalRecommitInput {
  input: RecommitChapterInput;
  paths: ProjectPaths;
  fileStore: FileStore;
  queueStore: ChapterQueueStore;
  storyState: StoryState;
  baseSnapshotId: string;
  baseStoryState: StoryState;
  queueStatus: string;
  manualReviewReportPath: string;
  patch: CanonPatch;
  generatedPatchPath: string;
  diffPath: string;
  diffMarkdownPath: string;
  invalidatedChapters: InvalidatedChapter[];
}

async function commitHistoricalRecommit(context: CommitHistoricalRecommitInput): Promise<RecommitChapterResult> {
  const { input, paths, fileStore, queueStore, storyState, baseSnapshotId, baseStoryState, patch } = context;
  const runLogger = input.runId === undefined ? undefined : new RunLogger(paths, fileStore);
  const oldLatestCommittedChapter = storyState.latestCommittedChapter;
  const newLatestCommittedChapter = input.chapterNumber;
  const staleReason = `stale because chapter ${input.chapterNumber} was historically recommitted`;
  const snapshotStore = new SnapshotStore(paths, fileStore);

  await queueStore.markRecommitting(input.chapterNumber, input.runId);
  const beforeSnapshot = await snapshotStore.createSnapshot(storyState, {
    reason: `before_chapter_${formatChapterNumber(input.chapterNumber)}_historical_recommit`,
    sourceChapter: input.chapterNumber,
    ...(input.runId === undefined ? {} : { runId: input.runId })
  });
  if (runLogger !== undefined && input.runId !== undefined) {
    await runLogger.recordSnapshot(input.runId, beforeSnapshot, storyState);
  }
  const applied = applyCanonPatchToStoryState(baseStoryState, patch);
  await fileStore.writeJson(paths.storyState(), applied.storyState, StoryStateSchema);
  const afterSnapshot = await snapshotStore.createSnapshot(applied.storyState, {
    reason: `after_chapter_${formatChapterNumber(input.chapterNumber)}_historical_recommit`,
    sourceChapter: input.chapterNumber,
    ...(input.runId === undefined ? {} : { runId: input.runId })
  });
  if (runLogger !== undefined && input.runId !== undefined) {
    await runLogger.recordSnapshot(input.runId, afterSnapshot, applied.storyState);
    await runLogger.recordStateMutation(input.runId, {
      mutationType: 'historical_rebase',
      chapterNumber: input.chapterNumber,
      patchPath: context.generatedPatchPath,
      beforeSnapshotId: beforeSnapshot.snapshotId,
      afterSnapshotId: afterSnapshot.snapshotId,
      beforeStateHash: hashJson(storyState),
      afterStateHash: hashJson(applied.storyState),
      latestCommittedChapterBefore: storyState.latestCommittedChapter,
      latestCommittedChapterAfter: applied.storyState.latestCommittedChapter,
      conflictCheckPassed: true,
      schemaValidationPassed: true,
      applied: true,
      stateDiffPath: context.diffPath
    });
  }

  const approvalRecordPath = await writeApprovalRecord(paths, fileStore, input, sourcePath(input));
  const targetQueueItem = await queueStore.markRecommitted(input.chapterNumber, input.runId);
  await queueStore.markDownstreamStale(input.chapterNumber, oldLatestCommittedChapter, staleReason, input.runId);
  const regenerationPlan = await generateRegenerationPlan(
    {
      projectId: paths.projectId,
      projectsRoot: paths.projectsRoot,
      fromChapter: input.chapterNumber + 1,
      basedOnStateSnapshotId: afterSnapshot.snapshotId
    },
    fileStore
  );

  const downstreamArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'downstream_invalidation_report');
  const historicalArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'historical_recommit_report');
  const downstreamInvalidationReportPath = await writeDownstreamInvalidationReport(
    paths,
    fileStore,
    input,
    {
      oldLatestCommittedChapter,
      newLatestCommittedChapter,
      baseSnapshotId,
      beforeSnapshotId: beforeSnapshot.snapshotId,
      afterSnapshotId: afterSnapshot.snapshotId,
      historicalRecommitReportPath: historicalArtifact.relativePath,
      invalidatedChapters: context.invalidatedChapters
    },
    downstreamArtifact
  );
  const historicalRecommitReportPath = await writeHistoricalRecommitReport(paths, fileStore, input, historicalArtifact, {
    sourcePath: sourcePath(input),
    generatedPatchPath: context.generatedPatchPath,
    stateDiffPath: context.diffPath,
    beforeSnapshotId: beforeSnapshot.snapshotId,
    afterSnapshotId: afterSnapshot.snapshotId,
    oldLatestCommittedChapter,
    newLatestCommittedChapter,
    baseSnapshotId,
    downstreamInvalidationReportPath,
    regenerationPlanPath: regenerationPlan.planPath
  });
  const recommitReportPath = await writeRecommitReport(paths, fileStore, input, {
    sourcePath: sourcePath(input),
    generatedPatchPath: context.generatedPatchPath,
    stateDiffPath: context.diffPath,
    beforeSnapshotId: beforeSnapshot.snapshotId,
    afterSnapshotId: afterSnapshot.snapshotId,
    conflictsDetected: 0,
    committed: true,
    confirmed: true,
    historicalRecommit: true,
    oldLatestCommittedChapter,
    newLatestCommittedChapter,
    baseSnapshotId,
    downstreamInvalidationReportPath,
    regenerationPlanPath: regenerationPlan.planPath,
    downstreamInvalidated: true
  });

  return {
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    previewOnly: false,
    committed: true,
    generatedPatchPath: context.generatedPatchPath,
    stateDiffPath: context.diffPath,
    stateDiffMarkdownPath: context.diffMarkdownPath,
    manualReviewReportPath: context.manualReviewReportPath,
    recommitReportPath,
    approvalRecordPath,
    beforeSnapshotId: beforeSnapshot.snapshotId,
    afterSnapshotId: afterSnapshot.snapshotId,
    queueStatus: targetQueueItem.status,
    historicalRecommit: true,
    oldLatestCommittedChapter,
    newLatestCommittedChapter,
    baseSnapshotId,
    downstreamInvalidationReportPath,
    historicalRecommitReportPath,
    regenerationPlanPath: regenerationPlan.planPath,
    staleChapters: context.invalidatedChapters.map((chapter) => chapter.chapterNumber),
    suggestedNextCommand: `corepack pnpm novel-loop chapter ${paths.projectId} next --provider mock --regenerate-stale --max-revisions 2 --commit`
  };
}

async function resolveHistoricalBaseState(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<HistoricalBaseState> {
  if (chapterNumber === 1) {
    return {
      baseSnapshotId: 'initial_project_state',
      storyState: createInitialStoryState(paths.projectId)
    };
  }

  const expectedSourceChapter = chapterNumber - 1;
  const expectedReason = `after_chapter_${formatChapterNumber(expectedSourceChapter)}_commit`;
  const snapshotStore = new SnapshotStore(paths, fileStore);
  const snapshots = await snapshotStore.listSnapshots();
  const baseMeta = [...snapshots]
    .reverse()
    .find((snapshot) => snapshot.sourceChapter === expectedSourceChapter && snapshot.reason === expectedReason);
  if (baseMeta === undefined) {
    throw new AppError('BASE_SNAPSHOT_NOT_FOUND', `Base snapshot not found for chapter ${chapterNumber} historical recommit.`, 2, {
      chapterNumber,
      stage: 'commit',
      reason: `expected snapshot reason ${expectedReason}`,
      suggestedNextCommand: `corepack pnpm novel-loop rollback ${paths.projectId} --snapshot <snapshotId>`
    });
  }
  const snapshot = await snapshotStore.readSnapshot(baseMeta.snapshotId);
  return {
    baseSnapshotId: baseMeta.snapshotId,
    storyState: snapshot.storyState
  };
}

async function buildInvalidatedChapters(
  paths: ProjectPaths,
  fileStore: FileStore,
  queueStore: ChapterQueueStore,
  editedChapterNumber: number,
  oldLatestCommittedChapter: number
): Promise<InvalidatedChapter[]> {
  const queue = await queueStore.readQueue();
  const invalidationReason = `stale because chapter ${editedChapterNumber} was historically recommitted`;
  const invalidated: InvalidatedChapter[] = [];
  for (const chapter of queue.chapters) {
    if (chapter.chapterNumber <= editedChapterNumber || chapter.chapterNumber > oldLatestCommittedChapter) {
      continue;
    }
    const oldCommitReportPath = await optionalRelativeChapterPath(paths, fileStore, chapter.chapterNumber, 'commit_report.json');
    const oldCanonPatchPath = await optionalRelativeChapterPath(paths, fileStore, chapter.chapterNumber, 'canon_patch.json');
    const oldFinalPath = await optionalRelativeChapterPath(paths, fileStore, chapter.chapterNumber, 'final.md');
    invalidated.push({
      chapterNumber: chapter.chapterNumber,
      previousStatus: chapter.status,
      newStatus: 'stale_due_to_history_edit',
      artifactPath: chapter.artifactPath,
      ...(oldCommitReportPath === undefined ? {} : { oldCommitReportPath }),
      ...(oldCanonPatchPath === undefined ? {} : { oldCanonPatchPath }),
      ...(oldFinalPath === undefined ? {} : { oldFinalPath }),
      invalidationReason,
      canRegenerate: true,
      requiresHumanReview: false
    });
  }
  return invalidated;
}

async function optionalRelativeChapterPath(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  fileName: string
): Promise<string | undefined> {
  const absolutePath = paths.chapterArtifact(chapterNumber, fileName);
  return (await fileStore.exists(absolutePath)) ? relativeChapterArtifact(chapterNumber, fileName) : undefined;
}

async function writeDownstreamInvalidationReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: RecommitChapterInput,
  reportInput: {
    oldLatestCommittedChapter: number;
    newLatestCommittedChapter: number;
    baseSnapshotId: string;
    beforeSnapshotId?: string;
    afterSnapshotId?: string;
    historicalRecommitReportPath?: string;
    invalidatedChapters: InvalidatedChapter[];
  },
  artifact?: { version: number; relativePath: string; absolutePath: string }
): Promise<string> {
  const targetArtifact = artifact ?? (await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'downstream_invalidation_report'));
  const report: DownstreamInvalidationReport = {
    reportId: `downstream_invalidation_ch${formatChapterNumber(input.chapterNumber)}_v${targetArtifact.version}`,
    projectId: paths.projectId,
    editedChapterNumber: input.chapterNumber,
    oldLatestCommittedChapter: reportInput.oldLatestCommittedChapter,
    newLatestCommittedChapter: reportInput.newLatestCommittedChapter,
    baseSnapshotId: reportInput.baseSnapshotId,
    ...(reportInput.beforeSnapshotId === undefined ? {} : { beforeSnapshotId: reportInput.beforeSnapshotId }),
    ...(reportInput.afterSnapshotId === undefined ? {} : { afterSnapshotId: reportInput.afterSnapshotId }),
    ...(reportInput.historicalRecommitReportPath === undefined ? {} : { historicalRecommitReportPath: reportInput.historicalRecommitReportPath }),
    invalidatedChapters: reportInput.invalidatedChapters,
    generatedAt: new Date().toISOString(),
    reason: `chapter ${input.chapterNumber} was historically recommitted`,
    regenerationRequired: reportInput.invalidatedChapters.length > 0,
    suggestedNextCommand: `corepack pnpm novel-loop chapter ${paths.projectId} next --provider mock --regenerate-stale --max-revisions 2 --commit`
  };
  await fileStore.writeJson(targetArtifact.absolutePath, report, DownstreamInvalidationReportSchema);
  return targetArtifact.relativePath;
}

async function writeHistoricalRecommitReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: RecommitChapterInput,
  artifact: { version: number; relativePath: string; absolutePath: string },
  reportInput: {
    sourcePath: string;
    generatedPatchPath: string;
    stateDiffPath: string;
    beforeSnapshotId: string;
    afterSnapshotId: string;
    oldLatestCommittedChapter: number;
    newLatestCommittedChapter: number;
    baseSnapshotId: string;
    downstreamInvalidationReportPath: string;
    regenerationPlanPath: string;
  }
): Promise<string> {
  const report: HistoricalRecommitReport = {
    recommitId: `historical_recommit_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    sourceType: input.sourceType,
    sourcePath: reportInput.sourcePath,
    generatedPatchPath: reportInput.generatedPatchPath,
    stateDiffPath: reportInput.stateDiffPath,
    beforeSnapshotId: reportInput.beforeSnapshotId,
    afterSnapshotId: reportInput.afterSnapshotId,
    conflictsDetected: 0,
    repaired: false,
    committed: true,
    confirmed: true,
    historicalRecommit: true,
    oldLatestCommittedChapter: reportInput.oldLatestCommittedChapter,
    newLatestCommittedChapter: reportInput.newLatestCommittedChapter,
    baseSnapshotId: reportInput.baseSnapshotId,
    downstreamInvalidationReportPath: reportInput.downstreamInvalidationReportPath,
    regenerationPlanPath: reportInput.regenerationPlanPath,
    downstreamInvalidated: true,
    generatedAt: new Date().toISOString()
  };
  await fileStore.writeJson(artifact.absolutePath, report, HistoricalRecommitReportSchema);
  return artifact.relativePath;
}

async function createManualPatch(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: RecommitChapterInput,
  storyState: StoryState
): Promise<{ path: string; value: CanonPatch }> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'canon_patch_manual');
  try {
    const rawPatch =
      input.sourceType === 'final'
        ? await extractPatchFromFinal(paths, fileStore, input, storyState)
        : await readManualPatchFromPath(fileStore, input.patchPath);
    const parsed = CanonPatchSchema.parse(rawPatch);
    if (parsed.chapterNumber !== input.chapterNumber) {
      throw new AppError('MANUAL_PATCH_CHAPTER_MISMATCH', `Manual patch chapter ${parsed.chapterNumber} does not match ${input.chapterNumber}.`, 2, {
        chapterNumber: input.chapterNumber,
        stage: 'canon_patch'
      });
    }
    const written = await fileStore.writeJson(artifact.absolutePath, parsed, CanonPatchSchema);
    return { path: artifact.relativePath, value: written };
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      throw new AppError('MANUAL_PATCH_SCHEMA_INVALID', `Manual patch failed CanonPatchSchema validation: ${error.message}`, 2, {
        chapterNumber: input.chapterNumber,
        stage: 'canon_patch'
      });
    }
    throw error;
  }
}

async function extractPatchFromFinal(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: RecommitChapterInput,
  storyState: StoryState
): Promise<unknown> {
  const finalText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, 'final.md'));
  const promptService = new PromptService(input.promptRoot ?? DEFAULT_PROMPT_ROOT, fileStore);
  const llmClient = ProviderFactory.create({
    provider: input.provider ?? 'mock',
    fixturesRoot: input.fixturesRoot ?? DEFAULT_FIXTURES_ROOT
  });
  const renderedPrompt = await promptService.renderPrompt('memory.extract_canon_patch', {
    CHAPTER_NUMBER: input.chapterNumber,
    SOURCE_FINAL_PATH: relativeChapterArtifact(input.chapterNumber, 'final.md'),
    STORY_STATE_JSON: JSON.stringify(storyState, null, 2),
    FINAL_MARKDOWN: finalText
  });
  const response = await llmClient.complete({
    promptId: 'memory.extract_canon_patch',
    system: 'Novel Loop Engine manual recommit extraction module',
    user: renderedPrompt,
    responseFormat: 'json',
    metadata: {
      fixtureScenario:
        input.mockScenario ??
        (input.allowHistoricalRecommit === true ? `historical-recommit-chapter-${input.chapterNumber}-valid` : `manual-final-chapter-${input.chapterNumber}`)
    }
  });
  return response.json;
}

async function readManualPatchFromPath(fileStore: FileStore, patchPath: string | undefined): Promise<unknown> {
  if (patchPath === undefined) {
    throw new AppError('MANUAL_PATCH_PATH_REQUIRED', '--from-patch requires a patch path.', 2);
  }
  return JSON.parse(await fileStore.readText(patchPath)) as unknown;
}

async function writeManualReviewReport(paths: ProjectPaths, fileStore: FileStore, input: RecommitChapterInput, queueStatus: string): Promise<string> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'manual_review_report');
  const report: ManualReviewReport = {
    reportId: `manual_review_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    finalPath: relativeChapterArtifact(input.chapterNumber, 'final.md'),
    diagnosticsSummary: await diagnosticsSummary(paths, fileStore, input.chapterNumber),
    conflictSummary: await conflictSummary(paths, fileStore, input.chapterNumber),
    queueStatus,
    suggestedActions: [
      `corepack pnpm novel-loop recommit ${paths.projectId} ${input.chapterNumber} --from-final --confirm`,
      `corepack pnpm novel-loop diff-state ${paths.projectId} --patch ${relativeChapterArtifact(input.chapterNumber, 'canon_patch_manual_v1.json')}`
    ],
    generatedAt: new Date().toISOString()
  };
  await fileStore.writeJson(artifact.absolutePath, report, ManualReviewReportSchema);
  return artifact.relativePath;
}

async function writeManualConflictReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: RecommitChapterInput,
  sourcePatchPath: string,
  hardConflicts: string[]
): Promise<{ path: string; report: ConflictReport }> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'conflict_report');
  const conflicts: ConflictItem[] = hardConflicts.map((conflict, index) => ({
    conflictId: `manual_conflict_${String(index + 1).padStart(3, '0')}`,
    conflictType: 'UNKNOWN_PATCH_CONFLICT',
    severity: 'high',
    statePath: '/state',
    patchPath: '/canon_patch_manual',
    existingValue: null,
    proposedValue: conflict,
    explanation: conflict,
    suggestedResolution: 'Edit final.md or canon_patch_manual and run recommit again.',
    blocking: true,
    repairable: false
  }));
  const report: ConflictReport = {
    reportId: `manual_conflict_report_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    sourcePatchPath,
    generatedAt: new Date().toISOString(),
    conflicts
  };
  const written = await fileStore.writeJson(artifact.absolutePath, report, ConflictReportSchema);
  return { path: artifact.relativePath, report: written };
}

async function writeRecommitReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: RecommitChapterInput,
  reportInput: {
    sourcePath: string;
    generatedPatchPath: string;
    stateDiffPath: string;
    beforeSnapshotId?: string;
    afterSnapshotId?: string;
    conflictsDetected: number;
    committed: boolean;
    confirmed: boolean;
    historicalRecommit: boolean;
    oldLatestCommittedChapter?: number;
    newLatestCommittedChapter?: number;
    baseSnapshotId?: string;
    downstreamInvalidationReportPath?: string;
    regenerationPlanPath?: string;
    downstreamInvalidated: boolean;
  }
): Promise<string> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'recommit_report');
  const report: RecommitReport = {
    recommitId: `recommit_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    sourceType: input.sourceType,
    sourcePath: reportInput.sourcePath,
    generatedPatchPath: reportInput.generatedPatchPath,
    stateDiffPath: reportInput.stateDiffPath,
    ...(reportInput.beforeSnapshotId === undefined ? {} : { beforeSnapshotId: reportInput.beforeSnapshotId }),
    ...(reportInput.afterSnapshotId === undefined ? {} : { afterSnapshotId: reportInput.afterSnapshotId }),
    conflictsDetected: reportInput.conflictsDetected,
    repaired: false,
    committed: reportInput.committed,
    confirmed: reportInput.confirmed,
    historicalRecommit: reportInput.historicalRecommit,
    ...(reportInput.oldLatestCommittedChapter === undefined ? {} : { oldLatestCommittedChapter: reportInput.oldLatestCommittedChapter }),
    ...(reportInput.newLatestCommittedChapter === undefined ? {} : { newLatestCommittedChapter: reportInput.newLatestCommittedChapter }),
    ...(reportInput.baseSnapshotId === undefined ? {} : { baseSnapshotId: reportInput.baseSnapshotId }),
    ...(reportInput.downstreamInvalidationReportPath === undefined
      ? {}
      : { downstreamInvalidationReportPath: reportInput.downstreamInvalidationReportPath }),
    ...(reportInput.regenerationPlanPath === undefined ? {} : { regenerationPlanPath: reportInput.regenerationPlanPath }),
    downstreamInvalidated: reportInput.downstreamInvalidated,
    generatedAt: new Date().toISOString()
  };
  await fileStore.writeJson(artifact.absolutePath, report, RecommitReportSchema);
  return artifact.relativePath;
}

async function writeApprovalRecord(paths: ProjectPaths, fileStore: FileStore, input: RecommitChapterInput, sourcePathValue: string): Promise<string> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'approval_record');
  const record: ApprovalRecord = {
    approvalId: `approval_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    action: input.allowHistoricalRecommit === true ? 'historical_recommit' : input.sourceType === 'patch' ? 'manual_patch_commit' : 'recommit',
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    operator: 'local_user',
    command: `novel-loop recommit ${paths.projectId} ${input.chapterNumber} ${input.sourceType === 'final' ? '--from-final' : `--from-patch ${sourcePathValue}`} --confirm`,
    riskAcknowledged: true
  };
  await fileStore.writeJson(artifact.absolutePath, record, ApprovalRecordSchema);
  return artifact.relativePath;
}

async function recordRecommitRunArtifacts(runLogger: RunLogger, runId: string, artifacts: Array<string | undefined>): Promise<void> {
  for (const artifact of artifacts) {
    if (artifact !== undefined) {
      await runLogger.recordArtifact(runId, artifact, 'generated');
    }
  }
}

function checkRecommitPatchConflicts(storyState: StoryState, patch: CanonPatch) {
  const conflicts = checkPatchConflicts(storyState, patch);
  if (patch.chapterNumber !== storyState.latestCommittedChapter) {
    return conflicts;
  }
  return {
    hard: conflicts.hard.filter((conflict) => !isLatestRecommitSequenceConflict(conflict)),
    warnings: conflicts.warnings
  };
}

function isLatestRecommitSequenceConflict(conflict: string): boolean {
  return conflict.includes('latestCommittedChapter') || conflict.includes('already committed');
}

async function diagnosticsSummary(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<string> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) {
    return 'none';
  }
  const diagnostics = (await fileStore.list(chapterDir)).filter((entry) => /^diagnostics_v\d+\.json$/.test(entry));
  return diagnostics.length === 0 ? 'none' : `${diagnostics.length} diagnostics report(s), latest ${diagnostics.at(-1) ?? 'none'}`;
}

async function conflictSummary(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<string> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) {
    return 'none';
  }
  const conflicts = (await fileStore.list(chapterDir)).filter((entry) => /^conflict_report_v\d+\.json$/.test(entry));
  return conflicts.length === 0 ? 'none' : `${conflicts.length} conflict report(s), latest ${conflicts.at(-1) ?? 'none'}`;
}

function sourcePath(input: RecommitChapterInput): string {
  return input.sourceType === 'final' ? relativeChapterArtifact(input.chapterNumber, 'final.md') : (input.patchPath ?? '');
}

async function nextVersionedChapterArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string
): Promise<{ version: number; relativePath: string; absolutePath: string }> {
  for (let version = 1; version < 1000; version += 1) {
    const fileName = `${baseName}_v${version}.json`;
    const absolutePath = paths.chapterArtifact(chapterNumber, fileName);
    if (!(await fileStore.exists(absolutePath))) {
      return {
        version,
        relativePath: relativeChapterArtifact(chapterNumber, fileName),
        absolutePath
      };
    }
  }
  throw new AppError('ARTIFACT_VERSION_EXHAUSTED', `Could not find available version for ${baseName}.`, 1);
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.posix.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, ...segments);
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}
