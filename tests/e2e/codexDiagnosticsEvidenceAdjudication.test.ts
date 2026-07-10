import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexDiagnosticsEvidenceAdjudication } from '../../src/app/codexDiagnosticsEvidenceAdjudication.js';
import { auditProject } from '../../src/app/projectAudit.js';
import {
  CodexDiagnosticsEvidenceAdjudicationSchema,
  RunManifestSchema,
  TimelineContradictionMapSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareDiagnosticsAdjudicationProject } from './codexDiagnosticsAdjudicationFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712b-adjudication-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12B diagnostics evidence adjudication', () => {
  test('confirms cited timeline contradictions and leaves canonical artifacts unchanged', async () => {
    const store = new FileStore();
    const { paths } = await prepareDiagnosticsAdjudicationProject(tempRoot, store);
    const protectedBefore = await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json'))
    ]);

    const result = await runCodexDiagnosticsEvidenceAdjudication({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1
    }, store);

    const report = await store.readJson(paths.projectArtifact(result.reportPath), CodexDiagnosticsEvidenceAdjudicationSchema);
    const map = await store.readJson(paths.projectArtifact(result.timelineMapPath), TimelineContradictionMapSchema);
    expect(report.adjudication).toBe('confirmed_true_positive');
    expect(report.confidence).toBe('high');
    expect(report.repeatedSampleCount).toBe(5);
    expect(report.repeatedFailureCount).toBe(5);
    expect(report.repeatabilityRate).toBe(1);
    expect(report.draftEvidence.some((evidence) => evidence.inferredTime === 'midday_peak')).toBe(true);
    expect(report.draftEvidence.some((evidence) => evidence.explicitTime === '23:17')).toBe(true);
    const canonicalContextReview = report.canonicalContextReview;
    expect(canonicalContextReview).toBeDefined();
    expect(canonicalContextReview).toMatchObject({
      latestCommittedChapter: 0,
      canonicalTimelineConflictFound: false,
      characterStateConflictFound: false
    });
    expect(canonicalContextReview!.timelineEventsReviewed).toBeGreaterThanOrEqual(0);
    expect(canonicalContextReview!.characterStatesReviewed).toBeGreaterThanOrEqual(0);
    expect(report.temporalRulesTriggered).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'same_event_same_day_explicit_time_conflict', outcome: 'confirmed_contradiction' }),
      expect.objectContaining({ ruleId: 'duplicate_event_repetition', outcome: 'confirmed_contradiction' })
    ]));
    expect(report.revisionScopeRecommendation.factsToCorrect.length).toBeGreaterThan(0);
    expect(report.protectedArtifacts.map((artifact) => artifact.path)).toEqual(expect.arrayContaining([
      'state/story_state.json',
      'planning/chapter_queue.json',
      'chapters/chapter_001/draft_v1.md',
      'chapters/chapter_001/diagnostics_v1.json'
    ]));
    expect(map.contradictions.length).toBeGreaterThanOrEqual(2);
    expect(map.eventNodes.length).toBeGreaterThanOrEqual(4);
    const runManifest = await store.readJson(paths.runManifest(result.runId), RunManifestSchema);
    expect(runManifest.promptCalls).toEqual([]);
    expect(runManifest.args).toMatchObject({ codexInvoked: false, storyStateCommitAllowed: false });
    expect(await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json'))
    ])).toEqual(protectedBefore);

    const audit = await auditProject({ projectId: adjudicationProjectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.ok).toBe(true);
  }, 30_000);
});
