import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { getArray, getRecord, prepareCommittedChapterOne, readRunManifest } from './m19Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m19-audit-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('provenance audit', () => {
  test('strict audit detects artifact lineage hash mismatch', async () => {
    const paths = await prepareCommittedChapterOne(tempRoot);
    const store = new FileStore();
    const manifest = await readRunManifest(paths, 'run_m19_ch1_revision');
    const artifacts = getArray(manifest, 'artifacts');
    const finalArtifact = artifacts.find((artifact) => artifact.path === 'chapters/chapter_001/final.md')!;
    finalArtifact.sha256 = '0'.repeat(64);
    await store.writeText(paths.runManifest('run_m19_ch1_revision'), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await auditProject({ projectId: paths.projectId, projectsRoot: tempRoot, strict: true }, store);

    expect(result.exitCode).toBe(2);
    expect(result.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'artifact_lineage',
          path: 'chapters/chapter_001/final.md',
          blocking: true
        })
      ])
    );
  });

  test('strict audit detects manifest summary and events mismatch', async () => {
    const paths = await prepareCommittedChapterOne(tempRoot);
    const store = new FileStore();
    const manifest = await readRunManifest(paths, 'run_m19_ch1_revision');
    const summary = getRecord(manifest, 'summary');
    summary.generatedArtifactCount = 999;
    await store.writeText(paths.runManifest('run_m19_ch1_revision'), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await auditProject({ projectId: paths.projectId, projectsRoot: tempRoot, strict: true }, store);

    expect(result.exitCode).toBe(2);
    expect(result.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'event_log',
          blocking: true
        })
      ])
    );
  });
});
