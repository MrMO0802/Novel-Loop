import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import { runCodexDiagnosticsTargetCoverage } from '../../src/app/codexTargetCoverage.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetCoverageProject } from './codexTargetCoverageFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d1-review-audit-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D1 review and audit integration', () => {
  test('shows disposition, residual targets, coverage metrics, and approval status while strict audit validates artifacts', async () => {
    const store = new FileStore();
    const { paths } = await prepareTargetCoverageProject(tempRoot, store);
    const coverage = await runCodexDiagnosticsTargetCoverage({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1
    }, store);
    const stateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());

    const review = await reviewChapter({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      diagnostics: true,
      artifacts: true,
      suggestNext: true
    }, store);
    expect(review).toContain('Candidate disposition');
    expect(review).toContain('rejected_no_improvement');
    expect(review).toContain('Target coverage closure');
    expect(review).toContain('coverageClosed: true');
    expect(review).toContain('uncoveredParagraphs: 7, 9, 10, 11, 13');
    expect(review).toContain('approved: false');
    expect(review).toContain('approve-target-expansion');

    const audit = await auditProject({ projectId: adjudicationProjectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.ok).toBe(true);
    await expect(store.readText(paths.storyState())).resolves.toBe(stateBefore);
    await expect(store.readText(paths.chapterQueue())).resolves.toBe(queueBefore);

    const report = JSON.parse(await store.readText(paths.projectArtifact(coverage.reportPath))) as Record<string, unknown>;
    report.projectedEventOccurrenceCoverageAfter = 0.5;
    await store.writeText(paths.projectArtifact(coverage.reportPath), `${JSON.stringify(report, null, 2)}\n`);
    const brokenAudit = await auditProject({ projectId: adjudicationProjectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(brokenAudit.ok).toBe(false);
    expect(brokenAudit.report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'target_coverage', blocking: true })
    ]));
  }, 45_000);
});
