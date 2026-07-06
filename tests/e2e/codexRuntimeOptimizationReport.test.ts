import { describe, expect, test } from 'vitest';

import { generateCodexRuntimeOptimizationReport } from '../../src/app/codexRuntimeOptimization.js';
import { CodexRuntimeOptimizationReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { initProject } from '../../src/app/initProject.js';
import { briefPath, createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';

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
      await expect(store.readJson(paths.auditArtifact('codex_runtime_optimization_report_v1.json'), CodexRuntimeOptimizationReportSchema)).resolves.toMatchObject({
        projectId
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  });
});
