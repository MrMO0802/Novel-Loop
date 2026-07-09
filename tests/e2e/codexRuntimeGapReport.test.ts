import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { generateCodexRuntimeGapReport } from '../../src/app/codexRuntimeGap.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { CodexRuntimeBenchmarkReportSchema, CodexRuntimeGapReportSchema, CodexStageRuntimeProfileReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.7 Codex runtime gap report', () => {
  test('computes wall-clock gaps from existing benchmark/profile/run manifests without mutating Story State', async () => {
    const tempRoot = await createTempRoot('novel-loop-m277-runtime-gap-');
    try {
      const store = new FileStore();
      const projectId = 'codex-runtime-gap';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build` }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan` }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      await writeBenchmark(paths, store);
      await writeProfile(paths, store);
      await writeRun(paths, store, {
        runId: 'run_ch2_gap',
        command: 'chapter codex preview',
        chapterNumber: 2,
        durationMs: 507_235,
        promptMs: 210_000,
        localMs: 10_000,
        stage: 'chapter_mission'
      });
      await writeRun(paths, store, {
        runId: 'run_ch3_gap',
        command: 'chapter codex preview',
        chapterNumber: 3,
        durationMs: 400_767,
        promptMs: 250_000,
        localMs: 5_000,
        stage: 'canon_patch_proposal'
      });
      const storyStateBefore = await store.readText(paths.storyState());

      const result = await generateCodexRuntimeGapReport({ projectId, projectsRoot: tempRoot }, store);

      expect(result.report).toMatchObject({
        reportId: 'codex_runtime_gap_report_v1',
        projectId,
        sourceBenchmarkPath: 'audit/codex_runtime_benchmark_report_v1.json',
        sourceProfilePath: 'audit/codex_stage_runtime_profile_v1.json',
        totalWallClockMs: 1_603_330,
        totalUnattributedGapMs: expect.any(Number),
        storyStateMutated: false
      });
      expect(CodexRuntimeGapReportSchema.parse(result.report)).toMatchObject({ reportId: result.report.reportId });
      expect(result.report.gapByChapter).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            chapterNumber: 2,
            wallClockMs: 507_235,
            promptCallMs: 210_000,
            localStageMs: 10_000,
            unattributedGapMs: 287_235,
            largestGapRunIds: ['run_ch2_gap'],
            largestGapStages: ['chapter_mission']
          })
        ])
      );
      expect(result.report.gapByRun[0]).toMatchObject({
        runId: 'run_ch2_gap',
        wallClockMs: 507_235,
        promptCallMs: 210_000,
        localStageMs: 10_000,
        eventDurationMs: 507_235,
        unattributedGapMs: 287_235,
        suspectedSource: 'event_timing_missing'
      });
      expect(result.report.gapByStage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ chapterNumber: 2, stage: 'chapter_mission', unattributedGapMs: 287_235 })
        ])
      );
      expect(result.report.suspectedGapSources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ suspectedSource: 'event_timing_missing', evidence: expect.arrayContaining(['gapMs=287235']) })
        ])
      );
      expect(result.report.recommendations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ recommendedAction: 'fix_observability_before_prompt_compression' })
        ])
      );
      expect(await store.readText(paths.storyState())).toBe(storyStateBefore);
      await expect(store.readJson(paths.auditArtifact('codex_runtime_gap_report_v1.json'), CodexRuntimeGapReportSchema)).resolves.toMatchObject({
        storyStateMutated: false
      });

      const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
      expect(audit.ok).toBe(true);
      expect(audit.report.issues.filter((issue) => issue.category === 'codex_runtime_gap')).toHaveLength(0);
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
        benchmarkStage('chapter2', 'chapter-002-preview', 507_235, 2, 'run_ch2_gap'),
        benchmarkStage('chapter3', 'chapter-003-preview', 400_767, 3, 'run_ch3_gap')
      ],
      profileComparisons: []
    },
    CodexRuntimeBenchmarkReportSchema
  );
}

function benchmarkStage(level: 'chapter2' | 'chapter3', stageName: string, durationMs: number, chapterNumber: number, runId: string) {
  return {
    level,
    stageName,
    command: `chapter ${chapterNumber}`,
    runId,
    status: 'success',
    startedAt: '2026-07-07T00:00:00.000Z',
    endedAt: '2026-07-07T00:01:00.000Z',
    durationMs,
    codexCallCount: 1,
    retryCount: 0,
    repairCount: 0,
    timeoutCount: 0,
    promptInputBytes: 10_000,
    contextBytes: 9_000,
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
      totalDurationMs: 475_000,
      durationByChapter: { chapter_002: 220_000, chapter_003: 255_000 },
      durationByStage: { chapter_mission: 210_000, canon_patch_proposal: 250_000, confirm_apply: 15_000 },
      codexCallsByStage: { chapter_mission: 1, canon_patch_proposal: 1 },
      retriesByStage: {},
      repairsByStage: {},
      timeoutByStage: {},
      promptBytesByStage: {},
      outputBytesByStage: {},
      schemaBytesByStage: {},
      profiledPromptCallCount: 2,
      slowestPromptCalls: [
        profileCall('prompt_ch2_mission', 'run_ch2_gap', 2, 'planning.plan_chapter_mission_slim', 'chapter_mission', 210_000),
        profileCall('prompt_ch3_patch', 'run_ch3_gap', 3, 'memory.extract_canon_patch_proposal_slim', 'canon_patch_proposal', 250_000)
      ],
      promptCallsByPromptId: { 'planning.plan_chapter_mission_slim': 1, 'memory.extract_canon_patch_proposal_slim': 1 },
      promptCallsByStage: { chapter_mission: 1, canon_patch_proposal: 1 },
      promptCallsByRun: { run_ch2_gap: 1, run_ch3_gap: 1 },
      promptCallsByChapter: { chapter_002: 1, chapter_003: 1 },
      largestPromptInputs: [],
      largestSchemas: [],
      largestOutputs: [],
      repairCalls: [],
      retryCalls: [],
      unclassifiedCalls: [],
      remainingUnclassifiedCount: 0,
      otherCodexBreakdown: { totalCalls: 0, totalDurationMs: 0, byPromptId: [], byRunId: [], byCommand: [], byArtifactType: [], likelyCategories: [], reasonCategories: [] },
      rawRuntimeView: { totalPromptCallCount: 2, totalDurationMs: 460_000, byStage: { chapter_mission: 210_000, canon_patch_proposal: 250_000 }, includesWrapperCalls: true },
      businessRuntimeView: { totalBusinessCallCount: 2, totalDurationMs: 460_000, byBusinessStage: { chapter_mission: 210_000, canon_patch_proposal: 250_000 }, byPromptId: { 'planning.plan_chapter_mission_slim': 210_000, 'memory.extract_canon_patch_proposal_slim': 250_000 }, wrapperCallsRolledUp: true, doubleCountingRemoved: true },
      overheadRuntimeView: { wrapperCallCount: 0, wrapperDurationMs: 0, healthSmokeDurationMs: 0, jsonRepairDurationMs: 0, redactionDurationMs: 0, artifactWriteDurationMs: 0, unclassifiedOverheadMs: 0 },
      wrapperBreakdown: { totalWrapperCalls: 0, totalWrapperDurationMs: 0, orphanWrapperCallCount: 0, byWrapperType: [], byParentStage: [], byParentPromptId: [], orphanWrapperCalls: [], inferredWrapperCalls: [] },
      slowestBusinessPromptCalls: [],
      slowestRuns: [],
      durationByCommand: {},
      durationByPromptId: {},
      durationByPromptFamily: {},
      durationByChapterStage: { 'chapter_002.chapter_mission': 210_000, 'chapter_003.canon_patch_proposal': 250_000 },
      slowestStages: [{ stage: 'canon_patch_proposal', durationMs: 250_000, codexCallCount: 1 }],
      optimizationCandidates: [],
      storyStateMutated: false
    },
    CodexStageRuntimeProfileReportSchema
  );
}

function profileCall(promptCallId: string, runId: string, chapterNumber: number, promptId: string, stage: string, durationMs: number) {
  return {
    promptCallId,
    runId,
    command: `chapter ${chapterNumber}`,
    status: 'succeeded',
    chapterNumber,
    promptId,
    promptFamily: promptId.split('.')[0],
    inferredStage: stage,
    likelyCategory: 'chapter_planning_subtask',
    classified: true,
    durationMs,
    latencyMs: durationMs,
    promptInputBytes: 10_000,
    contextBytes: 9_000,
    schemaBytes: 1_000,
    outputBytes: 2_000,
    rawJsonlBytes: 3_000,
    retryCount: 0,
    repairCount: 0,
    jsonParsed: true,
    schemaValid: true,
    artifactPaths: [],
    attributionMode: 'direct',
    attributionConfidence: 'high',
    attributionReason: 'fixture direct call',
    suggestedOptimization: 'fixture'
  };
}

async function writeRun(
  paths: ProjectPaths,
  store: FileStore,
  input: { runId: string; command: string; chapterNumber: number; durationMs: number; promptMs: number; localMs: number; stage: string }
): Promise<void> {
  const startedAt = '2026-07-07T00:00:00.000Z';
  const endedAt = new Date(Date.parse(startedAt) + input.durationMs).toISOString();
  await store.ensureDir(paths.runDir(input.runId));
  await store.writeJson(
    paths.runManifest(input.runId),
    {
      schemaVersion: '2',
      runId: input.runId,
      projectId: paths.projectId,
      command: input.command,
      args: {},
      argv: input.command.split(' '),
      cwd: paths.projectsRoot,
      startedAt,
      endedAt,
      durationMs: input.durationMs,
      status: 'success',
      packageVersion: '2.5.0-rc.1',
      nodeVersion: process.version,
      provider: 'codex-text',
      redactionPolicy: { savePromptInputs: false, savePromptOutputs: true, redactSecrets: true, redactUserContent: false, redactedFields: [] },
      resolvedContext: { projectId: paths.projectId, chapterNumber: input.chapterNumber, resolvedChapterNumber: input.chapterNumber, mode: 'codex' },
      stages: [{ stage: input.stage, name: input.stage, status: 'completed', startedAt, endedAt, durationMs: input.localMs, chapterNumber: input.chapterNumber }],
      promptCalls: [
        {
          promptCallId: `prompt_${input.runId}`,
          promptId: input.stage === 'chapter_mission' ? 'planning.plan_chapter_mission_slim' : 'memory.extract_canon_patch_proposal_slim',
          provider: 'codex-text',
          model: 'codex-cli',
          status: 'succeeded',
          startedAt,
          endedAt,
          latencyMs: input.promptMs,
          promptInputBytes: 10_000,
          contextBytes: 9_000,
          schemaBytes: 1_000,
          outputBytes: 2_000,
          rawJsonlBytes: 3_000,
          redacted: true,
          jsonParsed: true,
          schemaValid: true,
          retryCount: 0
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
  await store.writeText(
    paths.runEvents(input.runId),
    `${JSON.stringify({
      eventId: `${input.runId}_event_001`,
      runId: input.runId,
      projectId: paths.projectId,
      timestamp: endedAt,
      eventType: 'RUN_COMPLETED',
      payload: { source: 'm27_7_runtime_gap_fixture' },
      relatedArtifactPaths: [],
      severity: 'info'
    })}\n`
  );
}
