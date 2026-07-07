import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { BuildBibleCacheReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.5 build-bible artifact cache', () => {
  test('reuses strategy artifacts for the same brief without calling Codex again', async () => {
    const tempRoot = await createTempRoot('novel-loop-m275-bible-cache-hit-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const projectId = 'codex-bible-cache-hit';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      const paths = new ProjectPaths(tempRoot, projectId);

      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean', useCache: true, runId: 'run_cache_first' }, store);
      const second = await buildBible({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean', useCache: true, runId: 'run_cache_second' }, store);

      expect(second.artifacts).toEqual(
        expect.arrayContaining([
          'strategy/story_bible.md',
          'strategy/genre_contract.md',
          'strategy/reader_promise.md',
          'strategy/style_guide.md',
          'strategy/build_bible_cache_report_v2.json'
        ])
      );
      const report = await store.readJson(paths.strategyDir() + '/build_bible_cache_report_v2.json', BuildBibleCacheReportSchema);
      expect(report).toMatchObject({
        projectId,
        cacheHit: true,
        reusedArtifacts: [
          'strategy/story_bible.md',
          'strategy/genre_contract.md',
          'strategy/reader_promise.md',
          'strategy/style_guide.md'
        ],
        regeneratedArtifacts: []
      });
      const manifest = await store.readJson(paths.runManifest(second.runId), RunManifestV2Schema);
      expect(manifest.promptCalls).toHaveLength(0);
      expect(manifest.artifacts.filter((artifact) => artifact.action === 'reused').map((artifact) => artifact.path)).toEqual(
        expect.arrayContaining(['strategy/story_bible.md', 'strategy/genre_contract.md'])
      );
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);

  test('changed brief misses cache and force regenerate bypasses cache', async () => {
    const tempRoot = await createTempRoot('novel-loop-m275-bible-cache-miss-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const projectId = 'codex-bible-cache-miss';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      const paths = new ProjectPaths(tempRoot, projectId);

      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean', useCache: true, runId: 'run_cache_miss_first' }, store);
      await store.writeText(paths.brief(), `${await store.readText(paths.brief())}\n\nAdditional changed brief line.\n`);
      const second = await buildBible({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean', useCache: true, forceRegenerate: true, runId: 'run_cache_miss_second' }, store);

      const report = await store.readJson(paths.strategyDir() + '/build_bible_cache_report_v2.json', BuildBibleCacheReportSchema);
      expect(report.cacheHit).toBe(false);
      expect(report.reason).toContain('forceRegenerate');
      expect(report.regeneratedArtifacts).toEqual(expect.arrayContaining(['strategy/story_bible.md']));
      const manifest = await store.readJson(paths.runManifest(second.runId), RunManifestV2Schema);
      expect(manifest.promptCalls.map((call) => call.promptId)).toEqual(
        expect.arrayContaining(['strategy.build_story_bible', 'strategy.build_style_guide'])
      );
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});
