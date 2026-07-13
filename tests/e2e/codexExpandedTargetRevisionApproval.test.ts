import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { approveCodexTargetExpansion, runCodexDiagnosticsTargetCoverage } from '../../src/app/codexTargetCoverage.js';
import { runCodexExpandedTargetRevisionExperiment } from '../../src/app/codexExpandedTargetRevisionExperiment.js';
import { sha256 } from '../../src/app/codexDiagnosticsEvidenceRules.js';
import { CandidateDispositionSchema, TargetCoverageClosureReportSchema, TargetExpansionApprovalRecordSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { AppError } from '../../src/utils/AppError.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetCoverageProject } from './codexTargetCoverageFixtures.js';
import { prepareApprovedExpandedTargetRevisionProject } from './codexExpandedTargetRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d2-approval-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D2 expanded target approval gate', () => {
  test('blocks revision round 2 when no approved expansion record exists', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareTargetCoverageProject(tempRoot, store);
    await runCodexDiagnosticsTargetCoverage({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1
    }, store);
    const protectedBefore = await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md'))
    ]);

    await expect(runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_TARGET_EXPANSION_NOT_APPROVED' });

    expect(await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md'))
    ])).toEqual(protectedBefore);
    await expect(store.exists(paths.chapterArtifact(1, 'targeted_revision_plan_v2.json'))).resolves.toBe(false);
  }, 45_000);

  test('blocks a superseded approval and never falls back to rejected candidate v1', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareTargetCoverageProject(tempRoot, store);
    await runCodexDiagnosticsTargetCoverage({ projectId: adjudicationProjectId, projectsRoot: tempRoot, chapterNumber: 1 }, store);
    await approveCodexTargetExpansion({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      report: 'latest',
      confirm: true,
      operator: 'm27.12d2-test'
    }, store);
    await runCodexDiagnosticsTargetCoverage({ projectId: adjudicationProjectId, projectsRoot: tempRoot, chapterNumber: 1 }, store);
    const stateBefore = await store.readText(paths.storyState());

    await expect(runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_TARGET_EXPANSION_APPROVAL_STALE' });

    await expect(store.readText(paths.storyState())).resolves.toBe(stateBefore);
    await expect(store.exists(paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v2.md'))).resolves.toBe(false);
  }, 45_000);

  test('forbids an automatic third targeted revision round', async () => {
    const store = new FileStore();
    const { fake } = await prepareTargetCoverageProject(tempRoot, store);
    await expect(runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 3,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_TARGETED_REVISION_MAX_ROUNDS_REACHED' });
  }, 45_000);

  test('blocks when an approved source draft hash is stale', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store);
    await store.writeText(paths.chapterArtifact(1, 'draft_v1.md'), `${await store.readText(paths.chapterArtifact(1, 'draft_v1.md'))}\nmanual edit\n`);
    const stateBefore = await store.readText(paths.storyState());

    await expect(runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_REVISION_SOURCE_STALE' });

    await expect(store.readText(paths.storyState())).resolves.toBe(stateBefore);
    await expect(store.exists(paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v2.md'))).resolves.toBe(false);
  }, 45_000);

  test('forbids using a rejected-regression candidate as the second-round base', async () => {
    const store = new FileStore();
    const { paths, coverage, approval, fake } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store);
    const disposition = await store.readJson(paths.projectArtifact(coverage.report.candidateDispositionPath), CandidateDispositionSchema);
    await store.writeJson(paths.projectArtifact(coverage.report.candidateDispositionPath), {
      ...disposition,
      result: 'rejected_regression' as const
    }, CandidateDispositionSchema);
    const dispositionText = await store.readText(paths.projectArtifact(coverage.report.candidateDispositionPath));
    const updatedCoverage = {
      ...coverage.report,
      candidateDispositionHash: sha256(dispositionText)
    };
    await store.writeJson(paths.projectArtifact(coverage.reportPath), updatedCoverage, TargetCoverageClosureReportSchema);
    const coverageText = await store.readText(paths.projectArtifact(coverage.reportPath));
    const approvalRecord = await store.readJson(paths.projectArtifact(approval.recordPath!), TargetExpansionApprovalRecordSchema);
    await store.writeJson(paths.projectArtifact(approval.recordPath!), {
      ...approvalRecord,
      coverageReportHash: sha256(coverageText),
      candidateDispositionHash: sha256(dispositionText)
    }, TargetExpansionApprovalRecordSchema);

    await expect(runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_REJECTED_CANDIDATE_BASE_FORBIDDEN' });
  }, 45_000);
});
