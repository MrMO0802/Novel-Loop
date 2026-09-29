import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import { ChapterReviewTokenStore } from '../../src/main/chapter/ChapterReviewTokenStore';
import { DraftWorkingCopyStore } from '../../src/main/chapter/DraftWorkingCopyStore';
import { ProjectSubmissionGuard } from '../../src/main/submission/ProjectSubmissionGuard';

import type {
  ChapterDraftReviewResult,
  ChapterInspection,
  ChapterTaskKind
} from '../../src/shared/chapterContract';
import type {
  ChapterEngineGateway,
  ChapterEngineProgressEvent,
  RunChapterInput,
  TrustedChapterPlanReview
} from '../../src/main/chapter/EngineChapterGateway';
import { EngineChapterGateway } from '../../src/main/chapter/EngineChapterGateway';
import {
  ProjectChapterService,
  type ChapterProjectRootResolver
} from '../../src/main/chapter/ProjectChapterService';

const projectKey = 'project_radio';
const secondProjectKey = 'project_building';
const projectRoot = '/library/radio';
const secondProjectRoot = '/library/building';

const engineDesktopMocks = vi.hoisted(() => ({
  readDesktopChapterPlan: vi.fn()
}));

vi.mock('novel-loop-engine/desktop', async (importOriginal) => ({
  ...await importOriginal<typeof import('novel-loop-engine/desktop')>(),
  readDesktopChapterPlan: engineDesktopMocks.readDesktopChapterPlan
}));

const planReview: Extract<TrustedChapterPlanReview, { available: true }> = {
  available: true,
  chapterNumber: 1,
  title: 'The Radio Wakes',
  latestCommittedChapter: 0,
  reviewHash: 'a'.repeat(64),
  missionHash: 'b'.repeat(64),
  mission: {
    chapterFunction: 'Open the impossible broadcast.',
    requiredObjectives: [{
      id: 'obj_secret',
      text: 'Introduce the powerless radio.',
      type: 'plot',
      priority: 'must'
    }],
    debtsToPayOrAdvance: [{
      id: 'debt_secret',
      promise: 'Advance the mystery of the impossible signal.'
    }],
    debtsToIntroduce: [],
    characterDeltas: [{
      characterId: 'char_secret',
      characterName: 'Lin Cheng',
      from: 'skeptical',
      to: 'alert',
      evidenceRequired: 'He records the frequency.'
    }],
    participants: [{
      characterId: 'char_secret',
      name: 'Lin Cheng',
      role: 'protagonist',
      origin: 'committed',
      selected: true
    }],
    readerInformationDelta: {
      newKnowledge: ['The radio works without power.'],
      newSuspicions: [],
      questionsToMaintain: ['Who is calling?'],
      questionsToAnswer: []
    },
    forbiddenMoves: ['Do not reveal the caller.'],
    targetEmotionalCurve: ['unease', 'resolve'],
    targetWordCount: 3_000
  },
  directions: [{
    candidateId: 'plan_001',
    title: 'Signal First',
    markdown: '# Signal First\n\nThe radio speaks first.\n',
    excerpt: 'The radio speaks first.',
    strengths: ['Immediate hook.'],
    risks: ['Needs a grounded reaction.'],
    aiRecommended: true,
    active: true
  }, {
    candidateId: 'plan_002',
    title: 'Building First',
    markdown: '# Building First\n\nOpen at the abandoned building.\n',
    excerpt: 'Open at the abandoned building.',
    strengths: ['Immediate atmosphere.'],
    risks: ['Delays the radio hook.'],
    aiRecommended: false,
    active: false
  }]
};

const draftReview: Extract<ChapterDraftReviewResult, { available: true }> = {
  available: true,
  chapterNumber: 1,
  title: 'The Radio Wakes',
  markdown: '# The Radio Wakes\n\nThe radio clicked once.\n',
  versionKind: 'generated',
  scenes: [{ summary: 'The radio names the old building.' }]
};

class MemoryProjectResolver implements ChapterProjectRootResolver {
  readonly roots = new Map([
    [projectKey, projectRoot],
    [secondProjectKey, secondProjectRoot]
  ]);

  async resolveProjectRoot(key: string): Promise<string | null> {
    return this.roots.get(key) ?? null;
  }
}

interface DeferredRun {
  input: RunChapterInput;
  kind: ChapterTaskKind;
  resolve(): void;
  reject(error: unknown): void;
}

interface AdjustmentResult {
  revisionId: string;
  sourceHash: string;
  candidate: {
    artifactKind: 'mission' | 'plan';
    title: string;
    markdown: string;
  };
}

interface DeferredAdjustment {
  input: {
    projectRoot: string;
    chapterNumber: number;
    authorInstruction: string;
    expectedSourceHash: string;
    missionIntent?: 'general' | 'participant_repair';
    shouldStop(): boolean;
    onCommitPoint(): void;
    onStage(stage: 'requesting_adjustment' | 'validating_adjustment' | 'ready_for_review'): void;
  };
  kind: 'mission' | 'plan';
  resolve(value: AdjustmentResult): void;
  reject(error: unknown): void;
}

class DeferredChapterGateway implements ChapterEngineGateway {
  readonly inspections = new Map<string, ChapterInspection>();
  readonly planReviews = new Map<string, TrustedChapterPlanReview>();
  readonly draftReviews = new Map<string, ChapterDraftReviewResult>();
  readonly runs: DeferredRun[] = [];
  readonly selections: unknown[] = [];
  readonly missionRevisions: unknown[] = [];
  readonly planRevisions: unknown[] = [];
  readonly adoptions: unknown[] = [];
  readonly draftAdoptions: Array<{
    projectRoot: string;
    markdown: string;
    expectedSourceHash: string;
  }> = [];
  readonly adjustments: DeferredAdjustment[] = [];
  readonly discardedAdjustments: unknown[] = [];
  readonly boundAdjustmentPublications: unknown[] = [];
  readonly promotedAdjustmentPublications: unknown[] = [];
  readonly publicationEvents: string[] = [];
  recoverableAdjustmentPublications: Array<{
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
  }> = [];
  bindAdjustmentPublicationError: unknown;
  promoteAdjustmentPublicationError: unknown;
  discardAdjustmentError: unknown;
  publicationListBarrier: Promise<void> | null = null;
  recoveryReads = 0;
  autoComplete = false;
  inspectError: unknown;
  planReviewError: unknown;
  draftReviewError: unknown;
  authoringError: unknown;
  draftAdoptionError: unknown;
  draftAdoptionBarrier: Promise<void> | null = null;
  draftAdoptionCalls = 0;

  constructor() {
    this.inspections.set(projectRoot, availableInspection('not_started'));
    this.inspections.set(secondProjectRoot, availableInspection('not_started'));
  }

  async inspect(root: string): Promise<ChapterInspection> {
    if (this.inspectError !== undefined) throw this.inspectError;
    return this.inspections.get(root) ?? { available: false, reason: 'chapter_missing' };
  }

  async plan(input: RunChapterInput): Promise<void> {
    return this.startRun('planning', input);
  }

  async draft(input: RunChapterInput): Promise<void> {
    return this.startRun('drafting', input);
  }

  async adjustMission(input: DeferredAdjustment['input']) {
    return this.startAdjustment('mission', input);
  }

  async adjustPlan(input: DeferredAdjustment['input'] & {
    sourcePlan: {
      candidateId: string;
      content: string;
      active: boolean;
    };
  }) {
    return this.startAdjustment('plan', input);
  }

  async readPlan(root: string): Promise<TrustedChapterPlanReview> {
    if (this.planReviewError !== undefined) throw this.planReviewError;
    return this.planReviews.get(root) ?? { available: false, reason: 'not_ready' };
  }

  async readDraft(root: string): Promise<ChapterDraftReviewResult> {
    if (this.draftReviewError !== undefined) throw this.draftReviewError;
    return this.draftReviews.get(root) ?? { available: false, reason: 'not_ready' };
  }

  async readDraftWithSource(root: string): Promise<{
    review: ChapterDraftReviewResult;
    sourceHash: string | null;
  }> {
    const review = await this.readDraft(root);
    return {
      review,
      sourceHash: review.available ? sha256(review.markdown) : null
    };
  }

  async adoptDraft(input: {
    projectRoot: string;
    markdown: string;
    expectedSourceHash: string;
  }): Promise<void> {
    this.draftAdoptionCalls += 1;
    await this.draftAdoptionBarrier;
    if (this.draftAdoptionError !== undefined) throw this.draftAdoptionError;
    this.draftAdoptions.push(input);
    this.draftReviews.set(input.projectRoot, {
      ...draftReview,
      markdown: input.markdown,
      versionKind: 'author_adopted'
    });
  }

  async selectDirection(input: unknown): Promise<void> {
    if (this.authoringError !== undefined) throw this.authoringError;
    this.selections.push(input);
  }

  async createMissionRevision(input: unknown): Promise<{
    revisionId: string;
    sourceHash: string;
  }> {
    if (this.authoringError !== undefined) throw this.authoringError;
    this.missionRevisions.push(input);
    return {
      revisionId: `author_revision_ch001_mission_v${this.missionRevisions.length}`,
      sourceHash: 'b'.repeat(64)
    };
  }

  async createPlanRevision(input: unknown): Promise<{
    revisionId: string;
    sourceHash: string;
  }> {
    if (this.authoringError !== undefined) throw this.authoringError;
    this.planRevisions.push(input);
    return {
      revisionId: `author_revision_ch001_plan_v${this.planRevisions.length}`,
      sourceHash: 'c'.repeat(64)
    };
  }

  async adoptRevision(input: unknown): Promise<void> {
    if (this.authoringError !== undefined) throw this.authoringError;
    this.adoptions.push(input);
  }

  async discardAdjustmentRevision(input: unknown): Promise<void> {
    if (this.discardAdjustmentError !== undefined) {
      throw this.discardAdjustmentError;
    }
    this.publicationEvents.push('discard');
    this.discardedAdjustments.push(input);
  }

  async bindAdjustmentPublication(input: unknown): Promise<void> {
    if (this.bindAdjustmentPublicationError !== undefined) {
      throw this.bindAdjustmentPublicationError;
    }
    this.publicationEvents.push('bind');
    this.boundAdjustmentPublications.push(input);
  }

  async promoteAdjustmentPublication(input: unknown): Promise<void> {
    if (this.promoteAdjustmentPublicationError !== undefined) {
      throw this.promoteAdjustmentPublicationError;
    }
    this.publicationEvents.push('promote');
    this.promotedAdjustmentPublications.push(input);
  }

  async listAdjustmentPublications() {
    this.recoveryReads += 1;
    await this.publicationListBarrier;
    return this.recoverableAdjustmentPublications;
  }

  emit(index: number, event: ChapterEngineProgressEvent): void {
    this.runs[index]?.input.onProgress(event);
  }

  succeed(index: number): void {
    const run = this.requireRun(index);
    if (run.kind === 'planning') {
      this.planReviews.set(run.input.projectRoot, planReview);
      this.inspections.set(run.input.projectRoot, availableInspection('plan_ready'));
    } else {
      this.draftReviews.set(run.input.projectRoot, draftReview);
      this.inspections.set(run.input.projectRoot, availableInspection('draft_ready'));
    }
    run.resolve();
  }

  succeedWithoutReview(index: number): void {
    this.requireRun(index).resolve();
  }

  succeedWithInvalidReview(index: number): void {
    const run = this.requireRun(index);
    if (run.kind === 'planning') {
      this.planReviews.set(run.input.projectRoot, {
        ...planReview,
        reviewHash: 'not-a-hash'
      });
    } else {
      this.draftReviews.set(run.input.projectRoot, {
        ...draftReview,
        runId: 'secret-run'
      } as unknown as ChapterDraftReviewResult);
    }
    run.resolve();
  }

  cancel(index: number): void {
    const run = this.requireRun(index);
    run.reject(withCode(
      run.kind === 'planning'
        ? 'CHAPTER_PLANNING_CANCELLED'
        : 'CHAPTER_DRAFT_CANCELLED',
      'internal cancellation'
    ));
  }

  fail(index: number, error: unknown): void {
    this.requireRun(index).reject(error);
  }

  emitAdjustment(
    index: number,
    stage: 'requesting_adjustment' | 'validating_adjustment' | 'ready_for_review'
  ): void {
    this.adjustments[index]?.input.onStage(stage);
  }

  commitAdjustment(index: number): void {
    const adjustment = this.adjustments[index];
    if (adjustment === undefined) throw new Error(`Expected adjustment ${index}.`);
    adjustment.input.onCommitPoint();
  }

  succeedAdjustment(index: number): void {
    const adjustment = this.adjustments[index];
    if (adjustment === undefined) throw new Error(`Expected adjustment ${index}.`);
    adjustment.resolve({
      revisionId: adjustment.kind === 'mission'
        ? 'author_revision_ch001_mission_v1'
        : 'author_revision_ch001_plan_v1',
      sourceHash: adjustment.input.expectedSourceHash,
      candidate: adjustment.kind === 'mission'
        ? {
            artifactKind: 'mission',
            title: '调整后的本章任务',
            markdown: '## 本章目的\n\n收紧本章任务。\n'
          }
        : {
            artifactKind: 'plan',
            title: '事故现场先行',
            markdown: '# 事故现场先行\n\n先展示重复事故。\n'
          }
    });
  }

  succeedAdjustmentWithCandidate(
    index: number,
    candidate: AdjustmentResult['candidate']
  ): void {
    const adjustment = this.adjustments[index];
    if (adjustment === undefined) throw new Error(`Expected adjustment ${index}.`);
    adjustment.resolve({
      revisionId: adjustment.kind === 'mission'
        ? 'author_revision_ch001_mission_v1'
        : 'author_revision_ch001_plan_v1',
      sourceHash: adjustment.input.expectedSourceHash,
      candidate
    });
  }

  failAdjustment(index: number, error: unknown): void {
    const adjustment = this.adjustments[index];
    if (adjustment === undefined) throw new Error(`Expected adjustment ${index}.`);
    adjustment.reject(error);
  }

  private async startRun(kind: ChapterTaskKind, input: RunChapterInput): Promise<void> {
    if (this.autoComplete) {
      if (kind === 'planning') {
        this.planReviews.set(input.projectRoot, {
          ...planReview,
          chapterNumber: inspectionChapterNumber(
            this.inspections.get(input.projectRoot)
          )
        });
      } else {
        this.draftReviews.set(input.projectRoot, {
          ...draftReview,
          chapterNumber: inspectionChapterNumber(
            this.inspections.get(input.projectRoot)
          )
        });
      }
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.runs.push({ input, kind, resolve, reject });
    });
  }

  private async startAdjustment(
    kind: 'mission' | 'plan',
    input: DeferredAdjustment['input']
  ): Promise<AdjustmentResult> {
    return new Promise((resolve, reject) => {
      this.adjustments.push({
        input,
        kind,
        resolve,
        reject
      });
    });
  }

  private requireRun(index: number): DeferredRun {
    const run = this.runs[index];
    if (run === undefined) throw new Error(`Expected chapter run ${index}.`);
    return run;
  }
}

describe('ProjectChapterService', () => {
  test.each(['read', 'save', 'discard', 'adopt'] as const)('shares submission admission guard with draft %s without nested locking', async (operation) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chapter-shared-guard-'));
    try {
      const submissionGuard = new ProjectSubmissionGuard();
      const { gateway, service } = createService({ workingCopies: new DraftWorkingCopyStore(root), submissionGuard });
      gateway.draftReviews.set(projectRoot, draftReview);
      const saved = await service.saveDraftWorkingCopy({ projectKey, markdown: 'Saved pending edit.' });
      let entered!: () => void; let release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      const held = submissionGuard.runExclusive(projectKey, async () => { entered(); await wait; });
      await started;
      let finished = false;
      const editing = (operation === 'read' ? service.readDraftWorkingCopy({ projectKey })
        : operation === 'save' ? service.saveDraftWorkingCopy({ projectKey, markdown: 'New pending edit.' })
        : operation === 'discard' ? service.discardDraftWorkingCopy({ projectKey })
        : service.adoptDraftRevision({ projectKey, revisionToken: saved.revisionToken, confirmAdoption: true }))
        .then(() => { finished = true; });
      await new Promise(resolve => setImmediate(resolve));
      expect(finished).toBe(false);
      release(); await held; await editing;
      expect(finished).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test('revokes an older draft token when a newer working copy is saved', async () => {
    const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'chapter-draft-token-'));
    try {
      const workingCopies = new DraftWorkingCopyStore(userDataRoot);
      const { gateway, service } = createService({ workingCopies });
      gateway.draftReviews.set(projectRoot, draftReview);

      const first = await service.saveDraftWorkingCopy({
        projectKey,
        markdown: '# The Radio Wakes\n\nAuthor version A.\n'
      });
      const second = await service.saveDraftWorkingCopy({
        projectKey,
        markdown: '# The Radio Wakes\n\nAuthor version B.\n'
      });

      await expect(service.adoptDraftRevision({
        projectKey,
        revisionToken: first.revisionToken,
        confirmAdoption: true
      })).rejects.toMatchObject({ code: 'DRAFT_ADOPTION_STALE' });
      expect(gateway.draftAdoptions).toHaveLength(0);

      await expect(service.adoptDraftRevision({
        projectKey,
        revisionToken: second.revisionToken,
        confirmAdoption: true
      })).resolves.toEqual({ outcome: 'adopted' });
      expect(gateway.draftAdoptions[0]?.markdown).toContain('version B');
    } finally {
      await rm(userDataRoot, { recursive: true, force: true });
    }
  });

  test('rejects adoption when the exact current working-copy content changed', async () => {
    const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'chapter-draft-generation-'));
    try {
      const workingCopies = new DraftWorkingCopyStore(userDataRoot);
      const { gateway, service } = createService({ workingCopies });
      gateway.draftReviews.set(projectRoot, draftReview);
      const saved = await service.saveDraftWorkingCopy({
        projectKey,
        markdown: '# The Radio Wakes\n\nToken-bound content.\n'
      });
      await workingCopies.save({
        projectKey,
        chapterNumber: 1,
        sourceHash: sha256(draftReview.markdown),
        markdown: '# The Radio Wakes\n\nExternally replaced content.\n',
        savedAt: '2026-08-04T02:00:00.000Z'
      });

      await expect(service.adoptDraftRevision({
        projectKey,
        revisionToken: saved.revisionToken,
        confirmAdoption: true
      })).rejects.toMatchObject({ code: 'DRAFT_ADOPTION_STALE' });
      expect(gateway.draftAdoptions).toHaveLength(0);
      await expect(workingCopies.read(
        projectKey,
        1,
        sha256(draftReview.markdown)
      )).resolves.toMatchObject({
        recoveryAvailable: true,
        markdown: expect.stringContaining('Externally replaced')
      });
    } finally {
      await rm(userDataRoot, { recursive: true, force: true });
    }
  });

  test('rejects an old token when the same generated markdown belongs to a different chapter', async () => {
    const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'chapter-draft-identity-'));
    try {
      const workingCopies = new DraftWorkingCopyStore(userDataRoot);
      const { gateway, service } = createService({ workingCopies });
      gateway.draftReviews.set(projectRoot, draftReview);
      const saved = await service.saveDraftWorkingCopy({
        projectKey,
        markdown: '# The Radio Wakes\n\nChapter one author copy.\n'
      });
      gateway.draftReviews.set(projectRoot, {
        ...draftReview,
        chapterNumber: 2
      });

      await expect(service.adoptDraftRevision({
        projectKey,
        revisionToken: saved.revisionToken,
        confirmAdoption: true
      })).rejects.toMatchObject({ code: 'DRAFT_ADOPTION_STALE' });
      expect(gateway.draftAdoptions).toHaveLength(0);
    } finally {
      await rm(userDataRoot, { recursive: true, force: true });
    }
  });

  test.each([
    'AUTHOR_REVISION_ROLLBACK_FAILED',
    'AUTHOR_REVISION_COMMIT_DURABILITY_UNCERTAIN',
    'AUTHOR_REVISION_RECOVERY_FAILED'
  ])('classifies %s as recovery-required without exposing filesystem details', async (
    adoptionErrorCode
  ) => {
    const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'chapter-draft-recovery-'));
    try {
      const workingCopies = new DraftWorkingCopyStore(userDataRoot);
      const { gateway, service } = createService({ workingCopies });
      gateway.draftReviews.set(projectRoot, draftReview);
      const saved = await service.saveDraftWorkingCopy({
        projectKey,
        markdown: '# The Radio Wakes\n\nRecovery required.\n'
      });
      gateway.draftAdoptionError = Object.assign(
        new Error(`/private/userData/working-copies/${projectKey}/draft.json`),
        { code: adoptionErrorCode }
      );

      const failure = await service.adoptDraftRevision({
        projectKey,
        revisionToken: saved.revisionToken,
        confirmAdoption: true
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({ code: 'DRAFT_ADOPTION_RECOVERY_REQUIRED' });
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain('/private/userData');
      gateway.draftAdoptionError = undefined;
      await expect(service.adoptDraftRevision({
        projectKey,
        revisionToken: saved.revisionToken,
        confirmAdoption: true
      })).rejects.toMatchObject({ code: 'DRAFT_ADOPTION_STALE' });
      expect(gateway.draftAdoptionCalls).toBe(1);
    } finally {
      await rm(userDataRoot, { recursive: true, force: true });
    }
  });

  test('serializes draft adoption and discard without deleting a later save', async () => {
    const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'chapter-draft-race-'));
    try {
      const workingCopies = new DraftWorkingCopyStore(userDataRoot);
      const { gateway, service } = createService({ workingCopies });
      gateway.draftReviews.set(projectRoot, draftReview);
      const saved = await service.saveDraftWorkingCopy({
        projectKey,
        markdown: '# The Radio Wakes\n\nAdopt this content.\n'
      });
      let releaseAdoption!: () => void;
      gateway.draftAdoptionBarrier = new Promise<void>((resolve) => {
        releaseAdoption = resolve;
      });

      const adoption = service.adoptDraftRevision({
        projectKey,
        revisionToken: saved.revisionToken,
        confirmAdoption: true
      });
      await eventually(() => expect(gateway.draftAdoptionCalls).toBe(1));
      const discard = service.discardDraftWorkingCopy({ projectKey });
      const laterSave = service.saveDraftWorkingCopy({
        projectKey,
        markdown: '# The Radio Wakes\n\nLater content.\n'
      });
      releaseAdoption();

      await expect(adoption).resolves.toEqual({ outcome: 'adopted' });
      await expect(discard).resolves.toEqual({ discarded: true });
      const later = await laterSave;
      await expect(service.adoptDraftRevision({
        projectKey,
        revisionToken: later.revisionToken,
        confirmAdoption: true
      })).resolves.toEqual({ outcome: 'adopted' });
      expect(gateway.draftAdoptions.at(-1)?.markdown).toContain('Later content');
    } finally {
      await rm(userDataRoot, { recursive: true, force: true });
    }
  });

  test('redacts absolute user-data paths from draft storage failures', async () => {
    const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'chapter-draft-redaction-'));
    try {
      const workingCopies = new DraftWorkingCopyStore(userDataRoot, {
        replace: async () => {
          throw new Error(`rename failed at ${path.join(userDataRoot, 'working-copies', 'secret')}`);
        }
      });
      const { gateway, service } = createService({ workingCopies });
      gateway.draftReviews.set(projectRoot, draftReview);

      const failure = await service.saveDraftWorkingCopy({
        projectKey,
        markdown: '# The Radio Wakes\n\nWill fail.\n'
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({ code: 'DRAFT_WORKING_COPY_UNAVAILABLE' });
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(userDataRoot);
    } finally {
      await rm(userDataRoot, { recursive: true, force: true });
    }
  });

  test('expires draft adoption tokens after thirty minutes without deleting recovery content', async () => {
    const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'chapter-draft-expiry-'));
    try {
      let now = Date.parse('2026-08-04T01:00:00.000Z');
      let sequence = 0;
      const gateway = new DeferredChapterGateway();
      gateway.draftReviews.set(projectRoot, draftReview);
      const workingCopies = new DraftWorkingCopyStore(userDataRoot);
      const service = new ProjectChapterService({
        gateway,
        projects: new MemoryProjectResolver(),
        workingCopies,
        clock: () => new Date(now),
        randomBytes: (size) => {
          const bytes = new Uint8Array(size);
          new DataView(bytes.buffer).setUint32(0, ++sequence);
          return bytes;
        }
      });
      const saved = await service.saveDraftWorkingCopy({
        projectKey,
        markdown: '# The Radio Wakes\n\nRecoverable after expiry.\n'
      });
      now += 30 * 60 * 1_000;

      await expect(service.adoptDraftRevision({
        projectKey,
        revisionToken: saved.revisionToken,
        confirmAdoption: true
      })).rejects.toMatchObject({ code: 'DRAFT_ADOPTION_STALE' });
      await expect(workingCopies.read(
        projectKey,
        1,
        sha256(draftReview.markdown)
      )).resolves.toMatchObject({ recoveryAvailable: true });
      expect(gateway.draftAdoptions).toHaveLength(0);
    } finally {
      await rm(userDataRoot, { recursive: true, force: true });
    }
  });

  test('returns the same active task for repeated starts of the same kind', async () => {
    const { gateway, service } = createService();

    const [first, second] = await Promise.all([
      service.startPlanning(projectKey),
      service.startPlanning(projectKey)
    ]);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    expect(second.taskId).toBe(first.taskId);
    expect(second.kind).toBe('planning');
    gateway.succeed(0);
  });

  test('shares one project mutex across planning and drafting', async () => {
    const { gateway, service } = createService();

    const [planning, drafting] = await Promise.all([
      service.startPlanning(projectKey),
      service.startDrafting(projectKey)
    ]);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    expect(planning.kind).toBe('planning');
    expect(drafting).toMatchObject({
      kind: 'drafting',
      status: 'failed',
      error: { kind: 'generation_busy' }
    });
    expect(gateway.runs).toHaveLength(1);
    gateway.succeed(0);
  });

  test('refuses drafting unless artifact inspection reports a complete plan', async () => {
    const { gateway, service } = createService();
    gateway.inspections.set(projectRoot, availableInspection('planning_partial'));

    await expect(service.startDrafting(projectKey)).resolves.toMatchObject({
      kind: 'drafting',
      status: 'failed',
      canRetry: true,
      error: { kind: 'plan_missing' }
    });
    expect(gateway.runs).toHaveLength(0);
  });

  test.each(['plan_ready', 'drafting_partial'] as const)(
    'allows drafting from the %s artifact phase',
    async (phase) => {
      const { gateway, service } = createService();
      gateway.inspections.set(projectRoot, availableInspection(phase));

      const task = await service.startDrafting(projectKey);
      await eventually(() => expect(gateway.runs).toHaveLength(1));

      expect(task.kind).toBe('drafting');
      gateway.succeed(0);
    }
  );

  test('keeps a successful terminal state sticky after a delayed cancellation', async () => {
    const { gateway, service } = createService();
    const task = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));
    gateway.succeed(0);
    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'succeeded',
        stage: 'completed'
      });
    });

    await expect(service.cancel(task.taskId)).resolves.toMatchObject({
      status: 'succeeded',
      stage: 'completed',
      canCancel: false,
      canRetry: false
    });
  });

  test('allows an in-flight success to win after stop was requested', async () => {
    const { gateway, service } = createService();
    const task = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    await expect(service.cancel(task.taskId)).resolves.toMatchObject({
      status: 'stop_requested',
      canCancel: false
    });
    gateway.succeed(0);

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'succeeded',
        error: null
      });
    });
  });

  test.each([
    ['planning', 'CHAPTER_PLANNING_CANCELLED'],
    ['drafting', 'CHAPTER_DRAFT_CANCELLED']
  ] as const)('maps %s engine cancellation to cancelled', async (kind, code) => {
    const { gateway, service } = createService();
    if (kind === 'drafting') {
      gateway.inspections.set(projectRoot, availableInspection('plan_ready'));
    }
    const task = kind === 'planning'
      ? await service.startPlanning(projectKey)
      : await service.startDrafting(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    await service.cancel(task.taskId);
    gateway.fail(0, withCode(code, '/private/project cancellation'));

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'cancelled',
        canRetry: true,
        error: null
      });
    });
  });

  test('requires a fresh schema-valid available review before reporting success', async () => {
    const { gateway, service } = createService();
    const missing = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));
    emitEngineCompletion(gateway, 0);
    gateway.succeedWithoutReview(0);
    await eventually(async () => {
      const failed = await service.get(missing.taskId);
      expect(failed).toMatchObject({
        status: 'failed',
        stage: 'finalizing',
        error: { kind: 'invalid_output' }
      });
      expect(failed.completedStages).not.toContain('completed');
    });

    gateway.inspections.set(projectRoot, availableInspection('planning_partial'));
    const invalid = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(2));
    emitEngineCompletion(gateway, 1);
    gateway.succeedWithInvalidReview(1);
    await eventually(async () => {
      const failed = await service.get(invalid.taskId);
      expect(failed).toMatchObject({
        status: 'failed',
        stage: 'finalizing',
        error: { kind: 'invalid_output' }
      });
      expect(failed.completedStages).not.toContain('completed');
    });
  });

  test('classifies unavailable plan and draft reviews without exposing internal errors', async () => {
    const notReady = createService();
    await expect(notReady.service.readPlan(projectKey)).resolves.toEqual({
      available: false,
      reason: 'not_ready'
    });

    const invalidPlan = createService();
    invalidPlan.gateway.planReviewError = withCode(
      'DESKTOP_CHAPTER_INVALID_OUTPUT',
      '/private/library/radio/planning/ranking.json is invalid'
    );
    await expect(invalidPlan.service.readPlan(projectKey)).resolves.toEqual({
      available: false,
      reason: 'invalid_output'
    });

    const invalidDraft = createService();
    invalidDraft.gateway.draftReviewError = withCode(
      'ZOD_INVALID_OUTPUT',
      '/private/library/radio/chapters/chapter_001/draft_v1.md is invalid'
    );
    await expect(invalidDraft.service.readDraft(projectKey)).resolves.toEqual({
      available: false,
      reason: 'invalid_output'
    });

    const unavailable = createService();
    unavailable.gateway.planReviewError = withCode(
      'ENOENT',
      '/private/library/radio disappeared'
    );
    const result = await unavailable.service.readPlan(projectKey);
    expect(result).toEqual({
      available: false,
      reason: 'project_unavailable'
    });
    expect(JSON.stringify(result)).not.toMatch(/private|ranking\.json|draft_v1\.md/i);
  });

  test.each([
    [Object.assign(new Error('secret model details'), {
      classification: 'upgrade_required'
    }), 'upgrade_required'],
    [Object.assign(new Error('secret login path'), {
      classification: 'login_required'
    }), 'login_required'],
    [Object.assign(new Error('secret quota details'), {
      classification: 'usage_limit'
    }), 'usage_limit'],
    [withCode('CODEX_TIMEOUT', '/private/project timed out'), 'timeout'],
    [withCode('DESKTOP_CHAPTER_INVALID_OUTPUT', '/private/project invalid'), 'invalid_output'],
    [withCode('CODEX_BINARY_NOT_FOUND', '/private/codex absent'), 'codex_unavailable'],
    [withCode('OTHER_FAILURE', '/private/project exploded'), 'unexpected']
  ] as const)('maps engine failures to author-safe %s errors', async (error, kind) => {
    const { gateway, service } = createService();
    const task = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));
    gateway.fail(0, error);

    await eventually(async () => {
      const failed = await service.get(task.taskId);
      expect(failed).toMatchObject({
        status: 'failed',
        error: { kind }
      });
      expect(failed.error?.message).not.toMatch(/private|secret|codex absent/i);
    });
  });

  test.each([
    ['planning', 'project_unavailable'],
    ['drafting', 'plan_missing']
  ] as const)(
    'maps a late unavailable engine result for %s to %s',
    async (taskKind, errorKind) => {
      const { gateway, service } = createService();
      if (taskKind === 'drafting') {
        gateway.inspections.set(projectRoot, availableInspection('plan_ready'));
      }
      const task = taskKind === 'planning'
        ? await service.startPlanning(projectKey)
        : await service.startDrafting(projectKey);
      await eventually(() => expect(gateway.runs).toHaveLength(1));
      gateway.fail(0, withCode(
        'DESKTOP_CHAPTER_UNAVAILABLE',
        '/private/project artifacts disappeared'
      ));

      await eventually(async () => {
        const failed = await service.get(task.taskId);
        expect(failed).toMatchObject({
          status: 'failed',
          error: { kind: errorKind }
        });
        expect(failed.error?.message).not.toContain('/private/project');
        if (taskKind === 'planning') {
          expect(failed.error?.message).not.toMatch(/plan before drafting/i);
        }
      });
    }
  );

  test('maps missing plans, unavailable projects, and stale chapters safely', async () => {
    const missing = createService();
    missing.gateway.inspections.set(projectRoot, {
      available: false,
      reason: 'global_plan_missing'
    });
    await expect(missing.service.startDrafting(projectKey)).resolves.toMatchObject({
      error: { kind: 'plan_missing' }
    });

    const unavailable = createService();
    unavailable.resolver.roots.delete(projectKey);
    await expect(unavailable.service.startPlanning(projectKey)).resolves.toMatchObject({
      error: { kind: 'project_unavailable' }
    });

    const stale = createService();
    stale.gateway.inspectError = withCode(
      'DESKTOP_CHAPTER_STALE',
      '/private/project stale details'
    );
    const staleTask = await stale.service.startPlanning(projectKey);
    expect(staleTask).toMatchObject({
      status: 'failed',
      canRetry: false,
      error: { kind: 'stale_chapter' }
    });
    expect(staleTask.error?.message).not.toContain('/private/project');
  });

  test('reconstructs restart inspection and start routing from artifacts alone', async () => {
    const gateway = new DeferredChapterGateway();
    gateway.inspections.set(projectRoot, availableInspection('drafting_partial'));

    const firstProcess = createService({ gateway }).service;
    await expect(firstProcess.inspect(projectKey)).resolves.toEqual(
      availableInspection('drafting_partial')
    );

    const restartedProcess = createService({ gateway }).service;
    const resumed = await restartedProcess.startDrafting(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    expect(resumed).toMatchObject({
      kind: 'drafting',
      chapterNumber: 1
    });
    gateway.succeed(0);
  });

  test('reports bounded drafting scene progress through the strict task schema', async () => {
    const { gateway, service } = createService();
    gateway.inspections.set(projectRoot, availableInspection('plan_ready'));
    const task = await service.startDrafting(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));

    gateway.emit(0, {
      stage: 'scene_drafts',
      state: 'progress',
      current: 1,
      total: 2
    });

    await expect(service.get(task.taskId)).resolves.toMatchObject({
      stage: 'scene_drafts',
      sceneProgress: { current: 1, total: 2 }
    });
    gateway.succeed(0);
  });

  test('retains only the latest one hundred terminal tasks', async () => {
    const gateway = new DeferredChapterGateway();
    gateway.autoComplete = true;
    const { resolver, service } = createService({ gateway });
    const started = await Promise.all(Array.from({ length: 101 }, async (_, index) => {
      const key = `project_retention_${index}`;
      const root = `/library/retention-${index}`;
      resolver.roots.set(key, root);
      gateway.inspections.set(root, {
        ...availableInspection('not_started'),
        chapterNumber: index + 1
      });
      return service.startPlanning(key);
    }));

    await eventually(async () => {
      await expect(service.get(started[100]!.taskId)).resolves.toMatchObject({
        status: 'succeeded'
      });
    });
    await expect(service.get(started[0]!.taskId))
      .rejects.toThrow('Chapter task was not found.');
    await expect(service.get(started[1]!.taskId))
      .resolves.toMatchObject({ status: 'succeeded' });
  });

  test('maps trusted plan, mission, and participant bindings to opaque renderer tokens', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);

    const review = await readAvailablePlan(service);
    expect(review.reviewToken).toMatch(/^chapter_review_[a-f0-9]{48}$/u);
    expect(review.directions).toHaveLength(2);
    expect(review.directions.every(({ optionToken }) => (
      /^chapter_option_[a-f0-9]{48}$/u.test(optionToken)
    ))).toBe(true);
    expect(review.selectedPlan).toEqual({
      title: 'Signal First',
      markdown: '# Signal First\n\nThe radio speaks first.\n'
    });
    expect(review.alternatives).toEqual([{
      title: 'Building First',
      excerpt: 'Open at the abandoned building.',
      strengths: ['Immediate atmosphere.'],
      risks: ['Delays the radio hook.']
    }]);
    expect(JSON.stringify(review)).not.toMatch(
      /\/library\/|plan_\d|obj_secret|debt_secret|char_secret|[a-f0-9]{64}|schema|runId|provider|profile|auth/iu
    );
  });

  test('resolves direction tokens before selection or alternative plan save', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const alternative = review.directions.find(({ active }) => !active)!;

    await expect(service.selectDirection({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: alternative.optionToken
    })).resolves.toEqual({ outcome: 'adopted' });
    expect(gateway.selections).toEqual([{
      projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_002',
      expectedReviewHash: 'a'.repeat(64)
    }]);

    const saved = await service.savePlanWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: alternative.optionToken,
      markdown: '# Building revised\n\nThe radio waits upstairs.\n'
    });
    expect(saved).toMatchObject({
      outcome: 'saved',
      revisionToken: expect.stringMatching(/^chapter_revision_[a-f0-9]{48}$/u)
    });
    expect(gateway.planRevisions).toEqual([{
      projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_002',
      expectedReviewHash: 'a'.repeat(64),
      markdown: '# Building revised\n\nThe radio waits upstairs.\n'
    }]);
  });

  test('runs mission and plan adjustments as cancellable tasks with opaque ready revisions', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const alternative = review.directions.find(({ active }) => !active)!;

    const missionTask = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));
    expect(missionTask).toMatchObject({
      kind: 'mission_adjustment',
      status: 'queued'
    });
    expect(gateway.adjustments[0]?.input).toMatchObject({
      projectRoot,
      chapterNumber: 1,
      expectedSourceHash: 'b'.repeat(64),
      authorInstruction: '收紧本章任务。'
    });
    gateway.emitAdjustment(0, 'requesting_adjustment');
    gateway.emitAdjustment(0, 'validating_adjustment');
    gateway.succeedAdjustment(0);
    await eventually(async () => {
      const completed = await service.get(missionTask.taskId);
      expect(completed).toMatchObject({
        kind: 'mission_adjustment',
        status: 'succeeded',
        stage: 'ready_for_review',
        resultRevisionToken: expect.stringMatching(
          /^chapter_revision_[a-f0-9]{48}$/u
        ),
        resultCandidate: {
          artifactKind: 'mission',
          title: '调整后的本章任务'
        }
      });
      expect(JSON.stringify(completed)).not.toMatch(
        /author_revision|sourceHash|plan_\d|\/library\//iu
      );
    });

    const planTask = await service.adjustPlan({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: alternative.optionToken,
      authorInstruction: '把开场提前到事故现场。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(2));
    expect(gateway.adjustments[1]?.input).toMatchObject({
      projectRoot,
      chapterNumber: 1,
      expectedSourceHash: sha256(planReview.directions[1]!.markdown),
      authorInstruction: '把开场提前到事故现场。',
      sourcePlan: {
        candidateId: 'plan_002',
        content: planReview.directions[1]!.markdown,
        active: false
      }
    });
    gateway.succeedAdjustment(1);
    await eventually(async () => {
      await expect(service.get(planTask.taskId)).resolves.toMatchObject({
        kind: 'plan_adjustment',
        status: 'succeeded',
        stage: 'ready_for_review',
        resultCandidate: { artifactKind: 'plan', title: '事故现场先行' }
      });
    });
    expect(gateway.adoptions).toHaveLength(0);
  });

  test('marks the exact participant repair instruction as trusted narrow intent', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);

    await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '补全本章场景所需人物，只声明已有或本章首次出场人物，不新增剧情事实。'
    });

    await eventually(() => expect(gateway.adjustments).toHaveLength(1));
    expect(gateway.adjustments[0]!.input.missionIntent)
      .toBe('participant_repair');
    gateway.failAdjustment(0, withCode(
      'CHAPTER_ADJUSTMENT_CANCELLED',
      'test cleanup'
    ));
  });

  test('cancels an adjustment through the shared task lifecycle without creating a token', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));

    await expect(service.cancel(task.taskId)).resolves.toMatchObject({
      status: 'stop_requested',
      canCancel: false
    });
    expect(gateway.adjustments[0]!.input.shouldStop()).toBe(true);
    gateway.failAdjustment(0, withCode(
      'CHAPTER_ADJUSTMENT_CANCELLED',
      '/private/internal cancellation'
    ));

    await eventually(async () => {
      const cancelled = await service.get(task.taskId);
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        canRetry: true
      });
      expect(cancelled.resultRevisionToken).toBeUndefined();
    });
  });

  test('coalesces only an identical active adjustment request', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const request = {
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    };

    const first = await service.adjustMission(request);
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));
    const identicalRetry = await service.adjustMission(request);
    const differentRequest = await service.adjustMission({
      ...request,
      authorInstruction: '保留节奏，只修正人物。'
    });

    expect(identicalRetry.taskId).toBe(first.taskId);
    expect(differentRequest).toMatchObject({
      kind: 'mission_adjustment',
      status: 'failed',
      error: { kind: 'generation_busy' }
    });
    expect(differentRequest.taskId).not.toBe(first.taskId);
    expect(gateway.adjustments).toHaveLength(1);

    gateway.failAdjustment(0, withCode(
      'CHAPTER_ADJUSTMENT_CANCELLED',
      'test cleanup'
    ));
  });

  test('cancels a late gateway result when stop was requested before commit', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));

    await service.cancel(task.taskId);
    gateway.succeedAdjustment(0);

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'cancelled',
        canRetry: true
      });
    });
    const cancelled = await service.get(task.taskId);
    expect(cancelled.resultRevisionToken).toBeUndefined();
    expect(cancelled.resultCandidate).toBeUndefined();
  });

  test('makes the tiny adjustment commit section non-cancellable', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));

    gateway.commitAdjustment(0);
    await expect(service.cancel(task.taskId)).resolves.toMatchObject({
      status: 'running',
      canCancel: false
    });
    expect(gateway.adjustments[0]!.input.shouldStop()).toBe(false);
    gateway.succeedAdjustment(0);

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'succeeded',
        canCancel: false
      });
    });
  });

  test('maps an atomic author revision source race to stale chapter', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));

    gateway.failAdjustment(0, withCode(
      'AUTHOR_REVISION_SOURCE_STALE',
      '/private/project changed'
    ));

    await eventually(async () => {
      const failed = await service.get(task.taskId);
      expect(failed).toMatchObject({
        status: 'failed',
        error: { kind: 'stale_chapter' }
      });
      expect(failed.error?.message).not.toContain('/private/project');
    });
  });

  test('rejects a leaking gateway candidate and discards its ready revision', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));

    gateway.succeedAdjustmentWithCandidate(0, {
      artifactKind: 'mission',
      title: '调整后的本章任务',
      markdown: '## 本章目的\n\nselected_plan.md\n'
    });

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'failed',
        error: { kind: 'invalid_output' }
      });
    });
    expect(gateway.discardedAdjustments).toEqual([{
      projectRoot,
      chapterNumber: 1,
      revisionId: 'author_revision_ch001_mission_v1',
      expectedSourceHash: 'b'.repeat(64)
    }]);
    expect((await service.get(task.taskId)).resultRevisionToken).toBeUndefined();
  });

  test('reserves publication capacity before starting the gateway adjustment', async () => {
    const tokenStore = createTokenStore().store;
    const reserve = vi.fn(() => {
      throw withCode(
        'CHAPTER_REVISION_TOKEN_CAPACITY',
        'all publication slots are reserved'
      );
    });
    Object.assign(tokenStore, { reserveRevisionPublication: reserve });
    const { gateway, service } = createService({ tokenStore });
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);

    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });

    expect(task).toMatchObject({
      status: 'failed',
      error: { kind: 'generation_busy' }
    });
    expect(reserve).toHaveBeenCalledOnce();
    expect(gateway.adjustments).toHaveLength(0);
    expect(gateway.discardedAdjustments).toHaveLength(0);
  });

  test('discards a publishing revision when reserved-token publication fails', async () => {
    const tokenStore = createTokenStore().store;
    Object.assign(tokenStore, {
      publishReservedRevision: vi.fn(() => {
        throw new Error('publication failed');
      })
    });
    const { gateway, service } = createService({ tokenStore });
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));

    gateway.succeedAdjustment(0);

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'failed',
        error: { kind: 'unexpected' }
      });
    });
    expect(gateway.discardedAdjustments).toHaveLength(1);
    expect((await service.get(task.taskId)).resultRevisionToken).toBeUndefined();
  });

  test.each([
    'cancellation',
    'provider',
    'task_schema',
    'publication'
  ] as const)('preserves the previous capacity binding on %s failure', async (
    failure
  ) => {
    const tokenStore = createTokenStore().store;
    const revisions = Array.from({ length: 500 }, (_, index) => (
      tokenStore.createRevision(revisionTokenInput(index))
    ));
    if (failure === 'publication') {
      Object.assign(tokenStore, {
        publishReservedRevision: vi.fn(() => {
          throw new Error('publication failed');
        })
      });
    }
    const { gateway, service } = createService({ tokenStore });
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));

    if (failure === 'cancellation') {
      await service.cancel(task.taskId);
      gateway.failAdjustment(0, withCode(
        'CHAPTER_ADJUSTMENT_CANCELLED',
        'cancelled'
      ));
    } else if (failure === 'provider') {
      gateway.failAdjustment(0, withCode('CODEX_EXEC_FAILED', 'provider failed'));
    } else if (failure === 'task_schema') {
      gateway.succeedAdjustmentWithCandidate(0, {
        artifactKind: 'mission',
        title: '调整后的本章任务',
        markdown: 'selected_plan.md'
      });
    } else {
      gateway.succeedAdjustment(0);
    }
    await eventually(async () => {
      expect((await service.get(task.taskId)).status).toMatch(/failed|cancelled/u);
    });

    expect(tokenStore.reserveRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    })).toMatchObject({
      outcome: 'resolved',
      value: revisionTokenInput(0)
    });
  });

  test('binds recoverable metadata before token publication and promotes last', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));
    gateway.succeedAdjustment(0);

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'succeeded'
      });
    });
    expect(gateway.publicationEvents).toEqual(['bind', 'promote']);
    const succeeded = await service.get(task.taskId);
    expect(gateway.boundAdjustmentPublications[0]).toMatchObject({
      projectRoot,
      chapterNumber: 1,
      revisionId: 'author_revision_ch001_mission_v1',
      revisionToken: succeeded.resultRevisionToken,
      projectKey,
      latestCommittedChapter: 0,
      purpose: 'mission'
    });
    expect(gateway.promotedAdjustmentPublications[0]).toMatchObject({
      revisionToken: succeeded.resultRevisionToken
    });
  });

  test('rolls back capacity publication when promotion fails after binding', async () => {
    const tokenStore = createTokenStore().store;
    const revisions = Array.from({ length: 500 }, (_, index) => (
      tokenStore.createRevision(revisionTokenInput(index))
    ));
    const { gateway, service } = createService({ tokenStore });
    gateway.promoteAdjustmentPublicationError = new Error('promotion failed');
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));
    gateway.succeedAdjustment(0);

    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'failed',
        error: { kind: 'unexpected' }
      });
    });
    expect(gateway.publicationEvents).toEqual(['bind', 'discard']);
    expect(tokenStore.reserveRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    })).toMatchObject({
      outcome: 'resolved',
      value: revisionTokenInput(0)
    });
  });

  test.each(['publishing', 'ready'] as const)(
    'recovers a durable %s adjustment token after service restart',
    async (state) => {
      const revisionToken = `chapter_revision_${'d'.repeat(48)}`;
      const gateway = new DeferredChapterGateway();
      gateway.planReviews.set(projectRoot, planReview);
      gateway.recoverableAdjustmentPublications = [{
        state,
        revisionId: 'author_revision_ch001_mission_v1',
        sourceHash: 'b'.repeat(64),
        chapterNumber: 1,
        publication: {
          revisionToken,
          projectKey,
          latestCommittedChapter: 0,
          purpose: 'mission',
          boundAt: new Date(1_000).toISOString()
        }
      }];
      const service = new ProjectChapterService({
        gateway,
        projects: new MemoryProjectResolver(),
        tokenStore: createTokenStore().store
      });

      await expect(service.adoptRevision({
        projectKey,
        revisionToken,
        confirmInvalidation: true
      })).resolves.toEqual({ outcome: 'adopted' });
      expect(gateway.adoptions).toHaveLength(1);
      expect(gateway.promotedAdjustmentPublications).toHaveLength(
        state === 'publishing' ? 1 : 0
      );
    }
  );

  test('does not recover an unbound publishing record owned by a live adjustment', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const recoveryReadsBeforeTask = gateway.recoveryReads;
    const task = await service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));
    gateway.recoverableAdjustmentPublications = [{
      state: 'publishing',
      revisionId: 'author_revision_ch001_mission_v1',
      sourceHash: 'b'.repeat(64),
      chapterNumber: 1,
      publication: null
    }];

    await expect(service.readPlan(projectKey)).resolves.toMatchObject({
      available: true
    });
    expect(gateway.recoveryReads).toBe(recoveryReadsBeforeTask);
    expect(gateway.discardedAdjustments).toHaveLength(0);

    await service.cancel(task.taskId);
    gateway.failAdjustment(0, withCode(
      'CHAPTER_ADJUSTMENT_CANCELLED',
      'cancelled'
    ));
    await eventually(async () => {
      expect((await service.get(task.taskId)).status).toBe('cancelled');
    });
  });

  test('serializes an adjustment start behind an in-flight recovery scan', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    let releasePublicationList!: () => void;
    gateway.publicationListBarrier = new Promise<void>((resolve) => {
      releasePublicationList = resolve;
    });
    const pendingRead = service.readPlan(projectKey);
    await eventually(() => expect(gateway.recoveryReads).toBe(2));

    const pendingAdjustment = service.adjustMission({
      projectKey,
      reviewToken: review.reviewToken,
      authorInstruction: '收紧本章任务。'
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const startedBeforeRecoveryCompleted = gateway.adjustments.length;
    if (startedBeforeRecoveryCompleted > 0) {
      gateway.recoverableAdjustmentPublications = [{
        state: 'publishing',
        revisionId: 'author_revision_ch001_mission_v1',
        sourceHash: 'b'.repeat(64),
        chapterNumber: 1,
        publication: null
      }];
    }
    releasePublicationList();
    await pendingRead;
    const task = await pendingAdjustment;
    await eventually(() => expect(gateway.adjustments).toHaveLength(1));

    expect(startedBeforeRecoveryCompleted).toBe(0);
    expect(gateway.discardedAdjustments).toHaveLength(0);

    await service.cancel(task.taskId);
    gateway.failAdjustment(0, withCode(
      'CHAPTER_ADJUSTMENT_CANCELLED',
      'cancelled'
    ));
    await eventually(async () => {
      expect((await service.get(task.taskId)).status).toBe('cancelled');
    });
  });

  test('discards an expired durable adjustment instead of resurrecting its token', async () => {
    const revisionToken = `chapter_revision_${'e'.repeat(48)}`;
    const tokenContext = createTokenStore();
    tokenContext.advance(30 * 60 * 1_000);
    const gateway = new DeferredChapterGateway();
    gateway.planReviews.set(projectRoot, planReview);
    gateway.recoverableAdjustmentPublications = [{
      state: 'ready',
      revisionId: 'author_revision_ch001_mission_v1',
      sourceHash: 'b'.repeat(64),
      chapterNumber: 1,
      publication: {
        revisionToken,
        projectKey,
        latestCommittedChapter: 0,
        purpose: 'mission',
        boundAt: new Date(1_000).toISOString()
      }
    }];
    const service = new ProjectChapterService({
      gateway,
      projects: new MemoryProjectResolver(),
      tokenStore: tokenContext.store
    });

    await expect(service.readPlan(projectKey)).resolves.toMatchObject({
      available: true
    });
    expect(gateway.discardedAdjustments).toHaveLength(1);
    await expect(service.adoptRevision({
      projectKey,
      revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(gateway.adoptions).toHaveLength(0);
  });

  test('keeps an unbound publishing record non-ready when recovery cleanup fails', async () => {
    const gateway = new DeferredChapterGateway();
    gateway.planReviews.set(projectRoot, planReview);
    gateway.recoverableAdjustmentPublications = [{
      state: 'publishing',
      revisionId: 'author_revision_ch001_mission_v1',
      sourceHash: 'b'.repeat(64),
      chapterNumber: 1,
      publication: null
    }];
    gateway.discardAdjustmentError = new Error('cleanup failed');
    const service = new ProjectChapterService({
      gateway,
      projects: new MemoryProjectResolver(),
      tokenStore: createTokenStore().store
    });

    const review = await service.readPlan(projectKey);
    expect(review).toMatchObject({ available: true });
    expect(gateway.recoveryReads).toBe(1);
    expect(gateway.discardedAdjustments).toHaveLength(0);
    expect(gateway.promotedAdjustmentPublications).toHaveLength(0);
  });

  test('resolves mission item tokens while new participants remain name and role only', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const objective = review.mission.objectiveItems[0]!;
    const debt = review.mission.debtItems[0]!;
    const participant = review.mission.participantOptions[0]!;

    const result = await service.saveMissionWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      mission: {
        chapterFunction: review.mission.chapterFunction,
        requiredObjectives: [{
          itemToken: objective.itemToken,
          text: objective.text,
          type: objective.type,
          priority: objective.priority
        }, {
          itemToken: null,
          text: 'Make the radio answer a second time.',
          type: 'foreshadowing',
          priority: 'should'
        }],
        debtTokens: [debt.itemToken],
        debtsToIntroduce: [{
          type: 'mystery',
          promise: 'The caller remembers tomorrow.',
          importance: 8
        }],
        characterDeltas: [{
          participantToken: participant.participantToken,
          from: 'skeptical',
          to: 'alert',
          evidenceRequired: 'He records the frequency.'
        }],
        participantTokens: [participant.participantToken],
        newParticipants: [{ name: 'Mara', role: 'caller' }],
        readerInformation: review.mission.readerInformation,
        forbiddenMoves: review.mission.forbiddenMoves,
        targetEmotionalCurve: review.mission.targetEmotionalCurve,
        targetWordCount: review.mission.targetWordCount
      }
    });

    expect(result.outcome).toBe('saved');
    expect(gateway.missionRevisions).toEqual([{
      projectRoot,
      chapterNumber: 1,
      edit: {
        sourceMissionHash: 'b'.repeat(64),
        chapterFunction: 'Open the impossible broadcast.',
        requiredObjectives: [{
          sourceObjectiveId: 'obj_secret',
          text: 'Introduce the powerless radio.',
          type: 'plot',
          priority: 'must'
        }, {
          sourceObjectiveId: null,
          text: 'Make the radio answer a second time.',
          type: 'foreshadowing',
          priority: 'should'
        }],
        debtsToPayOrAdvance: ['debt_secret'],
        debtsToIntroduce: [{
          type: 'mystery',
          promise: 'The caller remembers tomorrow.',
          importance: 8
        }],
        characterDeltas: [{
          characterId: 'char_secret',
          from: 'skeptical',
          to: 'alert',
          evidenceRequired: 'He records the frequency.'
        }],
        participatingCharacterIds: ['char_secret'],
        newCharacters: [{ name: 'Mara', role: 'caller' }],
        readerInformationDelta: review.mission.readerInformation,
        forbiddenMoves: review.mission.forbiddenMoves,
        targetEmotionalCurve: review.mission.targetEmotionalCurve,
        targetWordCount: 3_000
      }
    }]);
  });

  test('rejects cross-project review tokens and consumes adoption tokens once', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    gateway.planReviews.set(secondProjectRoot, planReview);
    const review = await readAvailablePlan(service);
    const active = review.directions.find(({ active }) => active)!;

    await expect(service.selectDirection({
      projectKey: secondProjectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(gateway.selections).toHaveLength(0);

    const saved = await service.savePlanWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken,
      markdown: '# Signal revised\n\nThe radio speaks twice.\n'
    });
    if (saved.outcome !== 'saved') throw new Error('Expected a saved revision.');
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'adopted' });
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(gateway.adoptions).toHaveLength(1);
  });

  test('keeps a revision token retryable after busy adoption and consumes it on success', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const active = review.directions.find(({ active }) => active)!;
    const saved = await service.savePlanWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken,
      markdown: '# Retryable revision\n\nThe radio speaks twice.\n'
    });
    if (saved.outcome !== 'saved') throw new Error('Expected a saved revision.');

    gateway.authoringError = withCode('PROJECT_OPERATION_BUSY', 'lease busy');
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'blocked', messageKey: 'generation_busy' });

    gateway.authoringError = undefined;
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'adopted' });
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(gateway.adoptions).toHaveLength(1);
  });

  test('protects a reserved oldest revision at capacity through busy release and retry', async () => {
    const tokenContext = createTokenStore();
    const revisions = Array.from({ length: 500 }, (_, index) => (
      tokenContext.store.createRevision(revisionTokenInput(index))
    ));
    const gateway = new DeferredChapterGateway();
    gateway.planReviews.set(projectRoot, planReview);
    const service = new ProjectChapterService({
      gateway,
      projects: new MemoryProjectResolver(),
      tokenStore: tokenContext.store
    });
    let reportAdoptionStarted!: () => void;
    const adoptionStarted = new Promise<void>((resolve) => {
      reportAdoptionStarted = resolve;
    });
    let releaseBusyAdoption!: () => void;
    const busyAdoption = new Promise<void>((resolve) => {
      releaseBusyAdoption = resolve;
    });
    const successfulAdoption = gateway.adoptRevision.bind(gateway);
    gateway.adoptRevision = async () => {
      reportAdoptionStarted();
      await busyAdoption;
      throw withCode('PROJECT_OPERATION_BUSY', 'lease busy');
    };

    const firstAttempt = service.adoptRevision({
      projectKey,
      revisionToken: revisions[0]!,
      confirmInvalidation: true
    });
    await adoptionStarted;
    expect(tokenContext.store.reserveRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(tokenContext.store.reserveRevision({
      projectKey: secondProjectKey,
      projectRoot: secondProjectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });

    const replacement = tokenContext.store.createRevision({
      ...revisionTokenInput(500),
      projectKey: secondProjectKey,
      projectRoot: secondProjectRoot
    });
    releaseBusyAdoption();
    await expect(firstAttempt).resolves.toEqual({
      outcome: 'blocked',
      messageKey: 'generation_busy'
    });

    gateway.adoptRevision = successfulAdoption;
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: revisions[0]!,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'adopted' });
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: revisions[0]!,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(gateway.adoptions).toHaveLength(1);
    expect(tokenContext.store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[1]!,
      currentLatestCommittedChapter: 0
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    expect(tokenContext.store.consumeRevision({
      projectKey: secondProjectKey,
      projectRoot: secondProjectRoot,
      revisionToken: replacement,
      currentLatestCommittedChapter: 0
    }).outcome).toBe('resolved');
  });

  test('keeps a stale-source revision token retryable after a non-mutating failure', async () => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const active = review.directions.find(({ active }) => active)!;
    const saved = await service.savePlanWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken,
      markdown: '# Stale source revision\n\nThe radio speaks twice.\n'
    });
    if (saved.outcome !== 'saved') throw new Error('Expected a saved revision.');

    gateway.authoringError = withCode(
      'DESKTOP_CHAPTER_EDIT_STALE',
      'source changed'
    );
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'stale', messageKey: 'stale_edit' });

    gateway.authoringError = undefined;
    await expect(service.adoptRevision({
      projectKey,
      revisionToken: saved.revisionToken,
      confirmInvalidation: true
    })).resolves.toEqual({ outcome: 'adopted' });
  });

  test('blocks authoring during active and starting generation operations', async () => {
    const { gateway, resolver, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const active = review.directions.find(({ active }) => active)!;

    const task = await service.startPlanning(projectKey);
    await eventually(() => expect(gateway.runs).toHaveLength(1));
    await expect(service.selectDirection({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken
    })).resolves.toEqual({
      outcome: 'blocked',
      messageKey: 'generation_busy'
    });
    gateway.succeed(0);
    await eventually(async () => {
      await expect(service.get(task.taskId)).resolves.toMatchObject({
        status: 'succeeded'
      });
    });

    let releaseRoot!: () => void;
    const rootGate = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    let gateRoot = true;
    const originalResolve = resolver.resolveProjectRoot.bind(resolver);
    resolver.resolveProjectRoot = async (key) => {
      if (gateRoot) await rootGate;
      return originalResolve(key);
    };
    gateway.inspections.set(projectRoot, availableInspection('planning_partial'));
    const starting = service.startPlanning(projectKey);
    await Promise.resolve();
    await expect(service.savePlanWorkingCopy({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken,
      markdown: '# Busy edit\n'
    })).resolves.toEqual({
      outcome: 'blocked',
      messageKey: 'generation_busy'
    });
    gateRoot = false;
    releaseRoot();
    const startingTask = await starting;
    await eventually(() => expect(gateway.runs).toHaveLength(2));
    gateway.succeed(1);
    await eventually(async () => {
      await expect(service.get(startingTask.taskId)).resolves.toMatchObject({
        status: 'succeeded'
      });
    });
  });

  test.each([
    ['DESKTOP_CHAPTER_EDIT_STALE', 'stale', 'stale_edit'],
    ['CHAPTER_PARTICIPANT_ROSTER_MISSING', 'blocked', 'participant_roster_missing'],
    ['DESKTOP_CHAPTER_INVALID_OUTPUT', 'invalid', 'invalid_output'],
    ['PROJECT_OPERATION_BUSY', 'blocked', 'generation_busy']
  ] as const)('maps %s without exposing engine errors', async (
    code,
    outcome,
    messageKey
  ) => {
    const { gateway, service } = createService();
    gateway.planReviews.set(projectRoot, planReview);
    const review = await readAvailablePlan(service);
    const active = review.directions.find(({ active }) => active)!;
    gateway.authoringError = withCode(code, '/home/author/private engine error');

    const result = await service.selectDirection({
      projectKey,
      reviewToken: review.reviewToken,
      optionToken: active.optionToken
    });
    expect(result).toEqual({ outcome, messageKey });
    expect(JSON.stringify(result)).not.toMatch(/home|private|engine/i);
  });
});

describe('EngineChapterGateway plan candidate containment', () => {
  test.each(['participatingCharacterIds', 'charactersToIntroduce'])(
    'reads legacy missions without %s without rewriting the artifact', async (field) => {
      const fixture = await createGatewayArtifactFixture('plan_001');
      const missionPath = path.join(fixture.projectRoot, 'chapters', 'chapter_001', 'mission.json');
      try {
        const mission = JSON.parse(await readFile(missionPath, 'utf8')) as Record<string, unknown>;
        delete mission[field];
        const original = JSON.stringify(mission);
        await writeFile(missionPath, original);
        await writeFile(path.join(fixture.candidatesRoot, 'plan_001.md'), '# Direction\n\nA signal.');
        await expect(new EngineChapterGateway().readPlan(fixture.projectRoot))
          .resolves.toMatchObject({ available: true, chapterNumber: 1 });
        expect(await readFile(missionPath, 'utf8')).toBe(original);
      } finally {
        await rm(fixture.tempRoot, { recursive: true, force: true });
      }
    }
  );

  test.each(['participatingCharacterIds', 'charactersToIntroduce'])(
    'still rejects an explicitly invalid %s', async (field) => {
      const fixture = await createGatewayArtifactFixture('plan_001');
      const missionPath = path.join(fixture.projectRoot, 'chapters', 'chapter_001', 'mission.json');
      try {
        const mission = JSON.parse(await readFile(missionPath, 'utf8')) as Record<string, unknown>;
        mission[field] = null;
        await writeFile(missionPath, JSON.stringify(mission));
        await writeFile(path.join(fixture.candidatesRoot, 'plan_001.md'), '# Direction\n\nA signal.');
        await expect(new EngineChapterGateway().readPlan(fixture.projectRoot))
          .rejects.toMatchObject({ name: 'ZodError' });
      } finally {
        await rm(fixture.tempRoot, { recursive: true, force: true });
      }
    }
  );

  test('rejects a traversal candidate ID before reading candidate Markdown', async () => {
    const fixture = await createGatewayArtifactFixture('../../../outside/secret');
    await mkdir(path.join(fixture.projectRoot, 'outside'), { recursive: true });
    await writeFile(
      path.join(fixture.projectRoot, 'outside', 'secret.md'),
      '# Outside\n\nThis must never be read.\n',
      'utf8'
    );

    try {
      await expect(new EngineChapterGateway().readPlan(fixture.projectRoot))
        .rejects.toMatchObject({ code: 'DESKTOP_CHAPTER_INVALID_OUTPUT' });
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true });
    }
  });

  test('rejects a plan_candidates root reached through an ancestor symlink', async () => {
    const fixture = await createGatewayArtifactFixture('plan_001', false);
    const outsideCandidates = path.join(fixture.tempRoot, 'outside-candidates');
    await mkdir(outsideCandidates, { recursive: true });
    await writeFile(
      path.join(outsideCandidates, 'plan_001.md'),
      '# Outside\n\nThis must never be read.\n',
      'utf8'
    );
    await symlink(outsideCandidates, fixture.candidatesRoot, process.platform === 'win32' ? 'junction' : 'dir');

    try {
      await expect(new EngineChapterGateway().readPlan(fixture.projectRoot))
        .rejects.toMatchObject({ code: 'DESKTOP_CHAPTER_INVALID_OUTPUT' });
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true });
    }
  });
});

describe('ChapterReviewTokenStore', () => {
  test('creates 192-bit project-bound and purpose-bound review options', () => {
    const { store } = createTokenStore();
    const created = store.createReview({
      projectKey,
      projectRoot,
      chapterNumber: 1,
      latestCommittedChapter: 0,
      reviewHash: 'a'.repeat(64),
      missionHash: 'b'.repeat(64),
      options: [
        { purpose: 'direction', trustedId: 'plan_001' },
        { purpose: 'objective', trustedId: 'obj_secret' }
      ]
    });

    expect(created.reviewToken).toMatch(/^chapter_review_[a-f0-9]{48}$/u);
    expect(created.options).toHaveLength(2);
    expect(created.options[0]?.optionToken)
      .toMatch(/^chapter_option_[a-f0-9]{48}$/u);

    expect(store.resolveOption({
      projectKey,
      projectRoot,
      reviewToken: created.reviewToken,
      optionToken: created.options[0]!.optionToken,
      purpose: 'direction',
      currentLatestCommittedChapter: 0,
      currentReviewHash: 'a'.repeat(64)
    })).toMatchObject({
      outcome: 'resolved',
      value: {
        chapterNumber: 1,
        trustedId: 'plan_001',
        missionHash: 'b'.repeat(64)
      }
    });
    expect(store.resolveOption({
      projectKey,
      projectRoot,
      reviewToken: created.reviewToken,
      optionToken: created.options[0]!.optionToken,
      purpose: 'objective',
      currentLatestCommittedChapter: 0,
      currentReviewHash: 'a'.repeat(64)
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
  });

  test('returns fresh stale results for cross-project, re-bound, changed, and expired reviews', () => {
    const context = createTokenStore();
    const created = context.store.createReview(reviewTokenInput());
    const base = {
      projectKey,
      projectRoot,
      reviewToken: created.reviewToken,
      currentLatestCommittedChapter: 0,
      currentReviewHash: 'a'.repeat(64)
    };

    const failures = [
      context.store.resolveReview({ ...base, projectKey: secondProjectKey }),
      context.store.resolveReview({ ...base, projectRoot: secondProjectRoot }),
      context.store.resolveReview({
        ...base,
        currentLatestCommittedChapter: 1
      }),
      context.store.resolveReview({ ...base, currentReviewHash: 'c'.repeat(64) })
    ];
    for (const failure of failures) {
      expect(failure).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    }
    expect(failures[0]).not.toBe(failures[1]);

    context.advance(30 * 60 * 1_000);
    expect(context.store.resolveReview(base)).toEqual({
      outcome: 'stale',
      messageKey: 'stale_edit'
    });
  });

  test('retains at most two hundred review bindings', () => {
    const { store } = createTokenStore();
    const reviews = Array.from({ length: 201 }, (_, index) => (
      store.createReview({
        ...reviewTokenInput(),
        chapterNumber: index + 1
      })
    ));
    const resolution = (reviewToken: string) => store.resolveReview({
      projectKey,
      projectRoot,
      reviewToken,
      currentLatestCommittedChapter: 0,
      currentReviewHash: 'a'.repeat(64)
    });

    expect(resolution(reviews[0]!.reviewToken).outcome).toBe('stale');
    expect(resolution(reviews[1]!.reviewToken).outcome).toBe('resolved');
    expect(resolution(reviews[200]!.reviewToken).outcome).toBe('resolved');
  });

  test('retains five hundred revision bindings and consumes adoption once', () => {
    const { store } = createTokenStore();
    const revisions = Array.from({ length: 501 }, (_, index) => (
      store.createRevision({
        projectKey,
        projectRoot,
        chapterNumber: 1,
        latestCommittedChapter: 0,
        purpose: index % 2 === 0 ? 'plan' : 'mission',
        sourceHash: String(index).padStart(64, '0'),
        revisionId: `author_revision_${index + 1}`
      })
    ));

    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    }).outcome).toBe('stale');
    expect(store.consumeRevision({
      projectKey: secondProjectKey,
      projectRoot,
      revisionToken: revisions[500]!,
      currentLatestCommittedChapter: 0
    }).outcome).toBe('stale');

    const consumed = store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[500]!,
      currentLatestCommittedChapter: 0
    });
    expect(consumed).toMatchObject({
      outcome: 'resolved',
      value: {
        purpose: 'plan',
        revisionId: 'author_revision_501'
      }
    });
    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[500]!,
      currentLatestCommittedChapter: 0
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
  });

  test('rejects revision tokens after chapter advance or thirty-minute expiry', () => {
    const context = createTokenStore();
    const revisionToken = context.store.createRevision({
      projectKey,
      projectRoot,
      chapterNumber: 1,
      latestCommittedChapter: 0,
      purpose: 'plan',
      sourceHash: 'c'.repeat(64),
      revisionId: 'author_revision_ch001_plan_v1'
    });

    expect(context.store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken,
      currentLatestCommittedChapter: 1
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
    context.advance(30 * 60 * 1_000);
    expect(context.store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken,
      currentLatestCommittedChapter: 0
    })).toEqual({ outcome: 'stale', messageKey: 'stale_edit' });
  });

  test('fails bounded allocation when every revision binding is reserved', () => {
    const { store } = createTokenStore();
    const revisions = Array.from({ length: 500 }, (_, index) => {
      const secondProject = index % 2 === 1;
      const input = {
        ...revisionTokenInput(index),
        ...(secondProject
          ? { projectKey: secondProjectKey, projectRoot: secondProjectRoot }
          : {})
      };
      const revisionToken = store.createRevision(input);
      expect(store.reserveRevision({
        projectKey: input.projectKey,
        projectRoot: input.projectRoot,
        revisionToken,
        currentLatestCommittedChapter: 0
      }).outcome).toBe('resolved');
      return { input, revisionToken };
    });

    expect(() => store.createRevision(revisionTokenInput(500)))
      .toThrow('Chapter revision token capacity is fully reserved.');
    for (const { revisionToken } of revisions) {
      store.releaseRevision(revisionToken);
    }
    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!.revisionToken,
      currentLatestCommittedChapter: 0
    }).outcome).toBe('resolved');
  });

  test('pre-reserves and publishes one opaque revision token', () => {
    const { store } = createTokenStore();
    const reservationToken = store.reserveRevisionPublication();

    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: reservationToken,
      currentLatestCommittedChapter: 0
    }).outcome).toBe('stale');
    expect(store.publishReservedRevision(
      reservationToken,
      revisionTokenInput(1)
    )).toBe(reservationToken);
    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: reservationToken,
      currentLatestCommittedChapter: 0
    })).toMatchObject({
      outcome: 'resolved',
      value: { revisionId: 'author_revision_2' }
    });
  });

  test('does not evict the oldest published token until a capacity reservation is committed', () => {
    const { store } = createTokenStore();
    const revisions = Array.from({ length: 500 }, (_, index) => (
      store.createRevision(revisionTokenInput(index))
    ));
    const reservationToken = store.reserveRevisionPublication();

    expect(store.reserveRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    })).toMatchObject({
      outcome: 'resolved',
      value: revisionTokenInput(0)
    });
    store.releaseRevision(revisions[0]!);
    store.discardRevisionPublication(reservationToken);
    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    })).toMatchObject({
      outcome: 'resolved',
      value: revisionTokenInput(0)
    });
  });

  test('does not evict a durable recovered adjustment token at capacity', () => {
    const { store } = createTokenStore();
    const durableToken = `chapter_revision_${'d'.repeat(48)}`;
    const durableInput = {
      ...revisionTokenInput(0),
      revisionId: 'author_revision_ch001_plan_v1',
      createdAtMs: 1_000,
      durablePublication: true
    };
    expect(store.reserveRecoveredRevisionPublication(
      durableToken,
      durableInput
    )).toBe('reserved');
    store.publishReservedRevision(durableToken, durableInput);
    store.commitRevisionPublication(durableToken);
    Array.from({ length: 499 }, (_, index) => (
      store.createRevision(revisionTokenInput(index + 1))
    ));

    store.createRevision(revisionTokenInput(500));

    expect(store.reserveRevision({
      projectKey,
      projectRoot,
      revisionToken: durableToken,
      currentLatestCommittedChapter: 0
    })).toMatchObject({
      outcome: 'resolved',
      value: { revisionId: 'author_revision_ch001_plan_v1' }
    });
  });

  test('preserves the oldest published token when capacity reservation entropy fails', () => {
    let validEntropy = true;
    let nonce = 0;
    const store = new ChapterReviewTokenStore({
      randomBytes: (size) => {
        if (!validEntropy) return new Uint8Array(1);
        const bytes = new Uint8Array(size);
        new DataView(bytes.buffer).setUint32(size - 4, ++nonce);
        return bytes;
      }
    });
    const revisions = Array.from({ length: 500 }, (_, index) => (
      store.createRevision(revisionTokenInput(index))
    ));
    validEntropy = false;

    expect(() => store.reserveRevisionPublication()).toThrow(
      'Chapter token entropy source returned the wrong size.'
    );
    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    })).toMatchObject({
      outcome: 'resolved',
      value: revisionTokenInput(0)
    });
  });

  test('fails bounded publication reservation without changing all-reserved bindings', () => {
    const { store } = createTokenStore();
    const revisions = Array.from({ length: 500 }, (_, index) => {
      const revisionToken = store.createRevision(revisionTokenInput(index));
      expect(store.reserveRevision({
        projectKey,
        projectRoot,
        revisionToken,
        currentLatestCommittedChapter: 0
      }).outcome).toBe('resolved');
      return revisionToken;
    });

    expect(() => store.reserveRevisionPublication())
      .toThrow('Chapter revision token capacity is fully reserved.');
    store.releaseRevision(revisions[0]!);
    expect(store.consumeRevision({
      projectKey,
      projectRoot,
      revisionToken: revisions[0]!,
      currentLatestCommittedChapter: 0
    })).toMatchObject({
      outcome: 'resolved',
      value: revisionTokenInput(0)
    });
  });

  test('fails publication reservation on invalid entropy without creating a binding', () => {
    const store = new ChapterReviewTokenStore({
      randomBytes: () => new Uint8Array(1)
    });

    expect(() => store.reserveRevisionPublication()).toThrow(
      'Chapter token entropy source returned the wrong size.'
    );
  });
});

function createService(overrides: {
  gateway?: DeferredChapterGateway;
  resolver?: MemoryProjectResolver;
  tokenStore?: ChapterReviewTokenStore;
  workingCopies?: DraftWorkingCopyStore;
  submissionGuard?: ProjectSubmissionGuard;
} = {}) {
  const gateway = overrides.gateway ?? new DeferredChapterGateway();
  const resolver = overrides.resolver ?? new MemoryProjectResolver();
  let tick = 0;
  const service = new ProjectChapterService({
    gateway,
    projects: resolver,
    tokenStore: overrides.tokenStore ?? createTokenStore().store,
    ...(overrides.workingCopies === undefined
      ? {}
      : { workingCopies: overrides.workingCopies }),
    ...(overrides.submissionGuard === undefined ? {} : { submissionGuard: overrides.submissionGuard }),
    clock: () => new Date(Date.UTC(2026, 6, 30, 1, 0, tick++)),
    randomBytes: (size) => new Uint8Array(size).fill(tick % 255)
  });
  return { gateway, resolver, service };
}

async function createGatewayArtifactFixture(
  candidateId: string,
  createCandidatesRoot = true
): Promise<{
  tempRoot: string;
  projectRoot: string;
  candidatesRoot: string;
}> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'chapter-gateway-security-'));
  const projectRoot = path.join(tempRoot, 'gateway-project');
  const chapterRoot = path.join(projectRoot, 'chapters', 'chapter_001');
  const candidatesRoot = path.join(chapterRoot, 'plan_candidates');
  await Promise.all([
    mkdir(path.join(projectRoot, 'state'), { recursive: true }),
    mkdir(path.join(projectRoot, 'planning'), { recursive: true }),
    mkdir(chapterRoot, { recursive: true }),
    ...(createCandidatesRoot
      ? [mkdir(candidatesRoot, { recursive: true })]
      : [])
  ]);
  await Promise.all([
    writeFile(path.join(projectRoot, 'state', 'story_state.json'), JSON.stringify({
      projectId: 'gateway-project',
      latestCommittedChapter: 0,
      characters: [{ id: 'char_main', name: 'Lin', role: 'lead' }],
      narrativeDebts: []
    }), 'utf8'),
    writeFile(path.join(projectRoot, 'planning', 'chapter_queue.json'), '{}', 'utf8'),
    writeFile(path.join(chapterRoot, 'mission.json'), JSON.stringify({
      chapterNumber: 1,
      chapterFunction: 'Open the signal.',
      requiredObjectives: [],
      debtsToPayOrAdvance: [],
      debtsToIntroduce: [],
      characterDeltas: [],
      participatingCharacterIds: ['char_main'],
      charactersToIntroduce: [],
      readerInformationDelta: {
        newKnowledge: [],
        newSuspicions: [],
        questionsToMaintain: [],
        questionsToAnswer: []
      },
      forbiddenMoves: [],
      targetEmotionalCurve: []
    }), 'utf8'),
    writeFile(path.join(chapterRoot, 'ranking.json'), JSON.stringify({
      chapterNumber: 1,
      selectedCandidateId: candidateId,
      candidates: [{ candidateId, strengths: [], risks: [] }]
    }), 'utf8'),
    writeFile(
      path.join(chapterRoot, 'selected_plan.md'),
      '# Selected\n\nThe selected plan.\n',
      'utf8'
    )
  ]);
  engineDesktopMocks.readDesktopChapterPlan.mockResolvedValue({
    available: true,
    chapterNumber: 1,
    title: 'Gateway Project'
  });
  return { tempRoot, projectRoot, candidatesRoot };
}

async function readAvailablePlan(service: ProjectChapterService) {
  const review = await service.readPlan(projectKey);
  if (!review.available) throw new Error('Expected an available plan review.');
  return review;
}

function createTokenStore() {
  let now = 1_000;
  let sequence = 0;
  const store = new ChapterReviewTokenStore({
    now: () => now,
    randomBytes: (size) => {
      expect(size).toBe(24);
      const bytes = new Uint8Array(size);
      sequence += 1;
      new DataView(bytes.buffer).setUint32(0, sequence);
      return bytes;
    }
  });
  return {
    store,
    advance(milliseconds: number) {
      now += milliseconds;
    }
  };
}

function reviewTokenInput() {
  return {
    projectKey,
    projectRoot,
    chapterNumber: 1,
    latestCommittedChapter: 0,
    reviewHash: 'a'.repeat(64),
    missionHash: 'b'.repeat(64),
    options: [{ purpose: 'direction' as const, trustedId: 'plan_001' }]
  };
}

function revisionTokenInput(index: number) {
  return {
    projectKey,
    projectRoot,
    chapterNumber: 1,
    latestCommittedChapter: 0,
    purpose: 'plan' as const,
    sourceHash: String(index).padStart(64, '0'),
    revisionId: `author_revision_${index + 1}`
  };
}

function availableInspection(
  phase: Extract<ChapterInspection, { available: true }>['phase']
): Extract<ChapterInspection, { available: true }> {
  return {
    available: true,
    chapterNumber: 1,
    title: 'The Radio Wakes',
    phase
  };
}

function inspectionChapterNumber(
  inspection: ChapterInspection | undefined
): number {
  return inspection?.available ? inspection.chapterNumber : 1;
}

function withCode(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emitEngineCompletion(
  gateway: DeferredChapterGateway,
  index: number
): void {
  gateway.emit(index, { stage: 'finalizing', state: 'completed' });
  gateway.emit(index, { stage: 'completed', state: 'completed' });
}

async function eventually(assertion: () => void | Promise<void>): Promise<void> {
  const deadline = Date.now() + 2_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}
