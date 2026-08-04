import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import type {
  AdjustDesktopChapterMissionInput,
  AdjustDesktopChapterPlanInput,
  DesktopChapterDraftingInput,
  DesktopChapterPlanningInput,
  DesktopMissionAuthorEdit
} from 'novel-loop-engine/desktop';
import { z } from 'zod';

import {
  ChapterDraftReviewResultSchema,
  ChapterInspectionSchema,
  type ChapterDraftReviewResult,
  type ChapterInspection
} from '../../shared/chapterContract';

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const SAFE_PLAN_CANDIDATE_ID = /^plan_[0-9]{3}$/u;

type PlanningProgressEvent = Parameters<
  NonNullable<DesktopChapterPlanningInput['onProgress']>
>[0];
type DraftingProgressEvent = Parameters<
  NonNullable<DesktopChapterDraftingInput['onProgress']>
>[0];

export type ChapterEngineProgressEvent =
  | PlanningProgressEvent
  | DraftingProgressEvent;

export interface RunChapterInput {
  projectRoot: string;
  onProgress(event: ChapterEngineProgressEvent): void;
  shouldStop(): boolean;
}

const TrustedObjectiveSchema = z.object({
  id: z.string().min(1).max(240),
  text: z.string().min(1).max(8_000),
  type: z.enum([
    'plot',
    'character',
    'relationship',
    'world',
    'debt',
    'foreshadowing',
    'reader'
  ]),
  priority: z.enum(['must', 'should', 'could'])
}).strict();

const TrustedDebtIntroductionSchema = z.object({
  type: z.enum([
    'mystery',
    'character',
    'relationship',
    'power',
    'revenge',
    'theme',
    'world',
    'promise'
  ]),
  promise: z.string().min(1).max(2_000),
  importance: z.number().min(1).max(10)
}).strict();

const TrustedReaderInformationSchema = z.object({
  newKnowledge: z.array(z.string().min(1).max(8_000)).max(100),
  newSuspicions: z.array(z.string().min(1).max(8_000)).max(100),
  questionsToMaintain: z.array(z.string().min(1).max(8_000)).max(100),
  questionsToAnswer: z.array(z.string().min(1).max(8_000)).max(100)
}).strict();

export const TrustedChapterPlanReviewSchema = z.discriminatedUnion(
  'available',
  [
    z.object({
      available: z.literal(false),
      reason: z.enum(['not_ready', 'invalid_output', 'project_unavailable'])
    }).strict(),
    z.object({
      available: z.literal(true),
      chapterNumber: z.number().int().positive(),
      title: z.string().min(1).max(240),
      latestCommittedChapter: z.number().int().nonnegative(),
      reviewHash: z.string().regex(/^[a-f0-9]{64}$/u),
      missionHash: z.string().regex(/^[a-f0-9]{64}$/u),
      mission: z.object({
        chapterFunction: z.string().min(1).max(8_000),
        requiredObjectives: z.array(TrustedObjectiveSchema).max(100),
        debtsToPayOrAdvance: z.array(z.object({
          id: z.string().min(1).max(240),
          promise: z.string().min(1).max(2_000)
        }).strict()).max(100),
        debtsToIntroduce: z.array(TrustedDebtIntroductionSchema).max(100),
        characterDeltas: z.array(z.object({
          characterId: z.string().min(1).max(240),
          characterName: z.string().min(1).max(120),
          from: z.string().min(1).max(2_000),
          to: z.string().min(1).max(2_000),
          evidenceRequired: z.string().min(1).max(2_000)
        }).strict()).max(100),
        participants: z.array(z.object({
          characterId: z.string().min(1).max(240),
          name: z.string().min(1).max(120),
          role: z.string().min(1).max(120),
          origin: z.enum(['committed', 'introduced']),
          selected: z.boolean()
        }).strict()).max(32),
        readerInformationDelta: TrustedReaderInformationSchema,
        forbiddenMoves: z.array(z.string().min(1).max(8_000)).max(100),
        targetEmotionalCurve: z.array(z.string().min(1).max(2_000)).max(100),
        targetWordCount: z.number().int().positive().max(1_000_000).nullable()
      }).strict(),
      directions: z.array(z.object({
        candidateId: z.string().min(1).max(240),
        title: z.string().min(1).max(240),
        markdown: z.string().max(MAX_ARTIFACT_BYTES),
        excerpt: z.string().max(8_000),
        strengths: z.array(z.string().min(1).max(2_000)).max(100),
        risks: z.array(z.string().min(1).max(2_000)).max(100),
        aiRecommended: z.boolean(),
        active: z.boolean()
      }).strict()).min(1).max(10)
    }).strict().superRefine((review, context) => {
      if (review.directions.filter(({ active }) => active).length !== 1) {
        context.addIssue({ code: 'custom', path: ['directions'] });
      }
      if (
        review.directions.filter(({ aiRecommended }) => aiRecommended).length
          !== 1
      ) {
        context.addIssue({ code: 'custom', path: ['directions'] });
      }
      if (
        new Set(review.directions.map(({ candidateId }) => candidateId)).size
          !== review.directions.length
      ) {
        context.addIssue({ code: 'custom', path: ['directions'] });
      }
    })
  ]
);

export type TrustedChapterPlanReview = z.infer<
  typeof TrustedChapterPlanReviewSchema
>;

export interface TrustedPlanRevisionInput {
  projectRoot: string;
  chapterNumber: number;
  candidateId: string;
  expectedReviewHash: string;
  markdown: string;
}

export interface TrustedMissionRevisionInput {
  projectRoot: string;
  chapterNumber: number;
  edit: DesktopMissionAuthorEdit;
}

export interface TrustedRevisionResult {
  revisionId: string;
  sourceHash: string;
}

export interface TrustedAdoptRevisionInput {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  sourceHash: string;
  purpose: 'mission' | 'plan';
}

export interface TrustedAdoptDraftInput {
  projectRoot: string;
  markdown: string;
  expectedSourceHash: string;
}

export type ChapterAdjustmentStage =
  | 'requesting_adjustment'
  | 'validating_adjustment'
  | 'ready_for_review';

export interface TrustedMissionAdjustmentInput {
  projectRoot: string;
  chapterNumber: number;
  expectedSourceHash: string;
  authorInstruction: string;
  missionIntent?: 'general' | 'participant_repair';
  shouldStop(): boolean;
  onCommitPoint(): void;
  onStage(stage: ChapterAdjustmentStage): void;
}

export interface TrustedPlanAdjustmentInput
  extends TrustedMissionAdjustmentInput {
  sourcePlan: {
    candidateId: string;
    content: string;
    active: boolean;
  };
}

export interface TrustedAdjustmentResult extends TrustedRevisionResult {
  candidate: {
    artifactKind: 'mission' | 'plan';
    title: string;
    markdown: string;
  };
}

export interface TrustedDiscardAdjustmentInput {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  expectedSourceHash: string;
}

export interface TrustedBindAdjustmentPublicationInput
  extends TrustedDiscardAdjustmentInput {
  revisionToken: string;
  projectKey: string;
  latestCommittedChapter: number;
  purpose: 'mission' | 'plan';
}

export interface TrustedPromoteAdjustmentPublicationInput
  extends TrustedDiscardAdjustmentInput {
  revisionToken: string;
}

export interface TrustedRecoverableAdjustmentPublication {
  state: 'publishing' | 'ready';
  revisionId: string;
  sourceHash: string;
  chapterNumber: number;
  publication: null | {
    revisionToken: string;
    projectKey: string;
    latestCommittedChapter: number;
    purpose: 'mission' | 'plan';
    boundAt: string;
  };
}

const TrustedRecoverableAdjustmentPublicationSchema = z.object({
  state: z.enum(['publishing', 'ready']),
  revisionId: z.string().regex(
    /^author_revision_ch\d{3}_(?:mission|plan)_v[1-9]\d*$/u
  ),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  chapterNumber: z.number().int().positive(),
  publication: z.object({
    revisionToken: z.string().regex(/^chapter_revision_[a-f0-9]{48}$/u),
    projectKey: z.string().regex(/^project_[A-Za-z0-9_-]+$/u).max(96),
    latestCommittedChapter: z.number().int().nonnegative(),
    purpose: z.enum(['mission', 'plan']),
    boundAt: z.string().datetime({ offset: true })
  }).strict().nullable()
}).strict();

export interface ChapterEngineGateway {
  inspect(projectRoot: string): Promise<ChapterInspection>;
  plan(input: RunChapterInput): Promise<void>;
  draft(input: RunChapterInput): Promise<void>;
  adjustMission(
    input: TrustedMissionAdjustmentInput
  ): Promise<TrustedAdjustmentResult>;
  adjustPlan(input: TrustedPlanAdjustmentInput): Promise<TrustedAdjustmentResult>;
  discardAdjustmentRevision(input: TrustedDiscardAdjustmentInput): Promise<void>;
  bindAdjustmentPublication(
    input: TrustedBindAdjustmentPublicationInput
  ): Promise<void>;
  promoteAdjustmentPublication(
    input: TrustedPromoteAdjustmentPublicationInput
  ): Promise<void>;
  listAdjustmentPublications(
    projectRoot: string
  ): Promise<TrustedRecoverableAdjustmentPublication[]>;
  readPlan(projectRoot: string): Promise<TrustedChapterPlanReview>;
  readDraft(projectRoot: string): Promise<ChapterDraftReviewResult>;
  readDraftWithSource?(projectRoot: string): Promise<{
    review: ChapterDraftReviewResult;
    sourceHash: string | null;
  }>;
  adoptDraft?(input: TrustedAdoptDraftInput): Promise<void>;
  selectDirection(input: {
    projectRoot: string;
    chapterNumber: number;
    candidateId: string;
    expectedReviewHash: string;
  }): Promise<void>;
  createMissionRevision(
    input: TrustedMissionRevisionInput
  ): Promise<TrustedRevisionResult>;
  createPlanRevision(
    input: TrustedPlanRevisionInput
  ): Promise<TrustedRevisionResult>;
  adoptRevision(input: TrustedAdoptRevisionInput): Promise<void>;
}

export class EngineChapterGateway implements ChapterEngineGateway {
  async inspect(projectRoot: string): Promise<ChapterInspection> {
    const { inspectDesktopNextChapter } = await import(
      'novel-loop-engine/desktop'
    );
    return ChapterInspectionSchema.parse(
      await inspectDesktopNextChapter({ projectRoot })
    );
  }

  async plan(input: RunChapterInput): Promise<void> {
    const { planDesktopNextChapter } = await import(
      'novel-loop-engine/desktop'
    );
    await planDesktopNextChapter({
      projectRoot: input.projectRoot,
      onProgress: input.onProgress,
      shouldStop: input.shouldStop
    });
  }

  async draft(input: RunChapterInput): Promise<void> {
    const { draftDesktopNextChapter } = await import(
      'novel-loop-engine/desktop'
    );
    await draftDesktopNextChapter({
      projectRoot: input.projectRoot,
      onProgress: input.onProgress,
      shouldStop: input.shouldStop
    });
  }

  async adjustMission(
    input: TrustedMissionAdjustmentInput
  ): Promise<TrustedAdjustmentResult> {
    const { adjustDesktopChapterMission } = await import(
      'novel-loop-engine/desktop'
    );
    const trustedInput: AdjustDesktopChapterMissionInput = {
      projectRoot: input.projectRoot,
      chapterNumber: input.chapterNumber,
      expectedSourceHash: input.expectedSourceHash,
      authorInstruction: input.authorInstruction,
      missionIntent: input.missionIntent ?? 'general',
      shouldCancel: input.shouldStop,
      onCommitPoint: input.onCommitPoint,
      onStage: input.onStage
    };
    const created = await adjustDesktopChapterMission(trustedInput);
    assertPublishingAdjustment(created.record, 'mission');
    return {
      revisionId: created.record.revisionId,
      sourceHash: created.record.sourceHash,
      candidate: created.candidate
    };
  }

  async adjustPlan(
    input: TrustedPlanAdjustmentInput
  ): Promise<TrustedAdjustmentResult> {
    const { adjustDesktopChapterPlan } = await import(
      'novel-loop-engine/desktop'
    );
    const trustedInput: AdjustDesktopChapterPlanInput = {
      projectRoot: input.projectRoot,
      chapterNumber: input.chapterNumber,
      expectedSourceHash: input.expectedSourceHash,
      authorInstruction: input.authorInstruction,
      sourcePlan: input.sourcePlan,
      shouldCancel: input.shouldStop,
      onCommitPoint: input.onCommitPoint,
      onStage: input.onStage
    };
    const created = await adjustDesktopChapterPlan(trustedInput);
    assertPublishingAdjustment(created.record, 'selected_plan');
    return {
      revisionId: created.record.revisionId,
      sourceHash: created.record.sourceHash,
      candidate: created.candidate
    };
  }

  async discardAdjustmentRevision(
    input: TrustedDiscardAdjustmentInput
  ): Promise<void> {
    const { discardDesktopChapterAdjustmentRevision } = await import(
      'novel-loop-engine/desktop'
    );
    await discardDesktopChapterAdjustmentRevision(input);
  }

  async bindAdjustmentPublication(
    input: TrustedBindAdjustmentPublicationInput
  ): Promise<void> {
    const { bindDesktopChapterAdjustmentPublication } = await import(
      'novel-loop-engine/desktop'
    );
    await bindDesktopChapterAdjustmentPublication(input);
  }

  async promoteAdjustmentPublication(
    input: TrustedPromoteAdjustmentPublicationInput
  ): Promise<void> {
    const { promoteDesktopChapterAdjustmentPublication } = await import(
      'novel-loop-engine/desktop'
    );
    await promoteDesktopChapterAdjustmentPublication(input);
  }

  async listAdjustmentPublications(
    projectRoot: string
  ): Promise<TrustedRecoverableAdjustmentPublication[]> {
    const { listDesktopChapterAdjustmentPublications } = await import(
      'novel-loop-engine/desktop'
    );
    const entries = await listDesktopChapterAdjustmentPublications({
      projectRoot
    });
    return entries.map(({ record }) => (
      TrustedRecoverableAdjustmentPublicationSchema.parse({
        state: record.state,
        revisionId: record.revisionId,
        sourceHash: record.sourceHash,
        chapterNumber: record.chapterNumber,
        publication: record.publication == null
          ? null
          : {
              revisionToken: record.publication.revisionToken,
              projectKey: record.publication.projectKey,
              latestCommittedChapter:
                record.publication.latestCommittedChapter,
              purpose: record.publication.purpose,
              boundAt: record.publication.boundAt
            }
      })
    ));
  }

  async readPlan(projectRoot: string): Promise<TrustedChapterPlanReview> {
    const { readDesktopChapterPlan } = await import(
      'novel-loop-engine/desktop'
    );
    const publicReview = await readDesktopChapterPlan({ projectRoot });
    if (!publicReview.available) {
      return { available: false, reason: 'not_ready' };
    }
    return readTrustedPlanArtifacts(projectRoot, publicReview);
  }

  async readDraft(projectRoot: string): Promise<ChapterDraftReviewResult> {
    const { readDesktopChapterDraft } = await import(
      'novel-loop-engine/desktop'
    );
    const review = await readDesktopChapterDraft({ projectRoot });
    return ChapterDraftReviewResultSchema.parse(
      review.available
        ? {
            available: true,
            chapterNumber: review.chapterNumber,
            title: review.title,
            markdown: review.markdown,
            versionKind: review.versionKind,
            scenes: review.scenes
          }
        : { available: false, reason: 'not_ready' }
    );
  }

  async readDraftWithSource(projectRoot: string): Promise<{
    review: ChapterDraftReviewResult;
    sourceHash: string | null;
  }> {
    const { readDesktopChapterDraft } = await import('novel-loop-engine/desktop');
    const review = await readDesktopChapterDraft({ projectRoot });
    return {
      review: ChapterDraftReviewResultSchema.parse(
        review.available
          ? {
              available: true,
              chapterNumber: review.chapterNumber,
              title: review.title,
              markdown: review.markdown,
              versionKind: review.versionKind,
              scenes: review.scenes
            }
          : { available: false, reason: 'not_ready' }
      ),
      sourceHash: review.available ? review.sourceHash : null
    };
  }

  async adoptDraft(input: TrustedAdoptDraftInput): Promise<void> {
    const { adoptDesktopChapterDraft } = await import('novel-loop-engine/desktop');
    await adoptDesktopChapterDraft(input);
  }

  async selectDirection(input: {
    projectRoot: string;
    chapterNumber: number;
    candidateId: string;
    expectedReviewHash: string;
  }): Promise<void> {
    const { selectDesktopChapterDirection } = await import(
      'novel-loop-engine/desktop'
    );
    await selectDesktopChapterDirection(input);
  }

  async createMissionRevision(
    input: TrustedMissionRevisionInput
  ): Promise<TrustedRevisionResult> {
    const { createDesktopMissionRevision } = await import(
      'novel-loop-engine/desktop'
    );
    const created = await createDesktopMissionRevision(input);
    return {
      revisionId: created.record.revisionId,
      sourceHash: created.record.sourceHash
    };
  }

  async createPlanRevision(
    input: TrustedPlanRevisionInput
  ): Promise<TrustedRevisionResult> {
    const { createDesktopChapterPlanRevision } = await import(
      'novel-loop-engine/desktop'
    );
    const created = await createDesktopChapterPlanRevision(input);
    return {
      revisionId: created.record.revisionId,
      sourceHash: created.record.sourceHash
    };
  }

  async adoptRevision(input: TrustedAdoptRevisionInput): Promise<void> {
    const {
      adoptDesktopChapterPlanRevision,
      adoptDesktopMissionRevision
    } = await import('novel-loop-engine/desktop');
    const trustedInput = {
      projectRoot: input.projectRoot,
      chapterNumber: input.chapterNumber,
      revisionId: input.revisionId,
      expectedSourceHash: input.sourceHash
    };
    if (input.purpose === 'mission') {
      await adoptDesktopMissionRevision(trustedInput);
    } else {
      await adoptDesktopChapterPlanRevision(trustedInput);
    }
  }
}

const StoryStateArtifactSchema = z.object({
  projectId: z.string().min(1).max(200),
  latestCommittedChapter: z.number().int().nonnegative(),
  characters: z.array(z.object({
    id: z.string().min(1).max(240),
    name: z.string().min(1).max(120),
    role: z.string().min(1).max(120)
  }).passthrough()).max(10_000),
  narrativeDebts: z.array(z.object({
    id: z.string().min(1).max(240),
    promise: z.string().min(1).max(2_000)
  }).passthrough()).max(10_000)
}).passthrough();

const MissionArtifactSchema = z.object({
  chapterNumber: z.number().int().positive(),
  chapterFunction: z.string().min(1).max(8_000),
  requiredObjectives: z.array(TrustedObjectiveSchema).max(100),
  debtsToPayOrAdvance: z.array(z.string().min(1).max(240)).max(100),
  debtsToIntroduce: z.array(TrustedDebtIntroductionSchema).max(100),
  characterDeltas: z.array(z.object({
    characterId: z.string().min(1).max(240),
    from: z.string().min(1).max(2_000),
    to: z.string().min(1).max(2_000),
    evidenceRequired: z.string().min(1).max(2_000)
  }).passthrough()).max(100),
  participatingCharacterIds: z.array(z.string().min(1).max(240)).max(32),
  charactersToIntroduce: z.array(z.object({
    characterId: z.string().min(1).max(240),
    name: z.string().min(1).max(120),
    role: z.string().min(1).max(120)
  }).strict()).max(8),
  readerInformationDelta: TrustedReaderInformationSchema,
  forbiddenMoves: z.array(z.string().min(1).max(8_000)).max(100),
  targetEmotionalCurve: z.array(z.string().min(1).max(2_000)).max(100),
  targetWordCount: z.number().int().positive().max(1_000_000).optional()
}).passthrough();

const RankingArtifactSchema = z.object({
  chapterNumber: z.number().int().positive(),
  selectedCandidateId: z.string().min(1).max(240),
  candidates: z.array(z.object({
    candidateId: z.string().min(1).max(240),
    strengths: z.array(z.string().min(1).max(2_000)).max(100),
    risks: z.array(z.string().min(1).max(2_000)).max(100)
  }).passthrough()).min(1).max(10)
}).passthrough();

async function readTrustedPlanArtifacts(
  projectRootInput: string,
  publicReview: {
    chapterNumber: number;
    title: string;
  }
): Promise<TrustedChapterPlanReview> {
  const projectRoot = path.resolve(projectRootInput);
  const chapterNumber = publicReview.chapterNumber;
  const chapterDir = path.join(
    projectRoot,
    'chapters',
    `chapter_${String(chapterNumber).padStart(3, '0')}`
  );
  const storyStatePath = path.join(projectRoot, 'state', 'story_state.json');
  const missionPath = path.join(chapterDir, 'mission.json');
  const rankingPath = path.join(chapterDir, 'ranking.json');
  const selectedPlanPath = path.join(chapterDir, 'selected_plan.md');
  const queuePath = path.join(projectRoot, 'planning', 'chapter_queue.json');
  const [storyStateText, missionText, rankingText, selectedPlan, queueText] =
    await Promise.all([
      readRegularText(storyStatePath),
      readRegularText(missionPath),
      readRegularText(rankingPath),
      readRegularText(selectedPlanPath),
      readRegularText(queuePath)
    ]);
  const storyState = StoryStateArtifactSchema.parse(JSON.parse(storyStateText));
  const mission = MissionArtifactSchema.parse(JSON.parse(missionText));
  const ranking = RankingArtifactSchema.parse(JSON.parse(rankingText));
  if (
    storyState.projectId !== path.basename(projectRoot)
    || storyState.latestCommittedChapter + 1 !== chapterNumber
    || mission.chapterNumber !== chapterNumber
    || ranking.chapterNumber !== chapterNumber
    || !SAFE_PLAN_CANDIDATE_ID.test(ranking.selectedCandidateId)
    || ranking.candidates.some(({ candidateId }) => (
      !SAFE_PLAN_CANDIDATE_ID.test(candidateId)
    ))
  ) {
    throw invalidTrustedReview();
  }

  const candidateRoot = await resolveSafeCandidateRoot(
    projectRoot,
    path.join(chapterDir, 'plan_candidates')
  );
  const candidateMarkdown = new Map<string, string>();
  for (const candidate of ranking.candidates) {
    const candidatePath = path.join(
      candidateRoot,
      `${candidate.candidateId}.md`
    );
    candidateMarkdown.set(
      candidate.candidateId,
      await readContainedCandidateText(candidateRoot, candidatePath)
    );
  }
  const activeCandidate = candidateMarkdown.get(ranking.selectedCandidateId);
  if (activeCandidate === undefined) throw invalidTrustedReview();

  const modelRecommendedCandidateId = await readModelRecommendation(
    chapterDir,
    storyState.projectId,
    chapterNumber,
    ranking.selectedCandidateId
  );
  const knownDebts = new Map(
    storyState.narrativeDebts.map((debt) => [debt.id, debt.promise])
  );
  const knownCharacters = new Map<string, {
    name: string;
    role: string;
    origin: 'committed' | 'introduced';
  }>([
    ...storyState.characters.map((character) => [
      character.id,
      {
        name: character.name,
        role: character.role,
        origin: 'committed' as const
      }
    ] as const),
    ...mission.charactersToIntroduce.map((character) => [
      character.characterId,
      {
        name: character.name,
        role: character.role,
        origin: 'introduced' as const
      }
    ] as const)
  ]);
  const selectedParticipants = new Set([
    ...mission.participatingCharacterIds,
    ...mission.characterDeltas.map(({ characterId }) => characterId),
    ...mission.charactersToIntroduce.map(({ characterId }) => characterId)
  ]);
  const candidateHashes = [...candidateMarkdown.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([candidateId, markdown]) => ({
      candidateId,
      hash: sha256(markdown)
    }));
  const reviewHash = sha256(JSON.stringify({
    chapterNumber,
    missionHash: sha256(missionText),
    candidates: candidateHashes,
    rankingHash: sha256(rankingText),
    selectedPlanHash: sha256(selectedPlan),
    queueHash: sha256(queueText),
    storyStateHash: sha256(storyStateText)
  }));

  return TrustedChapterPlanReviewSchema.parse({
    available: true,
    chapterNumber,
    title: publicReview.title,
    latestCommittedChapter: storyState.latestCommittedChapter,
    reviewHash,
    missionHash: sha256(missionText),
    mission: {
      chapterFunction: mission.chapterFunction,
      requiredObjectives: mission.requiredObjectives,
      debtsToPayOrAdvance: mission.debtsToPayOrAdvance.map((id) => {
        const promise = knownDebts.get(id);
        if (promise === undefined) throw invalidTrustedReview();
        return { id, promise };
      }),
      debtsToIntroduce: mission.debtsToIntroduce,
      characterDeltas: mission.characterDeltas.map((delta) => {
        const character = knownCharacters.get(delta.characterId);
        if (character === undefined) throw invalidTrustedReview();
        return {
          ...delta,
          characterName: character.name
        };
      }),
      participants: [...knownCharacters.entries()].map(([
        characterId,
        character
      ]) => ({
        characterId,
        name: character.name,
        role: character.role,
        origin: character.origin,
        selected: selectedParticipants.has(characterId)
      })),
      readerInformationDelta: mission.readerInformationDelta,
      forbiddenMoves: mission.forbiddenMoves,
      targetEmotionalCurve: mission.targetEmotionalCurve,
      targetWordCount: mission.targetWordCount ?? null
    },
    directions: ranking.candidates.map((candidate, index) => {
      const active = candidate.candidateId === ranking.selectedCandidateId;
      const markdown = active
        ? selectedPlan
        : candidateMarkdown.get(candidate.candidateId);
      if (markdown === undefined) throw invalidTrustedReview();
      return {
        candidateId: candidate.candidateId,
        title: markdownTitle(markdown, index + 1),
        markdown,
        excerpt: markdownExcerpt(markdown),
        strengths: candidate.strengths,
        risks: candidate.risks,
        aiRecommended: candidate.candidateId === modelRecommendedCandidateId,
        active
      };
    })
  });
}

async function readModelRecommendation(
  chapterDir: string,
  projectId: string,
  chapterNumber: number,
  fallback: string
): Promise<string> {
  const revisionDir = path.join(chapterDir, 'author_revisions');
  let entries: string[];
  try {
    const stat = await lstat(revisionDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw invalidTrustedReview();
    }
    entries = await readdir(revisionDir);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return fallback;
    throw error;
  }
  const first = entries
    .map((fileName) => ({
      fileName,
      match: /^direction_selection_v([1-9]\d*)\.json$/u.exec(fileName)
    }))
    .filter((entry): entry is { fileName: string; match: RegExpExecArray } => (
      entry.match !== null
    ))
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]))[0];
  if (first === undefined) return fallback;
  const record = z.object({
    projectId: z.literal(projectId),
    chapterNumber: z.literal(chapterNumber),
    modelRecommendedCandidateId: z.string().min(1).max(240)
  }).passthrough().parse(JSON.parse(await readRegularText(
    path.join(revisionDir, first.fileName)
  )));
  return record.modelRecommendedCandidateId;
}

async function readRegularText(filePath: string): Promise<string> {
  const before = await lstat(filePath);
  if (
    !before.isFile()
    || before.isSymbolicLink()
    || before.size > MAX_ARTIFACT_BYTES
  ) {
    throw invalidTrustedReview();
  }
  const content = await readFile(filePath, 'utf8');
  const after = await lstat(filePath);
  if (
    !after.isFile()
    || after.isSymbolicLink()
    || after.size > MAX_ARTIFACT_BYTES
    || Buffer.byteLength(content, 'utf8') > MAX_ARTIFACT_BYTES
  ) {
    throw invalidTrustedReview();
  }
  return content;
}

async function resolveSafeCandidateRoot(
  projectRootInput: string,
  candidateRootInput: string
): Promise<string> {
  const projectRoot = path.resolve(projectRootInput);
  const candidateRoot = path.resolve(candidateRootInput);
  if (!isWithin(projectRoot, candidateRoot)) throw invalidTrustedReview();

  const projectStat = await lstat(projectRoot);
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) {
    throw invalidTrustedReview();
  }
  const canonicalProjectRoot = await realpath(projectRoot);
  const relative = path.relative(projectRoot, candidateRoot);
  let current = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw invalidTrustedReview();
    }
    if (!isWithin(canonicalProjectRoot, await realpath(current))) {
      throw invalidTrustedReview();
    }
  }
  const canonicalCandidateRoot = await realpath(candidateRoot);
  if (!isWithin(canonicalProjectRoot, canonicalCandidateRoot)) {
    throw invalidTrustedReview();
  }
  return canonicalCandidateRoot;
}

async function readContainedCandidateText(
  candidateRoot: string,
  candidatePathInput: string
): Promise<string> {
  const candidatePath = path.resolve(candidatePathInput);
  if (!isWithin(candidateRoot, candidatePath)) throw invalidTrustedReview();
  const before = await lstat(candidatePath);
  if (
    !before.isFile()
    || before.isSymbolicLink()
    || before.size > MAX_ARTIFACT_BYTES
  ) {
    throw invalidTrustedReview();
  }
  const canonicalCandidatePath = await realpath(candidatePath);
  if (!isWithin(candidateRoot, canonicalCandidatePath)) {
    throw invalidTrustedReview();
  }
  const content = await readFile(canonicalCandidatePath, 'utf8');
  const after = await lstat(canonicalCandidatePath);
  if (
    !after.isFile()
    || after.isSymbolicLink()
    || after.size > MAX_ARTIFACT_BYTES
    || Buffer.byteLength(content, 'utf8') > MAX_ARTIFACT_BYTES
    || !isWithin(candidateRoot, await realpath(canonicalCandidatePath))
  ) {
    throw invalidTrustedReview();
  }
  return content;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== '..'
      && !path.isAbsolute(relative));
}

function markdownTitle(markdown: string, ordinal: number): string {
  const heading = markdown.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line));
  return heading?.replace(/^#\s+/u, '').trim()
    || `方案${['一', '二', '三', '四', '五'][ordinal - 1] ?? ordinal}`;
}

function markdownExcerpt(markdown: string): string {
  const paragraph = markdown
    .split(/\r?\n\s*\r?\n/u)
    .map((item) => item.replace(/\r?\n/gu, ' ').trim())
    .find((item) => item.length > 0 && !/^#\s/u.test(item));
  return (paragraph ?? '').slice(0, 8_000).trim();
}

function assertPublishingAdjustment(
  record: {
    artifactKind: string;
    mode: string;
    state: string;
    publication?: unknown;
    storyStateMutated: boolean;
  },
  artifactKind: 'mission' | 'selected_plan'
): void {
  if (
    record.artifactKind !== artifactKind
    || record.mode !== 'codex_adjustment'
    || record.state !== 'publishing'
    || record.publication !== null
    || record.storyStateMutated
  ) {
    throw invalidTrustedReview();
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function invalidTrustedReview(): Error & { code: string } {
  return Object.assign(new Error('The trusted chapter review is invalid.'), {
    code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
  });
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
