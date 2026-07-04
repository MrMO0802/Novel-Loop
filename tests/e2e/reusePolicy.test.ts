import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { ReusePolicyReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';
import { prepareStaleChapter3Project } from './m18Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m18-reuse-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('stale regeneration reuse policy', () => {
  test('defaults stale regeneration to reference_only and never silently reuses old final text', async () => {
    const paths = await prepareStaleChapter3Project(tempRoot);
    const store = new FileStore();

    const result = await runChapterFullProduction(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 3,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        candidates: 3,
        maxRevisions: 2,
        commit: true,
        regenerateStale: true,
        runId: 'run_m18_reuse_default'
      },
      store
    );

    expect(result.reusePolicyRequested).toBe('reference_only');
    expect(result.reusePolicyEffective).toBe('reference_only');
    expect(result.reusePolicyReportPath).toBe('chapters/chapter_003/reuse_policy_report_v1.json');
    const report = await store.readJson(paths.chapterArtifact(3, 'reuse_policy_report_v1.json'), ReusePolicyReportSchema);
    expect(report.oldArtifactsReferenced).toEqual(expect.arrayContaining(['chapters/chapter_003/final.md']));
    expect(report.validityChecks.some((check) => check.checkId === 'old_final_direct_reuse' && !check.passed)).toBe(true);
  });

  test('downgrades preserve_scene_structure_if_valid to reference_only when scene structure check fails', async () => {
    const paths = await prepareStaleChapter3Project(tempRoot);
    const store = new FileStore();

    const result = await runChapterFullProduction(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 3,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        candidates: 3,
        maxRevisions: 2,
        commit: true,
        regenerateStale: true,
        reusePolicy: 'preserve_scene_structure_if_valid',
        runId: 'run_m18_reuse_downgrade'
      },
      store
    );

    expect(result.reusePolicyRequested).toBe('preserve_scene_structure_if_valid');
    expect(result.reusePolicyEffective).toBe('reference_only');
    const report = await store.readJson(paths.chapterArtifact(3, 'reuse_policy_report_v1.json'), ReusePolicyReportSchema);
    expect(report.downgradeReason).toContain('scene_structure_validity_check');
  }, 15000);

  test('preserve_nothing does not reference old final text', async () => {
    const paths = await prepareStaleChapter3Project(tempRoot);
    const store = new FileStore();

    const result = await runChapterFullProduction(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 3,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        candidates: 3,
        maxRevisions: 2,
        commit: true,
        regenerateStale: true,
        reusePolicy: 'preserve_nothing',
        runId: 'run_m18_reuse_none'
      },
      store
    );

    expect(result.reusePolicyEffective).toBe('preserve_nothing');
    const report = await store.readJson(paths.chapterArtifact(3, 'reuse_policy_report_v1.json'), ReusePolicyReportSchema);
    expect(report.oldArtifactsReferenced).not.toContain('chapters/chapter_003/final.md');
  });
});
