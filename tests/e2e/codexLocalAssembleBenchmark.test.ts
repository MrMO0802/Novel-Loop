import { describe, expect, test } from 'vitest';

import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { CodexRealOptimizationBenchmarkReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.5.5 local assemble benchmark', () => {
  test('local assemble benchmark skips revision.final_chapter while preserving quality and patch proposal calls', async () => {
    const tempRoot = await createTempRoot('novel-loop-m2755-local-assemble-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const projectId = 'codex-bench-m275-local-assemble';
      const result = await runCodexRuntimeBenchmark(
        {
          projectId,
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'preview',
          codexProfile: 'clean',
          codexFinalMode: 'local-assemble',
          useCache: true
        },
        store
      );

      const paths = new ProjectPaths(tempRoot, projectId);
      const previewStage = result.report.stages.find((stage) => stage.stageName === 'chapter-001-preview');
      const manifest = await store.readJson(paths.runManifest(previewStage!.runId!), RunManifestV2Schema);
      const promptIds = manifest.promptCalls.map((call) => call.promptId);
      expect(promptIds).not.toContain('revision.final_chapter');
      expect(promptIds).toContain('memory.extract_canon_patch_proposal_slim');
      expect(manifest.artifacts.map((artifact) => artifact.path)).toEqual(
        expect.arrayContaining(['chapters/chapter_001/final_assembly_report_v1.json', 'chapters/chapter_001/final.md'])
      );
      const report = await store.readJson(paths.auditArtifact('codex_real_optimization_benchmark_report_v1.json'), CodexRealOptimizationBenchmarkReportSchema);
      expect(report.localAssembleUsed).toBe(true);
      expect(report.callCountBefore).toBeGreaterThan(report.callCountAfter);
      expect(report.qualityReportPaths).toHaveLength(1);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 40_000);
});
