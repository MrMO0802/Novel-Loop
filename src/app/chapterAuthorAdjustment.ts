import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  createAuthorRevision,
  type CreateAuthorRevisionResult
} from './chapterAuthorRevision.js';
import {
  missionCharacterReferencesAreValid,
  missionDebtReferencesAreValid
} from './chapterReferenceValidation.js';
import { withProjectChapterOperationLease } from './projectOperationLease.js';
import { ProviderFactory } from '../llm/ProviderFactory.js';
import { PromptService } from '../prompts/PromptService.js';
import {
  normalizeMissionAdjustment,
  normalizePlanAdjustment
} from '../providers/codex/normalizers.js';
import {
  ChapterMissionSchema,
  StoryStateSchema,
  type ChapterMission,
  type StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError } from '../utils/AppError.js';

const MISSION_PROMPT_ID = 'planning.adjust_chapter_mission_slim';
const PLAN_PROMPT_ID = 'planning.adjust_plan_candidate_slim';
const MAX_AUTHOR_INSTRUCTION_CHARACTERS = 4_000;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_SELECTED_PLAN_CONTEXT_CHARACTERS = 20_000;
const MAX_STORY_STATE_SUMMARY_CHARACTERS = 8_000;
const SAFE_PLAN_CANDIDATE_ID = /^plan_[0-9]{3}$/u;

export type ChapterAuthorAdjustmentStage =
  | 'requesting_adjustment'
  | 'validating_adjustment'
  | 'ready_for_review';

export interface CodexChapterAdjustmentProviderOptions {
  codexBin?: string;
  codexProfile?: 'default' | 'clean' | 'debug';
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
}

export interface TrustedChapterPlanAdjustmentSource {
  candidateId: string;
  content: string;
  active: boolean;
}

export interface ChapterAuthorAdjustmentInput {
  projectRoot: string;
  chapterNumber: number;
  expectedSourceHash: string;
  authorInstruction: string;
  shouldCancel?: () => boolean;
  onStage?: (stage: ChapterAuthorAdjustmentStage) => void;
  promptRoot?: string;
  providerOptions?: CodexChapterAdjustmentProviderOptions;
  sourcePlan?: TrustedChapterPlanAdjustmentSource;
}

interface AdjustmentContext {
  projectRoot: string;
  paths: ProjectPaths;
  store: FileStore;
  storyState: StoryState;
  storyStateText: string;
  mission: ChapterMission;
  missionText: string;
  selectedPlanText: string;
}

export async function adjustChapterMission(
  input: ChapterAuthorAdjustmentInput,
  fileStore?: FileStore
): Promise<CreateAuthorRevisionResult> {
  return runAdjustment(input, fileStore, async (context) => {
    const sourcePath = context.paths.chapterArtifact(
      input.chapterNumber,
      'mission.json'
    );
    assertExpectedSource(input.expectedSourceHash, context.missionText);
    assertBoundedArtifact(context.missionText, 'chapter mission');
    throwIfCancelled(input);
    input.onStage?.('requesting_adjustment');

    const prompt = await createPromptService(input).renderPrompt(
      MISSION_PROMPT_ID,
      {
        CHAPTER_NUMBER: input.chapterNumber,
        AUTHOR_INSTRUCTION: input.authorInstruction,
        CURRENT_MISSION: context.missionText,
        SELECTED_PLAN_CONTEXT: context.selectedPlanText.slice(
          0,
          MAX_SELECTED_PLAN_CONTEXT_CHARACTERS
        ),
        STORY_STATE_SUMMARY: summarizeStoryState(context.storyState)
      }
    );
    const response = await createProvider(input, context).complete({
      promptId: MISSION_PROMPT_ID,
      system: 'Novel Loop Engine bounded chapter mission adjustment',
      user: prompt,
      responseFormat: 'json'
    });
    input.onStage?.('validating_adjustment');

    const mission = parseMissionAdjustment(response.json, context);
    throwIfCancelled(input);
    await assertSourceStillCurrent(context.store, sourcePath, input.expectedSourceHash);
    const created = await createAuthorRevision({
      projectRoot: context.projectRoot,
      chapterNumber: input.chapterNumber,
      artifactKind: 'mission',
      mode: 'codex_adjustment',
      sourceArtifactPath: sourcePath,
      sourceCandidateId: null,
      content: `${JSON.stringify(mission, null, 2)}\n`,
      authorInstruction: input.authorInstruction
    }, context.store);
    input.onStage?.('ready_for_review');
    return created;
  });
}

export async function adjustChapterPlan(
  input: ChapterAuthorAdjustmentInput,
  fileStore?: FileStore
): Promise<CreateAuthorRevisionResult> {
  return runAdjustment(input, fileStore, async (context) => {
    const sourcePlan = validateTrustedPlanSource(input.sourcePlan);
    const sourcePath = sourcePlan.active
      ? context.paths.chapterArtifact(input.chapterNumber, 'selected_plan.md')
      : context.paths.chapterArtifact(
          input.chapterNumber,
          'plan_candidates',
          `${sourcePlan.candidateId}.md`
        );
    const sourceText = await context.store.readText(sourcePath);
    assertBoundedArtifact(sourceText, 'chapter plan');
    if (sourceText !== sourcePlan.content) {
      throw staleSourceError();
    }
    assertExpectedSource(input.expectedSourceHash, sourceText);
    throwIfCancelled(input);
    input.onStage?.('requesting_adjustment');

    const prompt = await createPromptService(input).renderPrompt(
      PLAN_PROMPT_ID,
      {
        CHAPTER_NUMBER: input.chapterNumber,
        AUTHOR_INSTRUCTION: input.authorInstruction,
        CURRENT_PLAN: sourceText,
        MISSION_CONTEXT: context.missionText,
        STORY_STATE_SUMMARY: summarizeStoryState(context.storyState)
      }
    );
    const response = await createProvider(input, context).complete({
      promptId: PLAN_PROMPT_ID,
      system: 'Novel Loop Engine bounded chapter plan adjustment',
      user: prompt,
      responseFormat: 'json'
    });
    input.onStage?.('validating_adjustment');

    let adjusted;
    try {
      adjusted = normalizePlanAdjustment(response.json);
    } catch {
      throw invalidOutputError();
    }
    throwIfCancelled(input);
    await assertSourceStillCurrent(context.store, sourcePath, input.expectedSourceHash);
    const created = await createAuthorRevision({
      projectRoot: context.projectRoot,
      chapterNumber: input.chapterNumber,
      artifactKind: 'selected_plan',
      mode: 'codex_adjustment',
      sourceArtifactPath: sourcePath,
      sourceCandidateId: sourcePlan.candidateId,
      content: adjusted.markdown,
      authorInstruction: input.authorInstruction
    }, context.store);
    input.onStage?.('ready_for_review');
    return created;
  });
}

async function runAdjustment(
  input: ChapterAuthorAdjustmentInput,
  fileStore: FileStore | undefined,
  operation: (context: AdjustmentContext) => Promise<CreateAuthorRevisionResult>
): Promise<CreateAuthorRevisionResult> {
  validateInput(input);
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'chapter_author_codex_adjustment',
    allowStoryStateWrite: false
  }, async () => operation(await readContext(projectRoot, input.chapterNumber, store)));
}

async function readContext(
  projectRoot: string,
  chapterNumber: number,
  store: FileStore
): Promise<AdjustmentContext> {
  const storyStatePath = path.join(projectRoot, 'state', 'story_state.json');
  const storyStateText = await store.readText(storyStatePath);
  const storyState = StoryStateSchema.parse(JSON.parse(storyStateText) as unknown);
  const paths = new ProjectPaths(path.dirname(projectRoot), storyState.projectId);
  if (paths.projectRoot !== projectRoot) {
    throw new AppError(
      'AUTHOR_ADJUSTMENT_PROJECT_INVALID',
      'Project root does not match Story State project identity.',
      2
    );
  }
  if (chapterNumber <= storyState.latestCommittedChapter) {
    throw new AppError(
      'DESKTOP_CHAPTER_EDIT_COMMITTED',
      `Cannot adjust committed chapter ${chapterNumber}.`,
      2
    );
  }
  const missionText = await store.readText(
    paths.chapterArtifact(chapterNumber, 'mission.json')
  );
  const mission = ChapterMissionSchema.parse(JSON.parse(missionText) as unknown);
  if (mission.chapterNumber !== chapterNumber) {
    throw new AppError(
      'AUTHOR_ADJUSTMENT_SOURCE_INVALID',
      'Chapter mission identity does not match the adjustment target.',
      2
    );
  }
  const selectedPlanText = await store.readText(
    paths.chapterArtifact(chapterNumber, 'selected_plan.md')
  );
  return {
    projectRoot,
    paths,
    store,
    storyState,
    storyStateText,
    mission,
    missionText,
    selectedPlanText
  };
}

function createPromptService(
  input: ChapterAuthorAdjustmentInput
): PromptService {
  const root = path.join(input.promptRoot ?? path.resolve('prompts'), 'codex-text');
  return new PromptService(root, new FileStore());
}

function createProvider(
  input: ChapterAuthorAdjustmentInput,
  context: AdjustmentContext
) {
  const options = input.providerOptions;
  return ProviderFactory.create({
    provider: 'codex-text',
    projectsRoot: context.paths.projectsRoot,
    projectId: context.paths.projectId,
    codexProfile: options?.codexProfile ?? 'clean',
    codexJsonRetries: options?.codexJsonRetries ?? 1,
    codexJsonRepair: options?.codexJsonRepair ?? true,
    codexJsonRepairRetries: options?.codexJsonRepairRetries ?? 1,
    ...(options?.codexBin === undefined ? {} : { codexBin: options.codexBin }),
    ...(options?.codexTimeoutMs === undefined
      ? {}
      : { codexTimeoutMs: options.codexTimeoutMs })
  });
}

function parseMissionAdjustment(
  value: unknown,
  context: AdjustmentContext
): ChapterMission {
  try {
    const mission = normalizeMissionAdjustment(value, {
      projectId: context.paths.projectId,
      chapterNumber: context.mission.chapterNumber
    });
    if (
      mission.chapterNumber !== context.mission.chapterNumber
      || !missionCharacterReferencesAreValid(mission, context.storyState)
      || !missionDebtReferencesAreValid(mission, context.storyState)
    ) {
      throw new Error('Mission references are invalid.');
    }
    return mission;
  } catch {
    throw invalidOutputError();
  }
}

function validateInput(input: ChapterAuthorAdjustmentInput): void {
  if (!Number.isInteger(input.chapterNumber) || input.chapterNumber < 1) {
    throw new AppError(
      'AUTHOR_ADJUSTMENT_TARGET_INVALID',
      'Chapter number must be a positive integer.',
      2
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(input.expectedSourceHash)) {
    throw new AppError(
      'AUTHOR_REVISION_SOURCE_STALE',
      'Source artifact hash does not match.',
      2
    );
  }
  if (
    input.authorInstruction.trim().length === 0
    || input.authorInstruction.length > MAX_AUTHOR_INSTRUCTION_CHARACTERS
  ) {
    throw new AppError(
      'AUTHOR_ADJUSTMENT_INSTRUCTION_INVALID',
      'Author adjustment instruction must contain 1 to 4,000 characters.',
      2
    );
  }
}

function validateTrustedPlanSource(
  source: TrustedChapterPlanAdjustmentSource | undefined
): TrustedChapterPlanAdjustmentSource {
  if (
    source === undefined
    || !SAFE_PLAN_CANDIDATE_ID.test(source.candidateId)
    || source.content.trim().length === 0
    || Buffer.byteLength(source.content, 'utf8') > MAX_ARTIFACT_BYTES
  ) {
    throw new AppError(
      'AUTHOR_ADJUSTMENT_SOURCE_INVALID',
      'Trusted plan adjustment source is invalid.',
      2
    );
  }
  return source;
}

function assertExpectedSource(expectedHash: string, content: string): void {
  if (sha256(content) !== expectedHash) throw staleSourceError();
}

async function assertSourceStillCurrent(
  store: FileStore,
  sourcePath: string,
  expectedHash: string
): Promise<void> {
  assertExpectedSource(expectedHash, await store.readText(sourcePath));
}

function assertBoundedArtifact(content: string, label: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_ARTIFACT_BYTES) {
    throw new AppError(
      'AUTHOR_ADJUSTMENT_SOURCE_INVALID',
      `${label} exceeds the adjustment input limit.`,
      2
    );
  }
}

function throwIfCancelled(input: ChapterAuthorAdjustmentInput): void {
  if (input.shouldCancel?.() !== true) return;
  throw new AppError(
    'CHAPTER_ADJUSTMENT_CANCELLED',
    'Chapter adjustment was cancelled.',
    2,
    { chapterNumber: input.chapterNumber, storyStateMutated: false }
  );
}

function summarizeStoryState(storyState: StoryState): string {
  const summary = JSON.stringify({
    latestCommittedChapter: storyState.latestCommittedChapter,
    characters: storyState.characters.slice(0, 32).map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role,
      currentGoal: character.currentGoal,
      emotionalState: character.emotionalState
    })),
    openNarrativeDebts: storyState.narrativeDebts
      .filter(({ status }) => status !== 'resolved')
      .slice(0, 50)
      .map(({ id, promise, status }) => ({ id, promise, status })),
    readerQuestions: storyState.readerState.readerQuestions.slice(0, 50),
    readerExpectations: storyState.readerState.readerExpectations.slice(0, 50),
    activeWorldRules: storyState.worldRules
      .filter(({ status }) => status === 'active')
      .slice(0, 50)
      .map(({ id, rule, strictness }) => ({ id, rule, strictness }))
  }, null, 2);
  return summary.slice(0, MAX_STORY_STATE_SUMMARY_CHARACTERS);
}

function invalidOutputError(): AppError {
  return new AppError(
    'CHAPTER_ADJUSTMENT_INVALID_OUTPUT',
    'Codex returned an invalid chapter adjustment.',
    2,
    { storyStateMutated: false, queueMutated: false }
  );
}

function staleSourceError(): AppError {
  return new AppError(
    'AUTHOR_REVISION_SOURCE_STALE',
    'Source artifact changed before the adjustment could be stored.',
    2,
    { storyStateMutated: false, queueMutated: false }
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
