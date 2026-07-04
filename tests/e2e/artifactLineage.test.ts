import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { refreshArtifactIndex } from '../../src/app/artifactIndex.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';
import { preparePlannedProject, getArray, prepareCommittedChapterOne, readRunManifest } from './m19Helpers.js';
import { prepareStaleChapter3Project, regenerateStaleChapter3 } from './m18Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m19-lineage-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('artifact lineage', () => {
  test('generated artifacts record sha256 size schema validation and index absorbs lineage runId', async () => {
    const paths = await prepareCommittedChapterOne(tempRoot);
    const manifest = await readRunManifest(paths, 'run_m19_ch1_revision');

    const finalArtifact = getArray(manifest, 'artifacts').find((artifact) => artifact.path === 'chapters/chapter_001/final.md');
    expect(finalArtifact).toMatchObject({
      artifactType: 'final',
      action: 'generated',
      runId: 'run_m19_ch1_revision',
      status: 'active'
    });
    expect(finalArtifact?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(finalArtifact?.sizeBytes).toBeGreaterThan(0);

    const diagnosticsArtifact = getArray(manifest, 'artifacts').find((artifact) => artifact.path === 'chapters/chapter_001/diagnostics_v1.json');
    expect(diagnosticsArtifact).toMatchObject({
      schemaName: 'DiagnosticsReportSchema',
      schemaValid: true
    });

    const index = await refreshArtifactIndex({ projectId, projectsRoot: tempRoot }, new FileStore());
    const indexedFinal = index.index.artifacts.find((artifact) => artifact.path === 'chapters/chapter_001/final.md');
    expect(indexedFinal?.runId).toBe('run_m19_ch1_revision');
    expect(indexedFinal?.provenance).toContain('run_m19_ch1_revision');
  });

  test('reused artifacts record lineage source and reason', async () => {
    const paths = await preparePlannedProject(tempRoot);
    const store = new FileStore();
    await runChapterDryRun({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      runId: 'run_m19_dry_first'
    }, store);
    await runChapterDryRun({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      runId: 'run_m19_dry_second'
    }, store);

    const reusedManifest = await readRunManifest(paths, 'run_m19_dry_second');
    expect(getArray(reusedManifest, 'artifacts')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'chapters/chapter_001/mission.json',
          action: 'reused',
          sourcePaths: ['chapters/chapter_001/mission.json'],
          provenanceNote: expect.stringContaining('reused')
        })
      ])
    );

  });

  test('archived artifacts record archive manifest path', async () => {
    const stalePaths = await prepareStaleChapter3Project(tempRoot);
    await regenerateStaleChapter3(tempRoot, 'reference_only');
    const regenerateManifest = await readRunManifest(stalePaths, 'run_m18_regenerate_stale_ch3');
    const archivedArtifacts = getArray(regenerateManifest, 'artifacts').filter((artifact) => artifact.action === 'archived');
    expect(archivedArtifacts.length).toBeGreaterThan(0);
    expect(archivedArtifacts[0]).toEqual(
      expect.objectContaining({
        archivedTo: expect.stringContaining('/archive/'),
        status: 'archived',
        provenanceNote: expect.stringContaining('stale')
      })
    );
    expect(getArray(regenerateManifest, 'archives')[0]).toEqual(
      expect.objectContaining({
        archiveManifestPath: expect.stringContaining('manifest.json')
      })
    );
  }, 15000);
});
