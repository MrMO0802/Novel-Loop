import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexMultiChapterPilot } from '../../src/app/codexMultiChapterPilot.js';
import {
  CodexCrossChapterDriftReportSchema,
  CodexMultiChapterPilotReportSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m26-pilot-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M26 codex multi-chapter pilot', () => {
  test('runs a deterministic fake Codex three-chapter controlled-commit pilot', async () => {
    const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
    const store = new FileStore();

    const result = await runCodexMultiChapterPilot(
      {
        projectId: 'codex-multi',
        projectsRoot: tempRoot,
        briefPath,
        promptRoot,
        targetChapterCount: 3,
        codexBin: fake.codexBin,
        codexProfile: 'clean',
        codexJsonRetries: 2,
        codexJsonRepair: true
      },
      store
    );

    expect(result.report.success).toBe(true);
    expect(result.report.completedChapterCount).toBe(3);
    expect(result.report.latestCommittedChapterBefore).toBe(0);
    expect(result.report.latestCommittedChapterAfter).toBe(3);
    expect(result.report.validatePassed).toBe(true);
    expect(result.report.auditPassed).toBe(true);
    expect(result.report.chapters).toHaveLength(3);
    expect(result.report.chapters.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3]);
    for (const chapter of result.report.chapters) {
      expect(chapter.draftRunId).toMatch(/^run_/);
      expect(chapter.previewRunId).toMatch(/^run_/);
      expect(chapter.confirmedRunId).toMatch(/^run_/);
      expect(chapter.previewReusedForConfirm).toBe(true);
      expect(chapter.latestCommittedChapterAfter).toBe(chapter.chapterNumber);
      expect(chapter.previewStateHash).toMatch(/^[a-f0-9]{64}$/);
      expect(chapter.confirmedStateHash).toBe(chapter.previewStateHash);
      expect(chapter.finalPath).toBe(`chapters/chapter_${String(chapter.chapterNumber).padStart(3, '0')}/final.md`);
      expect(chapter.canonPatchPath).toBeDefined();
      expect(chapter.qualityReportPath).toBeDefined();
      expect(chapter.stateDiffPath).toBeDefined();
      expect(chapter.approvalRecordPath).toBeDefined();
      expect(chapter.commitReportPath).toBeDefined();
      expect(chapter.beforeSnapshotId).toBeDefined();
      expect(chapter.afterSnapshotId).toBeDefined();
      expect(chapter.qualityCriticalIssues).toEqual([]);
    }

    const paths = new ProjectPaths(tempRoot, 'codex-multi');
    await expect(store.readJson(paths.auditArtifact('codex_multi_chapter_pilot_report_v1.json'), CodexMultiChapterPilotReportSchema)).resolves.toMatchObject({
      success: true,
      completedChapterCount: 3
    });
    await expect(store.readJson(paths.auditArtifact('codex_cross_chapter_drift_report_v1.json'), CodexCrossChapterDriftReportSchema)).resolves.toMatchObject({
      blockingIssues: [],
      latestCommittedChapter: 3
    });
    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(3);
    expect(state.canonFacts.map((fact) => fact.sourceChapter)).toEqual(expect.arrayContaining([1, 2, 3]));
  }, 60_000);
});
