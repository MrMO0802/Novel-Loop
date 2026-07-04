import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { createStressFixture } from '../../src/app/stressFixture.js';
import { refreshArtifactIndex } from '../../src/app/artifactIndex.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m20-perf-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M20 release hardening performance', () => {
  test('rebuilds artifact index and audits a 40 chapter stress fixture with performance metadata', async () => {
    const store = new FileStore();
    await createStressFixture({ projectId, projectsRoot: tempRoot, chapters: 40, runsPerChapter: 2 }, store);

    const index = await refreshArtifactIndex({ projectId, projectsRoot: tempRoot }, store);
    expect(index.index.performance.fileCount).toBeGreaterThan(300);
    expect(index.index.performance.runManifestCount).toBe(80);
    expect(index.index.performance.durationMs).toBeGreaterThanOrEqual(0);

    const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.exitCode).toBe(0);
    expect(audit.report.performance.artifactCount).toBe(index.index.artifacts.length);
    expect(audit.report.performance.runManifestCount).toBe(80);
    expect(audit.report.performance.durationMs).toBeGreaterThanOrEqual(0);
    expect(audit.report.summary.totalIssues).toBe(0);
  }, 30000);
});
