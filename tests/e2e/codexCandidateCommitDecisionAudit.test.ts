import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  analyzeCandidatePatchNoops,
  approveCandidateCommit,
  decideCandidateCommitChange,
  finalizeCandidateCommitReview
} from '../../src/app/codexCandidateCommitDecision.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareCandidateCommitDecisionProject } from './codexCandidateCommitDecisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d4a1-audit-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D4A.1 decision audit and review integration', () => {
  test('strict audit validates the finalized approval chain and review shows progress', async () => {
    const store = new FileStore();
    const prepared = await prepareCandidateCommitDecisionProject(tempRoot, store);
    await analyzeCandidatePatchNoops({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest' }, store);
    for (const change of prepared.review.report.changes) {
      await decideCandidateCommitChange({
        projectId: prepared.paths.projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        review: 'latest',
        mutationId: change.mutationId,
        decision: change.statePath === '/latestCommittedChapter' ? 'conditional-approve' : 'approve',
        note: `Audit fixture decision for ${change.statePath}.`
      }, store);
    }
    await finalizeCandidateCommitReview({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest' }, store);
    await approveCandidateCommit({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, review: 'latest', confirm: true }, store);

    const output = await reviewChapter({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      diagnostics: true,
      artifacts: true,
      suggestNext: true
    }, store);
    expect(output).toContain(`decision progress: ${prepared.review.report.changes.length}/${prepared.review.report.changes.length}`);
    expect(output).toContain('finalized overallDecision: approved_for_commit');
    expect(output).toContain('commit approval status: approved, unconsumed');

    const audit = await auditProject({ projectId: prepared.paths.projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.exitCode).toBe(0);
    expect(audit.report.issues.filter((issue) => issue.blocking)).toEqual([]);
  }, 90_000);
});
