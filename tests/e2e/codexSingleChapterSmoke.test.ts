import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexSingleChapterSmoke } from '../../src/app/codexSingleChapterSmoke.js';
import { CodexSingleChapterSmokeReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m25-smoke-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M25 codex single-chapter smoke', () => {
  test('runs deterministic fake Codex single-chapter full loop and writes smoke report', async () => {
    const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
    const store = new FileStore();

    const result = await runCodexSingleChapterSmoke(
      {
        projectId: 'codex-single',
        projectsRoot: tempRoot,
        briefPath,
        promptRoot,
        codexBin: fake.codexBin,
        codexProfile: 'clean',
        codexJsonRetries: 2,
        codexJsonRepair: true
      },
      store
    );

    expect(result.report.success).toBe(true);
    expect(result.report.previewRunId).toBeDefined();
    expect(result.report.confirmedRunId).toBeDefined();
    expect(result.report.latestCommittedChapterBefore).toBe(0);
    expect(result.report.latestCommittedChapterAfter).toBe(1);
    expect(result.report.validatePassed).toBe(true);
    expect(result.report.auditPassed).toBe(true);
    expect(result.report.qualityReportPath).toMatch(/^chapters\/chapter_001\/codex_chapter_quality_report_v\d+\.json$/);
    expect(result.report.stages.map((stage) => stage.stageName)).toEqual(
      expect.arrayContaining([
        'init',
        'build-bible',
        'plan-global',
        'chapter-dry-run',
        'chapter-draft',
        'chapter-commit-preview',
        'chapter-commit-confirm',
        'evaluate-chapter',
        'validate',
        'audit',
        'inspect'
      ])
    );

    const paths = new ProjectPaths(tempRoot, 'codex-single');
    await expect(store.readJson(paths.auditArtifact('codex_single_chapter_smoke_report_v1.json'), CodexSingleChapterSmokeReportSchema)).resolves.toMatchObject({
      success: true,
      latestCommittedChapterAfter: 1
    });
    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(1);
  });
});
