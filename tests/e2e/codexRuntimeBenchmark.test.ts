import { describe, expect, test } from 'vitest';

import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { CodexRuntimeBenchmarkReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M26.5 codex runtime benchmark', () => {
  test('runs health level and records size/call metrics in a schema-valid report', async () => {
    const tempRoot = await createTempRoot('novel-loop-m265-benchmark-health-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();

      const result = await runCodexRuntimeBenchmark(
        {
          projectId: 'codex-bench',
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'health',
          codexProfile: 'clean',
          codexStageTimeoutMs: 5_000
        },
        store
      );

      expect(result.report.success).toBe(true);
      expect(result.report.completedLevels).toEqual(['health']);
      expect(result.report.stages.map((stage) => stage.stageName)).toEqual(['codex-status', 'codex-smoke', 'codex-exec-json']);
      expect(result.report.stages.every((stage) => stage.status === 'success')).toBe(true);
      expect(result.report.stages.some((stage) => stage.codexCallCount > 0)).toBe(true);
      expect(result.report.stages.some((stage) => stage.promptInputBytes > 0)).toBe(true);
      expect(result.report.stages.some((stage) => stage.outputBytes > 0)).toBe(true);
      expect(result.report.stages.some((stage) => stage.rawJsonlBytes > 0)).toBe(true);

      const paths = new ProjectPaths(tempRoot, 'codex-bench');
      await expect(store.readJson(paths.auditArtifact('codex_runtime_benchmark_report_v1.json'), CodexRuntimeBenchmarkReportSchema)).resolves.toMatchObject({
        success: true,
        profile: 'clean'
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  });

  test('can run bible after health created only Codex audit artifacts', async () => {
    const tempRoot = await createTempRoot('novel-loop-m265-benchmark-sequential-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const common = {
        projectId: 'codex-bench',
        projectsRoot: tempRoot,
        briefPath,
        promptRoot,
        codexBin: fake.codexBin,
        codexProfile: 'clean' as const,
        codexStageTimeoutMs: 5_000
      };

      await runCodexRuntimeBenchmark({ ...common, level: 'health' }, store);
      const bible = await runCodexRuntimeBenchmark({ ...common, level: 'bible' }, store);

      expect(bible.report.success).toBe(true);
      expect(bible.report.completedLevels).toEqual(['bible']);
      const state = await store.readJson(new ProjectPaths(tempRoot, 'codex-bench').storyState(), StoryStateSchema);
      expect(state.latestCommittedChapter).toBe(0);
    } finally {
      await removeTempRoot(tempRoot);
    }
  });

  test('preview then confirm resume commits chapter 1 without rerunning earlier levels', async () => {
    const tempRoot = await createTempRoot('novel-loop-m265-benchmark-resume-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const common = {
        projectId: 'codex-bench',
        projectsRoot: tempRoot,
        briefPath,
        promptRoot,
        codexBin: fake.codexBin,
        codexProfile: 'clean' as const,
        codexStageTimeoutMs: 5_000
      };

      const preview = await runCodexRuntimeBenchmark({ ...common, level: 'preview' }, store);
      expect(preview.report.success).toBe(true);
      expect(preview.report.stages.at(-1)?.stateMutationApplied).toBe(false);

      const confirm = await runCodexRuntimeBenchmark({ ...common, level: 'confirm', resume: true }, store);
      expect(confirm.report.success).toBe(true);
      expect(confirm.report.stages.map((stage) => stage.stageName)).toEqual(['chapter-001-confirm']);
      expect(confirm.report.stages[0]?.stateMutationApplied).toBe(true);
      expect(confirm.report.stages[0]?.latestCommittedChapterBefore).toBe(0);
      expect(confirm.report.stages[0]?.latestCommittedChapterAfter).toBe(1);

      const state = await store.readJson(new ProjectPaths(tempRoot, 'codex-bench').storyState(), StoryStateSchema);
      expect(state.latestCommittedChapter).toBe(1);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);

  test('fails preview stage when controlled commit does not produce a Codex preview', async () => {
    const tempRoot = await createTempRoot('novel-loop-m27-benchmark-preview-gate-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-diagnostics-fail');
      const store = new FileStore();

      const result = await runCodexRuntimeBenchmark(
        {
          projectId: 'codex-bench',
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'preview',
          codexProfile: 'clean',
          codexStageTimeoutMs: 5_000
        },
        store
      );

      expect(result.report.success).toBe(false);
      expect(result.report.failedLevel).toBe('preview');
      expect(result.report.completedLevels).not.toContain('preview');
      expect(result.report.stages.at(-1)).toMatchObject({
        stageName: 'chapter-001-preview',
        status: 'failed',
        latestCommittedChapterBefore: 0,
        latestCommittedChapterAfter: 0
      });

      const state = await store.readJson(new ProjectPaths(tempRoot, 'codex-bench').storyState(), StoryStateSchema);
      expect(state.latestCommittedChapter).toBe(0);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});
