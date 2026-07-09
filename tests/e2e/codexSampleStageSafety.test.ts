import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runCodexRuntimeStageSampling } from '../../src/app/codexRuntimeSampling.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.8B Codex sample-stage safety', () => {
  test('does not overwrite canonical chapter artifacts or Story State', async () => {
    const tempRoot = await createTempRoot('novel-loop-m278b-sample-safety-');
    try {
      const store = new FileStore();
      const projectId = 'codex-sample-safety';
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build` }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan` }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      const canonicalFinalPath = paths.chapterArtifact(2, 'final.md');
      const canonicalPatchPath = paths.chapterArtifact(2, 'canon_patch.json');
      await store.ensureDir(paths.chapterDir(2));
      await store.writeText(canonicalFinalPath, 'DO NOT OVERWRITE FINAL\n');
      await store.writeText(canonicalPatchPath, 'DO NOT OVERWRITE PATCH\n');
      const storyStateBefore = await store.readText(paths.storyState());

      await runCodexRuntimeStageSampling(
        {
          projectId,
          projectsRoot: tempRoot,
          promptRoot,
          chapterNumber: 2,
          stage: 'canon_patch_proposal',
          samples: 2,
          codexBin: fake.codexBin,
          codexProfile: 'clean',
          codexJsonRetries: 2,
          codexJsonRepair: true
        },
        store
      );

      expect(await store.readText(paths.storyState())).toBe(storyStateBefore);
      expect(await store.readText(canonicalFinalPath)).toBe('DO NOT OVERWRITE FINAL\n');
      expect(await store.readText(canonicalPatchPath)).toBe('DO NOT OVERWRITE PATCH\n');
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 60_000);
});
