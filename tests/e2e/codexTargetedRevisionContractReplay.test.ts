import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexTargetedRevisionContractCheck } from '../../src/app/codexTargetedRevisionContractCheck.js';
import { RunManifestV2Schema, TargetCoverageGraphSchema, TargetedRevisionProviderOutputSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareApprovedExpandedTargetRevisionProject } from './codexExpandedTargetRevisionFixtures.js';
import { providerOperation } from './codexTargetedRevisionOperationFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d21-replay-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D2.1 targeted revision contract replay', () => {
  test('replays provider parsed output without Codex or canonical mutation', async () => {
    const store = new FileStore();
    const { paths, coverage } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store);
    const graph = await store.readJson(paths.projectArtifact(coverage.report.targetCoverageGraphPath), TargetCoverageGraphSchema);
    const duplicateTargets = approvedDuplicateTargets(coverage.report, graph);
    const requiredNonDuplicate = coverage.report.proposedAdditionalTargets.filter((target) => target.eventIdentity !== 'duplicate_delivery_sequence');
    const inputPath = paths.projectArtifact('codex/runs/real-output/parsed_output.json');
    await store.writeJson(inputPath, {
      operations: [
        providerOperation('delete_real_duplicate_group', 'delete_duplicate_paragraph', duplicateTargets),
        ...requiredNonDuplicate.map((target) => providerOperation(`replace_${target.targetId}`, 'replace_paragraph', [target.targetId]))
      ]
    }, TargetedRevisionProviderOutputSchema);
    const protectedBefore = await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md'))
    ]);

    const result = await runCodexTargetedRevisionContractCheck({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      inputPath,
      approval: 'latest'
    }, store);

    expect(result.report.providerSchemaValid).toBe(true);
    expect(result.report.normalizationSucceeded).toBe(true);
    expect(result.report.normalizedOperationCount).toBeGreaterThan(result.report.sourceOperationCount);
    expect(result.report.operations.some((operation) => operation.normalizationMode === 'atomic_split')).toBe(true);
    expect(result.coveragePreflightPassed).toBe(true);
    expect(await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md'))
    ])).toEqual(protectedBefore);
    await expect(store.exists(paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v2.md'))).resolves.toBe(false);
    const manifest = await store.readJson(paths.runManifest(result.runId), RunManifestV2Schema);
    expect(manifest.promptCalls).toEqual([]);
    expect(manifest.stateMutations).toEqual([]);
    expect(manifest.queueTransitions).toEqual([]);
    expect(manifest.snapshots).toEqual([]);
  }, 45_000);
});

function approvedDuplicateTargets(
  coverage: Awaited<ReturnType<typeof prepareApprovedExpandedTargetRevisionProject>>['coverage']['report'],
  graph: ReturnType<typeof TargetCoverageGraphSchema.parse>
): string[] {
  const expanded = coverage.proposedAdditionalTargets.filter((target) => target.eventIdentity === 'duplicate_delivery_sequence');
  const indexes = expanded.map((target) => target.paragraphIndex);
  const min = Math.min(...indexes);
  const max = Math.max(...indexes);
  const initialInsideSequence = coverage.initialTargets.filter((target) => target.paragraphIndex >= min && target.paragraphIndex <= max);
  const graphParagraphs = new Set(graph.nodes.filter((node) => node.nodeType === 'paragraph_evidence').map((node) => node.paragraphIndex));
  return [...expanded, ...initialInsideSequence]
    .filter((target) => graphParagraphs.has(target.paragraphIndex))
    .sort((left, right) => left.paragraphIndex - right.paragraphIndex)
    .map((target) => target.targetId);
}
