import { describe, expect, test } from 'vitest';

import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { CodexRuntimeFailureReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M26.5 codex long-run failure classification', () => {
  test('classifies missing final output as CODEX_NO_FINAL_MESSAGE in benchmark report', async () => {
    const tempRoot = await createTempRoot('novel-loop-m265-failure-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'missing-output');
      const store = new FileStore();
      const result = await runCodexRuntimeBenchmark(
        {
          projectId: 'codex-failure',
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'health',
          codexProfile: 'clean',
          codexStageTimeoutMs: 5_000
        },
        store
      );

      expect(result.report.success).toBe(false);
      expect(result.report.failedLevel).toBe('health');
      const failed = result.report.stages.at(-1);
      expect(failed).toMatchObject({
        stageName: 'codex-exec-json',
        status: 'failed',
        errorCode: 'CODEX_NO_FINAL_MESSAGE',
        stateMutationApplied: false
      });
      if (failed?.failureReportPath === undefined) throw new Error('missing failure report path');
      await expect(new FileStore().readJson(new ProjectPaths(tempRoot, 'codex-failure').projectArtifact(failed.failureReportPath), CodexRuntimeFailureReportSchema)).resolves.toMatchObject({
        errorType: 'CODEX_NO_FINAL_MESSAGE',
        storyStateMutated: false,
        redacted: true
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  });
});
