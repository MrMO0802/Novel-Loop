import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { CodexContextManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.5 write_scene context budget scaffold', () => {
  test('writes bounded context manifests for Codex scene generation without raw run dumps or state mutation', async () => {
    const tempRoot = await createTempRoot('novel-loop-m275-scene-context-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const projectId = 'codex-scene-context';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, runId: 'run_context_build' }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, runId: 'run_context_plan' }, store);
      await runChapterDryRun({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean', runId: 'run_context_dry' }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      await store.writeText(paths.projectArtifact('codex/runs/old/raw_output.jsonl'), 'raw dump should not enter context');
      const stateBefore = await store.readText(paths.storyState());

      await runChapterUntilDraft(
        {
          projectId,
          projectsRoot: tempRoot,
          chapterNumber: 1,
          provider: 'codex-text',
          promptRoot,
          codexBin: fake.codexBin,
          codexProfile: 'clean',
          codexContextMode: 'compact',
          codexContextBudgetBytes: 1_200,
          runId: 'run_context_draft'
        },
        store
      );

      const contextFiles = (await store.list(paths.projectArtifact('codex/context'))).filter((fileName) => fileName.endsWith('.json'));
      const manifests = await Promise.all(
        contextFiles.map((fileName) => store.readJson(paths.projectArtifact(`codex/context/${fileName}`), CodexContextManifestSchema))
      );
      const sceneManifests = manifests.filter((manifest) => manifest.task.startsWith('write-scene:chapter_001'));
      expect(sceneManifests).toHaveLength(2);
      for (const manifest of sceneManifests) {
        expect(manifest.actualBytes).toBeLessThanOrEqual(manifest.budgetBytes);
        expect(manifest.budgetBytes).toBe(1_200);
        expect(manifest.includedArtifacts.map((artifact) => artifact.path)).toEqual(
          expect.arrayContaining([
            'chapters/chapter_001/selected_plan.md',
            'chapters/chapter_001/scene_cards.json',
            'state/story_state.json'
          ])
        );
        expect([...manifest.includedArtifacts, ...manifest.excludedArtifacts].map((artifact) => artifact.path)).not.toContain('codex/runs/old/raw_output.jsonl');
        expect(manifest.excludedArtifacts.map((artifact) => artifact.path)).toContain('codex/runs/');
      }
      expect(await store.readText(paths.storyState())).toBe(stateBefore);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 40_000);
});
