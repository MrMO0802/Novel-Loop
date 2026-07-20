import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { decideCandidateCommitChange } from '../../src/app/codexCandidateCommitDecision.js';
import { CandidateCommitMutationDecisionSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { AppError } from '../../src/utils/AppError.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareCandidateCommitDecisionProject } from './codexCandidateCommitDecisionFixtures.js';

let tempRoot: string;
let store: FileStore;
let prepared: Awaited<ReturnType<typeof prepareCandidateCommitDecisionProject>>;

beforeAll(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d4a1-decision-');
  store = new FileStore();
  prepared = await prepareCandidateCommitDecisionProject(tempRoot, store);
});

afterAll(async () => {
  await removeTempRoot(tempRoot);
});

describe.sequential('M27.12D4A.1 mutation decisions', () => {
  test('writes append-only decisions and supersedes the previous effective decision', async () => {
    const mutation = prepared.review.report.changes.find((change) => change.mutationType !== 'latest_committed_chapter')!;
    const first = await decideCandidateCommitChange({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: 'latest',
      mutationId: mutation.mutationId,
      decision: 'approve',
      note: 'Evidence and transition are accepted by the local operator.'
    }, store);
    const second = await decideCandidateCommitChange({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: 'latest',
      mutationId: mutation.mutationId,
      decision: 'reject',
      note: 'Superseding decision after a second human evidence review.'
    }, store);

    expect(first.decisionPath).not.toBe(second.decisionPath);
    expect(second.record.supersedesDecisionId).toBe(first.record.decisionId);
    expect(second.record.active).toBe(true);
    expect(await store.readJson(prepared.paths.projectArtifact(first.decisionPath), CandidateCommitMutationDecisionSchema)).toEqual(first.record);
    expect(second.record.storyStateMutated).toBe(false);
    expect(second.record.queueMutated).toBe(false);
  }, 90_000);

  test('allows only conditional approval or rejection for engine metadata', async () => {
    const engineMutation = prepared.review.report.changes.find((change) => change.statePath === '/latestCommittedChapter')!;

    await expect(decideCandidateCommitChange({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: 'latest',
      mutationId: engineMutation.mutationId,
      decision: 'approve',
      note: 'Invalid direct approval.'
    }, store)).rejects.toMatchObject<Partial<AppError>>({ code: 'CODEX_CANDIDATE_COMMIT_DECISION_INVALID' });

    const result = await decideCandidateCommitChange({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: 'latest',
      mutationId: engineMutation.mutationId,
      decision: 'conditional-approve',
      note: 'Engine-owned metadata; apply only after every business mutation is approved and local commit completes.'
    }, store);
    expect(result.record.mutationOrigin).toBe('engine_metadata');
  }, 90_000);

  test('rejects a decision after a protected source becomes stale', async () => {
    await store.writeText(prepared.paths.projectArtifact(prepared.review.report.finalPreviewPath), '# changed source\n');

    await expect(decideCandidateCommitChange({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: 'latest',
      mutationId: prepared.review.report.changes[0]!.mutationId,
      decision: 'approve',
      note: 'This must not be accepted against a stale source.'
    }, store)).rejects.toMatchObject<Partial<AppError>>({ code: 'CODEX_CANDIDATE_COMMIT_DECISION_STALE' });
  }, 90_000);
});
