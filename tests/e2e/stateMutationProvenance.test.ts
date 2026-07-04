import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { recommitChapter } from '../../src/app/recommitChapter.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, prepareCommittedThreeChapterProject, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';
import { getArray, prepareCommittedChapterOne, readRunManifest } from './m19Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m19-state-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('state mutation provenance', () => {
  test('chapter commit records patch path snapshots hashes and applied=true', async () => {
    const paths = await prepareCommittedChapterOne(tempRoot);
    const manifest = await readRunManifest(paths, 'run_m19_ch1_revision');
    const mutations = getArray(manifest, 'stateMutations');

    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toEqual(
      expect.objectContaining({
        mutationType: 'apply_canon_patch',
        chapterNumber: 1,
        patchPath: 'chapters/chapter_001/canon_patch.json',
        latestCommittedChapterBefore: 0,
        latestCommittedChapterAfter: 1,
        conflictCheckPassed: true,
        schemaValidationPassed: true,
        applied: true
      })
    );
    expect(mutations[0]?.beforeSnapshotId).toMatch(/^snapshot_/);
    expect(mutations[0]?.afterSnapshotId).toMatch(/^snapshot_/);
    expect(mutations[0]?.beforeStateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mutations[0]?.afterStateHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('recommit preview records a run without applied state mutation while confirm records one', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const beforePreviewRuns = new Set(await store.list(paths.runsDir()));

    await recommitChapter(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 3,
        sourceType: 'final',
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        confirm: false
      }
    );
    const afterPreviewRuns = await store.list(paths.runsDir());
    const previewRunId = afterPreviewRuns.find((runId) => !beforePreviewRuns.has(runId));
    expect(previewRunId).toBeDefined();
    const previewManifest = await readRunManifest(paths, previewRunId!);
    expect(getArray(previewManifest, 'stateMutations').every((mutation) => mutation.applied !== true)).toBe(true);

    const beforeConfirmRuns = new Set(await store.list(paths.runsDir()));
    await recommitChapter(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 3,
        sourceType: 'final',
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        confirm: true
      }
    );
    const afterConfirmRuns = await store.list(paths.runsDir());
    const confirmRunId = afterConfirmRuns.find((runId) => !beforeConfirmRuns.has(runId));
    expect(confirmRunId).toBeDefined();
    const confirmManifest = await readRunManifest(paths, confirmRunId!);
    expect(getArray(confirmManifest, 'stateMutations')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mutationType: 'recommit_patch',
          applied: true
        })
      ])
    );
  });
});
