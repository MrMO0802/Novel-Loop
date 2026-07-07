import { describe, expect, test } from 'vitest';

import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { CodexRealOptimizationBenchmarkReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.5.5 context budget benchmark', () => {
  test('real optimization report records bounded write_scene context statistics and exclusions', async () => {
    const tempRoot = await createTempRoot('novel-loop-m2755-context-budget-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const projectId = 'codex-bench-m275-context';
      await runCodexRuntimeBenchmark(
        {
          projectId,
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'draft',
          codexProfile: 'clean',
          useCache: true,
          codexContextMode: 'compact',
          codexContextBudgetBytes: 1_200
        },
        store
      );

      const paths = new ProjectPaths(tempRoot, projectId);
      const report = await store.readJson(paths.auditArtifact('codex_real_optimization_benchmark_report_v1.json'), CodexRealOptimizationBenchmarkReportSchema);
      expect(report.contextBudgetStats).toMatchObject({
        manifestCount: 2,
        averageContextBytes: expect.any(Number),
        maxContextBytes: expect.any(Number),
        overBudgetCount: 0
      });
      expect(report.contextBudgetStats.maxContextBytes).toBeLessThanOrEqual(1_200);
      expect(report.contextBudgetStats.contextBudgetWarnings.join('\n')).not.toContain('raw_output');
      expect(report.safetyChecks.contextManifestDidNotMutateStoryState).toBe(true);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});
