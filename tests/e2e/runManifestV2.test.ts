import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { getArray, getRecord, prepareCommittedChapterOne, readRunManifest } from './m19Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m19-manifest-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('run manifest v2', () => {
  test('regular chapter commit writes schemaVersion 2 with resolved context and summary', async () => {
    const paths = await prepareCommittedChapterOne(tempRoot);

    const manifest = await readRunManifest(paths, 'run_m19_ch1_revision');

    expect(manifest.schemaVersion).toBe('2');
    expect(manifest.runId).toBe('run_m19_ch1_revision');
    expect(manifest.status).toBe('success');
    expect(manifest.argv).toEqual(expect.arrayContaining(['chapter']));
    expect(typeof manifest.cwd).toBe('string');
    expect(typeof manifest.packageVersion).toBe('string');
    expect(typeof manifest.nodeVersion).toBe('string');

    const context = getRecord(manifest, 'resolvedContext');
    expect(context).toMatchObject({
      projectId: paths.projectId,
      chapterNumber: 1,
      requestedChapter: 1,
      resolvedChapterNumber: 1,
      mode: 'commit',
      latestCommittedChapterBefore: 0,
      latestCommittedChapterAfter: 1,
      queueStatusBefore: 'draft_ready',
      queueStatusAfter: 'committed'
    });

    const summary = getRecord(manifest, 'summary');
    expect(summary.generatedArtifactCount).toBeGreaterThan(0);
    expect(summary.promptCallCount).toBeGreaterThan(0);
    expect(summary.queueTransitionCount).toBeGreaterThan(0);
    expect(summary.stateMutationCount).toBe(1);
    expect(summary.snapshotCount).toBe(2);

    expect(getArray(manifest, 'stages').map((stage) => stage.name)).toEqual(expect.arrayContaining(['diagnostics', 'revision', 'final', 'commit']));
    expect(getArray(manifest, 'artifacts').some((artifact) => artifact.path === 'chapters/chapter_001/final.md')).toBe(true);
    expect(getArray(manifest, 'promptCalls').some((call) => call.promptId === 'memory.extract_canon_patch')).toBe(true);
    expect(getArray(manifest, 'stateMutations')).toHaveLength(1);
    expect(getArray(manifest, 'snapshots')).toHaveLength(2);
  });
});
