import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { approveCodexTargetExpansion, runCodexDiagnosticsTargetCoverage } from '../../src/app/codexTargetCoverage.js';
import { runCodexTargetedRevisionExperiment } from '../../src/app/codexTargetedRevisionExperiment.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { AppError } from '../../src/utils/AppError.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetCoverageProject } from './codexTargetCoverageFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d1-approval-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D1 target expansion approval', () => {
  test('requires explicit approval and records it without generating a second candidate', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareTargetCoverageProject(tempRoot, store);
    const coverage = await runCodexDiagnosticsTargetCoverage({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1
    }, store);
    const protectedBefore = await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json'))
    ]);

    await expect(runCodexTargetedRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_TARGET_EXPANSION_APPROVAL_REQUIRED' });

    const approved = await approveCodexTargetExpansion({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      report: 'latest',
      confirm: true,
      operator: 'test-operator'
    }, store);
    expect(approved.record).toMatchObject({
      approved: true,
      operator: 'test-operator',
      riskAcknowledged: true,
      coverageReportPath: coverage.reportPath,
      candidateGenerated: false,
      storyStateMutated: false,
      queueMutated: false
    });
    await expect(store.exists(paths.chapterArtifact(1, 'targeted_revision_plan_v2.json'))).resolves.toBe(false);
    expect(await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json'))
    ])).toEqual(protectedBefore);
  }, 45_000);

  test('blocks approval when the source draft hash is stale', async () => {
    const store = new FileStore();
    const { paths } = await prepareTargetCoverageProject(tempRoot, store);
    await runCodexDiagnosticsTargetCoverage({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1
    }, store);
    await store.writeText(paths.chapterArtifact(1, 'draft_v1.md'), `${await store.readText(paths.chapterArtifact(1, 'draft_v1.md'))}\nmanual edit\n`);
    const stateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());

    await expect(approveCodexTargetExpansion({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      report: 'latest',
      confirm: true,
      operator: 'test-operator'
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_TARGET_COVERAGE_SOURCE_STALE' });

    await expect(store.readText(paths.storyState())).resolves.toBe(stateBefore);
    await expect(store.readText(paths.chapterQueue())).resolves.toBe(queueBefore);
    await expect(store.exists(paths.chapterArtifact(1, 'target_expansion_approval_v1.json'))).resolves.toBe(false);
  }, 45_000);

  test('blocks approval of a superseded coverage report even when its source hashes still match', async () => {
    const store = new FileStore();
    const { paths } = await prepareTargetCoverageProject(tempRoot, store);
    const first = await runCodexDiagnosticsTargetCoverage({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1
    }, store);
    await runCodexDiagnosticsTargetCoverage({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1
    }, store);

    await expect(approveCodexTargetExpansion({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      report: first.reportPath,
      confirm: true,
      operator: 'test-operator'
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_TARGET_COVERAGE_SOURCE_STALE' });

    await expect(store.exists(paths.chapterArtifact(1, 'target_expansion_approval_v1.json'))).resolves.toBe(false);
  }, 45_000);
});
