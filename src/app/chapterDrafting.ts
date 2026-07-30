import path from 'node:path';
import type { z } from 'zod';

import { ChapterQueueStore } from './chapterQueue.js';
import { writeCodexContextManifest } from './codexMinimalContext.js';
import { normalizeCodexOutput } from './codexNormalization.js';
import { injectFailure } from './pipelineFailure.js';
import type { FailureInjectionPoint } from './pipelineFailure.js';
import { ProviderFactory, type ProviderName } from '../llm/ProviderFactory.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import { normalizeSceneCards } from '../providers/codex/normalizers.js';
import { ChapterMissionSchema, SceneCardsSchema, StoryStateSchema } from '../schemas/index.js';
import type { ChapterQueueStage, SceneCard, SceneCards, StoryState } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export type ChapterDraftProgressStage =
  | 'preparing'
  | 'scene_cards'
  | 'scene_drafts'
  | 'draft_assembly'
  | 'finalizing'
  | 'completed';

export interface ChapterDraftProgressEvent {
  stage: ChapterDraftProgressStage;
  state: 'started' | 'completed' | 'progress';
  current?: number;
  total?: number;
}

export interface ChapterDraftingInput {
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
  codexContextBudgetBytes?: number;
  codexMaxArtifactsInContext?: number;
  codexContextMode?: 'compact' | 'balanced' | 'rich';
  runId?: string;
  forceStage?: ChapterQueueStage;
  failAt?: FailureInjectionPoint;
  regenerateStale?: boolean;
  onProgress?: (event: ChapterDraftProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
}

export interface WriteSceneInput extends ChapterDraftingInput {
  sceneCard: SceneCard;
}

export interface GenerateSceneCardsResult {
  artifact: string;
  sceneCards: SceneCard[];
}

export interface WriteSceneResult {
  artifact: string;
  sceneId: string;
  content: string;
  contextManifestPath?: string;
}

export interface AssembleChapterResult {
  artifact: string;
  content: string;
}

export interface ChapterDraftResult {
  projectId: string;
  chapterNumber: number;
  runId: string;
  status: 'draft_complete';
  artifacts: string[];
  sceneCards: SceneCard[];
  generatedArtifacts: string[];
  reusedArtifacts: string[];
  previousStatus?: string;
  newStatus?: string;
  currentStage?: ChapterQueueStage;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DEFAULT_FIXTURES_ROOT = './fixtures/llm';

export async function generateSceneCards(input: ChapterDraftingInput, fileStore = new FileStore()): Promise<GenerateSceneCardsResult> {
  const paths = createPaths(input);
  await ensureDraftPrerequisites(paths, fileStore, input.chapterNumber);
  await fileStore.ensureDir(paths.chapterDir(input.chapterNumber));

  const mission = await fileStore.readJson(paths.chapterArtifact(input.chapterNumber, 'mission.json'), ChapterMissionSchema);
  const selectedPlan = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, 'selected_plan.md'));
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const promptService = createPromptService(input, fileStore);
  const llmClient = createLlmClient(input, paths, fileStore);
  const promptId = input.provider === 'codex-text' ? 'planning.generate_scene_cards_slim' : 'planning.generate_scene_cards';
  const renderedPrompt =
    input.provider === 'codex-text'
      ? await promptService.renderPrompt(promptId, {
          CHAPTER_NUMBER: input.chapterNumber,
          MISSION_SUMMARY: summarizeJson(mission),
          SELECTED_PLAN_SUMMARY: summarizeText(selectedPlan)
        })
      : await promptService.renderPrompt(promptId, {
          CHAPTER_NUMBER: input.chapterNumber,
          MISSION_JSON: JSON.stringify(mission, null, 2),
          SELECTED_PLAN_MARKDOWN: selectedPlan,
          STORY_STATE_JSON: JSON.stringify(storyState, null, 2)
        });
  const response = await llmClient.complete({
    promptId,
    system: 'Novel Loop Engine scene planning module',
    user: renderedPrompt,
    responseFormat: 'json',
    metadata: {
      fixtureScenario: chapterFixtureScenario(input.chapterNumber)
    }
  });

  if (input.runId !== undefined) {
    await writePromptRunArtifacts(fileStore, paths, input.runId, promptId, renderedPrompt, response.text);
  }

  const sceneCardsJson =
    input.provider === 'codex-text'
      ? await normalizeCodexOutput(paths, fileStore, {
          runId: input.runId,
          promptId,
          stage: 'drafting',
          value: response.json,
          normalize: () => normalizeSceneCards(response.json, { projectId: paths.projectId, chapterNumber: input.chapterNumber })
        })
      : response.json;
  const sceneCards = await fileStore.writeJson(paths.chapterArtifact(input.chapterNumber, 'scene_cards.json'), sceneCardsJson, SceneCardsSchema);
  return {
    artifact: relativeChapterArtifact(input.chapterNumber, 'scene_cards.json'),
    sceneCards
  };
}

export async function writeScene(input: WriteSceneInput, fileStore = new FileStore()): Promise<WriteSceneResult> {
  const paths = createPaths(input);
  await ensureDraftPrerequisites(paths, fileStore, input.chapterNumber);
  await fileStore.ensureDir(paths.chapterArtifact(input.chapterNumber, 'scenes'));

  const mission = await fileStore.readJson(paths.chapterArtifact(input.chapterNumber, 'mission.json'), ChapterMissionSchema);
  const selectedPlan = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, 'selected_plan.md'));
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const contextManifest =
    input.provider === 'codex-text'
      ? await writeSceneContextManifest(paths, fileStore, {
          chapterNumber: input.chapterNumber,
          sceneCard: input.sceneCard,
          mission,
          selectedPlan,
          storyState,
          ...(input.codexContextMode === undefined ? {} : { requestedMode: input.codexContextMode }),
          ...(input.codexContextBudgetBytes === undefined ? {} : { budgetBytes: input.codexContextBudgetBytes }),
          ...(input.codexMaxArtifactsInContext === undefined ? {} : { maxArtifacts: input.codexMaxArtifactsInContext })
        })
      : undefined;
  const promptService = createPromptService(input, fileStore);
  const llmClient = createLlmClient(input, paths, fileStore);
  const renderedPrompt =
    input.provider === 'codex-text'
      ? await promptService.renderPrompt('production.write_scene', {
          SCENE_CARD_JSON: JSON.stringify(input.sceneCard, null, 2),
          STYLE_SUMMARY: summarizeText(selectedPlan)
        })
      : await promptService.renderPrompt('production.write_scene', {
          CHAPTER_NUMBER: input.chapterNumber,
          MISSION_JSON: JSON.stringify(mission, null, 2),
          SELECTED_PLAN_MARKDOWN: selectedPlan,
          SCENE_CARD_JSON: JSON.stringify(input.sceneCard, null, 2)
        });
  const response = await llmClient.complete({
    promptId: 'production.write_scene',
    system: 'Novel Loop Engine drafting module',
    user: renderedPrompt,
    responseFormat: 'markdown',
    metadata: {
      fixtureScenario: sceneFixtureScenario(input.chapterNumber, input.sceneCard.sceneId)
    }
  });

  if (input.runId !== undefined) {
    await writePromptRunArtifacts(fileStore, paths, input.runId, `production.write_scene.${input.sceneCard.sceneId}`, renderedPrompt, response.text);
  }

  const sceneFile = `${input.sceneCard.sceneId}.md`;
  const artifact = relativeChapterArtifact(input.chapterNumber, 'scenes', sceneFile);
  await fileStore.writeText(paths.chapterArtifact(input.chapterNumber, 'scenes', sceneFile), response.text);

  return {
    artifact,
    sceneId: input.sceneCard.sceneId,
    content: response.text,
    ...(contextManifest === undefined ? {} : { contextManifestPath: contextManifest.relativePath })
  };
}

export async function assembleChapter(input: ChapterDraftingInput, fileStore = new FileStore()): Promise<AssembleChapterResult> {
  const paths = createPaths(input);
  await ensureDraftPrerequisites(paths, fileStore, input.chapterNumber);
  const sceneCards = await fileStore.readJson(paths.chapterArtifact(input.chapterNumber, 'scene_cards.json'), SceneCardsSchema);
  const sortedSceneCards = sortSceneCards(sceneCards);
  const sceneDrafts: string[] = [];

  for (const sceneCard of sortedSceneCards) {
    const sceneFile = `${sceneCard.sceneId}.md`;
    const sceneText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, 'scenes', sceneFile));
    sceneDrafts.push(sceneText.trim());
  }

  const content = [`# Chapter ${formatChapterNumber(input.chapterNumber)} Draft`, ...sceneDrafts].join('\n\n');
  await fileStore.writeText(paths.chapterArtifact(input.chapterNumber, 'draft_v1.md'), `${content.trim()}\n`);

  return {
    artifact: relativeChapterArtifact(input.chapterNumber, 'draft_v1.md'),
    content
  };
}

export async function runChapterUntilDraft(input: ChapterDraftingInput, fileStore = new FileStore()): Promise<ChapterDraftResult> {
  const paths = createPaths(input);
  const runId = input.runId ?? createRunId();
  const runLogger = new RunLogger(paths, fileStore);
  const queueStore = new ChapterQueueStore(paths, fileStore);
  const artifacts: string[] = [];
  const generatedArtifacts: string[] = [];
  const reusedArtifacts: string[] = [];
  const forceRegeneration = input.regenerateStale === true;
  let activeStage: ChapterQueueStage = 'scene_cards';

  await ensureForceStageNotCommitted(input, paths, fileStore);
  const previousStatus = (await queueStore.getRequiredChapter(input.chapterNumber)).status;

  await runLogger.startRun({
    runId,
    command: 'chapter',
    args: {
      chapterNumber: input.chapterNumber,
      provider: input.provider ?? 'mock',
      until: 'draft',
      regenerateStale: input.regenerateStale ?? false
    }
  });

  try {
    await emitProgress(input.onProgress, { stage: 'preparing', state: 'started' });
    await emitProgress(input.onProgress, { stage: 'preparing', state: 'completed' });

    await emitProgress(input.onProgress, { stage: 'scene_cards', state: 'started' });
    await stopIfRequested(input, 'CHAPTER_DRAFT_CANCELLED');
    await queueStore.markStageStart(input.chapterNumber, 'drafting', 'scene_cards', runId);
    const sceneCardResult = await reuseJsonArtifact(
      fileStore,
      paths.chapterArtifact(input.chapterNumber, 'scene_cards.json'),
      relativeChapterArtifact(input.chapterNumber, 'scene_cards.json'),
      SceneCardsSchema,
      input.forceStage === 'scene_cards' || forceRegeneration,
      async () => {
        injectFailure(input, 'scene_cards');
        return generateSceneCards({ ...input, runId }, fileStore);
      }
    );
    recordArtifact(artifacts, sceneCardResult.artifact, sceneCardResult.reused ? reusedArtifacts : generatedArtifacts);
    await runLogger.recordArtifact(runId, sceneCardResult.artifact, sceneCardResult.reused ? 'reused' : 'generated');
    await queueStore.markStageComplete(input.chapterNumber, 'drafting', 'scene_cards', runId);
    await emitProgress(input.onProgress, { stage: 'scene_cards', state: 'completed' });

    activeStage = 'scene_drafts';
    await emitProgress(input.onProgress, { stage: 'scene_drafts', state: 'started' });
    await queueStore.markStageStart(input.chapterNumber, 'drafting', 'scene_drafts', runId);
    const sceneCards = sortSceneCards(sceneCardResult.sceneCards);
    for (const [index, sceneCard] of sceneCards.entries()) {
      const sceneResult = await reuseSceneDraft(
        fileStore,
        paths,
        input.chapterNumber,
        sceneCard,
        input.forceStage === 'scene_drafts' || forceRegeneration,
        async () => {
          await stopIfRequested(input, 'CHAPTER_DRAFT_CANCELLED');
          if (sceneCard.sceneId === 'scene_002') {
            injectFailure(input, 'write_scene_002');
          }
          return writeScene({ ...input, sceneCard, runId }, fileStore);
        }
      );
      recordArtifact(artifacts, sceneResult.artifact, sceneResult.reused ? reusedArtifacts : generatedArtifacts);
      await runLogger.recordArtifact(runId, sceneResult.artifact, sceneResult.reused ? 'reused' : 'generated');
      if (!sceneResult.reused && sceneResult.contextManifestPath !== undefined) {
        recordArtifact(artifacts, sceneResult.contextManifestPath, generatedArtifacts);
        await runLogger.recordArtifact(runId, sceneResult.contextManifestPath, {
          action: 'generated',
          stage: 'context',
          derivedFrom: [
            relativeChapterArtifact(input.chapterNumber, 'selected_plan.md'),
            relativeChapterArtifact(input.chapterNumber, 'scene_cards.json'),
            'state/story_state.json'
          ],
          provenanceNote: `Codex write_scene context budget manifest for ${sceneCard.sceneId}`
        });
      }
      await emitProgress(input.onProgress, { stage: 'scene_drafts', state: 'progress', current: index + 1, total: sceneCards.length });
    }
    await queueStore.markStageComplete(input.chapterNumber, 'drafting', 'scene_drafts', runId);
    await emitProgress(input.onProgress, { stage: 'scene_drafts', state: 'completed' });

    activeStage = 'draft_assembly';
    await emitProgress(input.onProgress, { stage: 'draft_assembly', state: 'started' });
    await stopIfRequested(input, 'CHAPTER_DRAFT_CANCELLED');
    await queueStore.markStageStart(input.chapterNumber, 'drafting', 'draft_assembly', runId);
    const draft = await reuseDraftAssembly(
      fileStore,
      paths,
      input.chapterNumber,
      input.forceStage === 'draft_assembly' || forceRegeneration,
      async () => assembleChapter({ ...input, runId }, fileStore)
    );
    recordArtifact(artifacts, draft.artifact, draft.reused ? reusedArtifacts : generatedArtifacts);
    await runLogger.recordArtifact(runId, draft.artifact, draft.reused ? 'reused' : 'generated');
    await emitProgress(input.onProgress, { stage: 'draft_assembly', state: 'completed' });

    await emitProgress(input.onProgress, { stage: 'finalizing', state: 'started' });
    const finalQueueItem = await queueStore.markStageComplete(input.chapterNumber, 'draft_ready', 'draft_assembly', runId);
    await emitProgress(input.onProgress, { stage: 'finalizing', state: 'completed' });
    await emitProgress(input.onProgress, { stage: 'completed', state: 'completed' });

    await runLogger.endRun(runId, 'completed');
    return {
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      runId,
      status: 'draft_complete',
      artifacts,
      sceneCards: sceneCardResult.sceneCards,
      generatedArtifacts,
      reusedArtifacts,
      previousStatus,
      newStatus: finalQueueItem.status,
      currentStage: finalQueueItem.currentStage
    };
  } catch (error) {
    await queueStore.markFailed(input.chapterNumber, activeStage, runId, error);
    const cancelled = error instanceof AppError && error.code === 'CHAPTER_DRAFT_CANCELLED';
    await runLogger.recordError(runId, {
      code: cancelled ? error.code : 'CHAPTER_DRAFT_FAILED',
      message: cancelled ? error.message : getErrorMessage(error),
      recoverable: cancelled
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

async function emitProgress(
  callback: ChapterDraftingInput['onProgress'],
  event: ChapterDraftProgressEvent
): Promise<void> {
  await callback?.(event);
}

async function stopIfRequested(
  input: Pick<ChapterDraftingInput, 'shouldStop'>,
  code: 'CHAPTER_PLANNING_CANCELLED' | 'CHAPTER_DRAFT_CANCELLED'
): Promise<void> {
  if (await input.shouldStop?.()) {
    throw new AppError(code, 'Chapter task stopped before the next generation step.', 2);
  }
}

async function ensureForceStageNotCommitted(input: ChapterDraftingInput, paths: ProjectPaths, fileStore: FileStore): Promise<void> {
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
  producer: () => Promise<GenerateSceneCardsResult>
): Promise<GenerateSceneCardsResult & { reused: boolean }> {
  if (!force && (await fileStore.exists(artifactPath))) {
    const sceneCards = await fileStore.readJson(artifactPath, schema) as SceneCards;
    return {
      artifact: relativeArtifactPath,
      sceneCards,
      reused: true
    };
  }

  const produced = await producer();
  return {
    ...produced,
    reused: false
  };
}

async function reuseSceneDraft(
  fileStore: FileStore,
  paths: ProjectPaths,
  chapterNumber: number,
  sceneCard: SceneCard,
  force: boolean,
  producer: () => Promise<WriteSceneResult>
): Promise<WriteSceneResult & { reused: boolean }> {
  const sceneFile = `${sceneCard.sceneId}.md`;
  const artifactPath = paths.chapterArtifact(chapterNumber, 'scenes', sceneFile);
  const artifact = relativeChapterArtifact(chapterNumber, 'scenes', sceneFile);
  if (!force && (await fileStore.exists(artifactPath))) {
    const content = await fileStore.readText(artifactPath);
    return {
      artifact,
      sceneId: sceneCard.sceneId,
      content,
      reused: true
    };
  }

  const produced = await producer();
  return {
    ...produced,
    reused: false
  };
}

async function reuseDraftAssembly(
  fileStore: FileStore,
  paths: ProjectPaths,
  chapterNumber: number,
  force: boolean,
  producer: () => Promise<AssembleChapterResult>
): Promise<AssembleChapterResult & { reused: boolean }> {
  const artifactPath = paths.chapterArtifact(chapterNumber, 'draft_v1.md');
  const artifact = relativeChapterArtifact(chapterNumber, 'draft_v1.md');
  if (!force && (await fileStore.exists(artifactPath))) {
    return {
      artifact,
      content: await fileStore.readText(artifactPath),
      reused: true
    };
  }

  const produced = await producer();
  return {
    ...produced,
    reused: false
  };
}

async function writeSceneContextManifest(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: {
    chapterNumber: number;
    sceneCard: SceneCard;
    mission: unknown;
    selectedPlan: string;
    storyState: StoryState;
    requestedMode?: 'compact' | 'balanced' | 'rich';
    budgetBytes?: number;
    maxArtifacts?: number;
  }
): Promise<{ relativePath: string }> {
  const previousSummaryPath = previousChapterSummaryPath(input.chapterNumber);
  const includedArtifacts = [
    {
      path: relativeChapterArtifact(input.chapterNumber, 'selected_plan.md'),
      reason: 'selected plan anchors this scene draft',
      summary: summarizeText(input.selectedPlan, 180)
    },
    {
      path: relativeChapterArtifact(input.chapterNumber, 'scene_cards.json'),
      reason: `scene card for ${input.sceneCard.sceneId}`,
      summary: summarizeJson(input.sceneCard, 260)
    },
    {
      path: 'state/story_state.json',
      reason: 'bounded Story State summary for continuity; live state is not mutated by drafting',
      summary: summarizeStoryStateForSceneContext(input.storyState)
    },
    {
      path: relativeChapterArtifact(input.chapterNumber, 'mission.json'),
      reason: 'chapter mission summary for draft constraints',
      summary: summarizeJson(input.mission, 160)
    },
    ...(previousSummaryPath === undefined
      ? []
      : [
          {
            path: previousSummaryPath,
            reason: 'previous committed chapter summary for continuity',
            summary: await fileStore.exists(paths.projectArtifact(previousSummaryPath))
              ? summarizeText(await fileStore.readText(paths.projectArtifact(previousSummaryPath)), 160)
              : 'previous summary not available'
          }
        ])
  ];
  return writeCodexContextManifest(paths, fileStore, {
    task: `write-scene:chapter_${formatChapterNumber(input.chapterNumber)}:${input.sceneCard.sceneId}`,
    includedArtifacts,
    excludedArtifacts: [
      {
        path: 'codex/runs/',
        reason: 'raw Codex run dumps are provenance-only and must not enter generation context'
      },
      {
        path: 'chapters/',
        reason: 'full chapter tree is too broad; selected plan, scene cards, and summaries are included instead'
      },
      {
        path: 'chapters/archive/',
        reason: 'old archived drafts are not prompt context for low-risk write_scene optimization'
      }
    ],
    ...(input.requestedMode === undefined ? {} : { requestedMode: input.requestedMode }),
    ...(input.budgetBytes === undefined ? {} : { budgetBytes: input.budgetBytes }),
    ...(input.maxArtifacts === undefined ? {} : { maxArtifacts: input.maxArtifacts })
  });
}

function summarizeStoryStateForSceneContext(storyState: StoryState): string {
  return summarizeJson(
    {
      latestCommittedChapter: storyState.latestCommittedChapter,
      characters: storyState.characters.slice(0, 4).map((character) => ({
        id: character.id,
        name: character.name,
        goal: character.currentGoal,
        emotionalState: character.emotionalState,
        knowledge: character.knowledge.slice(0, 3).map((knowledge) => ({
          text: knowledge.text,
          status: knowledge.status
        }))
      })),
      openDebts: storyState.narrativeDebts
        .filter((debt) => debt.status === 'open' || debt.status === 'escalated' || debt.status === 'partially_paid')
        .slice(0, 4)
        .map((debt) => ({
          id: debt.id,
          status: debt.status,
          promise: debt.promise,
          readerQuestion: debt.readerQuestion
        })),
      reader: {
        known: storyState.readerState.readerKnows.slice(0, 4),
        suspects: storyState.readerState.readerSuspects.slice(0, 4),
        expectations: storyState.readerState.readerExpectations.slice(0, 4)
      }
    },
    360
  );
}

function previousChapterSummaryPath(chapterNumber: number): string | undefined {
  if (chapterNumber <= 1) return undefined;
  return relativeChapterArtifact(chapterNumber - 1, 'chapter_summary_for_context.json');
}

function recordArtifact(allArtifacts: string[], artifact: string, bucket: string[]): void {
  if (!allArtifacts.includes(artifact)) {
    allArtifacts.push(artifact);
  }
  if (!bucket.includes(artifact)) {
    bucket.push(artifact);
  }
}

function createPaths(input: Pick<ChapterDraftingInput, 'projectId' | 'projectsRoot'>): ProjectPaths {
  return new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
}

function createPromptService(input: Pick<ChapterDraftingInput, 'promptRoot' | 'provider'>, fileStore: FileStore): PromptService {
  const root = input.provider === 'codex-text' ? path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text') : input.promptRoot ?? DEFAULT_PROMPT_ROOT;
  return new PromptService(root, fileStore);
}

function createLlmClient(
  input: Pick<
    ChapterDraftingInput,
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

function summarizeText(text: string, maxLength = 1800): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function summarizeJson(value: unknown, maxLength = 1800): string {
  const text = JSON.stringify(value, null, 2);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

async function ensureDraftPrerequisites(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  if (!(await fileStore.exists(paths.projectRoot))) {
    throw new AppError('PROJECT_NOT_FOUND', `Project not found: ${paths.projectRoot}`, 2);
  }
  if (!(await fileStore.exists(paths.storyState()))) {
    throw new AppError('STORY_STATE_NOT_FOUND', `Story State not found: ${paths.storyState()}`, 2);
  }
  if (!(await fileStore.exists(paths.chapterArtifact(chapterNumber, 'mission.json')))) {
    throw new AppError('CHAPTER_MISSION_NOT_FOUND', `Chapter mission not found for chapter ${chapterNumber}`, 2);
  }
  if (!(await fileStore.exists(paths.chapterArtifact(chapterNumber, 'selected_plan.md')))) {
    throw new AppError('SELECTED_PLAN_NOT_FOUND', `Selected plan not found for chapter ${chapterNumber}`, 2);
  }
}

function sortSceneCards(sceneCards: SceneCard[]): SceneCard[] {
  return [...sceneCards].sort((left, right) => left.order - right.order);
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

function sceneFixtureScenario(chapterNumber: number, sceneId: string): string {
  return chapterNumber === 1 ? sceneId : `chapter_${formatChapterNumber(chapterNumber)}_${sceneId}`;
}
