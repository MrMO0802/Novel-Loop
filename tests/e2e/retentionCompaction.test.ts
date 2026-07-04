import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { applyRetentionPolicy, previewRetentionPolicy } from '../../src/app/retention.js';
import { compactProvenance } from '../../src/app/provenanceCompaction.js';
import { createStressFixture } from '../../src/app/stressFixture.js';
import { RetentionReportSchema, ProvenanceCompactionReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m20-retention-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M20 retention and provenance compaction', () => {
  test('previews and applies run retention without mutating Story State', async () => {
    const store = new FileStore();
    const fixture = await createStressFixture({ projectId, projectsRoot: tempRoot, chapters: 12, runsPerChapter: 2 }, store);
    const stateBefore = await store.readText(fixture.paths.storyState());

    const preview = await previewRetentionPolicy({ projectId, projectsRoot: tempRoot, keepRuns: 5 }, store);
    expect(preview.applied).toBe(false);
    expect(preview.candidateRunIds.length).toBe(19);
    expect(await store.exists(fixture.paths.projectArtifact('retention/runs'))).toBe(false);
    expect(await store.readText(fixture.paths.storyState())).toBe(stateBefore);

    const applied = await applyRetentionPolicy({ projectId, projectsRoot: tempRoot, keepRuns: 5 }, store);
    expect(applied.applied).toBe(true);
    expect(applied.retainedRunIds).toHaveLength(19);
    expect(applied.keptRunIds).toHaveLength(5);
    expect(applied.reportPath).toBe('audit/retention_report_v1.json');
    await expect(store.exists(fixture.paths.projectArtifact('retention/runs/stress_ch001_planning/run_manifest.json'))).resolves.toBe(true);
    await expect(store.exists(fixture.paths.runManifest('stress_ch012_commit'))).resolves.toBe(true);
    expect(await store.readText(fixture.paths.storyState())).toBe(stateBefore);

    const report = await store.readJson(fixture.paths.auditArtifact('retention_report_v1.json'), RetentionReportSchema);
    expect(report.retainedRunIds).toContain('stress_ch001_planning');
    expect(report.policy.keepRuns).toBe(5);
  }, 20000);

  test('compacts oversized event logs into schema-validated summary artifacts', async () => {
    const store = new FileStore();
    const fixture = await createStressFixture({ projectId, projectsRoot: tempRoot, chapters: 3, runsPerChapter: 2, extraEventsPerRun: 8 }, store);
    const stateBefore = await store.readJson(fixture.paths.storyState(), StoryStateSchema);

    const result = await compactProvenance({ projectId, projectsRoot: tempRoot, maxEventsPerRun: 4, apply: true }, store);

    expect(result.applied).toBe(true);
    expect(result.compactedRuns.length).toBeGreaterThan(0);
    expect(result.reportPath).toBe('audit/provenance_compaction_v1.json');
    const compactedEvents = await store.readText(fixture.paths.runEvents('stress_ch001_planning'));
    expect(compactedEvents.trim().split('\n').length).toBeLessThanOrEqual(4);
    expect(compactedEvents).toContain('PROVENANCE_COMPACTED');
    expect(await store.readJson(fixture.paths.storyState(), StoryStateSchema)).toEqual(stateBefore);

    const report = await store.readJson(fixture.paths.auditArtifact('provenance_compaction_v1.json'), ProvenanceCompactionReportSchema);
    expect(report.compactedRuns.length).toBe(result.compactedRuns.length);
    expect(report.totalEventsRemoved).toBeGreaterThan(0);
  }, 20000);
});
