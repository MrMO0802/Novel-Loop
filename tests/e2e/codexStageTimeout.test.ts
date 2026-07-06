import { describe, expect, test } from 'vitest';

import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M26.5 codex benchmark stage timeout', () => {
  test('classifies timeout, writes failure metadata, and does not mutate Story State', async () => {
    const tempRoot = await createTempRoot('novel-loop-m265-timeout-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'slow-timeout');
      const store = new FileStore();

      const result = await runCodexRuntimeBenchmark(
        {
          projectId: 'codex-timeout',
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'bible',
          codexProfile: 'clean',
          codexStageTimeoutMs: 20,
          codexTimeoutMs: 20
        },
        store
      );

      expect(result.report.success).toBe(false);
      expect(result.report.failedLevel).toBe('bible');
      expect(result.report.stages.at(-1)).toMatchObject({
        level: 'bible',
        stageName: 'build-bible',
        status: 'failed',
        timeoutCount: 1,
        stateMutationApplied: false,
        errorCode: 'CODEX_TIMEOUT'
      });
      expect(result.report.failureReportPath).toMatch(/^audit\/codex_runtime_failure_report_v\d+\.json$/);

      const state = await store.readJson(new ProjectPaths(tempRoot, 'codex-timeout').storyState(), StoryStateSchema);
      expect(state.latestCommittedChapter).toBe(0);
    } finally {
      await removeTempRoot(tempRoot);
    }
  });
});
