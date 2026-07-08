import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { generateCodexChapterRegressionAnalysis } from '../../src/app/codexChapterRegressionAnalysis.js';
import { generateCodexRuntimeGapReport } from '../../src/app/codexRuntimeGap.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { CodexChapterRegressionAnalysisSchema, CodexRuntimeBenchmarkReportSchema, CodexStageRuntimeProfileReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.7 Codex regression analysis v2', () => {
  test('reports explained and unexplained chapter deltas and recommends runtime gap analysis when coverage is low', async () => {
    const tempRoot = await createTempRoot('novel-loop-m277-regression-v2-');
    try {
      const store = new FileStore();
      const projectId = 'codex-regression-v2';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build` }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan` }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      await writeBenchmark(paths, store);
      await writeProfile(paths, store);
      await writeRun(paths, store);
      const gap = await generateCodexRuntimeGapReport({ projectId, projectsRoot: tempRoot }, store);

      const result = await generateCodexChapterRegressionAnalysis({ projectId, projectsRoot: tempRoot }, store);
      const chapter2 = result.report.currentChapters.find((chapter) => chapter.chapterNumber === 2);

      expect(result.report).toMatchObject({
        runtimeGapReportPath: gap.reportPath
      });
      expect(result.report.missionRetryReportPath).toBeUndefined();
      expect(result.report.missionMicroBenchmarkPath).toBeUndefined();
      expect(chapter2).toMatchObject({
        chapterNumber: 2,
        deltaMs: 165_999,
        explainedDeltaMs: 22_932,
        unexplainedDeltaMs: 143_067,
        explanationCoveragePercent: 13.81
      });
      expect(result.report.recommendations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recommendationType: 'continue_runtime_gap_analysis',
            reason: expect.stringContaining('coverage')
          })
        ])
      );
      await expect(store.readJson(paths.projectArtifact(result.reportPath), CodexChapterRegressionAnalysisSchema)).resolves.toMatchObject({
        runtimeGapReportPath: gap.reportPath
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});

async function writeBenchmark(paths: ProjectPaths, store: FileStore): Promise<void> {
  await store.writeJson(
    paths.auditArtifact('codex_runtime_benchmark_report_v1.json'),
    {
      reportId: 'codex_runtime_benchmark_report_v1',
      projectId: paths.projectId,
      generatedAt: '2026-07-07T00:00:00.000Z',
      codexStatus: { providerAvailable: true },
      profile: 'clean',
      totalDurationMs: 1_603_330,
      success: true,
      completedLevels: ['chapter2', 'chapter3'],
      stages: [
        stage('chapter2', 'chapter-002-dry-run', 507_235, 2),
        stage('chapter3', 'chapter-003-dry-run', 400_767, 3)
      ],
      profileComparisons: []
    },
    CodexRuntimeBenchmarkReportSchema
  );
}

function stage(level: 'chapter2' | 'chapter3', stageName: string, durationMs: number, chapterNumber: number) {
  return {
    level,
    stageName,
    command: `chapter ${chapterNumber}`,
    runId: `run_ch${chapterNumber}_mission`,
    status: 'success',
    startedAt: '2026-07-07T00:00:00.000Z',
    endedAt: '2026-07-07T00:01:00.000Z',
    durationMs,
    codexCallCount: 1,
    retryCount: chapterNumber === 2 ? 1 : 0,
    repairCount: 0,
    timeoutCount: 0,
    promptInputBytes: 8_000,
    contextBytes: 7_000,
    schemaBytes: 1_000,
    outputBytes: 2_000,
    rawJsonlBytes: 3_000,
    artifactCount: 4,
    stateMutationApplied: false,
    latestCommittedChapterBefore: chapterNumber - 1,
    latestCommittedChapterAfter: chapterNumber - 1,
    suggestedRetryCommand: `chapter ${chapterNumber}`
  };
}

async function writeProfile(paths: ProjectPaths, store: FileStore): Promise<void> {
  await store.writeJson(
    paths.auditArtifact('codex_stage_runtime_profile_v1.json'),
    {
      reportId: 'codex_stage_runtime_profile_v1',
      projectId: paths.projectId,
      generatedAt: '2026-07-07T00:00:00.000Z',
      sourceRunCount: 2,
      sourceBenchmarkReportPaths: ['audit/codex_runtime_benchmark_report_v1.json'],
      totalDurationMs: 62_932,
      durationByChapter: { chapter_002: 22_932, chapter_003: 40_000 },
      durationByStage: { chapter_mission: 62_932 },
      codexCallsByStage: { chapter_mission: 2 },
      retriesByStage: { chapter_mission: 1 },
      repairsByStage: {},
      timeoutByStage: {},
      promptBytesByStage: {},
      outputBytesByStage: {},
      schemaBytesByStage: {},
      profiledPromptCallCount: 2,
      slowestPromptCalls: [
        call('prompt_ch2_mission', 'run_ch2_mission', 2, 22_932, 1),
        call('prompt_ch3_mission', 'run_ch3_mission', 3, 40_000, 0)
      ],
      promptCallsByPromptId: { 'planning.plan_chapter_mission_slim': 2 },
      promptCallsByStage: { chapter_mission: 2 },
      promptCallsByRun: { run_ch2_mission: 1, run_ch3_mission: 1 },
      promptCallsByChapter: { chapter_002: 1, chapter_003: 1 },
      largestPromptInputs: [],
      largestSchemas: [],
      largestOutputs: [],
      repairCalls: [],
      retryCalls: [call('prompt_ch2_mission', 'run_ch2_mission', 2, 22_932, 1)],
      unclassifiedCalls: [],
      remainingUnclassifiedCount: 0,
      otherCodexBreakdown: { totalCalls: 0, totalDurationMs: 0, byPromptId: [], byRunId: [], byCommand: [], byArtifactType: [], likelyCategories: [], reasonCategories: [] },
      rawRuntimeView: { totalPromptCallCount: 2, totalDurationMs: 62_932, byStage: { chapter_mission: 62_932 }, includesWrapperCalls: true },
      businessRuntimeView: { totalBusinessCallCount: 2, totalDurationMs: 62_932, byBusinessStage: { chapter_mission: 62_932 }, byPromptId: { 'planning.plan_chapter_mission_slim': 62_932 }, wrapperCallsRolledUp: true, doubleCountingRemoved: true },
      overheadRuntimeView: { wrapperCallCount: 0, wrapperDurationMs: 0, healthSmokeDurationMs: 0, jsonRepairDurationMs: 0, redactionDurationMs: 0, artifactWriteDurationMs: 0, unclassifiedOverheadMs: 0 },
      wrapperBreakdown: { totalWrapperCalls: 0, totalWrapperDurationMs: 0, orphanWrapperCallCount: 0, byWrapperType: [], byParentStage: [], byParentPromptId: [], orphanWrapperCalls: [], inferredWrapperCalls: [] },
      slowestBusinessPromptCalls: [],
      slowestRuns: [],
      durationByCommand: {},
      durationByPromptId: { 'planning.plan_chapter_mission_slim': 62_932 },
      durationByPromptFamily: { planning: 62_932 },
      durationByChapterStage: { 'chapter_002.chapter_mission': 22_932, 'chapter_003.chapter_mission': 40_000 },
      slowestStages: [{ stage: 'chapter_mission', durationMs: 62_932, codexCallCount: 2 }],
      optimizationCandidates: [],
      storyStateMutated: false
    },
    CodexStageRuntimeProfileReportSchema
  );
}

function call(promptCallId: string, runId: string, chapterNumber: number, durationMs: number, retryCount: number) {
  return {
    promptCallId,
    runId,
    command: `chapter ${chapterNumber}`,
    status: 'succeeded',
    chapterNumber,
    promptId: 'planning.plan_chapter_mission_slim',
    promptFamily: 'planning',
    inferredStage: 'chapter_mission',
    likelyCategory: 'chapter_planning_subtask',
    classified: true,
    durationMs,
    latencyMs: durationMs,
    promptInputBytes: 8_000,
    contextBytes: 7_000,
    schemaBytes: 1_000,
    outputBytes: 2_000,
    rawJsonlBytes: 3_000,
    retryCount,
    repairCount: 0,
    jsonParsed: true,
    schemaValid: true,
    artifactPaths: [],
    attributionMode: 'direct',
    attributionConfidence: 'high',
    attributionReason: 'fixture',
    suggestedOptimization: 'fixture'
  };
}

async function writeRun(paths: ProjectPaths, store: FileStore): Promise<void> {
  const runId = 'run_ch2_mission';
  await store.ensureDir(paths.runDir(runId));
  await store.writeJson(
    paths.runManifest(runId),
    {
      schemaVersion: '2',
      runId,
      projectId: paths.projectId,
      command: 'chapter 2 mission',
      args: {},
      argv: ['chapter', '2'],
      cwd: paths.projectsRoot,
      startedAt: '2026-07-07T00:00:00.000Z',
      endedAt: '2026-07-07T00:08:27.235Z',
      durationMs: 507_235,
      status: 'success',
      packageVersion: '2.5.0-rc.1',
      nodeVersion: process.version,
      provider: 'codex-text',
      redactionPolicy: { savePromptInputs: false, savePromptOutputs: true, redactSecrets: true, redactUserContent: false, redactedFields: [] },
      resolvedContext: { projectId: paths.projectId, chapterNumber: 2, resolvedChapterNumber: 2, mode: 'codex' },
      stages: [],
      promptCalls: [
        {
          promptCallId: 'prompt_ch2_mission',
          promptId: 'planning.plan_chapter_mission_slim',
          provider: 'codex-text',
          model: 'codex-cli',
          status: 'succeeded',
          startedAt: '2026-07-07T00:00:00.000Z',
          endedAt: '2026-07-07T00:00:22.932Z',
          latencyMs: 22_932,
          promptInputBytes: 8_000,
          contextBytes: 7_000,
          schemaBytes: 1_000,
          outputBytes: 2_000,
          rawJsonlBytes: 3_000,
          redacted: true,
          jsonParsed: true,
          schemaValid: true,
          retryCount: 1
        }
      ],
      llmCalls: [],
      artifacts: [],
      queueTransitions: [],
      stateMutations: [],
      snapshots: [],
      archives: [],
      conflicts: [],
      repairs: [],
      recommits: [],
      historicalRebases: [],
      reusePolicies: [],
      errors: [],
      auditRefs: [],
      summary: { generatedArtifactCount: 0, reusedArtifactCount: 0, archivedArtifactCount: 0, promptCallCount: 1, queueTransitionCount: 0, stateMutationCount: 0, snapshotCount: 0, errorCount: 0 }
    },
    RunManifestV2Schema
  );
}
