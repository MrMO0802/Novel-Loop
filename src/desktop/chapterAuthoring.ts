import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  adoptAuthorRevision,
  archiveAuthorChapterArtifacts,
  bindAuthorRevisionPublication,
  createAuthorRevision,
  discardReadyAuthorRevision,
  listAuthorRevisionPublications,
  promoteAuthorRevisionPublication,
  readAuthorRevision,
  readLatestAdoptedDraft,
  type ArchiveInvalidatedChapterArtifactsResult,
  type CreateAuthorRevisionResult
} from '../app/chapterAuthorRevision.js';
import {
  adjustChapterMission,
  adjustChapterPlan,
  type ChapterAuthorAdjustmentInput,
  type ChapterAuthorAdjustmentResult
} from '../app/chapterAuthorAdjustment.js';
import {
  assertMissionHasParticipants,
  missionCharacterReferencesAreValid,
  missionDebtReferencesAreValid
} from '../app/chapterReferenceValidation.js';
import { withProjectChapterOperationLease } from '../app/projectOperationLease.js';
import {
  AuthorEditInvalidationReportSchema,
  AuthorRevisionRecordSchema,
  ChapterDirectionSelectionSchema,
  ChapterMissionSchema,
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  AuthorArtifactReference,
  AuthorInvalidatedNode,
  ChapterMission,
  ChapterObjective,
  ChapterPlanRanking,
  ChapterQueue,
  ChapterQueueItem,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { readDesktopChapterDraft } from './chapterWorkspace.js';

const DIRECTION_INVALIDATED_NODES = [
  'selected_plan',
  'scene_cards',
  'scene_drafts',
  'draft'
] as const satisfies readonly AuthorInvalidatedNode[];

const PLAN_INVALIDATED_NODES = [
  'scene_cards',
  'scene_drafts',
  'draft'
] as const satisfies readonly AuthorInvalidatedNode[];

const MISSION_INVALIDATED_NODES = [
  'plan_candidates',
  'ranking',
  'selected_plan',
  'scene_cards',
  'scene_drafts',
  'draft',
  'future_diagnostics'
] as const satisfies readonly AuthorInvalidatedNode[];

const ARCHIVE_NODES = [
  'selected_plan',
  'scene_cards',
  'scene_drafts',
  'draft'
] as const;

const MISSION_ARCHIVE_NODES = [
  'mission',
  'plan_candidates',
  'ranking',
  'selected_plan',
  'scene_cards',
  'scene_drafts',
  'draft',
  'future_diagnostics'
] as const;

const COMPLETED_PLANNING_STAGES = ['mission', 'plan_candidates', 'ranking'] as const;
const DIRECTION_SELECTION_PATTERN = /^direction_selection_v([1-9]\d*)\.json$/u;
const INVALIDATION_REPORT_PATTERN = /^edit_invalidation_report_v([1-9]\d*)\.json$/u;

export interface SelectDesktopChapterDirectionInput {
  projectRoot: string;
  chapterNumber: number;
  candidateId: string;
  expectedReviewHash: string;
}

export interface DesktopChapterDirectionSelectionResult {
  selectionId: string;
  selectedCandidateId: string;
  selectedTitle: string;
  invalidatedNodes: AuthorInvalidatedNode[];
  invalidationReportPath: string;
  storyStateMutated: false;
}

export interface CreateDesktopChapterPlanRevisionInput {
  projectRoot: string;
  chapterNumber: number;
  candidateId: string;
  expectedReviewHash: string;
  markdown: string;
}

export interface AdoptDesktopChapterPlanRevisionInput {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  expectedSourceHash: string;
}

export interface DesktopAuthorAdoptionResult {
  chapterNumber: number;
  revisionId: string;
  selectedTitle: string;
  invalidatedNodes: AuthorInvalidatedNode[];
  invalidationReportPath: string;
  storyStateMutated: false;
}

export interface DesktopMissionAuthorEdit {
  sourceMissionHash: string;
  chapterFunction: string;
  requiredObjectives: Array<{
    sourceObjectiveId: string | null;
    text: string;
    type: ChapterObjective['type'];
    priority: ChapterObjective['priority'];
  }>;
  debtsToPayOrAdvance: string[];
  debtsToIntroduce: ChapterMission['debtsToIntroduce'];
  characterDeltas: ChapterMission['characterDeltas'];
  participatingCharacterIds: string[];
  retainedIntroducedCharacterIds?: string[];
  newCharacters: Array<{ name: string; role: string }>;
  readerInformationDelta: ChapterMission['readerInformationDelta'];
  forbiddenMoves: string[];
  targetEmotionalCurve: string[];
  targetWordCount: number | null;
}

export interface CreateDesktopMissionRevisionResult extends CreateAuthorRevisionResult {
  mission: ChapterMission;
}

export type AdjustDesktopChapterMissionInput = Omit<
  ChapterAuthorAdjustmentInput,
  'sourcePlan'
>;

export type AdjustDesktopChapterPlanInput = ChapterAuthorAdjustmentInput & {
  sourcePlan: NonNullable<ChapterAuthorAdjustmentInput['sourcePlan']>;
};

export interface DesktopChapterAdjustmentResult
  extends ChapterAuthorAdjustmentResult {
  content: string;
}

export interface AdoptDesktopChapterDraftInput {
  projectRoot: string;
  markdown: string;
  expectedSourceHash: string;
}

export interface DesktopDraftAdoptionResult {
  chapterNumber: number;
  revisionId: string;
  versionKind: 'author_adopted';
  invalidationReportPath: string;
  storyStateMutated: false;
}

interface ChapterAuthoringSnapshot {
  projectRoot: string;
  paths: ProjectPaths;
  missionText: string;
  mission: ChapterMission;
  rankingText: string;
  ranking: ChapterPlanRanking;
  selectedPlanText: string;
  queueText: string;
  queue: ChapterQueue;
  queueItem: ChapterQueueItem;
  storyStateText: string;
  storyState: StoryState;
  candidates: Map<string, string>;
  reviewHash: string;
  sceneDraftsDirectoryExisted: boolean;
}

interface RevisionRecordSnapshot {
  path: string;
  content: string;
}

interface AuthoringTransaction {
  snapshot: ChapterAuthoringSnapshot;
  archive: ArchiveInvalidatedChapterArtifactsResult | null;
  revisionRecords: RevisionRecordSnapshot[];
  createdProvenancePaths: string[];
}

export async function adjustDesktopChapterMission(
  input: AdjustDesktopChapterMissionInput,
  fileStore?: FileStore
): Promise<DesktopChapterAdjustmentResult> {
  const store = fileStore ?? FileStore.forProject(path.resolve(input.projectRoot));
  return adjustChapterMission(input, store);
}

export async function adjustDesktopChapterPlan(
  input: AdjustDesktopChapterPlanInput,
  fileStore?: FileStore
): Promise<DesktopChapterAdjustmentResult> {
  const store = fileStore ?? FileStore.forProject(path.resolve(input.projectRoot));
  return adjustChapterPlan(input, store);
}

export async function discardDesktopChapterAdjustmentRevision(input: {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  expectedSourceHash: string;
}, fileStore?: FileStore): Promise<void> {
  const store = fileStore ?? FileStore.forProject(path.resolve(input.projectRoot));
  await discardReadyAuthorRevision(input, store);
}

export async function bindDesktopChapterAdjustmentPublication(input: {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  expectedSourceHash: string;
  revisionToken: string;
  projectKey: string;
  latestCommittedChapter: number;
  purpose: 'mission' | 'plan';
}, fileStore?: FileStore): Promise<void> {
  const store = fileStore ?? FileStore.forProject(path.resolve(input.projectRoot));
  await bindAuthorRevisionPublication(input, store);
}

export async function promoteDesktopChapterAdjustmentPublication(input: {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  expectedSourceHash: string;
  revisionToken: string;
}, fileStore?: FileStore): Promise<void> {
  const store = fileStore ?? FileStore.forProject(path.resolve(input.projectRoot));
  await promoteAuthorRevisionPublication(input, store);
}

export async function listDesktopChapterAdjustmentPublications(input: {
  projectRoot: string;
}, fileStore?: FileStore) {
  const store = fileStore ?? FileStore.forProject(path.resolve(input.projectRoot));
  return listAuthorRevisionPublications(input, store);
}

export async function adoptDesktopChapterDraft(
  input: AdoptDesktopChapterDraftInput,
  fileStore?: FileStore
): Promise<DesktopDraftAdoptionResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  const current = await readDesktopChapterDraft({ projectRoot });
  if (!current.available || current.sourceHash !== input.expectedSourceHash) {
    throw new AppError(
      'DESKTOP_CHAPTER_EDIT_STALE',
      'The chapter draft changed before the author revision was adopted.',
      2
    );
  }
  if (Buffer.byteLength(input.markdown, 'utf8') > 2 * 1024 * 1024) {
    throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', 'The chapter draft is too large.', 2);
  }

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: current.chapterNumber,
    operation: 'desktop-draft-author-adoption',
    allowStoryStateWrite: false
  }, async () => {
    const snapshot = await readChapterAuthoringSnapshot(
      projectRoot,
      current.chapterNumber,
      store
    );
    assertUncommitted(snapshot);
    const latestAdopted = await readLatestAdoptedDraft({
      projectRoot,
      chapterNumber: current.chapterNumber
    }, store);
    const created = await createAuthorRevision({
      projectRoot,
      chapterNumber: current.chapterNumber,
      artifactKind: 'draft',
      mode: 'direct_edit',
      sourceArtifactPath: latestAdopted?.relativeMarkdownPath
        ?? path.join('chapters', `chapter_${String(current.chapterNumber).padStart(3, '0')}`, 'draft_v1.md'),
      sourceCandidateId: null,
      expectedSourceHash: current.sourceHash,
      content: input.markdown,
      authorInstruction: null
    }, store);
    const reportVersion = await nextArtifactVersion(
      snapshot.paths,
      store,
      current.chapterNumber,
      INVALIDATION_REPORT_PATTERN
    );
    const reportPath = snapshot.paths.chapterArtifact(
      current.chapterNumber,
      'author_revisions',
      `edit_invalidation_report_v${reportVersion}.json`
    );
    const relativeReportPath = projectRelative(projectRoot, reportPath);
    const report = AuthorEditInvalidationReportSchema.parse({
      schemaVersion: '1.0',
      reportId: `edit_invalidation_ch${padChapter(current.chapterNumber)}_v${reportVersion}`,
      projectId: snapshot.paths.projectId,
      chapterNumber: current.chapterNumber,
      revisionId: created.record.revisionId,
      editedNode: 'draft',
      invalidatedNodes: ['future_diagnostics'],
      retainedArtifacts: [{
        node: 'draft',
        path: created.relativeMarkdownPath
      }],
      archivedArtifacts: [],
      missingArtifactPaths: [],
      queueBefore: queueSnapshot(snapshot.queueItem),
      queueAfter: queueSnapshot(snapshot.queueItem),
      reason: '作者采用了新的章节正文，后续诊断必须基于该版本重新运行。',
      nextStep: '保留当前章节规划，并在后续阶段重新运行章节诊断。',
      generatedAt: new Date().toISOString(),
      storyStateMutated: false
    });
    try {
      await store.writeJson(
        reportPath,
        report,
        AuthorEditInvalidationReportSchema
      );
      await adoptAuthorRevision({
        projectRoot,
        chapterNumber: current.chapterNumber,
        revisionId: created.record.revisionId,
        expectedSourceHash: current.sourceHash,
        invalidationReportPath: relativeReportPath
      }, store);
    } catch (error) {
      await store.removePath(reportPath).catch(() => undefined);
      throw error;
    }
    return {
      chapterNumber: current.chapterNumber,
      revisionId: created.record.revisionId,
      versionKind: 'author_adopted',
      invalidationReportPath: relativeReportPath,
      storyStateMutated: false
    };
  });
}

export async function createDesktopMissionRevision(input: {
  projectRoot: string;
  chapterNumber: number;
  edit: DesktopMissionAuthorEdit;
}, fileStore?: FileStore): Promise<CreateDesktopMissionRevisionResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'desktop-author-revision-create',
    allowStoryStateWrite: false
  }, async () => {
    const snapshot = await readChapterAuthoringSnapshot(
      projectRoot,
      input.chapterNumber,
      store
    );
    assertUncommitted(snapshot);
    if (sha256(snapshot.missionText) !== input.edit.sourceMissionHash) {
      throw new AppError(
        'DESKTOP_CHAPTER_EDIT_STALE',
        'The chapter mission changed before the author edit was saved.',
        2
      );
    }

    const mission = createEditedMission(snapshot, input.edit);
    const content = `${JSON.stringify(mission, null, 2)}\n`;
    const created = await createAuthorRevision({
      projectRoot,
      chapterNumber: input.chapterNumber,
      artifactKind: 'mission',
      mode: 'direct_edit',
      sourceArtifactPath: snapshot.paths.chapterArtifact(
        input.chapterNumber,
        'mission.json'
      ),
      sourceCandidateId: null,
      content,
      authorInstruction: null
    }, store);
    return { ...created, mission };
  });
}

export async function adoptDesktopMissionRevision(input: {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  expectedSourceHash: string;
}, fileStore?: FileStore): Promise<DesktopAuthorAdoptionResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'desktop-author-adoption',
    allowStoryStateWrite: false
  }, async () => {
    const snapshot = await readChapterAuthoringSnapshot(
      projectRoot,
      input.chapterNumber,
      store
    );
    assertUncommitted(snapshot);
    const revision = await readAuthorRevision({
      projectRoot,
      chapterNumber: input.chapterNumber,
      revisionId: input.revisionId,
      expectedSourceHash: input.expectedSourceHash
    }, store);
    if (revision.record.state === 'adopted') {
      throw new AppError(
        'DESKTOP_CHAPTER_REVISION_ALREADY_ADOPTED',
        `Author revision is already adopted: ${revision.record.revisionId}`,
        2
      );
    }
    if (revision.record.artifactKind !== 'mission') {
      throw new AppError(
        'DESKTOP_CHAPTER_REVISION_KIND_INVALID',
        'Author revision is not a chapter-mission revision.',
        2
      );
    }
    const mission = parseJson(
      revision.content,
      ChapterMissionSchema,
      'mission revision'
    );
    if (
      mission.chapterNumber !== input.chapterNumber
      || !missionCharacterReferencesAreValid(mission, snapshot.storyState)
      || !missionDebtReferencesAreValid(mission, snapshot.storyState)
    ) {
      throw new AppError(
        'DESKTOP_CHAPTER_EDIT_INVALID',
        'The mission revision contains invalid narrative references.',
        2
      );
    }
    assertMissionHasParticipants(mission, snapshot.storyState);

    const generatedAt = new Date().toISOString();
    const reportVersion = await nextArtifactVersion(
      snapshot.paths,
      store,
      input.chapterNumber,
      INVALIDATION_REPORT_PATTERN
    );
    const reportPath = snapshot.paths.chapterArtifact(
      input.chapterNumber,
      'author_revisions',
      `edit_invalidation_report_v${reportVersion}.json`
    );
    const relativeReportPath = projectRelative(projectRoot, reportPath);
    const queueAfter = queueAtMission(
      snapshot.queue,
      input.chapterNumber,
      generatedAt
    );
    const transaction: AuthoringTransaction = {
      snapshot,
      archive: null,
      revisionRecords: await snapshotRevisionRecords(
        snapshot,
        store,
        'mission'
      ),
      createdProvenancePaths: [reportPath]
    };
    try {
      const archive = await archiveAuthorChapterArtifacts({
        projectRoot,
        chapterNumber: input.chapterNumber,
        archiveId: revision.record.revisionId,
        nodes: [...MISSION_ARCHIVE_NODES]
      }, store);
      transaction.archive = archive;
      const archivedMission = archive.archivedArtifacts.find(
        ({ sourcePath }) => sourcePath === missionRelativePath(input.chapterNumber)
      );
      if (archivedMission === undefined) {
        throw new AppError(
          'DESKTOP_CHAPTER_ARCHIVE_INVALID',
          'The generated chapter mission was not archived.',
          2
        );
      }
      await removeInvalidatedMissionDownstream(snapshot, store);
      const report = AuthorEditInvalidationReportSchema.parse({
        schemaVersion: '1.0',
        reportId: `edit_invalidation_ch${padChapter(input.chapterNumber)}_v${reportVersion}`,
        projectId: snapshot.paths.projectId,
        chapterNumber: input.chapterNumber,
        revisionId: revision.record.revisionId,
        editedNode: 'mission',
        invalidatedNodes: [...MISSION_INVALIDATED_NODES],
        retainedArtifacts: [],
        archivedArtifacts: archive.archivedArtifacts,
        missingArtifactPaths: archive.missingArtifactPaths,
        queueBefore: queueSnapshot(snapshot.queueItem),
        queueAfter: { status: 'planning', stage: 'mission' },
        reason: `作者采用任务修订 ${revision.record.revisionId}。`,
        nextStep: '重新生成章节方向、场景卡、场景草稿和章节草稿。',
        generatedAt,
        storyStateMutated: false
      });
      await store.writeJson(
        reportPath,
        report,
        AuthorEditInvalidationReportSchema
      );
      await store.writeJson(
        snapshot.paths.chapterArtifact(input.chapterNumber, 'mission.json'),
        mission,
        ChapterMissionSchema
      );
      await store.writeJson(
        snapshot.paths.chapterQueue(),
        queueAfter,
        ChapterQueueSchema
      );
      await adoptAuthorRevision({
        projectRoot,
        chapterNumber: input.chapterNumber,
        revisionId: revision.record.revisionId,
        expectedSourceHash: input.expectedSourceHash,
        invalidationReportPath: relativeReportPath,
        sourceArtifactPathOverride: archivedMission.archivedPath
      }, store);
    } catch (error) {
      await rollbackAuthoringTransaction(transaction, store, error);
      throw error;
    }

    return {
      chapterNumber: input.chapterNumber,
      revisionId: revision.record.revisionId,
      selectedTitle: mission.chapterFunction,
      invalidatedNodes: [...MISSION_INVALIDATED_NODES],
      invalidationReportPath: relativeReportPath,
      storyStateMutated: false
    };
  });
}

export async function selectDesktopChapterDirection(
  input: SelectDesktopChapterDirectionInput,
  fileStore?: FileStore
): Promise<DesktopChapterDirectionSelectionResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'desktop-author-adoption',
    allowStoryStateWrite: false
  }, async () => {
    const snapshot = await readChapterAuthoringSnapshot(projectRoot, input.chapterNumber, store);
    assertEditableSnapshot(snapshot, input.expectedReviewHash);
    const selectedMarkdown = snapshot.candidates.get(input.candidateId);
    if (selectedMarkdown === undefined) {
      throw new AppError(
        'DESKTOP_CHAPTER_DIRECTION_UNKNOWN',
        `Chapter direction is not ranked: ${input.candidateId}`,
        2
      );
    }

    const selectionVersion = await nextArtifactVersion(
      snapshot.paths,
      store,
      input.chapterNumber,
      DIRECTION_SELECTION_PATTERN
    );
    const reportVersion = await nextArtifactVersion(
      snapshot.paths,
      store,
      input.chapterNumber,
      INVALIDATION_REPORT_PATTERN
    );
    const selectedTitle = markdownTitle(selectedMarkdown, input.candidateId);
    const generatedAt = new Date().toISOString();
    const selectionId = `direction_selection_ch${padChapter(input.chapterNumber)}_v${selectionVersion}`;
    const selectionPath = snapshot.paths.chapterArtifact(
      input.chapterNumber,
      'author_revisions',
      `direction_selection_v${selectionVersion}.json`
    );
    const reportPath = snapshot.paths.chapterArtifact(
      input.chapterNumber,
      'author_revisions',
      `edit_invalidation_report_v${reportVersion}.json`
    );
    const relativeReportPath = projectRelative(projectRoot, reportPath);
    const modelRecommendedCandidateId = await firstModelRecommendation(snapshot, store);
    const rankingAfter = ChapterPlanRankingSchema.parse({
      ...snapshot.ranking,
      selectedCandidateId: input.candidateId,
      selectedPlanPath: selectedPlanRelativePath(input.chapterNumber),
      rationale: `作者选择：${selectedTitle}`
    });
    const queueAfter = queueAtRanking(snapshot.queue, input.chapterNumber, generatedAt);
    const selection = ChapterDirectionSelectionSchema.parse({
      schemaVersion: '1.0',
      selectionId,
      projectId: snapshot.paths.projectId,
      chapterNumber: input.chapterNumber,
      previousCandidateId: snapshot.ranking.selectedCandidateId,
      selectedCandidateId: input.candidateId,
      modelRecommendedCandidateId,
      differsFromModelRecommendation: input.candidateId !== modelRecommendedCandidateId,
      sourceReviewHash: snapshot.reviewHash,
      selectedPlanHash: sha256(selectedMarkdown),
      generatedAt,
      invalidationReportPath: relativeReportPath,
      storyStateMutated: false
    });
    const transaction: AuthoringTransaction = {
      snapshot,
      archive: null,
      revisionRecords: [],
      createdProvenancePaths: [selectionPath, reportPath]
    };
    try {
      const archive = await archiveAuthorChapterArtifacts({
        projectRoot,
        chapterNumber: input.chapterNumber,
        archiveId: selectionId,
        nodes: [...ARCHIVE_NODES]
      }, store);
      transaction.archive = archive;
      await removeInvalidatedDownstream(snapshot, store);
      const report = AuthorEditInvalidationReportSchema.parse({
        schemaVersion: '1.0',
        reportId: `edit_invalidation_ch${padChapter(input.chapterNumber)}_v${reportVersion}`,
        projectId: snapshot.paths.projectId,
        chapterNumber: input.chapterNumber,
        revisionId: selectionId,
        editedNode: 'ranking',
        invalidatedNodes: [...DIRECTION_INVALIDATED_NODES],
        retainedArtifacts: retainedCandidateReferences(snapshot),
        archivedArtifacts: archive.archivedArtifacts,
        missingArtifactPaths: archive.missingArtifactPaths,
        queueBefore: queueSnapshot(snapshot.queueItem),
        queueAfter: { status: 'planned_ready', stage: 'ranking' },
        reason: `作者将章节方向从 ${snapshot.ranking.selectedCandidateId} 改为 ${input.candidateId}。`,
        nextStep: '重新生成场景卡、场景草稿和章节草稿。',
        generatedAt,
        storyStateMutated: false
      });
      await store.writeJson(selectionPath, selection, ChapterDirectionSelectionSchema);
      await store.writeJson(reportPath, report, AuthorEditInvalidationReportSchema);
      await store.writeJson(
        snapshot.paths.chapterArtifact(input.chapterNumber, 'ranking.json'),
        rankingAfter,
        ChapterPlanRankingSchema
      );
      await store.writeText(
        snapshot.paths.chapterArtifact(input.chapterNumber, 'selected_plan.md'),
        selectedMarkdown
      );
      await store.writeJson(snapshot.paths.chapterQueue(), queueAfter, ChapterQueueSchema);
    } catch (error) {
      await rollbackAuthoringTransaction(transaction, store, error);
      throw error;
    }

    return {
      selectionId,
      selectedCandidateId: input.candidateId,
      selectedTitle,
      invalidatedNodes: [...DIRECTION_INVALIDATED_NODES],
      invalidationReportPath: relativeReportPath,
      storyStateMutated: false
    };
  });
}

export async function createDesktopChapterPlanRevision(
  input: CreateDesktopChapterPlanRevisionInput,
  fileStore?: FileStore
): Promise<CreateAuthorRevisionResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'desktop-author-revision-create',
    allowStoryStateWrite: false
  }, async () => {
    const snapshot = await readChapterAuthoringSnapshot(projectRoot, input.chapterNumber, store);
    assertEditableSnapshot(snapshot, input.expectedReviewHash);
    const candidateMarkdown = snapshot.candidates.get(input.candidateId);
    if (candidateMarkdown === undefined) {
      throw new AppError(
        'DESKTOP_CHAPTER_DIRECTION_UNKNOWN',
        `Chapter direction is not ranked: ${input.candidateId}`,
        2
      );
    }
    if (input.markdown.trim().length === 0) {
      throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', 'Plan revision Markdown is empty.', 2);
    }

    const sourceArtifactPath = input.candidateId === snapshot.ranking.selectedCandidateId
      ? snapshot.paths.chapterArtifact(input.chapterNumber, 'selected_plan.md')
      : snapshot.paths.chapterArtifact(
          input.chapterNumber,
          'plan_candidates',
          `${input.candidateId}.md`
        );
    return createAuthorRevision({
      projectRoot,
      chapterNumber: input.chapterNumber,
      artifactKind: 'selected_plan',
      mode: 'direct_edit',
      sourceArtifactPath,
      sourceCandidateId: input.candidateId,
      content: input.markdown,
      authorInstruction: null
    }, store);
  });
}

export async function adoptDesktopChapterPlanRevision(
  input: AdoptDesktopChapterPlanRevisionInput,
  fileStore?: FileStore
): Promise<DesktopAuthorAdoptionResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'desktop-author-adoption',
    allowStoryStateWrite: false
  }, async () => {
    const snapshot = await readChapterAuthoringSnapshot(projectRoot, input.chapterNumber, store);
    assertUncommitted(snapshot);
    const revision = await readAuthorRevision({
      projectRoot,
      chapterNumber: input.chapterNumber,
      revisionId: input.revisionId,
      expectedSourceHash: input.expectedSourceHash
    }, store);
    if (revision.record.state === 'adopted') {
      throw new AppError(
        'DESKTOP_CHAPTER_REVISION_ALREADY_ADOPTED',
        `Author revision is already adopted: ${revision.record.revisionId}`,
        2
      );
    }
    if (revision.record.artifactKind !== 'selected_plan') {
      throw new AppError(
        'DESKTOP_CHAPTER_REVISION_KIND_INVALID',
        'Author revision is not a selected-plan revision.',
        2
      );
    }
    const sourceCandidateId = revision.record.sourceCandidateId;
    if (sourceCandidateId === null || !snapshot.candidates.has(sourceCandidateId)) {
      throw new AppError(
        'DESKTOP_CHAPTER_DIRECTION_UNKNOWN',
        'The revision source direction is no longer ranked.',
        2
      );
    }

    const generatedAt = new Date().toISOString();
    const reportVersion = await nextArtifactVersion(
      snapshot.paths,
      store,
      input.chapterNumber,
      INVALIDATION_REPORT_PATTERN
    );
    const reportPath = snapshot.paths.chapterArtifact(
      input.chapterNumber,
      'author_revisions',
      `edit_invalidation_report_v${reportVersion}.json`
    );
    const relativeReportPath = projectRelative(projectRoot, reportPath);
    const selectedTitle = markdownTitle(revision.content, sourceCandidateId);
    const rankingAfter = ChapterPlanRankingSchema.parse({
      ...snapshot.ranking,
      selectedCandidateId: sourceCandidateId,
      selectedPlanPath: selectedPlanRelativePath(input.chapterNumber),
      rationale: `作者采用计划修订：${selectedTitle}`
    });
    const queueAfter = queueAtRanking(snapshot.queue, input.chapterNumber, generatedAt);
    const directionChanged = sourceCandidateId !== snapshot.ranking.selectedCandidateId;
    const selectionVersion = directionChanged
      ? await nextArtifactVersion(
          snapshot.paths,
          store,
          input.chapterNumber,
          DIRECTION_SELECTION_PATTERN
        )
      : null;
    const selectionPath = selectionVersion === null
      ? null
      : snapshot.paths.chapterArtifact(
          input.chapterNumber,
          'author_revisions',
          `direction_selection_v${selectionVersion}.json`
        );
    const modelRecommendedCandidateId = directionChanged
      ? await firstModelRecommendation(snapshot, store)
      : snapshot.ranking.selectedCandidateId;
    const selection = selectionVersion === null
      ? null
      : ChapterDirectionSelectionSchema.parse({
          schemaVersion: '1.0',
          selectionId: `direction_selection_ch${padChapter(input.chapterNumber)}_v${selectionVersion}`,
          projectId: snapshot.paths.projectId,
          chapterNumber: input.chapterNumber,
          previousCandidateId: snapshot.ranking.selectedCandidateId,
          selectedCandidateId: sourceCandidateId,
          modelRecommendedCandidateId,
          differsFromModelRecommendation: sourceCandidateId !== modelRecommendedCandidateId,
          sourceReviewHash: snapshot.reviewHash,
          selectedPlanHash: sha256(revision.content),
          generatedAt,
          invalidationReportPath: relativeReportPath,
          storyStateMutated: false
        });
    const transaction: AuthoringTransaction = {
      snapshot,
      archive: null,
      revisionRecords: await snapshotPlanRevisionRecords(snapshot, store),
      createdProvenancePaths: [
        reportPath,
        ...(selectionPath === null ? [] : [selectionPath])
      ]
    };
    try {
      const archive = await archiveAuthorChapterArtifacts({
        projectRoot,
        chapterNumber: input.chapterNumber,
        archiveId: revision.record.revisionId,
        nodes: [...ARCHIVE_NODES]
      }, store);
      transaction.archive = archive;
      await removeInvalidatedDownstream(snapshot, store);
      const archivedActiveSource = revision.record.sourceArtifactPath
        === selectedPlanRelativePath(input.chapterNumber)
        ? archive.archivedArtifacts.find(
            ({ sourcePath }) => sourcePath === selectedPlanRelativePath(input.chapterNumber)
          )?.archivedPath
        : undefined;
      if (
        revision.record.sourceArtifactPath === selectedPlanRelativePath(input.chapterNumber)
        && archivedActiveSource === undefined
      ) {
        throw new AppError(
          'DESKTOP_CHAPTER_ARCHIVE_INVALID',
          'The active selected plan was not archived.',
          2
        );
      }
      const report = AuthorEditInvalidationReportSchema.parse({
        schemaVersion: '1.0',
        reportId: `edit_invalidation_ch${padChapter(input.chapterNumber)}_v${reportVersion}`,
        projectId: snapshot.paths.projectId,
        chapterNumber: input.chapterNumber,
        revisionId: revision.record.revisionId,
        editedNode: 'selected_plan',
        invalidatedNodes: [...PLAN_INVALIDATED_NODES],
        retainedArtifacts: retainedCandidateReferences(snapshot),
        archivedArtifacts: archive.archivedArtifacts,
        missingArtifactPaths: archive.missingArtifactPaths,
        queueBefore: queueSnapshot(snapshot.queueItem),
        queueAfter: { status: 'planned_ready', stage: 'ranking' },
        reason: `作者采用计划修订 ${revision.record.revisionId}。`,
        nextStep: '重新生成场景卡、场景草稿和章节草稿。',
        generatedAt,
        storyStateMutated: false
      });
      if (selection !== null && selectionPath !== null) {
        await store.writeJson(selectionPath, selection, ChapterDirectionSelectionSchema);
      }
      await store.writeJson(reportPath, report, AuthorEditInvalidationReportSchema);
      await store.writeJson(
        snapshot.paths.chapterArtifact(input.chapterNumber, 'ranking.json'),
        rankingAfter,
        ChapterPlanRankingSchema
      );
      await store.writeText(
        snapshot.paths.chapterArtifact(input.chapterNumber, 'selected_plan.md'),
        revision.content
      );
      await store.writeJson(snapshot.paths.chapterQueue(), queueAfter, ChapterQueueSchema);
      await adoptAuthorRevision({
        projectRoot,
        chapterNumber: input.chapterNumber,
        revisionId: revision.record.revisionId,
        expectedSourceHash: input.expectedSourceHash,
        invalidationReportPath: relativeReportPath,
        ...(archivedActiveSource === undefined
          ? {}
          : { sourceArtifactPathOverride: archivedActiveSource })
      }, store);
    } catch (error) {
      await rollbackAuthoringTransaction(transaction, store, error);
      throw error;
    }

    return {
      chapterNumber: input.chapterNumber,
      revisionId: revision.record.revisionId,
      selectedTitle,
      invalidatedNodes: [...PLAN_INVALIDATED_NODES],
      invalidationReportPath: relativeReportPath,
      storyStateMutated: false
    };
  });
}

function createEditedMission(
  snapshot: ChapterAuthoringSnapshot,
  edit: DesktopMissionAuthorEdit
): ChapterMission {
  try {
    const sourceObjectives = new Map(
      snapshot.mission.requiredObjectives.map((objective) => [objective.id, objective])
    );
    if (sourceObjectives.size !== snapshot.mission.requiredObjectives.length) {
      throw invalidMissionEdit('The source mission has duplicate objective IDs.');
    }
    const objectiveIds = new Set<string>();
    const requiredObjectives = edit.requiredObjectives.map((objective) => {
      let id: string;
      if (objective.sourceObjectiveId === null) {
        id = provisionalObjectiveId(
          snapshot.paths.projectId,
          snapshot.mission.chapterNumber,
          normalizeRequiredText(objective.text, 'objective text')
        );
        if (sourceObjectives.has(id) || objectiveIds.has(id)) {
          throw invalidMissionEdit('A generated objective ID collides with an existing objective.');
        }
      } else {
        if (
          !sourceObjectives.has(objective.sourceObjectiveId)
          || objectiveIds.has(objective.sourceObjectiveId)
        ) {
          throw invalidMissionEdit('An objective source ID is unknown or duplicated.');
        }
        id = objective.sourceObjectiveId;
      }
      objectiveIds.add(id);
      return {
        id,
        text: objective.text,
        type: objective.type,
        priority: objective.priority
      };
    });

    const committedCharacterIds = new Set(
      snapshot.storyState.characters.map((character) => character.id)
    );
    const sourceIntroductions = new Map(
      snapshot.mission.charactersToIntroduce.map((character) => [
        character.characterId,
        character
      ])
    );
    if (sourceIntroductions.size !== snapshot.mission.charactersToIntroduce.length) {
      throw invalidMissionEdit('The source mission has duplicate provisional character IDs.');
    }
    const explicitlyRetainedIntroductionIds =
      edit.retainedIntroducedCharacterIds ?? [];
    if (
      new Set(explicitlyRetainedIntroductionIds).size
        !== explicitlyRetainedIntroductionIds.length
      || explicitlyRetainedIntroductionIds.some((characterId) => (
        !sourceIntroductions.has(characterId)
      ))
    ) {
      throw invalidMissionEdit('A retained introduced character is unknown or duplicated.');
    }
    const retainedIntroductionIds = new Set([
      ...explicitlyRetainedIntroductionIds,
      ...edit.participatingCharacterIds,
      ...edit.characterDeltas.map(({ characterId }) => characterId)
    ].filter((characterId) => sourceIntroductions.has(characterId)));
    const charactersToIntroduce = snapshot.mission.charactersToIntroduce
      .filter(({ characterId }) => retainedIntroductionIds.has(characterId));
    const knownCharacterIds = new Set([
      ...committedCharacterIds,
      ...sourceIntroductions.keys()
    ]);
    const normalizedNames = new Set<string>();
    for (const character of [
      ...snapshot.storyState.characters,
      ...snapshot.mission.charactersToIntroduce
    ]) {
      const normalizedName = normalizeCharacterName(character.name);
      if (normalizedName.length > 0) normalizedNames.add(normalizedName);
    }

    const generatedCharacterIds: string[] = [];
    for (const character of edit.newCharacters) {
      const normalizedName = normalizeCharacterName(character.name);
      if (normalizedName.length === 0 || normalizedNames.has(normalizedName)) {
        throw invalidMissionEdit('Participant names must be non-empty and unique after normalization.');
      }
      normalizeRequiredText(character.role, 'participant role');
      normalizedNames.add(normalizedName);
      const characterId = provisionalCharacterId(
        snapshot.paths.projectId,
        snapshot.mission.chapterNumber,
        normalizedName
      );
      if (knownCharacterIds.has(characterId)) {
        throw invalidMissionEdit('A generated provisional character ID collides with an existing character.');
      }
      knownCharacterIds.add(characterId);
      generatedCharacterIds.push(characterId);
      charactersToIntroduce.push({
        characterId,
        name: character.name,
        role: character.role
      });
    }

    const mission = ChapterMissionSchema.parse({
      id: snapshot.mission.id,
      chapterNumber: snapshot.mission.chapterNumber,
      chapterFunction: edit.chapterFunction,
      requiredObjectives,
      debtsToPayOrAdvance: edit.debtsToPayOrAdvance,
      debtsToIntroduce: edit.debtsToIntroduce,
      characterDeltas: edit.characterDeltas,
      participatingCharacterIds: [
        ...edit.participatingCharacterIds,
        ...generatedCharacterIds
      ],
      charactersToIntroduce,
      readerInformationDelta: edit.readerInformationDelta,
      forbiddenMoves: edit.forbiddenMoves,
      targetEmotionalCurve: edit.targetEmotionalCurve,
      ...(edit.targetWordCount === null
        ? {}
        : { targetWordCount: edit.targetWordCount })
    });
    if (
      !missionCharacterReferencesAreValid(mission, snapshot.storyState)
      || !missionDebtReferencesAreValid(mission, snapshot.storyState)
    ) {
      throw invalidMissionEdit('The edited mission contains invalid narrative references.');
    }
    assertMissionHasParticipants(mission, snapshot.storyState);
    return mission;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidMissionEdit('The edited chapter mission is invalid.');
  }
}

async function readChapterAuthoringSnapshot(
  projectRoot: string,
  chapterNumber: number,
  store: FileStore
): Promise<ChapterAuthoringSnapshot> {
  const storyStatePath = path.join(projectRoot, 'state', 'story_state.json');
  const storyStateText = await store.readText(storyStatePath);
  const storyState = parseJson(storyStateText, StoryStateSchema, 'Story State');
  const paths = new ProjectPaths(path.dirname(projectRoot), storyState.projectId);
  if (paths.projectRoot !== projectRoot) {
    throw new AppError(
      'DESKTOP_CHAPTER_PROJECT_INVALID',
      'Project root does not match Story State project identity.',
      2
    );
  }

  const missionPath = paths.chapterArtifact(chapterNumber, 'mission.json');
  const rankingPath = paths.chapterArtifact(chapterNumber, 'ranking.json');
  const selectedPlanPath = paths.chapterArtifact(chapterNumber, 'selected_plan.md');
  const queuePath = paths.chapterQueue();
  const [missionText, rankingText, selectedPlanText, queueText, sceneDraftsDirectoryExisted] = await Promise.all([
    store.readText(missionPath),
    store.readText(rankingPath),
    store.readText(selectedPlanPath),
    store.readText(queuePath),
    store.exists(paths.chapterArtifact(chapterNumber, 'scenes'))
  ]);
  const mission = parseJson(missionText, ChapterMissionSchema, 'chapter mission');
  const ranking = parseJson(rankingText, ChapterPlanRankingSchema, 'chapter ranking');
  const queue = parseJson(queueText, ChapterQueueSchema, 'chapter queue');
  if (
    mission.chapterNumber !== chapterNumber
    || ranking.chapterNumber !== chapterNumber
    || queue.projectId !== paths.projectId
  ) {
    throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', 'Chapter authoring artifacts disagree on identity.', 2);
  }
  const queueItems = queue.chapters.filter((item) => item.chapterNumber === chapterNumber);
  if (queueItems.length !== 1) {
    throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', 'Chapter queue target is not unique.', 2);
  }
  const candidateIds = ranking.candidates.map(({ candidateId }) => candidateId);
  if (
    new Set(candidateIds).size !== candidateIds.length
    || !candidateIds.includes(ranking.selectedCandidateId)
    || candidateIds.some((candidateId) => !/^plan_[0-9]{3}$/u.test(candidateId))
  ) {
    throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', 'Chapter ranking candidates are invalid.', 2);
  }
  const candidateDir = paths.chapterArtifact(chapterNumber, 'plan_candidates');
  const expectedCandidateFiles = candidateIds.map((candidateId) => `${candidateId}.md`).sort();
  const actualCandidateFiles = await store.list(candidateDir);
  if (JSON.stringify(actualCandidateFiles) !== JSON.stringify(expectedCandidateFiles)) {
    throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', 'Chapter candidate files do not match the ranking.', 2);
  }
  const candidates = new Map<string, string>();
  for (const candidate of ranking.candidates) {
    const expectedPath = projectRelative(
      projectRoot,
      paths.chapterArtifact(chapterNumber, 'plan_candidates', `${candidate.candidateId}.md`)
    );
    if (candidate.planPath !== expectedPath) {
      throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', 'Candidate plan path is not canonical.', 2);
    }
    candidates.set(
      candidate.candidateId,
      await store.readText(paths.projectArtifact(expectedPath))
    );
  }
  const rankedSelectedCandidate = ranking.candidates.find(
    ({ candidateId }) => candidateId === ranking.selectedCandidateId
  )!;
  if (
    ranking.selectedPlanPath !== selectedPlanRelativePath(chapterNumber)
    && ranking.selectedPlanPath !== rankedSelectedCandidate.planPath
  ) {
    throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', 'Selected plan path is not canonical.', 2);
  }
  const candidateHashes = [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([candidateId, markdown]) => ({ candidateId, hash: sha256(markdown) }));
  const reviewHash = sha256(JSON.stringify({
    chapterNumber,
    missionHash: sha256(missionText),
    candidates: candidateHashes,
    rankingHash: sha256(rankingText),
    selectedPlanHash: sha256(selectedPlanText),
    queueHash: sha256(queueText),
    storyStateHash: sha256(storyStateText)
  }));

  return {
    projectRoot,
    paths,
    missionText,
    mission,
    rankingText,
    ranking,
    selectedPlanText,
    queueText,
    queue,
    queueItem: queueItems[0]!,
    storyStateText,
    storyState,
    candidates,
    reviewHash,
    sceneDraftsDirectoryExisted
  };
}

function assertEditableSnapshot(
  snapshot: ChapterAuthoringSnapshot,
  expectedReviewHash: string
): void {
  assertUncommitted(snapshot);
  if (snapshot.reviewHash !== expectedReviewHash) {
    throw new AppError(
      'DESKTOP_CHAPTER_EDIT_STALE',
      'The chapter review changed before the author edit was applied.',
      2
    );
  }
}

function assertUncommitted(snapshot: ChapterAuthoringSnapshot): void {
  if (snapshot.ranking.chapterNumber <= snapshot.storyState.latestCommittedChapter) {
    throw new AppError(
      'DESKTOP_CHAPTER_EDIT_COMMITTED',
      `Cannot edit committed chapter ${snapshot.ranking.chapterNumber}.`,
      2
    );
  }
}

async function rollbackAuthoringTransaction(
  transaction: AuthoringTransaction,
  store: FileStore,
  originalError: unknown
): Promise<void> {
  const snapshot = transaction.snapshot;
  const restorationErrors: string[] = [];
  const restorationSteps: Array<() => Promise<unknown>> = [
    () => store.writeText(
      snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'mission.json'),
      snapshot.missionText
    ),
    () => store.writeText(
      snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'ranking.json'),
      snapshot.rankingText
    ),
    () => store.writeText(
      snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'selected_plan.md'),
      snapshot.selectedPlanText
    ),
    () => store.writeText(snapshot.paths.chapterQueue(), snapshot.queueText)
  ];
  if (transaction.archive !== null) {
    for (const artifact of transaction.archive.archivedArtifacts) {
      if (
        artifact.sourcePath === missionRelativePath(snapshot.ranking.chapterNumber)
        || artifact.node === 'ranking'
        || artifact.node === 'selected_plan'
      ) continue;
      restorationSteps.push(async () => {
        const content = await store.readText(snapshot.paths.projectArtifact(artifact.archivedPath));
        if (
          sha256(content) !== artifact.hash
          || Buffer.byteLength(content, 'utf8') !== artifact.byteSize
        ) {
          throw new AppError(
            'DESKTOP_CHAPTER_ARCHIVE_INVALID',
            `Archived rollback source is invalid: ${artifact.archivedPath}`,
            2
          );
        }
        await store.writeText(snapshot.paths.projectArtifact(artifact.sourcePath), content);
      });
    }
    if (snapshot.sceneDraftsDirectoryExisted) {
      restorationSteps.push(() => store.ensureDir(
        snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'scenes')
      ));
    }
  }
  for (const record of transaction.revisionRecords) {
    restorationSteps.push(() => store.writeText(record.path, record.content));
  }
  for (const restore of restorationSteps) {
    try {
      await restore();
    } catch (error) {
      restorationErrors.push(getErrorMessage(error));
    }
  }
  if (restorationErrors.length > 0) {
    throw new AppError(
      'DESKTOP_CHAPTER_EDIT_ROLLBACK_FAILED',
      `Author edit failed (${getErrorMessage(originalError)}) and rollback failed: ${restorationErrors.join('; ')}`,
      2
    );
  }

  const cleanupErrors: string[] = [];
  const cleanupSteps: Array<() => Promise<unknown>> = transaction.createdProvenancePaths.map(
    (provenancePath) => async () => {
      if (await store.exists(provenancePath)) await store.removePath(provenancePath);
    }
  );
  if (transaction.archive !== null) {
    cleanupSteps.push(async () => {
      const archiveDir = snapshot.paths.projectArtifact(transaction.archive!.relativeArchiveDir);
      if (await store.exists(archiveDir)) {
        await store.removePath(archiveDir, { recursive: true });
      }
    });
  }
  for (const cleanup of cleanupSteps) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(getErrorMessage(error));
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AppError(
      'DESKTOP_CHAPTER_EDIT_ROLLBACK_FAILED',
      `Author edit failed (${getErrorMessage(originalError)}) and rollback failed: ${cleanupErrors.join('; ')}`,
      2
    );
  }
}

async function removeInvalidatedDownstream(
  snapshot: ChapterAuthoringSnapshot,
  store: FileStore
): Promise<void> {
  for (const artifact of [
    { path: snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'scene_cards.json'), recursive: false },
    { path: snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'scenes'), recursive: true },
    { path: snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'draft_v1.md'), recursive: false }
  ]) {
    if (await store.exists(artifact.path)) {
      await store.removePath(artifact.path, { recursive: artifact.recursive });
    }
  }
}

async function removeInvalidatedMissionDownstream(
  snapshot: ChapterAuthoringSnapshot,
  store: FileStore
): Promise<void> {
  for (const artifact of [
    { path: snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'plan_candidates'), recursive: true },
    { path: snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'ranking.json'), recursive: false },
    { path: snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'selected_plan.md'), recursive: false },
    { path: snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'scene_cards.json'), recursive: false },
    { path: snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'scenes'), recursive: true },
    { path: snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'draft_v1.md'), recursive: false },
    { path: snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'diagnostics_v1.json'), recursive: false }
  ]) {
    if (await store.exists(artifact.path)) {
      await store.removePath(artifact.path, { recursive: artifact.recursive });
    }
  }
}

async function snapshotPlanRevisionRecords(
  snapshot: ChapterAuthoringSnapshot,
  store: FileStore
): Promise<RevisionRecordSnapshot[]> {
  return snapshotRevisionRecords(snapshot, store, 'selected_plan');
}

async function snapshotRevisionRecords(
  snapshot: ChapterAuthoringSnapshot,
  store: FileStore,
  artifactKind: 'mission' | 'selected_plan'
): Promise<RevisionRecordSnapshot[]> {
  const revisionDir = snapshot.paths.chapterArtifact(
    snapshot.ranking.chapterNumber,
    'author_revisions'
  );
  if (!(await store.exists(revisionDir))) return [];
  const records: RevisionRecordSnapshot[] = [];
  for (const fileName of await store.list(revisionDir)) {
    const pattern = artifactKind === 'mission'
      ? /^mission_revision_v[1-9]\d*\.json$/u
      : /^plan_revision_v[1-9]\d*\.json$/u;
    if (!pattern.test(fileName)) continue;
    const recordPath = path.join(revisionDir, fileName);
    const content = await store.readText(recordPath);
    const record = AuthorRevisionRecordSchema.parse(JSON.parse(content) as unknown);
    if (
      record.projectId !== snapshot.paths.projectId
      || record.chapterNumber !== snapshot.ranking.chapterNumber
      || record.artifactKind !== artifactKind
    ) {
      throw new AppError(
        'DESKTOP_CHAPTER_EDIT_INVALID',
        `Author revision metadata has invalid scope: ${fileName}`,
        2
      );
    }
    records.push({ path: recordPath, content });
  }
  return records;
}

async function firstModelRecommendation(
  snapshot: ChapterAuthoringSnapshot,
  store: FileStore
): Promise<string> {
  const revisionDir = snapshot.paths.chapterArtifact(
    snapshot.ranking.chapterNumber,
    'author_revisions'
  );
  if (!(await store.exists(revisionDir))) return snapshot.ranking.selectedCandidateId;
  const selections = (await store.list(revisionDir))
    .map((fileName) => ({ fileName, match: DIRECTION_SELECTION_PATTERN.exec(fileName) }))
    .filter((entry): entry is { fileName: string; match: RegExpExecArray } => entry.match !== null)
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]));
  const first = selections[0];
  if (first === undefined) return snapshot.ranking.selectedCandidateId;
  const record = await store.readJson(
    path.join(revisionDir, first.fileName),
    ChapterDirectionSelectionSchema
  );
  if (
    record.projectId !== snapshot.paths.projectId
    || record.chapterNumber !== snapshot.ranking.chapterNumber
  ) {
    throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', 'Direction selection provenance has invalid scope.', 2);
  }
  return record.modelRecommendedCandidateId;
}

async function nextArtifactVersion(
  paths: ProjectPaths,
  store: FileStore,
  chapterNumber: number,
  pattern: RegExp
): Promise<number> {
  const revisionDir = paths.chapterArtifact(chapterNumber, 'author_revisions');
  if (!(await store.exists(revisionDir))) return 1;
  return (await store.list(revisionDir)).reduce((highest, fileName) => {
    const match = pattern.exec(fileName);
    return match === null ? highest : Math.max(highest, Number(match[1]));
  }, 0) + 1;
}

function queueAtRanking(queue: ChapterQueue, chapterNumber: number, updatedAt: string): ChapterQueue {
  return ChapterQueueSchema.parse({
    ...queue,
    chapters: queue.chapters.map((item) => item.chapterNumber === chapterNumber
      ? {
          ...item,
          status: 'planned_ready',
          currentStage: 'ranking',
          completedStages: [...COMPLETED_PLANNING_STAGES],
          failureReason: null,
          updatedAt
        }
      : item)
  });
}

function queueAtMission(queue: ChapterQueue, chapterNumber: number, updatedAt: string): ChapterQueue {
  return ChapterQueueSchema.parse({
    ...queue,
    chapters: queue.chapters.map((item) => item.chapterNumber === chapterNumber
      ? {
          ...item,
          status: 'planning',
          currentStage: 'mission',
          completedStages: [],
          failureReason: null,
          updatedAt
        }
      : item)
  });
}

function queueSnapshot(item: ChapterQueueItem): { status: ChapterQueueItem['status']; stage: ChapterQueueItem['currentStage'] } {
  return { status: item.status, stage: item.currentStage };
}

function retainedCandidateReferences(snapshot: ChapterAuthoringSnapshot): AuthorArtifactReference[] {
  return [...snapshot.candidates.keys()].map((candidateId) => ({
    node: 'plan_candidates',
    path: projectRelative(
      snapshot.projectRoot,
      snapshot.paths.chapterArtifact(
        snapshot.ranking.chapterNumber,
        'plan_candidates',
        `${candidateId}.md`
      )
    )
  }));
}

function selectedPlanRelativePath(chapterNumber: number): string {
  return `chapters/chapter_${padChapter(chapterNumber)}/selected_plan.md`;
}

function missionRelativePath(chapterNumber: number): string {
  return `chapters/chapter_${padChapter(chapterNumber)}/mission.json`;
}

function projectRelative(projectRoot: string, filePath: string): string {
  const relative = path.relative(projectRoot, path.resolve(filePath));
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AppError('DESKTOP_CHAPTER_PATH_INVALID', 'Chapter artifact escapes the project root.', 2);
  }
  return relative.split(path.sep).join('/');
}

function markdownTitle(markdown: string, fallback: string): string {
  return markdown.split(/\r?\n/u)
    .find((line) => /^#\s+\S/u.test(line))
    ?.replace(/^#\s+/u, '')
    .trim() || fallback;
}

function parseJson<T>(
  text: string,
  schema: { parse(value: unknown): T },
  label: string
): T {
  try {
    return schema.parse(JSON.parse(text) as unknown);
  } catch {
    throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', `Invalid ${label}.`, 2);
  }
}

function padChapter(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function provisionalCharacterId(
  projectId: string,
  chapterNumber: number,
  normalizedName: string
): string {
  return `char_provisional_${createHash('sha256')
    .update(`${projectId}\0${chapterNumber}\0${normalizedName}`)
    .digest('hex')
    .slice(0, 16)}`;
}

function provisionalObjectiveId(
  projectId: string,
  chapterNumber: number,
  normalizedText: string
): string {
  return `obj_author_${createHash('sha256')
    .update(`${projectId}\0${chapterNumber}\0${normalizedText}`)
    .digest('hex')
    .slice(0, 16)}`;
}

function normalizeCharacterName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) {
    throw invalidMissionEdit(`The ${label} must not be empty.`);
  }
  return normalized;
}

function invalidMissionEdit(message: string): AppError {
  return new AppError('DESKTOP_CHAPTER_EDIT_INVALID', message, 2);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
