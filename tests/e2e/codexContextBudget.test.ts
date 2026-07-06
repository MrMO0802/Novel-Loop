import { describe, expect, test } from 'vitest';

import { writeCodexContextManifest } from '../../src/app/codexMinimalContext.js';
import { initProject } from '../../src/app/initProject.js';
import { CodexContextManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { briefPath, createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';

describe('M27 codex context budget', () => {
  test('keeps included context under the requested byte budget and records exclusions', async () => {
    const tempRoot = await createTempRoot('novel-loop-m27-context-');
    try {
      const store = new FileStore();
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      await store.writeText(paths.projectArtifact('strategy/large_context.md'), 'x'.repeat(2_000));
      await store.writeText(paths.projectArtifact('strategy/small_context.md'), 'compact clue');

      const result = await writeCodexContextManifest(paths, store, {
        task: 'chapter-mission',
        requestedMode: 'compact',
        budgetBytes: 400,
        maxArtifacts: 2,
        includedArtifacts: [
          { path: 'strategy/large_context.md', reason: 'oversized old context' },
          { path: 'strategy/small_context.md', reason: 'high-priority current context' },
          { path: 'brief.md', reason: 'project brief fallback' }
        ]
      });

      expect(result.manifest.actualBytes).toBeLessThanOrEqual(400);
      expect(result.manifest.truncationApplied).toBe(true);
      expect(result.manifest.requestedMode).toBe('compact');
      expect(result.manifest.excludedArtifacts.some((artifact) => artifact.reason.includes('budget'))).toBe(true);
      await expect(store.readJson(paths.projectArtifact(result.relativePath), CodexContextManifestSchema)).resolves.toMatchObject({
        budgetBytes: 400
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  });
});
