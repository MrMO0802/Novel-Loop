import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  analyzeCandidatePatchNoops,
  approveCandidateCommit,
  decideCandidateCommitChange,
  finalizeCandidateCommitReview
} from '../../src/app/codexCandidateCommitDecision.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { AppError } from '../../src/utils/AppError.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareCandidateCommitDecisionProject } from './codexCandidateCommitDecisionFixtures.js';

let tempRoot: string;
let store: FileStore;
let prepared: Awaited<ReturnType<typeof prepareCandidateCommitDecisionProject>>;

beforeAll(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d4a1-approval-');
  store = new FileStore();
  prepared = await prepareCandidateCommitDecisionProject(tempRoot, store);
  await analyzeCandidatePatchNoops({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest' }, store);
});

afterAll(async () => {
  await removeTempRoot(tempRoot);
});

describe.sequential('M27.12D4A.1 candidate commit approval', () => {
  test('refuses approval when the finalized review is incomplete', async () => {
    await finalizeCandidateCommitReview({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest' }, store);

    await expect(approveCandidateCommit({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: 'latest',
      confirm: true
    }, store)).rejects.toMatchObject<Partial<AppError>>({ code: 'CODEX_CANDIDATE_COMMIT_APPROVAL_BLOCKED' });
  }, 90_000);

  test('generates a single controlled commit approval without state, queue, snapshot, or canonical side effects', async () => {
    const protectedBefore = [
      await store.readText(prepared.paths.storyState()),
      await store.readText(prepared.paths.chapterQueue()),
      await store.list(prepared.paths.snapshotsDir())
    ];
    for (const change of prepared.review.report.changes) {
      await decideCandidateCommitChange({
        projectId: prepared.paths.projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        review: 'latest',
        mutationId: change.mutationId,
        decision: change.statePath === '/latestCommittedChapter' ? 'conditional-approve' : 'approve',
        note: `Explicit approval decision for ${change.statePath}.`
      }, store);
    }
    const finalized = await finalizeCandidateCommitReview({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest' }, store);
    const approval = await approveCandidateCommit({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: 'latest',
      confirm: true
    }, store);

    expect(approval.record.finalizedReviewPath).toBe(finalized.reviewPath);
    expect(approval.record.approved).toBe(true);
    expect(approval.record.riskAcknowledged).toBe(true);
    expect(approval.record.consumed).toBe(false);
    expect([
      await store.readText(prepared.paths.storyState()),
      await store.readText(prepared.paths.chapterQueue()),
      await store.list(prepared.paths.snapshotsDir())
    ]).toEqual(protectedBefore);
    expect(await store.exists(prepared.paths.chapterArtifact(1, 'final.md'))).toBe(false);
    expect(await store.exists(prepared.paths.chapterArtifact(1, 'canon_patch.json'))).toBe(false);
    expect(await store.exists(prepared.paths.chapterArtifact(1, 'commit_report.json'))).toBe(false);
  }, 90_000);

});
