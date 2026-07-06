import { describe, expect, test } from 'vitest';

import { evaluateCodexChapterQuality } from '../../src/app/codexChapterQuality.js';
import { CodexChapterQualityReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, prepareCommittedThreeChapterProject, projectId, removeTempRoot } from './m16Helpers.js';

describe('M27 codex chapter quality report v2', () => {
  test('writes nested deterministic structure, continuity, style, and patch consistency checks', async () => {
    const tempRoot = await createTempRoot('novel-loop-m27-quality-');
    try {
      const store = new FileStore();
      const paths = await prepareCommittedThreeChapterProject(tempRoot);

      const result = await evaluateCodexChapterQuality({ projectId, projectsRoot: tempRoot, chapterNumber: 2 }, store);

      expect(result.report.structure.hasTitle).toBe(true);
      expect(result.report.continuity.referencesPreviousChapter).toBe(true);
      expect(result.report.style.placeholderRisk).toBe(false);
      expect(result.report.patchConsistency.canonPatchMatchesFinal).toBe(true);
      expect(result.report.softScores.continuityStrength).toBeGreaterThanOrEqual(0);
      await expect(store.readJson(paths.projectArtifact(result.reportPath), CodexChapterQualityReportSchema)).resolves.toMatchObject({
        chapterNumber: 2
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});
