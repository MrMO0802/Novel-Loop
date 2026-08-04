import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

import { containsAuthorFacingInternalValue } from '../authorFacingText.js';
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
const MAX_MISSION_PLAN_CONTEXT_CHARACTERS = 20_000;
const SAFE_PLAN_CANDIDATE_ID = /^plan_[0-9]{3}$/u;

export const PARTICIPANT_REPAIR_INSTRUCTION =
  '补全本章场景所需人物，只声明已有或本章首次出场人物，不新增剧情事实。';

export type ChapterMissionAdjustmentIntent =
  | 'general'
  | 'participant_repair';

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
  missionIntent?: ChapterMissionAdjustmentIntent;
  shouldCancel?: () => boolean;
  onCommitPoint?: () => void;
  onStage?: (stage: ChapterAuthorAdjustmentStage) => void;
  promptRoot?: string;
  providerOptions?: CodexChapterAdjustmentProviderOptions;
  sourcePlan?: TrustedChapterPlanAdjustmentSource;
}

export interface ChapterAuthorAdjustmentCandidate {
  artifactKind: 'mission' | 'plan';
  title: string;
  markdown: string;
}

export interface ChapterAuthorAdjustmentResult extends CreateAuthorRevisionResult {
  candidate: ChapterAuthorAdjustmentCandidate;
  content: string;
}

const ChapterAuthorAdjustmentCandidateSchema = z.object({
  artifactKind: z.enum(['mission', 'plan']),
  title: z.string().trim().min(1).max(240).refine(isAuthorFacingText),
  markdown: z.string()
    .min(1)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= MAX_ARTIFACT_BYTES,
      { message: 'Adjustment candidate exceeds 2 MiB.' }
    )
    .refine(isAuthorFacingText)
}).strict();

interface AdjustmentContext {
  projectRoot: string;
  paths: ProjectPaths;
  store: FileStore;
  storyState: StoryState;
  mission: ChapterMission;
  missionText: string;
  selectedPlanText: string;
}

export async function adjustChapterMission(
  input: ChapterAuthorAdjustmentInput,
  fileStore?: FileStore
): Promise<ChapterAuthorAdjustmentResult> {
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
        STORY_STATE_SUMMARY: summarizeStoryState(
          context.storyState,
          relevantCharacterIds(
            context.mission,
            context.selectedPlanText,
            context.storyState
          )
        )
      }
    );
    const response = await createProvider(input, context).complete({
      promptId: MISSION_PROMPT_ID,
      system: 'Novel Loop Engine bounded chapter mission adjustment',
      user: prompt,
      responseFormat: 'json'
    });
    input.onStage?.('validating_adjustment');

    const mission = parseMissionAdjustment(
      response.json,
      context,
      missionAdjustmentIntent(input)
    );
    let candidate: ChapterAuthorAdjustmentCandidate;
    try {
      candidate = projectMissionCandidate(mission, context);
    } catch {
      throw invalidOutputError();
    }
    throwIfCancelled(input);
    await assertSourceStillCurrent(context.store, sourcePath, input.expectedSourceHash);
    const content = `${JSON.stringify(mission, null, 2)}\n`;
    const created = await createAuthorRevision({
      projectRoot: context.projectRoot,
      chapterNumber: input.chapterNumber,
      artifactKind: 'mission',
      mode: 'codex_adjustment',
      initialState: 'publishing',
      sourceArtifactPath: sourcePath,
      sourceCandidateId: null,
      expectedSourceHash: input.expectedSourceHash,
      content,
      authorInstruction: input.authorInstruction,
      assertCanCommit: () => throwIfCancelled(input),
      ...(input.onCommitPoint === undefined
        ? {}
        : { onCommitPoint: input.onCommitPoint })
    }, context.store);
    input.onStage?.('ready_for_review');
    return { ...created, candidate, content };
  });
}

export async function adjustChapterPlan(
  input: ChapterAuthorAdjustmentInput,
  fileStore?: FileStore
): Promise<ChapterAuthorAdjustmentResult> {
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
        MISSION_CONTEXT: summarizeMissionForPlan(context.mission),
        STORY_STATE_SUMMARY: summarizeStoryState(
          context.storyState,
          relevantCharacterIds(context.mission, sourceText, context.storyState)
        )
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
    let candidate: ChapterAuthorAdjustmentCandidate;
    try {
      candidate = ChapterAuthorAdjustmentCandidateSchema.parse({
        artifactKind: 'plan',
        title: adjusted.title,
        markdown: adjusted.markdown
      });
    } catch {
      throw invalidOutputError();
    }
    throwIfCancelled(input);
    await assertSourceStillCurrent(context.store, sourcePath, input.expectedSourceHash);
    const content = adjusted.markdown;
    const created = await createAuthorRevision({
      projectRoot: context.projectRoot,
      chapterNumber: input.chapterNumber,
      artifactKind: 'selected_plan',
      mode: 'codex_adjustment',
      initialState: 'publishing',
      sourceArtifactPath: sourcePath,
      sourceCandidateId: sourcePlan.candidateId,
      expectedSourceHash: input.expectedSourceHash,
      content,
      authorInstruction: input.authorInstruction,
      assertCanCommit: () => throwIfCancelled(input),
      ...(input.onCommitPoint === undefined
        ? {}
        : { onCommitPoint: input.onCommitPoint })
    }, context.store);
    input.onStage?.('ready_for_review');
    return { ...created, candidate, content };
  });
}

async function runAdjustment<T extends CreateAuthorRevisionResult>(
  input: ChapterAuthorAdjustmentInput,
  fileStore: FileStore | undefined,
  operation: (context: AdjustmentContext) => Promise<T>
): Promise<T> {
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
  context: AdjustmentContext,
  intent: ChapterMissionAdjustmentIntent
): ChapterMission {
  try {
    const normalized = normalizeMissionAdjustment(value, {
      projectId: context.paths.projectId,
      chapterNumber: context.mission.chapterNumber
    });
    const mission = intent === 'participant_repair'
      ? ChapterMissionSchema.parse({
          ...context.mission,
          participatingCharacterIds: normalized.participatingCharacterIds,
          charactersToIntroduce: normalized.charactersToIntroduce
        })
      : normalized;
    if (
      mission.id !== context.mission.id
      || mission.chapterNumber !== context.mission.chapterNumber
      || !missionObjectiveReferencesAreValid(mission, context.mission)
      || !missionCharacterReferencesAreValid(mission, context.storyState)
      || !missionDebtReferencesAreValid(mission, context.storyState)
      || !missionAuthorFacingStrings(mission).every(isAuthorFacingText)
    ) {
      throw new Error('Mission references are invalid.');
    }
    return mission;
  } catch {
    throw invalidOutputError();
  }
}

function missionAdjustmentIntent(
  input: ChapterAuthorAdjustmentInput
): ChapterMissionAdjustmentIntent {
  const fixedInstruction = input.authorInstruction
    === PARTICIPANT_REPAIR_INSTRUCTION;
  if (
    input.missionIntent === 'participant_repair'
    && !fixedInstruction
  ) {
    throw new AppError(
      'AUTHOR_ADJUSTMENT_INTENT_INVALID',
      'Participant repair intent requires the fixed participant instruction.',
      2
    );
  }
  return fixedInstruction ? 'participant_repair' : 'general';
}

function missionObjectiveReferencesAreValid(
  mission: ChapterMission,
  source: ChapterMission
): boolean {
  const sourceIds = new Set(
    source.requiredObjectives.map(({ id }) => id)
  );
  if (sourceIds.size !== source.requiredObjectives.length) return false;
  const outputIds = mission.requiredObjectives.map(({ id }) => id);
  return new Set(outputIds).size === outputIds.length
    && outputIds.every((id) => sourceIds.has(id));
}

function missionAuthorFacingStrings(mission: ChapterMission): string[] {
  return [
    mission.chapterFunction,
    ...mission.requiredObjectives.map(({ text }) => text),
    ...mission.debtsToIntroduce.map(({ promise }) => promise),
    ...mission.characterDeltas.flatMap(({ from, to, evidenceRequired }) => (
      [from, to, evidenceRequired]
    )),
    ...mission.charactersToIntroduce.flatMap(({ name, role }) => [name, role]),
    ...mission.readerInformationDelta.newKnowledge,
    ...mission.readerInformationDelta.newSuspicions,
    ...mission.readerInformationDelta.questionsToMaintain,
    ...mission.readerInformationDelta.questionsToAnswer,
    ...mission.forbiddenMoves,
    ...mission.targetEmotionalCurve
  ];
}

function projectMissionCandidate(
  mission: ChapterMission,
  context: AdjustmentContext
): ChapterAuthorAdjustmentCandidate {
  const characterLabels = new Map<string, string>();
  for (const character of context.storyState.characters) {
    characterLabels.set(character.id, `${character.name}（${character.role}）`);
  }
  for (const character of [
    ...context.mission.charactersToIntroduce,
    ...mission.charactersToIntroduce
  ]) {
    characterLabels.set(
      character.characterId,
      `${character.name}（${character.role}）`
    );
  }
  const debtLabels = new Map(
    context.storyState.narrativeDebts.map(({ id, promise }) => [id, promise])
  );
  const participants = mission.participatingCharacterIds.map((characterId) => {
    const label = characterLabels.get(characterId);
    if (label === undefined) throw new Error('Mission participant cannot be projected.');
    return label;
  });
  const advancedDebts = mission.debtsToPayOrAdvance.map((debtId) => {
    const promise = debtLabels.get(debtId);
    if (promise === undefined) throw new Error('Mission debt cannot be projected.');
    return promise;
  });
  const characterDeltas = mission.characterDeltas.map((delta) => {
    const label = characterLabels.get(delta.characterId);
    if (label === undefined) throw new Error('Mission delta cannot be projected.');
    return `${label}：${delta.from} → ${delta.to}；${delta.evidenceRequired}`;
  });
  return ChapterAuthorAdjustmentCandidateSchema.parse({
    artifactKind: 'mission',
    title: '调整后的本章任务',
    markdown: missionCandidateMarkdown([
      ['本章目的', [mission.chapterFunction]],
      ['必须完成', mission.requiredObjectives.map(({ text }) => text)],
      [
        '推进的悬念与承诺',
        [...advancedDebts, ...mission.debtsToIntroduce.map(({ promise }) => promise)]
      ],
      ['人物变化', characterDeltas],
      ['本章人物', participants],
      ['读者会知道', mission.readerInformationDelta.newKnowledge],
      ['读者会产生的猜测', mission.readerInformationDelta.newSuspicions],
      ['读者会继续追问', mission.readerInformationDelta.questionsToMaintain],
      ['本章会回答的问题', mission.readerInformationDelta.questionsToAnswer],
      ['本章不能做', mission.forbiddenMoves],
      ['情绪节奏', mission.targetEmotionalCurve],
      [
        '目标字数',
        mission.targetWordCount === undefined
          ? []
          : [`${mission.targetWordCount} 字`]
      ]
    ])
  });
}

function missionCandidateMarkdown(sections: Array<[string, string[]]>): string {
  return sections.flatMap(([title, rows]) => [
    `## ${title}`,
    '',
    rows.length > 0 ? rows.map((row) => `- ${row}`).join('\n') : '暂无',
    ''
  ]).join('\n');
}

function summarizeMissionForPlan(mission: ChapterMission): string {
  const summary = {
    chapterNumber: mission.chapterNumber,
    chapterFunction: clipText(mission.chapterFunction, 500),
    objectives: mission.requiredObjectives.slice(0, 8).map((objective) => ({
      text: clipText(objective.text, 200),
      type: objective.type,
      priority: objective.priority
    })),
    debtsToPayOrAdvance: boundedStrings(mission.debtsToPayOrAdvance, 10, 100),
    debtsToIntroduce: mission.debtsToIntroduce.slice(0, 5).map((debt) => ({
      type: clipText(debt.type, 60),
      promise: clipText(debt.promise, 200)
    })),
    participatingCharacterIds: boundedStrings(
      mission.participatingCharacterIds,
      12,
      100
    ),
    charactersToIntroduce: mission.charactersToIntroduce.slice(0, 5).map(
      (character) => ({
        characterId: clipText(character.characterId, 100),
        name: clipText(character.name, 80),
        role: clipText(character.role, 80)
      })
    ),
    characterDeltas: mission.characterDeltas.slice(0, 5).map((delta) => ({
      characterId: clipText(delta.characterId, 100),
      from: clipText(delta.from, 120),
      to: clipText(delta.to, 120),
      evidenceRequired: clipText(delta.evidenceRequired, 200)
    })),
    readerInformationDelta: {
      newKnowledge: boundedStrings(
        mission.readerInformationDelta.newKnowledge,
        4,
        160
      ),
      newSuspicions: boundedStrings(
        mission.readerInformationDelta.newSuspicions,
        4,
        160
      ),
      questionsToMaintain: boundedStrings(
        mission.readerInformationDelta.questionsToMaintain,
        4,
        160
      ),
      questionsToAnswer: boundedStrings(
        mission.readerInformationDelta.questionsToAnswer,
        4,
        160
      )
    },
    forbiddenMoves: boundedStrings(mission.forbiddenMoves, 6, 160),
    targetEmotionalCurve: boundedStrings(mission.targetEmotionalCurve, 6, 80),
    targetWordCount: mission.targetWordCount ?? null
  };
  const serialized = JSON.stringify(summary, null, 2);
  if (serialized.length <= MAX_MISSION_PLAN_CONTEXT_CHARACTERS) {
    return serialized;
  }
  return JSON.stringify({
    chapterNumber: mission.chapterNumber,
    chapterFunction: clipText(mission.chapterFunction, 200),
    objectives: mission.requiredObjectives.slice(0, 3).map((objective) => ({
      text: clipText(objective.text, 100),
      type: objective.type,
      priority: objective.priority
    })),
    forbiddenMoves: boundedStrings(mission.forbiddenMoves, 3, 100),
    targetEmotionalCurve: boundedStrings(mission.targetEmotionalCurve, 3, 80),
    targetWordCount: mission.targetWordCount ?? null
  }, null, 2);
}

function boundedStrings(
  values: string[],
  maxItems: number,
  maxCharacters: number
): string[] {
  return values.slice(0, maxItems).map((value) => clipText(value, maxCharacters));
}

function clipText(value: string, maxCharacters: number): string {
  return value.slice(0, maxCharacters);
}

function isAuthorFacingText(value: string): boolean {
  return !containsAuthorFacingInternalValue(value);
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

function summarizeStoryState(
  storyState: StoryState,
  relevantIds: readonly string[]
): string {
  const prioritizedCharacters = prioritizeStoryCharacters(storyState, relevantIds);
  const summary = {
    latestCommittedChapter: storyState.latestCommittedChapter,
    characters: prioritizedCharacters.slice(0, 5).map((character) => ({
      id: clipText(character.id, 100),
      name: clipText(character.name, 80),
      role: clipText(character.role, 80),
      currentGoal: clipText(character.currentGoal ?? '', 200),
      emotionalState: clipText(character.emotionalState ?? '', 120)
    })),
    openNarrativeDebts: storyState.narrativeDebts
      .filter(({ status }) => status !== 'resolved')
      .slice(0, 6)
      .map(({ id, promise, status }) => ({
        id: clipText(id, 100),
        promise: clipText(promise, 200),
        status
      })),
    readerQuestions: boundedStrings(
      storyState.readerState.readerQuestions,
      4,
      160
    ),
    readerExpectations: boundedStrings(
      storyState.readerState.readerExpectations,
      4,
      160
    ),
    activeWorldRules: storyState.worldRules
      .filter(({ status }) => status === 'active')
      .slice(0, 4)
      .map(({ id, rule, strictness }) => ({
        id: clipText(id, 100),
        rule: clipText(rule, 200),
        strictness
      }))
  };
  const serialized = JSON.stringify(summary, null, 2);
  if (serialized.length <= MAX_STORY_STATE_SUMMARY_CHARACTERS) {
    return serialized;
  }
  return JSON.stringify({
    latestCommittedChapter: storyState.latestCommittedChapter,
    characters: prioritizedCharacters.slice(0, 2).map((character) => ({
      id: clipText(character.id, 60),
      name: clipText(character.name, 60),
      role: clipText(character.role, 60),
      currentGoal: clipText(character.currentGoal ?? '', 80),
      emotionalState: clipText(character.emotionalState ?? '', 80)
    })),
    openNarrativeDebts: storyState.narrativeDebts
      .filter(({ status }) => status !== 'resolved')
      .slice(0, 2)
      .map(({ id, promise, status }) => ({
        id: clipText(id, 60),
        promise: clipText(promise, 80),
        status
      })),
    readerQuestions: boundedStrings(storyState.readerState.readerQuestions, 2, 80),
    readerExpectations: boundedStrings(
      storyState.readerState.readerExpectations,
      2,
      80
    ),
    activeWorldRules: storyState.worldRules
      .filter(({ status }) => status === 'active')
      .slice(0, 2)
      .map(({ id, rule, strictness }) => ({
        id: clipText(id, 60),
        rule: clipText(rule, 80),
        strictness
      }))
  }, null, 2);
}

function relevantCharacterIds(
  mission: ChapterMission,
  planText: string,
  storyState: StoryState
): string[] {
  const planReferencedIds = storyState.characters
    .map(({ id }) => id)
    .filter((characterId) => planText.includes(characterId));
  return uniqueStrings([
    ...mission.participatingCharacterIds,
    ...planReferencedIds,
    ...mission.characterDeltas.map(({ characterId }) => characterId)
  ]);
}

function prioritizeStoryCharacters(
  storyState: StoryState,
  relevantIds: readonly string[]
): StoryState['characters'] {
  const charactersById = new Map(
    storyState.characters.map((character) => [character.id, character])
  );
  const prioritized = relevantIds.flatMap((characterId) => {
    const character = charactersById.get(characterId);
    return character === undefined ? [] : [character];
  });
  const selectedIds = new Set(prioritized.map(({ id }) => id));
  return [
    ...prioritized,
    ...storyState.characters.filter(({ id }) => !selectedIds.has(id))
  ];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
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
