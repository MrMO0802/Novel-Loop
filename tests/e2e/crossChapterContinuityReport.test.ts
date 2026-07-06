import { describe, expect, test } from 'vitest';

import { evaluateCodexCrossChapterContinuity } from '../../src/app/codexCrossChapterContinuity.js';
import { CodexCrossChapterContinuityReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, prepareCommittedThreeChapterProject, projectId, removeTempRoot } from './m16Helpers.js';

describe('M27 codex cross-chapter continuity v2', () => {
  test('links adjacent chapters and reports deterministic continuity warnings', async () => {
    const tempRoot = await createTempRoot('novel-loop-m27-continuity-');
    try {
      const store = new FileStore();
      const paths = await prepareCommittedThreeChapterProject(tempRoot);

      const result = await evaluateCodexCrossChapterContinuity({ projectId, projectsRoot: tempRoot, chapters: [1, 2, 3] }, store);

      expect(result.report.continuityScore).toBeGreaterThanOrEqual(0);
      expect(result.report.chapterLinks.map((link) => [link.fromChapter, link.toChapter])).toContainEqual([1, 2]);
      expect(result.report.chapterLinks.map((link) => [link.fromChapter, link.toChapter])).toContainEqual([2, 3]);
      expect(result.report.recommendations.length).toBeGreaterThan(0);
      await expect(store.readJson(paths.auditArtifact('codex_cross_chapter_continuity_report_v1.json'), CodexCrossChapterContinuityReportSchema)).resolves.toMatchObject({
        projectId
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});
