import path from 'node:path';
import type { z } from 'zod';

import { ChapterQueueStore } from './chapterQueue.js';
import { normalizeCodexOutput } from './codexNormalization.js';
import { injectFailure } from './pipelineFailure.js';
import type { FailureInjectionPoint } from './pipelineFailure.js';
import { ProviderFactory, type ProviderName } from '../llm/ProviderFactory.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import { normalizeMission, normalizePlanCandidates, normalizeRanking } from '../providers/codex/normalizers.js';
import {
  ChapterMissionSchema,
  ChapterContextSummarySchema,
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  PlanCandidatesSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type { ChapterMission, ChapterPlanRanking, ChapterQueueStage, PlanCandidate } from '../schemas/index.js';
import type { ChapterQueueStatus } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export type ChapterPlanningProgressStage =
  | 'preparing'
  | 'mission'
  | 'plan_candidates'
  | 'ranking'
  | 'finalizing'
  | 'completed';

export interface ChapterPlanningProgressEvent {
  stage: ChapterPlanningProgressStage;
  state: 'started' | 'completed';
}

export interface ChapterPlanningInput {
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
  runId?: string;
  forceStage?: ChapterQueueStage;
  failAt?: FailureInjectionPoint;
  regenerateStale?: boolean;
  enforceDesktopQueueTransitions?: boolean;
}

export interface GeneratePlanCandidatesInput extends ChapterPlanningInput {
  count: number;
}

export interface ChapterDryRunInput extends ChapterPlanningInput {
  candidates?: number;
  onProgress?: (event: ChapterPlanningProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
}

export interface ChapterPlanningStepResult<T> {
  artifact: string;
  value: T;
}

export interface GeneratePlanCandidatesResult {
  artifacts: string[];
  candidates: PlanCandidate[];
}

export interface RankPlanCandidatesResult {
  artifacts: string[];
  value: ChapterPlanRanking;
}

export interface ChapterDryRunResult {
  projectId: string;
  chapterNumber: number;
  runId: string;
  status: 'dry_run_complete';
  artifacts: string[];
  generatedArtifacts: string[];
  reusedArtifacts: string[];
  previousStatus?: string;
  newStatus?: string;
  currentStage?: ChapterQueueStage;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DEFAULT_FIXTURES_ROOT = './fixtures/llm';
const MAX_MISSION_CONTEXT_CHARACTERS = 6;
const MAX_MISSION_CHARACTER_ID_LENGTH = 200;
const MAX_MISSION_CHARACTER_NAME_LENGTH = 120;
const MAX_MISSION_CHARACTER_STATE_LENGTH = 180;
const MAX_MISSION_CHARACTER_GOAL_LENGTH = 180;
const MAX_MISSION_STORY_STATE_SUMMARY_LENGTH = 3600;

export async function planChapterMission(input: ChapterPlanningInput, fileStore = new FileStore()): Promise<ChapterPlanningStepResult<ChapterMission>> {
  const paths = createPaths(input);
  await ensurePlanningPrerequisites(paths, fileStore);
  await fileStore.ensureDir(paths.chapterDir(input.chapterNumber));

  const promptService = createPromptService(input);
  const llmClient = createLlmClient(input, paths, fileStore);
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const chapterQueue = await fileStore.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema);
  const previousChapterSummary =
    input.provider === 'codex-text' && input.chapterNumber > 1
      ? await readPreviousChapterSummary(paths, fileStore, input.chapterNumber - 1)
      : undefined;
  const promptId = input.provider === 'codex-text' ? 'planning.plan_chapter_mission_slim' : 'planning.plan_chapter_mission';
  const queueItem = chapterQueue.chapters.find((chapter) => chapter.chapterNumber === input.chapterNumber);
  const renderedPrompt =
    input.provider === 'codex-text'
      ? await promptService.renderPrompt(promptId, {
          CHAPTER_NUMBER: input.chapterNumber,
          STORY_STATE_SUMMARY: summarizeJson({
            latestCommittedChapter: storyState.latestCommittedChapter,
            characters: summarizeMissionCharacters(storyState.characters),
            openDebts: storyState.narrativeDebts.filter((debt) => debt.status !== 'resolved').slice(0, 8),
            readerExpectations: storyState.readerState.readerExpectations.slice(0, 8),
            ...(previousChapterSummary === undefined ? {} : { previousChapterSummary })
          }, MAX_MISSION_STORY_STATE_SUMMARY_LENGTH),
          CHAPTER_QUEUE_ITEM: JSON.stringify(queueItem ?? {}, null, 2)
        })
      : await promptService.renderPrompt(promptId, {
          CHAPTER_NUMBER: input.chapterNumber,
          STORY_STATE_JSON: JSON.stringify(storyState, null, 2),
          CHAPTER_QUEUE_JSON: JSON.stringify(chapterQueue, null, 2)
        });
  const response = await llmClient.complete({
    promptId,
    system: 'Novel Loop Engine planning module',
    user: renderedPrompt,
    responseFormat: 'json',
    metadata: {
      fixtureScenario: chapterFixtureScenario(input.chapterNumber)
    }
  });

  if (input.runId !== undefined) {
    await writePromptRunArtifacts(fileStore, paths, input.runId, promptId, renderedPrompt, response.text);
  }

  const missionJson =
    input.provider === 'codex-text'
      ? await normalizeCodexOutput(paths, fileStore, {
          runId: input.runId,
          promptId,
          stage: 'chapter-planning',
          value: response.json,
          normalize: () => normalizeMission(response.json, { projectId: paths.projectId, chapterNumber: input.chapterNumber })
        })
      : response.json;
  const parsedMission = ChapterMissionSchema.parse(missionJson);
  if (input.provider === 'codex-text') {
    validateMissionCharacterReferences(parsedMission, storyState.characters, input.chapterNumber);
  }
  const mission = await fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, 'mission.json'), parsedMission, ChapterMissionSchema);
  return {
    artifact: relativeChapterArtifact(input.chapterNumber, 'mission.json'),
    value: mission
  };
}

async function readPreviousChapterSummary(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<unknown | undefined> {
  const summaryPath = paths.chapterArtifact(chapterNumber, 'chapter_summary_for_context.json');
  if (!(await fileStore.exists(summaryPath))) return undefined;
  try {
    return await fileStore.readJson(summaryPath, ChapterContextSummarySchema);
  } catch {
    return undefined;
  }
}

export async function generatePlanCandidates(
  input: GeneratePlanCandidatesInput,
  fileStore = new FileStore()
): Promise<GeneratePlanCandidatesResult> {
  const paths = createPaths(input);
  await ensurePlanningPrerequisites(paths, fileStore);
  const mission = await fileStore.readJson(paths.chapterArtifact(input.chapterNumber, 'mission.json'), ChapterMissionSchema);
  const promptService = createPromptService(input);
  const llmClient = createLlmClient(input, paths, fileStore);
  const promptId = input.provider === 'codex-text' ? 'planning.generate_plan_candidates_slim' : 'planning.generate_plan_candidates';
  const renderedPrompt =
    input.provider === 'codex-text'
      ? await promptService.renderPrompt(promptId, {
          CHAPTER_NUMBER: input.chapterNumber,
          CANDIDATE_COUNT: input.count,
          MISSION_SUMMARY: summarizeJson(mission)
        })
      : await promptService.renderPrompt(promptId, {
          CHAPTER_NUMBER: input.chapterNumber,
          CANDIDATE_COUNT: input.count,
          MISSION_JSON: JSON.stringify(mission, null, 2)
        });
  const response = await llmClient.complete({
    promptId,
    system: 'Novel Loop Engine planning module',
    user: renderedPrompt,
    responseFormat: 'json',
    metadata: {
      fixtureScenario: chapterFixtureScenario(input.chapterNumber)
    }
  });

  if (input.runId !== undefined) {
    await writePromptRunArtifacts(fileStore, paths, input.runId, promptId, renderedPrompt, response.text);
  }

  const parsed = PlanCandidatesSchema.parse(
    input.provider === 'codex-text'
      ? await normalizeCodexOutput(paths, fileStore, {
          runId: input.runId,
          promptId,
          stage: 'chapter-planning',
          value: response.json,
          normalize: () =>
            normalizePlanCandidates(response.json, { projectId: paths.projectId, chapterNumber: input.chapterNumber, candidateCount: input.count })
        })
      : response.json
  );
  const selectedCandidates = parsed.candidates.slice(0, input.count);

  if (selectedCandidates.length < input.count) {
    throw new AppError('INSUFFICIENT_PLAN_CANDIDATES', `Expected ${input.count} plan candidates, got ${selectedCandidates.length}`, 1);
  }

  const artifacts: string[] = [];
  for (const candidate of selectedCandidates) {
    const fileName = `${candidate.id}.md`;
    await fileStore.writeText(paths.chapterArtifact(input.chapterNumber, 'plan_candidates', fileName), candidate.markdown);
    artifacts.push(relativeChapterArtifact(input.chapterNumber, 'plan_candidates', fileName));
  }

  return {
    artifacts,
    candidates: selectedCandidates
  };
}

export async function rankPlanCandidates(input: ChapterPlanningInput, fileStore = new FileStore()): Promise<RankPlanCandidatesResult> {
  const paths = createPaths(input);
  await ensurePlanningPrerequisites(paths, fileStore);
  const mission = await fileStore.readJson(paths.chapterArtifact(input.chapterNumber, 'mission.json'), ChapterMissionSchema);
  const candidateDir = paths.chapterArtifact(input.chapterNumber, 'plan_candidates');
  const candidateFiles = (await fileStore.list(candidateDir)).filter((entry) => entry.endsWith('.md'));
  const candidateContentBlocks: string[] = [];

  for (const candidateFile of candidateFiles) {
    const candidateText = await fileStore.readText(path.join(candidateDir, candidateFile));
    candidateContentBlocks.push(`<candidate file="${candidateFile}">\n${candidateText}\n</candidate>`);
  }

  const promptService = createPromptService(input);
  const llmClient = createLlmClient(input, paths, fileStore);
  const promptId = input.provider === 'codex-text' ? 'planning.rank_plan_candidates_slim' : 'planning.rank_plan_candidates';
  const candidateIds = candidateFiles.map((file) => file.replace(/\.md$/, ''));
  const renderedPrompt =
    input.provider === 'codex-text'
      ? await promptService.renderPrompt(promptId, {
          CHAPTER_NUMBER: input.chapterNumber,
          CANDIDATE_IDS: candidateIds.join(', '),
          PLAN_CANDIDATES: candidateContentBlocks.join('\n\n')
        })
      : await promptService.renderPrompt(promptId, {
          CHAPTER_NUMBER: input.chapterNumber,
          MISSION_JSON: JSON.stringify(mission, null, 2),
          PLAN_CANDIDATES: candidateContentBlocks.join('\n\n')
        });
  const response = await llmClient.complete({
    promptId,
    system: 'Novel Loop Engine planning module',
    user: renderedPrompt,
    responseFormat: 'json',
    metadata: {
      fixtureScenario: chapterFixtureScenario(input.chapterNumber)
    }
  });

  if (input.runId !== undefined) {
    await writePromptRunArtifacts(fileStore, paths, input.runId, promptId, renderedPrompt, response.text);
  }

  const rankingJson =
    input.provider === 'codex-text'
      ? await normalizeCodexOutput(paths, fileStore, {
          runId: input.runId,
          promptId,
          stage: 'chapter-planning',
          value: response.json,
          normalize: () => normalizeRanking(response.json, { projectId: paths.projectId, chapterNumber: input.chapterNumber, candidateIds })
        })
      : response.json;
  const ranking = await fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, 'ranking.json'), rankingJson, ChapterPlanRankingSchema);
  const selectedPlanText = await readSelectedPlanText(fileStore, paths, input.chapterNumber, ranking.selectedCandidateId, ranking.selectedPlanPath);
  await fileStore.writeText(paths.chapterArtifact(input.chapterNumber, 'selected_plan.md'), selectedPlanText);

  return {
    artifacts: [relativeChapterArtifact(input.chapterNumber, 'ranking.json'), relativeChapterArtifact(input.chapterNumber, 'selected_plan.md')],
    value: ranking
  };
}

export async function runChapterDryRun(input: ChapterDryRunInput, fileStore = new FileStore()): Promise<ChapterDryRunResult> {
  const paths = createPaths(input);
  const runId = input.runId ?? createRunId();
  const runLogger = new RunLogger(paths, fileStore);
  const queueStore = new ChapterQueueStore(paths, fileStore);
  const candidates = input.candidates ?? 3;
  const artifacts: string[] = [];
  const generatedArtifacts: string[] = [];
  const reusedArtifacts: string[] = [];
  const forceRegeneration = input.regenerateStale === true;
  const initialExpectedStatuses = desktopExpectedStatuses(input, ['planned', 'planning', 'failed']);
  const planningExpectedStatuses = desktopExpectedStatuses(input, ['planning']);
  const planningExpectedStages = desktopExpectedStages(input);
  let activeStage: ChapterQueueStage = 'mission';

  await ensureForceStageNotCommitted(input, paths, fileStore);
  const previousStatus = (await queueStore.getRequiredChapter(input.chapterNumber)).status;

  await runLogger.startRun({
    runId,
    command: 'chapter',
    args: {
      chapterNumber: input.chapterNumber,
      provider: input.provider ?? 'mock',
      dryRun: true,
      candidates,
      regenerateStale: input.regenerateStale ?? false
    }
  });

  try {
    await emitProgress(input.onProgress, { stage: 'preparing', state: 'started' });
    await emitProgress(input.onProgress, { stage: 'preparing', state: 'completed' });

    await emitProgress(input.onProgress, { stage: 'mission', state: 'started' });
    await stopIfRequested(input, 'CHAPTER_PLANNING_CANCELLED');
    await queueStore.markStageStart(
      input.chapterNumber,
      'planning',
      'mission',
      runId,
      initialExpectedStatuses,
      planningExpectedStages
    );
    const mission = await reuseJsonArtifact(
      fileStore,
      paths.chapterArtifact(input.chapterNumber, 'mission.json'),
      relativeChapterArtifact(input.chapterNumber, 'mission.json'),
      ChapterMissionSchema,
      input.forceStage === 'mission' || forceRegeneration,
      async () => {
        injectFailure(input, 'mission');
        return planChapterMission({ ...input, runId }, fileStore);
      }
    );
    recordArtifact(artifacts, mission.artifact, mission.reused ? reusedArtifacts : generatedArtifacts);
    await runLogger.recordArtifact(runId, mission.artifact, mission.reused ? 'reused' : 'generated');
    await queueStore.markStageComplete(
      input.chapterNumber,
      'planning',
      'mission',
      runId,
      planningExpectedStatuses,
      planningExpectedStages
    );
    await emitProgress(input.onProgress, { stage: 'mission', state: 'completed' });

    activeStage = 'plan_candidates';
    await emitProgress(input.onProgress, { stage: 'plan_candidates', state: 'started' });
    await stopIfRequested(input, 'CHAPTER_PLANNING_CANCELLED');
    await queueStore.markStageStart(
      input.chapterNumber,
      'planning',
      'plan_candidates',
      runId,
      planningExpectedStatuses,
      planningExpectedStages
    );
    const planCandidates = await reusePlanCandidates(
      fileStore,
      paths,
      input.chapterNumber,
      candidates,
      input.forceStage === 'plan_candidates' || forceRegeneration,
      async () => {
        injectFailure(input, 'plan_candidates');
        return generatePlanCandidates({ ...input, count: candidates, runId }, fileStore);
      }
    );
    for (const artifact of planCandidates.artifacts) {
      recordArtifact(artifacts, artifact, planCandidates.reused ? reusedArtifacts : generatedArtifacts);
      await runLogger.recordArtifact(runId, artifact, planCandidates.reused ? 'reused' : 'generated');
    }
    await queueStore.markStageComplete(
      input.chapterNumber,
      'planning',
      'plan_candidates',
      runId,
      planningExpectedStatuses,
      planningExpectedStages
    );
    await emitProgress(input.onProgress, { stage: 'plan_candidates', state: 'completed' });

    activeStage = 'ranking';
    await emitProgress(input.onProgress, { stage: 'ranking', state: 'started' });
    await stopIfRequested(input, 'CHAPTER_PLANNING_CANCELLED');
    await queueStore.markStageStart(
      input.chapterNumber,
      'planning',
      'ranking',
      runId,
      planningExpectedStatuses,
      planningExpectedStages
    );
    const ranking = await reuseRanking(
      fileStore,
      paths,
      input.chapterNumber,
      input.forceStage === 'ranking' || forceRegeneration,
      async () => {
        injectFailure(input, 'ranking');
        return rankPlanCandidates({ ...input, runId }, fileStore);
      }
    );
    for (const artifact of ranking.artifacts) {
      recordArtifact(artifacts, artifact, ranking.reused ? reusedArtifacts : generatedArtifacts);
      await runLogger.recordArtifact(runId, artifact, ranking.reused ? 'reused' : 'generated');
    }
    await emitProgress(input.onProgress, { stage: 'ranking', state: 'completed' });

    await emitProgress(input.onProgress, { stage: 'finalizing', state: 'started' });
    const finalQueueItem = await queueStore.markStageComplete(
      input.chapterNumber,
      'planned_ready',
      'ranking',
      runId,
      planningExpectedStatuses,
      planningExpectedStages
    );
    await emitProgress(input.onProgress, { stage: 'finalizing', state: 'completed' });
    await emitProgress(input.onProgress, { stage: 'completed', state: 'completed' });

    await runLogger.endRun(runId, 'completed');
    return {
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      runId,
      status: 'dry_run_complete',
      artifacts,
      generatedArtifacts,
      reusedArtifacts,
      previousStatus,
      newStatus: finalQueueItem.status,
      currentStage: finalQueueItem.currentStage
    };
  } catch (error) {
    await markPlanningFailed(queueStore, input, activeStage, runId, error);
    const cancelled = error instanceof AppError && error.code === 'CHAPTER_PLANNING_CANCELLED';
    await runLogger.recordError(runId, {
      code: cancelled ? error.code : 'CHAPTER_DRY_RUN_FAILED',
      message: cancelled ? error.message : getErrorMessage(error),
      recoverable: cancelled
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

function desktopExpectedStatuses(
  input: Pick<ChapterPlanningInput, 'enforceDesktopQueueTransitions'>,
  statuses: readonly ChapterQueueStatus[]
): readonly ChapterQueueStatus[] | undefined {
  return input.enforceDesktopQueueTransitions === true ? statuses : undefined;
}

function desktopExpectedStages(
  input: Pick<ChapterPlanningInput, 'enforceDesktopQueueTransitions'>
): readonly ChapterQueueStage[] | undefined {
  return input.enforceDesktopQueueTransitions === true
    ? ['none', 'mission', 'plan_candidates', 'ranking']
    : undefined;
}

async function markPlanningFailed(
  queueStore: ChapterQueueStore,
  input: ChapterDryRunInput,
  activeStage: ChapterQueueStage,
  runId: string,
  error: unknown
): Promise<void> {
  try {
    await queueStore.markFailed(
      input.chapterNumber,
      activeStage,
      runId,
      error,
      desktopExpectedStatuses(input, ['planning']),
      desktopExpectedStages(input)
    );
  } catch (transitionError) {
    if (!(transitionError instanceof AppError && transitionError.code === 'CHAPTER_QUEUE_TRANSITION_INVALID')) {
      throw transitionError;
    }
  }
}

async function emitProgress(
  callback: ChapterDryRunInput['onProgress'],
  event: ChapterPlanningProgressEvent
): Promise<void> {
  await callback?.(event);
}

async function stopIfRequested(
  input: Pick<ChapterDryRunInput, 'shouldStop'>,
  code: 'CHAPTER_PLANNING_CANCELLED' | 'CHAPTER_DRAFT_CANCELLED'
): Promise<void> {
  if (await input.shouldStop?.()) {
    throw new AppError(code, 'Chapter task stopped before the next generation step.', 2);
  }
}

async function ensureForceStageNotCommitted(input: ChapterDryRunInput, paths: ProjectPaths, fileStore: FileStore): Promise<void> {
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

async function reuseJsonArtifact<T>(
  fileStore: FileStore,
  artifactPath: string,
  relativeArtifactPath: string,
  schema: z.ZodType<T>,
  force: boolean,
  producer: () => Promise<ChapterPlanningStepResult<T>>
): Promise<ChapterPlanningStepResult<T> & { reused: boolean }> {
  if (!force && (await fileStore.exists(artifactPath))) {
    const value = await fileStore.readJson(artifactPath, schema);
    return {
      artifact: relativeArtifactPath,
      value,
      reused: true
    };
  }

  const produced = await producer();
  return {
    ...produced,
    reused: false
  };
}

async function reusePlanCandidates(
  fileStore: FileStore,
  paths: ProjectPaths,
  chapterNumber: number,
  count: number,
  force: boolean,
  producer: () => Promise<GeneratePlanCandidatesResult>
): Promise<GeneratePlanCandidatesResult & { reused: boolean }> {
  const candidateDir = paths.chapterArtifact(chapterNumber, 'plan_candidates');
  if (!force && (await fileStore.exists(candidateDir))) {
    const artifacts = (await fileStore.list(candidateDir))
      .filter((entry) => entry.endsWith('.md'))
      .slice(0, count)
      .map((entry) => relativeChapterArtifact(chapterNumber, 'plan_candidates', entry));
    if (artifacts.length >= count) {
      return {
        artifacts,
        candidates: [],
        reused: true
      };
    }
  }

  const produced = await producer();
  return {
    ...produced,
    reused: false
  };
}

async function reuseRanking(
  fileStore: FileStore,
  paths: ProjectPaths,
  chapterNumber: number,
  force: boolean,
  producer: () => Promise<RankPlanCandidatesResult>
): Promise<RankPlanCandidatesResult & { reused: boolean }> {
  const rankingPath = paths.chapterArtifact(chapterNumber, 'ranking.json');
  const selectedPlanPath = paths.chapterArtifact(chapterNumber, 'selected_plan.md');
  if (!force && (await fileStore.exists(rankingPath)) && (await fileStore.exists(selectedPlanPath))) {
    const value = await fileStore.readJson(rankingPath, ChapterPlanRankingSchema);
    return {
      artifacts: [relativeChapterArtifact(chapterNumber, 'ranking.json'), relativeChapterArtifact(chapterNumber, 'selected_plan.md')],
      value,
      reused: true
    };
  }

  const produced = await producer();
  return {
    ...produced,
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

function createPaths(input: Pick<ChapterPlanningInput, 'projectId' | 'projectsRoot'>): ProjectPaths {
  return new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
}

function createPromptService(input: Pick<ChapterPlanningInput, 'promptRoot' | 'provider'>): PromptService {
  const root = input.provider === 'codex-text' ? path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text') : input.promptRoot ?? DEFAULT_PROMPT_ROOT;
  return new PromptService(root, new FileStore());
}

function createLlmClient(
  input: Pick<
    ChapterPlanningInput,
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

function summarizeJson(value: unknown, maxLength = 1800): string {
  const text = JSON.stringify(value, null, 2);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function summarizeMissionCharacters(
  characters: z.infer<typeof StoryStateSchema>['characters']
): Array<{ id: string; name: string; currentState: string; currentGoal: string }> {
  return characters
    .filter((character) => character.id.length <= MAX_MISSION_CHARACTER_ID_LENGTH)
    .slice(0, MAX_MISSION_CONTEXT_CHARACTERS)
    .map((character) => ({
      id: character.id,
      name: boundedMissionContextText(character.name, MAX_MISSION_CHARACTER_NAME_LENGTH, 'Unnamed character'),
      currentState: boundedMissionContextText(
        [character.emotionalState, character.arc.currentStage].filter((value): value is string => value !== undefined && value.trim().length > 0).join('; '),
        MAX_MISSION_CHARACTER_STATE_LENGTH,
        'No current state recorded'
      ),
      currentGoal: boundedMissionContextText(
        character.currentGoal,
        MAX_MISSION_CHARACTER_GOAL_LENGTH,
        'No current goal recorded'
      )
    }));
}

function boundedMissionContextText(value: string | undefined, maxLength: number, fallback: string): string {
  const normalized = value?.trim();
  return (normalized === undefined || normalized.length === 0 ? fallback : normalized).slice(0, maxLength);
}

function validateMissionCharacterReferences(
  mission: ChapterMission,
  characters: z.infer<typeof StoryStateSchema>['characters'],
  chapterNumber: number
): void {
  const knownCharacterIds = new Set(characters.map((character) => character.id));
  const hasUnknownCharacter = mission.characterDeltas.some((delta) => !knownCharacterIds.has(delta.characterId));
  if (!hasUnknownCharacter) return;

  throw new AppError(
    'CHAPTER_MISSION_INVALID_PROVIDER_OUTPUT',
    `Chapter ${chapterNumber} mission references a character that is not present in Story State.`,
    2,
    {
      chapterNumber,
      stage: 'mission'
    }
  );
}

async function ensurePlanningPrerequisites(paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (!(await fileStore.exists(paths.projectRoot))) {
    throw new AppError('PROJECT_NOT_FOUND', `Project not found: ${paths.projectRoot}`, 2);
  }
  if (!(await fileStore.exists(paths.storyState()))) {
    throw new AppError('STORY_STATE_NOT_FOUND', `Story State not found: ${paths.storyState()}`, 2);
  }
  if (!(await fileStore.exists(path.join(paths.planningDir(), 'chapter_queue.json')))) {
    throw new AppError('CHAPTER_QUEUE_NOT_FOUND', `Chapter queue not found for project: ${paths.projectId}`, 2);
  }
}

async function readSelectedPlanText(
  fileStore: FileStore,
  paths: ProjectPaths,
  chapterNumber: number,
  selectedCandidateId: string,
  selectedPlanPath: string
): Promise<string> {
  const directCandidatePath = paths.chapterArtifact(chapterNumber, 'plan_candidates', `${selectedCandidateId}.md`);
  if (await fileStore.exists(directCandidatePath)) {
    return fileStore.readText(directCandidatePath);
  }

  const selectedBasename = path.basename(selectedPlanPath);
  const fallbackPath = paths.chapterArtifact(chapterNumber, 'plan_candidates', selectedBasename);
  return fileStore.readText(fallbackPath);
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, ...segments);
}

function chapterFixtureScenario(chapterNumber: number): string {
  return chapterNumber === 1 ? 'default' : `chapter_${String(chapterNumber).padStart(3, '0')}`;
}
