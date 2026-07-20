import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { runCodexCandidatePreview } from '../../src/app/codexCandidatePreview.js';
import { ArtifactIndexSchema, CodexCandidatePreviewReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareAdoptedRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d3-audit-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D3 strict audit integration', () => {
  test('validates the complete candidate adoption and preview chain', async () => {
    const store = new FileStore();
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

    const result = await auditProject({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      strict: true,
      fixIndex: true
    }, store);

    expect(result.exitCode).toBe(0);
    expect(result.report.issues.filter((issue) => issue.blocking)).toEqual([]);
    const index = await store.readJson(prepared.paths.artifactIndex(), ArtifactIndexSchema);
    const types = new Set(index.artifacts.filter((artifact) => artifact.chapterNumber === 1).map((artifact) => artifact.artifactType));
    expect(([
      'revision_candidate_review',
      'revision_candidate_adoption_approval',
      'draft_adoption_manifest',
      'draft_selection',
      'codex_candidate_preview_report'
    ] as const).every((artifactType) => types.has(artifactType))).toBe(true);
  }, 90_000);

  test('blocks a preview whose adopted draft no longer matches the approved candidate', async () => {
    const store = new FileStore();
    const prepared = await prepareAdoptedRevisionCandidateProject(tempRoot, store);
    await store.writeText(prepared.paths.chapterArtifact(1, 'draft_v2.md'), '# tampered draft\n');

    const result = await auditProject({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      strict: true,
      fixIndex: true
    }, store);

    expect(result.exitCode).toBe(2);
    expect(result.report.issues.some((issue) => issue.issueId.includes('draft_adoption_hash'))).toBe(true);
  }, 90_000);

  test('blocks a candidate preview with missing run provenance', async () => {
    const store = new FileStore();
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
    await store.writeJson(prepared.paths.projectArtifact(preview.reportPath), {
      ...preview.report,
      runId: 'missing_candidate_preview_run'
    }, CodexCandidatePreviewReportSchema);

    const result = await auditProject({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      strict: true,
      fixIndex: true
    }, store);

    expect(result.exitCode).toBe(2);
    expect(result.report.issues.some((issue) => issue.issueId.includes('candidate_preview_missing_run_provenance'))).toBe(true);
  }, 90_000);
});
