import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { recommitChapter } from '../../src/app/recommitChapter.js';
import { ConflictReportSchema, RecommitReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, prepareCommittedThreeChapterProject, projectId, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m16-recommit-patch-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('recommit from manual patch', () => {
  test('commits a schema-valid manual patch and versions artifacts', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const patchPath = path.resolve('fixtures/llm/memory.extract_canon_patch.manual-patch-valid.json');

    const first = await recommitChapter(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 4,
        sourceType: 'patch',
        patchPath,
        confirm: true
      },
      store
    );

    expect(first.committed).toBe(true);
    expect(first.generatedPatchPath).toBe('chapters/chapter_004/canon_patch_manual_v1.json');
    expect(first.recommitReportPath).toBe('chapters/chapter_004/recommit_report_v1.json');
    await expect(store.readJson(paths.chapterArtifact(4, 'recommit_report_v1.json'), RecommitReportSchema)).resolves.toMatchObject({
      sourceType: 'patch',
      committed: true
    });
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 4 });
  });

  test('rejects invalid schema manual patch without changing Story State', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const stateBefore = await store.readText(paths.storyState());
    const patchPath = path.resolve('fixtures/llm/memory.extract_canon_patch.manual-patch-invalid-schema.json');

    await expect(
      recommitChapter(
        {
          projectId,
          projectsRoot: tempRoot,
          chapterNumber: 4,
          sourceType: 'patch',
          patchPath,
          confirm: true
        },
        store
      )
    ).rejects.toMatchObject({ code: 'MANUAL_PATCH_SCHEMA_INVALID' });
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
  });

  test('rejects still-conflicting manual patch and writes a conflict report', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const stateBefore = await store.readText(paths.storyState());
    const patchPath = path.resolve('fixtures/llm/memory.extract_canon_patch.manual-patch-still-conflicting.json');

    await expect(
      recommitChapter(
        {
          projectId,
          projectsRoot: tempRoot,
          chapterNumber: 4,
          sourceType: 'patch',
          patchPath,
          confirm: true
        },
        store
      )
    ).rejects.toMatchObject({ code: 'MANUAL_RECOMMIT_CONFLICT' });
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
    const conflictReport = await store.readJson(paths.chapterArtifact(4, 'conflict_report_v1.json'), ConflictReportSchema);
    expect(conflictReport.conflicts.length).toBeGreaterThan(0);
  });
});
