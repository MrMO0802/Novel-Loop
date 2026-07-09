import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { generateCodexChapterRegressionAnalysis } from '../../src/app/codexChapterRegressionAnalysis.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { auditProject } from '../../src/app/projectAudit.js';
import {
  CodexChapterRegressionAnalysisSchema,
  CodexCrossChapterContinuityReportSchema,
  CodexRuntimeBenchmarkReportSchema,
  CodexStageRuntimeProfileReportSchema,
  RunManifestV2Schema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

const execFileAsync = promisify(execFile);

describe('M27.6 Codex chapter regression analysis', () => {
  test('detects chapter2 and chapter3 regressions, duplicate calls, byte growth, retries, and ranked root causes without mutating Story State', async () => {
    const tempRoot = await createTempRoot('novel-loop-m276-regression-analysis-');
    try {
      const { paths, store } = await prepareProject(tempRoot, 'codex-regression-analysis');
      await writeSyntheticBenchmark(paths, store);
      await writeSyntheticProfile(paths, store);
      await writeSyntheticRuns(paths, store);
      await writeSyntheticContinuity(paths, store);
      const storyStateBefore = await store.readText(paths.storyState());

      const result = await generateCodexChapterRegressionAnalysis({ projectId: paths.projectId, projectsRoot: tempRoot }, store);
      const report = result.report;

      expect(report).toMatchObject({
        reportId: 'codex_chapter_regression_analysis_v1',
        projectId: paths.projectId,
        currentBenchmarkPath: 'audit/codex_runtime_benchmark_report_v1.json',
        confidence: 'high',
        storyStateMutated: false
      });
      expect(CodexChapterRegressionAnalysisSchema.parse(report)).toMatchObject({ reportId: report.reportId });
      expect(report.regressions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ chapterNumber: 2, deltaMs: 165_999 }),
          expect.objectContaining({ chapterNumber: 3, deltaMs: 51_996 })
        ])
      );
      expect(report.currentChapters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            chapterNumber: 2,
            durationByStage: expect.objectContaining({
              chapter_mission: expect.objectContaining({ durationMs: expect.any(Number), retryCount: 1 }),
              scene_cards: expect.objectContaining({ durationMs: expect.any(Number) })
            }),
            codexCallCount: expect.any(Number),
            retryCount: 1,
            promptBytesTotal: expect.any(Number)
          }),
          expect.objectContaining({
            chapterNumber: 3,
            durationByStage: expect.objectContaining({
              canon_patch_proposal: expect.objectContaining({ durationMs: expect.any(Number) })
            }),
            continuityWarnings: 1
          })
        ])
      );
      expect(report.duplicatePromptCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            chapterNumber: 2,
            promptId: 'planning.generate_scene_cards',
            runIds: ['run_ch2_draft', 'run_ch2_preview'],
            safeToReuse: true
          })
        ])
      );
      expect(report.repeatedStageCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ chapterNumber: 2, stage: 'scene_cards', runIds: ['run_ch2_draft', 'run_ch2_preview'] })
        ])
      );
      expect(report.previewArtifactsReused).toBe(true);
      expect(report.previewPatchReused).toBe(true);
      expect(report.finalReused).toBe(true);
      expect(report.stateDiffReused).toBe(true);
      expect(report.promptBytesRegressions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ chapterNumber: 2, stage: 'chapter_mission', promptId: 'planning.plan_chapter_mission', currentBytes: 42_000 })
        ])
      );
      expect(report.schemaBytesRegressions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ chapterNumber: 3, stage: 'canon_patch_proposal', promptId: 'memory.extract_canon_patch_proposal_slim', currentBytes: 32_000 })
        ])
      );
      expect(report.outputBytesRegressions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ chapterNumber: 3, stage: 'write_scene', promptId: 'production.write_scene', currentBytes: 45_000 })
        ])
      );
      expect(report.retryRegressions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ chapterNumber: 2, stage: 'chapter_mission', promptId: 'planning.plan_chapter_mission', currentRetryCount: 1 })
        ])
      );
      expect(report.repairRegressions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ chapterNumber: 3, stage: 'canon_patch_proposal', promptId: 'memory.extract_canon_patch_proposal_slim', currentRepairCount: 1 })
        ])
      );
      expect(report.suspectedRootCauses.map((cause) => cause.rootCauseId)).toEqual([
        'retry_repair_increase_ch2_chapter_mission_planning_plan_chapter_mission',
        'retry_repair_increase_ch3_canon_patch_proposal_memory_extract_canon_patch_proposal_slim',
        'duplicate_call_ch2_scene_cards_planning_generate_scene_cards',
        'increased_output_bytes_ch3_write_scene_production_write_scene',
        'increased_prompt_bytes_ch2_chapter_mission_planning_plan_chapter_mission',
        'increased_schema_bytes_ch3_canon_patch_proposal_memory_extract_canon_patch_proposal_slim'
      ]);
      expect(report.suspectedRootCauses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rootCauseId: 'duplicate_call_ch2_scene_cards_planning_generate_scene_cards',
            rootCauseType: 'duplicate_call',
            affectedChapter: 2,
            confidence: 'high',
            impactMs: 45_000
          })
        ])
      );
      expect(report.suspectedRootCauses[0]).toMatchObject({
        rootCauseType: 'retry_repair_increase',
        affectedChapter: 2,
        confidence: 'high',
        impactMs: 180_000
      });
      expect(report.suspectedRootCauses[2]).toMatchObject({
        rootCauseType: 'duplicate_call',
        affectedChapter: 2,
        confidence: 'high',
        impactMs: 45_000
      });
      expect(report.recommendedFixes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            experimentId: 'reuse_scene_cards_ch2',
            targetChapter: 2,
            targetStage: 'scene_cards',
            rollbackPlan: expect.stringContaining('Revert')
          }),
          expect.objectContaining({
            targetStage: 'canon_patch_proposal',
            safetyRisk: 'medium',
            requiredTests: expect.arrayContaining(['corepack pnpm test'])
          })
        ])
      );
      expect(report.mappingCleanup).toMatchObject({
        unknownPromptMappings: [],
        diagnosticOverheadClassified: expect.arrayContaining([expect.objectContaining({ runId: 'run_exec_json_smoke' })]),
        unresolvedWarnings: []
      });
      expect(await store.readText(paths.storyState())).toBe(storyStateBefore);

      await expect(store.readJson(paths.auditArtifact('codex_chapter_regression_analysis_v1.json'), CodexChapterRegressionAnalysisSchema)).resolves.toMatchObject({
        storyStateMutated: false
      });
      const audit = await auditProject({ projectId: paths.projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
      expect(audit.ok).toBe(true);
      expect(audit.report.issues.filter((issue) => issue.severity === 'error' || issue.severity === 'critical')).toHaveLength(0);
      expect(audit.report.issues.filter((issue) => issue.category === 'codex_regression_analysis')).toHaveLength(0);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);

  test('CLI regression-analysis writes a read-only report', async () => {
    const tempRoot = await createTempRoot('novel-loop-m276-regression-cli-');
    try {
      const { paths, store } = await prepareProject(tempRoot, 'codex-regression-cli');
      await writeSyntheticBenchmark(paths, store);
      await writeSyntheticProfile(paths, store);
      await writeSyntheticRuns(paths, store);
      await writeSyntheticContinuity(paths, store);
      const storyStateBefore = await store.readText(paths.storyState());

      const { stdout } = await execFileAsync('node', ['dist/cli/index.js', 'codex', 'regression-analysis', paths.projectId, '--root', tempRoot], {
        cwd: process.cwd()
      });

      expect(stdout).toContain('codexChapterRegressionAnalysis: success');
      expect(stdout).toContain('regressedChapters: 2,3');
      expect(await store.readText(paths.storyState())).toBe(storyStateBefore);
      await expect(store.readJson(paths.auditArtifact('codex_chapter_regression_analysis_v1.json'), CodexChapterRegressionAnalysisSchema)).resolves.toMatchObject({
        projectId: paths.projectId
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});

async function prepareProject(tempRoot: string, projectId: string): Promise<{ paths: ProjectPaths; store: FileStore }> {
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build_bible` }, store);
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan_global` }, store);
  return { paths: new ProjectPaths(tempRoot, projectId), store };
}

async function writeSyntheticBenchmark(paths: ProjectPaths, store: FileStore): Promise<void> {
  await store.ensureDir(paths.auditDir());
  await store.writeJson(
    paths.auditArtifact('codex_runtime_benchmark_report_v1.json'),
    {
      reportId: 'codex_runtime_benchmark_report_v1',
      projectId: paths.projectId,
      generatedAt: '2026-07-07T00:00:00.000Z',
      codexStatus: { providerAvailable: true },
      profile: 'clean',
      totalDurationMs: 1_610_155,
      success: true,
      completedLevels: ['health', 'bible', 'plan', 'draft', 'preview', 'confirm', 'chapter2', 'chapter3'],
      stages: [
        benchmarkStage('chapter2', 'chapter-002-dry-run', 277_528, 3, 1, 0, 98_000, 11_000, 12_000),
        benchmarkStage('chapter2', 'chapter-002-draft', 104_961, 3, 0, 0, 70_000, 8_000, 28_000),
        benchmarkStage('chapter2', 'chapter-002-preview', 124_525, 3, 0, 0, 50_000, 36_000, 10_000),
        benchmarkStage('chapter2', 'chapter-002-confirm', 221, 0, 0, 0, 0, 0, 0),
        benchmarkStage('chapter3', 'chapter-003-dry-run', 93_089, 3, 0, 0, 60_000, 10_000, 12_000),
        benchmarkStage('chapter3', 'chapter-003-draft', 102_163, 3, 0, 0, 62_000, 8_000, 45_000),
        benchmarkStage('chapter3', 'chapter-003-preview', 205_166, 3, 0, 1, 54_000, 32_000, 12_000),
        benchmarkStage('chapter3', 'chapter-003-confirm', 349, 0, 0, 0, 0, 0, 0)
      ],
      profileComparisons: []
    },
    CodexRuntimeBenchmarkReportSchema
  );
  await store.writeText(paths.auditArtifact('codex_runtime_benchmark_report_v1.md'), '# benchmark fixture\n');
}

function benchmarkStage(
  level: 'chapter2' | 'chapter3',
  stageName: string,
  durationMs: number,
  codexCallCount: number,
  retryCount: number,
  repairCount: number,
  promptInputBytes: number,
  schemaBytes: number,
  outputBytes: number
) {
  return {
    level,
    stageName,
    command: `codex benchmark ${stageName}`,
    status: 'success',
    startedAt: '2026-07-07T00:00:00.000Z',
    endedAt: '2026-07-07T00:00:01.000Z',
    durationMs,
    codexCallCount,
    retryCount,
    repairCount,
    timeoutCount: 0,
    promptInputBytes,
    contextBytes: promptInputBytes,
    schemaBytes,
    outputBytes,
    rawJsonlBytes: outputBytes + 500,
    artifactCount: 5,
    stateMutationApplied: false,
    latestCommittedChapterBefore: level === 'chapter2' ? 1 : 2,
    latestCommittedChapterAfter: level === 'chapter2' ? 2 : 3,
    suggestedRetryCommand: `corepack pnpm novel-loop codex benchmark --level ${level} --resume`
  };
}

async function writeSyntheticProfile(paths: ProjectPaths, store: FileStore): Promise<void> {
  const promptCalls = [
    promptCall('ch2_mission', 'planning.plan_chapter_mission', 'chapter_mission', 180_000, { chapterNumber: 2, retryCount: 1, promptInputBytes: 42_000, outputBytes: 4_000 }),
    promptCall('ch2_scene_cards_1', 'planning.generate_scene_cards', 'scene_cards', 45_000, { chapterNumber: 2, promptInputBytes: 18_000, schemaBytes: 8_000, outputBytes: 6_000, runId: 'run_ch2_draft', artifactPaths: ['brief.md'] }),
    promptCall('ch2_scene_cards_2', 'planning.generate_scene_cards', 'scene_cards', 45_000, { chapterNumber: 2, promptInputBytes: 18_000, schemaBytes: 8_000, outputBytes: 6_000, runId: 'run_ch2_preview', artifactPaths: ['brief.md'] }),
    promptCall('ch2_write_scene', 'production.write_scene', 'write_scene', 104_961, { chapterNumber: 2, promptInputBytes: 34_000, outputBytes: 28_000, runId: 'run_ch2_draft' }),
    promptCall('ch3_write_scene', 'production.write_scene', 'write_scene', 102_163, { chapterNumber: 3, promptInputBytes: 33_000, outputBytes: 45_000 }),
    promptCall('ch3_patch', 'memory.extract_canon_patch_proposal_slim', 'canon_patch_proposal', 120_000, { chapterNumber: 3, repairCount: 1, promptInputBytes: 25_000, schemaBytes: 32_000, outputBytes: 12_000 })
  ];
  const businessCalls = promptCalls.map(toBusinessCall);
  await store.writeJson(
    paths.auditArtifact('codex_stage_runtime_profile_v1.json'),
    {
      reportId: 'codex_stage_runtime_profile_v1',
      projectId: paths.projectId,
      generatedAt: '2026-07-07T00:00:00.000Z',
      sourceRunCount: 4,
      sourceBenchmarkReportPaths: ['audit/codex_runtime_benchmark_report_v1.json'],
      totalDurationMs: 597_124,
      durationByChapter: { chapter_002: 374_961, chapter_003: 222_163 },
      durationByStage: { chapter_mission: 180_000, scene_cards: 90_000, write_scene: 207_124, canon_patch_proposal: 120_000 },
      codexCallsByStage: { chapter_mission: 1, scene_cards: 2, write_scene: 2, canon_patch_proposal: 1 },
      retriesByStage: { chapter_mission: 1 },
      repairsByStage: { canon_patch_proposal: 1 },
      timeoutByStage: {},
      promptBytesByStage: { chapter_mission: 42_000, scene_cards: 36_000, write_scene: 67_000, canon_patch_proposal: 25_000 },
      outputBytesByStage: { chapter_mission: 4_000, scene_cards: 12_000, write_scene: 73_000, canon_patch_proposal: 12_000 },
      schemaBytesByStage: { scene_cards: 16_000, canon_patch_proposal: 32_000 },
      profiledPromptCallCount: promptCalls.length,
      slowestPromptCalls: promptCalls,
      promptCallsByPromptId: {
        'planning.plan_chapter_mission': 1,
        'planning.generate_scene_cards': 2,
        'production.write_scene': 2,
        'memory.extract_canon_patch_proposal_slim': 1
      },
      promptCallsByStage: { chapter_mission: 1, scene_cards: 2, write_scene: 2, canon_patch_proposal: 1 },
      promptCallsByRun: { run_ch2_dry: 1, run_ch2_draft: 2, run_ch2_preview: 1, run_ch3_preview: 1, run_ch3_draft: 1 },
      promptCallsByChapter: { chapter_002: 4, chapter_003: 2 },
      largestPromptInputs: [promptCalls[0]!, promptCalls[3]!, promptCalls[4]!],
      largestSchemas: [promptCalls[5]!, promptCalls[1]!, promptCalls[2]!],
      largestOutputs: [promptCalls[4]!, promptCalls[3]!],
      repairCalls: [promptCalls[5]!],
      retryCalls: [promptCalls[0]!],
      unclassifiedCalls: [],
      remainingUnclassifiedCount: 0,
      otherCodexBreakdown: {
        totalCalls: 0,
        totalDurationMs: 0,
        byPromptId: [],
        byRunId: [],
        byCommand: [],
        byArtifactType: [],
        likelyCategories: [],
        reasonCategories: []
      },
      rawRuntimeView: { totalPromptCallCount: promptCalls.length, totalDurationMs: 597_124, byStage: {}, includesWrapperCalls: true },
      businessRuntimeView: {
        totalBusinessCallCount: promptCalls.length,
        totalDurationMs: 597_124,
        byBusinessStage: { chapter_mission: 180_000, scene_cards: 90_000, write_scene: 207_124, canon_patch_proposal: 120_000 },
        byPromptId: {
          'planning.plan_chapter_mission': 180_000,
          'planning.generate_scene_cards': 90_000,
          'production.write_scene': 207_124,
          'memory.extract_canon_patch_proposal_slim': 120_000
        },
        wrapperCallsRolledUp: true,
        doubleCountingRemoved: true
      },
      overheadRuntimeView: { wrapperCallCount: 0, wrapperDurationMs: 0, healthSmokeDurationMs: 0, jsonRepairDurationMs: 0, redactionDurationMs: 0, artifactWriteDurationMs: 0, unclassifiedOverheadMs: 0 },
      wrapperBreakdown: { totalWrapperCalls: 0, totalWrapperDurationMs: 0, orphanWrapperCallCount: 0, byWrapperType: [], byParentStage: [], byParentPromptId: [], orphanWrapperCalls: [], inferredWrapperCalls: [] },
      slowestBusinessPromptCalls: businessCalls,
      slowestRuns: [],
      durationByCommand: {},
      durationByPromptId: {
        'planning.plan_chapter_mission': 180_000,
        'planning.generate_scene_cards': 90_000,
        'production.write_scene': 207_124,
        'memory.extract_canon_patch_proposal_slim': 120_000
      },
      durationByPromptFamily: {},
      durationByChapterStage: {
        'chapter_002.chapter_mission': 180_000,
        'chapter_002.scene_cards': 90_000,
        'chapter_002.write_scene': 104_961,
        'chapter_003.write_scene': 102_163,
        'chapter_003.canon_patch_proposal': 120_000
      },
      slowestStages: [
        { stage: 'write_scene', durationMs: 207_124, codexCallCount: 2 },
        { stage: 'chapter_mission', durationMs: 180_000, codexCallCount: 1 },
        { stage: 'canon_patch_proposal', durationMs: 120_000, codexCallCount: 1 }
      ],
      optimizationCandidates: [],
      storyStateMutated: false
    },
    CodexStageRuntimeProfileReportSchema
  );
  await store.writeText(paths.auditArtifact('codex_stage_runtime_profile_v1.md'), '# profile fixture\n');
}

function toBusinessCall(call: ReturnType<typeof promptCall>) {
  return {
    businessPromptCallId: call.promptCallId,
    promptId: call.promptId,
    stage: call.inferredStage,
    ...(call.chapterNumber === undefined ? {} : { chapterNumber: call.chapterNumber }),
    runId: call.runId,
    netDurationMs: call.latencyMs,
    wrapperDurationMs: 0,
    providerLatencyMs: call.latencyMs,
    promptInputBytes: call.promptInputBytes,
    contextBytes: call.contextBytes,
    schemaBytes: call.schemaBytes,
    outputBytes: call.outputBytes,
    retryCount: call.retryCount,
    repairCount: call.repairCount,
    childWrapperCallIds: [],
    suggestedOptimization: 'fixture business call'
  };
}

async function writeSyntheticRuns(paths: ProjectPaths, store: FileStore): Promise<void> {
  await writeRun(paths, store, 'run_ch2_draft', 2, [
    promptCall('ch2_scene_cards_1', 'planning.generate_scene_cards', 'scene_cards', 45_000, { chapterNumber: 2, promptInputBytes: 18_000, schemaBytes: 8_000, outputBytes: 6_000, runId: 'run_ch2_draft', artifactPaths: ['brief.md'] }),
    promptCall('ch2_write_scene', 'production.write_scene', 'write_scene', 104_961, { chapterNumber: 2, promptInputBytes: 34_000, outputBytes: 28_000, runId: 'run_ch2_draft' })
  ]);
  await writeRun(paths, store, 'run_ch2_preview', 2, [
    promptCall('ch2_scene_cards_2', 'planning.generate_scene_cards', 'scene_cards', 45_000, { chapterNumber: 2, promptInputBytes: 18_000, schemaBytes: 8_000, outputBytes: 6_000, runId: 'run_ch2_preview', artifactPaths: ['brief.md'] })
  ]);
  await writeRun(paths, store, 'run_exec_json_smoke', undefined, [
    promptCall('smoke_exec_json', 'codex.exec-json', 'other_codex', 3_000, {
      runId: 'run_exec_json_smoke',
      provider: 'codex-cli',
      wrapperCallType: 'exec_json',
      attributionMode: 'direct',
      attributionConfidence: 'high'
    })
  ]);
}

async function writeSyntheticContinuity(paths: ProjectPaths, store: FileStore): Promise<void> {
  await store.writeJson(
    paths.auditArtifact('codex_cross_chapter_continuity_report_v1.json'),
    {
      reportId: 'codex_cross_chapter_continuity_report_v1',
      projectId: paths.projectId,
      generatedAt: '2026-07-07T00:00:00.000Z',
      chapters: [1, 2, 3],
      continuityScore: 8,
      blockingIssues: [],
      warnings: [
        {
          issueId: 'continuity_warning_ch3',
          chapterNumber: 3,
          severity: 'warning',
          message: 'chapter 3 repeats a scene beat from chapter 2',
          path: 'chapters/chapter_003/final.md'
        }
      ],
      recommendations: ['Inspect repeated scene pattern before prompt optimization.'],
      chapterLinks: [],
      summariesMissing: [],
      duplicateHookRisk: false,
      repeatedScenePatternRisk: true,
      storyStateMutated: false
    },
    CodexCrossChapterContinuityReportSchema
  );
  await store.writeText(paths.auditArtifact('codex_cross_chapter_continuity_report_v1.md'), '# continuity fixture\n');
}

async function writeRun(paths: ProjectPaths, store: FileStore, runId: string, chapterNumber: number | undefined, calls: ReturnType<typeof promptCall>[]): Promise<void> {
  await store.ensureDir(paths.runDir(runId));
  await store.writeJson(
    paths.runManifest(runId),
    {
      schemaVersion: '2',
      runId,
      projectId: paths.projectId,
      command: chapterNumber === undefined ? 'codex exec-json smoke' : `chapter ${chapterNumber}`,
      args: {},
      argv: [],
      cwd: paths.projectsRoot,
      startedAt: '2026-07-07T00:00:00.000Z',
      endedAt: '2026-07-07T00:00:01.000Z',
      durationMs: calls.reduce((sum, call) => sum + call.latencyMs, 0),
      status: 'success',
      packageVersion: '2.5.0-rc.1',
      nodeVersion: process.version,
      provider: 'codex-text',
      redactionPolicy: { savePromptInputs: false, savePromptOutputs: true, redactSecrets: true, redactUserContent: false, redactedFields: [] },
      resolvedContext: {
        projectId: paths.projectId,
        ...(chapterNumber === undefined ? {} : { chapterNumber, resolvedChapterNumber: chapterNumber }),
        mode: 'codex',
        latestCommittedChapterBefore: chapterNumber === undefined ? 0 : chapterNumber - 1,
        latestCommittedChapterAfter: chapterNumber ?? 0
      },
      stages: [],
      promptCalls: calls,
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
      summary: { generatedArtifactCount: 0, reusedArtifactCount: 0, archivedArtifactCount: 0, promptCallCount: calls.length, queueTransitionCount: 0, stateMutationCount: 0, snapshotCount: 0, errorCount: 0 }
    },
    RunManifestV2Schema
  );
  await store.writeText(paths.runEvents(runId), '');
}

function promptCall(
  promptCallId: string,
  promptId: string,
  inferredStage: string,
  latencyMs: number,
  options: {
    chapterNumber?: number;
    runId?: string;
    provider?: 'codex-text' | 'codex-cli';
    promptInputBytes?: number;
    contextBytes?: number;
    schemaBytes?: number;
    outputBytes?: number;
    retryCount?: number;
    repairCount?: number;
    artifactPaths?: string[];
    wrapperCallType?: 'exec_text' | 'exec_json' | 'health' | 'smoke' | 'repair' | 'unknown';
    attributionMode?: 'direct' | 'parent_child' | 'inferred' | 'unclassified';
    attributionConfidence?: 'high' | 'medium' | 'low';
  }
) {
  const runId = options.runId ?? `run_${promptCallId}`;
  const artifactPaths = options.artifactPaths ?? [];
  return {
    promptCallId,
    runId,
    command: options.provider === 'codex-cli' ? 'codex exec-json smoke' : `chapter ${options.chapterNumber ?? ''}`,
    status: 'succeeded',
    ...(options.chapterNumber === undefined ? {} : { chapterNumber: options.chapterNumber }),
    promptId,
    promptFamily: promptId.split('.')[0] ?? 'unknown',
    inferredStage,
    likelyCategory: options.provider === 'codex-cli' ? 'diagnostic_overhead' : 'business',
    classified: true,
    durationMs: latencyMs,
    latencyMs,
    provider: options.provider ?? 'codex-text',
    model: 'codex-cli',
    transport: 'cli',
    codexProfile: 'clean',
    sandbox: 'read-only',
    startedAt: '2026-07-07T00:00:00.000Z',
    endedAt: '2026-07-07T00:00:01.000Z',
    redacted: true,
    promptInputBytes: options.promptInputBytes ?? 1_000,
    contextBytes: options.contextBytes ?? options.promptInputBytes ?? 1_000,
    schemaBytes: options.schemaBytes ?? 0,
    outputBytes: options.outputBytes ?? 500,
    rawJsonlBytes: (options.outputBytes ?? 500) + 500,
    retryCount: options.retryCount ?? 0,
    repairCount: options.repairCount ?? 0,
    jsonParsed: (options.schemaBytes ?? 0) > 0,
    schemaValid: (options.schemaBytes ?? 0) > 0,
    artifactPaths,
    suggestedOptimization: 'fixture',
    ...(options.wrapperCallType === undefined ? {} : { wrapperCallType: options.wrapperCallType }),
    ...(options.attributionMode === undefined ? {} : { attributionMode: options.attributionMode }),
    ...(options.attributionConfidence === undefined ? {} : { attributionConfidence: options.attributionConfidence })
  };
}
