import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { runCodexDiagnosticsSchemaBenchmark } from '../../src/app/codexDiagnosticsSchemaCompliance.js';
import { initProject } from '../../src/app/initProject.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import {
  CodexDiagnosticsSchemaBenchmarkReportSchema,
  DiagnosticsReportSchema,
  DiagnosticsSchemaComplianceReportSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { normalizeDiagnosticsWithReport } from '../../src/providers/codex/normalizers.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m2712-schema-benchmark-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M27.12A diagnostics schema micro-benchmark', () => {
  test('runs diagnostics only, saves evidence reports, and leaves canonical state/artifacts unchanged', async () => {
    const projectId = 'diagnostics-schema-benchmark';
    const store = new FileStore();
    const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
    await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
    await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot }, store);
    await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot }, store);
    await runChapterDryRun({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'mock', promptRoot }, store);
    await runChapterUntilDraft({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'mock', promptRoot }, store);
    const paths = new ProjectPaths(tempRoot, projectId);
    const beforeState = await store.readJson(paths.storyState(), StoryStateSchema);
    const canonicalDiagnosticsPath = paths.chapterArtifact(1, 'diagnostics_v1.json');
    await store.writeJson(canonicalDiagnosticsPath, normalizeDiagnosticsWithReport(validProviderDiagnostics(), { projectId, chapterNumber: 1 }).report, DiagnosticsReportSchema);
    const beforeDiagnostics = await store.readText(canonicalDiagnosticsPath);

    const result = await runCodexDiagnosticsSchemaBenchmark({
      projectId,
      projectsRoot: tempRoot,
      promptRoot,
      chapterNumber: 1,
      samples: 5,
      contextMode: 'enhanced',
      codexBin: fake.codexBin,
      codexProfile: 'clean',
      codexJsonRetries: 2,
      codexJsonRepair: true,
      codexTimeoutMs: 30_000
    }, store);

    const report = await store.readJson(paths.projectArtifact(result.reportPath), CodexDiagnosticsSchemaBenchmarkReportSchema);
    const compliance = await store.readJson(paths.projectArtifact(result.complianceReportPath), DiagnosticsSchemaComplianceReportSchema);
    expect(report.sampleCount).toBe(5);
    expect(report.providerSchemaValidRate).toBe(1);
    expect(report.normalizationSuccessRate).toBe(1);
    expect(report.internalSchemaValidRate).toBe(1);
    expect(report.semanticConsistencyRate).toBe(1);
    expect(report.releaseGatePassed).toBe(true);
    expect(compliance.validSampleCount).toBe(5);
    expect(compliance.storyStateMutated).toBe(false);
    expect(report.samples.every((sample) => sample.rawOutputPath.length > 0 && sample.finalOutputPath.length > 0 && sample.parsedOutputPath.length > 0)).toBe(true);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(beforeState);
    await expect(store.readText(canonicalDiagnosticsPath)).resolves.toBe(beforeDiagnostics);
    const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.ok).toBe(true);
  });
});

function validProviderDiagnostics() {
  const checks = ['timeline_consistency', 'character_knowledge_consistency', 'world_rule_consistency', 'no_unplanned_reveal'];
  return {
    chapterNumber: 1,
    draftVersion: 1,
    passed: true,
    averageScore: 8.6,
    hardChecks: checks.map((checkName) => ({ checkName, result: 'pass', blocking: false, evidence: '', explanation: 'No contradiction found.' })),
    softScores: {
      plot_progression: 8.6,
      character_consistency: 8.6,
      tension_curve: 8.6,
      emotional_impact: 8.6,
      chapter_hook: 8.6,
      style_match: 8.6,
      genre_satisfaction: 8.6,
      reader_curiosity: 8.6
    },
    diagnostics: [],
    revisionRequired: false
  };
}
