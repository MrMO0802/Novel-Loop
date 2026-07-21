import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  carryForwardCandidateCommitDecisions,
  refineCandidatePatch
} from '../../src/app/codexCandidatePatchRefinement.js';
import {
  approveCandidateCommit,
  finalizeCandidateCommitReview
} from '../../src/app/codexCandidateCommitDecision.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import {
  CandidateCommitDecisionCarryForwardSchema,
  CandidateCommitMutationLineageSchema,
  CandidatePatchRefinementEquivalenceSchema,
  CandidatePatchRefinementManifestSchema,
  CanonPatchSchema,
  RefinedStateDiffReportSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { AppError } from '../../src/utils/AppError.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareCandidatePatchRefinementProject } from './codexCandidatePatchRefinementFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d4a2-refinement-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D4A.2 versioned candidate patch refinement', () => {
  test('removes only the authorized no-op and proves dry-run apply equivalence without protected side effects', async () => {
    const store = new FileStore();
    const prepared = await prepareCandidatePatchRefinementProject(tempRoot, store);
    const protectedBefore = await protectedArtifacts(prepared, store);
    const sourcePatchText = await store.readText(prepared.paths.projectArtifact(prepared.review.report.normalizedPatchPath));

    const result = await refineCandidatePatch({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: prepared.review.reviewPath,
      removeNoop: prepared.noOpMutation.mutationId,
      confirm: true
    }, store);

    const manifest = await store.readJson(prepared.paths.projectArtifact(result.manifestPath), CandidatePatchRefinementManifestSchema);
    const equivalence = await store.readJson(prepared.paths.projectArtifact(result.equivalencePath), CandidatePatchRefinementEquivalenceSchema);
    const diff = await store.readJson(prepared.paths.projectArtifact(result.stateDiffPath), RefinedStateDiffReportSchema);
    const lineage = await store.readJson(prepared.paths.projectArtifact(result.lineagePath), CandidateCommitMutationLineageSchema);
    const refined = await store.readJson(prepared.paths.projectArtifact(result.refinedPatchPath), CanonPatchSchema);

    expect(manifest.removedMutationIds).toEqual([prepared.noOpMutation.mutationId]);
    expect(refined.narrativeDebtUpdates).toHaveLength((await store.readJson(prepared.paths.projectArtifact(prepared.review.report.normalizedPatchPath), CanonPatchSchema)).narrativeDebtUpdates.length - 1);
    expect(equivalence).toMatchObject({
      projectedStatesEquivalent: true,
      businessStatesEquivalent: true,
      actualStateDeltaEquivalent: true,
      differences: []
    });
    expect(diff.changes.some((change) => change.path === prepared.noOpMutation.statePath)).toBe(false);
    expect(diff.changes.some((change) => change.mutationId === prepared.noOpMutation.mutationId)).toBe(false);
    expect(result.review.report.changes.some((change) => change.mutationId === prepared.noOpMutation.mutationId)).toBe(false);
    expect(diff.actualApplyBased).toBe(true);
    expect(lineage.entries.filter((entry) => entry.status === 'removed_noop')).toHaveLength(1);
    expect(lineage.entries.filter((entry) => entry.status === 'changed' || entry.status === 'added')).toEqual([]);
    expect(lineage.entries.filter((entry) => entry.status === 'unchanged')).toHaveLength(prepared.review.report.changes.length - 1);
    expect(result.review.report.changes).toHaveLength(prepared.review.report.changes.length - 1);
    expect(result.noopAnalysis.report.semanticNoopCount).toBe(0);
    expect(result.carryForwardPreview.report.approved).toBe(false);
    expect(await store.readText(prepared.paths.projectArtifact(prepared.review.report.normalizedPatchPath))).toBe(sourcePatchText);
    expect(await protectedArtifacts(prepared, store)).toEqual(protectedBefore);
  }, 120_000);

  test('blocks removal of a mutation that is not the uniquely authorized semantic no-op', async () => {
    const store = new FileStore();
    const prepared = await prepareCandidatePatchRefinementProject(tempRoot, store);
    const protectedBefore = await protectedArtifacts(prepared, store);
    const nonNoop = prepared.noop.report.mutations.find((mutation) => !mutation.semanticNoop)!;

    await expect(refineCandidatePatch({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: prepared.review.reviewPath,
      removeNoop: nonNoop.mutationId,
      confirm: true
    }, store)).rejects.toMatchObject<Partial<AppError>>({ code: 'CODEX_PATCH_REFINEMENT_MUTATION_NOT_NOOP' });
    expect(await protectedArtifacts(prepared, store)).toEqual(protectedBefore);
  }, 120_000);

  test('requires explicit confirmation and creates new append-only decisions for unchanged mutations', async () => {
    const store = new FileStore();
    const prepared = await prepareCandidatePatchRefinementProject(tempRoot, store);
    const refined = await refineCandidatePatch({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: prepared.review.reviewPath,
      removeNoop: prepared.noOpMutation.mutationId,
      confirm: true
    }, store);

    await expect(carryForwardCandidateCommitDecisions({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      preview: refined.carryForwardPreview.previewPath,
      confirm: false
    }, store)).rejects.toMatchObject<Partial<AppError>>({ code: 'CODEX_DECISION_CARRY_FORWARD_NOT_ELIGIBLE' });

    const previewPath = prepared.paths.projectArtifact(refined.carryForwardPreview.previewPath);
    const originalPreview = await store.readJson(previewPath, CandidateCommitDecisionCarryForwardSchema);
    const eligibleIndex = originalPreview.decisions.findIndex((decision) => decision.eligible);
    const fingerprintTampered = structuredClone(originalPreview);
    fingerprintTampered.decisions[eligibleIndex]!.mutationFingerprint = '0'.repeat(64);
    await store.writeJson(previewPath, fingerprintTampered, CandidateCommitDecisionCarryForwardSchema);
    await expect(carryForwardCandidateCommitDecisions({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      preview: refined.carryForwardPreview.previewPath,
      confirm: true
    }, store)).rejects.toMatchObject<Partial<AppError>>({ code: 'CODEX_DECISION_CARRY_FORWARD_FINGERPRINT_MISMATCH' });
    const evidenceTampered = structuredClone(originalPreview);
    evidenceTampered.decisions[eligibleIndex]!.evidenceHashAfter = 'f'.repeat(64);
    evidenceTampered.decisions[eligibleIndex]!.evidenceUnchanged = false;
    await store.writeJson(previewPath, evidenceTampered, CandidateCommitDecisionCarryForwardSchema);
    await expect(carryForwardCandidateCommitDecisions({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      preview: refined.carryForwardPreview.previewPath,
      confirm: true
    }, store)).rejects.toMatchObject<Partial<AppError>>({ code: 'CODEX_DECISION_CARRY_FORWARD_EVIDENCE_CHANGED' });
    await store.writeJson(previewPath, originalPreview, CandidateCommitDecisionCarryForwardSchema);

    const carried = await carryForwardCandidateCommitDecisions({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      preview: refined.carryForwardPreview.previewPath,
      confirm: true
    }, store);
    const report = await store.readJson(prepared.paths.projectArtifact(carried.reportPath), CandidateCommitDecisionCarryForwardSchema);
    expect(report.approved).toBe(true);
    expect(carried.decisionPaths).toHaveLength(refined.review.report.changes.length);
    expect(carried.records.every((record) => record.carriedForwardFromDecisionId !== null && record.operatorConfirmed)).toBe(true);
    expect(carried.records.filter((record) => record.mutationOrigin === 'engine_metadata').map((record) => record.decision)).toEqual(['conditional-approve']);

    const finalized = await finalizeCandidateCommitReview({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: refined.review.reviewPath
    }, store);
    expect(finalized.report).toMatchObject({ overallDecision: 'approved_for_commit', activeDecisionCount: refined.review.report.changes.length });
    const approval = await approveCandidateCommit({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: finalized.reviewPath,
      confirm: true
    }, store);
    expect(approval.record.sourcePatchHash).toBe(refined.review.report.normalizedPatchHash);
    expect(approval.record.sourceDiffHash).toBe(refined.review.report.stateDiffHash);
    expect(approval.record.consumed).toBe(false);
    expect(await store.exists(prepared.paths.chapterArtifact(1, 'final.md'))).toBe(false);
    expect(await store.exists(prepared.paths.chapterArtifact(1, 'canon_patch.json'))).toBe(false);
    expect(await store.exists(prepared.paths.chapterArtifact(1, 'commit_report.json'))).toBe(false);
  }, 120_000);

  test('strict audit verifies the refined chain and review exposes the approval gate', async () => {
    const store = new FileStore();
    const prepared = await prepareCandidatePatchRefinementProject(tempRoot, store);
    const refined = await refineCandidatePatch({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: prepared.review.reviewPath,
      removeNoop: prepared.noOpMutation.mutationId,
      confirm: true
    }, store);
    await carryForwardCandidateCommitDecisions({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      preview: refined.carryForwardPreview.previewPath,
      confirm: true
    }, store);
    const finalized = await finalizeCandidateCommitReview({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: refined.review.reviewPath
    }, store);
    await approveCandidateCommit({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: finalized.reviewPath,
      confirm: true
    }, store);

    const output = await reviewChapter({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      diagnostics: true,
      artifacts: true,
      state: true,
      suggestNext: true
    }, store);
    const refinedMutationCount = refined.review.report.changes.length;
    expect(output).toContain(`decision progress: ${refinedMutationCount}/${refinedMutationCount}`);
    expect(output).toContain(`active decisions: ${refinedMutationCount}`);
    expect(output).not.toContain(`decision progress: ${refinedMutationCount + 1}/${refinedMutationCount}`);
    expect(output).toContain(`refinedPatch: ${refined.refinedPatchPath}`);
    expect(output).toContain('projectedStatesEquivalent: true');
    expect(output).toContain('carryForwardApproved: true');
    expect(output).toContain('commit approval status: approved, unconsumed');

    const audit = await auditProject({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.report.issues.filter((issue) => issue.blocking && issue.category === 'candidate_patch_refinement')).toEqual([]);
  }, 120_000);
});

async function protectedArtifacts(
  prepared: Awaited<ReturnType<typeof prepareCandidatePatchRefinementProject>>,
  store: FileStore
) {
  return {
    state: await store.readText(prepared.paths.storyState()),
    queue: await store.readText(prepared.paths.chapterQueue()),
    draft: await store.readText(prepared.paths.chapterArtifact(1, 'draft_v2.md')),
    finalCandidate: await store.readText(prepared.paths.chapterArtifact(1, 'final_candidate_preview_v2.md')),
    snapshots: await store.list(prepared.paths.snapshotsDir()),
    canonicalFinal: await store.exists(prepared.paths.chapterArtifact(1, 'final.md')),
    canonicalPatch: await store.exists(prepared.paths.chapterArtifact(1, 'canon_patch.json')),
    commitReport: await store.exists(prepared.paths.chapterArtifact(1, 'commit_report.json'))
  };
}
