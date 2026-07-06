import { describe, expect, test } from 'vitest';

import { generateChapterContextSummary } from '../../src/app/chapterContextSummary.js';
import { ChapterContextSummarySchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, prepareCommittedThreeChapterProject, projectId, removeTempRoot } from './m16Helpers.js';

describe('M27 chapter summary cache', () => {
  test('generates deterministic JSON and Markdown summaries from committed artifacts', async () => {
    const tempRoot = await createTempRoot('novel-loop-m27-summary-');
    try {
      const store = new FileStore();
      const paths = await prepareCommittedThreeChapterProject(tempRoot);

      const result = await generateChapterContextSummary({ projectId, projectsRoot: tempRoot, chapterNumber: 1 }, store);

      expect(result.summary.chapterNumber).toBe(1);
      expect(result.summary.shortSummary.length).toBeGreaterThan(0);
      expect(result.summary.canonFactIds.length).toBeGreaterThan(0);
      await expect(store.readJson(paths.chapterArtifact(1, 'chapter_summary_for_context.json'), ChapterContextSummarySchema)).resolves.toMatchObject({
        chapterNumber: 1
      });
      await expect(store.readText(paths.chapterArtifact(1, 'chapter_summary_for_context.md'))).resolves.toContain('# Chapter 1 Context Summary');
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});
