import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexExpandedTargetRevisionExperiment } from '../../src/app/codexExpandedTargetRevisionExperiment.js';
import {
  CandidateRevisionEvidenceAdjudicationSchema,
  CandidateTimelineContradictionMapSchema,
  ExpandedTargetRevisionCandidateDispositionSchema,
  ExpandedTargetRevisionExperimentReportSchema,
  ExpandedTargetRevisionQualityReportSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareApprovedExpandedTargetRevisionProject } from './codexExpandedTargetRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d2-disposition-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D2 experiment decision and disposition', () => {
  test('marks an effective candidate review-eligible without adopting or committing it', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store);
    const result = await runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 3,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store);
    const report = await store.readJson(paths.projectArtifact(result.reportPath), ExpandedTargetRevisionExperimentReportSchema);
    const disposition = await store.readJson(paths.projectArtifact(result.dispositionPath), ExpandedTargetRevisionCandidateDispositionSchema);
    const adjudication = await store.readJson(paths.projectArtifact(result.candidateAdjudicationPath), CandidateRevisionEvidenceAdjudicationSchema);
    const timelineMap = await store.readJson(paths.projectArtifact(result.candidateTimelineMapPath), CandidateTimelineContradictionMapSchema);

    expect(report.result).toBe('revision_effective');
    expect(adjudication.adjudication).toBe('no_remaining_contradiction');
    expect(Object.values(adjudication.checks).every(Boolean)).toBe(true);
    expect(timelineMap.contradictions).toEqual([]);
    expect(report.candidateAdopted).toBe(false);
    expect(report.normalPreviewStarted).toBe(false);
    expect(report.commitStarted).toBe(false);
    expect(disposition.result).toBe('accepted_for_preview_review');
    expect(disposition.adopted).toBe(false);
    expect(disposition.committed).toBe(false);
    expect(disposition.eligibleForPreviewReview).toBe(true);
    expect(disposition.automaticFurtherRevisionAllowed).toBe(false);
  }, 60_000);

  test('rejects an otherwise repaired candidate when median quality regresses beyond 0.25', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store, 'codex-expanded-target-quality-regression');
    const result = await runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 3,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store);
    const quality = await store.readJson(paths.projectArtifact(result.qualityReportPath), ExpandedTargetRevisionQualityReportSchema);
    const report = await store.readJson(paths.projectArtifact(result.reportPath), ExpandedTargetRevisionExperimentReportSchema);
    const disposition = await store.readJson(paths.projectArtifact(result.dispositionPath), ExpandedTargetRevisionCandidateDispositionSchema);

    expect(quality.scoreRegressionWithinLimit, JSON.stringify(quality)).toBe(false);
    expect(report.result).not.toBe('revision_effective');
    expect(disposition.result).toBe('rejected_quality_regression');
    expect(disposition.eligibleForPreviewReview).toBe(false);
    expect(disposition.requiresHumanReview).toBe(true);
  }, 60_000);
});
