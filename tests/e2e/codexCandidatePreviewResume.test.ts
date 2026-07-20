import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexCandidatePreview } from '../../src/app/codexCandidatePreview.js';
import { CanonPatchSchema, CodexCandidatePreviewReportSchema, DiagnosticsReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareAdoptedRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d3-preview-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D3 candidate preview-only resume', () => {
  test('re-runs standard diagnostics on draft_v2 and produces a complete non-committing preview', async () => {
    const store = new FileStore();
    const prepared = await prepareAdoptedRevisionCandidateProject(tempRoot, store);
    const fake = await writeFakeCodex(tempRoot, 'codex-candidate-preview');
    const protectedBefore = await Promise.all([
      store.readText(prepared.paths.storyState()),
      store.readText(prepared.paths.chapterQueue()),
      store.readText(prepared.paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(prepared.paths.projectArtifact(prepared.experiment.candidateDraftPath))
    ]);

    const result = await runCodexCandidatePreview({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      draft: 'draft_v2',
      approval: 'latest',
      codexProfile: 'clean',
      codexJsonRetries: 2,
      codexJsonRepair: true,
      codexBin: fake.codexBin
    }, store);
    const diagnostics = await store.readJson(prepared.paths.projectArtifact(result.report.diagnosticsPath), DiagnosticsReportSchema);
    const patch = await store.readJson(prepared.paths.projectArtifact(result.report.normalizedPatchPath!), CanonPatchSchema);
    const manifest = await store.readJson(prepared.paths.runManifest(result.runId), RunManifestV2Schema);
    expect(diagnostics.draftVersion).toBe(2);
    expect(diagnostics.passed).toBe(true);
    expect(Object.values(diagnostics.hard_checks).every((check) => check.passed)).toBe(true);
    expect(patch.sourceFinalPath).toBe('chapters/chapter_001/final_candidate_preview_v2.md');
    expect(result.report.previewComplete).toBe(true);
    expect(result.report.standardDiagnosticsReexecuted).toBe(true);
    expect(result.report.abDiagnosticsReused).toBe(false);
    expect(result.report.recommendedNextStep).toBe('human_commit_review');
    expect(manifest.promptCalls.map((call) => call.promptId)).toEqual([
      'diagnostics.diagnose_chapter_slim',
      'memory.extract_canon_patch_proposal_slim'
    ]);
    expect(manifest.stateMutations).toEqual([]);
    expect(manifest.queueTransitions).toEqual([]);
    expect(manifest.snapshots).toEqual([]);
    expect(await store.readText(prepared.paths.runEvents(result.runId))).not.toContain('STATE_MUTATION_APPLIED');
    expect(await Promise.all([
      store.readText(prepared.paths.storyState()),
      store.readText(prepared.paths.chapterQueue()),
      store.readText(prepared.paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(prepared.paths.projectArtifact(prepared.experiment.candidateDraftPath))
    ])).toEqual(protectedBefore);
    await expect(store.exists(prepared.paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
    await expect(store.exists(prepared.paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(false);
    await store.readJson(prepared.paths.projectArtifact(result.reportPath), CodexCandidatePreviewReportSchema);
  }, 90_000);

  test('stops at standard diagnostics hard fail without final, patch, or candidate v3', async () => {
    const store = new FileStore();
    const prepared = await prepareAdoptedRevisionCandidateProject(tempRoot, store);
    const fake = await writeFakeCodex(tempRoot, 'codex-controlled-diagnostics-fail');
    const stateBefore = await store.readText(prepared.paths.storyState());

    const result = await runCodexCandidatePreview({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      draft: 'draft_v2',
      approval: 'latest',
      codexBin: fake.codexBin
    }, store);

    expect(result.report.previewComplete).toBe(false);
    expect(result.report.diagnosticsPassed).toBe(false);
    expect(result.report.failureCode).toBe('CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL');
    expect(result.report.recommendedNextStep).toBe('diagnostics_review');
    expect(result.report.finalPath).toBeNull();
    expect(result.report.patchProposalPath).toBeNull();
    await expect(store.exists(prepared.paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v3.md'))).resolves.toBe(false);
    await expect(store.readText(prepared.paths.storyState())).resolves.toBe(stateBefore);
  }, 90_000);
});
