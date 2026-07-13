import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexExpandedTargetRevisionExperiment } from '../../src/app/codexExpandedTargetRevisionExperiment.js';
import { ExpandedTargetRevisionPlanSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareApprovedExpandedTargetRevisionProject } from './codexExpandedTargetRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d2-plan-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D2 expanded target revision plan', () => {
  test('uses the original draft and exactly the approved complete target set', async () => {
    const store = new FileStore();
    const { paths, coverage, approval, fake } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store);

    const result = await runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      promptRoot: './prompts',
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin,
      codexProfile: 'clean'
    }, store);

    const plan = await store.readJson(paths.projectArtifact(result.planPath), ExpandedTargetRevisionPlanSchema);
    const approvedIds = [
      ...coverage.report.initialTargets.map((target) => target.targetId),
      ...coverage.report.proposedAdditionalTargets.map((target) => target.targetId)
    ].sort();
    expect(plan.revisionRound).toBe(2);
    expect(plan.sourceDraftPath).toBe('chapters/chapter_001/draft_v1.md');
    expect(plan.sourceCandidatePath).toBeNull();
    expect(plan.approvalRecordPath).toBe(approval.recordPath);
    expect(plan.coverageReportPath).toBe(coverage.reportPath);
    expect([...plan.fullApprovedTargetIds].sort()).toEqual(approvedIds);
    expect([...plan.allowedTargets.map((target) => target.targetId)].sort()).toEqual(approvedIds);
    expect(plan.targetOperationCoverage.filter((target) => target.requiredForClosure).every((target) => target.disposition !== 'preserved_with_justification')).toBe(true);
    await expect(store.readText(paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v1.md'))).resolves.not.toBe('');
  }, 45_000);
});
