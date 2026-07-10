import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import {
  buildDiagnosticsContextManifest,
  generateCodexDiagnosticsHardFailAnalysis,
  runCodexDiagnosticsBenchmark
} from '../../src/app/codexDiagnosticsHardFailAnalysis.js';
import { initProject } from '../../src/app/initProject.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import {
  CodexDiagnosticsBenchmarkReportSchema,
  CodexDiagnosticsContextFixReportSchema,
  CodexDiagnosticsHardFailAnalysisSchema,
  DiagnosticsContextManifestSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m2711-context-fix-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M27.11 diagnostics context fix pilot', () => {
  test('diagnostics context builder writes an enhanced manifest with required artifacts and excludes raw Codex dumps', async () => {
    const { store, paths, codexBin } = await prepareDiagnosticsHardFailProject();
    await runControlledPreview(store, codexBin, 'run_m2711_context_source');
    const before = await store.readJson(paths.storyState(), StoryStateSchema);

    const result = await buildDiagnosticsContextManifest({ projectId, projectsRoot: tempRoot, chapterNumber: 1, mode: 'enhanced' }, store);

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(before);
    const manifest = await store.readJson(paths.chapterArtifact(1, 'diagnostics_context_manifest_v1.json'), DiagnosticsContextManifestSchema);
    expect(result.manifestPath).toBe('chapters/chapter_001/diagnostics_context_manifest_v1.json');
    expect(manifest.mode).toBe('enhanced');
    expect(manifest.requiredArtifacts).toEqual(
      expect.arrayContaining(['story_state summary', 'character_states', 'timeline', 'reader_state', 'open narrative debts', 'unresolved foreshadowing', 'selected plan', 'chapter mission', 'chapter draft'])
    );
    expect(manifest.missingRequiredArtifacts).toEqual([]);
    expect(manifest.storyStateSummaryIncluded).toBe(true);
    expect(manifest.characterStatesIncluded).toBe(true);
    expect(manifest.timelineIncluded).toBe(true);
    expect(manifest.readerStateIncluded).toBe(true);
    expect(manifest.openDebtsIncluded).toBe(true);
    expect(manifest.unresolvedForeshadowingIncluded).toBe(true);
    expect(manifest.selectedPlanIncluded).toBe(true);
    expect(manifest.missionIncluded).toBe(true);
    expect(manifest.draftIncluded).toBe(true);
    expect(manifest.includedArtifacts.some((artifact) => artifact.path.includes('codex/runs') || artifact.path.includes('archive'))).toBe(false);
  });

  test('baseline and enhanced diagnostics benchmarks compare context impact without mutating canonical artifacts', async () => {
    const { store, paths, codexBin } = await prepareDiagnosticsHardFailProject();
    await runControlledPreview(store, codexBin, 'run_m2711_benchmark_source');
    const beforeState = await store.readJson(paths.storyState(), StoryStateSchema);
    const canonicalDiagnostics = await store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json'));

    const baseline = await runCodexDiagnosticsBenchmark(
      {
        projectId,
        projectsRoot: tempRoot,
        promptRoot,
        chapterNumber: 1,
        samples: 2,
        contextMode: 'baseline',
        codexBin,
        codexProfile: 'clean',
        codexJsonRetries: 1,
        codexJsonRepair: false,
        codexTimeoutMs: 30_000
      },
      store
    );
    const enhanced = await runCodexDiagnosticsBenchmark(
      {
        projectId,
        projectsRoot: tempRoot,
        promptRoot,
        chapterNumber: 1,
        samples: 2,
        contextMode: 'enhanced',
        codexBin,
        codexProfile: 'clean',
        codexJsonRetries: 1,
        codexJsonRepair: false,
        codexTimeoutMs: 30_000
      },
      store
    );

    const baselineReport = await store.readJson(paths.chapterArtifact(1, 'codex_diagnostics_benchmark_v1.json'), CodexDiagnosticsBenchmarkReportSchema);
    const enhancedReport = await store.readJson(paths.chapterArtifact(1, 'codex_diagnostics_benchmark_v2.json'), CodexDiagnosticsBenchmarkReportSchema);
    expect(baseline.reportPath).toBe('chapters/chapter_001/codex_diagnostics_benchmark_v1.json');
    expect(enhanced.reportPath).toBe('chapters/chapter_001/codex_diagnostics_benchmark_v2.json');
    expect(baselineReport.contextMode).toBe('baseline');
    expect(enhancedReport.contextMode).toBe('enhanced');
    expect(enhancedReport.diagnosticsContextManifestPath).toBe('chapters/chapter_001/diagnostics_context_manifest_v2.json');
    expect(enhancedReport.hardCheckResultsDistribution.timeline_consistency?.failed).toBe(2);
    expect(enhancedReport.hardCheckResultsDistribution.character_knowledge_consistency?.passed).toBe(2);

    const fix = await store.readJson(paths.chapterArtifact(1, 'codex_diagnostics_context_fix_report_v1.json'), CodexDiagnosticsContextFixReportSchema);
    expect(fix.baselineBenchmarkPath).toBe('chapters/chapter_001/codex_diagnostics_benchmark_v1.json');
    expect(fix.enhancedBenchmarkPath).toBe('chapters/chapter_001/codex_diagnostics_benchmark_v2.json');
    expect(fix.contextManifestPath).toBe('chapters/chapter_001/diagnostics_context_manifest_v2.json');
    expect(fix.baselineHardFailRateAmongSchemaValidSamples).toBe(1);
    expect(fix.enhancedHardFailRateAmongSchemaValidSamples).toBe(1);
    expect(fix.experimentValid).toBe(true);
    expect(fix.enhancedInsufficientEvidenceCount).toBeLessThan(fix.baselineInsufficientEvidenceCount);
    expect(fix.hardCheckComparison.find((item) => item.checkName === 'timeline_consistency')?.classificationAfter).toBe('true_positive_draft_issue');
    expect(fix.conclusion).toBe('true_positive_draft_issue_confirmed');

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(beforeState);
    await expect(store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json'))).resolves.toBe(canonicalDiagnostics);

    const analysis = await generateCodexDiagnosticsHardFailAnalysis({ projectId, projectsRoot: tempRoot, chapterNumber: 1, contextMode: 'enhanced' }, store);
    expect(analysis.analysis.contextMode).toBe('enhanced');
    expect(analysis.analysis.contextFixReportPath).toBe('chapters/chapter_001/codex_diagnostics_context_fix_report_v1.json');
    expect(analysis.analysis.classificationChanged).toBe(true);
    expect(analysis.analysis.remainingInsufficientEvidence.length).toBe(0);

    const review = await reviewChapter({ projectId, projectsRoot: tempRoot, chapterNumber: 1, diagnostics: true, artifacts: true, suggestNext: true }, store);
    expect(review).toContain('Diagnostics context fix');
    expect(review).toContain('baselineHardFailRateAmongSchemaValidSamples: 1');
    expect(review).toContain('enhancedHardFailRateAmongSchemaValidSamples: 1');
    expect(review).toContain('true_positive_draft_issue_confirmed');

    const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.ok).toBe(true);

    const benchmarkPath = paths.chapterArtifact(1, 'codex_diagnostics_benchmark_v2.json');
    const tampered = JSON.parse(await store.readText(benchmarkPath)) as Record<string, unknown>;
    tampered.schemaValidSampleCount = 0;
    tampered.schemaInvalidSampleCount = 2;
    tampered.hardFailCountAmongSchemaValidSamples = 2;
    tampered.hardFailRateAmongSchemaValidSamples = 1;
    await store.writeText(benchmarkPath, `${JSON.stringify(tampered, null, 2)}\n`);
    const invalidAudit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(invalidAudit.ok).toBe(false);
    expect(invalidAudit.report.issues.some((issue) => issue.issueId.includes('invalid_denominator'))).toBe(true);
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
