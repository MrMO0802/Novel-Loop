import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexMultiChapterPilot } from '../../src/app/codexMultiChapterPilot.js';
import { CodexBudgetReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m26-budget-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M26 codex per-chapter budget', () => {
  test('blocks a chapter before Story State mutation when the call budget is exhausted', async () => {
    const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
    const store = new FileStore();

    const result = await runCodexMultiChapterPilot(
      {
        projectId: 'codex-budget',
        projectsRoot: tempRoot,
        briefPath,
        promptRoot,
        targetChapterCount: 3,
        codexBin: fake.codexBin,
        codexProfile: 'clean',
        codexJsonRetries: 2,
        codexJsonRepair: true,
        codexMaxCallsPerChapter: 0
      },
      store
    );

    expect(result.report.success).toBe(false);
    expect(result.report.completedChapterCount).toBe(0);
    expect(result.report.failureReportPath).toBe('audit/codex_budget_report_v1.json');
    expect(result.report.chapters).toHaveLength(1);
    expect(result.report.chapters[0]?.warnings).toEqual(expect.arrayContaining(['Codex call budget exhausted before chapter execution.']));

    const paths = new ProjectPaths(tempRoot, 'codex-budget');
    await expect(store.readJson(paths.auditArtifact('codex_budget_report_v1.json'), CodexBudgetReportSchema)).resolves.toMatchObject({
      chapterNumber: 1,
      exceeded: true,
      storyStateMutated: false
    });
    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(0);
  });
});
