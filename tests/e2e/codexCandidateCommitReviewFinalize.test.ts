import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  analyzeCandidatePatchNoops,
  decideCandidateCommitChange,
  finalizeCandidateCommitReview
} from '../../src/app/codexCandidateCommitDecision.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareCandidateCommitDecisionProject } from './codexCandidateCommitDecisionFixtures.js';

let tempRoot: string;
let store: FileStore;
let prepared: Awaited<ReturnType<typeof prepareCandidateCommitDecisionProject>>;
let modifiedBusinessMutationId: string;

beforeAll(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d4a1-finalize-');
  store = new FileStore();
  prepared = await prepareCandidateCommitDecisionProject(tempRoot, store);
  await analyzeCandidatePatchNoops({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest' }, store);
});

afterAll(async () => {
  await removeTempRoot(tempRoot);
});

async function decideAll(
  prepared: Awaited<ReturnType<typeof prepareCandidateCommitDecisionProject>>,
  store: FileStore,
  override?: { mutationId: string; decision: 'reject' | 'modify-required' }
) {
  for (const change of prepared.review.report.changes) {
    const decision = override?.mutationId === change.mutationId
      ? override.decision
      : change.statePath === '/latestCommittedChapter' ? 'conditional-approve' : 'approve';
    await decideCandidateCommitChange({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: 'latest',
      mutationId: change.mutationId,
      decision,
      note: `Explicit test operator decision for ${change.statePath}.`
    }, store);
  }
}

describe.sequential('M27.12D4A.1 finalized commit review', () => {
  test('remains incomplete until every mutation has an active decision', async () => {
    const result = await finalizeCandidateCommitReview({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest' }, store);
    expect(result.report.overallDecision).toBe('human_review_incomplete');
    expect(result.report.unresolvedMutationIds).toHaveLength(prepared.review.report.changes.length);
  }, 90_000);

  test('returns changes_required for modify-required and rejected for reject', async () => {
    const business = prepared.review.report.changes.find((change) => change.mutationType === 'narrative_debt') ??
      prepared.review.report.changes.find((change) => change.statePath !== '/latestCommittedChapter')!;
    modifiedBusinessMutationId = business.mutationId;
    await decideAll(prepared, store, { mutationId: business.mutationId, decision: 'modify-required' });
    const required = await finalizeCandidateCommitReview({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest' }, store);
    expect(required.report.overallDecision).toBe('changes_required');

    await decideCandidateCommitChange({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: 'latest',
      mutationId: business.mutationId,
      decision: 'reject',
      note: 'Superseding rejection for finalization precedence.'
    }, store);
    const rejected = await finalizeCandidateCommitReview({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest' }, store);
    expect(rejected.report.overallDecision).toBe('rejected');
  }, 90_000);

  test('approves only when all business mutations pass and engine metadata is conditional', async () => {
    await decideCandidateCommitChange({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: 'latest',
      mutationId: modifiedBusinessMutationId,
      decision: 'approve',
      note: 'Superseding approval after the requested patch concern was resolved in this fixture.'
    }, store);
    const result = await finalizeCandidateCommitReview({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest' }, store);
    expect(result.report.overallDecision).toBe('approved_for_commit');
    expect(result.report.activeDecisionCount).toBe(prepared.review.report.changes.length);
    expect(result.report.conditionalEngineMutationIds).toEqual([
      prepared.review.report.changes.find((change) => change.statePath === '/latestCommittedChapter')!.mutationId
    ]);
  }, 90_000);
});
