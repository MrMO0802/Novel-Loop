import { describe, expect, test } from 'vitest';

import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { BuildBibleCacheReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.5.5 optimization benchmark cache', () => {
  test('warm cache benchmark records cacheHit=true and avoids Codex build-bible calls', async () => {
    const tempRoot = await createTempRoot('novel-loop-m2755-cache-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const projectId = 'codex-bench-m275-cache';
      const result = await runCodexRuntimeBenchmark(
        {
          projectId,
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'bible',
          codexProfile: 'clean',
          useCache: true,
          warmCache: true
        },
        store
      );

      const warmStage = result.report.stages.find((stage) => stage.stageName === 'build-bible-cache-hit');
      expect(warmStage).toMatchObject({
        status: 'success',
        codexCallCount: 0,
        stateMutationApplied: false
      });
      const paths = new ProjectPaths(tempRoot, projectId);
      const cacheReport = await store.readJson(paths.projectArtifact('strategy/build_bible_cache_report_v2.json'), BuildBibleCacheReportSchema);
      expect(cacheReport.cacheHit).toBe(true);
      const manifest = await store.readJson(paths.runManifest(warmStage!.runId!), RunManifestV2Schema);
      expect(manifest.promptCalls).toHaveLength(0);
      expect(manifest.artifacts.filter((artifact) => artifact.action === 'reused').map((artifact) => artifact.path)).toEqual(
        expect.arrayContaining(['strategy/story_bible.md', 'strategy/style_guide.md'])
      );
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});
