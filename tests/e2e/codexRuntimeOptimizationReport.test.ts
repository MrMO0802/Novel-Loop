import { describe, expect, test } from 'vitest';

import { generateCodexRuntimeOptimizationReport } from '../../src/app/codexRuntimeOptimization.js';
import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { CodexRuntimeOptimizationReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { initProject } from '../../src/app/initProject.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27 codex runtime optimization report', () => {
  test('compares current runtime metrics against the M26.5 baseline', async () => {
    const tempRoot = await createTempRoot('novel-loop-m27-runtime-optimization-');
    try {
      const store = new FileStore();
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      const paths = new ProjectPaths(tempRoot, projectId);

      const result = await generateCodexRuntimeOptimizationReport(
        {
          projectId,
          projectsRoot: tempRoot,
          realBenchmark: false,
          currentDurationsMs: {
            bible: 200_000,
            plan: 120_000,
            draft: 200_000,
            preview: 150_000,
            confirm: 7_000,
            chapter2: 250_000,
            chapter3: 260_000
          }
        },
        store
      );

      expect(result.report.realBenchmark).toBe(false);
      expect(result.report.improvedStages).toEqual(expect.arrayContaining(['plan', 'chapter2', 'chapter3']));
      expect(result.report.baseline.chapter2).toBe(341_236);
      expect(result.report.deltaByPromptId).toMatchObject({
        'revision.final_chapter': expect.any(Number)
      });
      expect(result.report.cacheHits).toBeGreaterThanOrEqual(0);
      expect(result.report.localAssembleUsage).toBeGreaterThanOrEqual(0);
      expect(result.report.contextBudgetStats).toMatchObject({
        manifestCount: expect.any(Number),
        overBudgetCount: expect.any(Number)
      });
      expect(result.report.warnings).toEqual(expect.any(Array));
      expect(result.report.nextRecommendations).toEqual(expect.arrayContaining([expect.stringContaining('local assemble')]));
      await expect(store.readJson(paths.auditArtifact('codex_runtime_optimization_report_v1.json'), CodexRuntimeOptimizationReportSchema)).resolves.toMatchObject({
        projectId
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  });

  test('low-risk-v1 benchmark mode uses local final assembly instead of a final chapter Codex call', async () => {
    const tempRoot = await createTempRoot('novel-loop-m275-runtime-optimization-mode-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const optimizedProjectId = 'codex-runtime-optimization-mode';
      const result = await runCodexRuntimeBenchmark(
        {
          projectId: optimizedProjectId,
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'preview',
          codexProfile: 'clean',
          codexJsonRetries: 2,
          codexJsonRepair: true,
          optimizationMode: 'low-risk-v1',
          codexContextBudgetBytes: 1_200
        },
        store
      );
      const paths = new ProjectPaths(tempRoot, optimizedProjectId);
      const previewStage = result.report.stages.find((stage) => stage.stageName === 'chapter-001-preview');
      expect(previewStage?.status).toBe('success');
      expect(previewStage?.runId).toBeDefined();
      const manifest = await store.readJson(paths.runManifest(previewStage!.runId!), RunManifestV2Schema);
      expect(manifest.promptCalls.map((call) => call.promptId)).not.toContain('revision.final_chapter');
      expect(manifest.artifacts.map((artifact) => artifact.path)).toEqual(
        expect.arrayContaining(['chapters/chapter_001/final.md', 'chapters/chapter_001/final_assembly_report_v1.json'])
      );
      await expect(store.exists(paths.projectArtifact('strategy/build_bible_cache_report_v1.json'))).resolves.toBe(true);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 40_000);
});
