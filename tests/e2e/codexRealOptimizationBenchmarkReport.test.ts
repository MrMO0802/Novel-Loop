import { describe, expect, test } from 'vitest';

import { generateCodexRealOptimizationBenchmarkReport } from '../../src/app/codexRealOptimizationBenchmark.js';
import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { CodexRealOptimizationBenchmarkReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.5.5 real optimization benchmark report', () => {
  test('writes a schema-valid real optimization report with local assemble, context budget, and safety evidence', async () => {
    const tempRoot = await createTempRoot('novel-loop-m2755-real-opt-report-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const projectId = 'codex-bench-m275-report';

      const benchmark = await runCodexRuntimeBenchmark(
        {
          projectId,
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'confirm',
          codexProfile: 'clean',
          codexJsonRetries: 2,
          codexJsonRepair: true,
          codexFinalMode: 'local-assemble',
          useCache: true,
          codexContextMode: 'compact',
          codexContextBudgetBytes: 1_200
        },
        store
      );

      expect(benchmark.realOptimizationReportPath).toBe('audit/codex_real_optimization_benchmark_report_v1.json');
      const paths = new ProjectPaths(tempRoot, projectId);
      const report = await store.readJson(paths.auditArtifact('codex_real_optimization_benchmark_report_v1.json'), CodexRealOptimizationBenchmarkReportSchema);
      expect(report).toMatchObject({
        projectId,
        realBenchmark: true,
        baselineSource: 'M26.5 fixed baseline',
        localAssembleUsed: true,
        validatePassed: true,
        auditPassed: true,
        latestCommittedChapterAfter: 1,
        success: true
      });
      expect(report.qualityReportPaths).toEqual(expect.arrayContaining([expect.stringMatching(/^chapters\/chapter_001\/codex_chapter_quality_report_v\d+\.json$/)]));
      expect(report.deltaByStage.preview).toMatchObject({
        baselineMs: 155_470,
        currentMs: expect.any(Number),
        comparisonConfidence: expect.stringMatching(/low|medium|high/)
      });
      expect(report.callCountBefore).toBeGreaterThan(report.callCountAfter);
      expect(report.deltaByPromptId['revision.final_chapter']).toBeLessThanOrEqual(0);
      expect(report.contextBudgetStats.manifestCount).toBeGreaterThan(0);
      expect(report.contextBudgetStats.maxContextBytes).toBeLessThanOrEqual(1_200);
      expect(report.safetyChecks.previewDidNotMutateStoryState).toBe(true);
      expect(report.safetyChecks.confirmMutationsRequireApprovalAndSnapshots).toBe(true);
      expect(report.safetyChecks.localAssembleDidNotMutateStoryState).toBe(true);
      expect(report.safetyChecks.contextManifestDidNotMutateStoryState).toBe(true);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 45_000);

  test('marks slow stages as regressions with low confidence when comparison is not apples-to-apples', async () => {
    const tempRoot = await createTempRoot('novel-loop-m2755-real-opt-regression-');
    try {
      const store = new FileStore();
      const projectId = 'codex-bench-m275-regression';
      const paths = new ProjectPaths(tempRoot, projectId);
      await store.ensureDir(paths.auditDir());
      const result = await generateCodexRealOptimizationBenchmarkReport(
        {
          projectId,
          projectsRoot: tempRoot,
          benchmarkReport: {
            reportId: 'codex_runtime_benchmark_report_v1',
            projectId,
            generatedAt: '2026-07-07T00:00:00.000Z',
            codexStatus: {},
            profile: 'clean',
            totalDurationMs: 600_000,
            success: true,
            completedLevels: ['bible'],
            stages: [
              {
                level: 'bible',
                stageName: 'build-bible',
                command: 'codex benchmark --level bible',
                status: 'success',
                startedAt: '2026-07-07T00:00:00.000Z',
                endedAt: '2026-07-07T00:10:00.000Z',
                durationMs: 600_000,
                codexCallCount: 4,
                retryCount: 1,
                repairCount: 1,
                timeoutCount: 0,
                promptInputBytes: 10_000,
                contextBytes: 1_000,
                schemaBytes: 2_000,
                outputBytes: 5_000,
                rawJsonlBytes: 6_000,
                artifactCount: 4,
                stateMutationApplied: false,
                latestCommittedChapterBefore: 0,
                latestCommittedChapterAfter: 0,
                suggestedRetryCommand: 'corepack pnpm novel-loop codex benchmark --level bible'
              }
            ],
            profileComparisons: []
          },
          sourceBenchmarkReportPath: 'audit/codex_runtime_benchmark_report_v1.json',
          realBenchmark: true
        },
        store
      );

      expect(result.report.regressions).toEqual(expect.arrayContaining([expect.stringContaining('bible')]));
      expect(result.report.deltaByStage.bible.deltaPercent).toBeGreaterThan(0);
      expect(result.report.deltaByStage.bible.comparisonConfidence).toBe('low');
      await expect(store.readJson(paths.auditArtifact('codex_real_optimization_benchmark_report_v1.json'), CodexRealOptimizationBenchmarkReportSchema)).resolves.toMatchObject({
        success: false
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  });
});
