import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { reviewCodexCandidateCommit } from '../../src/app/codexCandidateCommitReview.js';
import { runCodexCandidatePreview } from '../../src/app/codexCandidatePreview.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import { ArtifactIndexSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareAdoptedRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d4a-audit-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

async function prepareReview(store = new FileStore()) {
  const prepared = await prepareAdoptedRevisionCandidateProject(tempRoot, store);
  const fake = await writeFakeCodex(tempRoot, 'codex-candidate-preview');
  await runCodexCandidatePreview({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    draft: 'draft_v2',
    approval: 'latest',
    codexBin: fake.codexBin
  }, store);
  const review = await reviewCodexCandidateCommit({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    preview: 'latest'
  }, store);
  return { ...prepared, review };
}

describe('M27.12D4A review and audit integration', () => {
  test('surfaces commit review and evidence provenance in review output and artifact index', async () => {
    const store = new FileStore();
    const prepared = await prepareReview(store);
    const output = await reviewChapter({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      diagnostics: true,
      artifacts: true,
      state: true,
      suggestNext: true
    }, store);
    expect(output).toContain('Candidate commit review');
    expect(output).toContain('overallDecision: human_review_incomplete');
    expect(output).toContain('Patch evidence map');
    expect(output).toContain('record human commit decisions');

    const audit = await auditProject({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      strict: true,
      fixIndex: true
    }, store);
    expect(audit.exitCode).toBe(0);
    expect(audit.report.issues.filter((issue) => issue.blocking)).toEqual([]);
    const index = await store.readJson(prepared.paths.artifactIndex(), ArtifactIndexSchema);
    const types = new Set(index.artifacts.map((artifact) => artifact.artifactType));
    expect(types.has('candidate_commit_review')).toBe(true);
    expect(types.has('candidate_patch_evidence_map')).toBe(true);
  }, 90_000);

  test('strict audit rejects a tampered evidence map', async () => {
    const store = new FileStore();
    const prepared = await prepareReview(store);
    await store.writeText(prepared.paths.projectArtifact(prepared.review.evidenceMapPath), '{}\n');

    const audit = await auditProject({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      strict: true,
      fixIndex: true
    }, store);
    expect(audit.exitCode).toBe(2);
    expect(audit.report.issues.some((issue) => issue.issueId.includes('candidate_commit_review'))).toBe(true);
  }, 90_000);
});
