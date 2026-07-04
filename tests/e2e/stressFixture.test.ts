import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { createStressFixture } from '../../src/app/stressFixture.js';
import { refreshArtifactIndex } from '../../src/app/artifactIndex.js';
import { ChapterQueueSchema, RunManifestSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m20-stress-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M20 stress fixtures', () => {
  test('creates a deterministic 30 chapter project with run and snapshot provenance', async () => {
    const store = new FileStore();
    const result = await createStressFixture({ projectId, projectsRoot: tempRoot, chapters: 30, runsPerChapter: 2 }, store);

    expect(result.chapterCount).toBe(30);
    expect(result.runCount).toBe(60);
    expect(result.snapshotCount).toBe(60);

    const state = await store.readJson(result.paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(30);
    expect(state.canonFacts).toHaveLength(30);
    expect(state.timeline).toHaveLength(30);

    const queue = await store.readJson(result.paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters).toHaveLength(31);
    expect(queue.chapters.filter((chapter) => chapter.status === 'committed')).toHaveLength(30);
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 31)?.status).toBe('planned');

    await expect(store.exists(result.paths.chapterArtifact(30, 'final.md'))).resolves.toBe(true);
    await expect(store.exists(result.paths.chapterArtifact(30, 'canon_patch.json'))).resolves.toBe(true);
    await expect(store.exists(result.paths.chapterArtifact(30, 'commit_report.json'))).resolves.toBe(true);

    const manifest = await store.readJson(result.paths.runManifest('stress_ch030_commit'), RunManifestSchema);
    expect(manifest).toMatchObject({
      schemaVersion: '2',
      command: 'stress-fixture',
      status: 'success'
    });
    await expect(store.exists(result.paths.runEvents('stress_ch030_commit'))).resolves.toBe(true);

    const index = await refreshArtifactIndex({ projectId, projectsRoot: tempRoot }, store);
    expect(index.index.artifacts.length).toBeGreaterThan(250);
    expect(index.index.performance.fileCount).toBeGreaterThan(250);

    const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.exitCode).toBe(0);
    expect(audit.report.performance.durationMs).toBeGreaterThanOrEqual(0);
  }, 20000);
});
