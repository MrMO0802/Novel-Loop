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

  test('accepts legacy flat quality reports by deriving nested sections', () => {
    const parsed = CodexChapterQualityReportSchema.parse({
      reportId: 'codex_quality_ch001_v1',
      projectId: 'codex-bench',
      chapterNumber: 1,
      provider: 'codex-text',
      generatedAt: '2026-07-04T08:38:39.767Z',
      finalChapterPath: 'chapters/chapter_001/final.md',
      canonPatchPath: 'chapters/chapter_001/canon_patch_codex_normalized_v1.json',
      diagnosticsPath: 'chapters/chapter_001/diagnostics_v1.json',
      hasTitle: true,
      approximateWordCount: 140,
      sceneCount: 2,
      hasOpeningHook: true,
      hasEndingHook: false,
      protagonistPresent: true,
      conflictPresent: false,
      informationDeltaPresent: true,
      styleGuideFollowed: true,
      repeatedParagraphRisk: false,
      unresolvedPlaceholders: [],
      forbiddenPhrases: [],
      jsonArtifactsConsistent: true,
      canonPatchMatchesFinal: true,
      diagnosticsHardChecksPassed: true,
      readerQuestionGenerated: true,
      nextChapterHook: false,
      softScores: {
        readability: 8,
        narrativeMomentum: 4,
        characterConsistency: 8,
        tension: 4,
        genreFit: 4,
        proseQuality: 8,
        chapterHook: 4
      },
      criticalIssues: [],
      warnings: [],
      normalizationWarnings: [],
      blocking: false,
      storyStateMutated: false
    });

    expect(parsed.structure).toMatchObject({
      hasTitle: true,
      sceneCount: 2,
      hasOpeningHook: true,
      hasInformationDelta: true
    });
    expect(parsed.style.placeholderRisk).toBe(false);
    expect(parsed.patchConsistency.canonPatchMatchesFinal).toBe(true);
  });
});
