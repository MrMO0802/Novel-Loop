import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { listArtifacts, refreshArtifactIndex } from '../../src/app/artifactIndex.js';
import { ArtifactIndexSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';
import { prepareStaleChapter3Project, regenerateStaleChapter3 } from './m18Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m18-artifacts-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('artifact index', () => {
  test('refreshes artifact_index and filters active and archived chapter artifacts', async () => {
    const paths = await prepareStaleChapter3Project(tempRoot);
    await regenerateStaleChapter3(tempRoot, 'reference_only');
    const store = new FileStore();

    const refreshed = await refreshArtifactIndex({ projectId, projectsRoot: tempRoot }, store);
    expect(refreshed.indexPath).toBe('artifacts/artifact_index.json');
    const index = await store.readJson(paths.projectArtifact(refreshed.indexPath), ArtifactIndexSchema);
    expect(index.artifacts.some((artifact) => artifact.artifactType === 'final' && artifact.chapterNumber === 3 && artifact.status === 'active')).toBe(true);
    expect(index.artifacts.some((artifact) => artifact.artifactType === 'archive_manifest' && artifact.chapterNumber === 3 && artifact.status === 'archived')).toBe(true);

    const chapter3 = await listArtifacts({ projectId, projectsRoot: tempRoot, chapterNumber: 3 }, store);
    expect(chapter3.artifacts.every((artifact) => artifact.chapterNumber === 3 || artifact.chapterNumber === undefined)).toBe(true);
    expect(chapter3.output).toContain('artifactCount');

    const archived = await listArtifacts({ projectId, projectsRoot: tempRoot, status: 'archived' }, store);
    expect(archived.artifacts.length).toBeGreaterThan(0);
    expect(archived.artifacts.every((artifact) => artifact.status === 'archived')).toBe(true);
  }, 15000);
});
