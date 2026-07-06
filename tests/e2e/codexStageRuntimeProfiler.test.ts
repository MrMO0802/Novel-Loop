import { describe, expect, test } from 'vitest';

import { profileCodexRuntime } from '../../src/app/codexRuntimeProfiler.js';
import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { CodexStageRuntimeProfileReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27 codex stage runtime profiler', () => {
  test('aggregates benchmark/run manifest metrics without invoking Codex', async () => {
    const tempRoot = await createTempRoot('novel-loop-m27-profile-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      await runCodexRuntimeBenchmark(
        {
          projectId: 'codex-profile',
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'plan',
          codexProfile: 'clean',
          codexStageTimeoutMs: 5_000
        },
        store
      );

      const result = await profileCodexRuntime({ projectId: 'codex-profile', projectsRoot: tempRoot }, store);

      expect(result.report.totalDurationMs).toBeGreaterThan(0);
      expect(result.report.durationByStage.build_bible).toBeGreaterThanOrEqual(0);
      expect(result.report.durationByStage.plan_global_outline).toBeGreaterThanOrEqual(0);
      expect(result.report.codexCallsByStage.build_bible).toBeGreaterThanOrEqual(0);
      expect(result.report.slowestStages.length).toBeGreaterThan(0);
      expect(result.report.optimizationCandidates.length).toBeGreaterThan(0);

      const paths = new ProjectPaths(tempRoot, 'codex-profile');
      await expect(store.readJson(paths.auditArtifact('codex_stage_runtime_profile_v1.json'), CodexStageRuntimeProfileReportSchema)).resolves.toMatchObject({
        projectId: 'codex-profile'
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});
