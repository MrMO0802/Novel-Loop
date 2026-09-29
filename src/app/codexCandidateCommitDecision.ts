import path from 'node:path';

import { sha256 } from './codexDiagnosticsEvidenceRules.js';
import { RunLogger } from '../logging/RunLogger.js';
import {
  CandidateCommitApprovalSchema,
  CandidateCommitMutationDecisionSchema,
  CandidateCommitReviewFinalizedSchema,
  CandidateCommitReviewSchema,
  CandidatePatchEvidenceMapSchema,
  CandidatePatchNoopAnalysisSchema,
  CodexCandidatePreviewReportSchema,
  CodexPreviewCompletenessReportSchema,
  ChapterQueueSchema,
  StateDiffReportSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  CandidateCommitApproval,
  CandidateCommitFinalizedDecision,
  CandidateCommitMutationDecision,
  CandidateCommitMutationDecisionValue,
  CandidateCommitMutationOrigin,
  CandidateCommitMutationType,
  CandidateCommitReview,
  CandidateCommitReviewFinalized,
  CandidateNarrativeDebtHumanAssessment,
  CandidatePatchEvidenceMap,
  CandidatePatchNoopAnalysis,
  CandidatePatchNoopMutation,
  StateDiffReport
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

const DEFAULT_PROJECTS_ROOT = './projects';

export interface AnalyzeCandidatePatchNoopsInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  review?: string;
  runId?: string;
}

export interface DecideCandidateCommitChangeInput extends AnalyzeCandidatePatchNoopsInput {
  mutationId: string;
  decision: CandidateCommitMutationDecisionValue;
  note: string;
}

export interface FinalizeCandidateCommitReviewInput extends AnalyzeCandidatePatchNoopsInput {}

export interface ApproveCandidateCommitInput extends AnalyzeCandidatePatchNoopsInput {
  confirm: boolean;
}

export interface CandidatePatchMutationNoopInput {
  mutationId: string;
  statePath: string;
  mutationType: CandidateCommitMutationType;
  beforeValue: unknown;
  afterValue: unknown;
}

interface DecisionSources {
  reviewPath: string;
  review: CandidateCommitReview;
  evidenceMap: CandidatePatchEvidenceMap;
  stateDiff: StateDiffReport;
  storyStateText: string;
  queueText: string;
  finalText: string;
  patchText: string;
  diffText: string;
}

interface VersionedArtifact {
  version: number;
  absolutePath: string;
  relativePath: string;
  markdownPath: string;
  relativeMarkdownPath: string;
}

export function analyzeCandidatePatchMutationNoop(input: CandidatePatchMutationNoopInput): CandidatePatchNoopMutation {
  if (input.mutationType === 'narrative_debt') {
    const before = asRecord(input.beforeValue);
    const after = asRecord(input.afterValue);
    const payload = asRecord(after.payload);
    if (after.action === 'maintain') {
      const changedFields: string[] = [];
      if (typeof payload.payoffTargetChapter === 'number' && payload.payoffTargetChapter !== before.payoffTargetChapter) {
        changedFields.push('payoffTargetChapter');
      }
      if (Array.isArray(payload.payoffHistory) && payload.payoffHistory.length > 0) {
        changedFields.push('payoffHistory');
      }
      const metadataChanged = changedFields.length > 0;
      return {
        mutationId: input.mutationId,
        statePath: input.statePath,
        beforeValue: input.beforeValue,
        afterValue: input.afterValue,
        semanticNoop: !metadataChanged,
        metadataChanged,
        changedFields,
        recommendation: metadataChanged ? 'retain' : 'remove-required'
      };
    }
  }

  const semanticNoop = stableJson(input.beforeValue) === stableJson(input.afterValue);
  return {
    mutationId: input.mutationId,
    statePath: input.statePath,
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    semanticNoop,
    metadataChanged: false,
    changedFields: [],
    recommendation: semanticNoop ? 'modify-required' : 'retain'
  };
}

export async function analyzeCandidatePatchNoops(
  input: AnalyzeCandidatePatchNoopsInput,
  fileStore = new FileStore()
): Promise<{ runId: string; reportPath: string; markdownPath: string; report: CandidatePatchNoopAnalysis }> {
  const paths = createPaths(input);
  const sources = await loadDecisionSources(paths, fileStore, input.chapterNumber, input.review ?? 'latest');
  const protectedBefore = await captureProtected(paths, fileStore, input.chapterNumber, sources);
  const runId = input.runId ?? `${createRunId()}_candidate_patch_noop_analysis_ch${pad(input.chapterNumber)}`;
  const runLogger = new RunLogger(paths, fileStore);
  await startReadOnlyRun(runLogger, runId, 'codex.analyze-candidate-patch-noops', input.chapterNumber, { review: input.review ?? 'latest' });

  try {
    const artifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_patch_noop_analysis');
    const mutations = sources.evidenceMap.mutations.map((mutation) => analyzeCandidatePatchMutationNoop({
      mutationId: mutation.mutationId,
      statePath: mutation.statePath,
      mutationType: mutation.mutationType,
      beforeValue: mutation.beforeValue,
      afterValue: mutation.afterValue
    }));
    const report = CandidatePatchNoopAnalysisSchema.parse({
      reportId: `candidate_patch_noop_analysis_ch${pad(input.chapterNumber)}_${runId}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      commitReviewPath: sources.reviewPath,
      stateDiffPath: sources.review.stateDiffPath,
      generatedAt: new Date().toISOString(),
      sourceStateHash: sources.review.sourceStateHash,
      sourceQueueHash: sources.review.sourceQueueHash,
      sourceFinalHash: sources.review.finalPreviewHash,
      sourcePatchHash: sources.review.normalizedPatchHash,
      sourceDiffHash: sources.review.stateDiffHash,
      mutationCount: mutations.length,
      semanticNoopCount: mutations.filter((mutation) => mutation.semanticNoop).length,
      mutations,
      storyStateMutated: false,
      queueMutated: false
    });
    await fileStore.writeJson(artifact.absolutePath, report, CandidatePatchNoopAnalysisSchema);
    await fileStore.writeText(artifact.markdownPath, renderNoopAnalysis(report));
    await recordArtifacts(runLogger, runId, 'human_commit_review', artifact, [sources.reviewPath, sources.review.stateDiffPath]);
    await runLogger.recordEvent(runId, 'CODEX_CANDIDATE_PATCH_NOOP_ANALYZED', {
      stage: 'human_commit_review',
      chapterNumber: input.chapterNumber,
      relatedArtifactPaths: [artifact.relativePath],
      payload: { mutationCount: report.mutationCount, semanticNoopCount: report.semanticNoopCount, storyStateMutated: false, queueMutated: false }
    });
    await assertProtectedUnchanged(paths, fileStore, input.chapterNumber, sources, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return { runId, reportPath: artifact.relativePath, markdownPath: artifact.relativeMarkdownPath, report };
  } catch (error) {
    await failRun(runLogger, runId, error, 'CODEX_CANDIDATE_PATCH_NOOP_ANALYSIS_FAILED');
    throw error;
  }
}

export async function decideCandidateCommitChange(
  input: DecideCandidateCommitChangeInput,
  fileStore = new FileStore()
): Promise<{ runId: string; decisionPath: string; record: CandidateCommitMutationDecision }> {
  const paths = createPaths(input);
  const sources = await loadDecisionSources(paths, fileStore, input.chapterNumber, input.review ?? 'latest');
  const protectedBefore = await captureProtected(paths, fileStore, input.chapterNumber, sources);
  const mutation = sources.evidenceMap.mutations.find((candidate) => candidate.mutationId === input.mutationId);
  const reviewChange = sources.review.changes.find((candidate) => candidate.mutationId === input.mutationId);
  if (mutation === undefined || reviewChange === undefined) {
    throw invalid(`Mutation ${input.mutationId} is not part of ${sources.reviewPath}.`);
  }
  const mutationOrigin = originForMutation(mutation.mutationType);
  const noop = analyzeCandidatePatchMutationNoop({
    mutationId: mutation.mutationId,
    statePath: mutation.statePath,
    mutationType: mutation.mutationType,
    beforeValue: mutation.beforeValue,
    afterValue: mutation.afterValue
  });
  validateDecisionChoice(mutationOrigin, noop.semanticNoop, input.decision);

  const existing = await readMutationDecisions(paths, fileStore, input.chapterNumber, sources.reviewPath);
  const prior = effectiveDecisionMap(existing).get(input.mutationId);
  const runId = input.runId ?? `${createRunId()}_candidate_commit_decision_ch${pad(input.chapterNumber)}`;
  const runLogger = new RunLogger(paths, fileStore);
  await startReadOnlyRun(runLogger, runId, 'codex.decide-candidate-commit-change', input.chapterNumber, {
    review: input.review ?? 'latest',
    mutationId: input.mutationId,
    decision: input.decision
  });

  try {
    const artifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_commit_mutation_decision', false);
    const record = CandidateCommitMutationDecisionSchema.parse({
      decisionId: `candidate_commit_mutation_decision_ch${pad(input.chapterNumber)}_${artifact.version}_${runId}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      commitReviewPath: sources.reviewPath,
      mutationId: input.mutationId,
      statePath: mutation.statePath,
      mutationType: mutation.mutationType,
      mutationOrigin,
      decision: input.decision,
      note: input.note,
      operator: 'local_user',
      decidedAt: new Date().toISOString(),
      evidenceMapPath: sources.review.evidenceMapPath,
      sourceStateHash: sources.review.sourceStateHash,
      sourceQueueHash: sources.review.sourceQueueHash,
      sourceFinalHash: sources.review.finalPreviewHash,
      sourcePatchHash: sources.review.normalizedPatchHash,
      sourceDiffHash: sources.review.stateDiffHash,
      supersedesDecisionId: prior?.record.decisionId ?? null,
      active: true,
      semanticNoop: noop.semanticNoop,
      narrativeDebtAssessment: mutation.mutationType === 'narrative_debt'
        ? buildNarrativeDebtAssessment(mutation.beforeValue, mutation.afterValue, mutation.evidenceParagraphIndexes, input.decision, noop.semanticNoop)
        : null,
      storyStateMutated: false,
      queueMutated: false
    });
    await fileStore.writeJson(artifact.absolutePath, record, CandidateCommitMutationDecisionSchema);
    await runLogger.recordArtifact(runId, artifact.relativePath, {
      stage: 'human_commit_review',
      sourcePaths: [sources.reviewPath, sources.review.evidenceMapPath]
    });
    await runLogger.recordEvent(runId, 'CODEX_CANDIDATE_COMMIT_MUTATION_DECIDED', {
      stage: 'human_commit_review',
      chapterNumber: input.chapterNumber,
      relatedArtifactPaths: [artifact.relativePath],
      payload: {
        mutationId: record.mutationId,
        mutationOrigin: record.mutationOrigin,
        decision: record.decision,
        supersedesDecisionId: record.supersedesDecisionId,
        semanticNoop: record.semanticNoop,
        storyStateMutated: false,
        queueMutated: false
      }
    });
    await assertProtectedUnchanged(paths, fileStore, input.chapterNumber, sources, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return { runId, decisionPath: artifact.relativePath, record };
  } catch (error) {
    await failRun(runLogger, runId, error, 'CODEX_CANDIDATE_COMMIT_DECISION_FAILED');
    throw error;
  }
}

export async function finalizeCandidateCommitReview(
  input: FinalizeCandidateCommitReviewInput,
  fileStore = new FileStore()
): Promise<{ runId: string; reviewPath: string; markdownPath: string; report: CandidateCommitReviewFinalized }> {
  const paths = createPaths(input);
  const sources = await loadDecisionSources(paths, fileStore, input.chapterNumber, input.review ?? 'latest');
  const protectedBefore = await captureProtected(paths, fileStore, input.chapterNumber, sources);
  const noop = await readOrCreateNoopAnalysis(input, paths, fileStore, sources);
  const allDecisionArtifacts = await readMutationDecisions(paths, fileStore, input.chapterNumber, sources.reviewPath);
  const effective = effectiveDecisionMap(allDecisionArtifacts);
  const decisions: CandidateCommitFinalizedDecision[] = sources.review.changes.flatMap((change) => {
    const current = effective.get(change.mutationId);
    if (current === undefined) return [];
    return [{
      decisionId: current.record.decisionId,
      decisionPath: current.path,
      mutationId: current.record.mutationId,
      statePath: current.record.statePath,
      mutationType: current.record.mutationType,
      mutationOrigin: current.record.mutationOrigin,
      riskLevel: change.riskLevel,
      decision: current.record.decision,
      note: current.record.note,
      semanticNoop: current.record.semanticNoop,
      supersedesDecisionId: current.record.supersedesDecisionId
    }];
  });
  const unresolvedMutationIds = sources.review.changes.filter((change) => !effective.has(change.mutationId)).map((change) => change.mutationId);
  const rejectedMutationIds = decisions.filter((decision) => decision.decision === 'reject').map((decision) => decision.mutationId);
  const modifyRequiredMutationIds = decisions.filter((decision) => decision.decision === 'modify-required').map((decision) => decision.mutationId);
  const noopMutationIds = noop.report.mutations.filter((mutation) => mutation.semanticNoop).map((mutation) => mutation.mutationId);
  const patchStateMismatchMutationIds = decisions.filter((decision) => {
    const source = effective.get(decision.mutationId)?.record;
    return source?.narrativeDebtAssessment !== null && source?.narrativeDebtAssessment.patchStateMatchesHumanSelection === false;
  }).map((decision) => decision.mutationId);
  const invalidEngine = decisions.filter((decision) => decision.mutationOrigin === 'engine_metadata' && decision.decision !== 'conditional-approve' && decision.decision !== 'reject');
  const invalidBusiness = decisions.filter((decision) => decision.mutationOrigin !== 'engine_metadata' && decision.decision !== 'approve' && decision.decision !== 'reject' && decision.decision !== 'modify-required');
  const overallDecision = rejectedMutationIds.length > 0 ? 'rejected'
    : unresolvedMutationIds.length > 0 ? 'human_review_incomplete'
      : modifyRequiredMutationIds.length > 0 || noopMutationIds.length > 0 || patchStateMismatchMutationIds.length > 0 || invalidEngine.length > 0 || invalidBusiness.length > 0
        ? 'changes_required'
        : 'approved_for_commit';
  const recommendedNextStep = overallDecision === 'rejected' ? 'reject_candidate'
    : overallDecision === 'human_review_incomplete' ? 'record_missing_decisions'
      : overallDecision === 'changes_required' ? 'modify_patch_then_regenerate_preview'
        : 'approve_candidate_commit';
  const runId = input.runId ?? `${createRunId()}_candidate_commit_review_finalize_ch${pad(input.chapterNumber)}`;
  const runLogger = new RunLogger(paths, fileStore);
  await startReadOnlyRun(runLogger, runId, 'codex.finalize-candidate-commit-review', input.chapterNumber, { review: input.review ?? 'latest' });

  try {
    const artifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_commit_review_finalized');
    const report = CandidateCommitReviewFinalizedSchema.parse({
      finalizedReviewId: `candidate_commit_review_finalized_ch${pad(input.chapterNumber)}_${runId}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      generatedAt: new Date().toISOString(),
      sourceReviewPath: sources.reviewPath,
      evidenceMapPath: sources.review.evidenceMapPath,
      noopAnalysisPath: noop.path,
      sourceStateHash: sources.review.sourceStateHash,
      sourceQueueHash: sources.review.sourceQueueHash,
      sourceFinalHash: sources.review.finalPreviewHash,
      sourcePatchHash: sources.review.normalizedPatchHash,
      sourceDiffHash: sources.review.stateDiffHash,
      mutationCount: sources.review.changes.length,
      activeDecisionCount: decisions.length,
      supersededDecisionCount: allDecisionArtifacts.length - decisions.length,
      decisions,
      approvedMutationIds: decisions.filter((decision) => decision.mutationOrigin !== 'engine_metadata' && decision.decision === 'approve').map((decision) => decision.mutationId),
      conditionalEngineMutationIds: decisions.filter((decision) => decision.mutationOrigin === 'engine_metadata' && decision.decision === 'conditional-approve').map((decision) => decision.mutationId),
      highRiskMutationIds: sources.review.highRiskChanges.map((change) => change.mutationId),
      modifyRequiredMutationIds,
      rejectedMutationIds,
      unresolvedMutationIds,
      noopMutationIds,
      patchStateMismatchMutationIds,
      overallDecision,
      blockingReasons: buildBlockingReasons({ unresolvedMutationIds, rejectedMutationIds, modifyRequiredMutationIds, noopMutationIds, patchStateMismatchMutationIds }),
      warnings: invalidEngine.concat(invalidBusiness).map((decision) => `Invalid decision ${decision.decision} for ${decision.statePath}.`),
      recommendedNextStep,
      commitApprovalGenerated: false,
      storyStateMutated: false,
      queueMutated: false,
      snapshotCreated: false,
      canonicalArtifactsGenerated: false
    });
    await fileStore.writeJson(artifact.absolutePath, report, CandidateCommitReviewFinalizedSchema);
    await fileStore.writeText(artifact.markdownPath, renderFinalizedReview(report));
    await recordArtifacts(runLogger, runId, 'human_commit_review', artifact, [sources.reviewPath, noop.path, ...decisions.map((decision) => decision.decisionPath)]);
    await runLogger.recordEvent(runId, 'CODEX_CANDIDATE_COMMIT_REVIEW_FINALIZED', {
      stage: 'human_commit_review',
      chapterNumber: input.chapterNumber,
      relatedArtifactPaths: [artifact.relativePath],
      payload: { overallDecision: report.overallDecision, activeDecisionCount: report.activeDecisionCount, mutationCount: report.mutationCount, storyStateMutated: false, queueMutated: false }
    });
    await assertProtectedUnchanged(paths, fileStore, input.chapterNumber, sources, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return { runId, reviewPath: artifact.relativePath, markdownPath: artifact.relativeMarkdownPath, report };
  } catch (error) {
    await failRun(runLogger, runId, error, 'CODEX_CANDIDATE_COMMIT_FINALIZE_FAILED');
    throw error;
  }
}

export async function approveCandidateCommit(
  input: ApproveCandidateCommitInput,
  fileStore = new FileStore()
): Promise<{ runId: string; approvalPath: string; markdownPath: string; record: CandidateCommitApproval }> {
  if (!input.confirm) throw new AppError('CODEX_CANDIDATE_COMMIT_APPROVAL_CONFIRM_REQUIRED', 'Commit approval requires --confirm.', 2);
  const paths = createPaths(input);
  const finalized = await resolveFinalizedReview(paths, fileStore, input.chapterNumber, input.review ?? 'latest');
  const sourceReview = await fileStore.readJson(paths.projectArtifact(finalized.report.sourceReviewPath), CandidateCommitReviewSchema);
  let sources: DecisionSources;
  try {
    sources = await loadDecisionSources(paths, fileStore, input.chapterNumber, finalized.report.sourceReviewPath);
  } catch (error) {
    if (sourceReview.normalizedPatchPath.includes('candidate_patch_refined_v')) {
      throw new AppError('CODEX_REFINED_COMMIT_APPROVAL_SOURCE_STALE', getErrorMessage(error), 2, {
        chapterNumber: input.chapterNumber,
        sourceArtifactPath: finalized.report.sourceReviewPath,
        reason: getErrorMessage(error),
        suggestedNextCommand: `corepack pnpm novel-loop review ${paths.projectId} ${input.chapterNumber} --diagnostics --artifacts --state --suggest-next`,
        storyStateMutated: false,
        queueMutated: false
      });
    }
    throw error;
  }
  verifyFinalizedFreshness(finalized.report, sources);
  if (finalized.report.overallDecision !== 'approved_for_commit') {
    throw new AppError('CODEX_CANDIDATE_COMMIT_APPROVAL_BLOCKED', `Finalized review is ${finalized.report.overallDecision}; approval requires approved_for_commit.`, 2);
  }
  const protectedBefore = await captureProtected(paths, fileStore, input.chapterNumber, sources);
  const existingApprovals = await readVersionedJson(paths, fileStore, input.chapterNumber, 'candidate_commit_approval', CandidateCommitApprovalSchema);
  if (existingApprovals.some((approval) => approval.value.finalizedReviewPath === finalized.path && !approval.value.consumed)) {
    throw new AppError('CODEX_CANDIDATE_COMMIT_APPROVAL_ALREADY_EXISTS', 'An unconsumed approval already exists for this finalized review.', 2);
  }
  const runId = input.runId ?? `${createRunId()}_candidate_commit_approval_ch${pad(input.chapterNumber)}`;
  const runLogger = new RunLogger(paths, fileStore);
  await startReadOnlyRun(runLogger, runId, 'codex.approve-candidate-commit', input.chapterNumber, { review: input.review ?? 'latest', confirm: true });

  try {
    const artifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_commit_approval');
    const record = CandidateCommitApprovalSchema.parse({
      approvalId: `candidate_commit_approval_ch${pad(input.chapterNumber)}_${runId}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      finalizedReviewPath: finalized.path,
      approvedMutationIds: finalized.report.approvedMutationIds,
      conditionalEngineMutationIds: finalized.report.conditionalEngineMutationIds,
      highRiskMutationIds: finalized.report.highRiskMutationIds,
      sourceStateHash: finalized.report.sourceStateHash,
      sourceQueueHash: finalized.report.sourceQueueHash,
      sourceFinalHash: finalized.report.sourceFinalHash,
      sourcePatchHash: finalized.report.sourcePatchHash,
      sourceDiffHash: finalized.report.sourceDiffHash,
      approved: true,
      riskAcknowledged: true,
      approvalScope: 'single_controlled_commit',
      consumed: false,
      confirmedAt: new Date().toISOString(),
      operator: 'local_user',
      storyStateMutated: false,
      queueMutated: false,
      snapshotCreated: false,
      canonicalArtifactsGenerated: false
    });
    await fileStore.writeJson(artifact.absolutePath, record, CandidateCommitApprovalSchema);
    await fileStore.writeText(artifact.markdownPath, renderApproval(record));
    await recordArtifacts(runLogger, runId, 'human_commit_review', artifact, [finalized.path, ...finalized.report.decisions.map((decision) => decision.decisionPath)]);
    await runLogger.recordEvent(runId, 'CODEX_CANDIDATE_COMMIT_APPROVED', {
      stage: 'human_commit_review',
      chapterNumber: input.chapterNumber,
      relatedArtifactPaths: [artifact.relativePath],
      payload: { approvalScope: record.approvalScope, consumed: false, storyStateMutated: false, queueMutated: false }
    });
    await assertProtectedUnchanged(paths, fileStore, input.chapterNumber, sources, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return { runId, approvalPath: artifact.relativePath, markdownPath: artifact.relativeMarkdownPath, record };
  } catch (error) {
    await failRun(runLogger, runId, error, 'CODEX_CANDIDATE_COMMIT_APPROVAL_FAILED');
    throw error;
  }
}

function validateDecisionChoice(origin: CandidateCommitMutationOrigin, semanticNoop: boolean, decision: CandidateCommitMutationDecisionValue): void {
  if (origin === 'engine_metadata' && decision !== 'conditional-approve' && decision !== 'reject') {
    throw invalid('Engine metadata permits only conditional-approve or reject.');
  }
  if (origin !== 'engine_metadata' && decision === 'conditional-approve') {
    throw invalid('Conditional approval is reserved for engine metadata.');
  }
  if (semanticNoop && decision === 'approve') {
    throw invalid('A semantic no-op cannot be approved; use modify-required or reject.');
  }
}

function originForMutation(type: CandidateCommitMutationType): CandidateCommitMutationOrigin {
  if (type === 'latest_committed_chapter') return 'engine_metadata';
  if (type === 'narrative_debt' || type === 'foreshadowing' || type === 'relationship') return 'narrative_state';
  if (type === 'reader_state') return 'reader_state';
  if (type === 'character_state') return 'character_state';
  return 'story_content';
}

function buildNarrativeDebtAssessment(
  beforeValue: unknown,
  afterValue: unknown,
  supportingFinalParagraphs: number[],
  decision: CandidateCommitMutationDecisionValue,
  semanticNoop: boolean
): CandidateNarrativeDebtHumanAssessment {
  const before = asRecord(beforeValue);
  const after = asRecord(afterValue);
  const action = typeof after.action === 'string' ? after.action : 'maintain';
  const patchState = action === 'escalate' ? 'escalated'
    : action === 'partially_pay' ? 'partially_paid'
      : action === 'pay' ? 'resolved'
        : action === 'maintain' ? (typeof before.status === 'string' && ['open', 'escalated', 'partially_paid', 'resolved'].includes(before.status) ? before.status as 'open' | 'escalated' | 'partially_paid' | 'resolved' : 'maintain')
          : action === 'create' ? 'open'
            : 'remove';
  const recommendedState = semanticNoop ? 'remove' : patchState;
  const humanSelectedState = decision === 'modify-required' && semanticNoop ? 'remove' : recommendedState;
  return {
    debtId: typeof after.debtId === 'string' ? after.debtId : typeof before.id === 'string' ? before.id : 'unknown_debt',
    explicitSubquestionAnswered: action === 'partially_pay' || action === 'pay',
    stakesOrUrgencyOnly: action === 'escalate',
    supportingFinalParagraphs,
    recommendedState,
    humanSelectedState,
    patchState,
    patchStateMatchesHumanSelection: patchState === humanSelectedState
  };
}

async function loadDecisionSources(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  selector: string
): Promise<DecisionSources> {
  const reviewArtifact = await resolveVersionedSelector(paths, fileStore, chapterNumber, 'candidate_commit_review', selector);
  const review = await fileStore.readJson(reviewArtifact.absolutePath, CandidateCommitReviewSchema);
  if (review.projectId !== paths.projectId || review.chapterNumber !== chapterNumber || review.storyStateMutated || review.queueMutated) {
    throw stale('Commit review project, chapter, or read-only boundary is invalid.');
  }
  const [evidenceMap, stateDiff, storyStateText, queueText, finalText, patchText, diffText, preview, completeness] = await Promise.all([
    fileStore.readJson(paths.projectArtifact(review.evidenceMapPath), CandidatePatchEvidenceMapSchema),
    fileStore.readJson(paths.projectArtifact(review.stateDiffPath), StateDiffReportSchema),
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue()),
    fileStore.readText(paths.projectArtifact(review.finalPreviewPath)),
    fileStore.readText(paths.projectArtifact(review.normalizedPatchPath)),
    fileStore.readText(paths.projectArtifact(review.stateDiffPath)),
    fileStore.readJson(paths.projectArtifact(review.candidatePreviewReportPath), CodexCandidatePreviewReportSchema),
    fileStore.readJson(paths.projectArtifact(review.completenessReportPath), CodexPreviewCompletenessReportSchema)
  ]);
  StoryStateSchema.parse(JSON.parse(storyStateText));
  const queue = ChapterQueueSchema.parse(JSON.parse(queueText));
  const queueItem = queue.chapters.find((chapter) => chapter.chapterNumber === chapterNumber);
  const hashesValid = review.sourceStateHash === sha256(storyStateText) &&
    review.sourceQueueHash === sha256(queueText) &&
    review.finalPreviewHash === sha256(finalText) &&
    review.normalizedPatchHash === sha256(patchText) &&
    review.stateDiffHash === sha256(diffText) &&
    evidenceMap.finalPreviewHash === review.finalPreviewHash &&
    evidenceMap.normalizedPatchHash === review.normalizedPatchHash &&
    evidenceMap.stateDiffHash === review.stateDiffHash;
  if (!hashesValid) throw stale('Commit review source hashes no longer match the protected project artifacts.');
  if (!preview.previewComplete || !preview.patchSchemaValid || !preview.conflictCheckPassed || !preview.stateDiffGenerated || preview.storyStateMutated || preview.queueCommitted ||
    preview.normalizedPatchPath !== review.normalizedPatchPath || preview.stateDiffPath !== review.stateDiffPath || preview.completenessReportPath !== review.completenessReportPath ||
    !completeness.complete || completeness.storyStateMutated || completeness.latestCommittedChapterBefore !== completeness.latestCommittedChapterAfter || completeness.conflictCheckPassed !== true) {
    throw stale('Commit review preview, completeness, schema, conflict, diff, or read-only gate is no longer valid.');
  }
  if (queueItem === undefined || ['committed', 'recommitted'].includes(queueItem.status)) throw stale('Chapter queue is no longer eligible for mutation decisions.');
  if (review.changes.length !== evidenceMap.mutations.length || review.changes.length !== stateDiff.changes.length) throw stale('Review, evidence map, and state diff mutation counts differ.');
  return {
    reviewPath: reviewArtifact.relativePath,
    review,
    evidenceMap,
    stateDiff,
    storyStateText,
    queueText,
    finalText,
    patchText,
    diffText
  };
}

async function readOrCreateNoopAnalysis(
  input: FinalizeCandidateCommitReviewInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  sources: DecisionSources
): Promise<{ path: string; report: CandidatePatchNoopAnalysis }> {
  const reports = await readVersionedJson(paths, fileStore, input.chapterNumber, 'candidate_patch_noop_analysis', CandidatePatchNoopAnalysisSchema);
  const matching = reports.filter((artifact) => artifact.value.commitReviewPath === sources.reviewPath &&
    artifact.value.sourceStateHash === sources.review.sourceStateHash && artifact.value.sourceQueueHash === sources.review.sourceQueueHash &&
    artifact.value.sourceFinalHash === sources.review.finalPreviewHash && artifact.value.sourcePatchHash === sources.review.normalizedPatchHash &&
    artifact.value.sourceDiffHash === sources.review.stateDiffHash).at(-1);
  if (matching !== undefined) return { path: matching.path, report: matching.value };
  const generated = await analyzeCandidatePatchNoops(input, fileStore);
  return { path: generated.reportPath, report: generated.report };
}

async function readMutationDecisions(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  reviewPath: string
): Promise<Array<{ path: string; record: CandidateCommitMutationDecision }>> {
  const artifacts = await readVersionedJson(paths, fileStore, chapterNumber, 'candidate_commit_mutation_decision', CandidateCommitMutationDecisionSchema);
  return artifacts.filter((artifact) => artifact.value.commitReviewPath === reviewPath).map((artifact) => ({ path: artifact.path, record: artifact.value }));
}

function effectiveDecisionMap(
  decisions: Array<{ path: string; record: CandidateCommitMutationDecision }>
): Map<string, { path: string; record: CandidateCommitMutationDecision }> {
  const effective = new Map<string, { path: string; record: CandidateCommitMutationDecision }>();
  for (const artifact of decisions) effective.set(artifact.record.mutationId, artifact);
  return effective;
}

async function resolveFinalizedReview(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  selector: string
): Promise<{ path: string; report: CandidateCommitReviewFinalized }> {
  const artifact = await resolveVersionedSelector(paths, fileStore, chapterNumber, 'candidate_commit_review_finalized', selector);
  return { path: artifact.relativePath, report: await fileStore.readJson(artifact.absolutePath, CandidateCommitReviewFinalizedSchema) };
}

function verifyFinalizedFreshness(report: CandidateCommitReviewFinalized, sources: DecisionSources): void {
  if (report.sourceReviewPath !== sources.reviewPath || report.sourceStateHash !== sha256(sources.storyStateText) ||
    report.sourceQueueHash !== sha256(sources.queueText) || report.sourceFinalHash !== sha256(sources.finalText) ||
    report.sourcePatchHash !== sha256(sources.patchText) || report.sourceDiffHash !== sha256(sources.diffText)) {
    throw stale('Finalized review no longer matches the protected source chain.');
  }
}

async function resolveVersionedSelector(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string,
  selector: string
): Promise<{ absolutePath: string; relativePath: string }> {
  if (selector !== 'latest') {
    const relativePath = selector.split(/[\\/]+/).join(path.sep);
    const absolutePath = paths.projectArtifact(relativePath);
    if (!(await fileStore.exists(absolutePath))) throw stale(`Required artifact does not exist: ${selector}`);
    return { absolutePath, relativePath };
  }
  const artifacts = await listVersionedArtifacts(paths, fileStore, chapterNumber, baseName);
  const latest = artifacts.at(-1);
  if (latest === undefined) throw stale(`No ${baseName} artifact is available.`);
  return latest;
}

async function nextVersionedArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string,
  withMarkdown = true
): Promise<VersionedArtifact> {
  const artifacts = await listVersionedArtifacts(paths, fileStore, chapterNumber, baseName);
  const version = (artifacts.at(-1)?.version ?? 0) + 1;
  const jsonFile = `${baseName}_v${version}.json`;
  const mdFile = `${baseName}_v${version}.md`;
  return {
    version,
    absolutePath: paths.chapterArtifact(chapterNumber, jsonFile),
    relativePath: relativeChapterArtifact(chapterNumber, jsonFile),
    markdownPath: withMarkdown ? paths.chapterArtifact(chapterNumber, mdFile) : '',
    relativeMarkdownPath: withMarkdown ? relativeChapterArtifact(chapterNumber, mdFile) : ''
  };
}

async function listVersionedArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string): Promise<VersionedArtifact[]> {
  if (!(await fileStore.exists(paths.chapterDir(chapterNumber)))) return [];
  const pattern = new RegExp(`^${escapeRegExp(baseName)}_v(\\d+)\\.json$`);
  const artifacts: VersionedArtifact[] = [];
  for (const entry of await fileStore.list(paths.chapterDir(chapterNumber))) {
    const match = pattern.exec(entry);
    if (match === null) continue;
    const version = Number.parseInt(match[1]!, 10);
    const mdFile = `${baseName}_v${version}.md`;
    artifacts.push({
      version,
      absolutePath: paths.chapterArtifact(chapterNumber, entry),
      relativePath: relativeChapterArtifact(chapterNumber, entry),
      markdownPath: paths.chapterArtifact(chapterNumber, mdFile),
      relativeMarkdownPath: relativeChapterArtifact(chapterNumber, mdFile)
    });
  }
  return artifacts.sort((left, right) => left.version - right.version);
}

async function readVersionedJson<T>(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string,
  schema: { parse(value: unknown): T }
): Promise<Array<{ path: string; value: T }>> {
  const artifacts = await listVersionedArtifacts(paths, fileStore, chapterNumber, baseName);
  const output: Array<{ path: string; value: T }> = [];
  for (const artifact of artifacts) {
    const raw = JSON.parse(await fileStore.readText(artifact.absolutePath)) as unknown;
    output.push({ path: artifact.relativePath, value: schema.parse(raw) });
  }
  return output;
}

async function captureProtected(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, sources: DecisionSources) {
  return {
    storyState: await fileStore.readText(paths.storyState()),
    queue: await fileStore.readText(paths.chapterQueue()),
    finalPreview: await fileStore.readText(paths.projectArtifact(sources.review.finalPreviewPath)),
    normalizedPatch: await fileStore.readText(paths.projectArtifact(sources.review.normalizedPatchPath)),
    stateDiff: await fileStore.readText(paths.projectArtifact(sources.review.stateDiffPath)),
    canonicalFinal: await readOptional(fileStore, paths.chapterArtifact(chapterNumber, 'final.md')),
    canonicalPatch: await readOptional(fileStore, paths.chapterArtifact(chapterNumber, 'canon_patch.json')),
    commitReport: await readOptional(fileStore, paths.chapterArtifact(chapterNumber, 'commit_report.json')),
    snapshots: (await fileStore.list(paths.snapshotsDir())).sort()
  };
}

async function assertProtectedUnchanged(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  sources: DecisionSources,
  before: Awaited<ReturnType<typeof captureProtected>>
): Promise<void> {
  const after = await captureProtected(paths, fileStore, chapterNumber, sources);
  if (stableJson(after) !== stableJson(before)) {
    throw new AppError('CODEX_CANDIDATE_COMMIT_DECISION_SIDE_EFFECT', 'Human decision workflow changed a protected state, queue, snapshot, preview, patch, diff, or canonical artifact.', 1);
  }
}

async function readOptional(fileStore: FileStore, absolutePath: string): Promise<string | null> {
  return await fileStore.exists(absolutePath) ? fileStore.readText(absolutePath) : null;
}

async function startReadOnlyRun(
  logger: RunLogger,
  runId: string,
  command: string,
  chapterNumber: number,
  args: Record<string, unknown>
): Promise<void> {
  await logger.startRun({
    runId,
    command,
    args: {
      chapterNumber,
      provider: 'none',
      codexInvoked: false,
      storyStateMutationAllowed: false,
      queueMutationAllowed: false,
      snapshotAllowed: false,
      canonicalArtifactWriteAllowed: false,
      ...args
    }
  });
}

async function recordArtifacts(
  logger: RunLogger,
  runId: string,
  stage: string,
  artifact: VersionedArtifact,
  sourcePaths: string[]
): Promise<void> {
  await logger.recordArtifact(runId, artifact.relativePath, { stage, sourcePaths });
  if (artifact.relativeMarkdownPath !== '') {
    await logger.recordArtifact(runId, artifact.relativeMarkdownPath, { stage, sourcePaths: [artifact.relativePath] });
  }
}

async function failRun(logger: RunLogger, runId: string, error: unknown, fallbackCode: string): Promise<void> {
  await logger.recordError(runId, { code: error instanceof AppError ? error.code : fallbackCode, message: getErrorMessage(error), recoverable: false });
  await logger.endRun(runId, 'failed');
}

function buildBlockingReasons(input: {
  unresolvedMutationIds: string[];
  rejectedMutationIds: string[];
  modifyRequiredMutationIds: string[];
  noopMutationIds: string[];
  patchStateMismatchMutationIds: string[];
}): string[] {
  const reasons: string[] = [];
  if (input.unresolvedMutationIds.length > 0) reasons.push(`Missing active decisions: ${input.unresolvedMutationIds.join(', ')}.`);
  if (input.rejectedMutationIds.length > 0) reasons.push(`Rejected mutations: ${input.rejectedMutationIds.join(', ')}.`);
  if (input.modifyRequiredMutationIds.length > 0) reasons.push(`Patch changes required for: ${input.modifyRequiredMutationIds.join(', ')}.`);
  if (input.noopMutationIds.length > 0) reasons.push(`Semantic no-op mutations must be removed: ${input.noopMutationIds.join(', ')}.`);
  if (input.patchStateMismatchMutationIds.length > 0) reasons.push(`Human-selected narrative debt state differs from patch: ${input.patchStateMismatchMutationIds.join(', ')}.`);
  return reasons;
}

function renderNoopAnalysis(report: CandidatePatchNoopAnalysis): string {
  const lines = [
    '# Candidate Patch No-op Analysis', '',
    `mutationCount: ${report.mutationCount}`,
    `semanticNoopCount: ${report.semanticNoopCount}`, ''
  ];
  for (const mutation of report.mutations) {
    lines.push(`- ${mutation.mutationId} ${mutation.statePath}: semanticNoop=${String(mutation.semanticNoop)}; metadataChanged=${String(mutation.metadataChanged)}; recommendation=${mutation.recommendation}`);
    if (mutation.changedFields.length > 0) lines.push(`  changedFields: ${mutation.changedFields.join(', ')}`);
  }
  lines.push('', 'No patch, Story State, queue, snapshot, or canonical artifact was modified.');
  return `${lines.join('\n')}\n`;
}

function renderFinalizedReview(report: CandidateCommitReviewFinalized): string {
  const lines = [
    '# Candidate Commit Review Finalized', '',
    `overallDecision: ${report.overallDecision}`,
    `decision progress: ${report.activeDecisionCount}/${report.mutationCount}`,
    `superseded decisions: ${report.supersededDecisionCount}`,
    `high-risk mutations: ${report.highRiskMutationIds.join(', ') || 'none'}`,
    `unresolved mutations: ${report.unresolvedMutationIds.join(', ') || 'none'}`,
    `no-op mutations: ${report.noopMutationIds.join(', ') || 'none'}`,
    `modify-required mutations: ${report.modifyRequiredMutationIds.join(', ') || 'none'}`,
    `rejected mutations: ${report.rejectedMutationIds.join(', ') || 'none'}`,
    `recommendedNextStep: ${report.recommendedNextStep}`, '',
    '## Active decisions', ''
  ];
  for (const decision of report.decisions) {
    lines.push(`- ${decision.mutationId} ${decision.statePath}: ${decision.decision} (${decision.mutationOrigin}, risk=${decision.riskLevel})`);
    lines.push(`  ${decision.note}`);
  }
  lines.push('', 'No commit approval, snapshot, canonical artifact, Story State mutation, or queue mutation was produced.');
  return `${lines.join('\n')}\n`;
}

function renderApproval(record: CandidateCommitApproval): string {
  return [
    '# Candidate Commit Approval', '',
    `approvalId: ${record.approvalId}`,
    `finalizedReviewPath: ${record.finalizedReviewPath}`,
    `approvedMutationIds: ${record.approvedMutationIds.join(', ')}`,
    `conditionalEngineMutationIds: ${record.conditionalEngineMutationIds.join(', ')}`,
    `highRiskMutationIds: ${record.highRiskMutationIds.join(', ')}`,
    `approvalScope: ${record.approvalScope}`,
    `consumed: ${String(record.consumed)}`,
    `confirmedAt: ${record.confirmedAt}`, '',
    'This approval is append-only and limited to one later controlled local commit. It did not mutate Story State or queue and created no snapshot or canonical artifact.', ''
  ].join('\n');
}

function createPaths(input: { projectId: string; projectsRoot?: string }): ProjectPaths {
  return new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
}

function invalid(message: string): AppError {
  return new AppError('CODEX_CANDIDATE_COMMIT_DECISION_INVALID', message, 2);
}

function stale(message: string): AppError {
  return new AppError('CODEX_CANDIDATE_COMMIT_DECISION_STALE', message, 2);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.posix.join('chapters', `chapter_${pad(chapterNumber)}`, fileName);
}

function pad(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
