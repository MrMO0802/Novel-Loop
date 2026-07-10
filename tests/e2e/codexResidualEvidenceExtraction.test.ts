import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexDiagnosticsTargetCoverage } from '../../src/app/codexTargetCoverage.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetCoverageProject } from './codexTargetCoverageFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d1-residual-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D1 residual evidence extraction', () => {
  test('finds the residual 23:29 reference and complete uncovered duplicate action sequence', async () => {
    const store = new FileStore();
    await prepareTargetCoverageProject(tempRoot, store);

    const result = await runCodexDiagnosticsTargetCoverage({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1
    }, store);

    const timeClaim = result.report.residualClaims.find((claim) => claim.normalizedClaim === 'midday_vs_late_exit_same_delivery');
    const duplicateClaim = result.report.residualClaims.find((claim) => claim.normalizedClaim === 'duplicate_delivery_sequence');
    expect(timeClaim).toMatchObject({ coverageStatus: 'partially_covered', uncoveredParagraphs: [13] });
    expect(duplicateClaim).toMatchObject({ coverageStatus: 'partially_covered', uncoveredParagraphs: [7, 9, 10, 11] });
    expect(result.report.residualEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ paragraphIndex: 13, evidenceKind: 'explicit_time', snippet: expect.stringContaining('二十三点二十九分') }),
      expect.objectContaining({ paragraphIndex: 7, evidenceKind: 'action_sequence' }),
      expect.objectContaining({ paragraphIndex: 9, evidenceKind: 'action_sequence' }),
      expect.objectContaining({ paragraphIndex: 10, evidenceKind: 'action_sequence' }),
      expect.objectContaining({ paragraphIndex: 11, evidenceKind: 'action_sequence' })
    ]));
    expect(result.report.residualClaims.every((claim) => /^[a-f0-9]{64}$/.test(claim.evidenceFingerprint))).toBe(true);
  }, 45_000);
});
