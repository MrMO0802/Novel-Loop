import path from 'node:path';

import { parseMarkdownEvidenceParagraphs, sha256 } from './codexDiagnosticsEvidenceRules.js';
import { RunLogger } from '../logging/RunLogger.js';
import {
  CandidateCommitReviewSchema,
  CandidatePatchEvidenceMapSchema,
  CanonPatchSchema,
  ChapterMissionSchema,
  ChapterQueueSchema,
  CodexCandidatePreviewReportSchema,
  CodexPreviewCompletenessReportSchema,
  StateDiffReportSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  CandidateCommitMutationDecision,
  CandidateCommitMutationType,
  CandidateCommitReview,
  CandidateCommitReviewChange,
  CandidateCommitSectionReview,
  CandidateNarrativeDebtDetail,
  CandidatePatchEvidenceMap,
  CandidatePatchEvidenceMutation,
  CanonPatch,
  ChapterMission,
  CodexCandidatePreviewReport,
  StateDiffChange,
  StateDiffReport,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface ReviewCodexCandidateCommitInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  preview?: string;
  runId?: string;
}

export interface ReviewCodexCandidateCommitResult {
  runId: string;
  reviewPath: string;
  reviewMarkdownPath: string;
  evidenceMapPath: string;
  evidenceMapMarkdownPath: string;
  report: CandidateCommitReview;
  evidenceMap: CandidatePatchEvidenceMap;
}

interface ReviewSources {
  previewPath: string;
  preview: CodexCandidatePreviewReport;
  candidateText: string;
  adoptedDraftText: string;
  finalText: string;
  proposalText: string;
  normalizedPatchText: string;
  normalizedPatch: CanonPatch;
  stateDiffText: string;
  stateDiff: StateDiffReport;
  completenessText: string;
  missionText: string;
  mission: ChapterMission;
  selectedPlanText: string;
  storyStateText: string;
  storyState: StoryState;
  queueText: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const MAX_EVIDENCE_SNIPPET = 240;

export async function reviewCodexCandidateCommit(
  input: ReviewCodexCandidateCommitInput,
  fileStore = new FileStore()
): Promise<ReviewCodexCandidateCommitResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const sources = await loadReviewSources(paths, fileStore, input);
  const protectedBefore = await captureProtected(paths, fileStore, input.chapterNumber);
  const runId = input.runId ?? `${createRunId()}_codex_candidate_commit_review_ch${pad(input.chapterNumber)}`;
  const runLogger = new RunLogger(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex.review-candidate-commit',
    args: {
      chapterNumber: input.chapterNumber,
      preview: input.preview ?? 'latest',
      provider: 'none',
      codexInvoked: false,
      storyStateMutationAllowed: false,
      queueMutationAllowed: false,
      snapshotAllowed: false,
      canonicalArtifactWriteAllowed: false,
      commitApprovalAllowed: false
    }
  });

  try {
    const evidenceArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_patch_evidence_map');
    const reviewArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_commit_review');
    const generatedAt = new Date().toISOString();
    const evidenceMap = buildEvidenceMap({ sources, paths, input, runId, generatedAt });
    await fileStore.writeJson(evidenceArtifact.absolutePath, evidenceMap, CandidatePatchEvidenceMapSchema);
    await fileStore.writeText(evidenceArtifact.markdownPath, renderEvidenceMap(evidenceMap));
    await runLogger.recordArtifact(runId, evidenceArtifact.relativePath, {
      stage: 'human_commit_review',
      sourcePaths: [sources.preview.normalizedPatchPath!, sources.preview.stateDiffPath!, sources.preview.finalPath!]
    });
    await runLogger.recordArtifact(runId, evidenceArtifact.relativeMarkdownPath, {
      stage: 'human_commit_review',
      sourcePaths: [evidenceArtifact.relativePath]
    });

    const evidenceMapText = await fileStore.readText(evidenceArtifact.absolutePath);
    const report = buildCommitReview({
      sources,
      paths,
      input,
      runId,
      generatedAt,
      evidenceMap,
      evidenceMapPath: evidenceArtifact.relativePath,
      evidenceMapHash: sha256(evidenceMapText)
    });
    await fileStore.writeJson(reviewArtifact.absolutePath, report, CandidateCommitReviewSchema);
    await fileStore.writeText(reviewArtifact.markdownPath, renderCommitReview(report, evidenceMap));
    await runLogger.recordArtifact(runId, reviewArtifact.relativePath, {
      stage: 'human_commit_review',
      sourcePaths: [evidenceArtifact.relativePath, sources.previewPath]
    });
    await runLogger.recordArtifact(runId, reviewArtifact.relativeMarkdownPath, {
      stage: 'human_commit_review',
      sourcePaths: [reviewArtifact.relativePath]
    });
    await runLogger.recordEvent(runId, 'CODEX_CANDIDATE_COMMIT_REVIEW_CREATED', {
      stage: 'human_commit_review',
      chapterNumber: input.chapterNumber,
      relatedArtifactPaths: [reviewArtifact.relativePath, evidenceArtifact.relativePath],
      payload: {
        overallDecision: report.overallDecision,
        mutationCount: report.changes.length,
        highRiskChangeCount: report.highRiskChanges.length,
        requiredHumanDecisionCount: report.requiredHumanDecisions.length,
        codexInvoked: false,
        storyStateMutated: false,
        queueMutated: false,
        commitApprovalGenerated: false
      }
    });
    await assertProtectedUnchanged(paths, fileStore, input.chapterNumber, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return {
      runId,
      reviewPath: reviewArtifact.relativePath,
      reviewMarkdownPath: reviewArtifact.relativeMarkdownPath,
      evidenceMapPath: evidenceArtifact.relativePath,
      evidenceMapMarkdownPath: evidenceArtifact.relativeMarkdownPath,
      report,
      evidenceMap
    };
  } catch (error) {
    await runLogger.recordError(runId, { code: error instanceof AppError ? error.code : 'CODEX_CANDIDATE_COMMIT_REVIEW_FAILED', message: getErrorMessage(error), recoverable: false });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

async function loadReviewSources(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: ReviewCodexCandidateCommitInput
): Promise<ReviewSources> {
  const previewArtifact = await resolvePreview(paths, fileStore, input.chapterNumber, input.preview ?? 'latest');
  const previewText = await fileStore.readText(previewArtifact.absolutePath);
  const preview = CodexCandidatePreviewReportSchema.parse(JSON.parse(previewText));
  if (!preview.previewComplete || preview.recommendedNextStep !== 'human_commit_review' || preview.storyStateMutated || preview.queueCommitted) {
    throw stale('Candidate preview is not a complete, uncommitted human-review input.');
  }
  if (preview.chapterNumber !== input.chapterNumber || preview.projectId !== input.projectId) {
    throw stale('Candidate preview project or chapter does not match the requested review.');
  }
  const requiredPaths = [preview.finalPath, preview.patchProposalPath, preview.normalizedPatchPath, preview.stateDiffPath];
  if (requiredPaths.some((artifactPath) => artifactPath === null)) throw stale('Candidate preview is missing a required final, patch, or state diff artifact.');

  const missionPath = relativeChapterArtifact(input.chapterNumber, 'mission.json');
  const selectedPlanPath = relativeChapterArtifact(input.chapterNumber, 'selected_plan.md');
  const [
    candidateText,
    adoptedDraftText,
    finalText,
    proposalText,
    normalizedPatchText,
    stateDiffText,
    completenessText,
    missionText,
    selectedPlanText,
    storyStateText,
    queueText
  ] = await Promise.all([
    readRequired(paths, fileStore, preview.candidatePath),
    readRequired(paths, fileStore, preview.adoptedDraftPath),
    readRequired(paths, fileStore, preview.finalPath!),
    readRequired(paths, fileStore, preview.patchProposalPath!),
    readRequired(paths, fileStore, preview.normalizedPatchPath!),
    readRequired(paths, fileStore, preview.stateDiffPath!),
    readRequired(paths, fileStore, preview.completenessReportPath),
    readRequired(paths, fileStore, missionPath),
    readRequired(paths, fileStore, selectedPlanPath),
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue())
  ]);
  const storyState = StoryStateSchema.parse(JSON.parse(storyStateText));
  const queue = ChapterQueueSchema.parse(JSON.parse(queueText));
  const normalizedPatch = CanonPatchSchema.parse(JSON.parse(normalizedPatchText));
  CanonPatchSchema.parse(JSON.parse(proposalText));
  const stateDiff = StateDiffReportSchema.parse(JSON.parse(stateDiffText));
  const completeness = CodexPreviewCompletenessReportSchema.parse(JSON.parse(completenessText));
  const mission = ChapterMissionSchema.parse(JSON.parse(missionText));
  const queueChapter = queue.chapters.find((chapter) => chapter.chapterNumber === input.chapterNumber);

  const hashesValid =
    preview.candidateHash === sha256(candidateText) &&
    preview.adoptedDraftHash === sha256(adoptedDraftText) &&
    preview.candidateHash === preview.adoptedDraftHash &&
    sha256(finalText) === preview.adoptedDraftHash &&
    preview.sourceStateHash === sha256(storyStateText) &&
    preview.sourceQueueHash === sha256(queueText);
  if (!hashesValid) throw stale('Candidate preview source hash chain no longer matches the current project artifacts.');
  if (!completeness.complete || completeness.storyStateMutated || completeness.latestCommittedChapterBefore !== completeness.latestCommittedChapterAfter) {
    throw stale('Candidate preview completeness report is not eligible for commit review.');
  }
  if (storyState.latestCommittedChapter !== input.chapterNumber - 1 || normalizedPatch.chapterNumber !== input.chapterNumber || normalizedPatch.latestCommittedChapter !== input.chapterNumber) {
    throw stale('Story State or normalized patch chapter boundary changed after preview.');
  }
  if (queueChapter === undefined || queueChapter.status === 'committed') throw stale('Chapter queue no longer represents an uncommitted review chapter.');
  if (stateDiff.patchPath !== preview.normalizedPatchPath || stateDiff.summary.totalChanges !== stateDiff.changes.length || stateDiff.unsafeToCommit) {
    throw stale('State diff no longer matches the conflict-free normalized patch preview.');
  }

  return {
    previewPath: previewArtifact.relativePath,
    preview,
    candidateText,
    adoptedDraftText,
    finalText,
    proposalText,
    normalizedPatchText,
    normalizedPatch,
    stateDiffText,
    stateDiff,
    completenessText,
    missionText,
    mission,
    selectedPlanText,
    storyStateText,
    storyState,
    queueText
  };
}

function buildEvidenceMap(input: {
  sources: ReviewSources;
  paths: ProjectPaths;
  input: ReviewCodexCandidateCommitInput;
  runId: string;
  generatedAt: string;
}): CandidatePatchEvidenceMap {
  const { sources } = input;
  const paragraphs = parseMarkdownEvidenceParagraphs(sources.finalText).filter((paragraph) => !paragraph.text.startsWith('#'));
  const missionGoals = sources.mission.requiredObjectives.map((objective) => objective.text);
  const planItems = sources.selectedPlanText.split(/\r?\n/).map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
  const mutations = sources.stateDiff.changes.map((change, index) => buildMutation({
    change,
    index,
    chapterNumber: input.input.chapterNumber,
    finalPath: sources.preview.finalPath!,
    paragraphs,
    missionGoals,
    planItems,
    storyState: sources.storyState
  }));
  return CandidatePatchEvidenceMapSchema.parse({
    mapId: `candidate_patch_evidence_ch${pad(input.input.chapterNumber)}_${input.runId}`,
    projectId: input.paths.projectId,
    chapterNumber: input.input.chapterNumber,
    runId: input.runId,
    generatedAt: input.generatedAt,
    finalPreviewPath: sources.preview.finalPath,
    finalPreviewHash: sha256(sources.finalText),
    normalizedPatchPath: sources.preview.normalizedPatchPath,
    normalizedPatchHash: sha256(sources.normalizedPatchText),
    stateDiffPath: sources.preview.stateDiffPath,
    stateDiffHash: sha256(sources.stateDiffText),
    missionPath: relativeChapterArtifact(input.input.chapterNumber, 'mission.json'),
    missionHash: sha256(sources.missionText),
    selectedPlanPath: relativeChapterArtifact(input.input.chapterNumber, 'selected_plan.md'),
    selectedPlanHash: sha256(sources.selectedPlanText),
    diffChangeCount: sources.stateDiff.changes.length,
    mutationCount: mutations.length,
    allDiffChangesCovered: mutations.length === sources.stateDiff.changes.length,
    mutations,
    codexInvoked: false,
    storyStateMutated: false,
    queueMutated: false
  });
}

function buildMutation(input: {
  change: StateDiffChange;
  index: number;
  chapterNumber: number;
  finalPath: string;
  paragraphs: ReturnType<typeof parseMarkdownEvidenceParagraphs>;
  missionGoals: string[];
  planItems: string[];
  storyState: StoryState;
}): CandidatePatchEvidenceMutation {
  const mutationType = mutationTypeForPath(input.change.path);
  const evidenceQueries = evidenceQueriesForChange(input.change, mutationType);
  const evidence = findEvidence(input.paragraphs, evidenceQueries);
  const relatedMissionGoals = findRelatedTexts(input.missionGoals, evidenceQueries);
  const relatedPlanItems = findRelatedTexts(input.planItems, evidenceQueries);
  const legalStateTransition = isLegalStateTransition(input.change, mutationType, input.chapterNumber);
  const duplicateRisk = hasDuplicateRisk(input.change, mutationType, input.storyState);
  const prematureResolutionRisk = hasPrematureResolutionRisk(input.change, mutationType, evidence.snippets.length > 0);
  const readerLeakRisk = false;
  const characterKnowledgeRisk = false;
  const decision = decideMutation({ change: input.change, supportedByFinal: evidence.snippets.length > 0, legalStateTransition, duplicateRisk, prematureResolutionRisk, readerLeakRisk, characterKnowledgeRisk });
  return {
    mutationId: `mutation_${String(input.index + 1).padStart(3, '0')}`,
    diffChangeIndex: input.index,
    mutationType,
    statePath: input.change.path,
    beforeValue: input.change.before ?? null,
    afterValue: input.change.after ?? null,
    riskLevel: input.change.riskLevel,
    sourceFinalPath: input.finalPath,
    evidenceSnippets: evidence.snippets,
    evidenceParagraphIndexes: evidence.paragraphIndexes,
    evidenceHashes: evidence.snippets.map(sha256),
    relatedMissionGoals,
    relatedPlanItems,
    supportedByFinal: evidence.snippets.length > 0,
    supportedByMission: relatedMissionGoals.length > 0,
    supportedBySelectedPlan: relatedPlanItems.length > 0,
    legalStateTransition,
    duplicateRisk,
    prematureResolutionRisk,
    readerLeakRisk,
    characterKnowledgeRisk,
    decision,
    decisionReason: decisionReason(decision, input.change, evidence.snippets.length > 0)
  };
}

function buildCommitReview(input: {
  sources: ReviewSources;
  paths: ProjectPaths;
  input: ReviewCodexCandidateCommitInput;
  runId: string;
  generatedAt: string;
  evidenceMap: CandidatePatchEvidenceMap;
  evidenceMapPath: string;
  evidenceMapHash: string;
}): CandidateCommitReview {
  const changes: CandidateCommitReviewChange[] = input.evidenceMap.mutations.map((mutation) => ({
    mutationId: mutation.mutationId,
    mutationType: mutation.mutationType,
    statePath: mutation.statePath,
    riskLevel: mutation.riskLevel,
    decision: mutation.decision,
    decisionReason: mutation.decisionReason,
    evidenceMapPath: input.evidenceMapPath
  }));
  const highRiskChanges = changes.filter((change) => change.riskLevel === 'high' || change.riskLevel === 'critical');
  const requiredHumanDecisions = changes.filter((change) => change.decision === 'needs_human_review').map((change) => ({
    mutationId: change.mutationId,
    statePath: change.statePath,
    question: humanDecisionQuestion(change),
    recommendedDecision: change.decision,
    decision: null,
    rationaleRequired: true
  }));
  const narrativeDetails = input.evidenceMap.mutations
    .filter((mutation) => mutation.mutationType === 'narrative_debt')
    .map(buildNarrativeDebtDetail);
  const proposalNormalizationEquivalent = JSON.stringify(CanonPatchSchema.parse(JSON.parse(input.sources.proposalText))) === JSON.stringify(input.sources.normalizedPatch);
  const patchReview = {
    proposalSchemaValid: true as const,
    normalizedSchemaValid: true as const,
    proposalNormalizationEquivalent,
    patchMutationCount: input.sources.stateDiff.changes.length,
    decision: proposalNormalizationEquivalent ? 'approve' as const : 'needs_human_review' as const,
    notes: [proposalNormalizationEquivalent ? 'Provider proposal and normalized patch are semantically equivalent.' : 'Normalization changed patch semantics and requires human review.']
  };
  const conflictReview = {
    conflictCheckPassed: input.sources.preview.conflictCheckPassed,
    conflictCount: input.sources.preview.conflictCheckPassed ? 0 : 1,
    conflictReportPath: input.sources.preview.conflictReportPath,
    decision: input.sources.preview.conflictCheckPassed ? 'approve' as const : 'reject' as const,
    decisionReason: input.sources.preview.conflictCheckPassed
      ? 'The complete D3 preview recorded a passing conflict check with no conflict report.'
      : 'The D3 preview conflict gate did not pass.'
  };
  const hasRejected = changes.some((change) => change.decision === 'reject');
  const hasModifyRequired = changes.some((change) => change.decision === 'modify_required') || !proposalNormalizationEquivalent;
  const overallDecision = hasRejected ? 'rejected' : hasModifyRequired ? 'changes_required' : 'human_review_incomplete';
  const recommendedNextStep = hasRejected ? 'reject_candidate' : hasModifyRequired ? 'changes_required' : 'record_human_commit_decisions';
  return CandidateCommitReviewSchema.parse({
    reviewId: `candidate_commit_review_ch${pad(input.input.chapterNumber)}_${input.runId}`,
    projectId: input.paths.projectId,
    chapterNumber: input.input.chapterNumber,
    runId: input.runId,
    generatedAt: input.generatedAt,
    candidatePath: input.sources.preview.candidatePath,
    adoptedDraftPath: input.sources.preview.adoptedDraftPath,
    finalPreviewPath: input.sources.preview.finalPath,
    patchProposalPath: input.sources.preview.patchProposalPath,
    normalizedPatchPath: input.sources.preview.normalizedPatchPath,
    conflictReportPath: input.sources.preview.conflictReportPath,
    stateDiffPath: input.sources.preview.stateDiffPath,
    completenessReportPath: input.sources.preview.completenessReportPath,
    candidatePreviewReportPath: input.sources.previewPath,
    evidenceMapPath: input.evidenceMapPath,
    evidenceMapHash: input.evidenceMapHash,
    sourceStateHash: sha256(input.sources.storyStateText),
    sourceQueueHash: sha256(input.sources.queueText),
    sourceDraftHash: sha256(input.sources.adoptedDraftText),
    finalPreviewHash: sha256(input.sources.finalText),
    normalizedPatchHash: sha256(input.sources.normalizedPatchText),
    stateDiffHash: sha256(input.sources.stateDiffText),
    changes,
    highRiskChanges,
    canonFactReview: sectionReview(input.evidenceMap.mutations, 'canon_fact'),
    timelineReview: sectionReview(input.evidenceMap.mutations, 'timeline_event'),
    narrativeDebtReview: { ...sectionReview(input.evidenceMap.mutations, 'narrative_debt'), details: narrativeDetails },
    foreshadowingReview: sectionReview(input.evidenceMap.mutations, 'foreshadowing'),
    characterStateReview: sectionReview(input.evidenceMap.mutations, 'character_state'),
    readerStateReview: sectionReview(input.evidenceMap.mutations, 'reader_state'),
    relationshipReview: sectionReview(input.evidenceMap.mutations, 'relationship'),
    latestCommittedChapterReview: sectionReview(input.evidenceMap.mutations, 'latest_committed_chapter'),
    patchReview,
    conflictReview,
    overallDecision,
    blockingReasons: requiredHumanDecisions.map((decision) => `Human decision required for ${decision.statePath}.`),
    warnings: input.evidenceMap.mutations.filter((mutation) => !mutation.supportedByFinal).map((mutation) => `${mutation.statePath} has no direct short-text evidence match in final preview.`),
    requiredHumanDecisions,
    recommendedNextStep,
    commitApprovalGenerated: false,
    codexInvoked: false,
    canonicalArtifactsGenerated: false,
    snapshotCreated: false,
    storyStateMutated: false,
    queueMutated: false
  });
}

function buildNarrativeDebtDetail(mutation: CandidatePatchEvidenceMutation): CandidateNarrativeDebtDetail {
  const before = asRecord(mutation.beforeValue);
  const after = asRecord(mutation.afterValue);
  const payload = asRecord(after.payload);
  const action = typeof after.action === 'string' ? after.action : 'unknown';
  const statusBefore = typeof before.status === 'string' ? before.status : 'not_present';
  const statusAfter = debtStatusAfter(statusBefore, action);
  const debtId = typeof after.debtId === 'string' ? after.debtId : typeof before.id === 'string' ? before.id : mutation.statePath.split('/').at(-1) ?? mutation.mutationId;
  const debtName = typeof before.promise === 'string' ? before.promise : typeof payload.text === 'string' ? payload.text : debtId;
  return {
    mutationId: mutation.mutationId,
    debtId,
    debtName,
    statusBefore,
    statusAfter,
    transitionAllowed: mutation.legalStateTransition,
    evidenceInFinal: mutation.evidenceSnippets,
    payoffStrength: debtPayoffStrength(action),
    fullyResolvedInText: action === 'pay' && mutation.supportedByFinal,
    partiallyPaidInText: action === 'partially_pay' && mutation.supportedByFinal,
    escalationSupported: action === 'escalate' && mutation.supportedByFinal,
    plannedPayoffChapter: typeof before.payoffTargetChapter === 'number' ? before.payoffTargetChapter : null,
    prematureResolutionRisk: mutation.prematureResolutionRisk,
    downstreamPlanningImpact: [debtPlanningImpact(action, debtId)],
    decision: 'needs_human_review',
    decisionReason: `Narrative debt transition ${statusBefore} -> ${statusAfter} is legal=${String(mutation.legalStateTransition)} but requires explicit human confirmation of payoff strength.`
  };
}

function sectionReview(mutations: CandidatePatchEvidenceMutation[], type: CandidateCommitMutationType): CandidateCommitSectionReview {
  const relevant = mutations.filter((mutation) => mutation.mutationType === type);
  const counts = {
    approved: relevant.filter((mutation) => mutation.decision === 'approve').length,
    rejected: relevant.filter((mutation) => mutation.decision === 'reject').length,
    modifyRequired: relevant.filter((mutation) => mutation.decision === 'modify_required').length,
    needsHumanReview: relevant.filter((mutation) => mutation.decision === 'needs_human_review').length
  };
  const decision = relevant.length === 0 ? 'not_applicable'
    : counts.rejected > 0 ? 'reject'
      : counts.modifyRequired > 0 ? 'modify_required'
        : counts.needsHumanReview > 0 ? 'needs_human_review'
          : 'approve';
  return {
    mutationIds: relevant.map((mutation) => mutation.mutationId),
    total: relevant.length,
    ...counts,
    decision,
    notes: relevant.length === 0 ? ['No mutations of this type are present.'] : [`Reviewed ${relevant.length} ${type} mutation(s).`]
  };
}

function findEvidence(paragraphs: ReturnType<typeof parseMarkdownEvidenceParagraphs>, queries: string[]) {
  const scored = paragraphs
    .filter((paragraph) => normalizeEvidence(paragraph.text).length >= 8)
    .map((paragraph) => ({ paragraph, score: Math.max(0, ...queries.map((query) => similarity(query, paragraph.text))) }))
    .filter((item) => item.score >= 0.12)
    .sort((left, right) => right.score - left.score || left.paragraph.paragraphIndex - right.paragraph.paragraphIndex)
    .slice(0, 3)
    .sort((left, right) => left.paragraph.paragraphIndex - right.paragraph.paragraphIndex);
  return {
    snippets: scored.map((item) => shorten(item.paragraph.text)),
    paragraphIndexes: scored.map((item) => item.paragraph.paragraphIndex)
  };
}

function evidenceQueriesForChange(change: StateDiffChange, type: CandidateCommitMutationType): string[] {
  const before = asRecord(change.before);
  const after = asRecord(change.after);
  const payload = asRecord(after.payload);
  const values = type === 'canon_fact'
    ? [after.text]
    : type === 'timeline_event'
      ? [after.summary, after.timestampLabel, after.location]
      : type === 'character_state'
        ? [change.after, change.explanation]
        : type === 'narrative_debt'
          ? [payload.text, before.promise, before.readerQuestion]
          : type === 'foreshadowing'
            ? [payload.surfaceDetail, payload.hiddenMeaning]
            : type === 'reader_state'
              ? stringsFromValue(change.after)
              : type === 'relationship'
                ? [after.evidence, after.change]
                : [];
  return values.flatMap(stringsFromValue).filter((value) => normalizeEvidence(value).length >= 4);
}

function findRelatedTexts(texts: string[], queries: string[]): string[] {
  return texts
    .map((text) => ({ text, score: Math.max(0, ...queries.map((query) => similarity(query, text))) }))
    .filter((item) => item.score >= 0.12)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.text);
}

function stringsFromValue(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsFromValue);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsFromValue);
  return [];
}

function similarity(left: string, right: string): number {
  const leftPairs = bigrams(normalizeEvidence(left));
  const rightPairs = bigrams(normalizeEvidence(right));
  if (leftPairs.size === 0 || rightPairs.size === 0) return 0;
  let overlap = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1;
  return overlap / Math.min(leftPairs.size, rightPairs.size);
}

function bigrams(value: string): Set<string> {
  const output = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) output.add(value.slice(index, index + 2));
  return output;
}

function normalizeEvidence(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function mutationTypeForPath(statePath: string): CandidateCommitMutationType {
  if (statePath.startsWith('/canonFacts/')) return 'canon_fact';
  if (statePath.startsWith('/timeline/')) return 'timeline_event';
  if (statePath.startsWith('/characters/')) return 'character_state';
  if (statePath.startsWith('/narrativeDebts/')) return 'narrative_debt';
  if (statePath.startsWith('/foreshadowing/')) return 'foreshadowing';
  if (statePath.startsWith('/readerState')) return 'reader_state';
  if (statePath.startsWith('/relationship')) return 'relationship';
  if (statePath === '/latestCommittedChapter') return 'latest_committed_chapter';
  return 'other';
}

function isLegalStateTransition(change: StateDiffChange, type: CandidateCommitMutationType, chapterNumber: number): boolean {
  if (type === 'latest_committed_chapter') return change.after === chapterNumber && change.before === chapterNumber - 1;
  if (type !== 'narrative_debt') return true;
  const before = asRecord(change.before);
  const after = asRecord(change.after);
  const statusBefore = typeof before.status === 'string' ? before.status : 'not_present';
  const action = typeof after.action === 'string' ? after.action : 'unknown';
  if (action === 'create') return statusBefore === 'not_present';
  const allowed: Record<string, string[]> = {
    open: ['maintain', 'escalate', 'partially_pay', 'pay', 'cancel'],
    escalated: ['maintain', 'partially_pay', 'pay', 'cancel'],
    partially_paid: ['maintain', 'escalate', 'pay', 'cancel'],
    resolved: [],
    paid: [],
    cancelled: []
  };
  return (allowed[statusBefore] ?? []).includes(action);
}

function hasDuplicateRisk(change: StateDiffChange, type: CandidateCommitMutationType, state: StoryState): boolean {
  const after = asRecord(change.after);
  const text = typeof after.text === 'string' ? after.text : undefined;
  const summary = typeof after.summary === 'string' ? after.summary : undefined;
  if (type === 'canon_fact' && text !== undefined) return state.canonFacts.some((fact) => normalizeEvidence(fact.text) === normalizeEvidence(text));
  if (type === 'timeline_event' && summary !== undefined) return state.timeline.some((event) => normalizeEvidence(event.summary) === normalizeEvidence(summary));
  return false;
}

function hasPrematureResolutionRisk(change: StateDiffChange, type: CandidateCommitMutationType, supportedByFinal: boolean): boolean {
  if (type !== 'narrative_debt') return false;
  const action = asRecord(change.after).action;
  return action === 'pay' && !supportedByFinal;
}

function decideMutation(input: {
  change: StateDiffChange;
  supportedByFinal: boolean;
  legalStateTransition: boolean;
  duplicateRisk: boolean;
  prematureResolutionRisk: boolean;
  readerLeakRisk: boolean;
  characterKnowledgeRisk: boolean;
}): CandidateCommitMutationDecision {
  if (!input.legalStateTransition) return 'reject';
  if (input.duplicateRisk || input.prematureResolutionRisk || input.readerLeakRisk || input.characterKnowledgeRisk) return 'modify_required';
  if (input.change.riskLevel === 'high' || input.change.riskLevel === 'critical') return 'needs_human_review';
  return input.supportedByFinal ? 'approve' : 'needs_human_review';
}

function decisionReason(decision: CandidateCommitMutationDecision, change: StateDiffChange, supportedByFinal: boolean): string {
  if (decision === 'reject') return `State transition at ${change.path} is not legal.`;
  if (decision === 'modify_required') return `Mutation at ${change.path} lacks sufficient direct evidence or has a detected safety risk.`;
  if (decision === 'needs_human_review') return `High-risk mutation at ${change.path} requires an explicit one-time human decision.`;
  return `Mutation at ${change.path} has short final-text evidence and passed deterministic transition checks (supportedByFinal=${String(supportedByFinal)}).`;
}

function debtStatusAfter(before: string, action: string): string {
  if (action === 'create') return 'open';
  if (action === 'maintain') return before;
  if (action === 'escalate') return 'escalated';
  if (action === 'partially_pay') return 'partially_paid';
  if (action === 'pay') return 'resolved';
  if (action === 'cancel') return 'cancelled';
  return 'unknown';
}

function debtPayoffStrength(action: string): CandidateNarrativeDebtDetail['payoffStrength'] {
  if (action === 'maintain') return 'maintained';
  if (action === 'escalate') return 'escalated';
  if (action === 'partially_pay') return 'partial';
  if (action === 'pay') return 'full';
  return 'none';
}

function debtPlanningImpact(action: string, debtId: string): string {
  if (action === 'pay') return `${debtId} would leave the downstream open-debt queue and must not be reintroduced without a new debt.`;
  if (action === 'partially_pay') return `${debtId} remains open for later payoff with reduced unresolved scope.`;
  if (action === 'escalate') return `${debtId} remains unresolved with increased downstream urgency.`;
  return `${debtId} remains available to downstream chapter planning.`;
}

function humanDecisionQuestion(change: CandidateCommitReviewChange): string {
  if (change.mutationType === 'narrative_debt') return `Approve the proposed narrative debt transition at ${change.statePath} after reviewing textual payoff strength and downstream impact?`;
  if (change.mutationType === 'latest_committed_chapter') return `Approve advancing latestCommittedChapter only in a later controlled local commit after all mutation decisions pass?`;
  return `Approve high-risk mutation ${change.statePath}?`;
}

function renderEvidenceMap(report: CandidatePatchEvidenceMap): string {
  const lines = [
    '# Candidate Patch Evidence Map', '',
    `mutationCount: ${report.mutationCount}`,
    `allDiffChangesCovered: ${String(report.allDiffChangesCovered)}`,
    `finalPreview: ${report.finalPreviewPath}`,
    `normalizedPatch: ${report.normalizedPatchPath}`,
    `stateDiff: ${report.stateDiffPath}`, ''
  ];
  for (const mutation of report.mutations) {
    lines.push(`## ${mutation.mutationId} ${mutation.statePath}`, '');
    lines.push(`- type: ${mutation.mutationType}`);
    lines.push(`- risk: ${mutation.riskLevel}`);
    lines.push(`- decision: ${mutation.decision}`);
    lines.push(`- legalStateTransition: ${String(mutation.legalStateTransition)}`);
    lines.push(`- evidence paragraphs: ${mutation.evidenceParagraphIndexes.join(', ') || 'none'}`);
    for (const snippet of mutation.evidenceSnippets) lines.push(`  - ${snippet}`);
    lines.push(`- reason: ${mutation.decisionReason}`, '');
  }
  lines.push('No Codex call, Story State mutation, queue mutation, snapshot, canonical artifact, or commit approval occurred.');
  return `${lines.join('\n')}\n`;
}

function renderCommitReview(report: CandidateCommitReview, evidenceMap: CandidatePatchEvidenceMap): string {
  const lines = [
    '# Candidate Commit Review', '',
    `overallDecision: ${report.overallDecision}`,
    `recommendedNextStep: ${report.recommendedNextStep}`,
    `changesReviewed: ${report.changes.length}`,
    `highRiskChanges: ${report.highRiskChanges.length}`,
    `requiredHumanDecisions: ${report.requiredHumanDecisions.length}`,
    `evidenceMap: ${report.evidenceMapPath}`, '',
    '## Patch and conflict gates', '',
    `- proposalSchemaValid: ${String(report.patchReview.proposalSchemaValid)}`,
    `- normalizedSchemaValid: ${String(report.patchReview.normalizedSchemaValid)}`,
    `- proposalNormalizationEquivalent: ${String(report.patchReview.proposalNormalizationEquivalent)}`,
    `- conflictCheckPassed: ${String(report.conflictReview.conflictCheckPassed)}`,
    `- conflictCount: ${report.conflictReview.conflictCount}`, '',
    '## High-risk decisions', ''
  ];
  if (report.requiredHumanDecisions.length === 0) lines.push('- none');
  for (const decision of report.requiredHumanDecisions) lines.push(`- [ ] ${decision.mutationId} ${decision.statePath}: ${decision.question}`);
  lines.push('', '## Narrative debt review', '');
  for (const debt of report.narrativeDebtReview.details) {
    lines.push(`- ${debt.debtId}: ${debt.statusBefore} -> ${debt.statusAfter}; legal=${String(debt.transitionAllowed)}; decision=${debt.decision}`);
    lines.push(`  ${debt.decisionReason}`);
  }
  lines.push('', '## All mutations', '');
  for (const change of report.changes) {
    const evidence = evidenceMap.mutations.find((mutation) => mutation.mutationId === change.mutationId)!;
    lines.push(`- ${change.mutationId} ${change.statePath}: ${change.decision} (risk=${change.riskLevel}, evidence=${evidence.evidenceParagraphIndexes.join(',') || 'none'})`);
  }
  lines.push('', 'No commit approval was generated. No canonical state or chapter artifact was modified.');
  return `${lines.join('\n')}\n`;
}

async function resolvePreview(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, selector: string) {
  if (selector !== 'latest') {
    const relativePath = selector.split(/[\\/]+/).join(path.sep);
    if (!(await fileStore.exists(paths.projectArtifact(relativePath)))) throw stale(`Candidate preview does not exist: ${selector}`);
    return { absolutePath: paths.projectArtifact(relativePath), relativePath };
  }
  const artifacts = await listVersionedArtifacts(paths, fileStore, chapterNumber, 'codex_candidate_preview_report');
  const latest = artifacts.at(-1);
  if (latest === undefined) throw stale('No candidate preview report is available.');
  return latest;
}

async function nextVersionedArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  const artifacts = await listVersionedArtifacts(paths, fileStore, chapterNumber, baseName);
  const version = (artifacts.at(-1)?.version ?? 0) + 1;
  const jsonFile = `${baseName}_v${version}.json`;
  const mdFile = `${baseName}_v${version}.md`;
  return {
    absolutePath: paths.chapterArtifact(chapterNumber, jsonFile),
    markdownPath: paths.chapterArtifact(chapterNumber, mdFile),
    relativePath: relativeChapterArtifact(chapterNumber, jsonFile),
    relativeMarkdownPath: relativeChapterArtifact(chapterNumber, mdFile)
  };
}

async function listVersionedArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  if (!(await fileStore.exists(paths.chapterDir(chapterNumber)))) return [];
  const pattern = new RegExp(`^${escapeRegExp(baseName)}_v(\\d+)\\.json$`);
  const artifacts = [];
  for (const entry of await fileStore.list(paths.chapterDir(chapterNumber))) {
    const match = pattern.exec(entry);
    if (match === null) continue;
    artifacts.push({
      version: Number.parseInt(match[1]!, 10),
      absolutePath: paths.chapterArtifact(chapterNumber, entry),
      relativePath: relativeChapterArtifact(chapterNumber, entry)
    });
  }
  return artifacts.sort((left, right) => left.version - right.version);
}

async function readRequired(paths: ProjectPaths, fileStore: FileStore, artifactPath: string): Promise<string> {
  const absolutePath = paths.projectArtifact(artifactPath.split(/[\\/]+/).join(path.sep));
  if (!(await fileStore.exists(absolutePath))) throw stale(`Required preview artifact is missing: ${artifactPath}`);
  return fileStore.readText(absolutePath);
}

async function captureProtected(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number) {
  return {
    storyState: await fileStore.readText(paths.storyState()),
    queue: await fileStore.readText(paths.chapterQueue()),
    draft: await fileStore.readText(paths.chapterArtifact(chapterNumber, 'draft_v2.md')),
    final: await fileStore.readText(paths.chapterArtifact(chapterNumber, 'final_candidate_preview_v2.md')),
    patch: await fileStore.readText(paths.chapterArtifact(chapterNumber, 'canon_patch_codex_normalized_v2.json')),
    snapshots: (await fileStore.list(paths.snapshotsDir())).sort()
  };
}

async function assertProtectedUnchanged(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, before: Awaited<ReturnType<typeof captureProtected>>) {
  const after = await captureProtected(paths, fileStore, chapterNumber);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new AppError('CODEX_CANDIDATE_COMMIT_REVIEW_SIDE_EFFECT', 'Commit review changed a protected Story State, queue, draft, preview, patch, or snapshot artifact.', 1);
  }
}

function stale(message: string): AppError {
  return new AppError('CODEX_CANDIDATE_COMMIT_REVIEW_STALE', message, 2);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shorten(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= MAX_EVIDENCE_SNIPPET ? normalized : `${normalized.slice(0, MAX_EVIDENCE_SNIPPET - 3)}...`;
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.join('chapters', `chapter_${pad(chapterNumber)}`, fileName);
}

function pad(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
