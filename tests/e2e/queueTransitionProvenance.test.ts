import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { getArray, prepareCommittedChapterOne, readRunManifest } from './m19Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m19-queue-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('queue transition provenance', () => {
  test('chapter commit run records before and after queue states in manifest', async () => {
    const paths = await prepareCommittedChapterOne(tempRoot);
    const manifest = await readRunManifest(paths, 'run_m19_ch1_revision');
    const transitions = getArray(manifest, 'queueTransitions');

    expect(transitions.length).toBeGreaterThan(0);
    expect(transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chapterNumber: 1,
          beforeStatus: 'draft_ready',
          afterStatus: 'diagnosing',
          beforeStage: 'draft_assembly',
          afterStage: 'diagnostics',
          runId: 'run_m19_ch1_revision',
          reason: expect.stringContaining('diagnostics')
        }),
        expect.objectContaining({
          chapterNumber: 1,
          afterStatus: 'committed',
          afterStage: 'commit',
          relatedArtifactPath: 'chapters/chapter_001/commit_report.json'
        })
      ])
    );

    const eventTransitions = getArray(manifest, 'queueTransitions').map((transition) => transition.afterStatus);
    expect(eventTransitions.at(-1)).toBe('committed');
  });
});
