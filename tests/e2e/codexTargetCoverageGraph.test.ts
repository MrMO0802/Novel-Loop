import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { evaluateTargetCoverageClosure, runCodexDiagnosticsTargetCoverage } from '../../src/app/codexTargetCoverage.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetCoverageProject } from './codexTargetCoverageFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d1-graph-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D1 evidence graph closure', () => {
  test('covers contradiction, duplicate-sequence, and same-event identity edges with a closed projected target set', async () => {
    const store = new FileStore();
    await prepareTargetCoverageProject(tempRoot, store);
    const result = await runCodexDiagnosticsTargetCoverage({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1
    }, store);

    expect(result.graph.edges.map((edge) => edge.edgeType)).toEqual(expect.arrayContaining([
      'contradiction', 'duplicate_sequence', 'same_event_identity'
    ]));
    expect(result.graph.edges
      .filter((edge) => edge.edgeType === 'contradiction' || edge.edgeType === 'duplicate_sequence')
      .every((edge) => edge.projectedCoveredAfter)).toBe(true);
    expect(evaluateTargetCoverageClosure({
      metrics: result.report.metrics,
      requiredTargetsHaveHashes: true,
      unresolvedSameEventTimeReferences: 0,
      uncoveredDuplicateSequences: 0
    })).toBe(true);
    expect(evaluateTargetCoverageClosure({
      metrics: { ...result.report.metrics, projectedCoveredEventOccurrencesAfter: result.report.metrics.eventOccurrenceCount - 1 },
      requiredTargetsHaveHashes: true,
      unresolvedSameEventTimeReferences: 1,
      uncoveredDuplicateSequences: 0
    })).toBe(false);
  }, 45_000);
});
