import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { profileCodexRuntime } from '../../src/app/codexRuntimeProfiler.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { CodexStageRuntimeProfileReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.2 Codex call-level runtime profile', () => {
  test('attributes every Codex call and breaks down other_codex without mutating Story State', async () => {
    const tempRoot = await createTempRoot('novel-loop-m272-call-profile-');
    try {
      const projectId = 'codex-call-profile';
      const store = new FileStore();
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_call_profile_build' }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_call_profile_plan' }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      const storyStateBefore = await store.readText(paths.storyState());

      await writeRuntimeRuns(paths, store);

      const result = await profileCodexRuntime({ projectId, projectsRoot: tempRoot }, store);
      const report = result.report;

      expect(report.slowestPromptCalls[0]).toMatchObject({
        promptCallId: 'call_write_scene',
        runId: 'run_call_profile_ch2',
        chapterNumber: 2,
        promptId: 'production.write_scene',
        inferredStage: 'write_scene',
        durationMs: 120_000,
        promptInputBytes: 32_000,
        finalOutputPath: 'codex/runs/run_call_profile_ch2/write_scene_final.md'
      });
      expect(report.largestPromptInputs[0].promptCallId).toBe('call_write_scene');
      expect(report.largestSchemas[0]).toMatchObject({ promptCallId: 'call_scene_cards', schemaBytes: 2_000 });
      expect(report.largestOutputs[0]).toMatchObject({ promptCallId: 'call_write_scene', outputBytes: 9_000 });
      expect(report.repairCalls.map((call) => call.promptCallId)).toContain('call_repair_json');
      expect(report.retryCalls.map((call) => call.promptCallId)).toContain('call_repair_json');
      expect(report.unclassifiedCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            promptCallId: 'call_unknown',
            promptId: 'mystery.expensive_call',
            inferredStage: 'other_codex'
          })
        ])
      );
      expect(report.remainingUnclassifiedCount).toBe(1);
      expect(report.otherCodexBreakdown).toMatchObject({
        totalCalls: 1,
        totalDurationMs: 9_000
      });
      expect(report.otherCodexBreakdown.likelyCategories).toEqual(
        expect.arrayContaining([expect.objectContaining({ category: 'unknown', totalCalls: 1, totalDurationMs: 9_000 })])
      );
      expect(report.promptCallsByPromptId['production.write_scene']).toBe(1);
      expect(report.promptCallsByStage.write_scene).toBe(1);
      expect(report.promptCallsByStage.json_repair).toBe(1);
      expect(report.promptCallsByStage.other_codex).toBe(1);
      expect(report.promptCallsByRun.run_call_profile_ch2).toBe(4);
      expect(report.promptCallsByChapter.chapter_002).toBe(4);
      expect(report.durationByCommand['codex benchmark --level draft']).toBe(218_500);
      expect(report.durationByPromptId['production.write_scene']).toBe(120_000);
      expect(report.durationByPromptFamily.production).toBe(120_000);
      expect(report.durationByChapterStage['chapter_002.write_scene']).toBe(120_000);
      expect(report.slowestRuns[0]).toMatchObject({
        runId: 'run_call_profile_ch2',
        command: 'codex benchmark --level draft',
        chapterNumber: 2,
        durationMs: 218_500,
        codexCallCount: 4,
        slowestPromptCallId: 'call_write_scene',
        artifactCount: 1,
        stateMutationApplied: false
      });
      expect(report.optimizationCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            promptId: 'production.write_scene',
            stage: 'write_scene',
            suggestedAction: 'reduce_context',
            riskLevel: 'low',
            safetyImpact: 'no_state_mutation'
          }),
          expect.objectContaining({
            promptId: 'mystery.expensive_call',
            stage: 'other_codex',
            suggestedAction: 'improve_mapping'
          })
        ])
      );
      expect(await store.readJson(paths.projectArtifact(result.reportPath), CodexStageRuntimeProfileReportSchema)).toMatchObject({
        reportId: 'codex_stage_runtime_profile_v1'
      });
      const markdown = await store.readText(paths.projectArtifact(result.markdownPath));
      expect(markdown).toContain('Top 10 slowest prompt calls');
      expect(markdown).toContain('Duration by promptId');
      expect(markdown).toContain('other_codex breakdown');
      expect(await store.readText(paths.storyState())).toBe(storyStateBefore);

      const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
      expect(audit.ok).toBe(true);
      expect(audit.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'warning',
            category: 'codex_profiling',
            path: result.reportPath
          })
        ])
      );
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});

async function writeRuntimeRuns(paths: ProjectPaths, store: FileStore): Promise<void> {
  await writePromptArtifacts(paths, store, 'run_call_profile_ch2', [
    'write_scene_raw.jsonl',
    'write_scene_final.md',
    'scene_cards_raw.jsonl',
    'scene_cards_final.json',
    'scene_cards_parsed.json',
    'repair_raw.jsonl',
    'repair_final.json',
    'repair_parsed.json',
    'unknown_raw.jsonl',
    'unknown_final.txt'
  ]);
  await writeRunManifest(paths, store, {
    runId: 'run_call_profile_ch2',
    command: 'codex benchmark --level draft',
    chapterNumber: 2,
    durationMs: 218_500,
    promptCalls: [
      promptCall('call_write_scene', 'production.write_scene', 120_000, {
        promptInputBytes: 32_000,
        contextBytes: 28_000,
        outputBytes: 9_000,
        rawJsonlBytes: 11_000,
        rawOutputPath: 'codex/runs/run_call_profile_ch2/write_scene_raw.jsonl',
        finalOutputPath: 'codex/runs/run_call_profile_ch2/write_scene_final.md'
      }),
      promptCall('call_scene_cards', 'planning.generate_scene_cards_slim', 55_000, {
        promptInputBytes: 14_000,
        contextBytes: 10_000,
        schemaBytes: 2_000,
        outputBytes: 4_200,
        rawJsonlBytes: 5_000,
        rawOutputPath: 'codex/runs/run_call_profile_ch2/scene_cards_raw.jsonl',
        finalOutputPath: 'codex/runs/run_call_profile_ch2/scene_cards_final.json',
        parsedOutputPath: 'codex/runs/run_call_profile_ch2/scene_cards_parsed.json'
      }),
      promptCall('call_repair_json', 'codex.repair_json', 25_000, {
        promptInputBytes: 9_000,
        contextBytes: 2_000,
        schemaBytes: 800,
        outputBytes: 1_600,
        rawJsonlBytes: 2_200,
        retryCount: 1,
        finishReason: 'repaired',
        rawOutputPath: 'codex/runs/run_call_profile_ch2/repair_raw.jsonl',
        finalOutputPath: 'codex/runs/run_call_profile_ch2/repair_final.json',
        parsedOutputPath: 'codex/runs/run_call_profile_ch2/repair_parsed.json'
      }),
      promptCall('call_unknown', 'mystery.expensive_call', 9_000, {
        promptInputBytes: 1_000,
        outputBytes: 500,
        rawJsonlBytes: 700,
        rawOutputPath: 'codex/runs/run_call_profile_ch2/unknown_raw.jsonl',
        finalOutputPath: 'codex/runs/run_call_profile_ch2/unknown_final.txt'
      })
    ],
    stageDurations: [
      { stage: 'state_diff', durationMs: 2_500 },
      { stage: 'confirm_apply', durationMs: 7_000 }
    ]
  });

  await writePromptArtifacts(paths, store, 'run_call_profile_bible', ['bible_raw.jsonl', 'bible_final.md']);
  await writeRunManifest(paths, store, {
    runId: 'run_call_profile_bible',
    command: 'codex benchmark --level bible',
    durationMs: 80_000,
    promptCalls: [
      promptCall('call_bible', 'strategy.build_bible', 80_000, {
        promptInputBytes: 18_000,
        outputBytes: 6_000,
        rawJsonlBytes: 7_000,
        rawOutputPath: 'codex/runs/run_call_profile_bible/bible_raw.jsonl',
        finalOutputPath: 'codex/runs/run_call_profile_bible/bible_final.md'
      })
    ],
    stageDurations: []
  });
}

async function writePromptArtifacts(paths: ProjectPaths, store: FileStore, runId: string, fileNames: string[]): Promise<void> {
  for (const fileName of fileNames) {
    await store.writeText(paths.projectArtifact(`codex/runs/${runId}/${fileName}`), `${runId}/${fileName}\n`);
  }
}

async function writeRunManifest(
  paths: ProjectPaths,
  store: FileStore,
  input: {
    runId: string;
    command: string;
    chapterNumber?: number;
    durationMs: number;
    promptCalls: ReturnType<typeof promptCall>[];
    stageDurations: Array<{ stage: string; durationMs: number }>;
  }
): Promise<void> {
  const startedAt = '2026-07-06T00:00:00.000Z';
  const endedAt = '2026-07-06T00:04:00.000Z';
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
      redactionPolicy: {
        savePromptInputs: false,
        savePromptOutputs: true,
        redactSecrets: true,
        redactUserContent: false,
        redactedFields: []
      },
      resolvedContext: {
        projectId: paths.projectId,
        ...(input.chapterNumber === undefined ? {} : { chapterNumber: input.chapterNumber, resolvedChapterNumber: input.chapterNumber }),
        mode: 'codex'
      },
      stages: input.stageDurations.map((stage) => ({
        stage: stage.stage,
        name: stage.stage,
        status: 'completed',
        startedAt,
        endedAt,
        durationMs: stage.durationMs,
        ...(input.chapterNumber === undefined ? {} : { chapterNumber: input.chapterNumber })
      })),
      promptCalls: input.promptCalls,
      llmCalls: [],
      artifacts: [
        {
          artifactId: `${input.runId}_artifact_001`,
          artifactType: 'codex_final_output',
          path: input.promptCalls[0]?.finalOutputPath ?? 'codex/runs/unknown/final.txt',
          phase: 'codex',
          action: 'generated',
          runId: input.runId,
          status: 'active'
        }
      ],
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
      summary: {
        generatedArtifactCount: 1,
        reusedArtifactCount: 0,
        archivedArtifactCount: 0,
        promptCallCount: input.promptCalls.length,
        queueTransitionCount: 0,
        stateMutationCount: 0,
        snapshotCount: 0,
        errorCount: 0
      }
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
      payload: { source: 'm27_2_call_profile_fixture' },
      relatedArtifactPaths: [],
      severity: 'info'
    })}\n`
  );
}

function promptCall(
  promptCallId: string,
  promptId: string,
  latencyMs: number,
  options: {
    promptInputBytes?: number;
    contextBytes?: number;
    schemaBytes?: number;
    outputBytes?: number;
    rawJsonlBytes?: number;
    retryCount?: number;
    finishReason?: string;
    rawOutputPath?: string;
    finalOutputPath?: string;
    parsedOutputPath?: string;
  }
) {
  return {
    promptCallId,
    promptId,
    provider: 'codex-text',
    model: 'codex-cli',
    transport: 'cli',
    codexProfile: 'clean',
    sandbox: 'read-only',
    status: 'succeeded',
    startedAt: '2026-07-06T00:00:00.000Z',
    endedAt: '2026-07-06T00:00:01.000Z',
    latencyMs,
    redacted: true,
    jsonParsed: promptId !== 'production.write_scene',
    schemaValid: promptId !== 'production.write_scene',
    retryCount: options.retryCount ?? 0,
    ...options
  };
}
