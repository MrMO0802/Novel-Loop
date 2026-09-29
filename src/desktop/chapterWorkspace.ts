import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  runChapterUntilDraft,
  type ChapterDraftProgressEvent
} from '../app/chapterDrafting.js';
import {
  missionCharacterReferencesAreValid,
  missionDebtReferencesAreValid
} from '../app/chapterReferenceValidation.js';
import { readLatestAdoptedDraft } from '../app/chapterAuthorRevision.js';
import {
  runChapterDryRun,
  type ChapterPlanningProgressEvent
} from '../app/chapterPlanning.js';
import { validateChapterQueueConsistency } from '../app/chapterQueue.js';
import {
  ChapterMissionSchema,
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  ProjectIdSchema,
  SceneCardsSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type { ChapterQueueStage, ChapterQueueStatus } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import {
  MAX_DESKTOP_PLAN_CANDIDATES,
  MAX_PLAN_CANDIDATE_BYTES,
  MAX_PLAN_CANDIDATES_BYTES,
  expectedPlanCandidateIds,
  utf8Bytes
} from '../utils/chapterWorkloadLimits.js';
import { AppError } from '../utils/AppError.js';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_BYTES = 4 * 1024 * 1024;
const MAX_CANDIDATE_EXCERPT_CHARS = 2_000;
const MAX_ALTERNATIVES = 10;
const MAX_MISSION_OBJECTIVES = 100;
const MAX_SCENE_SUMMARIES = 100;
const MAX_AUTHOR_MISSION_TEXT = 2_000;

const AuthorMissionTextSchema = z.string()
  .trim()
  .min(1)
  .max(MAX_AUTHOR_MISSION_TEXT)
  .refine(
    (text) => !/\b(?:char|debt|mission|obj)_[A-Za-z0-9_-]+\b|story_state|runId|taskId/u.test(text),
    { message: 'Author-facing text contains an internal identifier.' }
  );

const DesktopChapterPlanReviewSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(false) }).strict(),
  z.object({
    available: z.literal(true),
    chapterNumber: z.number().int().positive(),
    title: z.string().min(1),
    mission: z.object({
      chapterFunction: z.string(),
      objectives: z.array(z.string()).max(MAX_MISSION_OBJECTIVES),
      readerKnowledge: z.array(z.string()),
      readerQuestions: z.array(z.string()),
      narrativePromises: z.array(AuthorMissionTextSchema)
        .max(MAX_MISSION_OBJECTIVES),
      characterDeltas: z.array(AuthorMissionTextSchema)
        .max(MAX_MISSION_OBJECTIVES),
      forbiddenMoves: z.array(z.string())
    }).strict(),
    selectedPlan: z.object({ title: z.string().min(1), markdown: z.string() }).strict(),
    alternatives: z.array(z.object({
      title: z.string().min(1),
      excerpt: z.string(),
      strengths: z.array(z.string()),
      risks: z.array(z.string())
    }).strict()).max(MAX_ALTERNATIVES)
  }).strict()
]);

const DesktopChapterDraftReviewSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(false) }).strict(),
  z.object({
    available: z.literal(true),
    chapterNumber: z.number().int().positive(),
    title: z.string().min(1),
    markdown: z.string(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
    versionKind: z.enum(['generated', 'author_adopted']),
    scenes: z.array(z.object({ summary: z.string() }).strict()).max(MAX_SCENE_SUMMARIES)
  }).strict()
]);

export interface DesktopChapterPlanningInput {
  projectRoot: string;
  onProgress?: (event: ChapterPlanningProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
}

export interface DesktopChapterDraftingInput {
  projectRoot: string;
  onProgress?: (event: ChapterDraftProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
}

export type DesktopNextChapterInspection =
  | { available: false; reason: 'global_plan_missing' | 'chapter_missing' }
  | {
      available: true;
      chapterNumber: number;
      title: string;
      phase: 'not_started' | 'planning_partial' | 'plan_ready' | 'drafting_partial' | 'draft_ready';
    };

export type DesktopChapterPlanReview = z.infer<typeof DesktopChapterPlanReviewSchema>;
export type DesktopChapterDraftReview = z.infer<typeof DesktopChapterDraftReviewSchema>;

export async function inspectDesktopNextChapter(
  input: { projectRoot: string }
): Promise<DesktopNextChapterInspection> {
  const context = createContext(input.projectRoot);
  await assertDesktopArtifactPathsSafe(context.paths);
  const storyState = await readRequiredJson(context.paths.storyState(), StoryStateSchema);
  if (storyState.projectId !== context.projectId) {
    throw invalidChapterOutput('Story State project identity does not match the project root.');
  }
  const queue = await readOptionalJson(context.paths.chapterQueue(), ChapterQueueSchema);
  if (queue === undefined) return { available: false, reason: 'global_plan_missing' };
  if (queue.projectId !== context.projectId) {
    throw invalidChapterOutput('Chapter queue project identity does not match the project root.');
  }

  const chapterNumber = storyState.latestCommittedChapter + 1;
  const queueIssues = validateChapterQueueConsistency(queue, storyState);
  if (queueIssues.length > 0) {
    throw invalidChapterOutput('The chapter queue disagrees with the canonical Story State.');
  }
  const queueItem = queue.chapters.find((chapter) => chapter.chapterNumber === chapterNumber);
  if (queueItem === undefined) return { available: false, reason: 'chapter_missing' };
  if (queueItem.status === 'stale_due_to_history_edit') {
    throw new AppError(
      'DESKTOP_CHAPTER_STALE',
      'The next chapter requires the history-edit recovery flow.',
      2
    );
  }
  if (queueItem.status === 'committed' || queueItem.chapterNumber <= storyState.latestCommittedChapter) {
    throw invalidChapterOutput('The next chapter is already committed.');
  }

  const phase = await inspectPhase(context.paths, chapterNumber);
  assertDesktopTargetPhase(queueItem.status, queueItem.currentStage, phase);
  return { available: true, chapterNumber, title: queueItem.title, phase };
}

export async function planDesktopNextChapter(
  input: DesktopChapterPlanningInput
): Promise<{ chapterNumber: number; completed: true }> {
  const context = createContext(input.projectRoot);
  const inspection = await inspectDesktopNextChapter({ projectRoot: context.projectRoot });
  if (!inspection.available) throw unavailableNextChapter(inspection.reason);
  const fileStore = FileStore.forProject(context.projectRoot);

  const result = await runChapterDryRun({
    projectId: context.projectId,
    projectsRoot: context.projectsRoot,
    chapterNumber: inspection.chapterNumber,
    provider: 'codex-text',
    candidates: 3,
    enforceDesktopQueueTransitions: true,
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    ...(input.shouldStop === undefined ? {} : { shouldStop: input.shouldStop })
  }, fileStore);
  if (result.chapterNumber !== inspection.chapterNumber || result.status !== 'dry_run_complete') {
    throw invalidChapterOutput('Chapter planning did not complete the requested chapter.');
  }
  return { chapterNumber: inspection.chapterNumber, completed: true };
}

export async function readDesktopChapterPlan(
  input: { projectRoot: string }
): Promise<DesktopChapterPlanReview> {
  const context = createContext(input.projectRoot);
  const inspection = await inspectDesktopNextChapter({ projectRoot: context.projectRoot });
  if (!inspection.available || (inspection.phase !== 'plan_ready' && inspection.phase !== 'drafting_partial' && inspection.phase !== 'draft_ready')) {
    return DesktopChapterPlanReviewSchema.parse({ available: false });
  }

  const plan = await readPlanArtifacts(context.paths, inspection.chapterNumber);
  const storyState = await readRequiredJson(
    context.paths.storyState(),
    StoryStateSchema
  );
  if (!missionCharacterReferencesAreValid(plan.mission, storyState)) {
    throw invalidChapterOutput('The chapter mission contains invalid character references.');
  }
  return parseReview(DesktopChapterPlanReviewSchema, {
    available: true,
    chapterNumber: inspection.chapterNumber,
    title: inspection.title,
    mission: {
      chapterFunction: plan.mission.chapterFunction,
      objectives: plan.mission.requiredObjectives.slice(0, MAX_MISSION_OBJECTIVES).map((objective) => objective.text),
      readerKnowledge: plan.mission.readerInformationDelta.newKnowledge,
      readerQuestions: plan.mission.readerInformationDelta.questionsToMaintain,
      narrativePromises: narrativePromisesForAuthor(
        plan.mission,
        storyState
      ),
      characterDeltas: characterDeltasForAuthor(
        plan.mission,
        storyState
      ),
      forbiddenMoves: plan.mission.forbiddenMoves
    },
    selectedPlan: {
      title: localizedPlanTitle(
        plan.selectedPlan,
        plan.ranking.candidates.findIndex(
          (candidate) => candidate.candidateId === plan.ranking.selectedCandidateId
        ) + 1
      ),
      markdown: plan.selectedPlan
    },
    alternatives: plan.ranking.candidates
      .map((candidate, index) => ({ candidate, ordinal: index + 1 }))
      .filter(({ candidate }) => candidate.candidateId !== plan.ranking.selectedCandidateId)
      .slice(0, MAX_ALTERNATIVES)
      .map(({ candidate, ordinal }) => {
        const markdown = plan.candidates.get(candidate.candidateId);
        if (markdown === undefined) throw invalidChapterOutput('A ranked plan candidate is missing.');
        return {
          title: localizedPlanTitle(markdown, ordinal),
          excerpt: markdownExcerpt(markdown),
          strengths: candidate.strengths,
          risks: candidate.risks
        };
      })
  });
}

function narrativePromisesForAuthor(
  mission: ReturnType<typeof ChapterMissionSchema.parse>,
  storyState: ReturnType<typeof StoryStateSchema.parse>
): string[] {
  if (!missionDebtReferencesAreValid(mission, storyState)) {
    throw invalidChapterOutput('The chapter mission contains invalid narrative references.');
  }
  const knownDebts = new Map(
    storyState.narrativeDebts.map((debt) => [debt.id, debt.promise])
  );
  return uniqueAuthorText([
    ...mission.debtsToPayOrAdvance.map((debtId) => knownDebts.get(debtId)!),
    ...mission.debtsToIntroduce.map((debt) => debt.promise)
  ]);
}

function characterDeltasForAuthor(
  mission: ReturnType<typeof ChapterMissionSchema.parse>,
  storyState: ReturnType<typeof StoryStateSchema.parse>
): string[] {
  const characterNames = new Map(
    [
      ...storyState.characters.map((character) => [character.id, character.name] as const),
      ...mission.charactersToIntroduce.map((character) => [
        character.characterId,
        character.name
      ] as const)
    ]
  );
  return uniqueAuthorText(mission.characterDeltas.map((delta) => {
    const name = characterNames.get(delta.characterId) ?? '相关人物';
    return `${name}：从“${delta.from}”转向“${delta.to}”；通过${delta.evidenceRequired}体现。`;
  }));
}

function uniqueAuthorText(items: string[]): string[] {
  const unique = new Set<string>();
  for (const item of items) {
    const parsed = AuthorMissionTextSchema.parse(item);
    unique.add(parsed);
    if (unique.size === MAX_MISSION_OBJECTIVES) break;
  }
  return [...unique];
}

export async function draftDesktopNextChapter(
  input: DesktopChapterDraftingInput
): Promise<{ chapterNumber: number; completed: true }> {
  const context = createContext(input.projectRoot);
  const inspection = await inspectDesktopNextChapter({ projectRoot: context.projectRoot });
  if (!inspection.available) throw unavailableNextChapter(inspection.reason);
  const fileStore = FileStore.forProject(context.projectRoot);

  const result = await runChapterUntilDraft({
    projectId: context.projectId,
    projectsRoot: context.projectsRoot,
    chapterNumber: inspection.chapterNumber,
    provider: 'codex-text',
    enforceDesktopQueueTransitions: true,
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    ...(input.shouldStop === undefined ? {} : { shouldStop: input.shouldStop })
  }, fileStore);
  if (result.chapterNumber !== inspection.chapterNumber || result.status !== 'draft_complete') {
    throw invalidChapterOutput('Chapter drafting did not complete the requested chapter.');
  }
  return { chapterNumber: inspection.chapterNumber, completed: true };
}

export async function readDesktopChapterDraft(
  input: { projectRoot: string }
): Promise<DesktopChapterDraftReview> {
  const context = createContext(input.projectRoot);
  const inspection = await inspectDesktopNextChapter({ projectRoot: context.projectRoot });
  if (!inspection.available || inspection.phase !== 'draft_ready') {
    return DesktopChapterDraftReviewSchema.parse({ available: false });
  }

  const sceneCards = await readRequiredJson(
    context.paths.chapterArtifact(inspection.chapterNumber, 'scene_cards.json'),
    SceneCardsSchema
  );
  const adopted = await readLatestAdoptedDraft({
    projectRoot: context.projectRoot,
    chapterNumber: inspection.chapterNumber
  });
  const markdown = adopted?.content ?? await readRequiredMarkdown(
    context.paths.chapterArtifact(inspection.chapterNumber, 'draft_v1.md')
  );
  return parseReview(DesktopChapterDraftReviewSchema, {
    available: true,
    chapterNumber: inspection.chapterNumber,
    title: inspection.title,
    markdown,
    sourceHash: sha256(markdown),
    versionKind: adopted === null ? 'generated' : 'author_adopted',
    scenes: [...sceneCards]
      .sort((left, right) => left.order - right.order)
      .slice(0, MAX_SCENE_SUMMARIES)
      .map((scene) => ({ summary: scene.purpose }))
  });
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function createContext(projectRootInput: string): { projectRoot: string; projectsRoot: string; projectId: string; paths: ProjectPaths } {
  const projectRoot = path.resolve(projectRootInput);
  const projectId = ProjectIdSchema.parse(path.basename(projectRoot));
  const projectsRoot = path.dirname(projectRoot);
  return { projectRoot, projectsRoot, projectId, paths: new ProjectPaths(projectsRoot, projectId) };
}

async function assertDesktopArtifactPathsSafe(paths: ProjectPaths): Promise<void> {
  const fileStore = FileStore.forProject(paths.projectRoot);
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const chapterNumber = storyState.latestCommittedChapter + 1;
  for (const artifactPath of [
    paths.chaptersDir(),
    paths.chapterDir(chapterNumber),
    paths.chapterArtifact(chapterNumber, 'scenes'),
    paths.runsDir(),
    paths.projectArtifact('codex'),
    paths.projectArtifact(path.posix.join('codex', 'runs'))
  ]) {
    await fileStore.assertSafePath(artifactPath);
  }
}

type DesktopChapterPhase = Extract<DesktopNextChapterInspection, { available: true }>['phase'];

interface DesktopTargetPhaseRule {
  statuses: ReadonlySet<ChapterQueueStatus>;
  stages: ReadonlySet<ChapterQueueStage>;
}

const PLANNING_STAGES = new Set<ChapterQueueStage>(['none', 'mission', 'plan_candidates', 'ranking']);
const DRAFTING_STAGES = new Set<ChapterQueueStage>(['scene_cards', 'scene_drafts', 'draft_assembly']);

const DESKTOP_TARGET_RULES_BY_PHASE: Readonly<Record<DesktopChapterPhase, DesktopTargetPhaseRule>> = {
  not_started: { statuses: new Set(['planned', 'planning', 'failed']), stages: PLANNING_STAGES },
  planning_partial: { statuses: new Set(['planning', 'failed']), stages: PLANNING_STAGES },
  plan_ready: { statuses: new Set(['planning', 'planned_ready', 'failed']), stages: PLANNING_STAGES },
  drafting_partial: { statuses: new Set(['drafting', 'failed']), stages: DRAFTING_STAGES },
  draft_ready: { statuses: new Set(['drafting', 'draft_ready', 'failed']), stages: DRAFTING_STAGES }
};
const DESKTOP_FAILED_RECOVERY_STAGES_BY_PHASE: Readonly<Partial<Record<
  DesktopChapterPhase,
  ReadonlySet<ChapterQueueStage>
>>> = {
  plan_ready: new Set(['scene_cards'])
};

function assertDesktopTargetPhase(
  status: ChapterQueueStatus,
  stage: ChapterQueueStage,
  phase: DesktopChapterPhase
): void {
  const rule = DESKTOP_TARGET_RULES_BY_PHASE[phase];
  const failedRecoveryStages = DESKTOP_FAILED_RECOVERY_STAGES_BY_PHASE[phase];
  if (status === 'failed' && failedRecoveryStages?.has(stage) === true) return;
  if (!rule.statuses.has(status) || !rule.stages.has(stage)) {
    throw invalidChapterOutput('The next chapter lifecycle status does not match its artifacts.');
  }
}

async function inspectPhase(
  paths: ProjectPaths,
  chapterNumber: number
): Promise<'not_started' | 'planning_partial' | 'plan_ready' | 'drafting_partial' | 'draft_ready'> {
  const missionPath = paths.chapterArtifact(chapterNumber, 'mission.json');
  const candidateDir = paths.chapterArtifact(chapterNumber, 'plan_candidates');
  const rankingPath = paths.chapterArtifact(chapterNumber, 'ranking.json');
  const selectedPlanPath = paths.chapterArtifact(chapterNumber, 'selected_plan.md');
  const sceneCardsPath = paths.chapterArtifact(chapterNumber, 'scene_cards.json');
  const scenesDir = paths.chapterArtifact(chapterNumber, 'scenes');
  const draftPath = paths.chapterArtifact(chapterNumber, 'draft_v1.md');
  const [missionPresent, candidatesPresent, rankingPresent, selectedPlanPresent, sceneCardsPresent, scenesPresent, draftPresent] = await Promise.all([
    pathExists(missionPath),
    pathExists(candidateDir),
    pathExists(rankingPath),
    pathExists(selectedPlanPath),
    pathExists(sceneCardsPath),
    pathExists(scenesDir),
    pathExists(draftPath)
  ]);
  const laterPlanningPresent = rankingPresent || selectedPlanPresent || sceneCardsPresent || scenesPresent || draftPresent;
  const laterDraftingPresent = sceneCardsPresent || scenesPresent || draftPresent;
  if (!missionPresent) {
    if (candidatesPresent || laterPlanningPresent) {
      throw invalidChapterOutput('The planning artifact set is incomplete.');
    }
    return 'not_started';
  }
  await readRequiredJson(missionPath, ChapterMissionSchema);
  if (!candidatesPresent) {
    if (laterPlanningPresent) {
      throw invalidChapterOutput('The planning artifact set is incomplete.');
    }
    return 'planning_partial';
  }
  await requireDirectory(candidateDir);
  if (!rankingPresent) {
    if (selectedPlanPresent || laterDraftingPresent) {
      throw invalidChapterOutput('The planning artifact set is incomplete.');
    }
    await validateCandidateDirectory(candidateDir);
    return 'planning_partial';
  }
  await readPlanRankingArtifacts(paths, chapterNumber);
  if (!selectedPlanPresent) {
    if (laterDraftingPresent) {
      throw invalidChapterOutput('The planning artifact set is incomplete.');
    }
    return 'planning_partial';
  }
  await readPlanArtifacts(paths, chapterNumber);
  if (!sceneCardsPresent) {
    if (scenesPresent || draftPresent) {
      throw invalidChapterOutput('The drafting artifact set is incomplete.');
    }
    return 'plan_ready';
  }
  const sceneCards = await readRequiredJson(sceneCardsPath, SceneCardsSchema);
  if (!scenesPresent) {
    if (draftPresent) {
      throw invalidChapterOutput('The drafting artifact set is incomplete.');
    }
    return 'drafting_partial';
  }
  await requireDirectory(scenesDir);
  for (const scene of sceneCards) {
    const scenePath = paths.chapterArtifact(chapterNumber, 'scenes', `${scene.sceneId}.md`);
    if (!(await pathExists(scenePath))) {
      if (draftPresent) {
        throw invalidChapterOutput('The drafting artifact set is incomplete.');
      }
      return 'drafting_partial';
    }
    await readRequiredMarkdown(scenePath);
  }
  if (!draftPresent) return 'drafting_partial';
  await readRequiredMarkdown(draftPath);
  return 'draft_ready';
}

async function readPlanArtifacts(paths: ProjectPaths, chapterNumber: number) {
  const plan = await readPlanRankingArtifacts(paths, chapterNumber);
  return {
    ...plan,
    selectedPlan: await readRequiredMarkdown(paths.chapterArtifact(chapterNumber, 'selected_plan.md'))
  };
}

async function readPlanRankingArtifacts(paths: ProjectPaths, chapterNumber: number) {
  const [mission, ranking] = await Promise.all([
    readRequiredJson(paths.chapterArtifact(chapterNumber, 'mission.json'), ChapterMissionSchema),
    readRequiredJson(paths.chapterArtifact(chapterNumber, 'ranking.json'), ChapterPlanRankingSchema)
  ]);
  if (ranking.chapterNumber !== chapterNumber || mission.chapterNumber !== chapterNumber) {
    throw invalidChapterOutput('A planning artifact belongs to a different chapter.');
  }
  if (ranking.candidates.length > MAX_ALTERNATIVES) {
    throw invalidChapterOutput('The chapter plan has too many alternatives for the desktop review.');
  }
  const candidateIds = new Set<string>();
  const candidates = new Map<string, string>();
  for (const candidate of ranking.candidates) {
    if (!/^[A-Za-z0-9_-]+$/.test(candidate.candidateId) || candidateIds.has(candidate.candidateId)) {
      throw invalidChapterOutput('The chapter plan ranking contains an invalid candidate.');
    }
    candidateIds.add(candidate.candidateId);
  }
  if (!candidateIds.has(ranking.selectedCandidateId)) {
    throw invalidChapterOutput('The selected chapter plan is not ranked.');
  }
  await validateRankedCandidateDirectory(paths, chapterNumber, candidateIds);
  for (const candidateId of candidateIds) {
    candidates.set(
      candidateId,
      await readRequiredMarkdown(paths.chapterArtifact(chapterNumber, 'plan_candidates', `${candidateId}.md`))
    );
  }
  return { mission, ranking, candidates };
}

async function validateRankedCandidateDirectory(
  paths: ProjectPaths,
  chapterNumber: number,
  candidateIds: Set<string>
): Promise<void> {
  const directoryPath = paths.chapterArtifact(chapterNumber, 'plan_candidates');
  await requireDirectory(directoryPath);
  const entries = await readdir(directoryPath);
  const expectedFileNames = new Set([...candidateIds].map((candidateId) => `${candidateId}.md`));
  if (entries.length !== expectedFileNames.size) {
    throw invalidChapterOutput('The plan candidate directory does not match the ranking.');
  }
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry);
    let stat;
    try {
      stat = await lstat(entryPath);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw invalidChapterOutput('A plan candidate changed while it was being validated.');
      }
      throw error;
    }
    if (!stat.isFile() || !entry.endsWith('.md') || !expectedFileNames.delete(entry)) {
      throw invalidChapterOutput('The plan candidate directory does not match the ranking.');
    }
  }
  if (expectedFileNames.size !== 0) {
    throw invalidChapterOutput('A ranked plan candidate is missing.');
  }
}

async function validateCandidateDirectory(directoryPath: string): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const expectedFileNames = new Set(
    expectedPlanCandidateIds(MAX_DESKTOP_PLAN_CANDIDATES)
      .map((candidateId) => `${candidateId}.md`)
  );
  if (
    entries.length === 0
    || entries.length > MAX_DESKTOP_PLAN_CANDIDATES
    || entries.some((entry) => (
      !entry.isFile()
      || !expectedFileNames.delete(entry.name)
    ))
  ) {
    throw invalidChapterOutput('The plan candidate set is invalid.');
  }
  let aggregateBytes = 0;
  for (const entry of entries) {
    const markdown = await readRequiredMarkdown(path.join(directoryPath, entry.name));
    const sizeBytes = utf8Bytes(markdown);
    aggregateBytes += sizeBytes;
    if (
      markdown.trim().length === 0
      || sizeBytes > MAX_PLAN_CANDIDATE_BYTES
      || aggregateBytes > MAX_PLAN_CANDIDATES_BYTES
    ) {
      throw invalidChapterOutput('The plan candidate set is invalid.');
    }
  }
}

async function readRequiredJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  await requireRegularFile(filePath, MAX_JSON_BYTES);
  try {
    const value = await new FileStore().readJson(filePath, schema);
    await requireRegularFile(filePath, MAX_JSON_BYTES);
    return value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidChapterOutput('A chapter JSON artifact is invalid.');
  }
}

async function readOptionalJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T | undefined> {
  if (!(await pathExists(filePath))) return undefined;
  return readRequiredJson(filePath, schema);
}

async function readRequiredMarkdown(filePath: string): Promise<string> {
  await requireRegularFile(filePath, MAX_MARKDOWN_BYTES);
  try {
    const value = await new FileStore().readText(filePath);
    if (Buffer.byteLength(value, 'utf8') > MAX_MARKDOWN_BYTES) {
      throw invalidChapterOutput('A chapter Markdown artifact changed while it was being read.');
    }
    return value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidChapterOutput('A chapter Markdown artifact could not be read.');
  }
}

async function requireRegularFile(filePath: string, maxBytes: number): Promise<void> {
  let stat;
  try {
    stat = await lstat(filePath);
  } catch (error) {
    if (isNotFoundError(error)) throw invalidChapterOutput('A required chapter artifact is missing.');
    throw error;
  }
  if (!stat.isFile()) throw invalidChapterOutput('A chapter artifact is not a regular file.');
  if (stat.size > maxBytes) throw invalidChapterOutput('A chapter artifact exceeds the desktop review size limit.');
}

async function requireDirectory(directoryPath: string): Promise<void> {
  try {
    if (!(await lstat(directoryPath)).isDirectory()) {
      throw invalidChapterOutput('A chapter artifact directory is invalid.');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isNotFoundError(error)) throw invalidChapterOutput('A required chapter artifact directory is missing.');
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function localizedPlanTitle(markdown: string, ordinal: number): string {
  const heading = markdown.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line));
  return heading?.replace(/^#\s+/u, '').trim()
    || `方案${['一', '二', '三', '四', '五'][ordinal - 1] ?? ordinal}`;
}

function markdownExcerpt(markdown: string): string {
  const firstParagraph = markdown
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\r?\n/g, ' ').trim())
    .find((paragraph) => paragraph.length > 0 && !/^#\s/.test(paragraph));
  return (firstParagraph ?? '').slice(0, MAX_CANDIDATE_EXCERPT_CHARS).trim();
}

function parseReview<T>(schema: z.ZodType<T>, value: unknown): T {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_REVIEW_BYTES) {
    throw invalidChapterOutput('The desktop chapter review exceeds the payload size limit.');
  }
  try {
    return schema.parse(value);
  } catch {
    throw invalidChapterOutput('The desktop chapter review is invalid.');
  }
}

function unavailableNextChapter(reason: 'global_plan_missing' | 'chapter_missing'): AppError {
  return new AppError('DESKTOP_CHAPTER_UNAVAILABLE', `The next chapter is unavailable: ${reason}.`, 2);
}

function invalidChapterOutput(message: string): AppError {
  return new AppError('DESKTOP_CHAPTER_INVALID_OUTPUT', message, 2);
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
