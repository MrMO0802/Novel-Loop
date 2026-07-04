import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { ArchiveManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';
import { prepareStaleChapter3Project, regenerateStaleChapter3 } from './m18Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m18-archive-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('full archive', () => {
  test('copies core stale artifacts before regeneration and records verifiable hashes', async () => {
    const paths = await prepareStaleChapter3Project(tempRoot);
    const result = await regenerateStaleChapter3(tempRoot, 'reference_only');
    const store = new FileStore();

    expect(result.archiveManifestPath).toMatch(/^chapters\/chapter_003\/archive\/history_edit_/);
    const manifest = await store.readJson(paths.projectArtifact(result.archiveManifestPath!), ArchiveManifestSchema);
    expect(manifest.archiveId).toContain('chapter_003');
    expect(manifest.invalidatedByChapter).toBe(2);
    expect(manifest.oldStatus).toBe('stale_due_to_history_edit');
    expect(manifest.newRegenerationRunId).toBe('run_m18_regenerate_stale_ch3');
    expect(manifest.copiedArtifacts.map((artifact) => artifact.artifactType)).toEqual(
      expect.arrayContaining(['final', 'canon_patch', 'commit_report', 'diagnostics', 'selected_plan', 'scene_cards', 'scene_draft'])
    );

    const archivedFinal = manifest.copiedArtifacts.find((artifact) => artifact.artifactType === 'final');
    expect(archivedFinal).toBeDefined();
    const archivedFinalPath = paths.projectArtifact(archivedFinal!.archivedPath);
    const archivedFinalBytes = await readFile(archivedFinalPath);
    expect(createHash('sha256').update(archivedFinalBytes).digest('hex')).toBe(archivedFinal!.sha256);
    expect(archivedFinal!.sizeBytes).toBe(archivedFinalBytes.byteLength);

    const audit = await auditProject({ projectId, projectsRoot: tempRoot }, store);
    expect(audit.report.summary.bySeverity.error).toBe(0);
    expect(audit.report.summary.bySeverity.critical).toBe(0);
  }, 15000);

  test('audit reports an archive hash mismatch when an archived file is corrupted', async () => {
    const paths = await prepareStaleChapter3Project(tempRoot);
    const result = await regenerateStaleChapter3(tempRoot, 'reference_only');
    const store = new FileStore();
    const manifest = await store.readJson(paths.projectArtifact(result.archiveManifestPath!), ArchiveManifestSchema);
    const archivedFinal = manifest.copiedArtifacts.find((artifact) => artifact.artifactType === 'final');
    expect(archivedFinal).toBeDefined();

    await writeFile(paths.projectArtifact(archivedFinal!.archivedPath), 'corrupted archive\n', 'utf8');

    const audit = await auditProject({ projectId, projectsRoot: tempRoot }, store);
    expect(audit.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'archive',
          severity: 'error',
          path: archivedFinal!.archivedPath
        })
      ])
    );
  }, 15000);
});
