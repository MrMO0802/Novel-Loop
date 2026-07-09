import { describe, expect, test } from 'vitest';

import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.8B fresh timed benchmark', () => {
  test('fresh benchmark Codex exec runs include M27.8A timing events', async () => {
    const tempRoot = await createTempRoot('novel-loop-m278b-fresh-benchmark-');
    try {
      const store = new FileStore();
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const projectId = 'codex-bench-m278-test';

      const result = await runCodexRuntimeBenchmark(
        {
          projectId,
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

      expect(result.report.success).toBe(true);
      const paths = new ProjectPaths(tempRoot, projectId);
      const eventLogs = await Promise.all(
        (await store.list(paths.runsDir()))
          .filter((runId) => runId.includes('exec_json') || runId.includes('smoke'))
          .map((runId) => store.readText(paths.runEvents(runId)))
      );
      expect(eventLogs.join('\n')).toContain('CODEX_PROCESS_SPAWN_STARTED');
      expect(eventLogs.join('\n')).toContain('CODEX_FIRST_JSONL_EVENT');
      expect(eventLogs.join('\n')).toContain('CODEX_PROCESS_EXITED');
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});
