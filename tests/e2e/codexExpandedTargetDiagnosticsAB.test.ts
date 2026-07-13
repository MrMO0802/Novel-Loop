import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexExpandedTargetRevisionExperiment } from '../../src/app/codexExpandedTargetRevisionExperiment.js';
import { ExpandedTargetRevisionDiagnosticsABSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareApprovedExpandedTargetRevisionProject } from './codexExpandedTargetRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d2-ab-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D2 paired diagnostics A/B', () => {
  test('uses alternating independent artifacts and schema-valid denominators', async () => {
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
    const diagnostics = await store.readJson(paths.projectArtifact(result.diagnosticsABPath), ExpandedTargetRevisionDiagnosticsABSchema);

    expect(diagnostics.executionOrder).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    expect(diagnostics.provider).toBe('codex-text');
    expect(diagnostics.codexProfile).toBe('clean');
    expect(diagnostics.codexVersions).toEqual(['codex-cli 9.9.9']);
    expect(diagnostics.diagnosticsPromptId).toBe('diagnostics.diagnose_chapter_slim');
    expect(diagnostics.diagnosticsOutputSchemaPath).toMatch(/diagnostics\.report\.slim\.schema\.json$/);
    expect(diagnostics.sharedContextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(diagnostics.baselineSchemaValidRate).toBe(1);
    expect(diagnostics.candidateSchemaValidRate).toBe(1);
    expect(diagnostics.baselineTimelineFailureRate).toBe(1);
    expect(diagnostics.candidateTimelineFailureRate).toBe(0);
    expect(diagnostics.baselineAnyBlockingFailureRate).toBe(1);
    expect(diagnostics.candidateAnyBlockingFailureRate).toBe(0);
    expect(diagnostics.resolvedHardChecks).toContain('timeline_consistency');
    expect(diagnostics.newlyIntroducedHardChecks).toEqual([]);
    expect(new Set(diagnostics.samples.map((sample) => sample.parsedOutputPath)).size).toBe(6);
    expect(diagnostics.experimentValid).toBe(true);
  }, 60_000);
});
