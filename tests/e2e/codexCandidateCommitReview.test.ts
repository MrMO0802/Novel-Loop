import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { reviewCodexCandidateCommit } from '../../src/app/codexCandidateCommitReview.js';
import {
  CandidateCommitReviewSchema,
  CandidatePatchEvidenceMapSchema,
  RunManifestV2Schema,
  StateDiffReportSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { AppError } from '../../src/utils/AppError.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareAdoptedRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';
import { runCodexCandidatePreview } from '../../src/app/codexCandidatePreview.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d4a-review-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

async function preparePreview(store = new FileStore()) {
  const prepared = await prepareAdoptedRevisionCandidateProject(tempRoot, store);
  const fake = await writeFakeCodex(tempRoot, 'codex-candidate-preview');
  const preview = await runCodexCandidatePreview({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    draft: 'draft_v2',
    approval: 'latest',
    codexBin: fake.codexBin
  }, store);
  return { ...prepared, preview };
}

describe('M27.12D4A candidate commit review', () => {
  test('normalizes legacy state diff endpoints omitted by JSON serialization', () => {
    const parsed = StateDiffReportSchema.parse({
      diffId: 'legacy_diff',
      projectId: 'demo-novel',
      mode: 'patch_preview',
      generatedAt: '2026-01-01T00:00:00.000Z',
      unsafeToCommit: false,
      summary: { totalChanges: 1, added: 0, removed: 0, modified: 1, unchanged: 0, highRiskChanges: 0 },
      changes: [{ path: '/characters/example/goal', changeType: 'modified', after: 'new goal', riskLevel: 'medium', explanation: 'legacy diff omitted undefined before' }]
    });
    expect(parsed.changes[0]?.before).toBeNull();
    expect(parsed.changes[0]?.after).toBe('new goal');
  });

  test('reviews every state diff change with bounded evidence and keeps high-risk changes human-gated', async () => {
    const store = new FileStore();
    const prepared = await preparePreview(store);
    const protectedBefore = await Promise.all([
      store.readText(prepared.paths.storyState()),
      store.readText(prepared.paths.chapterQueue()),
      store.readText(prepared.paths.chapterArtifact(1, 'draft_v2.md')),
      store.readText(prepared.paths.chapterArtifact(1, 'final_candidate_preview_v2.md')),
      store.readText(prepared.paths.chapterArtifact(1, 'canon_patch_codex_normalized_v2.json'))
    ]);

    const result = await reviewCodexCandidateCommit({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      preview: 'latest'
    }, store);

    const review = await store.readJson(prepared.paths.projectArtifact(result.reviewPath), CandidateCommitReviewSchema);
    const evidence = await store.readJson(prepared.paths.projectArtifact(result.evidenceMapPath), CandidatePatchEvidenceMapSchema);
    const diff = await store.readJson(prepared.paths.projectArtifact(prepared.preview.report.stateDiffPath!), StateDiffReportSchema);
    expect(review.changes).toHaveLength(diff.changes.length);
    expect(evidence.mutations).toHaveLength(diff.changes.length);
    expect(new Set(review.changes.map((change) => change.statePath))).toEqual(new Set(diff.changes.map((change) => change.path)));
    expect(new Set(evidence.mutations.map((change) => change.statePath))).toEqual(new Set(diff.changes.map((change) => change.path)));
    expect(review.highRiskChanges).toHaveLength(diff.summary.highRiskChanges);
    const requiredIds = new Set(review.requiredHumanDecisions.map((decision) => decision.mutationId));
    expect(evidence.mutations.filter((mutation) => mutation.riskLevel === 'high' || mutation.riskLevel === 'critical').every((mutation) => requiredIds.has(mutation.mutationId))).toBe(true);
    expect(review.overallDecision).toBe('human_review_incomplete');
    expect(review.patchReview).toMatchObject({ proposalSchemaValid: true, normalizedSchemaValid: true, proposalNormalizationEquivalent: true, decision: 'approve' });
    expect(review.conflictReview).toMatchObject({ conflictCheckPassed: true, conflictCount: 0, decision: 'approve' });
    expect(review.storyStateMutated).toBe(false);
    expect(review.queueMutated).toBe(false);
    expect(evidence.mutations.every((mutation) => mutation.evidenceSnippets.every((snippet) => snippet.length <= 240))).toBe(true);
    expect(evidence.mutations.every((mutation) => mutation.evidenceSnippets.every((snippet) => snippet.replace(/\s+/g, '').length >= 8))).toBe(true);
    expect(evidence.mutations.every((mutation) => mutation.evidenceSnippets.length === mutation.evidenceHashes.length)).toBe(true);

    const protectedAfter = await Promise.all([
      store.readText(prepared.paths.storyState()),
      store.readText(prepared.paths.chapterQueue()),
      store.readText(prepared.paths.chapterArtifact(1, 'draft_v2.md')),
      store.readText(prepared.paths.chapterArtifact(1, 'final_candidate_preview_v2.md')),
      store.readText(prepared.paths.chapterArtifact(1, 'canon_patch_codex_normalized_v2.json'))
    ]);
    expect(protectedAfter).toEqual(protectedBefore);
    expect(await store.exists(prepared.paths.chapterArtifact(1, 'final.md'))).toBe(false);
    expect(await store.exists(prepared.paths.chapterArtifact(1, 'canon_patch.json'))).toBe(false);
    expect(await store.exists(prepared.paths.chapterArtifact(1, 'commit_report.json'))).toBe(false);
    expect(await store.list(prepared.paths.snapshotsDir())).toEqual([]);

    const run = await store.readJson(prepared.paths.runManifest(result.runId), RunManifestV2Schema);
    expect(run.promptCalls).toEqual([]);
    expect(run.llmCalls).toEqual([]);
    expect(run.stateMutations).toEqual([]);
    expect(run.queueTransitions).toEqual([]);
    expect(run.snapshots).toEqual([]);
  }, 90_000);

  test('produces detailed narrative debt review without automatically approving the commit', async () => {
    const store = new FileStore();
    const prepared = await preparePreview(store);
    const result = await reviewCodexCandidateCommit({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      preview: 'latest'
    }, store);

    expect(result.report.narrativeDebtReview.details.length).toBeGreaterThan(0);
    expect(result.report.narrativeDebtReview.details.every((debt) => debt.transitionAllowed)).toBe(true);
    expect(result.report.narrativeDebtReview.details.every((debt) => debt.decision === 'needs_human_review')).toBe(true);
    expect(result.report.overallDecision).not.toBe('approved_for_commit');
    expect(result.report.commitApprovalGenerated).toBe(false);
    expect(result.report.recommendedNextStep).toBe('record_human_commit_decisions');
  }, 90_000);

  test('rejects stale preview sources before writing review artifacts', async () => {
    const store = new FileStore();
    const prepared = await preparePreview(store);
    await store.writeText(prepared.paths.chapterArtifact(1, 'final_candidate_preview_v2.md'), '# tampered final\n');

    await expect(reviewCodexCandidateCommit({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      preview: 'latest'
    }, store)).rejects.toMatchObject<Partial<AppError>>({ code: 'CODEX_CANDIDATE_COMMIT_REVIEW_STALE' });
    expect((await store.list(prepared.paths.chapterDir(1))).some((entry) => /^candidate_commit_review_v\d+\.json$/.test(entry))).toBe(false);
    expect((await store.list(prepared.paths.chapterDir(1))).some((entry) => /^candidate_patch_evidence_map_v\d+\.json$/.test(entry))).toBe(false);
  }, 90_000);
});
