import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { recommitChapter } from '../../src/app/recommitChapter.js';
import { ApprovalRecordSchema, RecommitReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, prepareCommittedThreeChapterProject, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m16-recommit-final-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('recommit from final.md', () => {
  test('without confirm generates preview artifacts and does not modify Story State', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const stateBefore = await store.readText(paths.storyState());

    const result = await recommitChapter(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 3,
        sourceType: 'final',
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        confirm: false
      },
      store
    );

    expect(result.previewOnly).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.generatedPatchPath).toBe('chapters/chapter_003/canon_patch_manual_v1.json');
    expect(result.stateDiffPath).toContain('diffs/state_diff_');
    await expect(store.exists(paths.chapterArtifact(3, 'manual_review_report_v1.json'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(3, 'recommit_report_v1.json'))).resolves.toBe(true);
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
  });

  test('with confirm safely recommits the latest chapter and records approval', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const stateBefore = await store.readJson(paths.storyState(), StoryStateSchema);

    const result = await recommitChapter(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 3,
        sourceType: 'final',
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        confirm: true
      },
      store
    );

    expect(result.previewOnly).toBe(false);
    expect(result.committed).toBe(true);
    expect(result.recommitReportPath).toBe('chapters/chapter_003/recommit_report_v1.json');
    expect(result.approvalRecordPath).toBe('chapters/chapter_003/approval_record_v1.json');
    expect(result.beforeSnapshotId).toMatch(/^snapshot_/);
    expect(result.afterSnapshotId).toMatch(/^snapshot_/);

    const report = await store.readJson(paths.chapterArtifact(3, 'recommit_report_v1.json'), RecommitReportSchema);
    expect(report).toMatchObject({ committed: true, confirmed: true, sourceType: 'final', historicalRecommit: false });
    const approval = await store.readJson(paths.chapterArtifact(3, 'approval_record_v1.json'), ApprovalRecordSchema);
    expect(approval).toMatchObject({ confirmed: true, action: 'recommit', operator: 'local_user' });
    const stateAfter = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(stateAfter.latestCommittedChapter).toBe(3);
    expect(stateAfter.canonFacts.length).toBeGreaterThan(stateBefore.canonFacts.length);
  });
});
