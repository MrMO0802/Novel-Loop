import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { readRunDetail } from '../../src/app/runBrowser.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareCommittedChapterOne } from './m19Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m19-browser-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('run browser v2', () => {
  test('run detail exposes events artifacts state and redaction policy for v2 manifests', async () => {
    await prepareCommittedChapterOne(tempRoot);

    const detail = await readRunDetail({ projectId: 'demo-novel', projectsRoot: tempRoot, runId: 'run_m19_ch1_revision' });

    expect(detail.schemaVersion).toBe('2');
    expect(detail.mode).toBe('commit');
    expect(detail.events.length).toBeGreaterThan(0);
    expect(detail.events.map((event) => event.eventType)).toContain('RUN_COMPLETED');
    expect(detail.artifactLineageSummary.generated).toBeGreaterThan(0);
    expect(detail.queueTransitions.length).toBeGreaterThan(0);
    expect(detail.stateMutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mutationType: 'apply_canon_patch',
          applied: true
        })
      ])
    );
    expect(detail.redactionPolicy).toMatchObject({ redactSecrets: true });
  });
});
