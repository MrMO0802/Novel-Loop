import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexTargetedRevisionExperiment } from '../../src/app/codexTargetedRevisionExperiment.js';
import { auditProject } from '../../src/app/projectAudit.js';
import {
  RunManifestSchema,
  TargetedRevisionDiffSchema,
  TargetedRevisionExperimentReportSchema,
  TargetedRevisionPlanSchema,
  TargetedRevisionScopeValidationSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetedRevisionProject } from './codexTargetedRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712c-experiment-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12C targeted preview-only revision experiment', () => {
  test('creates an isolated candidate and runs paired alternating diagnostics without canonical mutation', async () => {
    const store = new FileStore();
    const { paths, fake, adjudication } = await prepareTargetedRevisionProject(tempRoot, store);
    const protectedBefore = await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json'))
    ]);

    const result = await runCodexTargetedRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      promptRoot: './prompts',
      chapterNumber: 1,
      adjudication: 'latest',
      samples: 3,
      contextMode: 'enhanced',
      codexBin: fake.codexBin,
      codexProfile: 'clean',
      codexJsonRetries: 2,
      codexJsonRepair: true,
      codexTimeoutMs: 30_000
    }, store);

    const plan = await store.readJson(paths.projectArtifact(result.planPath), TargetedRevisionPlanSchema);
    const scope = await store.readJson(paths.projectArtifact(result.scopeValidationPath), TargetedRevisionScopeValidationSchema);
    const diff = await store.readJson(paths.projectArtifact(result.diffPath), TargetedRevisionDiffSchema);
    const report = await store.readJson(paths.projectArtifact(result.reportPath), TargetedRevisionExperimentReportSchema);
    expect(plan.allowedTargets.map((target) => target.paragraphIndex)).toEqual(adjudication.report.revisionScopeRecommendation.affectedParagraphs);
    expect(plan.operations.every((operation) => operation.newFactsIntroduced.length === 0)).toBe(true);
    expect(scope.scopeValid).toBe(true);
    expect(scope.unauthorizedChanges).toEqual([]);
    expect(diff.changes.length).toBeGreaterThan(0);
    expect(report.executionOrder).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    expect(report.baselineSummary.timelineFailCount).toBe(3);
    expect(report.candidateSummary.timelineFailCount).toBe(0);
    expect(report.result).toBe('candidate_clears_timeline_failure');
    expect(report.candidateAdopted).toBe(false);
    expect(report.normalPreviewStarted).toBe(false);
    expect(report.commitStarted).toBe(false);
    expect(report.storyStateMutated).toBe(false);
    expect(await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json'))
    ])).toEqual(protectedBefore);
    const manifest = await store.readJson(paths.runManifest(result.runId), RunManifestSchema);
    expect(manifest.args).toMatchObject({
      storyStateCommitAllowed: false,
      normalPreviewAllowed: false,
      candidateAdoptionAllowed: false
    });
    expect(manifest.promptCalls).toHaveLength(7);
    expect(manifest.stateMutations).toEqual([]);
    expect(manifest.queueTransitions).toEqual([]);
    const audit = await auditProject({ projectId: adjudicationProjectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.ok).toBe(true);
  }, 45_000);
});
