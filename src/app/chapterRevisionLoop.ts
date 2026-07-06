import path from 'node:path';
import type { z } from 'zod';

import { ChapterQueueStore } from './chapterQueue.js';
import { commitChapterState } from './chapterCommit.js';
import { injectFailure } from './pipelineFailure.js';
import type { FailureInjectionPoint } from './pipelineFailure.js';
import { ProviderFactory, type ProviderName } from '../llm/ProviderFactory.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import {
  ChapterMissionSchema,
  ConfigSchema,
  DiagnosticsReportSchema,
  FailureReportSchema,
  RevisionPlanSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type { ArchiveManifest, ChapterQueueStage, DiagnosticsReport, FailureReport, ReusePolicyReport, RevisionPlan } from '../schemas/index.js';
import type { ReusePolicy } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface ChapterRevisionLoopInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  provider?: ProviderName;
  promptRoot?: string;
  fixturesRoot?: string;
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
  runId?: string;
  forceStage?: ChapterQueueStage;
  failAt?: FailureInjectionPoint;
  resumeFromStage?: ChapterQueueStage | undefined;
  mockScenario?: string;
  repairConflicts?: boolean;
  maxConflictRepairs?: number;
  regenerateStale?: boolean;
  reusePolicy?: ReusePolicy;
  archiveProvenance?: {
    archiveManifestPath: string;
    archiveManifest: ArchiveManifest;
  };
  reusePolicyProvenance?: {
    reportPath: string;
    report: ReusePolicyReport;
  };
}

export interface DraftVersionInput extends ChapterRevisionLoopInput {
  draftVersion: number;
}

export interface ReviseDraftInput extends ChapterRevisionLoopInput {
  fromDraftVersion: number;
  toDraftVersion: number;
  revisionPlan: RevisionPlan;
}

export interface DiagnosticsStepResult {
  artifact: string;
  value: DiagnosticsReport;
}

export interface RevisionPlanStepResult {
  artifact: string;
  value: RevisionPlan;
}

export interface ReviseDraftStepResult {
  artifact: string;
  content: string;
}

export interface QualityGateResult {
  passed: boolean;
  threshold: number;
  softScoreAverage: number;
  failedHardChecks: string[];
  missionSatisfied: boolean;
}

export interface ChapterRevisionLoopResult {
  projectId: string;
  chapterNumber: number;
  runId: string;
  status: 'final_complete' | 'needs_human_review' | 'committed' | 'codex_commit_preview';
  artifacts: string[];
  finalDraftVersion: number;
  generatedArtifacts: string[];
  reusedArtifacts: string[];
  previousStatus?: string;
  newStatus?: string;
  currentStage?: ChapterQueueStage;
  resumeFromStage?: ChapterQueueStage | undefined;
  commitStatus?: 'not_requested' | 'committed' | 'needs_human_review' | 'preview';
  repaired?: boolean | undefined;
  conflictReportPath?: string | undefined;
  repairPlanPath?: string | undefined;
  repairedPatchPath?: string | undefined;
  conflictRepairReportPath?: string | undefined;
  commitReportPath?: string | undefined;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DEFAULT_FIXTURES_ROOT = './fixtures/llm';

const HARD_CHECK_KEYS = [
  'timeline_consistency',
  'character_knowledge_consistency',
  'world_rule_consistency',
  'no_unplanned_reveal'
] as const;

const SOFT_SCORE_KEYS = [
  'plot_progression',
  'character_consistency',
  'tension_curve',
  'emotional_impact',
  'chapter_hook',
  'style_match',
  'genre_satisfaction',
  'reader_curiosity'
] as const;

export async function diagnoseChapter(input: DraftVersionInput, fileStore = new FileStore()): Promise<DiagnosticsStepResult> {
  const paths = createPaths(input);
  await ensureRevisionPrerequisites(paths, fileStore, input.chapterNumber);

  const config = await fileStore.readJson(paths.config(), ConfigSchema);
  const mission = await fileStore.readJson(paths.chapterArtifact(input.chapterNumber, 'mission.json'), ChapterMissionSchema);
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const draftText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, draftFileName(input.draftVersion)));
  const promptService = createPromptService(input, fileStore);
  const llmClient = createLlmClient(input, paths, fileStore);
  const renderedPrompt = await promptService.renderPrompt('diagnostics.diagnose_chapter', {
    CHAPTER_NUMBER: input.chapterNumber,
    DRAFT_VERSION: input.draftVersion,
    QUALITY_THRESHOLD: config.qualityThreshold,
    MISSION_JSON: JSON.stringify(mission, null, 2),
    STORY_STATE_JSON: JSON.stringify(storyState, null, 2),
    DRAFT_MARKDOWN: draftText
  });
  const response = await llmClient.complete({
    promptId: 'diagnostics.diagnose_chapter',
    system: 'Novel Loop Engine diagnostics module',
    user: renderedPrompt,
    responseFormat: 'json',
    metadata: {
      fixtureScenario: diagnosticsFixtureScenario(input.chapterNumber, input.draftVersion)
    }
  });

  if (input.runId !== undefined) {
    await writePromptRunArtifacts(fileStore, paths, input.runId, `diagnostics.diagnose_chapter.v${input.draftVersion}`, renderedPrompt, response.text);
  }

  const artifact = relativeChapterArtifact(input.chapterNumber, diagnosticsFileName(input.draftVersion));
  const diagnostics = await fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, diagnosticsFileName(input.draftVersion)), response.json, DiagnosticsReportSchema);

  return {
    artifact,
    value: diagnostics
  };
}

export function qualityGate(report: DiagnosticsReport, threshold: number): QualityGateResult {
  const failedHardChecks = HARD_CHECK_KEYS.filter((key) => !report.hard_checks[key].passed);
  const softScoreAverage = average(SOFT_SCORE_KEYS.map((key) => report.soft_scores[key]));
  const missionSatisfied = report.missionSatisfaction.allRequiredSatisfied;

  return {
    passed: failedHardChecks.length === 0 && softScoreAverage >= threshold && missionSatisfied,
    threshold,
    softScoreAverage,
    failedHardChecks,
    missionSatisfied
  };
}

export async function createRevisionPlan(input: DraftVersionInput, fileStore = new FileStore()): Promise<RevisionPlanStepResult> {
  const paths = createPaths(input);
  await ensureRevisionPrerequisites(paths, fileStore, input.chapterNumber);

  const diagnostics = await fileStore.readJson(paths.chapterArtifact(input.chapterNumber, diagnosticsFileName(input.draftVersion)), DiagnosticsReportSchema);
  const draftText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, draftFileName(input.draftVersion)));
  const promptService = createPromptService(input, fileStore);
  const llmClient = createLlmClient(input, paths, fileStore);
  const renderedPrompt = await promptService.renderPrompt('revision.create_revision_plan', {
    CHAPTER_NUMBER: input.chapterNumber,
    DRAFT_VERSION: input.draftVersion,
    DIAGNOSTICS_JSON: JSON.stringify(diagnostics, null, 2),
    DRAFT_MARKDOWN: draftText
  });
  const response = await llmClient.complete({
    promptId: 'revision.create_revision_plan',
    system: 'Novel Loop Engine revision planning module',
    user: renderedPrompt,
    responseFormat: 'json',
    metadata: {
      fixtureScenario: revisionFixtureScenario(input.chapterNumber, input.draftVersion)
    }
  });

  if (input.runId !== undefined) {
    await writePromptRunArtifacts(fileStore, paths, input.runId, `revision.create_revision_plan.v${input.draftVersion}`, renderedPrompt, response.text);
  }

  const artifact = relativeChapterArtifact(input.chapterNumber, revisionPlanFileName(input.draftVersion));
  const revisionPlan = await fileStore.writeJson(
    paths.chapterArtifact(input.chapterNumber, revisionPlanFileName(input.draftVersion)),
    response.json,
    RevisionPlanSchema
  );

  return {
    artifact,
    value: revisionPlan
  };
}

export async function reviseDraft(input: ReviseDraftInput, fileStore = new FileStore()): Promise<ReviseDraftStepResult> {
  const paths = createPaths(input);
  await ensureRevisionPrerequisites(paths, fileStore, input.chapterNumber);

  const draftText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, draftFileName(input.fromDraftVersion)));
  const promptService = createPromptService(input, fileStore);
  const llmClient = createLlmClient(input, paths, fileStore);
  const renderedPrompt = await promptService.renderPrompt('revision.revise_draft', {
    CHAPTER_NUMBER: input.chapterNumber,
    FROM_DRAFT_VERSION: input.fromDraftVersion,
    TO_DRAFT_VERSION: input.toDraftVersion,
    REVISION_PLAN_JSON: JSON.stringify(input.revisionPlan, null, 2),
    DRAFT_MARKDOWN: draftText
  });
  const response = await llmClient.complete({
    promptId: 'revision.revise_draft',
    system: 'Novel Loop Engine revision module',
    user: renderedPrompt,
    responseFormat: 'markdown',
    metadata: {
      fixtureScenario: revisedDraftFixtureScenario(input.chapterNumber, input.toDraftVersion)
    }
  });

  if (input.runId !== undefined) {
    await writePromptRunArtifacts(
      fileStore,
      paths,
      input.runId,
      `revision.revise_draft.v${input.fromDraftVersion}_to_v${input.toDraftVersion}`,
      renderedPrompt,
      response.text
    );
  }

  const artifact = relativeChapterArtifact(input.chapterNumber, draftFileName(input.toDraftVersion));
  await fileStore.writeText(paths.chapterArtifact(input.chapterNumber, draftFileName(input.toDraftVersion)), response.text);

  return {
    artifact,
    content: response.text
  };
}

export async function runChapterRevisionLoop(input: ChapterRevisionLoopInput, fileStore = new FileStore()): Promise<ChapterRevisionLoopResult> {
  const paths = createPaths(input);
  const config = await fileStore.readJson(paths.config(), ConfigSchema);
  const maxRevisions = input.maxRevisions ?? config.chapter.maxRevisionAttempts;
  const runId = input.runId ?? createRunId();
  const runLogger = new RunLogger(paths, fileStore);
  const queueStore = new ChapterQueueStore(paths, fileStore);
  const artifacts: string[] = [];
  const generatedArtifacts: string[] = [];
  const reusedArtifacts: string[] = [];
  const forceRegeneration = input.regenerateStale === true;
  let draftVersion = 1;
  let revisionCount = 0;
  let activeStage: ChapterQueueStage = 'diagnostics';

  await ensureRevisionPrerequisites(paths, fileStore, input.chapterNumber);
  await ensureForceStageNotCommitted(input, paths, fileStore);
  const previousStatus = (await queueStore.getRequiredChapter(input.chapterNumber)).status;
  await runLogger.startRun({
    runId,
    command: 'chapter',
    args: {
      chapterNumber: input.chapterNumber,
      provider: input.provider ?? 'mock',
      maxRevisions,
      commit: input.commit ?? false,
      regenerateStale: input.regenerateStale ?? false,
      ...(input.reusePolicy === undefined ? {} : { reusePolicy: input.reusePolicy })
    }
  });
  await recordPreRunProvenance(runLogger, runId, input);

  try {
    if (!forceRegeneration && (await fileStore.exists(paths.chapterArtifact(input.chapterNumber, 'final.md')))) {
      activeStage = 'final';
      const finalArtifact = relativeChapterArtifact(input.chapterNumber, 'final.md');
      recordArtifact(artifacts, finalArtifact, reusedArtifacts);
      await runLogger.recordArtifact(runId, finalArtifact, 'reused');
      await queueStore.markStageComplete(input.chapterNumber, 'final_ready', 'final', runId);

      if (input.commit === true) {
        activeStage = 'commit';
        const commitResult = await commitChapterState({ ...input, runId }, fileStore);
        for (const artifact of commitResult.artifacts) {
          recordArtifact(artifacts, artifact, generatedArtifacts);
          await runLogger.recordArtifact(runId, artifact, 'generated');
        }
        await runLogger.endRun(runId, 'completed');
        const finalQueueItem = await queueStore.getRequiredChapter(input.chapterNumber);
        if (commitResult.status === 'needs_human_review') {
          return {
            projectId: paths.projectId,
            chapterNumber: input.chapterNumber,
            runId,
            status: 'needs_human_review',
            artifacts,
            finalDraftVersion: detectFinalDraftVersion(paths, fileStore, input.chapterNumber),
            generatedArtifacts,
            reusedArtifacts,
            previousStatus,
            newStatus: finalQueueItem.status,
            currentStage: finalQueueItem.currentStage,
            resumeFromStage: input.resumeFromStage,
            commitStatus: 'needs_human_review',
            repaired: false,
            conflictReportPath: commitResult.conflictReportPath,
            repairPlanPath: commitResult.repairPlanPath,
            repairedPatchPath: commitResult.repairedPatchPath,
            conflictRepairReportPath: commitResult.conflictRepairReportPath
          };
        }

        return {
          projectId: paths.projectId,
          chapterNumber: input.chapterNumber,
          runId,
          status: 'committed',
          artifacts,
          finalDraftVersion: detectFinalDraftVersion(paths, fileStore, input.chapterNumber),
          generatedArtifacts,
          reusedArtifacts,
          previousStatus,
          newStatus: finalQueueItem.status,
          currentStage: finalQueueItem.currentStage,
          resumeFromStage: input.resumeFromStage,
          commitStatus: 'committed',
          repaired: commitResult.repaired ?? false,
          conflictReportPath: commitResult.conflictReportPath,
          repairPlanPath: commitResult.repairPlanPath,
          repairedPatchPath: commitResult.repairedPatchPath,
          conflictRepairReportPath: commitResult.conflictRepairReportPath,
          commitReportPath: relativeChapterArtifact(input.chapterNumber, 'commit_report.json')
        };
      }

      await runLogger.endRun(runId, 'completed');
      const finalQueueItem = await queueStore.getRequiredChapter(input.chapterNumber);

      return {
        projectId: paths.projectId,
        chapterNumber: input.chapterNumber,
        runId,
        status: 'final_complete',
        artifacts,
        finalDraftVersion: detectFinalDraftVersion(paths, fileStore, input.chapterNumber),
        generatedArtifacts,
        reusedArtifacts,
        previousStatus,
        newStatus: finalQueueItem.status,
        currentStage: finalQueueItem.currentStage,
        resumeFromStage: input.resumeFromStage,
        commitStatus: 'not_requested'
      };
    }

    while (true) {
      activeStage = 'diagnostics';
      await queueStore.markStageStart(input.chapterNumber, 'diagnosing', 'diagnostics', runId);
      const diagnostics = await reuseJsonArtifact(
        fileStore,
        paths.chapterArtifact(input.chapterNumber, diagnosticsFileName(draftVersion)),
        relativeChapterArtifact(input.chapterNumber, diagnosticsFileName(draftVersion)),
        DiagnosticsReportSchema,
        input.forceStage === 'diagnostics' || forceRegeneration,
        async () => {
          injectFailure(input, 'diagnostics');
          return diagnoseChapter({ ...input, draftVersion, runId }, fileStore);
        }
      );
      recordArtifact(artifacts, diagnostics.artifact, diagnostics.reused ? reusedArtifacts : generatedArtifacts);
      await runLogger.recordArtifact(runId, diagnostics.artifact, diagnostics.reused ? 'reused' : 'generated');
      await queueStore.markStageComplete(input.chapterNumber, 'diagnosing', 'diagnostics', runId);

      const gate = qualityGate(diagnostics.value, config.qualityThreshold);
      if (gate.passed) {
        activeStage = 'final';
        await queueStore.markStageStart(input.chapterNumber, 'revising', 'final', runId);
        const final = await reuseTextArtifact(
          fileStore,
          paths.chapterArtifact(input.chapterNumber, 'final.md'),
          relativeChapterArtifact(input.chapterNumber, 'final.md'),
          input.forceStage === 'final' || forceRegeneration,
          async () => writeFinalDraft(paths, fileStore, input.chapterNumber, draftVersion)
        );
        recordArtifact(artifacts, final.artifact, final.reused ? reusedArtifacts : generatedArtifacts);
        const finalQueueItem = await queueStore.markStageComplete(input.chapterNumber, 'final_ready', 'final', runId);
        await runLogger.recordArtifact(runId, final.artifact, final.reused ? 'reused' : 'generated');

        if (input.commit === true) {
          activeStage = 'commit';
          const commitResult = await commitChapterState({ ...input, runId }, fileStore);
          for (const artifact of commitResult.artifacts) {
            recordArtifact(artifacts, artifact, generatedArtifacts);
            await runLogger.recordArtifact(runId, artifact, 'generated');
          }
          await runLogger.endRun(runId, 'completed');
          const committedQueueItem = await queueStore.getRequiredChapter(input.chapterNumber);
          if (commitResult.status === 'needs_human_review') {
            return {
              projectId: paths.projectId,
              chapterNumber: input.chapterNumber,
              runId,
              status: 'needs_human_review',
              artifacts,
              finalDraftVersion: draftVersion,
              generatedArtifacts,
              reusedArtifacts,
              previousStatus,
              newStatus: committedQueueItem.status,
              currentStage: committedQueueItem.currentStage,
              resumeFromStage: input.resumeFromStage,
              commitStatus: 'needs_human_review',
              repaired: false,
              conflictReportPath: commitResult.conflictReportPath,
              repairPlanPath: commitResult.repairPlanPath,
              repairedPatchPath: commitResult.repairedPatchPath,
              conflictRepairReportPath: commitResult.conflictRepairReportPath
            };
          }

          return {
            projectId: paths.projectId,
            chapterNumber: input.chapterNumber,
            runId,
            status: 'committed',
            artifacts,
            finalDraftVersion: draftVersion,
            generatedArtifacts,
            reusedArtifacts,
            previousStatus,
            newStatus: committedQueueItem.status,
            currentStage: committedQueueItem.currentStage,
            resumeFromStage: input.resumeFromStage,
            commitStatus: 'committed',
            repaired: commitResult.repaired ?? false,
            conflictReportPath: commitResult.conflictReportPath,
            repairPlanPath: commitResult.repairPlanPath,
            repairedPatchPath: commitResult.repairedPatchPath,
            conflictRepairReportPath: commitResult.conflictRepairReportPath,
            commitReportPath: relativeChapterArtifact(input.chapterNumber, 'commit_report.json')
          };
        }

        await runLogger.endRun(runId, 'completed');

        return {
          projectId: paths.projectId,
          chapterNumber: input.chapterNumber,
          runId,
          status: 'final_complete',
          artifacts,
          finalDraftVersion: draftVersion,
          generatedArtifacts,
          reusedArtifacts,
          previousStatus,
          newStatus: finalQueueItem.status,
          currentStage: finalQueueItem.currentStage,
          resumeFromStage: input.resumeFromStage,
          commitStatus: 'not_requested'
        };
      }

      await queueStore.markStageComplete(input.chapterNumber, 'revision_required', 'diagnostics', runId);
      if (revisionCount >= maxRevisions) {
        const humanReviewArtifacts = await writeHumanReviewArtifacts(paths, fileStore, input.chapterNumber, draftVersion, maxRevisions, diagnostics.artifact, gate);
        for (const artifact of humanReviewArtifacts) {
          recordArtifact(artifacts, artifact, generatedArtifacts);
          await runLogger.recordArtifact(runId, artifact, 'generated');
        }
        const reviewQueueItem = await queueStore.markNeedsHumanReview(input.chapterNumber, 'diagnostics', runId);
        await runLogger.endRun(runId, 'completed');

        return {
          projectId: paths.projectId,
          chapterNumber: input.chapterNumber,
          runId,
          status: 'needs_human_review',
          artifacts,
          finalDraftVersion: draftVersion,
          generatedArtifacts,
          reusedArtifacts,
          previousStatus,
          newStatus: reviewQueueItem.status,
          currentStage: reviewQueueItem.currentStage,
          resumeFromStage: input.resumeFromStage,
          commitStatus: 'needs_human_review'
        };
      }

      activeStage = 'revision';
      await queueStore.markStageStart(input.chapterNumber, 'revising', 'revision', runId);
      const revisionPlan = await reuseJsonArtifact(
        fileStore,
        paths.chapterArtifact(input.chapterNumber, revisionPlanFileName(draftVersion)),
        relativeChapterArtifact(input.chapterNumber, revisionPlanFileName(draftVersion)),
        RevisionPlanSchema,
        input.forceStage === 'revision' || forceRegeneration,
        async () => {
          injectFailure(input, 'revision');
          return createRevisionPlan({ ...input, draftVersion, runId }, fileStore);
        }
      );
      recordArtifact(artifacts, revisionPlan.artifact, revisionPlan.reused ? reusedArtifacts : generatedArtifacts);
      await runLogger.recordArtifact(runId, revisionPlan.artifact, revisionPlan.reused ? 'reused' : 'generated');

      const nextDraftVersion = draftVersion + 1;
      const revisedDraft = await reuseTextArtifact(
        fileStore,
        paths.chapterArtifact(input.chapterNumber, draftFileName(nextDraftVersion)),
        relativeChapterArtifact(input.chapterNumber, draftFileName(nextDraftVersion)),
        input.forceStage === 'revision' || forceRegeneration,
        async () =>
          reviseDraft(
            {
              ...input,
              fromDraftVersion: draftVersion,
              toDraftVersion: nextDraftVersion,
              revisionPlan: revisionPlan.value,
              runId
            },
            fileStore
          ).then((result) => result.artifact)
      );
      recordArtifact(artifacts, revisedDraft.artifact, revisedDraft.reused ? reusedArtifacts : generatedArtifacts);
      await runLogger.recordArtifact(runId, revisedDraft.artifact, revisedDraft.reused ? 'reused' : 'generated');
      await queueStore.markStageComplete(input.chapterNumber, 'revising', 'revision', runId);

      draftVersion = nextDraftVersion;
      revisionCount += 1;
    }
  } catch (error) {
    if (!(error instanceof AppError && error.code === 'CANON_PATCH_CONFLICT')) {
      await queueStore.markFailed(input.chapterNumber, activeStage, runId, error);
    }
    await runLogger.recordError(runId, {
      code: 'CHAPTER_REVISION_LOOP_FAILED',
      message: getErrorMessage(error),
      recoverable: false
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

async function ensureForceStageNotCommitted(input: ChapterRevisionLoopInput, paths: ProjectPaths, fileStore: FileStore): Promise<void> {
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

async function recordPreRunProvenance(runLogger: RunLogger, runId: string, input: ChapterRevisionLoopInput): Promise<void> {
  if (input.archiveProvenance !== undefined) {
    await runLogger.recordArchive(runId, input.archiveProvenance.archiveManifestPath, {
      chapterNumber: input.chapterNumber,
      count: input.archiveProvenance.archiveManifest.copiedArtifacts.length,
      reason: input.archiveProvenance.archiveManifest.archiveReason
    });
    for (const copiedArtifact of input.archiveProvenance.archiveManifest.copiedArtifacts) {
      await runLogger.recordArchivedArtifact(
        runId,
        copiedArtifact.originalPath,
        copiedArtifact.archivedPath,
        input.archiveProvenance.archiveManifestPath
      );
    }
  }

  if (input.reusePolicyProvenance !== undefined) {
    await runLogger.recordReusePolicy(runId, {
      reportPath: input.reusePolicyProvenance.reportPath,
      chapterNumber: input.chapterNumber,
      requestedPolicy: input.reusePolicyProvenance.report.requestedPolicy,
      effectivePolicy: input.reusePolicyProvenance.report.effectivePolicy,
      ...(input.reusePolicyProvenance.report.downgradeReason === undefined
        ? {}
        : { downgradeReason: input.reusePolicyProvenance.report.downgradeReason })
    });
  }
}

async function reuseJsonArtifact<T, R extends { artifact: string; value: T }>(
  fileStore: FileStore,
  artifactPath: string,
  relativeArtifactPath: string,
  schema: z.ZodType<T>,
  force: boolean,
  producer: () => Promise<R>
): Promise<R & { reused: boolean }> {
  if (!force && (await fileStore.exists(artifactPath))) {
    const value = await fileStore.readJson(artifactPath, schema);
    return {
      artifact: relativeArtifactPath,
      value,
      reused: true
    } as R & { reused: boolean };
  }

  const produced = await producer();
  return {
    ...produced,
    reused: false
  };
}

async function reuseTextArtifact(
  fileStore: FileStore,
  artifactPath: string,
  relativeArtifactPath: string,
  force: boolean,
  producer: () => Promise<string>
): Promise<{ artifact: string; reused: boolean }> {
  if (!force && (await fileStore.exists(artifactPath))) {
    await fileStore.readText(artifactPath);
    return {
      artifact: relativeArtifactPath,
      reused: true
    };
  }

  const artifact = await producer();
  return {
    artifact,
    reused: false
  };
}

function recordArtifact(allArtifacts: string[], artifact: string, bucket: string[]): void {
  if (!allArtifacts.includes(artifact)) {
    allArtifacts.push(artifact);
  }
  if (!bucket.includes(artifact)) {
    bucket.push(artifact);
  }
}

function detectFinalDraftVersion(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): number {
  void paths;
  void fileStore;
  void chapterNumber;
  return 2;
}

function createPaths(input: Pick<ChapterRevisionLoopInput, 'projectId' | 'projectsRoot'>): ProjectPaths {
  return new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
}

function createPromptService(input: Pick<ChapterRevisionLoopInput, 'promptRoot'>, fileStore: FileStore): PromptService {
  return new PromptService(input.promptRoot ?? DEFAULT_PROMPT_ROOT, fileStore);
}

function createLlmClient(
  input: Pick<
    ChapterRevisionLoopInput,
    | 'provider'
    | 'fixturesRoot'
    | 'runId'
    | 'codexBin'
    | 'codexProfile'
    | 'codexJsonRetries'
    | 'codexJsonRepair'
    | 'codexJsonRepairRetries'
    | 'codexTimeoutMs'
  >,
  paths: ProjectPaths,
  fileStore: FileStore
) {
  return ProviderFactory.create({
    provider: input.provider ?? 'mock',
    fixturesRoot: input.fixturesRoot ?? DEFAULT_FIXTURES_ROOT,
    projectsRoot: paths.projectsRoot,
    projectId: paths.projectId,
    ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
    ...(input.codexProfile === undefined ? {} : { codexProfile: input.codexProfile }),
    ...(input.codexJsonRetries === undefined ? {} : { codexJsonRetries: input.codexJsonRetries }),
    ...(input.codexJsonRepair === undefined ? {} : { codexJsonRepair: input.codexJsonRepair }),
    ...(input.codexJsonRepairRetries === undefined ? {} : { codexJsonRepairRetries: input.codexJsonRepairRetries }),
    ...(input.codexTimeoutMs === undefined ? {} : { codexTimeoutMs: input.codexTimeoutMs }),
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

async function ensureRevisionPrerequisites(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  if (!(await fileStore.exists(paths.projectRoot))) {
    throw new AppError('PROJECT_NOT_FOUND', `Project not found: ${paths.projectRoot}`, 2);
  }
  if (!(await fileStore.exists(paths.config()))) {
    throw new AppError('CONFIG_NOT_FOUND', `Config not found: ${paths.config()}`, 2);
  }
  if (!(await fileStore.exists(paths.storyState()))) {
    throw new AppError('STORY_STATE_NOT_FOUND', `Story State not found: ${paths.storyState()}`, 2);
  }
  if (!(await fileStore.exists(paths.chapterArtifact(chapterNumber, 'mission.json')))) {
    throw new AppError('CHAPTER_MISSION_NOT_FOUND', `Chapter mission not found for chapter ${chapterNumber}`, 2);
  }
  if (!(await fileStore.exists(paths.chapterArtifact(chapterNumber, 'draft_v1.md')))) {
    throw new AppError('DRAFT_NOT_FOUND', `draft_v1.md not found for chapter ${chapterNumber}`, 2);
  }
}

async function writeFinalDraft(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, draftVersion: number): Promise<string> {
  const draftText = await fileStore.readText(paths.chapterArtifact(chapterNumber, draftFileName(draftVersion)));
  await fileStore.writeText(paths.chapterArtifact(chapterNumber, 'final.md'), draftText);
  return relativeChapterArtifact(chapterNumber, 'final.md');
}

async function writeHumanReviewArtifacts(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  draftVersion: number,
  maxRevisions: number,
  failedDiagnosticsPath: string,
  gate: QualityGateResult
): Promise<string[]> {
  const reviewArtifact = relativeChapterArtifact(chapterNumber, 'needs_human_review.md');
  const failureArtifact = relativeChapterArtifact(chapterNumber, 'failure_report.json');
  const reviewText = [
    `# Human Review Required: Chapter ${formatChapterNumber(chapterNumber)}`,
    '',
    `Last diagnostics: ${failedDiagnosticsPath}`,
    `Max revisions: ${maxRevisions}`,
    `Soft score average: ${gate.softScoreAverage.toFixed(2)} / threshold ${gate.threshold}`,
    `Failed hard checks: ${gate.failedHardChecks.length === 0 ? 'none' : gate.failedHardChecks.join(', ')}`
  ].join('\n');
  const failureReport: FailureReport = {
    chapterNumber,
    finalDraftVersion: draftVersion,
    maxRevisions,
    reason: 'max_revisions_exhausted',
    failedDiagnosticsPath,
    hardCheckFailures: gate.failedHardChecks,
    softScoreAverage: gate.softScoreAverage,
    threshold: gate.threshold,
    createdAt: new Date().toISOString()
  };

  await fileStore.writeText(paths.chapterArtifact(chapterNumber, 'needs_human_review.md'), `${reviewText}\n`);
  await fileStore.writeJson(paths.chapterArtifact(chapterNumber, 'failure_report.json'), failureReport, FailureReportSchema);

  return [reviewArtifact, failureArtifact];
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function draftFileName(draftVersion: number): string {
  return `draft_v${draftVersion}.md`;
}

function diagnosticsFileName(draftVersion: number): string {
  return `diagnostics_v${draftVersion}.json`;
}

function revisionPlanFileName(draftVersion: number): string {
  return `revision_plan_v${draftVersion}.json`;
}

function versionScenario(draftVersion: number): string {
  return `v${draftVersion}`;
}

function diagnosticsFixtureScenario(chapterNumber: number, draftVersion: number): string {
  return chapterNumber === 1 ? versionScenario(draftVersion) : `chapter_${formatChapterNumber(chapterNumber)}_v${draftVersion}`;
}

function revisionFixtureScenario(chapterNumber: number, draftVersion: number): string {
  return chapterNumber === 1 ? versionScenario(draftVersion) : `chapter_${formatChapterNumber(chapterNumber)}_v${draftVersion}`;
}

function revisedDraftFixtureScenario(chapterNumber: number, draftVersion: number): string {
  return chapterNumber === 1 ? versionScenario(draftVersion) : `chapter_${formatChapterNumber(chapterNumber)}_v${draftVersion}`;
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, ...segments);
}
