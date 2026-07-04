import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { listRuns, readRunDetail } from '../../src/app/runBrowser.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, prepareCommittedThreeChapterProject, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m18-runs-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('run browser', () => {
  test('lists successful and failed runs and shows one run detail', async () => {
    await prepareCommittedThreeChapterProject(tempRoot);
    await expect(
      runChapterFullProduction(
        {
          projectId,
          projectsRoot: tempRoot,
          chapterNumber: 4,
          provider: 'mock',
          promptRoot,
          fixturesRoot,
          candidates: 3,
          maxRevisions: 2,
          commit: true,
          failAt: 'diagnostics',
          runId: 'run_m18_failed_revision'
        },
        new FileStore()
      )
    ).rejects.toMatchObject({ code: 'INJECTED_FAILURE' });

    const allRuns = await listRuns({ projectId, projectsRoot: tempRoot, limit: 20 });
    expect(allRuns.runCount).toBeGreaterThan(0);
    expect(allRuns.failedRunCount).toBeGreaterThan(0);
    expect(allRuns.output).toContain('suggestedFailedRunCommand');

    const failedRuns = await listRuns({ projectId, projectsRoot: tempRoot, status: 'failed' });
    expect(failedRuns.runs.every((run) => run.status === 'failed')).toBe(true);

    const detail = await readRunDetail({ projectId, projectsRoot: tempRoot, runId: 'run_m18_failed_revision' });
    expect(detail.run.runId).toBe('run_m18_failed_revision');
    expect(detail.run.status).toBe('failed');
    expect(detail.errors.length).toBeGreaterThan(0);
    expect(detail.redaction.promptArtifactsMayContainSensitiveText).toBe(true);
  });
});
