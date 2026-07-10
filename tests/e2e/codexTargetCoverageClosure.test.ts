import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexDiagnosticsTargetCoverage } from '../../src/app/codexTargetCoverage.js';
import {
  CandidateDispositionSchema,
  TargetCoverageClosureReportSchema,
  TargetCoverageGraphSchema,
  TargetExpansionApprovalPreviewSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetCoverageProject } from './codexTargetCoverageFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d1-coverage-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D1 target coverage closure', () => {
  test('rejects candidate v1 and closes residual evidence coverage without invoking Codex or mutating canonical artifacts', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareTargetCoverageProject(tempRoot, store);
    const protectedBefore = await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json')),
      store.readText(paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v1.md'))
    ]);
    const codexCallsBefore = await readFile(fake.argsLogPath, 'utf8');

    const result = await runCodexDiagnosticsTargetCoverage({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1
    }, store);

    const disposition = await store.readJson(paths.projectArtifact(result.dispositionPath), CandidateDispositionSchema);
    const report = await store.readJson(paths.projectArtifact(result.reportPath), TargetCoverageClosureReportSchema);
    const graph = await store.readJson(paths.projectArtifact(result.graphPath), TargetCoverageGraphSchema);
    const approval = await store.readJson(paths.projectArtifact(result.approvalPreviewPath), TargetExpansionApprovalPreviewSchema);
    expect(disposition).toMatchObject({
      result: 'rejected_no_improvement',
      adopted: false,
      retainForProvenance: true,
      eligibleAsNextRevisionBase: false
    });
    expect(report.initialTargets.map((target) => target.paragraphIndex)).toEqual([2, 4, 8, 12]);
    expect(report.proposedAdditionalTargets.map((target) => target.paragraphIndex)).toEqual([7, 9, 10, 11, 13]);
    expect(report.coverageClosed).toBe(true);
    expect(report.projectedClaimCoverageAfter).toBe(1);
    expect(report.projectedContradictionEdgeCoverageAfter).toBe(1);
    expect(report.projectedEventOccurrenceCoverageAfter).toBe(1);
    expect(report.candidateUsedAsRevisionBase).toBe(false);
    expect(graph.coverageClosed).toBe(true);
    expect(graph.nodes.map((node) => node.nodeType)).toEqual(expect.arrayContaining([
      'event', 'paragraph_evidence', 'explicit_time', 'inferred_time', 'action_sequence', 'mission_constraint', 'plan_constraint'
    ]));
    expect(approval).toMatchObject({ approved: false, confirmedAt: null, riskAcknowledged: false });
    expect(await readFile(fake.argsLogPath, 'utf8')).toBe(codexCallsBefore);
    expect(await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json')),
      store.readText(paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v1.md'))
    ])).toEqual(protectedBefore);
  }, 45_000);
});
