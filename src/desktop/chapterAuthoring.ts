import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  adoptAuthorRevision,
  archiveAuthorChapterArtifacts,
  createAuthorRevision,
  readAuthorRevision,
  type CreateAuthorRevisionResult
} from '../app/chapterAuthorRevision.js';
import { withProjectChapterOperationLease } from '../app/projectOperationLease.js';
import {
  AuthorEditInvalidationReportSchema,
  ChapterDirectionSelectionSchema,
  ChapterMissionSchema,
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  AuthorArtifactReference,
  AuthorInvalidatedNode,
  ChapterPlanRanking,
  ChapterQueue,
  ChapterQueueItem,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';

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

const ARCHIVE_NODES = [
  'selected_plan',
  'scene_cards',
  'scene_drafts',
  'draft'
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

interface ChapterAuthoringSnapshot {
  projectRoot: string;
  paths: ProjectPaths;
  missionText: string;
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
    const archive = await archiveWithRollback({
      snapshot,
      store,
      archiveId: selectionId
    });

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

    try {
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
      await restoreActiveArtifacts(snapshot, store, error);
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
    const archive = await archiveWithRollback({
      snapshot,
      store,
      archiveId: revision.record.revisionId
    });
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
      await restoreActiveArtifacts(snapshot, store, new Error('Active selected plan was not archived.'));
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

    try {
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
      await restoreActiveArtifacts(snapshot, store, error);
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
  const [missionText, rankingText, selectedPlanText, queueText] = await Promise.all([
    store.readText(missionPath),
    store.readText(rankingPath),
    store.readText(selectedPlanPath),
    store.readText(queuePath)
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
  const expectedSelectedPlanPath = selectedPlanRelativePath(chapterNumber);
  if (ranking.selectedPlanPath !== expectedSelectedPlanPath) {
    throw new AppError('DESKTOP_CHAPTER_EDIT_INVALID', 'Selected plan path is not canonical.', 2);
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
    rankingText,
    ranking,
    selectedPlanText,
    queueText,
    queue,
    queueItem: queueItems[0]!,
    storyStateText,
    storyState,
    candidates,
    reviewHash
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

async function archiveWithRollback(input: {
  snapshot: ChapterAuthoringSnapshot;
  store: FileStore;
  archiveId: string;
}) {
  try {
    return await archiveAuthorChapterArtifacts({
      projectRoot: input.snapshot.projectRoot,
      chapterNumber: input.snapshot.ranking.chapterNumber,
      archiveId: input.archiveId,
      nodes: [...ARCHIVE_NODES]
    }, input.store);
  } catch (error) {
    await restoreActiveArtifacts(input.snapshot, input.store, error);
    throw error;
  }
}

async function restoreActiveArtifacts(
  snapshot: ChapterAuthoringSnapshot,
  store: FileStore,
  originalError: unknown
): Promise<void> {
  const rollbackErrors: string[] = [];
  for (const restore of [
    () => store.writeText(
      snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'ranking.json'),
      snapshot.rankingText
    ),
    () => store.writeText(
      snapshot.paths.chapterArtifact(snapshot.ranking.chapterNumber, 'selected_plan.md'),
      snapshot.selectedPlanText
    ),
    () => store.writeText(snapshot.paths.chapterQueue(), snapshot.queueText)
  ]) {
    try {
      await restore();
    } catch (error) {
      rollbackErrors.push(getErrorMessage(error));
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AppError(
      'DESKTOP_CHAPTER_EDIT_ROLLBACK_FAILED',
      `Author edit failed (${getErrorMessage(originalError)}) and rollback failed: ${rollbackErrors.join('; ')}`,
      2
    );
  }
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
