import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { runCodexTargetedRevisionContractCheck } from '../../src/app/codexTargetedRevisionContractCheck.js';
import { TargetCoverageGraphSchema, TargetedRevisionOperationNormalizationSchema, TargetedRevisionProviderOutputSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareApprovedExpandedTargetRevisionProject } from './codexExpandedTargetRevisionFixtures.js';
import { providerOperation } from './codexTargetedRevisionOperationFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d21-audit-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D2.1 operation normalization audit', () => {
  test('strict audit validates replay provenance and canonical operation linkage', async () => {
    const store = new FileStore();
    const { paths, coverage } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store);
    const graph = await store.readJson(paths.projectArtifact(coverage.report.targetCoverageGraphPath), TargetCoverageGraphSchema);
    const duplicateTargets = coverage.report.proposedAdditionalTargets
      .filter((target) => target.eventIdentity === 'duplicate_delivery_sequence')
      .filter((target) => graph.nodes.some((node) => node.paragraphIndex === target.paragraphIndex))
      .map((target) => target.targetId);
    const requiredNonDuplicate = coverage.report.proposedAdditionalTargets
      .filter((target) => target.requiredForClosure && target.eventIdentity !== 'duplicate_delivery_sequence');
    const inputPath = paths.projectArtifact('codex/runs/audit-replay/parsed_output.json');
    await store.writeJson(inputPath, {
      operations: [
        providerOperation('delete_approved_sequence', 'delete_duplicate_paragraph', duplicateTargets),
        ...requiredNonDuplicate.map((target) => providerOperation(`replace_${target.targetId}`, 'replace_paragraph', [target.targetId]))
      ]
    }, TargetedRevisionProviderOutputSchema);
    const replay = await runCodexTargetedRevisionContractCheck({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      inputPath,
      approval: 'latest'
    }, store);

    const audit = await auditProject({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      strict: true,
      fixIndex: true
    }, store);

    expect(audit.ok, JSON.stringify(audit.report.issues, null, 2)).toBe(true);
    expect(audit.report.issues.filter((issue) => issue.category === 'targeted_revision_operation_normalization')).toEqual([]);

    const report = await store.readJson(paths.projectArtifact(replay.reportPath), TargetedRevisionOperationNormalizationSchema);
    await store.writeJson(paths.projectArtifact(replay.reportPath), {
      ...report,
      normalizedOperations: report.normalizedOperations.map((operation, index) => index === 0
        ? { ...operation, parentOperationId: 'missing_parent_operation' }
        : operation)
    }, TargetedRevisionOperationNormalizationSchema);
    const brokenAudit = await auditProject({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      strict: true
    }, store);
    expect(brokenAudit.ok).toBe(false);
    expect(brokenAudit.report.issues.some((issue) =>
      issue.category === 'targeted_revision_operation_normalization' && issue.blocking
    )).toBe(true);
  }, 45_000);

  test('strict audit detects provider/canonical drift with no normalization report', async () => {
    const store = new FileStore();
    const { paths, coverage } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store);
    const graph = await store.readJson(paths.projectArtifact(coverage.report.targetCoverageGraphPath), TargetCoverageGraphSchema);
    const duplicateTargets = coverage.report.proposedAdditionalTargets
      .filter((target) => target.eventIdentity === 'duplicate_delivery_sequence')
      .filter((target) => graph.nodes.some((node) => node.paragraphIndex === target.paragraphIndex))
      .map((target) => target.targetId);
    const requiredNonDuplicate = coverage.report.proposedAdditionalTargets
      .filter((target) => target.requiredForClosure && target.eventIdentity !== 'duplicate_delivery_sequence');
    const inputPath = paths.projectArtifact('codex/runs/missing-report/parsed_output.json');
    await store.writeJson(inputPath, {
      operations: [
        providerOperation('delete_missing_report', 'delete_duplicate_paragraph', duplicateTargets),
        ...requiredNonDuplicate.map((target) => providerOperation(`replace_${target.targetId}`, 'replace_paragraph', [target.targetId]))
      ]
    }, TargetedRevisionProviderOutputSchema);
    const replay = await runCodexTargetedRevisionContractCheck({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      inputPath,
      approval: 'latest'
    }, store);
    await rm(paths.projectArtifact(replay.reportPath));

    const audit = await auditProject({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      strict: true,
      fixIndex: true
    }, store);

    expect(audit.ok).toBe(false);
    expect(audit.report.issues.some((issue) =>
      issue.issueId.startsWith('targeted_revision_operation_normalization_missing_') && issue.blocking
    )).toBe(true);
  }, 45_000);
});
import { rm } from 'node:fs/promises';
