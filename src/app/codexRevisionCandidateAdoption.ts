import path from 'node:path';

import { sha256 } from './codexDiagnosticsEvidenceRules.js';
import {
  CandidateRevisionEvidenceAdjudicationSchema,
  ChapterQueueSchema,
  DraftAdoptionManifestSchema,
  DraftSelectionSchema,
  ExpandedTargetRevisionCandidateDispositionSchema,
  ExpandedTargetRevisionDiagnosticsABSchema,
  ExpandedTargetRevisionExperimentReportSchema,
  ExpandedTargetRevisionQualityReportSchema,
  ExpandedTargetRevisionScopeValidationSchema,
  RevisionCandidateAdoptionApprovalSchema,
  RevisionCandidateReviewSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  DraftAdoptionManifest,
  DraftSelection,
  ExpandedTargetRevisionCandidateDisposition,
  ExpandedTargetRevisionDiagnosticsAB,
  ExpandedTargetRevisionExperimentReport,
  ExpandedTargetRevisionQualityReport,
  ExpandedTargetRevisionScopeValidation,
  RevisionCandidateAdoptionApproval,
  RevisionCandidateReview
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError } from '../utils/AppError.js';

export interface RevisionCandidateBaseInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  candidate?: string;
}

export interface ApproveRevisionCandidateInput extends RevisionCandidateBaseInput {
  confirm: boolean;
  operator?: string;
}

export interface AdoptRevisionCandidateInput extends RevisionCandidateBaseInput {
  approval?: string;
}

export interface ReviewRevisionCandidateResult {
  reportPath: string;
  markdownPath: string;
  report: RevisionCandidateReview;
}

export interface ApproveRevisionCandidateResult {
  recordPath: string;
  markdownPath: string;
  record: RevisionCandidateAdoptionApproval;
}

export interface AdoptRevisionCandidateResult {
  adoptedDraftPath: string;
  manifestPath: string;
  manifestMarkdownPath: string;
  selectionPath: string;
  manifest: DraftAdoptionManifest;
  selection: DraftSelection;
}

interface CandidateBundle {
  dispositionPath: string;
  dispositionText: string;
  disposition: ExpandedTargetRevisionCandidateDisposition;
  experimentPath: string;
  experimentText: string;
  experiment: ExpandedTargetRevisionExperimentReport;
  scope: ExpandedTargetRevisionScopeValidation;
  diagnostics: ExpandedTargetRevisionDiagnosticsAB;
  adjudication: ReturnType<typeof CandidateRevisionEvidenceAdjudicationSchema.parse>;
  quality: ExpandedTargetRevisionQualityReport;
  candidateText: string;
  sourceDraftText: string;
  stateText: string;
  queueText: string;
  latestCommittedChapter: number;
  queueStatus: string;
  sourceStateHash: string;
  sourceQueueHash: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function reviewCodexRevisionCandidate(
  input: RevisionCandidateBaseInput,
  fileStore = new FileStore()
): Promise<ReviewRevisionCandidateResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const bundle = await loadCandidateBundle(paths, fileStore, input.chapterNumber, input.candidate ?? 'latest');
  const candidateHash = sha256(bundle.candidateText);
  const sourceDraftHash = sha256(bundle.sourceDraftText);
  const checklist = buildChecklist(bundle, candidateHash, sourceDraftHash);
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'revision_candidate_review');
  const report = await fileStore.writeJson(artifact.jsonPath, {
    reviewId: `revision_candidate_review_ch${pad(input.chapterNumber)}_v${artifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    candidatePath: bundle.disposition.candidatePath,
    candidateHash,
    sourceDraftPath: bundle.experiment.sourceDraftPath,
    sourceDraftHash,
    experimentReportPath: bundle.experimentPath,
    experimentReportHash: sha256(bundle.experimentText),
    dispositionPath: bundle.dispositionPath,
    dispositionHash: sha256(await fileStore.readText(paths.projectArtifact(bundle.dispositionPath))),
    scopeValidationPath: bundle.experiment.scopeValidationPath,
    diagnosticsABPath: bundle.experiment.diagnosticsABPath,
    adjudicationPath: bundle.experiment.candidateAdjudicationPath,
    qualityReportPath: bundle.experiment.qualityReportPath,
    experimentResult: bundle.experiment.result,
    disposition: bundle.disposition.result,
    scopeValid: bundle.scope.scopeValid,
    contradictionsResolved: contradictionsResolved(bundle),
    newBlockingHardChecks: bundle.diagnostics.newlyIntroducedHardChecks,
    baselineMedianScore: bundle.diagnostics.baselineAverageScoreMedian,
    candidateMedianScore: bundle.diagnostics.candidateAverageScoreMedian,
    scoreDelta: bundle.diagnostics.scoreDelta,
    sourceStatePath: path.join('state', 'story_state.json'),
    sourceStateHash: bundle.sourceStateHash,
    sourceQueuePath: path.join('planning', 'chapter_queue.json'),
    sourceQueueHash: bundle.sourceQueueHash,
    humanReviewChecklist: checklist,
    approvedForAdoption: false,
    generatedAt: new Date().toISOString(),
    codexInvoked: false,
    storyStateMutated: false,
    queueMutated: false
  }, RevisionCandidateReviewSchema);
  await fileStore.writeText(artifact.mdPath, renderReview(report));
  return { reportPath: artifact.relativeJsonPath, markdownPath: artifact.relativeMdPath, report };
}

export async function approveCodexRevisionCandidate(
  input: ApproveRevisionCandidateInput,
  fileStore = new FileStore()
): Promise<ApproveRevisionCandidateResult> {
  if (!input.confirm) {
    throw new AppError('CODEX_REVISION_CANDIDATE_NOT_ELIGIBLE', 'Candidate adoption approval requires --confirm.', 2);
  }
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await ensureNotAdopted(paths, fileStore, input.chapterNumber);
  const bundle = await loadCandidateBundle(paths, fileStore, input.chapterNumber, input.candidate ?? 'latest');
  const reviewArtifact = await findLatestVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'revision_candidate_review');
  if (reviewArtifact === undefined) {
    throw new AppError('CODEX_REVISION_CANDIDATE_NOT_ELIGIBLE', 'Run review-revision-candidate before approving adoption.', 2);
  }
  const reviewText = await fileStore.readText(reviewArtifact.jsonPath);
  const review = RevisionCandidateReviewSchema.parse(JSON.parse(reviewText) as unknown);
  assertApprovalFreshness(bundle, review);
  if (!review.humanReviewChecklist.every((item) => item.passed) || !candidateEligible(bundle)) {
    throw new AppError('CODEX_REVISION_CANDIDATE_NOT_ELIGIBLE', 'Candidate does not satisfy the D3 adoption eligibility gate.', 2);
  }
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'revision_candidate_adoption_approval');
  const timestamp = new Date().toISOString();
  const record = await fileStore.writeJson(artifact.jsonPath, {
    approvalId: `revision_candidate_adoption_approval_ch${pad(input.chapterNumber)}_v${artifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    candidatePath: review.candidatePath,
    candidateHash: review.candidateHash,
    reviewReportPath: reviewArtifact.relativeJsonPath,
    reviewReportHash: sha256(reviewText),
    experimentReportPath: review.experimentReportPath,
    experimentReportHash: review.experimentReportHash,
    dispositionPath: review.dispositionPath,
    dispositionHash: review.dispositionHash,
    approved: true,
    confirmedAt: timestamp,
    operator: input.operator?.trim() || 'local_user',
    riskAcknowledged: true,
    approvalScope: 'preview_only',
    sourceStateHash: review.sourceStateHash,
    sourceQueueHash: review.sourceQueueHash,
    sourceDraftHash: review.sourceDraftHash,
    command: `codex approve-revision-candidate ${paths.projectId} ${input.chapterNumber} --candidate ${input.candidate ?? 'latest'} --confirm`,
    generatedAt: timestamp,
    codexInvoked: false,
    storyStateMutated: false,
    queueMutated: false
  }, RevisionCandidateAdoptionApprovalSchema);
  await fileStore.writeText(artifact.mdPath, renderApproval(record));
  return { recordPath: artifact.relativeJsonPath, markdownPath: artifact.relativeMdPath, record };
}

export async function adoptCodexRevisionCandidate(
  input: AdoptRevisionCandidateInput,
  fileStore = new FileStore()
): Promise<AdoptRevisionCandidateResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await ensureNotAdopted(paths, fileStore, input.chapterNumber);
  const bundle = await loadCandidateBundle(paths, fileStore, input.chapterNumber, input.candidate ?? 'latest');
  const approvalArtifact = await resolveApproval(paths, fileStore, input.chapterNumber, input.approval ?? 'latest');
  const approvalText = await fileStore.readText(approvalArtifact.jsonPath);
  const approval = RevisionCandidateAdoptionApprovalSchema.parse(JSON.parse(approvalText) as unknown);
  await assertAdoptionFreshness(paths, bundle, approval, fileStore);

  const originalDraftPath = relativeChapterArtifact(input.chapterNumber, 'draft_v1.md');
  const adoptedDraftPath = relativeChapterArtifact(input.chapterNumber, 'draft_v2.md');
  const protectedBefore = [bundle.stateText, bundle.queueText, bundle.sourceDraftText];
  await fileStore.writeText(paths.projectArtifact(adoptedDraftPath), bundle.candidateText);
  const adoptedText = await fileStore.readText(paths.projectArtifact(adoptedDraftPath));
  if (adoptedText !== bundle.candidateText) {
    throw new AppError('CODEX_REVISION_CANDIDATE_STALE', 'draft_v2 is not a byte-identical copy of the approved candidate.', 2);
  }

  const manifestArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'draft_adoption_manifest');
  const adoptedAt = new Date().toISOString();
  const dispositionText = await fileStore.readText(paths.projectArtifact(bundle.dispositionPath));
  const manifest = await fileStore.writeJson(manifestArtifact.jsonPath, {
    adoptionId: `draft_adoption_ch${pad(input.chapterNumber)}_v${manifestArtifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    candidatePath: bundle.disposition.candidatePath,
    candidateHash: sha256(bundle.candidateText),
    adoptedDraftPath,
    adoptedDraftHash: sha256(adoptedText),
    originalDraftPath,
    originalDraftHash: sha256(bundle.sourceDraftText),
    approvalPath: approvalArtifact.relativeJsonPath,
    approvalHash: sha256(approvalText),
    experimentPath: bundle.experimentPath,
    experimentHash: sha256(bundle.experimentText),
    dispositionPath: bundle.dispositionPath,
    dispositionHash: sha256(dispositionText),
    sourceStateHash: sha256(bundle.stateText),
    sourceQueueHash: sha256(bundle.queueText),
    adoptionScope: 'preview_only',
    canonical: false,
    adoptedAt,
    storyStateMutated: false,
    queueCommitted: false
  }, DraftAdoptionManifestSchema);
  await fileStore.writeText(manifestArtifact.mdPath, renderManifest(manifest));

  const selectionArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'draft_selection');
  const selection = await fileStore.writeJson(selectionArtifact.jsonPath, {
    selectionId: `draft_selection_ch${pad(input.chapterNumber)}_v${selectionArtifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    selectedDraftPath: adoptedDraftPath,
    selectedDraftHash: sha256(adoptedText),
    selectedDraftVersion: 2,
    candidatePath: bundle.disposition.candidatePath,
    approvalPath: approvalArtifact.relativeJsonPath,
    adoptionManifestPath: manifestArtifact.relativeJsonPath,
    scope: 'preview_only',
    selectedAt: adoptedAt,
    storyStateMutated: false,
    queueMutated: false
  }, DraftSelectionSchema);
  await assertProtectedUnchanged(paths, fileStore, input.chapterNumber, protectedBefore);
  return {
    adoptedDraftPath,
    manifestPath: manifestArtifact.relativeJsonPath,
    manifestMarkdownPath: manifestArtifact.relativeMdPath,
    selectionPath: selectionArtifact.relativeJsonPath,
    manifest,
    selection
  };
}

async function loadCandidateBundle(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  candidate: string
): Promise<CandidateBundle> {
  const dispositions = await readVersionedArtifacts(paths, fileStore, chapterNumber, 'targeted_revision_candidate_disposition');
  let selected: { relativePath: string; value: ExpandedTargetRevisionCandidateDisposition } | undefined;
  for (const artifact of dispositions.reverse()) {
    try {
      const value = await fileStore.readJson(artifact.jsonPath, ExpandedTargetRevisionCandidateDispositionSchema);
      if (candidate === 'latest' || value.candidatePath === normalizeProjectPath(candidate)) {
        selected = { relativePath: artifact.relativeJsonPath, value };
        break;
      }
    } catch {
      // Earlier candidate disposition schemas are not eligible for D3 adoption.
    }
  }
  if (selected === undefined || selected.value.experimentReportPath === null) {
    throw new AppError('CODEX_REVISION_CANDIDATE_NOT_ELIGIBLE', 'No revision-round-2 candidate disposition is available.', 2);
  }
  const experimentPath = selected.value.experimentReportPath;
  const experimentText = await fileStore.readText(paths.projectArtifact(experimentPath));
  const experiment = ExpandedTargetRevisionExperimentReportSchema.parse(JSON.parse(experimentText) as unknown);
  const [scope, diagnostics, adjudication, quality, candidateText, sourceDraftText, dispositionText, stateText, queueText, storyState, queue] = await Promise.all([
    fileStore.readJson(paths.projectArtifact(experiment.scopeValidationPath), ExpandedTargetRevisionScopeValidationSchema),
    fileStore.readJson(paths.projectArtifact(experiment.diagnosticsABPath), ExpandedTargetRevisionDiagnosticsABSchema),
    fileStore.readJson(paths.projectArtifact(experiment.candidateAdjudicationPath), CandidateRevisionEvidenceAdjudicationSchema),
    fileStore.readJson(paths.projectArtifact(experiment.qualityReportPath), ExpandedTargetRevisionQualityReportSchema),
    fileStore.readText(paths.projectArtifact(selected.value.candidatePath)),
    fileStore.readText(paths.projectArtifact(experiment.sourceDraftPath)),
    fileStore.readText(paths.projectArtifact(selected.relativePath)),
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue()),
    fileStore.readJson(paths.storyState(), StoryStateSchema),
    fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema)
  ]);
  const queueItem = queue.chapters.find((item) => item.chapterNumber === chapterNumber);
  if (queueItem === undefined) {
    throw new AppError('CODEX_REVISION_CANDIDATE_APPROVAL_SOURCE_STALE', `Chapter ${chapterNumber} is missing from chapter queue.`, 2);
  }
  const stateProtected = requiredProtectedHash(experiment, path.join('state', 'story_state.json'));
  const queueProtected = requiredProtectedHash(experiment, path.join('planning', 'chapter_queue.json'));
  return {
    dispositionPath: selected.relativePath,
    dispositionText,
    disposition: selected.value,
    experimentPath,
    experimentText,
    experiment,
    scope,
    diagnostics,
    adjudication,
    quality,
    candidateText,
    sourceDraftText,
    stateText,
    queueText,
    latestCommittedChapter: storyState.latestCommittedChapter,
    queueStatus: queueItem.status,
    sourceStateHash: stateProtected,
    sourceQueueHash: queueProtected
  };
}

function buildChecklist(bundle: CandidateBundle, candidateHash: string, sourceDraftHash: string) {
  const currentStateHash = sha256(bundle.stateText);
  const currentQueueHash = sha256(bundle.queueText);
  const checks = [
    ['experiment_effective', 'Experiment result is revision_effective.', bundle.experiment.result === 'revision_effective', bundle.experiment.result],
    ['disposition_eligible', 'Disposition is accepted_for_preview_review.', bundle.disposition.result === 'accepted_for_preview_review', bundle.disposition.result],
    ['scope_valid', 'Expanded target scope validation passed.', bundle.scope.scopeValid, String(bundle.scope.scopeValid)],
    ['contradictions_resolved', 'Candidate re-adjudication found no remaining contradiction.', contradictionsResolved(bundle), bundle.adjudication.adjudication],
    ['quality_clean', 'Candidate quality has no critical or error issues.', bundle.quality.criticalIssueCount === 0 && bundle.quality.errorIssueCount === 0, `${bundle.quality.criticalIssueCount}/${bundle.quality.errorIssueCount}`],
    ['no_new_hard_checks', 'A/B diagnostics introduced no blocking hard checks.', bundle.diagnostics.newlyIntroducedHardChecks.length === 0, bundle.diagnostics.newlyIntroducedHardChecks.join(', ') || 'none'],
    ['candidate_fresh', 'Candidate hash matches its disposition.', candidateHash === bundle.disposition.candidateHash, candidateHash],
    ['source_draft_fresh', 'Source draft hash matches the experiment.', sourceDraftHash === bundle.experiment.protectedArtifacts.find((item) => item.path === bundle.experiment.sourceDraftPath)?.afterSha256, sourceDraftHash],
    ['state_fresh', 'Story State hash matches the experiment source.', currentStateHash === bundle.sourceStateHash, currentStateHash],
    ['queue_fresh', 'Queue hash matches the experiment source.', currentQueueHash === bundle.sourceQueueHash, currentQueueHash],
    ['chapter_uncommitted', 'Target chapter remains uncommitted.', bundle.latestCommittedChapter === bundle.experiment.chapterNumber - 1 && !['committed', 'recommitted'].includes(bundle.queueStatus), `${bundle.latestCommittedChapter}/${bundle.queueStatus}`]
  ] as const;
  return checks.map(([checkId, label, passed, evidence]) => ({ checkId, label, passed, evidence }));
}

function candidateEligible(bundle: CandidateBundle): boolean {
  return bundle.experiment.result === 'revision_effective' &&
    bundle.disposition.result === 'accepted_for_preview_review' &&
    bundle.disposition.eligibleForPreviewReview && bundle.scope.scopeValid && contradictionsResolved(bundle) &&
    bundle.quality.criticalIssueCount === 0 && bundle.quality.errorIssueCount === 0 &&
    bundle.diagnostics.newlyIntroducedHardChecks.length === 0;
}

function contradictionsResolved(bundle: CandidateBundle): boolean {
  return bundle.adjudication.adjudication === 'no_remaining_contradiction' &&
    bundle.adjudication.remainingContradictions.length === 0 && bundle.adjudication.newlyIntroducedContradictions.length === 0;
}

function assertApprovalFreshness(bundle: CandidateBundle, review: RevisionCandidateReview): void {
  const candidateHash = sha256(bundle.candidateText);
  if (candidateHash !== review.candidateHash || candidateHash !== bundle.disposition.candidateHash) {
    throw new AppError('CODEX_REVISION_CANDIDATE_STALE', 'Candidate content changed after review.', 2);
  }
  if (
    review.experimentReportHash !== sha256(bundle.experimentText) ||
    review.dispositionPath !== bundle.dispositionPath ||
    review.dispositionHash !== sha256(bundle.dispositionText)
  ) {
    throw new AppError('CODEX_REVISION_CANDIDATE_STALE', 'Candidate experiment or disposition changed after review.', 2);
  }
  if (sha256(bundle.sourceDraftText) !== review.sourceDraftHash || sha256(bundle.stateText) !== review.sourceStateHash || sha256(bundle.queueText) !== review.sourceQueueHash) {
    throw new AppError('CODEX_REVISION_CANDIDATE_APPROVAL_SOURCE_STALE', 'Candidate approval sources changed after review.', 2);
  }
  if (bundle.latestCommittedChapter !== bundle.experiment.chapterNumber - 1 || ['committed', 'recommitted'].includes(bundle.queueStatus)) {
    throw new AppError('CODEX_REVISION_CANDIDATE_APPROVAL_SOURCE_STALE', 'Chapter state no longer permits preview-only adoption.', 2, { chapterNumber: bundle.experiment.chapterNumber });
  }
}

async function assertAdoptionFreshness(
  paths: ProjectPaths,
  bundle: CandidateBundle,
  approval: RevisionCandidateAdoptionApproval,
  fileStore: FileStore
): Promise<void> {
  if (!approval.approved || approval.approvalScope !== 'preview_only' || approval.candidatePath !== bundle.disposition.candidatePath) {
    throw new AppError('CODEX_REVISION_CANDIDATE_NOT_ELIGIBLE', 'Approval does not authorize this candidate for preview-only adoption.', 2);
  }
  if (sha256(bundle.candidateText) !== approval.candidateHash || sha256(bundle.experimentText) !== approval.experimentReportHash) {
    throw new AppError('CODEX_REVISION_CANDIDATE_STALE', 'Candidate or experiment changed after approval.', 2);
  }
  if (sha256(bundle.sourceDraftText) !== approval.sourceDraftHash || sha256(bundle.stateText) !== approval.sourceStateHash || sha256(bundle.queueText) !== approval.sourceQueueHash) {
    throw new AppError('CODEX_REVISION_CANDIDATE_APPROVAL_SOURCE_STALE', 'State, queue, or source draft changed after candidate approval.', 2);
  }
  const reviewText = await fileStore.readText(paths.projectArtifact(approval.reviewReportPath));
  if (
    sha256(reviewText) !== approval.reviewReportHash ||
    approval.dispositionPath !== bundle.dispositionPath ||
    approval.dispositionHash !== sha256(bundle.dispositionText)
  ) {
    throw new AppError('CODEX_REVISION_CANDIDATE_STALE', 'Review or disposition changed after candidate approval.', 2);
  }
}

async function ensureNotAdopted(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  if (await fileStore.exists(paths.chapterArtifact(chapterNumber, 'draft_v2.md'))) {
    throw new AppError('CODEX_REVISION_CANDIDATE_ALREADY_ADOPTED', `Chapter ${chapterNumber} already has draft_v2.md.`, 2);
  }
  const manifests = await readVersionedArtifacts(paths, fileStore, chapterNumber, 'draft_adoption_manifest');
  if (manifests.length > 0) {
    throw new AppError('CODEX_REVISION_CANDIDATE_ALREADY_ADOPTED', `Chapter ${chapterNumber} already has an adoption manifest.`, 2);
  }
}

async function resolveApproval(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, approval: string) {
  if (approval !== 'latest') {
    const relativePath = normalizeProjectPath(approval);
    return { jsonPath: paths.projectArtifact(relativePath), relativeJsonPath: relativePath };
  }
  const artifact = await findLatestVersionedChapterArtifact(paths, fileStore, chapterNumber, 'revision_candidate_adoption_approval');
  if (artifact === undefined) {
    throw new AppError('CODEX_REVISION_CANDIDATE_NOT_ELIGIBLE', 'No candidate adoption approval is available.', 2);
  }
  return artifact;
}

async function assertProtectedUnchanged(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, before: string[]): Promise<void> {
  const after = await Promise.all([
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue()),
    fileStore.readText(paths.chapterArtifact(chapterNumber, 'draft_v1.md'))
  ]);
  if (after.some((value, index) => value !== before[index])) {
    throw new AppError('CODEX_REVISION_CANDIDATE_APPROVAL_SOURCE_STALE', 'Candidate adoption changed Story State, queue, or draft_v1.', 1);
  }
}

function requiredProtectedHash(experiment: ExpandedTargetRevisionExperimentReport, artifactPath: string): string {
  const artifact = experiment.protectedArtifacts.find((item) => item.path === artifactPath);
  if (artifact === undefined || !artifact.unchanged || artifact.beforeSha256 !== artifact.afterSha256) {
    throw new AppError('CODEX_REVISION_CANDIDATE_APPROVAL_SOURCE_STALE', `Experiment does not contain a stable protected hash for ${artifactPath}.`, 2);
  }
  return artifact.afterSha256;
}

async function nextVersionedChapterArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const jsonPath = paths.chapterArtifact(chapterNumber, jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      const mdFile = `${baseName}_v${version}.md`;
      return {
        version,
        jsonPath,
        mdPath: paths.chapterArtifact(chapterNumber, mdFile),
        relativeJsonPath: relativeChapterArtifact(chapterNumber, jsonFile),
        relativeMdPath: relativeChapterArtifact(chapterNumber, mdFile)
      };
    }
  }
  throw new AppError('CHAPTER_ARTIFACT_VERSION_EXHAUSTED', `Could not allocate ${baseName}.`, 1);
}

async function findLatestVersionedChapterArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  return (await readVersionedArtifacts(paths, fileStore, chapterNumber, baseName)).at(-1);
}

async function readVersionedArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  if (!(await fileStore.exists(paths.chapterDir(chapterNumber)))) return [];
  const pattern = new RegExp(`^${escapeRegExp(baseName)}_v(\\d+)\\.json$`);
  const artifacts = [];
  for (const entry of await fileStore.list(paths.chapterDir(chapterNumber))) {
    const match = pattern.exec(entry);
    if (match === null) continue;
    artifacts.push({
      version: Number.parseInt(match[1]!, 10),
      jsonPath: paths.chapterArtifact(chapterNumber, entry),
      relativeJsonPath: relativeChapterArtifact(chapterNumber, entry)
    });
  }
  return artifacts.sort((left, right) => left.version - right.version);
}

function renderReview(report: RevisionCandidateReview): string {
  return [
    '# Revision Candidate Review', '',
    `candidate: ${report.candidatePath}`,
    `experimentResult: ${report.experimentResult}`,
    `disposition: ${report.disposition}`,
    `scopeValid: ${String(report.scopeValid)}`,
    `contradictionsResolved: ${String(report.contradictionsResolved)}`,
    `scoreDelta: ${report.scoreDelta ?? 'n/a'}`,
    'approvedForAdoption: false', '',
    ...report.humanReviewChecklist.map((item) => `- [${item.passed ? 'x' : ' '}] ${item.label} (${item.evidence})`)
  ].join('\n') + '\n';
}

function renderApproval(record: RevisionCandidateAdoptionApproval): string {
  return [
    '# Revision Candidate Adoption Approval', '',
    `candidate: ${record.candidatePath}`,
    `approved: ${String(record.approved)}`,
    `scope: ${record.approvalScope}`,
    `operator: ${record.operator}`,
    `confirmedAt: ${record.confirmedAt}`,
    'No draft, queue, or Story State was modified by this approval.'
  ].join('\n') + '\n';
}

function renderManifest(manifest: DraftAdoptionManifest): string {
  return [
    '# Draft Adoption Manifest', '',
    `candidate: ${manifest.candidatePath}`,
    `adoptedDraft: ${manifest.adoptedDraftPath}`,
    `hash: ${manifest.adoptedDraftHash}`,
    `scope: ${manifest.adoptionScope}`,
    `canonical: ${String(manifest.canonical)}`,
    `storyStateMutated: ${String(manifest.storyStateMutated)}`,
    `queueCommitted: ${String(manifest.queueCommitted)}`
  ].join('\n') + '\n';
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.join('chapters', `chapter_${pad(chapterNumber)}`, fileName);
}

function normalizeProjectPath(value: string): string {
  return value.split(/[\\/]+/).join(path.sep);
}

function pad(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
