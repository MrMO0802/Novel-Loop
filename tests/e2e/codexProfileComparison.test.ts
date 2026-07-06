import { describe, expect, test } from 'vitest';

import { runCodexProfileComparison } from '../../src/app/codexRuntimeBenchmark.js';
import { CodexRuntimeBenchmarkReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M26.5 codex benchmark profile comparison', () => {
  test('compares clean and debug profiles for the requested level', async () => {
    const tempRoot = await createTempRoot('novel-loop-m265-profile-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();

      const result = await runCodexProfileComparison(
        {
          projectId: 'codex-compare',
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'health',
          profiles: ['clean', 'debug'],
          codexStageTimeoutMs: 5_000
        },
        store
      );

      expect(result.report.success).toBe(true);
      expect(result.report.profileComparisons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ profile: 'clean', success: true }),
          expect.objectContaining({ profile: 'debug', success: true })
        ])
      );
      const paths = new ProjectPaths(tempRoot, 'codex-compare');
      await expect(store.readJson(paths.auditArtifact('codex_runtime_benchmark_report_v1.json'), CodexRuntimeBenchmarkReportSchema)).resolves.toMatchObject({
        profile: 'comparison',
        success: true
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  });
});
