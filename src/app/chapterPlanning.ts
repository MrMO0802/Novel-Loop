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
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  PlanCandidatesSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type { ChapterMission, ChapterPlanRanking, ChapterQueueStage, PlanCandidate } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

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
  runId?: string;
  forceStage?: ChapterQueueStage;
  failAt?: FailureInjectionPoint;
  regenerateStale?: boolean;
}

export interface GeneratePlanCandidatesInput extends ChapterPlanningInput {
  count: number;
}

export interface ChapterDryRunInput extends ChapterPlanningInput {
  candidates?: number;
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

export async function planChapterMission(input: ChapterPlanningInput, fileStore = new FileStore()): Promise<ChapterPlanningStepResult<ChapterMission>> {
  const paths = createPaths(input);
  await ensurePlanningPrerequisites(paths, fileStore);
  await fileStore.ensureDir(paths.chapterDir(input.chapterNumber));

  const promptService = createPromptService(input, fileStore);
  const llmClient = createLlmClient(input, paths, fileStore);
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const chapterQueue = await fileStore.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema);
  const promptId = input.provider === 'codex-text' ? 'planning.plan_chapter_mission_slim' : 'planning.plan_chapter_mission';
  const queueItem = chapterQueue.chapters.find((chapter) => chapter.chapterNumber === input.chapterNumber);
  const renderedPrompt =
    input.provider === 'codex-text'
      ? await promptService.renderPrompt(promptId, {
          CHAPTER_NUMBER: input.chapterNumber,
          STORY_STATE_SUMMARY: summarizeJson({
            latestCommittedChapter: storyState.latestCommittedChapter,
            openDebts: storyState.narrativeDebts.filter((debt) => debt.status !== 'resolved').slice(0, 8),
            readerExpectations: storyState.readerState.readerExpectations.slice(0, 8)
          }),
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
  const mission = await fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, 'mission.json'), missionJson, ChapterMissionSchema);
  return {
    artifact: relativeChapterArtifact(input.chapterNumber, 'mission.json'),
    value: mission
  };
}

export async function generatePlanCandidates(
  input: GeneratePlanCandidatesInput,
  fileStore = new FileStore()
): Promise<GeneratePlanCandidatesResult> {
  const paths = createPaths(input);
  await ensurePlanningPrerequisites(paths, fileStore);
  const mission = await fileStore.readJson(paths.chapterArtifact(input.chapterNumber, 'mission.json'), ChapterMissionSchema);
  const promptService = createPromptService(input, fileStore);
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

  const promptService = createPromptService(input, fileStore);
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
    await queueStore.markStageStart(input.chapterNumber, 'planning', 'mission', runId);
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
    await queueStore.markStageComplete(input.chapterNumber, 'planning', 'mission', runId);

    activeStage = 'plan_candidates';
    await queueStore.markStageStart(input.chapterNumber, 'planning', 'plan_candidates', runId);
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
    await queueStore.markStageComplete(input.chapterNumber, 'planning', 'plan_candidates', runId);

    activeStage = 'ranking';
    await queueStore.markStageStart(input.chapterNumber, 'planning', 'ranking', runId);
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
    const finalQueueItem = await queueStore.markStageComplete(input.chapterNumber, 'planned_ready', 'ranking', runId);

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
    await queueStore.markFailed(input.chapterNumber, activeStage, runId, error);
    await runLogger.recordError(runId, {
      code: 'CHAPTER_DRY_RUN_FAILED',
      message: getErrorMessage(error),
      recoverable: false
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
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

function createPromptService(input: Pick<ChapterPlanningInput, 'promptRoot' | 'provider'>, fileStore: FileStore): PromptService {
  const root = input.provider === 'codex-text' ? path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text') : input.promptRoot ?? DEFAULT_PROMPT_ROOT;
  return new PromptService(root, fileStore);
}

function createLlmClient(
  input: Pick<
    ChapterPlanningInput,
    'provider' | 'fixturesRoot' | 'runId' | 'codexBin' | 'codexProfile' | 'codexJsonRetries' | 'codexJsonRepair' | 'codexJsonRepairRetries'
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
