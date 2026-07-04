import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { listSnapshotsForProject, readSnapshotDetail, verifySnapshots } from '../../src/app/snapshotBrowser.js';
import { SnapshotAuditReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, prepareCommittedThreeChapterProject, projectId, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m18-snapshots-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('snapshot browser', () => {
  test('lists snapshots, reads detail, and verifies snapshot audit report', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();

    const snapshots = await listSnapshotsForProject({ projectId, projectsRoot: tempRoot, kind: 'after' }, store);
    expect(snapshots.snapshotCount).toBeGreaterThan(0);
    expect(snapshots.snapshots.every((snapshot) => snapshot.kind === 'after')).toBe(true);

    const detail = await readSnapshotDetail({ projectId, projectsRoot: tempRoot, snapshotId: snapshots.snapshots[0]!.snapshotId }, store);
    expect(detail.schemaValid).toBe(true);
    expect(detail.latestCommittedChapter).toBeGreaterThanOrEqual(1);
    expect(detail.sha256).toMatch(/^[a-f0-9]{64}$/);

    const audit = await verifySnapshots({ projectId, projectsRoot: tempRoot }, store);
    expect(audit.ok).toBe(true);
    await expect(store.readJson(paths.projectArtifact(audit.reportPath), SnapshotAuditReportSchema)).resolves.toMatchObject({
      projectId,
      ok: true
    });
  });

  test('verify-snapshots reports missing required historical base snapshot', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const snapshots = await listSnapshotsForProject({ projectId, projectsRoot: tempRoot, kind: 'after', chapterNumber: 1 }, store);
    await rm(snapshots.snapshots[0]!.path, { force: true });

    const audit = await verifySnapshots({ projectId, projectsRoot: tempRoot }, store);
    expect(audit.ok).toBe(false);
    expect(audit.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'snapshot',
          severity: 'error',
          message: expect.stringContaining('after_chapter_001_commit')
        })
      ])
    );
    expect(await store.exists(paths.projectArtifact(audit.markdownPath))).toBe(true);
  });
});
