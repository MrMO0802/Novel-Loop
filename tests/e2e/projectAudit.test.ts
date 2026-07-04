import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { ChapterQueueSchema, ProjectAuditReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, prepareCommittedThreeChapterProject, projectId, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m18-audit-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('project audit', () => {
  test('writes project audit reports and can refresh index without modifying Story State', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const stateBefore = await store.readText(paths.storyState());

    const result = await auditProject({ projectId, projectsRoot: tempRoot, fixIndex: true }, store);

    expect(result.reportPath).toBe('audit/project_audit_v1.json');
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
    await expect(store.readJson(paths.projectArtifact(result.reportPath), ProjectAuditReportSchema)).resolves.toMatchObject({
      projectId
    });
    await expect(store.exists(paths.projectArtifact('artifacts/artifact_index.json'))).resolves.toBe(true);
  }, 15000);

  test('strict audit reports queue and Story State inconsistency as blocking', async () => {
    const paths = await prepareCommittedThreeChapterProject(tempRoot);
    const store = new FileStore();
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    queue.chapters.find((chapter) => chapter.chapterNumber === 3)!.status = 'planned';
    await store.writeJson(paths.chapterQueue(), queue, ChapterQueueSchema);

    const result = await auditProject({ projectId, projectsRoot: tempRoot, strict: true }, store);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'queue',
          blocking: true
        })
      ])
    );
  });
});
