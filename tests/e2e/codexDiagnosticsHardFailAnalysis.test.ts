import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import {
  generateCodexDiagnosticsHardFailAnalysis,
  runCodexDiagnosticsBenchmark
} from '../../src/app/codexDiagnosticsHardFailAnalysis.js';
import { initProject } from '../../src/app/initProject.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import {
  CodexDiagnosticsBenchmarkReportSchema,
  CodexDiagnosticsContextAuditSchema,
  CodexDiagnosticsHardFailAnalysisSchema,
  RevisionOpportunityReportSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m2710-diagnostics-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M27.10 Codex diagnostics hard-fail analysis', () => {
  test('generates deterministic hard-fail analysis, context audit, and revision opportunity reports without mutating Story State', async () => {
    const { store, paths, codexBin } = await prepareDiagnosticsHardFailProject();
    await runControlledPreview(store, codexBin, 'run_m2710_hard_fail');
    const before = await store.readJson(paths.storyState(), StoryStateSchema);

    const result = await generateCodexDiagnosticsHardFailAnalysis({ projectId, projectsRoot: tempRoot, chapterNumber: 1 }, store);

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(before);
    const analysis = await store.readJson(paths.chapterArtifact(1, 'codex_diagnostics_hard_fail_analysis_v1.json'), CodexDiagnosticsHardFailAnalysisSchema);
    expect(result.analysisPath).toBe('chapters/chapter_001/codex_diagnostics_hard_fail_analysis_v1.json');
    expect(analysis.storyStateMutated).toBe(false);
    expect(analysis.sourceDiagnosticsPath).toBe('chapters/chapter_001/diagnostics_v1.json');
    expect(analysis.hardFailures.map((failure) => failure.checkName)).toEqual(
      expect.arrayContaining(['timeline_consistency', 'character_knowledge_consistency', 'world_rule_consistency', 'no_unplanned_reveal'])
    );
    expect(analysis.hardFailures.map((failure) => failure.classification)).toContain('insufficient_evidence');
    expect(analysis.suspectedRootCauses).toContain('diagnostics_missing_context');
    expect(analysis.suggestedRetryCommand).toContain('--resume-from revision_plan');

    const contextAudit = await store.readJson(paths.chapterArtifact(1, 'diagnostics_context_audit_v1.json'), CodexDiagnosticsContextAuditSchema);
    expect(contextAudit.storyStateMutated).toBe(false);
    expect(contextAudit.requiredArtifacts).toEqual(expect.arrayContaining(['story_state summary', 'selected plan', 'chapter draft']));
    expect(contextAudit.missingRequiredArtifacts).toEqual(expect.arrayContaining(['story_state summary', 'reader_state', 'selected plan']));
    expect(contextAudit.contextTruncated).toBe(false);

    const opportunity = await store.readJson(paths.chapterArtifact(1, 'revision_opportunity_report_v1.json'), RevisionOpportunityReportSchema);
    expect(opportunity.storyStateMutated).toBe(false);
    expect(opportunity.proposedRevisionTargets.length).toBeGreaterThan(0);
    expect(opportunity.suggestedRetryCommand).toContain('--resume-from revision_plan');

    const review = await reviewChapter({ projectId, projectsRoot: tempRoot, chapterNumber: 1, diagnostics: true, artifacts: true, suggestNext: true }, store);
    expect(review).toContain('Diagnostics hard-fail analysis');
    expect(review).toContain('diagnostics_context_audit_v1.json');
    expect(review).toContain('revision_opportunity_report_v1.json');

    const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.ok).toBe(true);
  });

  test('diagnostics benchmark samples only diagnostics and does not mutate canonical diagnostics or Story State', async () => {
    const { store, paths, codexBin } = await prepareDiagnosticsHardFailProject();
    await runControlledPreview(store, codexBin, 'run_m2710_benchmark_source');
    const beforeState = await store.readJson(paths.storyState(), StoryStateSchema);
    const canonicalDiagnostics = await store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json'));

    const result = await runCodexDiagnosticsBenchmark(
      {
        projectId,
        projectsRoot: tempRoot,
        promptRoot,
        chapterNumber: 1,
        samples: 2,
        codexBin,
        codexProfile: 'clean',
        codexJsonRetries: 1,
        codexJsonRepair: false,
        codexTimeoutMs: 30_000
      },
      store
    );

    expect(result.reportPath).toBe('chapters/chapter_001/codex_diagnostics_benchmark_v1.json');
    const report = await store.readJson(paths.chapterArtifact(1, 'codex_diagnostics_benchmark_v1.json'), CodexDiagnosticsBenchmarkReportSchema);
    expect(report.sampleCount).toBe(2);
    expect(report.schemaValidRate).toBe(1);
    expect(report.hardFailRate).toBe(1);
    expect(report.samples.every((sample) => sample.storyStateMutated === false)).toBe(true);
    expect(report.stableFailure).toBe(true);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(beforeState);
    await expect(store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json'))).resolves.toBe(canonicalDiagnostics);
  });
});

async function prepareDiagnosticsHardFailProject() {
  const fake = await writeFakeCodex(tempRoot, 'codex-controlled-diagnostics-fail');
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await runChapterDryRun({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await runChapterUntilDraft({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  return { store, paths: new ProjectPaths(tempRoot, projectId), codexBin: fake.codexBin };
}

function runControlledPreview(store: FileStore, codexBin: string, runId: string) {
  return runChapterFullProduction(
    {
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin,
      codexProfile: 'clean',
      codexJsonRetries: 1,
      codexJsonRepair: false,
      maxRevisions: 2,
      commit: true,
      runId
    },
    store
  );
}
