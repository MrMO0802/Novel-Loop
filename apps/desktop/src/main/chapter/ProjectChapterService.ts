import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

import {
  ChapterAdjustMissionRequestSchema,
  ChapterAdjustPlanRequestSchema,
  ChapterAuthoringResultSchema,
  ChapterAdoptDraftRevisionRequestSchema,
  ChapterDraftAdoptionResultSchema,
  ChapterDraftReviewResultSchema,
  ChapterDraftWorkingCopyResultSchema,
  ChapterDraftWorkingCopySaveResultSchema,
  ChapterDiscardDraftWorkingCopyResultSchema,
  ChapterReadDraftWorkingCopyRequestSchema,
  ChapterSaveDraftWorkingCopyRequestSchema,
  ChapterDiscardDraftWorkingCopyRequestSchema,
  ChapterInspectionSchema,
  ChapterPlanReviewResultSchema,
  PARTICIPANT_REPAIR_INSTRUCTION,
  ChapterTaskSchema,
  type ChapterAdoptRevisionRequest,
  type ChapterAdoptDraftRevisionRequest,
  type ChapterAdjustMissionRequest,
  type ChapterAdjustPlanRequest,
  type ChapterAuthoringResult,
  type ChapterDraftReviewResult,
  type ChapterDraftAdoptionResult,
  type ChapterDraftWorkingCopyResult,
  type ChapterDraftWorkingCopySaveResult,
  type ChapterDiscardDraftWorkingCopyResult,
  type ChapterReadDraftWorkingCopyRequest,
  type ChapterSaveDraftWorkingCopyRequest,
  type ChapterDiscardDraftWorkingCopyRequest,
  type ChapterErrorKind,
  type ChapterInspection,
  type ChapterPlanReviewResult,
  type ChapterSaveMissionWorkingCopyRequest,
  type ChapterSavePlanWorkingCopyRequest,
  type ChapterSelectDirectionRequest,
  type ChapterTask,
  type ChapterTaskKind,
  type ChapterTaskStage
} from '../../shared/chapterContract';
import type {
  ChapterEngineGateway,
  ChapterEngineProgressEvent,
  TrustedChapterPlanReview,
  TrustedAdjustmentResult,
  TrustedMissionRevisionInput
} from './EngineChapterGateway';
import {
  TrustedChapterPlanReviewSchema
} from './EngineChapterGateway';
import { ChapterReviewTokenStore } from './ChapterReviewTokenStore';
import { DraftWorkingCopyStore } from './DraftWorkingCopyStore';

export type {
  ChapterAdjustMissionRequest,
  ChapterAdjustPlanRequest
} from '../../shared/chapterContract';

const MAX_TERMINAL_TASKS = 100;

export interface ChapterProjectRootResolver {
  resolveProjectRoot(projectKey: string): Promise<string | null>;
}

export interface ChapterApplicationService {
  inspect(projectKey: string): Promise<ChapterInspection>;
  startPlanning(projectKey: string): Promise<ChapterTask>;
  startDrafting(projectKey: string): Promise<ChapterTask>;
  adjustMission(request: ChapterAdjustMissionRequest): Promise<ChapterTask>;
  adjustPlan(request: ChapterAdjustPlanRequest): Promise<ChapterTask>;
  get(taskId: string): Promise<ChapterTask>;
  cancel(taskId: string): Promise<ChapterTask>;
  readPlan(projectKey: string): Promise<ChapterPlanReviewResult>;
  readDraft(projectKey: string): Promise<ChapterDraftReviewResult>;
  readDraftWorkingCopy(request: ChapterReadDraftWorkingCopyRequest): Promise<ChapterDraftWorkingCopyResult>;
  saveDraftWorkingCopy(request: ChapterSaveDraftWorkingCopyRequest): Promise<ChapterDraftWorkingCopySaveResult>;
  discardDraftWorkingCopy(request: ChapterDiscardDraftWorkingCopyRequest): Promise<ChapterDiscardDraftWorkingCopyResult>;
  adoptDraftRevision(request: ChapterAdoptDraftRevisionRequest): Promise<ChapterDraftAdoptionResult>;
  selectDirection(
    request: ChapterSelectDirectionRequest
  ): Promise<ChapterAuthoringResult>;
  saveMissionWorkingCopy(
    request: ChapterSaveMissionWorkingCopyRequest
  ): Promise<ChapterAuthoringResult>;
  savePlanWorkingCopy(
    request: ChapterSavePlanWorkingCopyRequest
  ): Promise<ChapterAuthoringResult>;
  adoptRevision(
    request: ChapterAdoptRevisionRequest
  ): Promise<ChapterAuthoringResult>;
}

export interface ProjectChapterServiceDependencies {
  projects: ChapterProjectRootResolver;
  gateway: ChapterEngineGateway;
  clock?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
  tokenStore?: ChapterReviewTokenStore;
  workingCopies?: DraftWorkingCopyStore;
}

interface InternalChapterTask {
  task: ChapterTask;
  adjustmentCommitStarted: boolean;
  requestFingerprint?: string;
  stopRequested: boolean;
  terminal: boolean;
  retained: boolean;
}

interface StartingTask {
  requestFingerprint?: string;
  kind: ChapterTaskKind;
  promise: Promise<ChapterTask>;
}

interface PendingAdjustment {
  projectRoot: string;
  chapterNumber: number;
  latestCommittedChapter: number;
  expectedSourceHash: string;
  authorInstruction: string;
  missionIntent?: 'general' | 'participant_repair';
  purpose: 'mission' | 'plan';
  publicationToken: string;
  sourcePlan?: {
    candidateId: string;
    content: string;
    active: boolean;
  };
}

interface PendingDraftAdoption {
  projectRoot: string;
  chapterNumber: number;
  sourceHash: string;
  markdown: string;
}

export class ProjectChapterService implements ChapterApplicationService {
  private readonly clock: () => Date;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly tokenStore: ChapterReviewTokenStore;
  private readonly workingCopies: DraftWorkingCopyStore | null;
  private readonly draftAdoptions = new Map<string, PendingDraftAdoption>();
  private readonly tasks = new Map<string, InternalChapterTask>();
  private readonly activeByProject = new Map<string, string>();
  private readonly startingByProject = new Map<string, StartingTask>();
  private readonly authoringByProject = new Set<string>();
  private readonly recoveryByProject = new Map<string, Promise<void>>();
  private readonly terminalTaskIds: string[] = [];

  constructor(private readonly dependencies: ProjectChapterServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
    this.tokenStore = dependencies.tokenStore ?? new ChapterReviewTokenStore();
    this.workingCopies = dependencies.workingCopies ?? null;
  }

  async inspect(projectKey: string): Promise<ChapterInspection> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return ChapterInspectionSchema.parse({
        available: false,
        reason: 'project_unavailable'
      });
    }

    try {
      return ChapterInspectionSchema.parse(
        await this.dependencies.gateway.inspect(projectRoot)
      );
    } catch (error) {
      const kind = toInspectionErrorKind(error);
      return ChapterInspectionSchema.parse({
        available: false,
        reason: kind
      });
    }
  }

  async startPlanning(projectKey: string): Promise<ChapterTask> {
    return this.start(projectKey, 'planning');
  }

  async startDrafting(projectKey: string): Promise<ChapterTask> {
    return this.start(projectKey, 'drafting');
  }

  async adjustMission(request: ChapterAdjustMissionRequest): Promise<ChapterTask> {
    return this.startAdjustment(
      ChapterAdjustMissionRequestSchema.parse(request),
      'mission_adjustment'
    );
  }

  async adjustPlan(request: ChapterAdjustPlanRequest): Promise<ChapterTask> {
    return this.startAdjustment(
      ChapterAdjustPlanRequestSchema.parse(request),
      'plan_adjustment'
    );
  }

  async get(taskId: string): Promise<ChapterTask> {
    return this.requireTask(taskId);
  }

  async cancel(taskId: string): Promise<ChapterTask> {
    const internal = this.tasks.get(taskId);
    if (internal === undefined) throw new Error('Chapter task was not found.');
    if (
      internal.terminal
      || internal.stopRequested
      || internal.adjustmentCommitStarted
    ) {
      return this.copyTask(internal);
    }

    internal.stopRequested = true;
    this.updateTask(internal, {
      status: 'stop_requested',
      canCancel: false,
      canRetry: false,
      error: null
    });
    return this.copyTask(internal);
  }

  async readPlan(projectKey: string): Promise<ChapterPlanReviewResult> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return ChapterPlanReviewResultSchema.parse({
        available: false,
        reason: 'project_unavailable'
      });
    }
    try {
      await this.recoverAdjustmentPublications(projectKey, projectRoot);
      const trusted = TrustedChapterPlanReviewSchema.parse(
        await this.dependencies.gateway.readPlan(projectRoot)
      );
      if (!trusted.available) {
        return ChapterPlanReviewResultSchema.parse(trusted);
      }
      return this.createPublicPlanReview(projectKey, projectRoot, trusted);
    } catch (error) {
      return ChapterPlanReviewResultSchema.parse({
        available: false,
        reason: toReviewUnavailableReason(error)
      });
    }
  }

  async readDraft(projectKey: string): Promise<ChapterDraftReviewResult> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return ChapterDraftReviewResultSchema.parse({
        available: false,
        reason: 'project_unavailable'
      });
    }
    try {
      return ChapterDraftReviewResultSchema.parse(
        await this.dependencies.gateway.readDraft(projectRoot)
      );
    } catch (error) {
      return ChapterDraftReviewResultSchema.parse({
        available: false,
        reason: toReviewUnavailableReason(error)
      });
    }
  }

  async readDraftWorkingCopy(
    request: ChapterReadDraftWorkingCopyRequest
  ): Promise<ChapterDraftWorkingCopyResult> {
    const parsed = ChapterReadDraftWorkingCopyRequestSchema.parse(request);
    const { projectRoot, review, sourceHash } = await this.currentDraft(parsed.projectKey);
    if (!review.available || sourceHash === null || this.workingCopies === null) {
      return ChapterDraftWorkingCopyResultSchema.parse({
        recoveryAvailable: false, stale: false, markdown: null, savedAt: null, revisionToken: null
      });
    }
    const copy = await this.workingCopies.read(
      parsed.projectKey, review.chapterNumber, sourceHash
    );
    const revisionToken = copy.recoveryAvailable && !copy.stale && copy.markdown !== null
      ? this.issueDraftAdoptionToken({
          projectRoot,
          chapterNumber: review.chapterNumber,
          sourceHash,
          markdown: copy.markdown
        })
      : null;
    return ChapterDraftWorkingCopyResultSchema.parse({ ...copy, revisionToken });
  }

  async saveDraftWorkingCopy(
    request: ChapterSaveDraftWorkingCopyRequest
  ): Promise<ChapterDraftWorkingCopySaveResult> {
    const parsed = ChapterSaveDraftWorkingCopyRequestSchema.parse(request);
    const { projectRoot, review, sourceHash } = await this.currentDraft(parsed.projectKey);
    if (!review.available || sourceHash === null || this.workingCopies === null) {
      throw new Error('Draft working copies are unavailable.');
    }
    await this.workingCopies.save({
      projectKey: parsed.projectKey,
      chapterNumber: review.chapterNumber,
      sourceHash,
      markdown: parsed.markdown,
      savedAt: this.clock().toISOString()
    });
    return ChapterDraftWorkingCopySaveResultSchema.parse({
      saveState: 'saved',
      revisionToken: this.issueDraftAdoptionToken({
        projectRoot,
        chapterNumber: review.chapterNumber,
        sourceHash,
        markdown: parsed.markdown
      })
    });
  }

  async discardDraftWorkingCopy(
    request: ChapterDiscardDraftWorkingCopyRequest
  ): Promise<ChapterDiscardDraftWorkingCopyResult> {
    const parsed = ChapterDiscardDraftWorkingCopyRequestSchema.parse(request);
    const { review } = await this.currentDraft(parsed.projectKey);
    if (review.available && this.workingCopies !== null) {
      await this.workingCopies.discard(parsed.projectKey, review.chapterNumber);
    }
    return ChapterDiscardDraftWorkingCopyResultSchema.parse({ discarded: true });
  }

  async adoptDraftRevision(
    request: ChapterAdoptDraftRevisionRequest
  ): Promise<ChapterDraftAdoptionResult> {
    const parsed = ChapterAdoptDraftRevisionRequestSchema.parse(request);
    const pending = this.draftAdoptions.get(parsed.revisionToken);
    if (pending === undefined) throw new Error('Draft adoption request is stale.');
    const { projectRoot, review, sourceHash } = await this.currentDraft(parsed.projectKey);
    if (
      !review.available
      || projectRoot !== pending.projectRoot
      || sourceHash !== pending.sourceHash
    ) {
      throw new Error('Draft adoption request is stale.');
    }
    if (this.dependencies.gateway.adoptDraft === undefined) {
      throw new Error('Draft adoption is unavailable.');
    }
    await this.dependencies.gateway.adoptDraft({
      projectRoot: pending.projectRoot,
      markdown: pending.markdown,
      expectedSourceHash: pending.sourceHash
    });
    if (this.workingCopies !== null) {
      await this.workingCopies.discard(parsed.projectKey, pending.chapterNumber);
    }
    this.draftAdoptions.delete(parsed.revisionToken);
    return ChapterDraftAdoptionResultSchema.parse({ outcome: 'adopted' });
  }

  async selectDirection(
    request: ChapterSelectDirectionRequest
  ): Promise<ChapterAuthoringResult> {
    return this.withAuthoringOperation(request.projectKey, async (
      projectRoot,
      trusted
    ) => {
      const resolved = this.tokenStore.resolveOption({
        projectKey: request.projectKey,
        projectRoot,
        reviewToken: request.reviewToken,
        optionToken: request.optionToken,
        purpose: 'direction',
        currentLatestCommittedChapter: trusted.latestCommittedChapter,
        currentReviewHash: trusted.reviewHash
      });
      if (resolved.outcome === 'stale') return resolved;
      await this.dependencies.gateway.selectDirection({
        projectRoot,
        chapterNumber: resolved.value.chapterNumber,
        candidateId: resolved.value.trustedId,
        expectedReviewHash: resolved.value.reviewHash
      });
      return { outcome: 'adopted' };
    });
  }

  async savePlanWorkingCopy(
    request: ChapterSavePlanWorkingCopyRequest
  ): Promise<ChapterAuthoringResult> {
    return this.withAuthoringOperation(request.projectKey, async (
      projectRoot,
      trusted
    ) => {
      const resolved = this.tokenStore.resolveOption({
        projectKey: request.projectKey,
        projectRoot,
        reviewToken: request.reviewToken,
        optionToken: request.optionToken,
        purpose: 'direction',
        currentLatestCommittedChapter: trusted.latestCommittedChapter,
        currentReviewHash: trusted.reviewHash
      });
      if (resolved.outcome === 'stale') return resolved;
      const created = await this.dependencies.gateway.createPlanRevision({
        projectRoot,
        chapterNumber: resolved.value.chapterNumber,
        candidateId: resolved.value.trustedId,
        expectedReviewHash: resolved.value.reviewHash,
        markdown: request.markdown
      });
      return {
        outcome: 'saved',
        revisionToken: this.tokenStore.createRevision({
          projectKey: request.projectKey,
          projectRoot,
          chapterNumber: resolved.value.chapterNumber,
          latestCommittedChapter: resolved.value.latestCommittedChapter,
          purpose: 'plan',
          sourceHash: created.sourceHash,
          revisionId: created.revisionId
        })
      };
    });
  }

  async saveMissionWorkingCopy(
    request: ChapterSaveMissionWorkingCopyRequest
  ): Promise<ChapterAuthoringResult> {
    return this.withAuthoringOperation(request.projectKey, async (
      projectRoot,
      trusted
    ) => {
      const resolved = this.tokenStore.resolveReview({
        projectKey: request.projectKey,
        projectRoot,
        reviewToken: request.reviewToken,
        currentLatestCommittedChapter: trusted.latestCommittedChapter,
        currentReviewHash: trusted.reviewHash
      });
      if (resolved.outcome === 'stale') return resolved;
      const trustedOption = (
        optionToken: string,
        purpose: 'objective' | 'debt' | 'participant'
      ): string | null => {
        if (resolved.value.optionPurposes.get(optionToken) !== purpose) {
          return null;
        }
        return resolved.value.optionBindings.get(optionToken) ?? null;
      };
      const trustedParticipant = (optionToken: string): {
        characterId: string;
        origin: 'committed' | 'introduced';
      } | null => {
        const characterId = trustedOption(optionToken, 'participant');
        const origin = resolved.value.participantOrigins.get(optionToken);
        return characterId === null || origin === undefined
          ? null
          : { characterId, origin };
      };
      const requiredObjectives = request.mission.requiredObjectives.map(
        (objective) => ({
          sourceObjectiveId: objective.itemToken === null
            ? null
            : trustedOption(objective.itemToken, 'objective'),
          text: objective.text,
          type: objective.type,
          priority: objective.priority
        })
      );
      const debtsToPayOrAdvance = request.mission.debtTokens.map((token) => (
        trustedOption(token, 'debt')
      ));
      const characterDeltas = request.mission.characterDeltas.map((delta) => {
        const participant = trustedParticipant(delta.participantToken);
        return participant === null
          ? null
          : {
              participant,
              from: delta.from,
              to: delta.to,
              evidenceRequired: delta.evidenceRequired
            };
      });
      const selectedParticipants = request.mission.participantTokens.map(
        (token) => trustedParticipant(token)
      );
      if (
        requiredObjectives.some((objective) => (
          objective.sourceObjectiveId === null
          && request.mission.requiredObjectives.find((candidate) => (
            candidate.text === objective.text
            && candidate.itemToken !== null
          )) !== undefined
        ))
        || debtsToPayOrAdvance.includes(null)
        || characterDeltas.includes(null)
        || selectedParticipants.includes(null)
      ) {
        return { outcome: 'stale', messageKey: 'stale_edit' };
      }
      const resolvedCharacterDeltas = characterDeltas as Array<{
        participant: {
          characterId: string;
          origin: 'committed' | 'introduced';
        };
        from: string;
        to: string;
        evidenceRequired: string;
      }>;
      const resolvedParticipants = selectedParticipants as Array<{
        characterId: string;
        origin: 'committed' | 'introduced';
      }>;
      const retainedIntroducedCharacterIds = uniqueStrings([
        ...resolvedParticipants,
        ...resolvedCharacterDeltas.map(({ participant }) => participant)
      ].filter(({ origin }) => origin === 'introduced').map(({
        characterId
      }) => characterId));
      const edit: TrustedMissionRevisionInput['edit'] = {
        sourceMissionHash: resolved.value.missionHash,
        chapterFunction: request.mission.chapterFunction,
        requiredObjectives: requiredObjectives as Array<{
          sourceObjectiveId: string | null;
          text: string;
          type: typeof request.mission.requiredObjectives[number]['type'];
          priority: typeof request.mission.requiredObjectives[number]['priority'];
        }>,
        debtsToPayOrAdvance: debtsToPayOrAdvance as string[],
        debtsToIntroduce: request.mission.debtsToIntroduce,
        characterDeltas: resolvedCharacterDeltas.map(({
          participant,
          from,
          to,
          evidenceRequired
        }) => ({
          characterId: participant.characterId,
          from,
          to,
          evidenceRequired
        })),
        participatingCharacterIds: resolvedParticipants
          .filter(({ origin }) => origin === 'committed')
          .map(({ characterId }) => characterId),
        ...(retainedIntroducedCharacterIds.length === 0
          ? {}
          : { retainedIntroducedCharacterIds }),
        newCharacters: request.mission.newParticipants,
        readerInformationDelta: request.mission.readerInformation,
        forbiddenMoves: request.mission.forbiddenMoves,
        targetEmotionalCurve: request.mission.targetEmotionalCurve,
        targetWordCount: request.mission.targetWordCount
      };
      const created = await this.dependencies.gateway.createMissionRevision({
        projectRoot,
        chapterNumber: resolved.value.chapterNumber,
        edit
      });
      return {
        outcome: 'saved',
        revisionToken: this.tokenStore.createRevision({
          projectKey: request.projectKey,
          projectRoot,
          chapterNumber: resolved.value.chapterNumber,
          latestCommittedChapter: resolved.value.latestCommittedChapter,
          purpose: 'mission',
          sourceHash: created.sourceHash,
          revisionId: created.revisionId
        })
      };
    });
  }

  async adoptRevision(
    request: ChapterAdoptRevisionRequest
  ): Promise<ChapterAuthoringResult> {
    return this.withAuthoringOperation(request.projectKey, async (
      projectRoot,
      trusted
    ) => {
      const resolved = this.tokenStore.reserveRevision({
        projectKey: request.projectKey,
        projectRoot,
        revisionToken: request.revisionToken,
        currentLatestCommittedChapter: trusted.latestCommittedChapter
      });
      if (resolved.outcome === 'stale') return resolved;
      try {
        await this.dependencies.gateway.adoptRevision({
          projectRoot,
          chapterNumber: resolved.value.chapterNumber,
          revisionId: resolved.value.revisionId,
          sourceHash: resolved.value.sourceHash,
          purpose: resolved.value.purpose
        });
        this.tokenStore.commitRevision(request.revisionToken);
        return { outcome: 'adopted' };
      } catch (error) {
        this.tokenStore.releaseRevision(request.revisionToken);
        throw error;
      }
    });
  }

  private createPublicPlanReview(
    projectKey: string,
    projectRoot: string,
    trusted: Extract<TrustedChapterPlanReview, { available: true }>
  ): ChapterPlanReviewResult {
    const options = [
      ...trusted.directions.map(({ candidateId }) => ({
        purpose: 'direction' as const,
        trustedId: candidateId
      })),
      ...trusted.mission.requiredObjectives.map(({ id }) => ({
        purpose: 'objective' as const,
        trustedId: id
      })),
      ...trusted.mission.debtsToPayOrAdvance.map(({ id }) => ({
        purpose: 'debt' as const,
        trustedId: id
      })),
      ...trusted.mission.participants.map(({ characterId, origin }) => ({
        purpose: 'participant' as const,
        trustedId: characterId,
        participantOrigin: origin
      }))
    ];
    const created = this.tokenStore.createReview({
      projectKey,
      projectRoot,
      chapterNumber: trusted.chapterNumber,
      latestCommittedChapter: trusted.latestCommittedChapter,
      reviewHash: trusted.reviewHash,
      missionHash: trusted.missionHash,
      options
    });
    const tokenByBinding = new Map(created.options.map((option) => [
      `${option.purpose}\0${option.trustedId}`,
      option.optionToken
    ]));
    const tokenFor = (
      purpose: 'direction' | 'objective' | 'debt' | 'participant',
      trustedId: string
    ): string => {
      const token = tokenByBinding.get(`${purpose}\0${trustedId}`);
      if (token === undefined) throw new Error('Opaque chapter binding missing.');
      return token;
    };
    const active = trusted.directions.find((direction) => direction.active);
    if (active === undefined) throw new Error('Active chapter direction missing.');
    const narrativePromises = uniqueStrings([
      ...trusted.mission.debtsToPayOrAdvance.map(({ promise }) => promise),
      ...trusted.mission.debtsToIntroduce.map(({ promise }) => promise)
    ]);
    return ChapterPlanReviewResultSchema.parse({
      available: true,
      chapterNumber: trusted.chapterNumber,
      title: trusted.title,
      reviewToken: created.reviewToken,
      mission: {
        chapterFunction: trusted.mission.chapterFunction,
        objectives: trusted.mission.requiredObjectives.map(({ text }) => text),
        readerKnowledge: trusted.mission.readerInformationDelta.newKnowledge,
        readerQuestions:
          trusted.mission.readerInformationDelta.questionsToMaintain,
        narrativePromises,
        characterDeltas: trusted.mission.characterDeltas.map((delta) => (
          `${delta.characterName}: ${delta.from} -> ${delta.to}; ${delta.evidenceRequired}`
        )),
        forbiddenMoves: trusted.mission.forbiddenMoves,
        objectiveItems: trusted.mission.requiredObjectives.map((objective) => ({
          itemToken: tokenFor('objective', objective.id),
          text: objective.text,
          type: objective.type,
          priority: objective.priority
        })),
        debtItems: trusted.mission.debtsToPayOrAdvance.map((debt) => ({
          itemToken: tokenFor('debt', debt.id),
          promise: debt.promise
        })),
        introducedDebts: trusted.mission.debtsToIntroduce,
        characterDeltaItems: trusted.mission.characterDeltas.map((delta) => ({
          participantToken: tokenFor('participant', delta.characterId),
          participantName: delta.characterName,
          from: delta.from,
          to: delta.to,
          evidenceRequired: delta.evidenceRequired
        })),
        participantOptions: trusted.mission.participants.map((participant) => ({
          participantToken: tokenFor(
            'participant',
            participant.characterId
          ),
          name: participant.name,
          role: participant.role,
          selected: participant.selected
        })),
        readerInformation: trusted.mission.readerInformationDelta,
        targetEmotionalCurve: trusted.mission.targetEmotionalCurve,
        targetWordCount: trusted.mission.targetWordCount
      },
      selectedPlan: {
        title: active.title,
        markdown: active.markdown
      },
      alternatives: trusted.directions
        .filter((direction) => !direction.active)
        .map((direction) => ({
          title: direction.title,
          excerpt: direction.excerpt,
          strengths: direction.strengths,
          risks: direction.risks
        })),
      directions: trusted.directions.map((direction) => ({
        optionToken: tokenFor('direction', direction.candidateId),
        title: direction.title,
        markdown: direction.markdown,
        excerpt: direction.excerpt,
        strengths: direction.strengths,
        risks: direction.risks,
        aiRecommended: direction.aiRecommended,
        active: direction.active
      }))
    });
  }

  private async currentDraft(projectKey: string): Promise<{
    projectRoot: string;
    review: ChapterDraftReviewResult;
    sourceHash: string | null;
  }> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return {
        projectRoot: '',
        review: ChapterDraftReviewResultSchema.parse({
          available: false,
          reason: 'project_unavailable'
        }),
        sourceHash: null
      };
    }
    if (this.dependencies.gateway.readDraftWithSource !== undefined) {
      return { projectRoot, ...(await this.dependencies.gateway.readDraftWithSource(projectRoot)) };
    }
    const review = await this.dependencies.gateway.readDraft(projectRoot);
    return {
      projectRoot,
      review,
      sourceHash: review.available
        ? createHash('sha256').update(review.markdown).digest('hex')
        : null
    };
  }

  private issueDraftAdoptionToken(input: PendingDraftAdoption): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = `chapter_revision_${Buffer.from(this.randomBytes(24)).toString('hex')}`;
      if (!this.draftAdoptions.has(token)) {
        this.draftAdoptions.set(token, input);
        return token;
      }
    }
    throw new Error('Unable to allocate a draft adoption token.');
  }

  private async withAuthoringOperation(
    projectKey: string,
    operation: (
      projectRoot: string,
      trusted: Extract<TrustedChapterPlanReview, { available: true }>
    ) => Promise<ChapterAuthoringResult>
  ): Promise<ChapterAuthoringResult> {
    const recovery = this.recoveryByProject.get(projectKey);
    if (recovery !== undefined) {
      await recovery;
      return this.withAuthoringOperation(projectKey, operation);
    }
    if (
      this.activeTask(projectKey) !== null
      || this.startingByProject.has(projectKey)
      || this.authoringByProject.has(projectKey)
    ) {
      return ChapterAuthoringResultSchema.parse({
        outcome: 'blocked',
        messageKey: 'generation_busy'
      });
    }
    this.authoringByProject.add(projectKey);
    try {
      const projectRoot = await this.resolveProjectRoot(projectKey);
      if (projectRoot === null) {
        return ChapterAuthoringResultSchema.parse({
          outcome: 'invalid',
          messageKey: 'project_unavailable'
        });
      }
      await this.recoverAdjustmentPublications(projectKey, projectRoot, true);
      const trusted = TrustedChapterPlanReviewSchema.parse(
        await this.dependencies.gateway.readPlan(projectRoot)
      );
      if (!trusted.available) {
        return ChapterAuthoringResultSchema.parse({
          outcome: 'invalid',
          messageKey: trusted.reason === 'project_unavailable'
            ? 'project_unavailable'
            : 'invalid_output'
        });
      }
      return ChapterAuthoringResultSchema.parse(
        await operation(projectRoot, trusted)
      );
    } catch (error) {
      return ChapterAuthoringResultSchema.parse(mapAuthoringError(error));
    } finally {
      this.authoringByProject.delete(projectKey);
    }
  }

  private async start(
    projectKey: string,
    kind: ChapterTaskKind
  ): Promise<ChapterTask> {
    if (this.authoringByProject.has(projectKey)) {
      return this.createFailedTask(
        projectKey,
        kind,
        1,
        'generation_busy'
      );
    }
    const active = this.activeTask(projectKey);
    if (active !== null) {
      return active.task.kind === kind
        ? this.copyTask(active)
        : this.createFailedTask(
          projectKey,
          kind,
          active.task.chapterNumber,
          'generation_busy'
        );
    }

    const starting = this.startingByProject.get(projectKey);
    if (starting !== undefined) {
      if (starting.kind === kind) return starting.promise;
      const pendingTask = await starting.promise;
      const activeAfterStart = this.activeTask(projectKey);
      if (activeAfterStart !== null) {
        return this.createFailedTask(
          projectKey,
          kind,
          activeAfterStart.task.chapterNumber,
          'generation_busy'
        );
      }
      if (!isTerminalStatus(pendingTask.status)) {
        return this.createFailedTask(
          projectKey,
          kind,
          pendingTask.chapterNumber,
          'generation_busy'
        );
      }
      return this.start(projectKey, kind);
    }

    const promise = this.begin(projectKey, kind).finally(() => {
      const current = this.startingByProject.get(projectKey);
      if (current?.promise === promise) {
        this.startingByProject.delete(projectKey);
      }
    });
    this.startingByProject.set(projectKey, { kind, promise });
    return promise;
  }

  private async startAdjustment(
    request: ChapterAdjustMissionRequest | ChapterAdjustPlanRequest,
    kind: Extract<ChapterTaskKind, 'mission_adjustment' | 'plan_adjustment'>
  ): Promise<ChapterTask> {
    const recovery = this.recoveryByProject.get(request.projectKey);
    if (recovery !== undefined) {
      await recovery;
      return this.startAdjustment(request, kind);
    }
    const requestFingerprint = adjustmentRequestFingerprint(kind, request);
    if (this.authoringByProject.has(request.projectKey)) {
      return this.createFailedTask(request.projectKey, kind, 1, 'generation_busy');
    }
    const active = this.activeTask(request.projectKey);
    if (active !== null) {
      return active.task.kind === kind
        && active.requestFingerprint === requestFingerprint
        ? this.copyTask(active)
        : this.createFailedTask(
            request.projectKey,
            kind,
            active.task.chapterNumber,
            'generation_busy'
          );
    }
    const starting = this.startingByProject.get(request.projectKey);
    if (starting !== undefined) {
      if (
        starting.kind === kind
        && starting.requestFingerprint === requestFingerprint
      ) return starting.promise;
      if (starting.kind === kind) {
        return this.createFailedTask(request.projectKey, kind, 1, 'generation_busy');
      }
      const pending = await starting.promise;
      const activeAfterStart = this.activeTask(request.projectKey);
      if (activeAfterStart !== null || !isTerminalStatus(pending.status)) {
        return this.createFailedTask(
          request.projectKey,
          kind,
          pending.chapterNumber,
          'generation_busy'
        );
      }
      return this.startAdjustment(request, kind);
    }

    const promise = this.beginAdjustment(
      request,
      kind,
      requestFingerprint
    ).finally(() => {
      const current = this.startingByProject.get(request.projectKey);
      if (current?.promise === promise) {
        this.startingByProject.delete(request.projectKey);
      }
    });
    this.startingByProject.set(request.projectKey, {
      kind,
      promise,
      requestFingerprint
    });
    return promise;
  }

  private async beginAdjustment(
    request: ChapterAdjustMissionRequest | ChapterAdjustPlanRequest,
    kind: Extract<ChapterTaskKind, 'mission_adjustment' | 'plan_adjustment'>,
    requestFingerprint: string
  ): Promise<ChapterTask> {
    const projectRoot = await this.resolveProjectRoot(request.projectKey);
    if (projectRoot === null) {
      return this.createFailedTask(
        request.projectKey,
        kind,
        1,
        'project_unavailable'
      );
    }
    let trusted: Extract<TrustedChapterPlanReview, { available: true }>;
    try {
      const review = TrustedChapterPlanReviewSchema.parse(
        await this.dependencies.gateway.readPlan(projectRoot)
      );
      if (!review.available) {
        return this.createFailedTask(
          request.projectKey,
          kind,
          1,
          'invalid_output'
        );
      }
      trusted = review;
    } catch (error) {
      return this.createFailedTask(
        request.projectKey,
        kind,
        1,
        toChapterStartErrorKind(error, kind)
      );
    }

    const base = {
      projectKey: request.projectKey,
      projectRoot,
      reviewToken: request.reviewToken,
      currentLatestCommittedChapter: trusted.latestCommittedChapter,
      currentReviewHash: trusted.reviewHash
    };
    let pending: Omit<PendingAdjustment, 'publicationToken'>;
    if (kind === 'mission_adjustment') {
      const resolved = this.tokenStore.resolveReview(base);
      if (resolved.outcome === 'stale') {
        return this.createFailedTask(
          request.projectKey,
          kind,
          trusted.chapterNumber,
          'stale_chapter'
        );
      }
      pending = {
        projectRoot,
        chapterNumber: resolved.value.chapterNumber,
        latestCommittedChapter: resolved.value.latestCommittedChapter,
        expectedSourceHash: resolved.value.missionHash,
        authorInstruction: request.authorInstruction,
        missionIntent: request.authorInstruction === PARTICIPANT_REPAIR_INSTRUCTION
          ? 'participant_repair'
          : 'general',
        purpose: 'mission'
      };
    } else {
      if (!('optionToken' in request)) {
        throw new Error('Plan adjustment option token is missing.');
      }
      const resolved = this.tokenStore.resolveOption({
        ...base,
        optionToken: request.optionToken,
        purpose: 'direction'
      });
      if (resolved.outcome === 'stale') {
        return this.createFailedTask(
          request.projectKey,
          kind,
          trusted.chapterNumber,
          'stale_chapter'
        );
      }
      const direction = trusted.directions.find(
        ({ candidateId }) => candidateId === resolved.value.trustedId
      );
      if (direction === undefined) {
        return this.createFailedTask(
          request.projectKey,
          kind,
          trusted.chapterNumber,
          'stale_chapter'
        );
      }
      pending = {
        projectRoot,
        chapterNumber: resolved.value.chapterNumber,
        latestCommittedChapter: resolved.value.latestCommittedChapter,
        expectedSourceHash: sha256(direction.markdown),
        authorInstruction: request.authorInstruction,
        purpose: 'plan',
        sourcePlan: {
          candidateId: direction.candidateId,
          content: direction.markdown,
          active: direction.active
        }
      };
    }

    let publicationToken: string;
    try {
      publicationToken = this.tokenStore.reserveRevisionPublication();
    } catch (error) {
      return this.createFailedTask(
        request.projectKey,
        kind,
        pending.chapterNumber,
        toChapterRunErrorKind(error, kind)
      );
    }
    const preparedPending: PendingAdjustment = {
      ...pending,
      publicationToken
    };

    let internal: InternalChapterTask;
    try {
      internal = this.createTask(
        request.projectKey,
        kind,
        preparedPending.chapterNumber,
        requestFingerprint
      );
    } catch (error) {
      this.tokenStore.discardRevisionPublication(publicationToken);
      throw error;
    }
    this.tasks.set(internal.task.taskId, internal);
    this.activeByProject.set(request.projectKey, internal.task.taskId);
    const task = this.copyTask(internal);
    void this.runAdjustment(internal, preparedPending).catch(() => undefined);
    return task;
  }

  private async runAdjustment(
    internal: InternalChapterTask,
    pending: PendingAdjustment
  ): Promise<void> {
    let durableResult: TrustedAdjustmentResult | undefined;
    let publicationCommitted = false;
    try {
      this.updateTask(internal, {
        status: 'running',
        stage: 'requesting_adjustment',
        canCancel: true,
        canRetry: false,
        error: null
      });
      const common = {
        projectRoot: pending.projectRoot,
        chapterNumber: pending.chapterNumber,
        expectedSourceHash: pending.expectedSourceHash,
        authorInstruction: pending.authorInstruction,
        shouldStop: () => internal.stopRequested,
        onCommitPoint: () => this.markAdjustmentCommitPoint(internal),
        onStage: (stage: Extract<
          ChapterTaskStage,
          | 'requesting_adjustment'
          | 'validating_adjustment'
          | 'ready_for_review'
        >) => this.reportAdjustmentStage(internal, stage)
      };
      const result = pending.purpose === 'mission'
        ? await this.dependencies.gateway.adjustMission({
            ...common,
            missionIntent: pending.missionIntent ?? 'general'
          })
        : await this.dependencies.gateway.adjustPlan({
            ...common,
            sourcePlan: pending.sourcePlan!
          });
      durableResult = result;
      if (internal.stopRequested) {
        await this.discardAdjustmentResult(pending, result);
        durableResult = undefined;
        this.finishCancelled(internal);
        return;
      }
      const succeededTask = this.buildAdjustmentSucceededTask(
        internal,
        pending.publicationToken,
        result.candidate
      );
      if (internal.stopRequested) {
        await this.discardAdjustmentResult(pending, result);
        durableResult = undefined;
        this.finishCancelled(internal);
        return;
      }
      const publicationBinding = {
        projectKey: internal.task.projectKey,
        projectRoot: pending.projectRoot,
        chapterNumber: pending.chapterNumber,
        latestCommittedChapter: pending.latestCommittedChapter,
        purpose: pending.purpose,
        sourceHash: result.sourceHash,
        revisionId: result.revisionId,
        durablePublication: true
      };
      await this.dependencies.gateway.bindAdjustmentPublication({
        projectRoot: pending.projectRoot,
        chapterNumber: pending.chapterNumber,
        revisionId: result.revisionId,
        expectedSourceHash: result.sourceHash,
        revisionToken: pending.publicationToken,
        projectKey: internal.task.projectKey,
        latestCommittedChapter: pending.latestCommittedChapter,
        purpose: pending.purpose
      });
      this.tokenStore.publishReservedRevision(
        pending.publicationToken,
        publicationBinding
      );
      await this.dependencies.gateway.promoteAdjustmentPublication({
        projectRoot: pending.projectRoot,
        chapterNumber: pending.chapterNumber,
        revisionId: result.revisionId,
        expectedSourceHash: result.sourceHash,
        revisionToken: pending.publicationToken
      });
      this.tokenStore.commitRevisionPublication(pending.publicationToken);
      publicationCommitted = true;
      internal.task = succeededTask;
      internal.terminal = true;
    } catch (error) {
      let terminalError = error;
      if (durableResult !== undefined && !publicationCommitted) {
        try {
          await this.discardAdjustmentResult(pending, durableResult);
        } catch (cleanupError) {
          terminalError = cleanupError;
        }
      }
      if (isCancellation(terminalError)) {
        this.finishCancelled(internal);
      } else {
        this.finishFailed(
          internal,
          toChapterRunErrorKind(terminalError, internal.task.kind)
        );
      }
    } finally {
      if (!publicationCommitted) {
        this.tokenStore.discardRevisionPublication(pending.publicationToken);
      }
      if (this.activeByProject.get(internal.task.projectKey) === internal.task.taskId) {
        this.activeByProject.delete(internal.task.projectKey);
      }
      this.retainTerminalTask(internal);
    }
  }

  private reportAdjustmentStage(
    internal: InternalChapterTask,
    stage: Extract<
      ChapterTaskStage,
      'requesting_adjustment' | 'validating_adjustment' | 'ready_for_review'
    >
  ): void {
    if (internal.terminal) return;
    const previous = stage === 'validating_adjustment'
      ? ['requesting_adjustment'] as ChapterTaskStage[]
      : stage === 'ready_for_review'
        ? ['requesting_adjustment', 'validating_adjustment'] as ChapterTaskStage[]
        : [];
    this.updateTask(internal, {
      stage,
      completedStages: previous.reduce(addCompletedStage, internal.task.completedStages)
    });
  }

  private markAdjustmentCommitPoint(internal: InternalChapterTask): void {
    if (internal.terminal || internal.adjustmentCommitStarted) return;
    if (internal.stopRequested) {
      throw chapterAdjustmentCancelledError();
    }
    internal.adjustmentCommitStarted = true;
    this.updateTask(internal, { canCancel: false });
  }

  private buildAdjustmentSucceededTask(
    internal: InternalChapterTask,
    resultRevisionToken: string,
    resultCandidate: NonNullable<ChapterTask['resultCandidate']>
  ): ChapterTask {
    const adjustmentStages: ChapterTaskStage[] = [
      'requesting_adjustment',
      'validating_adjustment',
      'ready_for_review'
    ];
    const completedStages = adjustmentStages.reduce(
      addCompletedStage,
      internal.task.completedStages
    );
    return ChapterTaskSchema.parse({
      ...internal.task,
      status: 'succeeded',
      stage: 'ready_for_review',
      completedStages,
      sceneProgress: null,
      canCancel: false,
      canRetry: false,
      error: null,
      resultRevisionToken,
      resultCandidate,
      updatedAt: this.clock().toISOString()
    });
  }

  private async discardAdjustmentResult(
    pending: PendingAdjustment,
    result: TrustedAdjustmentResult
  ): Promise<void> {
    await this.dependencies.gateway.discardAdjustmentRevision({
      projectRoot: pending.projectRoot,
      chapterNumber: pending.chapterNumber,
      revisionId: result.revisionId,
      expectedSourceHash: result.sourceHash
    });
  }

  private async recoverAdjustmentPublications(
    projectKey: string,
    projectRoot: string,
    ownedByAuthoringOperation = false
  ): Promise<void> {
    const existing = this.recoveryByProject.get(projectKey);
    if (existing !== undefined) {
      await existing;
      return;
    }
    const active = this.activeTask(projectKey);
    const starting = this.startingByProject.get(projectKey);
    if (
      active?.task.kind === 'mission_adjustment'
      || active?.task.kind === 'plan_adjustment'
      || starting?.kind === 'mission_adjustment'
      || starting?.kind === 'plan_adjustment'
      || (
        !ownedByAuthoringOperation
        && this.authoringByProject.has(projectKey)
      )
    ) {
      return;
    }
    const recovery = this.performAdjustmentPublicationRecovery(
      projectKey,
      projectRoot
    );
    this.recoveryByProject.set(projectKey, recovery);
    try {
      await recovery;
    } finally {
      if (this.recoveryByProject.get(projectKey) === recovery) {
        this.recoveryByProject.delete(projectKey);
      }
    }
  }

  private async performAdjustmentPublicationRecovery(
    projectKey: string,
    projectRoot: string
  ): Promise<void> {
    let recoverable: Awaited<ReturnType<
      ChapterEngineGateway['listAdjustmentPublications']
    >>;
    try {
      recoverable = await this.dependencies.gateway.listAdjustmentPublications(
        projectRoot
      );
    } catch {
      return;
    }
    for (const entry of recoverable) {
      if (entry.publication === null) {
        try {
          await this.dependencies.gateway.discardAdjustmentRevision({
            projectRoot,
            chapterNumber: entry.chapterNumber,
            revisionId: entry.revisionId,
            expectedSourceHash: entry.sourceHash
          });
        } catch {
          // A later recovery pass can retry cleanup while the record stays non-ready.
        }
        continue;
      }
      if (entry.publication.projectKey !== projectKey) continue;
      const binding = {
        projectKey,
        projectRoot,
        chapterNumber: entry.chapterNumber,
        latestCommittedChapter: entry.publication.latestCommittedChapter,
        purpose: entry.publication.purpose,
        sourceHash: entry.sourceHash,
        revisionId: entry.revisionId,
        createdAtMs: Date.parse(entry.publication.boundAt),
        durablePublication: true
      };
      let reserved = false;
      try {
        const reservation = this.tokenStore.reserveRecoveredRevisionPublication(
          entry.publication.revisionToken,
          binding
        );
        if (reservation === 'expired') {
          await this.dependencies.gateway.discardAdjustmentRevision({
            projectRoot,
            chapterNumber: entry.chapterNumber,
            revisionId: entry.revisionId,
            expectedSourceHash: entry.sourceHash
          });
          continue;
        }
        if (reservation === 'reserved') {
          reserved = true;
          this.tokenStore.publishReservedRevision(
            entry.publication.revisionToken,
            binding
          );
        }
        if (entry.state === 'publishing') {
          await this.dependencies.gateway.promoteAdjustmentPublication({
            projectRoot,
            chapterNumber: entry.chapterNumber,
            revisionId: entry.revisionId,
            expectedSourceHash: entry.sourceHash,
            revisionToken: entry.publication.revisionToken
          });
        }
        if (reserved) {
          this.tokenStore.commitRevisionPublication(
            entry.publication.revisionToken
          );
        }
      } catch {
        if (reserved) {
          this.tokenStore.discardRevisionPublication(
            entry.publication.revisionToken
          );
        }
      }
    }
  }

  private async begin(
    projectKey: string,
    kind: ChapterTaskKind
  ): Promise<ChapterTask> {
    const projectRoot = await this.resolveProjectRoot(projectKey);
    if (projectRoot === null) {
      return this.createFailedTask(
        projectKey,
        kind,
        1,
        'project_unavailable'
      );
    }

    let inspection: ChapterInspection;
    try {
      inspection = ChapterInspectionSchema.parse(
        await this.dependencies.gateway.inspect(projectRoot)
      );
    } catch (error) {
      return this.createFailedTask(
        projectKey,
        kind,
        1,
        toChapterStartErrorKind(error, kind)
      );
    }

    if (!inspection.available) {
      return this.createFailedTask(
        projectKey,
        kind,
        1,
        kind === 'drafting' ? 'plan_missing' : 'project_unavailable'
      );
    }

    const blockedKind = blockedByArtifacts(kind, inspection.phase);
    if (blockedKind !== null) {
      return this.createFailedTask(
        projectKey,
        kind,
        inspection.chapterNumber,
        blockedKind
      );
    }

    const active = this.activeTask(projectKey);
    if (active !== null) {
      return active.task.kind === kind
        ? this.copyTask(active)
        : this.createFailedTask(
          projectKey,
          kind,
          inspection.chapterNumber,
          'generation_busy'
        );
    }

    const internal = this.createTask(
      projectKey,
      kind,
      inspection.chapterNumber
    );
    this.tasks.set(internal.task.taskId, internal);
    this.activeByProject.set(projectKey, internal.task.taskId);
    const task = this.copyTask(internal);
    void this.run(internal, projectRoot).catch(() => undefined);
    return task;
  }

  private async run(
    internal: InternalChapterTask,
    projectRoot: string
  ): Promise<void> {
    try {
      this.updateTask(internal, {
        status: 'running',
        canCancel: true,
        canRetry: false,
        error: null
      });
      const input = {
        projectRoot,
        onProgress: (event: ChapterEngineProgressEvent) => {
          this.reportProgress(internal, event);
        },
        shouldStop: () => internal.stopRequested
      };
      if (internal.task.kind === 'planning') {
        await this.dependencies.gateway.plan(input);
        const review = TrustedChapterPlanReviewSchema.parse(
          await this.dependencies.gateway.readPlan(projectRoot)
        );
        requireMatchingReview(review, internal.task.chapterNumber);
      } else {
        await this.dependencies.gateway.draft(input);
        const review = ChapterDraftReviewResultSchema.parse(
          await this.dependencies.gateway.readDraft(projectRoot)
        );
        requireMatchingReview(review, internal.task.chapterNumber);
      }
      this.finishSucceeded(internal);
    } catch (error) {
      if (isCancellation(error)) {
        this.finishCancelled(internal);
      } else {
        this.finishFailed(
          internal,
          toChapterRunErrorKind(error, internal.task.kind)
        );
      }
    } finally {
      if (
        this.activeByProject.get(internal.task.projectKey)
          === internal.task.taskId
      ) {
        this.activeByProject.delete(internal.task.projectKey);
      }
      this.retainTerminalTask(internal);
    }
  }

  private reportProgress(
    internal: InternalChapterTask,
    event: ChapterEngineProgressEvent
  ): void {
    if (internal.terminal) return;
    if (event.stage === 'completed') return;
    const completedStages = event.state === 'completed'
      ? addCompletedStage(internal.task.completedStages, event.stage)
      : internal.task.completedStages;
    const sceneProgress = event.stage === 'scene_drafts'
      && event.state === 'progress'
      && event.current !== undefined
      && event.total !== undefined
      ? { current: event.current, total: event.total }
      : event.stage === 'scene_drafts'
        ? internal.task.sceneProgress
        : null;
    this.updateTask(internal, {
      stage: event.stage,
      completedStages,
      sceneProgress
    });
  }

  private finishSucceeded(internal: InternalChapterTask): void {
    if (internal.terminal) return;
    this.updateTask(internal, {
      status: 'succeeded',
      stage: 'completed',
      completedStages: addCompletedStage(
        internal.task.completedStages,
        'completed'
      ),
      sceneProgress: null,
      canCancel: false,
      canRetry: false,
      error: null
    });
    internal.terminal = true;
  }

  private finishCancelled(internal: InternalChapterTask): void {
    if (internal.terminal) return;
    this.updateTask(internal, {
      status: 'cancelled',
      canCancel: false,
      canRetry: true,
      error: null
    });
    internal.terminal = true;
  }

  private finishFailed(
    internal: InternalChapterTask,
    kind: ChapterErrorKind
  ): void {
    if (internal.terminal) return;
    this.updateTask(internal, {
      status: 'failed',
      canCancel: false,
      canRetry: canRetry(kind),
      error: { kind, message: chapterErrorMessage(kind) }
    });
    internal.terminal = true;
  }

  private createFailedTask(
    projectKey: string,
    taskKind: ChapterTaskKind,
    chapterNumber: number,
    errorKind: ChapterErrorKind
  ): ChapterTask {
    const internal = this.createTask(projectKey, taskKind, chapterNumber);
    this.tasks.set(internal.task.taskId, internal);
    this.finishFailed(internal, errorKind);
    this.retainTerminalTask(internal);
    return this.copyTask(internal);
  }

  private createTask(
    projectKey: string,
    kind: ChapterTaskKind,
    chapterNumber: number,
    requestFingerprint?: string
  ): InternalChapterTask {
    const now = this.clock().toISOString();
    const adjustment = kind === 'mission_adjustment'
      || kind === 'plan_adjustment';
    return {
      task: ChapterTaskSchema.parse({
        taskId: `chapter_${Buffer.from(this.randomBytes(12)).toString('hex')}`,
        projectKey,
        kind,
        chapterNumber,
        status: 'queued',
        stage: adjustment ? 'requesting_adjustment' : 'preparing',
        completedStages: [],
        sceneProgress: null,
        startedAt: now,
        updatedAt: now,
        canCancel: true,
        canRetry: false,
        error: null
      }),
      adjustmentCommitStarted: false,
      ...(requestFingerprint === undefined ? {} : { requestFingerprint }),
      stopRequested: false,
      terminal: false,
      retained: false
    };
  }

  private updateTask(
    internal: InternalChapterTask,
    update: Partial<Omit<
      ChapterTask,
      'taskId' | 'projectKey' | 'kind' | 'chapterNumber'
        | 'startedAt' | 'updatedAt'
    >>
  ): void {
    internal.task = ChapterTaskSchema.parse({
      ...internal.task,
      ...update,
      updatedAt: this.clock().toISOString()
    });
  }

  private retainTerminalTask(internal: InternalChapterTask): void {
    if (!internal.terminal || internal.retained) return;
    internal.retained = true;
    this.terminalTaskIds.push(internal.task.taskId);
    while (this.terminalTaskIds.length > MAX_TERMINAL_TASKS) {
      const expiredTaskId = this.terminalTaskIds.shift();
      if (expiredTaskId !== undefined) this.tasks.delete(expiredTaskId);
    }
  }

  private activeTask(projectKey: string): InternalChapterTask | null {
    const taskId = this.activeByProject.get(projectKey);
    if (taskId === undefined) return null;
    const internal = this.tasks.get(taskId);
    if (internal === undefined || internal.terminal) return null;
    return internal;
  }

  private requireTask(taskId: string): ChapterTask {
    const internal = this.tasks.get(taskId);
    if (internal === undefined) throw new Error('Chapter task was not found.');
    return this.copyTask(internal);
  }

  private copyTask(internal: InternalChapterTask): ChapterTask {
    return ChapterTaskSchema.parse(internal.task);
  }

  private async resolveProjectRoot(projectKey: string): Promise<string | null> {
    try {
      return await this.dependencies.projects.resolveProjectRoot(projectKey);
    } catch {
      return null;
    }
  }
}

function blockedByArtifacts(
  kind: ChapterTaskKind,
  phase: Extract<ChapterInspection, { available: true }>['phase']
): ChapterErrorKind | null {
  if (kind === 'planning') {
    return phase === 'plan_ready'
      || phase === 'drafting_partial'
      || phase === 'draft_ready'
      ? 'already_complete'
      : null;
  }
  if (phase === 'draft_ready') return 'already_complete';
  return phase === 'plan_ready' || phase === 'drafting_partial'
    ? null
    : 'plan_missing';
}

function requireMatchingReview(
  review: TrustedChapterPlanReview | ChapterDraftReviewResult,
  chapterNumber: number
): void {
  if (!review.available || review.chapterNumber !== chapterNumber) {
    throw Object.assign(
      new Error('The completed chapter review is unavailable or mismatched.'),
      { code: 'DESKTOP_CHAPTER_INVALID_OUTPUT' }
    );
  }
}

function mapAuthoringError(error: unknown): ChapterAuthoringResult {
  switch (errorCode(error)) {
    case 'DESKTOP_CHAPTER_EDIT_STALE':
    case 'DESKTOP_CHAPTER_EDIT_COMMITTED':
    case 'DESKTOP_CHAPTER_REVISION_ALREADY_ADOPTED':
      return { outcome: 'stale', messageKey: 'stale_edit' };
    case 'CHAPTER_PARTICIPANT_ROSTER_MISSING':
      return {
        outcome: 'blocked',
        messageKey: 'participant_roster_missing'
      };
    case 'PROJECT_OPERATION_BUSY':
      return { outcome: 'blocked', messageKey: 'generation_busy' };
    case 'DESKTOP_CHAPTER_INVALID_OUTPUT':
    case 'DESKTOP_CHAPTER_EDIT_INVALID':
      return { outcome: 'invalid', messageKey: 'invalid_output' };
    default:
      return { outcome: 'invalid', messageKey: 'invalid_output' };
  }
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function addCompletedStage(
  completedStages: ChapterTaskStage[],
  stage: ChapterTaskStage
): ChapterTaskStage[] {
  return completedStages.includes(stage)
    ? completedStages
    : [...completedStages, stage];
}

function isCancellation(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'CHAPTER_PLANNING_CANCELLED'
    || code === 'CHAPTER_DRAFT_CANCELLED'
    || code === 'CHAPTER_ADJUSTMENT_CANCELLED';
}

function chapterAdjustmentCancelledError(): Error & { code: string } {
  return Object.assign(new Error('Chapter adjustment was cancelled.'), {
    code: 'CHAPTER_ADJUSTMENT_CANCELLED'
  });
}

function toInspectionErrorKind(
  error: unknown
): 'project_unavailable' | 'stale_chapter' | 'invalid_output' {
  const code = errorCode(error);
  if (code === 'DESKTOP_CHAPTER_STALE') return 'stale_chapter';
  if (isInvalidOutputError(error)) return 'invalid_output';
  return 'project_unavailable';
}

function toChapterStartErrorKind(
  error: unknown,
  taskKind: ChapterTaskKind
): ChapterErrorKind {
  const code = errorCode(error);
  if (code === 'DESKTOP_CHAPTER_STALE') return 'stale_chapter';
  if (isInvalidOutputError(error)) return 'invalid_output';
  if (
    code === 'PROJECT_NOT_FOUND'
    || code === 'ENOENT'
    || code.includes('PROJECT_UNAVAILABLE')
    || code.includes('PROJECT_DATA_INVALID')
  ) {
    return 'project_unavailable';
  }
  return toChapterRunErrorKind(error, taskKind);
}

function toChapterRunErrorKind(
  error: unknown,
  taskKind: ChapterTaskKind
): ChapterErrorKind {
  const classification = providerClassification(error);
  if (classification === 'login_required') return 'login_required';
  if (classification === 'usage_limit') return 'usage_limit';
  if (classification === 'invalid_output') return 'invalid_output';
  if (classification === 'unavailable') return 'codex_unavailable';

  const code = errorCode(error);
  if (
    code === 'DESKTOP_CHAPTER_STALE'
    || code === 'AUTHOR_REVISION_SOURCE_STALE'
  ) return 'stale_chapter';
  if (code.includes('LOGIN') || code.includes('AUTH')) return 'login_required';
  if (code.includes('USAGE_LIMIT') || code.includes('RATE_LIMIT')) {
    return 'usage_limit';
  }
  if (code.includes('TIMEOUT')) return 'timeout';
  if (code === 'DESKTOP_CHAPTER_UNAVAILABLE') {
    return taskKind === 'drafting' ? 'plan_missing' : 'project_unavailable';
  }
  if (isInvalidOutputError(error)) return 'invalid_output';
  if (
    code === 'ENOENT'
    || code === 'CODEX_BINARY_NOT_FOUND'
    || code.includes('CODEX_UNAVAILABLE')
    || code.includes('CODEX_EXEC_FAILED')
  ) {
    return 'codex_unavailable';
  }
  if (
    code === 'PROJECT_NOT_FOUND'
    || code.includes('PROJECT_UNAVAILABLE')
    || code.includes('PROJECT_DATA_INVALID')
  ) {
    return 'project_unavailable';
  }
  if (code.includes('LOCKED') || code.includes('BUSY')) {
    return 'generation_busy';
  }
  if (code === 'CHAPTER_REVISION_TOKEN_CAPACITY') {
    return 'generation_busy';
  }
  return 'unexpected';
}

function isInvalidOutputError(error: unknown): boolean {
  const code = errorCode(error);
  return errorName(error) === 'ZodError'
    || code === 'CODEX_OUTPUT_MISSING'
    || code === 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    || code.includes('SCHEMA')
    || code.includes('INVALID_JSON')
    || code.includes('INVALID_OUTPUT')
    || code.includes('REPAIR_FAILED');
}

function toReviewUnavailableReason(
  error: unknown
): 'not_ready' | 'invalid_output' | 'project_unavailable' {
  if (isInvalidOutputError(error)) return 'invalid_output';
  if (errorCode(error) === 'DESKTOP_CHAPTER_UNAVAILABLE') return 'not_ready';
  return 'project_unavailable';
}

function providerClassification(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'classification' in error) {
    const classification = (error as { classification?: unknown })
      .classification;
    if (typeof classification === 'string') return classification;
  }
  return '';
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code.toUpperCase();
  }
  return '';
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function adjustmentRequestFingerprint(
  kind: Extract<ChapterTaskKind, 'mission_adjustment' | 'plan_adjustment'>,
  request: ChapterAdjustMissionRequest | ChapterAdjustPlanRequest
): string {
  return sha256(JSON.stringify([
    kind,
    request.projectKey,
    request.reviewToken,
    'optionToken' in request ? request.optionToken : null,
    request.authorInstruction
  ]));
}

function isTerminalStatus(status: ChapterTask['status']): boolean {
  return status === 'succeeded'
    || status === 'failed'
    || status === 'cancelled';
}

function canRetry(kind: ChapterErrorKind): boolean {
  return kind !== 'project_unavailable'
    && kind !== 'stale_chapter'
    && kind !== 'already_complete';
}

function chapterErrorMessage(kind: ChapterErrorKind): string {
  switch (kind) {
    case 'codex_unavailable':
      return 'Codex is unavailable on this device.';
    case 'login_required':
      return 'Sign in to Codex before generating this chapter.';
    case 'usage_limit':
      return 'Codex usage limit reached. Try again later.';
    case 'timeout':
      return 'Chapter generation timed out. Try again.';
    case 'invalid_output':
      return 'Codex returned invalid chapter content.';
    case 'plan_missing':
      return 'Complete the chapter plan before drafting.';
    case 'project_unavailable':
      return 'This project is unavailable.';
    case 'stale_chapter':
      return 'This chapter needs history recovery before generation.';
    case 'already_complete':
      return 'This chapter stage is already complete.';
    case 'generation_busy':
      return 'Another chapter task is already running for this project.';
    case 'unexpected':
      return 'Chapter generation failed unexpectedly.';
  }
}
