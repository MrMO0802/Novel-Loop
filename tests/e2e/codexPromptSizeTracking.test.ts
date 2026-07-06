import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { RunManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M26.5 codex prompt size tracking', () => {
  test('records prompt, schema, output, and raw JSONL byte counts on parent run prompt calls', async () => {
    const tempRoot = await createTempRoot('novel-loop-m265-size-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      await initProject({ projectId: 'codex-size', projectsRoot: tempRoot, briefPath }, store);
      await buildBible(
        {
          projectId: 'codex-size',
          projectsRoot: tempRoot,
          provider: 'codex-text',
          promptRoot,
          codexBin: fake.codexBin,
          codexProfile: 'clean',
          runId: 'run_m265_size'
        },
        store
      );

      const manifest = await store.readJson(new ProjectPaths(tempRoot, 'codex-size').runManifest('run_m265_size'), RunManifestSchema);
      if (!('schemaVersion' in manifest) || manifest.schemaVersion !== '2') throw new Error('expected run manifest v2');
      expect(manifest.promptCalls.length).toBeGreaterThan(0);
      expect(manifest.promptCalls.every((call) => (call.promptInputBytes ?? 0) > 0)).toBe(true);
      expect(manifest.promptCalls.every((call) => (call.outputBytes ?? 0) > 0)).toBe(true);
      expect(manifest.promptCalls.every((call) => (call.rawJsonlBytes ?? 0) > 0)).toBe(true);
    } finally {
      await removeTempRoot(tempRoot);
    }
  });
});
