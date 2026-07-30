import path from 'node:path';

import { z } from 'zod';

import { ChapterQueueStore } from './chapterQueue.js';
import { blockCodexTextUnsafeOperation } from './codexTextSafety.js';
import { recordCommitJournalPhase, startCommitJournal } from './commitJournal.js';
import type { CommitJournalHandle } from './commitJournal.js';
import { injectFailure } from './pipelineFailure.js';
import type { FailureInjectionPoint } from './pipelineFailure.js';
import { withProjectChapterOperationLease } from './projectOperationLease.js';
import { ProviderFactory, type ProviderName } from '../llm/ProviderFactory.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { hashJson, RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import {
  CanonPatchSchema,
  CommitReportSchema,
  ConflictRepairReportSchema,
  ConflictReportSchema,
  ForeshadowingSchema,
  FailureReportSchema,
  NarrativeDebtSchema,
  PatchConflictReportSchema,
  PatchRepairPlanSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  CanonPatch,
  ChapterQueueStage,
  CommitReport,
  ConflictItem,
  ConflictRepairReport,
  ConflictReport,
  ConflictSeverity,
  FailureReport,
  PatchConflictReport,
  PatchRepairOperation,
  PatchRepairPlan,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { SnapshotStore } from '../storage/SnapshotStore.js';
import { AppError } from '../utils/AppError.js';

export interface ChapterCommitInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  provider?: ProviderName;
  promptRoot?: string;
  fixturesRoot?: string;
  runId?: string;
  forceStage?: ChapterQueueStage;
  failAt?: FailureInjectionPoint;
  mockScenario?: string;
  repairConflicts?: boolean;
  maxConflictRepairs?: number;
  regenerateStale?: boolean;
}

export interface AppliedChanges {
  canonFactsAdded: number;
  characterStatesUpserted: number;
  characterUpdatesApplied: number;
  timelineEventsAdded: number;
  readerStateChanges: number;
  narrativeDebtsChanged: number;
  foreshadowingChanged: number;
  relationshipEdgesChanged: number;
  latestCommittedChapter: {
    from: number;
    to: number;
  };
}

export interface ApplyCanonPatchResult {
  storyState: StoryState;
  appliedChanges: AppliedChanges;
}

export interface CommitChapterStateResult {
  status: 'committed' | 'needs_human_review';
  artifacts: string[];
  patch?: CanonPatch | undefined;
  report?: CommitReport | undefined;
  conflictReportPath?: string | undefined;
  repairPlanPath?: string | undefined;
  repairedPatchPath?: string | undefined;
  conflictRepairReportPath?: string | undefined;
  repaired?: boolean | undefined;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DEFAULT_FIXTURES_ROOT = './fixtures/llm';

const UnknownRecordSchema = z.record(z.string(), z.unknown());

export async function extractCanonPatch(input: ChapterCommitInput, fileStore = new FileStore()): Promise<CanonPatch> {
  const paths = createPaths(input);
  await ensureCommitPrerequisites(paths, fileStore, input.chapterNumber);

  const finalText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, 'final.md'));
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const promptService = createPromptService(input, fileStore);
  const llmClient = createLlmClient(input, paths, fileStore);
  const renderedPrompt = await promptService.renderPrompt('memory.extract_canon_patch', {
    CHAPTER_NUMBER: input.chapterNumber,
    SOURCE_FINAL_PATH: relativeChapterArtifact(input.chapterNumber, 'final.md'),
    STORY_STATE_JSON: JSON.stringify(storyState, null, 2),
    FINAL_MARKDOWN: finalText
  });
  const response = await llmClient.complete({
    promptId: 'memory.extract_canon_patch',
    system: 'Novel Loop Engine memory extraction module',
    user: renderedPrompt,
    responseFormat: 'json',
    metadata: {
      fixtureScenario: input.mockScenario ?? (input.regenerateStale === true ? `regenerate-stale-chapter-${input.chapterNumber}` : chapterFixtureScenario(input.chapterNumber))
    }
  });

  if (input.runId !== undefined) {
    await writePromptRunArtifacts(fileStore, paths, input.runId, 'memory.extract_canon_patch', renderedPrompt, response.text);
  }

  return fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, 'canon_patch.json'), response.json, CanonPatchSchema);
}

export async function validateCanonPatch(input: ChapterCommitInput, fileStore = new FileStore()): Promise<CanonPatch> {
  const paths = createPaths(input);
  const patch = await fileStore.readJson(paths.chapterArtifact(input.chapterNumber, 'canon_patch.json'), CanonPatchSchema);
  const expectedFinalPath = relativeChapterArtifact(input.chapterNumber, 'final.md');

  if (patch.chapterNumber !== input.chapterNumber) {
    throw new AppError('CANON_PATCH_CHAPTER_MISMATCH', `Canon patch chapter ${patch.chapterNumber} does not match ${input.chapterNumber}`, 2);
  }
  if (patch.sourceFinalPath !== expectedFinalPath) {
    throw new AppError('CANON_PATCH_SOURCE_MISMATCH', `Canon patch sourceFinalPath must be ${expectedFinalPath}`, 2);
  }

  return patch;
}

export function checkPatchConflicts(storyState: StoryState, patch: CanonPatch): PatchConflictReport {
  const conflicts = detectPatchConflictItems(storyState, patch);
  const hard = conflicts.filter((conflict) => conflict.blocking).map((conflict) => conflict.explanation);
  const warnings = conflicts.filter((conflict) => !conflict.blocking).map((conflict) => conflict.explanation);

  for (const fact of patch.newFacts) {
    if (fact.sourceChapter !== patch.chapterNumber) {
      hard.push(`Canon fact ${fact.id} sourceChapter ${fact.sourceChapter} does not match patch chapter ${patch.chapterNumber}.`);
    }
  }
  for (const event of patch.timelineEvents) {
    if (event.chapter !== patch.chapterNumber) {
      hard.push(`Timeline event ${event.id} chapter ${event.chapter} does not match patch chapter ${patch.chapterNumber}.`);
    }
  }

  return PatchConflictReportSchema.parse({ hard, warnings });
}

export async function applyCanonPatch(
  input: ChapterCommitInput,
  patch: CanonPatch,
  fileStore = new FileStore()
): Promise<ApplyCanonPatchResult> {
  const paths = createPaths(input);
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const applied = applyCanonPatchToStoryState(storyState, patch);
  await fileStore.writeJson(paths.storyState(), applied.storyState, StoryStateSchema);

  return applied;
}

export function applyCanonPatchToStoryState(storyState: StoryState, patch: CanonPatch): ApplyCanonPatchResult {
  const nextState: StoryState = structuredClone(storyState);
  const fromLatestCommittedChapter = nextState.latestCommittedChapter;
  const appliedChanges: AppliedChanges = {
    canonFactsAdded: patch.newFacts.length,
    characterStatesUpserted: patch.characterStates.length,
    characterUpdatesApplied: 0,
    timelineEventsAdded: patch.timelineEvents.length,
    readerStateChanges: countReaderStateChanges(patch),
    narrativeDebtsChanged: 0,
    foreshadowingChanged: 0,
    relationshipEdgesChanged: patch.relationshipUpdates.length,
    latestCommittedChapter: {
      from: fromLatestCommittedChapter,
      to: patch.latestCommittedChapter ?? patch.chapterNumber
    }
  };

  nextState.canonFacts.push(...patch.newFacts);
  upsertCharacters(nextState, patch, appliedChanges);
  nextState.timeline.push(...patch.timelineEvents);
  applyReaderStatePatch(nextState, patch);
  appliedChanges.narrativeDebtsChanged = applyNarrativeDebtUpdates(nextState, patch);
  appliedChanges.foreshadowingChanged = applyForeshadowingUpdates(nextState, patch);
  applyRelationshipUpdates(nextState, patch);
  nextState.latestCommittedChapter = patch.latestCommittedChapter ?? patch.chapterNumber;
  nextState.updatedAt = new Date().toISOString();

  const parsedState = StoryStateSchema.parse(nextState);

  return {
    storyState: parsedState,
    appliedChanges
  };
}

export async function commitChapterState(input: ChapterCommitInput, fileStore = new FileStore()): Promise<CommitChapterStateResult> {
  const paths = createPaths(input);
  return withProjectChapterOperationLease({
    projectRoot: paths.projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'chapter-commit',
    allowStoryStateWrite: true
  }, () => commitChapterStateWithinLease(input, fileStore));
}

async function commitChapterStateWithinLease(input: ChapterCommitInput, fileStore: FileStore): Promise<CommitChapterStateResult> {
  blockCodexTextUnsafeOperation({
    provider: input.provider,
    projectId: input.projectId,
    chapterNumber: input.chapterNumber,
    operation: 'chapter commit',
    suggestedNextCommand: `corepack pnpm novel-loop chapter ${input.projectId} ${input.chapterNumber} --provider codex-text --until draft`
  });
  const paths = createPaths(input);
  await ensureForceStageNotCommitted(input, paths, fileStore);
  const queueStore = new ChapterQueueStore(paths, fileStore);
  const snapshotStore = new SnapshotStore(paths, fileStore);
  const artifacts: string[] = [];
  let activeStage: ChapterQueueStage = 'canon_patch';
  let commitJournal: CommitJournalHandle | undefined;

  try {
    if (
      (await fileStore.exists(paths.chapterArtifact(input.chapterNumber, 'canon_patch.json'))) &&
      input.forceStage !== 'canon_patch' &&
      input.regenerateStale !== true
    ) {
      await validateCanonPatch(input, fileStore);
      await queueStore.markStageComplete(input.chapterNumber, 'patch_extracted', 'canon_patch', input.runId);
    } else {
      await queueStore.markStageStart(input.chapterNumber, 'final_ready', 'canon_patch', input.runId);
      injectFailure(input, 'extract_canon_patch');
      await extractCanonPatch(input, fileStore);
      await queueStore.markStageComplete(input.chapterNumber, 'patch_extracted', 'canon_patch', input.runId);
    }
    artifacts.push(relativeChapterArtifact(input.chapterNumber, 'canon_patch.json'));

    let patch = await validateCanonPatch(input, fileStore);
    let patchPath = relativeChapterArtifact(input.chapterNumber, 'canon_patch.json');
    let latestConflictReport = await readLatestConflictReport(paths, fileStore, input.chapterNumber);
    let conflictReportPath: string | undefined = latestConflictReport?.path;
    const existingRepairPlan = await findLatestVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'patch_repair_plan');
    let repairPlanPath: string | undefined = existingRepairPlan?.relativePath;
    let repairedPatchPath: string | undefined;
    let conflictRepairReportPath: string | undefined;
    let repaired = false;
    if (input.repairConflicts === true && input.forceStage !== 'canon_patch') {
      const existingRepairedPatch = await readLatestRepairedPatch(paths, fileStore, input.chapterNumber);
      if (existingRepairedPatch !== undefined) {
        patch = existingRepairedPatch.patch;
        patchPath = existingRepairedPatch.path;
        repairedPatchPath = existingRepairedPatch.path;
        repaired = true;
        appendUnique(artifacts, [existingRepairedPatch.path]);
      }
    }
    const storyStateBefore = await fileStore.readJson(paths.storyState(), StoryStateSchema);
    let conflicts = checkPatchConflicts(storyStateBefore, patch);
    if (conflicts.hard.length > 0) {
      const conflictReport =
        input.repairConflicts === true && latestConflictReport !== undefined && latestConflictReport.report.sourcePatchPath === patchPath
          ? latestConflictReport
          : await writeConflictReport(input, paths, fileStore, storyStateBefore, patch, patchPath);
      latestConflictReport = conflictReport;
      conflictReportPath = conflictReport.path;
      appendUnique(artifacts, [conflictReport.path]);

      if (input.repairConflicts !== true) {
        await queueStore.markBlocked(input.chapterNumber, 'commit', input.runId, `Canon patch conflict: ${conflicts.hard.join('; ')}`);
        throw createConflictError(input, conflictReport.report, conflictReport.path);
      }

      const repairOutcome = await repairPatchConflicts({
        input,
        paths,
        fileStore,
        storyStateBefore,
        originalPatch: patch,
        originalPatchPath: patchPath,
        conflictReport: conflictReport.report,
        conflictReportPath: conflictReport.path
      });
      artifacts.push(...repairOutcome.artifacts);
      repairPlanPath = repairOutcome.repairPlanPath;
      repairedPatchPath = repairOutcome.repairedPatchPath;
      conflictRepairReportPath = repairOutcome.conflictRepairReportPath;

      if (!repairOutcome.repaired || repairOutcome.repairedPatch === undefined || repairOutcome.repairedPatchPath === undefined) {
        await queueStore.markNeedsHumanReview(input.chapterNumber, 'commit', input.runId);
        return {
          status: 'needs_human_review',
          artifacts,
          patch,
          conflictReportPath,
          repairPlanPath,
          repairedPatchPath,
          conflictRepairReportPath,
          repaired: false
        };
      }

      patch = repairOutcome.repairedPatch;
      patchPath = repairOutcome.repairedPatchPath;
      conflicts = checkPatchConflicts(storyStateBefore, patch);
      if (conflicts.hard.length > 0) {
        await writeConflictHumanReviewArtifacts(input, paths, fileStore, {
          conflictReportPath,
          ...(repairPlanPath === undefined ? {} : { repairPlanPath }),
          ...(repairedPatchPath === undefined ? {} : { repairedPatchPath }),
          remainingConflictCount: conflicts.hard.length
        });
        const repairReport = await writeConflictRepairReport(input, paths, fileStore, {
          originalPatchPath: relativeChapterArtifact(input.chapterNumber, 'canon_patch.json'),
          conflictReportPath,
          ...(repairedPatchPath === undefined ? {} : { repairedPatchPath }),
          ...(repairPlanPath === undefined ? {} : { repairPlanPath }),
          repairAttempts: input.maxConflictRepairs ?? 1,
          repaired: false,
          remainingConflicts: detectPatchConflictItems(storyStateBefore, patch),
          committed: false
        });
        conflictRepairReportPath = repairReport.path;
        artifacts.push(repairReport.path, relativeChapterArtifact(input.chapterNumber, 'needs_human_review.md'), relativeChapterArtifact(input.chapterNumber, 'failure_report.json'));
        await queueStore.markNeedsHumanReview(input.chapterNumber, 'commit', input.runId);
        return {
          status: 'needs_human_review',
          artifacts,
          patch,
          conflictReportPath,
          repairPlanPath,
          repairedPatchPath,
          conflictRepairReportPath,
          repaired: false
        };
      }

      repaired = true;
    }

    activeStage = 'commit';
    if (repaired) {
      await queueStore.markStageComplete(input.chapterNumber, 'conflict_repaired', 'commit', input.runId);
    }
    await queueStore.markStageStart(input.chapterNumber, 'committing', 'commit', input.runId);
    injectFailure(input, 'commit');

    commitJournal = await startCommitJournal({
      paths,
      fileStore,
      chapterNumber: input.chapterNumber,
      commitKind: 'chapter_commit',
      provider: input.provider ?? 'mock',
      runId: input.runId,
      canonPatchPath: patchPath,
      latestCommittedChapterBefore: storyStateBefore.latestCommittedChapter,
      latestCommittedChapterAfter: patch.latestCommittedChapter ?? patch.chapterNumber
    });
    artifacts.push(commitJournal.relativePath);

    const beforeSnapshot = await snapshotStore.createSnapshot(storyStateBefore, {
      reason: `before_chapter_${formatChapterNumber(input.chapterNumber)}_commit`,
      sourceChapter: input.chapterNumber,
      ...(input.runId === undefined ? {} : { runId: input.runId })
    });
    if (input.runId !== undefined && (await fileStore.exists(paths.runManifest(input.runId)))) {
      await new RunLogger(paths, fileStore).recordSnapshot(input.runId, beforeSnapshot, storyStateBefore);
    }
    artifacts.push(relativeSnapshotArtifact(beforeSnapshot.path));
    await recordCommitJournalPhase(commitJournal, fileStore, 'before_snapshot_created', {
      beforeSnapshotId: beforeSnapshot.snapshotId
    });

    const applied = await applyCanonPatch(input, patch, fileStore);
    artifacts.push(path.join('state', 'story_state.json'));
    await recordCommitJournalPhase(commitJournal, fileStore, 'story_state_written', {
      stateWriteCompleted: true,
      latestCommittedChapterAfter: applied.storyState.latestCommittedChapter
    });
    injectFailure(input, 'post_state_write');

    const afterSnapshot = await snapshotStore.createSnapshot(applied.storyState, {
      reason: `after_chapter_${formatChapterNumber(input.chapterNumber)}_commit`,
      sourceChapter: input.chapterNumber,
      ...(input.runId === undefined ? {} : { runId: input.runId })
    });
    await recordCommitJournalPhase(commitJournal, fileStore, 'after_snapshot_created', {
      afterSnapshotId: afterSnapshot.snapshotId
    });
    if (input.runId !== undefined && (await fileStore.exists(paths.runManifest(input.runId)))) {
      const mutationType = input.regenerateStale === true ? 'regenerate_stale_commit' : 'apply_canon_patch';
      const runLogger = new RunLogger(paths, fileStore);
      await runLogger.recordSnapshot(input.runId, afterSnapshot, applied.storyState);
      await runLogger.recordStateMutation(input.runId, {
        mutationType,
        chapterNumber: input.chapterNumber,
        patchPath,
        beforeSnapshotId: beforeSnapshot.snapshotId,
        afterSnapshotId: afterSnapshot.snapshotId,
        beforeStateHash: hashJson(storyStateBefore),
        afterStateHash: hashJson(applied.storyState),
        latestCommittedChapterBefore: storyStateBefore.latestCommittedChapter,
        latestCommittedChapterAfter: applied.storyState.latestCommittedChapter,
        conflictCheckPassed: conflicts.hard.length === 0,
        schemaValidationPassed: true,
        applied: true
      });
    }
    await recordCommitJournalPhase(commitJournal, fileStore, 'state_mutation_recorded');
    artifacts.push(relativeSnapshotArtifact(afterSnapshot.path));

    if (repaired) {
      const finalRepairReport = await writeConflictRepairReport(input, paths, fileStore, {
        originalPatchPath: relativeChapterArtifact(input.chapterNumber, 'canon_patch.json'),
        ...(repairedPatchPath === undefined ? {} : { repairedPatchPath }),
        conflictReportPath: conflictReportPath ?? '',
        ...(repairPlanPath === undefined ? {} : { repairPlanPath }),
        repairAttempts: 1,
        repaired: true,
        remainingConflicts: [],
        committed: true
      });
      conflictRepairReportPath = finalRepairReport.path;
      artifacts.push(finalRepairReport.path);
    }

    const report: CommitReport = {
      chapterNumber: input.chapterNumber,
      status: 'committed',
      canonPatchPath: patchPath,
      storyStatePath: path.join('state', 'story_state.json'),
      beforeSnapshot,
      afterSnapshot,
      conflicts,
      repaired,
      originalPatchPath: relativeChapterArtifact(input.chapterNumber, 'canon_patch.json'),
      ...(repairedPatchPath === undefined ? {} : { repairedPatchPath }),
      ...(conflictReportPath === undefined ? {} : { conflictReportPath }),
      ...(conflictRepairReportPath === undefined ? {} : { conflictRepairReportPath }),
      appliedChanges: applied.appliedChanges,
      committedAt: new Date().toISOString()
    };
    const writtenReport = await fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, 'commit_report.json'), report, CommitReportSchema);
    artifacts.push(relativeChapterArtifact(input.chapterNumber, 'commit_report.json'));
    await recordCommitJournalPhase(commitJournal, fileStore, 'commit_report_written', {
      commitReportPath: relativeChapterArtifact(input.chapterNumber, 'commit_report.json')
    });
    await queueStore.markCommitted(input.chapterNumber, input.runId);
    await recordCommitJournalPhase(commitJournal, fileStore, 'queue_committed', { queueCommitted: true });
    await recordCommitJournalPhase(commitJournal, fileStore, 'completed');

    return {
      status: 'committed',
      artifacts,
      patch,
      report: writtenReport,
      conflictReportPath,
      repairPlanPath,
      repairedPatchPath,
      conflictRepairReportPath,
      repaired
    };
  } catch (error) {
    if (commitJournal !== undefined) {
      await recordCommitJournalPhase(commitJournal, fileStore, 'failed', {}, error instanceof Error ? error.message : String(error));
    }
    if (!(error instanceof AppError && error.code === 'CANON_PATCH_CONFLICT')) {
      await queueStore.markFailed(input.chapterNumber, activeStage, input.runId, error);
    }
    throw error;
  }
}

async function ensureForceStageNotCommitted(input: ChapterCommitInput, paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (input.forceStage === undefined) {
    return;
  }

  const state = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  if (input.chapterNumber <= state.latestCommittedChapter) {
    throw new AppError('FORCE_STAGE_COMMITTED_CHAPTER', `--force-stage cannot be used on committed chapter ${input.chapterNumber}.`, 2, {
      chapterNumber: input.chapterNumber,
      stage: input.forceStage,
      suggestedNextCommand: `novel-loop chapter ${input.projectId} next --provider mock --commit`
    });
  }
}

export function detectPatchConflictItems(storyState: StoryState, patch: CanonPatch): ConflictItem[] {
  const conflicts: ConflictItem[] = [];
  let sequence = 1;
  const nextId = (type: string) => `conflict_${String(sequence++).padStart(3, '0')}_${type.toLowerCase()}`;
  const addConflict = (conflict: Omit<ConflictItem, 'conflictId'>) => {
    conflicts.push({
      conflictId: nextId(conflict.conflictType),
      ...conflict
    });
  };

  if (patch.chapterNumber <= storyState.latestCommittedChapter) {
    addConflict({
      conflictType: 'PATCH_TARGET_ALREADY_COMMITTED',
      severity: 'critical',
      statePath: '/latestCommittedChapter',
      patchPath: '/chapterNumber',
      existingValue: storyState.latestCommittedChapter,
      proposedValue: patch.chapterNumber,
      explanation: `Patch targets chapter ${patch.chapterNumber}, but latestCommittedChapter is already ${storyState.latestCommittedChapter}.`,
      suggestedResolution: 'Do not recommit an already committed chapter without a future force-recommit workflow.',
      blocking: true,
      repairable: false
    });
  }

  if (storyState.latestCommittedChapter + 1 !== patch.chapterNumber) {
    addConflict({
      conflictType: 'CHAPTER_NUMBER_OUT_OF_ORDER',
      severity: 'critical',
      statePath: '/latestCommittedChapter',
      patchPath: '/chapterNumber',
      existingValue: storyState.latestCommittedChapter,
      proposedValue: patch.chapterNumber,
      explanation: `Chapter ${patch.chapterNumber} cannot be committed after latestCommittedChapter ${storyState.latestCommittedChapter}.`,
      suggestedResolution: 'Commit chapters sequentially or regenerate the patch for the correct next chapter.',
      blocking: true,
      repairable: false
    });
  }

  if (patch.latestCommittedChapter !== undefined && patch.latestCommittedChapter !== patch.chapterNumber) {
    addConflict({
      conflictType: 'CHAPTER_NUMBER_OUT_OF_ORDER',
      severity: 'critical',
      statePath: '/latestCommittedChapter',
      patchPath: '/latestCommittedChapter',
      existingValue: storyState.latestCommittedChapter,
      proposedValue: patch.latestCommittedChapter,
      explanation: `Patch latestCommittedChapter ${patch.latestCommittedChapter} must equal chapterNumber ${patch.chapterNumber}.`,
      suggestedResolution: 'Regenerate the patch with latestCommittedChapter equal to chapterNumber.',
      blocking: true,
      repairable: false
    });
  }

  const existingFactById = new Map(storyState.canonFacts.map((fact) => [fact.id, fact]));
  const seenPatchFacts = new Set<string>();
  patch.newFacts.forEach((fact, index) => {
    const existing = existingFactById.get(fact.id);
    if (existing !== undefined) {
      addConflict({
        conflictType: 'DUPLICATE_CANON_FACT_ID',
        severity: 'high',
        statePath: `/canonFacts/${fact.id}`,
        patchPath: `/newFacts/${index}/id`,
        existingValue: existing.id,
        proposedValue: fact.id,
        explanation: `Canon fact id ${fact.id} already exists in Story State.`,
        suggestedResolution: 'Rename the patch fact id and update local references.',
        blocking: true,
        repairable: true
      });
      if (existing.text !== fact.text) {
        addConflict({
          conflictType: 'CANON_FACT_OVERWRITE',
          severity: 'high',
          statePath: `/canonFacts/${fact.id}/text`,
          patchPath: `/newFacts/${index}/text`,
          existingValue: existing.text,
          proposedValue: fact.text,
          explanation: `Canon fact ${fact.id} proposes different text instead of appending a new fact.`,
          suggestedResolution: 'Preserve the existing fact and append the patch fact under a new id.',
          blocking: true,
          repairable: true
        });
      }
    }
    if (seenPatchFacts.has(fact.id)) {
      addConflict({
        conflictType: 'DUPLICATE_CANON_FACT_ID',
        severity: 'high',
        statePath: '/newFacts',
        patchPath: `/newFacts/${index}/id`,
        existingValue: fact.id,
        proposedValue: fact.id,
        explanation: `Canon fact id ${fact.id} appears more than once in the patch.`,
        suggestedResolution: 'Rename duplicate patch fact ids.',
        blocking: true,
        repairable: true
      });
    }
    seenPatchFacts.add(fact.id);
  });

  const existingCharacterById = new Map(storyState.characters.map((character) => [character.id, character]));
  patch.characterStates.forEach((character, index) => {
    const existing = existingCharacterById.get(character.id);
    if (existing !== undefined) {
      addConflict({
        conflictType: 'CHARACTER_STATE_CONFLICT',
        severity: 'high',
        statePath: `/characters/${character.id}`,
        patchPath: `/characterStates/${index}`,
        existingValue: {
          currentGoal: existing.currentGoal,
          emotionalState: existing.emotionalState
        },
        proposedValue: {
          currentGoal: character.currentGoal,
          emotionalState: character.emotionalState
        },
        explanation: `Patch tries to overwrite existing character state for ${character.id}.`,
        suggestedResolution: 'Convert whole-character replacement into targeted characterUpdates.',
        blocking: true,
        repairable: true
      });
    }

    character.knowledge.forEach((knowledge, knowledgeIndex) => {
      const patchFact = patch.newFacts.find((fact) => fact.id === knowledge.factId);
      const stateFact = storyState.canonFacts.find((fact) => fact.id === knowledge.factId);
      const characterAllowed =
        stateFact?.visibility.characters[character.id] === true || patchFact?.visibility.characters[character.id] === true;
      if (!characterAllowed) {
        addConflict({
          conflictType: 'CHARACTER_KNOWLEDGE_LEAK',
          severity: 'high',
          statePath: `/characters/${character.id}/knowledge`,
          patchPath: `/characterStates/${index}/knowledge/${knowledgeIndex}`,
          existingValue: null,
          proposedValue: knowledge,
          explanation: `Patch gives ${character.id} knowledge of ${knowledge.factId} before that character is allowed to know it.`,
          suggestedResolution: 'Remove leaked character knowledge or defer it to a later patch.',
          blocking: true,
          repairable: true
        });
      }
    });
  });

  const timelineEventsWithOrder = patch.timelineEvents.filter((event) => event.order !== undefined);
  for (let index = 1; index < timelineEventsWithOrder.length; index += 1) {
    const previous = timelineEventsWithOrder[index - 1]!;
    const current = timelineEventsWithOrder[index]!;
    if ((current.order ?? 0) <= (previous.order ?? 0)) {
      addConflict({
        conflictType: 'TIMELINE_ORDER_CONFLICT',
        severity: 'high',
        statePath: '/timeline',
        patchPath: '/timelineEvents',
        existingValue: previous,
        proposedValue: current,
        explanation: `Timeline event ${current.id} has order ${current.order}, which does not follow ${previous.id} order ${previous.order}.`,
        suggestedResolution: 'Sort timeline events into ascending chapter order before commit.',
        blocking: true,
        repairable: true
      });
      break;
    }
  }

  patch.narrativeDebtUpdates.forEach((update, index) => {
    const debt = update.debtId === undefined ? undefined : storyState.narrativeDebts.find((candidate) => candidate.id === update.debtId);
    if (update.action === 'create') {
      const parsed = NarrativeDebtSchema.safeParse(update.payload);
      if (!parsed.success) {
        addConflict({
          conflictType: 'UNKNOWN_PATCH_CONFLICT',
          severity: 'critical',
          statePath: '/narrativeDebts',
          patchPath: `/narrativeDebtUpdates/${index}/payload`,
          existingValue: null,
          proposedValue: update.payload,
          explanation: 'Narrative debt create payload must satisfy NarrativeDebtSchema.',
          suggestedResolution: 'Regenerate a schema-valid narrative debt payload.',
          blocking: true,
          repairable: false
        });
      } else if (storyState.narrativeDebts.some((existingDebt) => existingDebt.id === parsed.data.id)) {
        addConflict({
          conflictType: 'NARRATIVE_DEBT_INVALID_TRANSITION',
          severity: 'high',
          statePath: `/narrativeDebts/${parsed.data.id}`,
          patchPath: `/narrativeDebtUpdates/${index}`,
          existingValue: parsed.data.id,
          proposedValue: update.payload,
          explanation: `Narrative debt ${parsed.data.id} already exists and cannot be recreated.`,
          suggestedResolution: 'Convert the create into a status update or defer it.',
          blocking: true,
          repairable: true
        });
      }
      return;
    }
    if (debt === undefined) {
      return;
    }
    const targetStatus = narrativeDebtTargetStatus(update.action);
    if (targetStatus !== undefined && !isAllowedDebtTransition(debt.status, targetStatus)) {
      addConflict({
        conflictType: 'NARRATIVE_DEBT_INVALID_TRANSITION',
        severity: 'high',
        statePath: `/narrativeDebts/${debt.id}/status`,
        patchPath: `/narrativeDebtUpdates/${index}/action`,
        existingValue: debt.status,
        proposedValue: targetStatus,
        explanation: `Narrative debt ${debt.id} cannot transition from ${debt.status} to ${targetStatus}.`,
        suggestedResolution: 'Remove or defer the invalid debt transition.',
        blocking: true,
        repairable: true
      });
    }
  });

  patch.foreshadowingUpdates.forEach((update, index) => {
    const foreshadowing =
      update.foreshadowingId === undefined ? undefined : storyState.foreshadowing.find((candidate) => candidate.id === update.foreshadowingId);
    if (update.action === 'create') {
      const parsed = ForeshadowingSchema.safeParse(update.payload);
      if (!parsed.success) {
        addConflict({
          conflictType: 'UNKNOWN_PATCH_CONFLICT',
          severity: 'critical',
          statePath: '/foreshadowing',
          patchPath: `/foreshadowingUpdates/${index}/payload`,
          existingValue: null,
          proposedValue: update.payload,
          explanation: 'Foreshadowing create payload must satisfy ForeshadowingSchema.',
          suggestedResolution: 'Regenerate a schema-valid foreshadowing payload.',
          blocking: true,
          repairable: false
        });
      } else if (storyState.foreshadowing.some((existingForeshadowing) => existingForeshadowing.id === parsed.data.id)) {
        addConflict({
          conflictType: 'FORESHADOWING_INVALID_TRANSITION',
          severity: 'high',
          statePath: `/foreshadowing/${parsed.data.id}`,
          patchPath: `/foreshadowingUpdates/${index}`,
          existingValue: parsed.data.id,
          proposedValue: update.payload,
          explanation: `Foreshadowing ${parsed.data.id} already exists and cannot be recreated.`,
          suggestedResolution: 'Convert the create into a status update or defer it.',
          blocking: true,
          repairable: true
        });
      }
      return;
    }
    if (foreshadowing === undefined) {
      return;
    }
    const targetStatus = foreshadowingTargetStatus(update.action);
    if (targetStatus !== undefined && !isAllowedForeshadowingTransition(foreshadowing.status, targetStatus)) {
      addConflict({
        conflictType: 'FORESHADOWING_INVALID_TRANSITION',
        severity: 'high',
        statePath: `/foreshadowing/${foreshadowing.id}/status`,
        patchPath: `/foreshadowingUpdates/${index}/action`,
        existingValue: foreshadowing.status,
        proposedValue: targetStatus,
        explanation: `Foreshadowing ${foreshadowing.id} cannot transition from ${foreshadowing.status} to ${targetStatus}.`,
        suggestedResolution: 'Remove or defer the invalid foreshadowing transition.',
        blocking: true,
        repairable: true
      });
    }
  });

  patch.readerStatePatch.addKnows.forEach((knowledge, index) => {
    if (isReaderKnowledgeLeak(storyState, patch.chapterNumber, knowledge)) {
      addConflict({
        conflictType: 'READER_KNOWLEDGE_LEAK',
        severity: 'high',
        statePath: '/readerState',
        patchPath: `/readerStatePatch/addKnows/${index}`,
        existingValue: storyState.readerState.readerDoesNotKnow,
        proposedValue: knowledge,
        explanation: `Patch writes unrevealed information to reader_knows: ${knowledge}`,
        suggestedResolution: 'Move the item to reader_suspects or defer it.',
        blocking: true,
        repairable: true
      });
    }
  });

  return conflicts;
}

async function writeConflictReport(
  input: ChapterCommitInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  storyState: StoryState,
  patch: CanonPatch,
  sourcePatchPath: string
): Promise<{ path: string; report: ConflictReport }> {
  const conflicts = detectPatchConflictItems(storyState, patch);
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'conflict_report');
  const report: ConflictReport = {
    reportId: `conflict_report_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
    projectId: input.projectId,
    chapterNumber: input.chapterNumber,
    sourcePatchPath,
    generatedAt: new Date().toISOString(),
    conflicts
  };
  const written = await fileStore.writeJson(artifact.absolutePath, report, ConflictReportSchema);
  return { path: artifact.relativePath, report: written };
}

async function readLatestConflictReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number
): Promise<{ path: string; report: ConflictReport } | undefined> {
  const artifact = await findLatestVersionedChapterArtifact(paths, fileStore, chapterNumber, 'conflict_report');
  if (artifact === undefined) {
    return undefined;
  }
  const report = await fileStore.readJson(artifact.absolutePath, ConflictReportSchema);
  return {
    path: artifact.relativePath,
    report
  };
}

async function readLatestRepairedPatch(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number
): Promise<{ path: string; patch: CanonPatch } | undefined> {
  const artifact = await findLatestVersionedChapterArtifact(paths, fileStore, chapterNumber, 'canon_patch_repaired');
  if (artifact === undefined) {
    return undefined;
  }
  const patch = await fileStore.readJson(artifact.absolutePath, CanonPatchSchema);
  return {
    path: artifact.relativePath,
    patch
  };
}

interface RepairPatchConflictsInput {
  input: ChapterCommitInput;
  paths: ProjectPaths;
  fileStore: FileStore;
  storyStateBefore: StoryState;
  originalPatch: CanonPatch;
  originalPatchPath: string;
  conflictReport: ConflictReport;
  conflictReportPath: string;
}

interface RepairPatchConflictsResult {
  artifacts: string[];
  repaired: boolean;
  repairedPatch?: CanonPatch;
  repairPlanPath?: string;
  repairedPatchPath?: string;
  conflictRepairReportPath?: string;
}

async function repairPatchConflicts(context: RepairPatchConflictsInput): Promise<RepairPatchConflictsResult> {
  const maxRepairs = context.input.maxConflictRepairs ?? 1;
  const artifacts: string[] = [];

  if (maxRepairs <= 0) {
    await writeConflictHumanReviewArtifacts(context.input, context.paths, context.fileStore, {
      conflictReportPath: context.conflictReportPath,
      remainingConflictCount: context.conflictReport.conflicts.filter((conflict) => conflict.blocking).length
    });
    artifacts.push(relativeChapterArtifact(context.input.chapterNumber, 'needs_human_review.md'), relativeChapterArtifact(context.input.chapterNumber, 'failure_report.json'));
    const repairReport = await writeConflictRepairReport(context.input, context.paths, context.fileStore, {
      originalPatchPath: context.originalPatchPath,
      conflictReportPath: context.conflictReportPath,
      repairAttempts: 0,
      repaired: false,
      remainingConflicts: context.conflictReport.conflicts,
      committed: false
    });
    artifacts.push(repairReport.path);
    return {
      artifacts,
      repaired: false,
      conflictRepairReportPath: repairReport.path
    };
  }

  const repairPlanArtifact = await nextVersionedChapterArtifact(context.paths, context.fileStore, context.input.chapterNumber, 'patch_repair_plan');
  const repairPlan = createPatchRepairPlan(context.input, context.conflictReport, context.conflictReportPath, context.originalPatchPath, repairPlanArtifact.version);
  const writtenPlan = await context.fileStore.writeJson(repairPlanArtifact.absolutePath, repairPlan, PatchRepairPlanSchema);
  artifacts.push(repairPlanArtifact.relativePath);

  if (writtenPlan.unrepairableConflicts.length > 0) {
    await writeConflictHumanReviewArtifacts(context.input, context.paths, context.fileStore, {
      conflictReportPath: context.conflictReportPath,
      repairPlanPath: repairPlanArtifact.relativePath,
      remainingConflictCount: writtenPlan.unrepairableConflicts.length
    });
    artifacts.push(relativeChapterArtifact(context.input.chapterNumber, 'needs_human_review.md'), relativeChapterArtifact(context.input.chapterNumber, 'failure_report.json'));
    const repairReport = await writeConflictRepairReport(context.input, context.paths, context.fileStore, {
      originalPatchPath: context.originalPatchPath,
      conflictReportPath: context.conflictReportPath,
      repairPlanPath: repairPlanArtifact.relativePath,
      repairAttempts: 1,
      repaired: false,
      remainingConflicts: context.conflictReport.conflicts.filter((conflict) => writtenPlan.unrepairableConflicts.includes(conflict.conflictId)),
      committed: false
    });
    artifacts.push(repairReport.path);
    return {
      artifacts,
      repaired: false,
      repairPlanPath: repairPlanArtifact.relativePath,
      conflictRepairReportPath: repairReport.path
    };
  }

  if (context.input.mockScenario === 'patch-conflict-malformed-repair') {
    await writeConflictHumanReviewArtifacts(context.input, context.paths, context.fileStore, {
      conflictReportPath: context.conflictReportPath,
      repairPlanPath: repairPlanArtifact.relativePath,
      remainingConflictCount: context.conflictReport.conflicts.length
    });
    artifacts.push(relativeChapterArtifact(context.input.chapterNumber, 'needs_human_review.md'), relativeChapterArtifact(context.input.chapterNumber, 'failure_report.json'));
    const repairReport = await writeConflictRepairReport(context.input, context.paths, context.fileStore, {
      originalPatchPath: context.originalPatchPath,
      conflictReportPath: context.conflictReportPath,
      repairPlanPath: repairPlanArtifact.relativePath,
      repairAttempts: 1,
      repaired: false,
      remainingConflicts: context.conflictReport.conflicts,
      committed: false
    });
    artifacts.push(repairReport.path);
    return {
      artifacts,
      repaired: false,
      repairPlanPath: repairPlanArtifact.relativePath,
      conflictRepairReportPath: repairReport.path
    };
  }

  const repairedPatchCandidate =
    context.input.mockScenario === 'patch-conflict-still-conflicting'
      ? structuredClone(context.originalPatch)
      : applyRepairPlan(context.originalPatch, context.conflictReport, writtenPlan, context.storyStateBefore);
  const parsedRepairedPatch = CanonPatchSchema.safeParse(repairedPatchCandidate);
  if (!parsedRepairedPatch.success) {
    await writeConflictHumanReviewArtifacts(context.input, context.paths, context.fileStore, {
      conflictReportPath: context.conflictReportPath,
      repairPlanPath: repairPlanArtifact.relativePath,
      remainingConflictCount: context.conflictReport.conflicts.length
    });
    artifacts.push(relativeChapterArtifact(context.input.chapterNumber, 'needs_human_review.md'), relativeChapterArtifact(context.input.chapterNumber, 'failure_report.json'));
    const repairReport = await writeConflictRepairReport(context.input, context.paths, context.fileStore, {
      originalPatchPath: context.originalPatchPath,
      conflictReportPath: context.conflictReportPath,
      repairPlanPath: repairPlanArtifact.relativePath,
      repairAttempts: 1,
      repaired: false,
      remainingConflicts: context.conflictReport.conflicts,
      committed: false
    });
    artifacts.push(repairReport.path);
    return {
      artifacts,
      repaired: false,
      repairPlanPath: repairPlanArtifact.relativePath,
      conflictRepairReportPath: repairReport.path
    };
  }

  const repairedPatchArtifact = await nextVersionedChapterArtifact(context.paths, context.fileStore, context.input.chapterNumber, 'canon_patch_repaired');
  const repairedPatch = await context.fileStore.writeJson(repairedPatchArtifact.absolutePath, parsedRepairedPatch.data, CanonPatchSchema);
  artifacts.push(repairedPatchArtifact.relativePath);

  return {
    artifacts,
    repaired: true,
    repairedPatch,
    repairPlanPath: repairPlanArtifact.relativePath,
    repairedPatchPath: repairedPatchArtifact.relativePath
  };
}

function createPatchRepairPlan(
  input: ChapterCommitInput,
  conflictReport: ConflictReport,
  conflictReportPath: string,
  sourcePatchPath: string,
  version: number
): PatchRepairPlan {
  const operations: PatchRepairOperation[] = [];
  const unrepairableConflicts: string[] = [];

  conflictReport.conflicts.forEach((conflict, index) => {
    const operationType = operationTypeForConflict(conflict);
    if (!conflict.repairable || operationType === 'no_auto_repair' || (conflict.severity === 'critical' && !isCriticalConflictSafelyRepairable(conflict))) {
      unrepairableConflicts.push(conflict.conflictId);
    }
    operations.push({
      operationId: `repair_op_${String(index + 1).padStart(3, '0')}`,
      conflictId: conflict.conflictId,
      operationType,
      targetPath: conflict.patchPath,
      reason: conflict.explanation,
      instruction: conflict.suggestedResolution,
      expectedEffect: operationType === 'no_auto_repair' ? 'Block automatic commit and require human review.' : 'Produce a schema-valid repaired canon patch.'
    });
  });

  return {
    repairPlanId: `patch_repair_plan_ch${formatChapterNumber(input.chapterNumber)}_v${version}`,
    projectId: input.projectId,
    chapterNumber: input.chapterNumber,
    sourceConflictReportPath: conflictReportPath,
    sourcePatchPath,
    strategy: unrepairableConflicts.length > 0 ? 'require_human_review' : inferRepairStrategy(conflictReport.conflicts),
    operations,
    unrepairableConflicts,
    generatedAt: new Date().toISOString()
  };
}

function applyRepairPlan(patch: CanonPatch, conflictReport: ConflictReport, repairPlan: PatchRepairPlan, storyState: StoryState): CanonPatch {
  const repaired = structuredClone(patch);
  const existingFactIds = new Set(storyState.canonFacts.map((fact) => fact.id));
  const renamedFacts = new Map<string, string>();

  if (repairPlan.operations.some((operation) => operation.operationType === 'rename_patch_id')) {
    repaired.newFacts = repaired.newFacts.map((fact) => {
      if (!existingFactIds.has(fact.id)) {
        return fact;
      }
      const renamed = `${fact.id}_repair_ch${formatChapterNumber(patch.chapterNumber)}`;
      renamedFacts.set(fact.id, renamed);
      return {
        ...fact,
        id: renamed
      };
    });
  }

  if (renamedFacts.size > 0) {
    repaired.characterStates = repaired.characterStates.map((character) => ({
      ...character,
      knowledge: character.knowledge.map((knowledge) =>
        knowledge.factId !== undefined && renamedFacts.has(knowledge.factId) ? { ...knowledge, factId: renamedFacts.get(knowledge.factId)! } : knowledge
      )
    }));
  }

  if (repairPlan.operations.some((operation) => operation.operationType === 'append_without_overwrite')) {
    repaired.timelineEvents = [...repaired.timelineEvents]
      .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER))
      .map((event, index) => ({
        ...event,
        order: index + 1
      }));
  }

  if (repairPlan.operations.some((operation) => operation.operationType === 'mark_existing_as_superseded')) {
    const existingCharacters = new Map(storyState.characters.map((character) => [character.id, character]));
    const convertedUpdates: CanonPatch['characterUpdates'] = [];
    repaired.characterStates = repaired.characterStates.filter((character) => {
      const existing = existingCharacters.get(character.id);
      if (existing === undefined) {
        return true;
      }
      for (const field of ['currentGoal', 'emotionalState', 'physicalState', 'publicDescription', 'desire', 'fear', 'flaw'] as const) {
        if (typeof character[field] === 'string' && character[field] !== existing[field]) {
          convertedUpdates.push({
            characterId: character.id,
            field,
            oldValueSummary: String(existing[field] ?? ''),
            newValue: character[field],
            reason: 'Converted from whole-character overwrite during conflict repair.'
          });
        }
      }
      return false;
    });
    repaired.characterUpdates = [...repaired.characterUpdates, ...convertedUpdates];
  }

  if (repairPlan.operations.some((operation) => operation.operationType === 'defer_patch_item')) {
    const invalidDebtIds = new Set(
      conflictReport.conflicts
        .filter((conflict) => conflict.conflictType === 'NARRATIVE_DEBT_INVALID_TRANSITION')
        .map((conflict) => pathSegmentFromStatePath(conflict.statePath))
    );
    repaired.narrativeDebtUpdates = repaired.narrativeDebtUpdates.filter((update) => update.debtId === undefined || !invalidDebtIds.has(update.debtId));

    const invalidForeshadowingIds = new Set(
      conflictReport.conflicts
        .filter((conflict) => conflict.conflictType === 'FORESHADOWING_INVALID_TRANSITION')
        .map((conflict) => pathSegmentFromStatePath(conflict.statePath))
    );
    repaired.foreshadowingUpdates = repaired.foreshadowingUpdates.filter(
      (update) => update.foreshadowingId === undefined || !invalidForeshadowingIds.has(update.foreshadowingId)
    );
  }

  if (repairPlan.operations.some((operation) => operation.operationType === 'remove_unplanned_reveal')) {
    const leakedFactIds = new Set(
      conflictReport.conflicts
        .filter((conflict) => conflict.conflictType === 'CHARACTER_KNOWLEDGE_LEAK')
        .map((conflict) => {
          const proposed = UnknownRecordSchema.safeParse(conflict.proposedValue);
          return proposed.success && typeof proposed.data.factId === 'string' ? proposed.data.factId : undefined;
        })
        .filter((value): value is string => value !== undefined)
    );
    repaired.characterStates = repaired.characterStates.map((character) => ({
      ...character,
      knowledge: character.knowledge.filter((knowledge) => knowledge.factId === undefined || !leakedFactIds.has(knowledge.factId))
    }));
  }

  if (repairPlan.operations.some((operation) => operation.operationType === 'convert_to_reader_suspicion')) {
    const leakedReaderKnowledge = conflictReport.conflicts
      .filter((conflict) => conflict.conflictType === 'READER_KNOWLEDGE_LEAK')
      .map((conflict) => conflict.proposedValue)
      .filter((value): value is string => typeof value === 'string');
    repaired.readerStatePatch.addKnows = repaired.readerStatePatch.addKnows.filter((item) => !leakedReaderKnowledge.includes(item));
    repaired.readerStatePatch.addSuspects = [...new Set([...repaired.readerStatePatch.addSuspects, ...leakedReaderKnowledge])];
  }

  return repaired;
}

async function writeConflictRepairReport(
  input: ChapterCommitInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  reportInput: {
    originalPatchPath: string;
    repairedPatchPath?: string;
    conflictReportPath: string;
    repairPlanPath?: string;
    repairAttempts: number;
    repaired: boolean;
    remainingConflicts: ConflictItem[];
    committed: boolean;
  }
): Promise<{ path: string; report: ConflictRepairReport }> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'conflict_repair_report');
  const report: ConflictRepairReport = {
    repairReportId: `conflict_repair_report_ch${formatChapterNumber(input.chapterNumber)}_v${artifact.version}`,
    projectId: input.projectId,
    chapterNumber: input.chapterNumber,
    originalPatchPath: reportInput.originalPatchPath,
    ...(reportInput.repairedPatchPath === undefined ? {} : { repairedPatchPath: reportInput.repairedPatchPath }),
    conflictReportPath: reportInput.conflictReportPath,
    ...(reportInput.repairPlanPath === undefined ? {} : { repairPlanPath: reportInput.repairPlanPath }),
    repairAttempts: reportInput.repairAttempts,
    repaired: reportInput.repaired,
    remainingConflicts: reportInput.remainingConflicts,
    committed: reportInput.committed,
    generatedAt: new Date().toISOString()
  };
  const written = await fileStore.writeJson(artifact.absolutePath, report, ConflictRepairReportSchema);
  return { path: artifact.relativePath, report: written };
}

async function writeConflictHumanReviewArtifacts(
  input: ChapterCommitInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  details: {
    conflictReportPath: string;
    repairPlanPath?: string;
    repairedPatchPath?: string;
    remainingConflictCount: number;
  }
): Promise<void> {
  const reviewText = [
    `# Human Review Required: Chapter ${formatChapterNumber(input.chapterNumber)}`,
    '',
    `Reason: conflict_repair_failed`,
    `Conflict report: ${details.conflictReportPath}`,
    details.repairPlanPath === undefined ? undefined : `Repair plan: ${details.repairPlanPath}`,
    details.repairedPatchPath === undefined ? undefined : `Repaired patch: ${details.repairedPatchPath}`,
    `Remaining conflicts: ${details.remainingConflictCount}`
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
  const failureReport: FailureReport = {
    chapterNumber: input.chapterNumber,
    finalDraftVersion: 1,
    maxRevisions: input.maxConflictRepairs ?? 0,
    reason: 'conflict_repair_failed',
    failedDiagnosticsPath: '',
    hardCheckFailures: [],
    softScoreAverage: 0,
    threshold: 0,
    conflictReportPath: details.conflictReportPath,
    ...(details.repairPlanPath === undefined ? {} : { repairPlanPath: details.repairPlanPath }),
    ...(details.repairedPatchPath === undefined ? {} : { repairedPatchPath: details.repairedPatchPath }),
    remainingConflictCount: details.remainingConflictCount,
    createdAt: new Date().toISOString()
  };

  await fileStore.writeText(paths.chapterArtifact(input.chapterNumber, 'needs_human_review.md'), `${reviewText}\n`);
  await fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, 'failure_report.json'), failureReport, FailureReportSchema);
}

async function nextVersionedChapterArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string
): Promise<{ version: number; fileName: string; relativePath: string; absolutePath: string }> {
  for (let version = 1; version < 1000; version += 1) {
    const fileName = `${baseName}_v${version}.json`;
    const absolutePath = paths.chapterArtifact(chapterNumber, fileName);
    if (!(await fileStore.exists(absolutePath))) {
      return {
        version,
        fileName,
        relativePath: relativeChapterArtifact(chapterNumber, fileName),
        absolutePath
      };
    }
  }
  throw new AppError('ARTIFACT_VERSION_EXHAUSTED', `Could not find available version for ${baseName}.`, 1);
}

async function findLatestVersionedChapterArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string
): Promise<{ version: number; fileName: string; relativePath: string; absolutePath: string } | undefined> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) {
    return undefined;
  }

  const pattern = new RegExp(`^${escapeRegExp(baseName)}_v(\\d+)\\.json$`);
  const latest = (await fileStore.list(chapterDir))
    .map((fileName) => {
      const match = pattern.exec(fileName);
      return match === null
        ? undefined
        : {
            version: Number.parseInt(match[1]!, 10),
            fileName
          };
    })
    .filter((entry): entry is { version: number; fileName: string } => entry !== undefined)
    .sort((left, right) => right.version - left.version)[0];

  if (latest === undefined) {
    return undefined;
  }

  return {
    ...latest,
    relativePath: relativeChapterArtifact(chapterNumber, latest.fileName),
    absolutePath: paths.chapterArtifact(chapterNumber, latest.fileName)
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createConflictError(input: ChapterCommitInput, report: ConflictReport, conflictReportPath: string): AppError {
  const blockingConflicts = report.conflicts.filter((conflict) => conflict.blocking);
  return new AppError('CANON_PATCH_CONFLICT', `Canon patch has ${blockingConflicts.length} blocking conflict(s).`, 2, {
    chapterNumber: input.chapterNumber,
    stage: 'commit',
    conflictCount: report.conflicts.length,
    highestSeverity: highestSeverity(report.conflicts),
    conflictReportPath,
    repairableCount: report.conflicts.filter((conflict) => conflict.repairable).length,
    unrepairableCount: report.conflicts.filter((conflict) => !conflict.repairable).length,
    suggestedNextCommand: `corepack pnpm novel-loop chapter ${input.projectId} next --provider mock --resume --repair-conflicts --max-conflict-repairs ${input.maxConflictRepairs ?? 2} --commit`
  });
}

function operationTypeForConflict(conflict: ConflictItem): PatchRepairOperation['operationType'] {
  switch (conflict.conflictType) {
    case 'DUPLICATE_CANON_FACT_ID':
    case 'CANON_FACT_OVERWRITE':
      return 'rename_patch_id';
    case 'TIMELINE_ORDER_CONFLICT':
      return 'append_without_overwrite';
    case 'CHARACTER_STATE_CONFLICT':
      return 'mark_existing_as_superseded';
    case 'CHARACTER_KNOWLEDGE_LEAK':
      return 'remove_unplanned_reveal';
    case 'READER_KNOWLEDGE_LEAK':
      return 'convert_to_reader_suspicion';
    case 'NARRATIVE_DEBT_INVALID_TRANSITION':
    case 'FORESHADOWING_INVALID_TRANSITION':
      return 'defer_patch_item';
    default:
      return 'no_auto_repair';
  }
}

function inferRepairStrategy(conflicts: ConflictItem[]): PatchRepairPlan['strategy'] {
  if (conflicts.some((conflict) => conflict.conflictType === 'DUPLICATE_CANON_FACT_ID' || conflict.conflictType === 'CANON_FACT_OVERWRITE')) {
    return 'rename_ids';
  }
  if (conflicts.some((conflict) => conflict.conflictType === 'TIMELINE_ORDER_CONFLICT')) {
    return 'merge_append';
  }
  if (conflicts.some((conflict) => conflict.conflictType === 'READER_KNOWLEDGE_LEAK')) {
    return 'defer_reveal';
  }
  return 'preserve_state';
}

function isCriticalConflictSafelyRepairable(conflict: ConflictItem): boolean {
  return conflict.conflictType === 'DUPLICATE_CANON_FACT_ID' || conflict.conflictType === 'CANON_FACT_OVERWRITE';
}

function highestSeverity(conflicts: ConflictItem[]): ConflictSeverity {
  const order: ConflictSeverity[] = ['low', 'medium', 'high', 'critical'];
  return conflicts.reduce<ConflictSeverity>((highest, conflict) => (order.indexOf(conflict.severity) > order.indexOf(highest) ? conflict.severity : highest), 'low');
}

function narrativeDebtTargetStatus(action: CanonPatch['narrativeDebtUpdates'][number]['action']): string | undefined {
  switch (action) {
    case 'escalate':
      return 'escalated';
    case 'partially_pay':
      return 'partially_paid';
    case 'pay':
      return 'resolved';
    case 'cancel':
      return 'cancelled';
    default:
      return undefined;
  }
}

function isAllowedDebtTransition(from: string, to: string): boolean {
  if (from === to) {
    return true;
  }
  if (from === 'open') {
    return ['partially_paid', 'escalated', 'resolved'].includes(to);
  }
  if (from === 'escalated') {
    return ['partially_paid', 'resolved'].includes(to);
  }
  if (from === 'partially_paid') {
    return ['resolved', 'escalated'].includes(to);
  }
  if (from === 'resolved' || from === 'paid') {
    return to === 'resolved' || to === 'paid';
  }
  return false;
}

function foreshadowingTargetStatus(action: CanonPatch['foreshadowingUpdates'][number]['action']): string | undefined {
  switch (action) {
    case 'reinforce':
      return 'reinforced';
    case 'partially_pay':
      return 'partially_paid';
    case 'pay':
      return 'resolved';
    case 'abandon':
      return 'abandoned';
    default:
      return undefined;
  }
}

function isAllowedForeshadowingTransition(from: string, to: string): boolean {
  if (from === to) {
    return true;
  }
  if (from === 'unresolved') {
    return ['reinforced', 'partially_paid', 'resolved'].includes(to);
  }
  if (from === 'reinforced') {
    return ['partially_paid', 'resolved'].includes(to);
  }
  if (from === 'partially_paid') {
    return ['reinforced', 'resolved'].includes(to);
  }
  if (from === 'resolved' || from === 'paid') {
    return to === 'resolved' || to === 'paid';
  }
  return false;
}

function isReaderKnowledgeLeak(storyState: StoryState, chapterNumber: number, knowledge: string): boolean {
  if (storyState.readerState.readerDoesNotKnow.some((unknown) => sameLooseText(unknown, knowledge))) {
    return true;
  }
  return storyState.revealSchedule.some((reveal) => {
    const textMatches = sameLooseText(reveal.truth, knowledge);
    if (!textMatches || reveal.currentStage === 'revealed') {
      return false;
    }
    if (reveal.forbiddenBeforeChapter !== undefined && chapterNumber < reveal.forbiddenBeforeChapter) {
      return true;
    }
    return chapterNumber < reveal.plannedRevealWindow.startChapter;
  });
}

function sameLooseText(left: string, right: string): boolean {
  return left.includes(right) || right.includes(left);
}

function pathSegmentFromStatePath(statePath: string): string {
  const parts = statePath.split('/').filter((part) => part.length > 0);
  return parts[1] ?? '';
}

function createPaths(input: Pick<ChapterCommitInput, 'projectId' | 'projectsRoot'>): ProjectPaths {
  return new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
}

function createPromptService(input: Pick<ChapterCommitInput, 'promptRoot'>, fileStore: FileStore): PromptService {
  return new PromptService(input.promptRoot ?? DEFAULT_PROMPT_ROOT, fileStore);
}

function createLlmClient(input: Pick<ChapterCommitInput, 'provider' | 'fixturesRoot' | 'runId'>, paths: ProjectPaths, fileStore: FileStore) {
  return ProviderFactory.create({
    provider: input.provider ?? 'mock',
    fixturesRoot: input.fixturesRoot ?? DEFAULT_FIXTURES_ROOT,
    ...(input.runId === undefined
      ? {}
      : {
          telemetry: {
            paths,
            runId: input.runId,
            fileStore
          }
        })
  });
}

async function ensureCommitPrerequisites(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  if (!(await fileStore.exists(paths.projectRoot))) {
    throw new AppError('PROJECT_NOT_FOUND', `Project not found: ${paths.projectRoot}`, 2);
  }
  if (!(await fileStore.exists(paths.storyState()))) {
    throw new AppError('STORY_STATE_NOT_FOUND', `Story State not found: ${paths.storyState()}`, 2);
  }
  if (!(await fileStore.exists(paths.chapterArtifact(chapterNumber, 'final.md')))) {
    throw new AppError('FINAL_NOT_FOUND', `final.md not found for chapter ${chapterNumber}`, 2);
  }
}

function addDuplicateIdConflicts(hard: string[], label: string, existingIds: string[], incomingIds: string[]): void {
  const existing = new Set(existingIds);
  const seenIncoming = new Set<string>();

  for (const incomingId of incomingIds) {
    if (existing.has(incomingId)) {
      hard.push(`${label} ${incomingId} already exists.`);
    }
    if (seenIncoming.has(incomingId)) {
      hard.push(`${label} ${incomingId} appears more than once in patch.`);
    }
    seenIncoming.add(incomingId);
  }
}

function upsertCharacters(storyState: StoryState, patch: CanonPatch, appliedChanges: AppliedChanges): void {
  for (const characterState of patch.characterStates) {
    const existingIndex = storyState.characters.findIndex((character) => character.id === characterState.id);
    if (existingIndex === -1) {
      storyState.characters.push(characterState);
    } else {
      storyState.characters[existingIndex] = characterState;
    }
  }

  for (const update of patch.characterUpdates) {
    const character = storyState.characters.find((candidate) => candidate.id === update.characterId);
    if (character === undefined) {
      continue;
    }

    if (applyKnownCharacterField(character, update.field, update.newValue)) {
      appliedChanges.characterUpdatesApplied += 1;
    }
  }
}

function applyKnownCharacterField(character: StoryState['characters'][number], field: string, newValue: unknown): boolean {
  if (typeof newValue !== 'string') {
    return false;
  }

  switch (field) {
    case 'currentGoal':
      character.currentGoal = newValue;
      return true;
    case 'emotionalState':
      character.emotionalState = newValue;
      return true;
    case 'physicalState':
      character.physicalState = newValue;
      return true;
    case 'publicDescription':
      character.publicDescription = newValue;
      return true;
    case 'desire':
      character.desire = newValue;
      return true;
    case 'fear':
      character.fear = newValue;
      return true;
    case 'flaw':
      character.flaw = newValue;
      return true;
    default:
      return false;
  }
}

function applyReaderStatePatch(storyState: StoryState, patch: CanonPatch): void {
  appendUnique(storyState.readerState.readerKnows, patch.readerStatePatch.addKnows);
  appendUnique(storyState.readerState.readerSuspects, patch.readerStatePatch.addSuspects);
  appendUnique(storyState.readerState.readerQuestions, patch.readerStatePatch.addQuestions);
  appendUnique(storyState.readerState.readerExpectations, patch.readerStatePatch.addExpectations);
  appendUnique(storyState.readerState.readerDoesNotKnow, patch.readerStatePatch.addDoesNotKnow);
  storyState.readerState.readerQuestions = storyState.readerState.readerQuestions.filter(
    (question) => !patch.readerStatePatch.removeQuestions.includes(question)
  );
}

function applyNarrativeDebtUpdates(storyState: StoryState, patch: CanonPatch): number {
  let changed = 0;

  for (const update of patch.narrativeDebtUpdates) {
    if (update.action === 'create') {
      storyState.narrativeDebts.push(NarrativeDebtSchema.parse(update.payload));
      changed += 1;
      continue;
    }

    if (update.debtId === undefined) {
      continue;
    }
    const debt = storyState.narrativeDebts.find((candidate) => candidate.id === update.debtId);
    if (debt === undefined) {
      continue;
    }

    if (update.action === 'pay') {
      debt.status = 'resolved';
    } else if (update.action === 'partially_pay') {
      debt.status = 'partially_paid';
    } else if (update.action === 'escalate') {
      debt.status = 'escalated';
    } else if (update.action === 'cancel') {
      debt.status = 'cancelled';
    }

    const payload = UnknownRecordSchema.safeParse(update.payload);
    if (payload.success && typeof payload.data.payoffTargetChapter === 'number') {
      debt.payoffTargetChapter = payload.data.payoffTargetChapter;
    }
    if (payload.success && Array.isArray(payload.data.payoffHistory)) {
      for (const entry of payload.data.payoffHistory) {
        debt.payoffHistory.push(entry);
      }
    }
    changed += 1;
  }

  return changed;
}

function applyForeshadowingUpdates(storyState: StoryState, patch: CanonPatch): number {
  let changed = 0;

  for (const update of patch.foreshadowingUpdates) {
    if (update.action === 'create') {
      storyState.foreshadowing.push(ForeshadowingSchema.parse(update.payload));
      changed += 1;
      continue;
    }

    if (update.foreshadowingId === undefined) {
      continue;
    }
    const foreshadowing = storyState.foreshadowing.find((candidate) => candidate.id === update.foreshadowingId);
    if (foreshadowing === undefined) {
      continue;
    }

    if (update.action === 'pay') {
      foreshadowing.status = 'resolved';
    } else if (update.action === 'reinforce') {
      foreshadowing.status = 'reinforced';
    } else if (update.action === 'partially_pay') {
      foreshadowing.status = 'partially_paid';
    } else if (update.action === 'abandon') {
      foreshadowing.status = 'abandoned';
    }
    const payload = UnknownRecordSchema.safeParse(update.payload);
    if (payload.success && typeof payload.data.payoffText === 'string') {
      foreshadowing.payoffText = payload.data.payoffText;
    }
    changed += 1;
  }

  return changed;
}

function applyRelationshipUpdates(storyState: StoryState, patch: CanonPatch): void {
  for (const update of patch.relationshipUpdates) {
    ensureRelationshipNode(storyState, update.fromCharacterId);
    ensureRelationshipNode(storyState, update.toCharacterId);
    storyState.relationshipGraph.edges.push({
      fromCharacterId: update.fromCharacterId,
      toCharacterId: update.toCharacterId,
      relationship: update.change,
      status: 'active',
      evidence: update.evidence
    });
  }
}

function ensureRelationshipNode(storyState: StoryState, characterId: string): void {
  if (!storyState.relationshipGraph.nodes.some((node) => node.characterId === characterId)) {
    storyState.relationshipGraph.nodes.push({
      characterId
    });
  }
}

function appendUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function countReaderStateChanges(patch: CanonPatch): number {
  return (
    patch.readerStatePatch.addKnows.length +
    patch.readerStatePatch.addSuspects.length +
    patch.readerStatePatch.addQuestions.length +
    patch.readerStatePatch.removeQuestions.length +
    patch.readerStatePatch.addExpectations.length +
    patch.readerStatePatch.addDoesNotKnow.length
  );
}

function relativeSnapshotArtifact(snapshotPath: string): string {
  return path.join('snapshots', path.basename(snapshotPath));
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, ...segments);
}

function chapterFixtureScenario(chapterNumber: number): string {
  return chapterNumber === 1 ? 'default' : `chapter_${formatChapterNumber(chapterNumber)}`;
}
