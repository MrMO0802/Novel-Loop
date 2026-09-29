import path from 'node:path';
import type { z } from 'zod';

import { applyCanonPatchToStoryState, checkPatchConflicts } from './chapterCommit.js';
import {
  analyzeCandidatePatchNoops,
  analyzeCandidatePatchMutationNoop
} from './codexCandidateCommitDecision.js';
import { reviewCodexCandidateCommit } from './codexCandidateCommitReview.js';
import { sha256 } from './codexDiagnosticsEvidenceRules.js';
import { RunLogger } from '../logging/RunLogger.js';
import {
  CandidateCommitDecisionCarryForwardSchema,
  CandidateCommitMutationDecisionSchema,
  CandidateCommitMutationLineageSchema,
  CandidateCommitReviewFinalizedSchema,
  CandidateCommitReviewSchema,
  CandidatePatchEvidenceMapSchema,
  CandidatePatchNoopAnalysisSchema,
  CandidatePatchRefinedConflictSchema,
  CandidatePatchRefinedValidationSchema,
  CandidatePatchRefinementEquivalenceSchema,
  CandidatePatchRefinementManifestSchema,
  CandidateRefinedHighRiskReviewSchema,
  CanonPatchSchema,
  ChapterQueueSchema,
  CodexCandidatePreviewReportSchema,
  CodexPreviewCompletenessReportSchema,
  RefinedStateDiffReportSchema,
  StateDiffReportSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  CandidateCommitDecisionCarryForward,
  CandidateCommitMutationDecision,
  CandidateCommitMutationLineage,
  CandidateCommitMutationOrigin,
  CandidateCommitMutationType,
  CandidateCommitReview,
  CandidatePatchEvidenceMap,
  CandidatePatchRefinementEquivalence,
  CanonPatch,
  CodexCandidatePreviewReport,
  RefinedStateDiffReport,
  StateDiffChange,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface RefineCandidatePatchInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  review?: string;
  removeNoop: string;
  confirm: boolean;
  runId?: string;
}

export interface CarryForwardCandidateCommitDecisionsInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  preview?: string;
  confirm: boolean;
  runId?: string;
}

interface VersionedArtifact {
  version: number;
  absolutePath: string;
  relativePath: string;
  markdownPath: string;
  relativeMarkdownPath: string;
}

interface RefinementSources {
  reviewPath: string;
  review: CandidateCommitReview;
  evidenceMap: CandidatePatchEvidenceMap;
  noopPath: string;
  noop: Awaited<ReturnType<typeof CandidatePatchNoopAnalysisSchema.parse>>;
  finalizedPath: string;
  finalized: Awaited<ReturnType<typeof CandidateCommitReviewFinalizedSchema.parse>>;
  sourceDecisionPath: string;
  sourceDecision: CandidateCommitMutationDecision;
  sourcePatchText: string;
  sourcePatch: CanonPatch;
  sourceDiffText: string;
  sourceDiff: Awaited<ReturnType<typeof StateDiffReportSchema.parse>>;
  sourcePreview: CodexCandidatePreviewReport;
  sourcePreviewPath: string;
  stateText: string;
  storyState: StoryState;
  queueText: string;
}

interface ResolvedOperation {
  patchPath: string;
  index: number;
  operation: CanonPatch['narrativeDebtUpdates'][number];
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function refineCandidatePatch(
  input: RefineCandidatePatchInput,
  fileStore = new FileStore()
) {
  if (!input.confirm) {
    throw refinementError('CODEX_PATCH_REFINEMENT_NOT_AUTHORIZED', input, 'Patch refinement requires --confirm.', input.removeNoop);
  }
  const paths = createPaths(input);
  const sources = await loadRefinementSources(paths, fileStore, input);
  const protectedBefore = await captureProtected(paths, fileStore, input.chapterNumber, sources);
  const resolved = resolveAtomicNoopOperation(input, sources);
  const refinedPatch = structuredClone(sources.sourcePatch);
  refinedPatch.narrativeDebtUpdates.splice(resolved.index, 1);
  const validatedRefinedPatch = CanonPatchSchema.parse(refinedPatch);
  const equivalence = buildEquivalence(paths, input.chapterNumber, sources.storyState, sha256(sources.stateText), sources.sourcePatch, validatedRefinedPatch, sources.review.normalizedPatchPath, 'pending');
  ensureEquivalent(input, equivalence);
  validateRefinedPatchSemantics(input, sources.storyState, validatedRefinedPatch);
  const conflicts = checkPatchConflicts(sources.storyState, validatedRefinedPatch);
  if (conflicts.hard.length > 0) {
    throw refinementError('CODEX_PATCH_REFINEMENT_REVIEW_NOT_ELIGIBLE', input, `Refined patch conflict: ${conflicts.hard.join('; ')}`, input.removeNoop);
  }

  const runId = input.runId ?? `${createRunId()}_candidate_patch_refinement_ch${pad(input.chapterNumber)}`;
  const runLogger = new RunLogger(paths, fileStore);
  await startReadOnlyRun(runLogger, runId, 'codex.refine-candidate-patch', input.chapterNumber, {
    review: input.review ?? 'latest',
    removeNoop: input.removeNoop,
    confirmed: true
  });

  try {
    const refinedPatchArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_patch_refined', false);
    await fileStore.writeJson(refinedPatchArtifact.absolutePath, validatedRefinedPatch, CanonPatchSchema);
    const refinedPatchText = await fileStore.readText(refinedPatchArtifact.absolutePath);
    const refinedPatchHash = sha256(refinedPatchText);

    const equivalenceArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_patch_refinement_equivalence');
    const finalEquivalence = CandidatePatchRefinementEquivalenceSchema.parse({
      ...equivalence,
      refinedPatchPath: refinedPatchArtifact.relativePath
    });
    await writePair(fileStore, equivalenceArtifact, finalEquivalence, CandidatePatchRefinementEquivalenceSchema, renderEquivalence(finalEquivalence));

    const validationArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_patch_refined_validation');
    const validation = CandidatePatchRefinedValidationSchema.parse({
      reportId: `candidate_patch_refined_validation_ch${pad(input.chapterNumber)}_${runId}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      refinedPatchPath: refinedPatchArtifact.relativePath,
      refinedPatchHash,
      candidatePatchSchemaValid: true,
      canonPatchSchemaValid: true,
      narrativeDebtFsmValid: true,
      timelineValid: true,
      characterKnowledgeValid: true,
      readerKnowledgeValid: true,
      generatedAt: new Date().toISOString()
    });
    await writePair(fileStore, validationArtifact, validation, CandidatePatchRefinedValidationSchema, renderValidation(validation));

    const conflictArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_patch_refined_conflict');
    const conflict = CandidatePatchRefinedConflictSchema.parse({
      reportId: `candidate_patch_refined_conflict_ch${pad(input.chapterNumber)}_${runId}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      refinedPatchPath: refinedPatchArtifact.relativePath,
      refinedPatchHash,
      hard: conflicts.hard,
      warnings: conflicts.warnings,
      conflictCheckPassed: true,
      generatedAt: new Date().toISOString()
    });
    await writePair(fileStore, conflictArtifact, conflict, CandidatePatchRefinedConflictSchema, renderConflict(conflict));

    const refinedDiffArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'state_diff_refined');
    const refinedDiff = buildRefinedDiff(paths, sources, input.removeNoop, refinedPatchArtifact.relativePath);
    await writePair(fileStore, refinedDiffArtifact, refinedDiff, RefinedStateDiffReportSchema, renderRefinedDiff(refinedDiff));
    const refinedDiffText = await fileStore.readText(refinedDiffArtifact.absolutePath);

    const completenessArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'codex_preview_completeness_refined');
    const completeness = CodexPreviewCompletenessReportSchema.parse({
      reportId: `codex_preview_completeness_refined_ch${pad(input.chapterNumber)}_${runId}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      generatedAt: new Date().toISOString(),
      provider: 'codex-text',
      previewRunId: runId,
      previewStage: 'local_patch_refinement',
      complete: true,
      missingArtifacts: [],
      invalidArtifacts: [],
      blockingReasons: [],
      warnings: ['Draft, final candidate, diagnostics, quality, and adoption artifacts were hash-verified and reused without invoking Codex.'],
      suggestedRetryCommand: `corepack pnpm novel-loop codex refine-candidate-patch ${paths.projectId} ${input.chapterNumber} --review ${sources.reviewPath} --remove-noop ${input.removeNoop} --confirm`,
      suggestedInspectCommands: [`corepack pnpm novel-loop review ${paths.projectId} ${input.chapterNumber} --diagnostics --artifacts --state --suggest-next`],
      subStageTimeline: [],
      queueStatusBefore: sources.sourcePreview.queueStatusBefore,
      queueStatusAfter: sources.sourcePreview.queueStatusAfter,
      latestCommittedChapterBefore: sources.storyState.latestCommittedChapter,
      latestCommittedChapterAfter: sources.storyState.latestCommittedChapter,
      storyStateMutated: false,
      previewStateHash: sha256(sources.stateText),
      previewStateHashRecorded: true,
      conflictCheckPassed: true,
      redacted: true
    });
    await writePair(fileStore, completenessArtifact, completeness, CodexPreviewCompletenessReportSchema, renderCompleteness(completeness));

    const previewArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'codex_candidate_preview_refined');
    const preview = CodexCandidatePreviewReportSchema.parse({
      ...sources.sourcePreview,
      reportId: `codex_candidate_preview_refined_ch${pad(input.chapterNumber)}_${runId}`,
      runId,
      normalizedPatchPath: refinedPatchArtifact.relativePath,
      conflictReportPath: conflictArtifact.relativePath,
      stateDiffPath: refinedDiffArtifact.relativePath,
      completenessReportPath: completenessArtifact.relativePath,
      previewComplete: true,
      patchSchemaValid: true,
      conflictCheckPassed: true,
      stateDiffGenerated: true,
      sourceStateHash: sha256(sources.stateText),
      sourceQueueHash: sha256(sources.queueText),
      storyStateMutated: false,
      queueCommitted: false,
      commitStarted: false,
      snapshotCreated: false,
      canonicalPatchGenerated: false,
      failureCode: null,
      failureReason: null,
      recommendedNextStep: 'human_commit_review',
      generatedAt: new Date().toISOString()
    });
    await writePair(fileStore, previewArtifact, preview, CodexCandidatePreviewReportSchema, renderPreview(preview));

    const review = await reviewCodexCandidateCommit({
      projectId: paths.projectId,
      projectsRoot: paths.projectsRoot,
      chapterNumber: input.chapterNumber,
      preview: previewArtifact.relativePath
    }, fileStore);
    const noopAnalysis = await analyzeCandidatePatchNoops({
      projectId: paths.projectId,
      projectsRoot: paths.projectsRoot,
      chapterNumber: input.chapterNumber,
      review: review.reviewPath
    }, fileStore);
    if (noopAnalysis.report.semanticNoopCount !== 0) {
      throw refinementError('CODEX_PATCH_REFINEMENT_NOT_SEMANTICALLY_EQUIVALENT', input, 'Refined review still contains semantic no-op mutations.', input.removeNoop);
    }

    const lineageArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_commit_mutation_lineage');
    const oldDecisions = await readActiveDecisions(paths, fileStore, input.chapterNumber, sources.reviewPath);
    const lineage = buildLineage(paths, input.chapterNumber, sources, review.evidenceMap, refinedDiffArtifact.relativePath, oldDecisions, input.removeNoop);
    assertLineageEligible(input, lineage);
    await writePair(fileStore, lineageArtifact, lineage, CandidateCommitMutationLineageSchema, renderLineage(lineage));

    const highRiskArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'high_risk_state_change_review');
    const highRisk = CandidateRefinedHighRiskReviewSchema.parse({
      reportId: `high_risk_state_change_review_ch${pad(input.chapterNumber)}_${runId}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      generatedAt: new Date().toISOString(),
      refinedPatchPath: refinedPatchArtifact.relativePath,
      refinedStateDiffPath: refinedDiffArtifact.relativePath,
      evidenceMapPath: review.evidenceMapPath,
      highRiskMutationIds: review.report.highRiskChanges.map((change) => change.mutationId),
      changesReviewed: review.report.changes.length,
      decision: 'requires_human_decisions',
      storyStateMutated: false,
      queueMutated: false
    });
    await writePair(fileStore, highRiskArtifact, highRisk, CandidateRefinedHighRiskReviewSchema, renderHighRisk(highRisk));

    const carryForwardPreview = await writeCarryForwardPreview({
      paths,
      fileStore,
      chapterNumber: input.chapterNumber,
      oldReviewPath: sources.reviewPath,
      oldReview: sources.review,
      oldEvidence: sources.evidenceMap,
      newReviewPath: review.reviewPath,
      newReview: review.report,
      newEvidence: review.evidenceMap,
      lineagePath: lineageArtifact.relativePath,
      lineage,
      oldDecisions,
      approved: false,
      confirmedAt: null
    });

    const manifestArtifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_patch_refinement_manifest');
    const manifest = CandidatePatchRefinementManifestSchema.parse({
      refinementId: `candidate_patch_refinement_ch${pad(input.chapterNumber)}_${runId}`,
      runId,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      generatedAt: new Date().toISOString(),
      sourceProposalPath: sources.review.patchProposalPath,
      sourceNormalizedPatchPath: sources.review.normalizedPatchPath,
      sourceNormalizedPatchHash: sources.review.normalizedPatchHash,
      sourceStateDiffPath: sources.review.stateDiffPath,
      sourceStateDiffHash: sources.review.stateDiffHash,
      sourceReviewPath: sources.reviewPath,
      sourceNoopAnalysisPath: sources.noopPath,
      sourceDecisionPath: sources.sourceDecisionPath,
      removedMutationIds: [input.removeNoop],
      removedPatchPaths: [resolved.patchPath],
      removedOperations: [{
        patchPath: resolved.patchPath,
        collection: 'narrativeDebtUpdates',
        index: resolved.index,
        operation: resolved.operation,
        operationHash: sha256(stableJson(resolved.operation)),
        debtId: resolved.operation.debtId,
        action: 'maintain'
      }],
      refinedPatchPath: refinedPatchArtifact.relativePath,
      refinedPatchHash,
      sourcePatchSchemaValid: true,
      refinedPatchSchemaValid: true,
      semanticChangeIntended: false,
      refinementReason: 'remove_semantic_noop',
      confirmed: true,
      operator: 'local_user',
      storyStateMutated: false,
      queueMutated: false
    });
    await writePair(fileStore, manifestArtifact, manifest, CandidatePatchRefinementManifestSchema, renderManifest(manifest));

    const artifacts = [
      refinedPatchArtifact.relativePath,
      equivalenceArtifact.relativePath,
      validationArtifact.relativePath,
      conflictArtifact.relativePath,
      refinedDiffArtifact.relativePath,
      completenessArtifact.relativePath,
      previewArtifact.relativePath,
      review.evidenceMapPath,
      review.reviewPath,
      noopAnalysis.reportPath,
      lineageArtifact.relativePath,
      highRiskArtifact.relativePath,
      carryForwardPreview.previewPath,
      manifestArtifact.relativePath
    ];
    for (const artifactPath of artifacts) {
      await runLogger.recordArtifact(runId, artifactPath, { stage: 'human_commit_review', sourcePaths: [sources.reviewPath] });
    }
    await runLogger.recordEvent(runId, 'CODEX_CANDIDATE_PATCH_REFINED', {
      stage: 'human_commit_review',
      chapterNumber: input.chapterNumber,
      relatedArtifactPaths: artifacts,
      payload: {
        removedMutationIds: [input.removeNoop],
        projectedStatesEquivalent: true,
        refinedMutationCount: review.report.changes.length,
        storyStateMutated: false,
        queueMutated: false
      }
    });
    await assertProtectedUnchanged(paths, fileStore, input.chapterNumber, sources, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return {
      runId,
      refinedPatchPath: refinedPatchArtifact.relativePath,
      manifestPath: manifestArtifact.relativePath,
      equivalencePath: equivalenceArtifact.relativePath,
      validationPath: validationArtifact.relativePath,
      conflictPath: conflictArtifact.relativePath,
      stateDiffPath: refinedDiffArtifact.relativePath,
      lineagePath: lineageArtifact.relativePath,
      completenessPath: completenessArtifact.relativePath,
      previewPath: previewArtifact.relativePath,
      highRiskReviewPath: highRiskArtifact.relativePath,
      review,
      noopAnalysis,
      carryForwardPreview
    };
  } catch (error) {
    await runLogger.recordError(runId, { code: error instanceof AppError ? error.code : 'CODEX_PATCH_REFINEMENT_FAILED', message: getErrorMessage(error), recoverable: false });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

export async function carryForwardCandidateCommitDecisions(
  input: CarryForwardCandidateCommitDecisionsInput,
  fileStore = new FileStore()
) {
  if (!input.confirm) {
    throw carryError('CODEX_DECISION_CARRY_FORWARD_NOT_ELIGIBLE', input, 'Decision carry-forward requires explicit --confirm.');
  }
  const paths = createPaths(input);
  const previewArtifact = await resolveVersionedSelector(paths, fileStore, input.chapterNumber, 'candidate_commit_decision_carry_forward_preview', input.preview ?? 'latest');
  const preview = await fileStore.readJson(previewArtifact.absolutePath, CandidateCommitDecisionCarryForwardSchema);
  const newReview = await fileStore.readJson(paths.projectArtifact(preview.newReviewPath), CandidateCommitReviewSchema);
  const newEvidence = await fileStore.readJson(paths.projectArtifact(newReview.evidenceMapPath), CandidatePatchEvidenceMapSchema);
  const lineage = await fileStore.readJson(paths.projectArtifact(preview.lineagePath), CandidateCommitMutationLineageSchema);
  await verifyCarryForwardFreshness(input, paths, preview, newReview, newEvidence, lineage, fileStore);
  const blocking = preview.decisions.filter((decision) => decision.newMutationId !== null && !decision.eligible);
  if (blocking.length > 0) {
    const evidenceChanged = blocking.find((decision) => !decision.evidenceUnchanged);
    throw carryError(evidenceChanged === undefined ? 'CODEX_DECISION_CARRY_FORWARD_NOT_ELIGIBLE' : 'CODEX_DECISION_CARRY_FORWARD_EVIDENCE_CHANGED', input, blocking.map((decision) => decision.reason).join('; '), blocking[0]?.oldMutationId);
  }
  if (preview.eligibleDecisionCount !== newReview.changes.length) {
    throw carryError('CODEX_DECISION_CARRY_FORWARD_NOT_ELIGIBLE', input, 'Every refined mutation must have one eligible unchanged predecessor before bulk carry-forward.');
  }

  const protectedBefore = await captureSimpleProtected(paths, fileStore, input.chapterNumber, newReview);
  const runId = input.runId ?? `${createRunId()}_candidate_commit_decision_carry_forward_ch${pad(input.chapterNumber)}`;
  const runLogger = new RunLogger(paths, fileStore);
  await startReadOnlyRun(runLogger, runId, 'codex.carry-forward-candidate-commit-decisions', input.chapterNumber, { preview: input.preview ?? 'latest', confirmed: true });
  try {
    const confirmed = await writeCarryForwardPreview({
      paths,
      fileStore,
      chapterNumber: input.chapterNumber,
      oldReviewPath: preview.oldReviewPath,
      oldReview: await fileStore.readJson(paths.projectArtifact(preview.oldReviewPath), CandidateCommitReviewSchema),
      oldEvidence: await fileStore.readJson(paths.projectArtifact((await fileStore.readJson(paths.projectArtifact(preview.oldReviewPath), CandidateCommitReviewSchema)).evidenceMapPath), CandidatePatchEvidenceMapSchema),
      newReviewPath: preview.newReviewPath,
      newReview,
      newEvidence,
      lineagePath: preview.lineagePath,
      lineage,
      oldDecisions: await readActiveDecisions(paths, fileStore, input.chapterNumber, preview.oldReviewPath),
      approved: true,
      confirmedAt: new Date().toISOString()
    });
    const oldDecisions = await readActiveDecisions(paths, fileStore, input.chapterNumber, preview.oldReviewPath);
    const oldById = new Map([...oldDecisions.values()].map((artifact) => [artifact.record.decisionId, artifact.record]));
    const records: CandidateCommitMutationDecision[] = [];
    const decisionPaths: string[] = [];
    for (const item of confirmed.report.decisions.filter((decision) => decision.eligible)) {
      const prior = oldById.get(item.previousDecisionId);
      const mutation = newEvidence.mutations.find((candidate) => candidate.mutationId === item.newMutationId);
      if (prior === undefined || mutation === undefined || item.newMutationId === null) {
        throw carryError('CODEX_DECISION_CARRY_FORWARD_NOT_ELIGIBLE', input, `Missing prior decision or refined mutation for ${item.oldMutationId}.`, item.oldMutationId);
      }
      const artifact = await nextVersionedArtifact(paths, fileStore, input.chapterNumber, 'candidate_commit_mutation_decision', false);
      const record = CandidateCommitMutationDecisionSchema.parse({
        ...prior,
        decisionId: `candidate_commit_mutation_decision_ch${pad(input.chapterNumber)}_${artifact.version}_${runId}`,
        commitReviewPath: preview.newReviewPath,
        mutationId: item.newMutationId,
        statePath: mutation.statePath,
        mutationType: mutation.mutationType,
        decidedAt: new Date().toISOString(),
        evidenceMapPath: newReview.evidenceMapPath,
        sourceStateHash: newReview.sourceStateHash,
        sourceQueueHash: newReview.sourceQueueHash,
        sourceFinalHash: newReview.finalPreviewHash,
        sourcePatchHash: newReview.normalizedPatchHash,
        sourceDiffHash: newReview.stateDiffHash,
        supersedesDecisionId: null,
        carriedForwardFromDecisionId: prior.decisionId,
        carryForwardReportPath: confirmed.previewPath,
        oldMutationId: item.oldMutationId,
        newMutationId: item.newMutationId,
        mutationFingerprint: item.mutationFingerprint,
        operatorConfirmed: true,
        active: true,
        semanticNoop: false,
        storyStateMutated: false,
        queueMutated: false
      });
      await fileStore.writeJson(artifact.absolutePath, record, CandidateCommitMutationDecisionSchema);
      await runLogger.recordArtifact(runId, artifact.relativePath, { stage: 'human_commit_review', sourcePaths: [confirmed.previewPath, prior.commitReviewPath] });
      records.push(record);
      decisionPaths.push(artifact.relativePath);
    }
    await runLogger.recordArtifact(runId, confirmed.previewPath, { stage: 'human_commit_review', sourcePaths: [previewArtifact.relativePath] });
    await runLogger.recordEvent(runId, 'CODEX_CANDIDATE_COMMIT_DECISIONS_CARRIED_FORWARD', {
      stage: 'human_commit_review',
      chapterNumber: input.chapterNumber,
      relatedArtifactPaths: [confirmed.previewPath, ...decisionPaths],
      payload: { carriedDecisionCount: records.length, operatorConfirmed: true, storyStateMutated: false, queueMutated: false }
    });
    await assertSimpleProtectedUnchanged(paths, fileStore, input.chapterNumber, newReview, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return { runId, reportPath: confirmed.previewPath, markdownPath: confirmed.markdownPath, report: confirmed.report, decisionPaths, records };
  } catch (error) {
    await runLogger.recordError(runId, { code: error instanceof AppError ? error.code : 'CODEX_DECISION_CARRY_FORWARD_FAILED', message: getErrorMessage(error), recoverable: false });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

function resolveAtomicNoopOperation(input: RefineCandidatePatchInput, sources: RefinementSources): ResolvedOperation {
  const mutation = sources.evidenceMap.mutations.find((candidate) => candidate.mutationId === input.removeNoop);
  if (mutation === undefined) throw refinementError('CODEX_PATCH_REFINEMENT_NOT_AUTHORIZED', input, 'Requested mutation is not in the source evidence map.', input.removeNoop);
  if (mutation.mutationType !== 'narrative_debt') {
    throw refinementError('CODEX_PATCH_REFINEMENT_OPERATION_NOT_ATOMIC', input, 'Only a uniquely mapped narrative-debt maintain operation is removable in this refinement.', input.removeNoop);
  }
  const after = asRecord(mutation.afterValue);
  const debtId = typeof after.debtId === 'string' ? after.debtId : mutation.statePath.split('/').at(-1);
  const action = after.action;
  const candidates = sources.sourcePatch.narrativeDebtUpdates
    .map((operation, index) => ({ operation, index }))
    .filter(({ operation }) => operation.debtId === debtId && operation.action === action && stableJson(operation) === stableJson(mutation.afterValue));
  if (candidates.length !== 1) {
    throw refinementError('CODEX_PATCH_REFINEMENT_OPERATION_NOT_UNIQUE', input, `Expected one exact patch operation for ${mutation.statePath}, found ${candidates.length}.`, input.removeNoop);
  }
  const candidate = candidates[0]!;
  if (candidate.operation.action !== 'maintain' || candidate.operation.debtId === undefined) {
    throw refinementError('CODEX_PATCH_REFINEMENT_OPERATION_NOT_ATOMIC', input, 'The authorized no-op is not one atomic maintain operation.', input.removeNoop);
  }
  const mapped = sources.evidenceMap.mutations.filter((item) => stableJson(item.afterValue) === stableJson(candidate.operation));
  if (mapped.length !== 1) {
    throw refinementError('CODEX_PATCH_REFINEMENT_OPERATION_NOT_ATOMIC', input, 'The patch operation maps to more than one state mutation.', input.removeNoop);
  }
  return { patchPath: `/narrativeDebtUpdates/${candidate.index}`, index: candidate.index, operation: candidate.operation };
}

function buildEquivalence(
  paths: ProjectPaths,
  chapterNumber: number,
  storyState: StoryState,
  sourceStateHash: string,
  sourcePatch: CanonPatch,
  refinedPatch: CanonPatch,
  sourcePatchPath: string,
  refinedPatchPath: string
): CandidatePatchRefinementEquivalence {
  const sourceProjected = canonicalProjectedState(applyCanonPatchToStoryState(storyState, sourcePatch).storyState, storyState.updatedAt);
  const refinedProjected = canonicalProjectedState(applyCanonPatchToStoryState(storyState, refinedPatch).storyState, storyState.updatedAt);
  const sourceBusiness = businessState(sourceProjected);
  const refinedBusiness = businessState(refinedProjected);
  const projectedStatesEquivalent = stableJson(sourceProjected) === stableJson(refinedProjected);
  const businessStatesEquivalent = stableJson(sourceBusiness) === stableJson(refinedBusiness);
  const engineMetadataEquivalent = sourceProjected.latestCommittedChapter === refinedProjected.latestCommittedChapter;
  const actualStateDeltaEquivalent = stableJson(delta(storyState, sourceProjected)) === stableJson(delta(storyState, refinedProjected));
  const differences = projectedStatesEquivalent && businessStatesEquivalent && engineMetadataEquivalent && actualStateDeltaEquivalent ? [] : ['Source and refined patch produce different projected Story State.'];
  return CandidatePatchRefinementEquivalenceSchema.parse({
    reportId: `candidate_patch_refinement_equivalence_ch${pad(chapterNumber)}_${createRunId()}`,
    projectId: paths.projectId,
    chapterNumber,
    sourcePatchPath,
    refinedPatchPath,
    sourceStateHash,
    sourceProjectedStateHash: sha256(stableJson(sourceProjected)),
    refinedProjectedStateHash: sha256(stableJson(refinedProjected)),
    projectedStatesEquivalent,
    sourceBusinessStateHash: sha256(stableJson(sourceBusiness)),
    refinedBusinessStateHash: sha256(stableJson(refinedBusiness)),
    businessStatesEquivalent,
    engineMetadataEquivalent,
    removedOperationWasUnconsumed: projectedStatesEquivalent,
    actualStateDeltaEquivalent,
    differences,
    generatedAt: new Date().toISOString(),
    storyStateMutated: false,
    queueMutated: false
  });
}

function buildRefinedDiff(paths: ProjectPaths, sources: RefinementSources, removedMutationId: string, refinedPatchPath: string): RefinedStateDiffReport {
  const changes = sources.evidenceMap.mutations.flatMap((mutation) => mutation.mutationId === removedMutationId
    ? []
    : [{ ...sources.sourceDiff.changes[mutation.diffChangeIndex]!, mutationId: mutation.mutationId }]);
  return RefinedStateDiffReportSchema.parse({
    diffId: `state_diff_refined_ch${pad(sources.review.chapterNumber)}_${createRunId()}`,
    projectId: paths.projectId,
    mode: 'patch_preview',
    patchPath: refinedPatchPath,
    generatedAt: new Date().toISOString(),
    unsafeToCommit: false,
    summary: summarizeChanges(changes),
    changes,
    sourceDiffPath: sources.review.stateDiffPath,
    removedMutationIds: [removedMutationId],
    unchangedMutationCount: changes.length,
    addedMutationCount: 0,
    changedMutationCount: 0,
    actualApplyBased: true
  });
}

function buildLineage(
  paths: ProjectPaths,
  chapterNumber: number,
  sources: RefinementSources,
  newEvidence: CandidatePatchEvidenceMap,
  refinedDiffPath: string,
  oldDecisions: Map<string, { path: string; record: CandidateCommitMutationDecision }>,
  removedMutationId: string
): CandidateCommitMutationLineage {
  const newByFingerprint = new Map(newEvidence.mutations.map((mutation) => [mutationFingerprint(mutation), mutation]));
  const entries: CandidateCommitMutationLineage['entries'] = sources.evidenceMap.mutations.map((oldMutation) => {
    const fingerprint = mutationFingerprint(oldMutation);
    const next = newByFingerprint.get(fingerprint);
    const removed = oldMutation.mutationId === removedMutationId;
    return {
      oldMutationId: oldMutation.mutationId,
      newMutationId: next?.mutationId ?? null,
      mutationFingerprint: fingerprint,
      statePath: oldMutation.statePath,
      mutationType: oldMutation.mutationType,
      beforeHash: sha256(stableJson(oldMutation.beforeValue)),
      afterHash: sha256(stableJson(oldMutation.afterValue)),
      origin: originForMutation(oldMutation.mutationType),
      status: removed ? 'removed_noop' as const : next === undefined ? 'changed' as const : 'unchanged' as const,
      previousDecisionId: oldDecisions.get(oldMutation.mutationId)?.record.decisionId ?? null,
      eligibleForDecisionCarryForward: !removed && next !== undefined,
      reason: removed ? 'Confirmed semantic no-op was removed by authorized local refinement.' : next === undefined ? 'No identical refined mutation fingerprint exists.' : 'Canonical before/after mutation fingerprint is unchanged.'
    };
  });
  for (const mutation of newEvidence.mutations) {
    const fingerprint = mutationFingerprint(mutation);
    if (sources.evidenceMap.mutations.some((oldMutation) => mutationFingerprint(oldMutation) === fingerprint)) continue;
    entries.push({
      oldMutationId: null,
      newMutationId: mutation.mutationId,
      mutationFingerprint: fingerprint,
      statePath: mutation.statePath,
      mutationType: mutation.mutationType,
      beforeHash: sha256(stableJson(mutation.beforeValue)),
      afterHash: sha256(stableJson(mutation.afterValue)),
      origin: originForMutation(mutation.mutationType),
      status: 'added',
      previousDecisionId: null,
      eligibleForDecisionCarryForward: false,
      reason: 'Mutation exists only in the refined diff.'
    });
  }
  return CandidateCommitMutationLineageSchema.parse({
    reportId: `candidate_commit_mutation_lineage_ch${pad(chapterNumber)}_${createRunId()}`,
    projectId: paths.projectId,
    chapterNumber,
    generatedAt: new Date().toISOString(),
    oldReviewPath: sources.reviewPath,
    oldEvidenceMapPath: sources.review.evidenceMapPath,
    sourceDiffPath: sources.review.stateDiffPath,
    refinedDiffPath,
    removedMutationIds: [removedMutationId],
    unchangedMutationCount: entries.filter((entry) => entry.status === 'unchanged').length,
    removedNoopMutationCount: entries.filter((entry) => entry.status === 'removed_noop').length,
    changedMutationCount: entries.filter((entry) => entry.status === 'changed').length,
    addedMutationCount: entries.filter((entry) => entry.status === 'added').length,
    entries,
    storyStateMutated: false,
    queueMutated: false
  });
}

async function writeCarryForwardPreview(input: {
  paths: ProjectPaths;
  fileStore: FileStore;
  chapterNumber: number;
  oldReviewPath: string;
  oldReview: CandidateCommitReview;
  oldEvidence: CandidatePatchEvidenceMap;
  newReviewPath: string;
  newReview: CandidateCommitReview;
  newEvidence: CandidatePatchEvidenceMap;
  lineagePath: string;
  lineage: CandidateCommitMutationLineage;
  oldDecisions: Map<string, { path: string; record: CandidateCommitMutationDecision }>;
  approved: boolean;
  confirmedAt: string | null;
}) {
  const oldEvidenceById = new Map(input.oldEvidence.mutations.map((mutation) => [mutation.mutationId, mutation]));
  const newEvidenceById = new Map(input.newEvidence.mutations.map((mutation) => [mutation.mutationId, mutation]));
  const decisions = input.lineage.entries.flatMap((entry) => {
    if (entry.oldMutationId === null) return [];
    const prior = input.oldDecisions.get(entry.oldMutationId);
    const oldMutation = oldEvidenceById.get(entry.oldMutationId);
    if (prior === undefined || oldMutation === undefined) return [];
    const newMutation = entry.newMutationId === null ? undefined : newEvidenceById.get(entry.newMutationId);
    const beforeEvidenceHash = evidenceHash(oldMutation);
    const afterEvidenceHash = newMutation === undefined ? null : evidenceHash(newMutation);
    const evidenceUnchanged = afterEvidenceHash !== null && beforeEvidenceHash === afterEvidenceHash;
    const eligible = entry.status === 'unchanged' && entry.eligibleForDecisionCarryForward && evidenceUnchanged &&
      !['modify-required', 'reject'].includes(prior.record.decision) && prior.record.mutationOrigin === originForMutation(oldMutation.mutationType) &&
      newMutation !== undefined && oldMutation.statePath === newMutation.statePath && oldMutation.mutationType === newMutation.mutationType;
    return [{
      oldMutationId: entry.oldMutationId,
      newMutationId: entry.newMutationId,
      mutationFingerprint: entry.mutationFingerprint,
      previousDecisionId: prior.record.decisionId,
      previousDecisionPath: prior.path,
      previousDecision: prior.record.decision,
      previousNote: prior.record.note,
      evidenceHashBefore: beforeEvidenceHash,
      evidenceHashAfter: afterEvidenceHash,
      evidenceUnchanged,
      eligible,
      reason: eligible ? 'Mutation fingerprint, evidence, origin, type, path, and source hashes are unchanged.' : entry.status === 'removed_noop' ? 'Removed no-op mutation is intentionally ineligible.' : 'One or more carry-forward eligibility checks failed.'
    }];
  });
  const report = CandidateCommitDecisionCarryForwardSchema.parse({
    reportId: `candidate_commit_decision_carry_forward_ch${pad(input.chapterNumber)}_${createRunId()}`,
    projectId: input.paths.projectId,
    chapterNumber: input.chapterNumber,
    generatedAt: new Date().toISOString(),
    oldReviewPath: input.oldReviewPath,
    newReviewPath: input.newReviewPath,
    lineagePath: input.lineagePath,
    sourceStateHash: input.newReview.sourceStateHash,
    sourceQueueHash: input.newReview.sourceQueueHash,
    sourceFinalHash: input.newReview.finalPreviewHash,
    sourcePatchHash: input.newReview.normalizedPatchHash,
    sourceDiffHash: input.newReview.stateDiffHash,
    eligibleDecisionCount: decisions.filter((decision) => decision.eligible).length,
    ineligibleDecisionCount: decisions.filter((decision) => !decision.eligible).length,
    decisions,
    approved: input.approved,
    confirmedAt: input.confirmedAt,
    operator: 'local_user',
    storyStateMutated: false,
    queueMutated: false
  });
  const artifact = await nextVersionedArtifact(input.paths, input.fileStore, input.chapterNumber, 'candidate_commit_decision_carry_forward_preview');
  await writePair(input.fileStore, artifact, report, CandidateCommitDecisionCarryForwardSchema, renderCarryForward(report));
  return { previewPath: artifact.relativePath, markdownPath: artifact.relativeMarkdownPath, report };
}

async function loadRefinementSources(paths: ProjectPaths, fileStore: FileStore, input: RefineCandidatePatchInput): Promise<RefinementSources> {
  const reviewArtifact = await resolveVersionedSelector(paths, fileStore, input.chapterNumber, 'candidate_commit_review', input.review ?? 'latest');
  const review = await fileStore.readJson(reviewArtifact.absolutePath, CandidateCommitReviewSchema);
  const [evidenceMap, sourcePatchText, sourceDiffText, stateText, queueText, sourcePreview] = await Promise.all([
    fileStore.readJson(paths.projectArtifact(review.evidenceMapPath), CandidatePatchEvidenceMapSchema),
    fileStore.readText(paths.projectArtifact(review.normalizedPatchPath)),
    fileStore.readText(paths.projectArtifact(review.stateDiffPath)),
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue()),
    fileStore.readJson(paths.projectArtifact(review.candidatePreviewReportPath), CodexCandidatePreviewReportSchema)
  ]);
  const sourcePatch = CanonPatchSchema.parse(JSON.parse(sourcePatchText) as unknown);
  const sourceDiff = StateDiffReportSchema.parse(JSON.parse(sourceDiffText) as unknown);
  const storyState = StoryStateSchema.parse(JSON.parse(stateText) as unknown);
  const queue = ChapterQueueSchema.parse(JSON.parse(queueText) as unknown);
  const queueItem = queue.chapters.find((chapter) => chapter.chapterNumber === input.chapterNumber);
  const noopArtifacts = await readVersionedJson(paths, fileStore, input.chapterNumber, 'candidate_patch_noop_analysis', CandidatePatchNoopAnalysisSchema);
  const noopArtifact = noopArtifacts.filter((artifact) => artifact.value.commitReviewPath === reviewArtifact.relativePath).at(-1);
  if (noopArtifact === undefined) throw refinementError('CODEX_PATCH_REFINEMENT_SOURCE_STALE', input, 'No matching no-op analysis exists.', input.removeNoop, reviewArtifact.relativePath);
  const finalizedArtifacts = await readVersionedJson(paths, fileStore, input.chapterNumber, 'candidate_commit_review_finalized', CandidateCommitReviewFinalizedSchema);
  const finalizedArtifact = finalizedArtifacts.filter((artifact) => artifact.value.sourceReviewPath === reviewArtifact.relativePath).at(-1);
  if (finalizedArtifact === undefined) throw refinementError('CODEX_PATCH_REFINEMENT_REVIEW_NOT_ELIGIBLE', input, 'No finalized source review exists.', input.removeNoop, reviewArtifact.relativePath);
  const decisions = await readActiveDecisions(paths, fileStore, input.chapterNumber, reviewArtifact.relativePath);
  const sourceDecision = decisions.get(input.removeNoop);
  if (sourceDecision === undefined) throw refinementError('CODEX_PATCH_REFINEMENT_NOT_AUTHORIZED', input, 'No active human decision authorizes this mutation.', input.removeNoop, reviewArtifact.relativePath);
  const noopMutation = noopArtifact.value.mutations.find((mutation) => mutation.mutationId === input.removeNoop);
  if (noopMutation === undefined || !noopMutation.semanticNoop || noopMutation.metadataChanged) {
    throw refinementError('CODEX_PATCH_REFINEMENT_MUTATION_NOT_NOOP', input, 'Requested mutation is not a confirmed metadata-free semantic no-op.', input.removeNoop, noopArtifact.path);
  }
  if (sourceDecision.record.decision !== 'modify-required' || !sourceDecision.record.semanticNoop) {
    throw refinementError('CODEX_PATCH_REFINEMENT_NOT_AUTHORIZED', input, 'Active decision must be modify-required for the semantic no-op.', input.removeNoop, sourceDecision.path);
  }
  if (finalizedArtifact.value.overallDecision !== 'changes_required' || finalizedArtifact.value.modifyRequiredMutationIds.length !== 1 || finalizedArtifact.value.modifyRequiredMutationIds[0] !== input.removeNoop) {
    const code = finalizedArtifact.value.modifyRequiredMutationIds.length > 1 ? 'CODEX_PATCH_REFINEMENT_MULTIPLE_REQUIRED_CHANGES' : 'CODEX_PATCH_REFINEMENT_REVIEW_NOT_ELIGIBLE';
    throw refinementError(code, input, 'Finalized review must require exactly the requested no-op removal.', input.removeNoop, finalizedArtifact.path);
  }
  if (finalizedArtifact.value.rejectedMutationIds.length > 0 || finalizedArtifact.value.unresolvedMutationIds.length > 0) {
    throw refinementError('CODEX_PATCH_REFINEMENT_REVIEW_NOT_ELIGIBLE', input, 'Rejected or unresolved mutations prevent deterministic refinement.', input.removeNoop, finalizedArtifact.path);
  }
  const hashesValid = review.normalizedPatchHash === sha256(sourcePatchText) && review.stateDiffHash === sha256(sourceDiffText) &&
    review.sourceStateHash === sha256(stateText) && review.sourceQueueHash === sha256(queueText) &&
    review.finalPreviewHash === sha256(await fileStore.readText(paths.projectArtifact(review.finalPreviewPath))) &&
    noopArtifact.value.sourcePatchHash === review.normalizedPatchHash && noopArtifact.value.sourceDiffHash === review.stateDiffHash;
  if (!hashesValid) throw refinementError('CODEX_PATCH_REFINEMENT_SOURCE_STALE', input, 'Source patch, diff, final, state, queue, or no-op hashes are stale.', input.removeNoop, reviewArtifact.relativePath);
  if (!sourcePreview.previewComplete || sourcePreview.recommendedNextStep !== 'human_commit_review' || storyState.latestCommittedChapter !== input.chapterNumber - 1 || queueItem === undefined || ['committed', 'recommitted'].includes(queueItem.status)) {
    throw refinementError('CODEX_PATCH_REFINEMENT_REVIEW_NOT_ELIGIBLE', input, 'Chapter boundary, queue, or candidate preview is no longer eligible.', input.removeNoop, review.candidatePreviewReportPath);
  }
  return {
    reviewPath: reviewArtifact.relativePath,
    review,
    evidenceMap,
    noopPath: noopArtifact.path,
    noop: noopArtifact.value,
    finalizedPath: finalizedArtifact.path,
    finalized: finalizedArtifact.value,
    sourceDecisionPath: sourceDecision.path,
    sourceDecision: sourceDecision.record,
    sourcePatchText,
    sourcePatch,
    sourceDiffText,
    sourceDiff,
    sourcePreview,
    sourcePreviewPath: review.candidatePreviewReportPath,
    stateText,
    storyState,
    queueText
  };
}

function validateRefinedPatchSemantics(input: RefineCandidatePatchInput, state: StoryState, patch: CanonPatch): void {
  if (patch.chapterNumber !== input.chapterNumber || (patch.latestCommittedChapter ?? patch.chapterNumber) !== input.chapterNumber) {
    throw refinementError('CODEX_PATCH_REFINEMENT_REVIEW_NOT_ELIGIBLE', input, 'Refined patch chapter boundary is invalid.', input.removeNoop);
  }
  const debtById = new Map(state.narrativeDebts.map((debt) => [debt.id, debt.status]));
  const legal: Record<string, string[]> = {
    open: ['maintain', 'escalate', 'partially_pay', 'pay', 'cancel'],
    escalated: ['maintain', 'partially_pay', 'pay', 'cancel'],
    partially_paid: ['maintain', 'escalate', 'pay', 'cancel'],
    resolved: ['maintain'],
    cancelled: ['maintain']
  };
  for (const update of patch.narrativeDebtUpdates) {
    if (update.action === 'create') continue;
    const status = update.debtId === undefined ? undefined : debtById.get(update.debtId);
    if (status === undefined || !(legal[status] ?? []).includes(update.action)) {
      throw refinementError('CODEX_PATCH_REFINEMENT_REVIEW_NOT_ELIGIBLE', input, `Illegal narrative debt transition for ${update.debtId ?? 'missing debt id'}.`, input.removeNoop);
    }
  }
  for (const event of patch.timelineEvents) if (event.chapter !== input.chapterNumber) {
    throw refinementError('CODEX_PATCH_REFINEMENT_REVIEW_NOT_ELIGIBLE', input, `Timeline event ${event.id} belongs to chapter ${event.chapter}.`, input.removeNoop);
  }
}

async function verifyCarryForwardFreshness(
  input: CarryForwardCandidateCommitDecisionsInput,
  paths: ProjectPaths,
  preview: CandidateCommitDecisionCarryForward,
  review: CandidateCommitReview,
  evidence: CandidatePatchEvidenceMap,
  lineage: CandidateCommitMutationLineage,
  fileStore: FileStore
): Promise<void> {
  if (preview.projectId !== paths.projectId || preview.chapterNumber !== input.chapterNumber || preview.approved) {
    throw carryError('CODEX_DECISION_CARRY_FORWARD_NOT_ELIGIBLE', input, 'Carry-forward preview is not an unconfirmed matching project artifact.');
  }
  const [stateText, queueText, finalText, patchText, diffText] = await Promise.all([
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue()),
    fileStore.readText(paths.projectArtifact(review.finalPreviewPath)),
    fileStore.readText(paths.projectArtifact(review.normalizedPatchPath)),
    fileStore.readText(paths.projectArtifact(review.stateDiffPath))
  ]);
  if (preview.sourceStateHash !== review.sourceStateHash || preview.sourceQueueHash !== review.sourceQueueHash ||
    preview.sourceFinalHash !== review.finalPreviewHash || preview.sourcePatchHash !== review.normalizedPatchHash || preview.sourceDiffHash !== review.stateDiffHash ||
    preview.sourceStateHash !== sha256(stateText) || preview.sourceQueueHash !== sha256(queueText) ||
    preview.sourceFinalHash !== sha256(finalText) || preview.sourcePatchHash !== sha256(patchText) || preview.sourceDiffHash !== sha256(diffText) ||
    evidence.normalizedPatchHash !== review.normalizedPatchHash || evidence.stateDiffHash !== review.stateDiffHash ||
    lineage.refinedDiffPath !== review.stateDiffPath || preview.lineagePath === '') {
    throw carryError('CODEX_DECISION_CARRY_FORWARD_FINGERPRINT_MISMATCH', input, 'Carry-forward preview source hashes no longer match the refined review.');
  }
  const oldReview = await fileStore.readJson(paths.projectArtifact(preview.oldReviewPath), CandidateCommitReviewSchema);
  const oldEvidence = await fileStore.readJson(paths.projectArtifact(oldReview.evidenceMapPath), CandidatePatchEvidenceMapSchema);
  const oldById = new Map(oldEvidence.mutations.map((mutation) => [mutation.mutationId, mutation]));
  const newById = new Map(evidence.mutations.map((mutation) => [mutation.mutationId, mutation]));
  for (const decision of preview.decisions) {
    const lineageEntry = lineage.entries.find((entry) => entry.oldMutationId === decision.oldMutationId);
    const oldMutation = oldById.get(decision.oldMutationId);
    const newMutation = decision.newMutationId === null ? undefined : newById.get(decision.newMutationId);
    if (lineageEntry === undefined || oldMutation === undefined || lineageEntry.mutationFingerprint !== decision.mutationFingerprint ||
      mutationFingerprint(oldMutation) !== decision.mutationFingerprint ||
      (newMutation !== undefined && mutationFingerprint(newMutation) !== decision.mutationFingerprint)) {
      throw carryError('CODEX_DECISION_CARRY_FORWARD_FINGERPRINT_MISMATCH', input, `Mutation fingerprint changed for ${decision.oldMutationId}.`, decision.oldMutationId);
    }
    const expectedBefore = evidenceHash(oldMutation);
    const expectedAfter = newMutation === undefined ? null : evidenceHash(newMutation);
    if (decision.evidenceHashBefore !== expectedBefore || decision.evidenceHashAfter !== expectedAfter || decision.evidenceUnchanged !== (expectedAfter !== null && expectedBefore === expectedAfter)) {
      throw carryError('CODEX_DECISION_CARRY_FORWARD_EVIDENCE_CHANGED', input, `Evidence hash changed for ${decision.oldMutationId}.`, decision.oldMutationId);
    }
  }
}

export function mutationFingerprint(mutation: {
  mutationType: CandidateCommitMutationType;
  statePath: string;
  beforeValue: unknown;
  afterValue: unknown;
}): string {
  return sha256(stableJson({
    mutationOrigin: originForMutation(mutation.mutationType),
    mutationType: mutation.mutationType,
    statePath: mutation.statePath,
    beforeValue: mutation.beforeValue,
    afterValue: mutation.afterValue
  }));
}

function evidenceHash(mutation: CandidatePatchEvidenceMap['mutations'][number]): string {
  return sha256(stableJson({
    statePath: mutation.statePath,
    mutationType: mutation.mutationType,
    evidenceSnippets: mutation.evidenceSnippets,
    evidenceParagraphIndexes: mutation.evidenceParagraphIndexes,
    evidenceHashes: mutation.evidenceHashes,
    relatedMissionGoals: mutation.relatedMissionGoals,
    relatedPlanItems: mutation.relatedPlanItems,
    supportedByFinal: mutation.supportedByFinal,
    supportedByMission: mutation.supportedByMission,
    supportedBySelectedPlan: mutation.supportedBySelectedPlan,
    legalStateTransition: mutation.legalStateTransition,
    duplicateRisk: mutation.duplicateRisk,
    prematureResolutionRisk: mutation.prematureResolutionRisk,
    readerLeakRisk: mutation.readerLeakRisk,
    characterKnowledgeRisk: mutation.characterKnowledgeRisk
  }));
}

function assertLineageEligible(input: RefineCandidatePatchInput, lineage: CandidateCommitMutationLineage): void {
  if (lineage.removedNoopMutationCount !== 1 || lineage.removedMutationIds.length !== 1 || lineage.removedMutationIds[0] !== input.removeNoop) {
    throw refinementError('CODEX_PATCH_REFINEMENT_NOT_SEMANTICALLY_EQUIVALENT', input, 'Mutation lineage did not remove exactly the authorized no-op.', input.removeNoop);
  }
  if (lineage.changedMutationCount > 0 || lineage.addedMutationCount > 0) {
    throw refinementError('CODEX_DECISION_CARRY_FORWARD_FINGERPRINT_MISMATCH', input, 'Refinement introduced changed or added mutation fingerprints.', input.removeNoop);
  }
}

function ensureEquivalent(input: RefineCandidatePatchInput, report: CandidatePatchRefinementEquivalence): void {
  if (!report.projectedStatesEquivalent || !report.businessStatesEquivalent || !report.engineMetadataEquivalent || !report.removedOperationWasUnconsumed || !report.actualStateDeltaEquivalent || report.differences.length > 0) {
    throw refinementError('CODEX_PATCH_REFINEMENT_NOT_SEMANTICALLY_EQUIVALENT', input, 'Removing the requested operation changes projected Story State.', input.removeNoop);
  }
}

function canonicalProjectedState(state: StoryState, updatedAt: string): StoryState {
  return StoryStateSchema.parse({ ...state, updatedAt });
}

function businessState(state: StoryState): Omit<StoryState, 'latestCommittedChapter' | 'updatedAt'> {
  const { latestCommittedChapter: _latest, updatedAt: _updatedAt, ...business } = state;
  return business;
}

function delta(before: StoryState, after: StoryState): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(after) as Array<keyof StoryState>) {
    if (stableJson(before[key]) !== stableJson(after[key])) output[key] = after[key];
  }
  return output;
}

function summarizeChanges(changes: StateDiffChange[]): RefinedStateDiffReport['summary'] {
  return {
    totalChanges: changes.length,
    added: changes.filter((change) => change.changeType === 'added').length,
    removed: changes.filter((change) => change.changeType === 'removed').length,
    modified: changes.filter((change) => change.changeType === 'modified').length,
    unchanged: changes.filter((change) => change.changeType === 'unchanged').length,
    highRiskChanges: changes.filter((change) => change.riskLevel === 'high' || change.riskLevel === 'critical').length
  };
}

function originForMutation(type: CandidateCommitMutationType): CandidateCommitMutationOrigin {
  if (type === 'latest_committed_chapter') return 'engine_metadata';
  if (type === 'narrative_debt' || type === 'foreshadowing' || type === 'relationship') return 'narrative_state';
  if (type === 'reader_state') return 'reader_state';
  if (type === 'character_state') return 'character_state';
  return 'story_content';
}

async function readActiveDecisions(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, reviewPath: string) {
  const artifacts = await readVersionedJson(paths, fileStore, chapterNumber, 'candidate_commit_mutation_decision', CandidateCommitMutationDecisionSchema);
  const active = new Map<string, { path: string; record: CandidateCommitMutationDecision }>();
  for (const artifact of artifacts.filter((item) => item.value.commitReviewPath === reviewPath)) {
    active.set(artifact.value.mutationId, { path: artifact.path, record: artifact.value });
  }
  return active;
}

async function captureProtected(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, sources: RefinementSources) {
  return {
    state: await fileStore.readText(paths.storyState()),
    queue: await fileStore.readText(paths.chapterQueue()),
    proposal: await fileStore.readText(paths.projectArtifact(sources.review.patchProposalPath)),
    normalizedPatch: sources.sourcePatchText,
    sourceDiff: sources.sourceDiffText,
    sourceReview: await fileStore.readText(paths.projectArtifact(sources.reviewPath)),
    sourceFinalized: await fileStore.readText(paths.projectArtifact(sources.finalizedPath)),
    finalCandidate: await fileStore.readText(paths.projectArtifact(sources.review.finalPreviewPath)),
    adoptedDraft: await fileStore.readText(paths.projectArtifact(sources.review.adoptedDraftPath)),
    snapshots: (await fileStore.list(paths.snapshotsDir())).sort(),
    canonicalFinal: await readOptional(fileStore, paths.chapterArtifact(chapterNumber, 'final.md')),
    canonicalPatch: await readOptional(fileStore, paths.chapterArtifact(chapterNumber, 'canon_patch.json')),
    commitReport: await readOptional(fileStore, paths.chapterArtifact(chapterNumber, 'commit_report.json'))
  };
}

async function assertProtectedUnchanged(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, sources: RefinementSources, before: Awaited<ReturnType<typeof captureProtected>>) {
  const after = await captureProtected(paths, fileStore, chapterNumber, sources);
  if (stableJson(before) !== stableJson(after)) throw refinementError('CODEX_PATCH_REFINEMENT_SOURCE_STALE', { projectId: paths.projectId, chapterNumber, removeNoop: '' }, 'A protected source or canonical artifact changed during refinement.');
}

async function captureSimpleProtected(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, review: CandidateCommitReview) {
  return {
    state: await fileStore.readText(paths.storyState()),
    queue: await fileStore.readText(paths.chapterQueue()),
    finalCandidate: await fileStore.readText(paths.projectArtifact(review.finalPreviewPath)),
    refinedPatch: await fileStore.readText(paths.projectArtifact(review.normalizedPatchPath)),
    refinedDiff: await fileStore.readText(paths.projectArtifact(review.stateDiffPath)),
    snapshots: (await fileStore.list(paths.snapshotsDir())).sort(),
    canonicalFinal: await readOptional(fileStore, paths.chapterArtifact(chapterNumber, 'final.md')),
    canonicalPatch: await readOptional(fileStore, paths.chapterArtifact(chapterNumber, 'canon_patch.json')),
    commitReport: await readOptional(fileStore, paths.chapterArtifact(chapterNumber, 'commit_report.json'))
  };
}

async function assertSimpleProtectedUnchanged(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, review: CandidateCommitReview, before: Awaited<ReturnType<typeof captureSimpleProtected>>) {
  const after = await captureSimpleProtected(paths, fileStore, chapterNumber, review);
  if (stableJson(before) !== stableJson(after)) throw carryError('CODEX_DECISION_CARRY_FORWARD_NOT_ELIGIBLE', { projectId: paths.projectId, chapterNumber }, 'Protected artifacts changed during carry-forward.');
}

async function writePair<T>(fileStore: FileStore, artifact: VersionedArtifact, value: T, schema: z.ZodType<T>, markdown: string): Promise<void> {
  await fileStore.writeJson(artifact.absolutePath, value, schema);
  await fileStore.writeText(artifact.markdownPath, markdown);
}

async function startReadOnlyRun(logger: RunLogger, runId: string, command: string, chapterNumber: number, args: Record<string, unknown>) {
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

async function nextVersionedArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string, withMarkdown = true): Promise<VersionedArtifact> {
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
    artifacts.push({
      version,
      absolutePath: paths.chapterArtifact(chapterNumber, entry),
      relativePath: relativeChapterArtifact(chapterNumber, entry),
      markdownPath: paths.chapterArtifact(chapterNumber, `${baseName}_v${version}.md`),
      relativeMarkdownPath: relativeChapterArtifact(chapterNumber, `${baseName}_v${version}.md`)
    });
  }
  return artifacts.sort((left, right) => left.version - right.version);
}

async function resolveVersionedSelector(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string, selector: string) {
  if (selector !== 'latest') {
    const relativePath = selector.split(/[\\/]+/).join(path.sep);
    const absolutePath = paths.projectArtifact(relativePath);
    if (!(await fileStore.exists(absolutePath))) throw new AppError('CODEX_PATCH_REFINEMENT_SOURCE_STALE', `Required artifact does not exist: ${selector}`, 2);
    return { absolutePath, relativePath };
  }
  const artifact = (await listVersionedArtifacts(paths, fileStore, chapterNumber, baseName)).at(-1);
  if (artifact === undefined) throw new AppError('CODEX_PATCH_REFINEMENT_SOURCE_STALE', `No ${baseName} artifact exists.`, 2);
  return artifact;
}

async function readVersionedJson<T>(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string, schema: { parse(value: unknown): T }) {
  const output: Array<{ path: string; value: T }> = [];
  for (const artifact of await listVersionedArtifacts(paths, fileStore, chapterNumber, baseName)) {
    output.push({ path: artifact.relativePath, value: schema.parse(JSON.parse(await fileStore.readText(artifact.absolutePath)) as unknown) });
  }
  return output;
}

function refinementError(code: string, input: Pick<RefineCandidatePatchInput, 'projectId' | 'chapterNumber' | 'removeNoop'>, reason: string, mutationId?: string, sourceArtifactPath?: string) {
  return new AppError(code, reason, 2, {
    chapterNumber: input.chapterNumber,
    reason,
    suggestedNextCommand: `corepack pnpm novel-loop review ${input.projectId} ${input.chapterNumber} --diagnostics --artifacts --state --suggest-next`,
    ...(mutationId === undefined ? {} : { affectedMutationId: mutationId }),
    ...(sourceArtifactPath === undefined ? {} : { sourceArtifactPath }),
    storyStateMutated: false,
    queueMutated: false
  });
}

function carryError(code: string, input: Pick<CarryForwardCandidateCommitDecisionsInput, 'projectId' | 'chapterNumber'>, reason: string, mutationId?: string) {
  return new AppError(code, reason, 2, {
    chapterNumber: input.chapterNumber,
    reason,
    suggestedNextCommand: `corepack pnpm novel-loop codex decide-candidate-commit-change ${input.projectId} ${input.chapterNumber} --review latest --mutation ${mutationId ?? '<mutationId>'} --decision approve --note <reason>`,
    ...(mutationId === undefined ? {} : { affectedMutationId: mutationId }),
    storyStateMutated: false,
    queueMutated: false
  });
}

function renderManifest(report: Awaited<ReturnType<typeof CandidatePatchRefinementManifestSchema.parse>>) { return `# Candidate Patch Refinement Manifest\n\n- refinedPatchPath: ${report.refinedPatchPath}\n- removedMutationIds: ${report.removedMutationIds.join(', ')}\n- refinementReason: ${report.refinementReason}\n- semanticChangeIntended: false\n- storyStateMutated: false\n- queueMutated: false\n`; }
function renderEquivalence(report: CandidatePatchRefinementEquivalence) { return `# Candidate Patch Refinement Equivalence\n\n- projectedStatesEquivalent: ${report.projectedStatesEquivalent}\n- businessStatesEquivalent: ${report.businessStatesEquivalent}\n- actualStateDeltaEquivalent: ${report.actualStateDeltaEquivalent}\n- removedOperationWasUnconsumed: ${report.removedOperationWasUnconsumed}\n`; }
function renderValidation(report: Awaited<ReturnType<typeof CandidatePatchRefinedValidationSchema.parse>>) { return `# Refined Patch Validation\n\n- refinedPatchPath: ${report.refinedPatchPath}\n- CanonPatchSchema: valid\n- narrative debt FSM: valid\n- timeline: valid\n- knowledge checks: valid\n`; }
function renderConflict(report: Awaited<ReturnType<typeof CandidatePatchRefinedConflictSchema.parse>>) { return `# Refined Patch Conflict Check\n\n- conflictCheckPassed: ${report.conflictCheckPassed}\n- hard: ${report.hard.length}\n- warnings: ${report.warnings.length}\n`; }
function renderRefinedDiff(report: RefinedStateDiffReport) { return `# Refined State Diff\n\n- actualApplyBased: true\n- totalChanges: ${report.summary.totalChanges}\n- removedMutationIds: ${report.removedMutationIds.join(', ')}\n\n${report.changes.map((change) => `- ${change.path}: ${change.changeType} (${change.riskLevel})`).join('\n')}\n`; }
function renderCompleteness(report: Awaited<ReturnType<typeof CodexPreviewCompletenessReportSchema.parse>>) { return `# Refined Candidate Preview Completeness\n\n- complete: ${report.complete}\n- storyStateMutated: ${report.storyStateMutated}\n- conflictCheckPassed: ${String(report.conflictCheckPassed)}\n`; }
function renderPreview(report: CodexCandidatePreviewReport) { return `# Refined Candidate Preview\n\n- normalizedPatchPath: ${report.normalizedPatchPath}\n- stateDiffPath: ${report.stateDiffPath}\n- previewComplete: ${report.previewComplete}\n- storyStateMutated: false\n- queueCommitted: false\n`; }
function renderLineage(report: CandidateCommitMutationLineage) { return `# Candidate Commit Mutation Lineage\n\n${report.entries.map((entry) => `- ${entry.oldMutationId ?? 'new'} -> ${entry.newMutationId ?? 'removed'}: ${entry.status}; ${entry.statePath}`).join('\n')}\n`; }
function renderHighRisk(report: Awaited<ReturnType<typeof CandidateRefinedHighRiskReviewSchema.parse>>) { return `# Refined High-risk State Change Review\n\n- changesReviewed: ${report.changesReviewed}\n- highRiskMutationIds: ${report.highRiskMutationIds.join(', ') || 'none'}\n- decision: ${report.decision}\n`; }
function renderCarryForward(report: CandidateCommitDecisionCarryForward) { return `# Candidate Commit Decision Carry-forward\n\n- approved: ${report.approved}\n- eligibleDecisionCount: ${report.eligibleDecisionCount}\n- ineligibleDecisionCount: ${report.ineligibleDecisionCount}\n${report.decisions.map((decision) => `- ${decision.oldMutationId} -> ${decision.newMutationId ?? 'removed'}: eligible=${decision.eligible}`).join('\n')}\n`; }

function createPaths(input: { projectId: string; projectsRoot?: string }) { return new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId); }
function relativeChapterArtifact(chapterNumber: number, fileName: string) { return path.posix.join('chapters', `chapter_${pad(chapterNumber)}`, fileName); }
function pad(chapterNumber: number) { return String(chapterNumber).padStart(3, '0'); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function asRecord(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
async function readOptional(fileStore: FileStore, absolutePath: string) { return await fileStore.exists(absolutePath) ? fileStore.readText(absolutePath) : null; }
