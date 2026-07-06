import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { profileCodexRuntime } from '../../src/app/codexRuntimeProfiler.js';
import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { CodexStageRuntimeProfileReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27 codex stage runtime profiler', () => {
  test('aggregates benchmark/run manifest metrics without invoking Codex', async () => {
    const tempRoot = await createTempRoot('novel-loop-m27-profile-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      await runCodexRuntimeBenchmark(
        {
          projectId: 'codex-profile',
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'plan',
          codexProfile: 'clean',
          codexStageTimeoutMs: 5_000
        },
        store
      );

      const result = await profileCodexRuntime({ projectId: 'codex-profile', projectsRoot: tempRoot }, store);

      expect(result.report.totalDurationMs).toBeGreaterThan(0);
      expect(result.report.durationByStage.build_bible).toBeGreaterThanOrEqual(0);
      expect(result.report.durationByStage.plan_global_outline).toBeGreaterThanOrEqual(0);
      expect(result.report.codexCallsByStage.build_bible).toBeGreaterThanOrEqual(0);
      expect(result.report.slowestStages.length).toBeGreaterThan(0);
      expect(result.report.optimizationCandidates.length).toBeGreaterThan(0);

      const paths = new ProjectPaths(tempRoot, 'codex-profile');
      await expect(store.readJson(paths.auditArtifact('codex_stage_runtime_profile_v1.json'), CodexStageRuntimeProfileReportSchema)).resolves.toMatchObject({
        projectId: 'codex-profile'
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);

  test('profiles prompt calls plus local stage durations without mutating Story State', async () => {
    const tempRoot = await createTempRoot('novel-loop-m27-profile-manifest-');
    try {
      const projectId = 'codex-profile-manifest';
      const store = new FileStore();
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_profile_build_bible' }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_profile_plan_global' }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      const storyStateBefore = await store.readText(paths.storyState());

      await writeSyntheticRunManifest(paths, store);

      const result = await profileCodexRuntime({ projectId, projectsRoot: tempRoot }, store);

      expect(result.report.durationByStage.write_scene).toBe(120_000);
      expect(result.report.durationByStage.diagnostics).toBe(40_000);
      expect(result.report.durationByStage.scene_cards).toBe(55_000);
      expect(result.report.durationByStage.canon_patch_proposal).toBe(30_000);
      expect(result.report.durationByStage.state_diff).toBe(2_500);
      expect(result.report.durationByStage.confirm_apply).toBe(7_000);
      expect(result.report.durationByStage.other_codex).toBe(9_000);
      expect(result.report.durationByChapter.chapter_002).toBe(263_500);
      expect(result.report.totalDurationMs).toBe(263_500);
      expect(result.report.slowestStages[0]).toMatchObject({ stage: 'write_scene', durationMs: 120_000 });
      expect(result.report.optimizationCandidates[0]).toMatchObject({ stage: 'write_scene', estimatedImpact: 'high' });
      expect(await store.readText(paths.storyState())).toBe(storyStateBefore);

      const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
      expect(audit.ok).toBe(true);
      expect(audit.report.issues.filter((issue) => issue.category === 'codex_stage_profile')).toHaveLength(0);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});

async function writeSyntheticRunManifest(paths: ProjectPaths, store: FileStore): Promise<void> {
  const startedAt = '2026-07-06T00:00:00.000Z';
  const endedAt = '2026-07-06T00:04:14.500Z';
  const runId = 'run_m27_profile_manifest';
  await store.ensureDir(paths.runDir(runId));
  await store.writeJson(
    paths.runManifest(runId),
    {
      schemaVersion: '2',
      runId,
      projectId: paths.projectId,
      command: 'codex profile fixture',
      args: {},
      argv: ['codex', 'profile', 'fixture'],
      cwd: paths.projectsRoot,
      startedAt,
      endedAt,
      durationMs: 254_500,
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
        chapterNumber: 2,
        resolvedChapterNumber: 2,
        mode: 'codex',
        latestCommittedChapterBefore: 1,
        latestCommittedChapterAfter: 2
      },
      stages: [
        { stage: 'state_diff', name: 'state_diff', status: 'completed', startedAt, endedAt, durationMs: 2_500, chapterNumber: 2 },
        { stage: 'confirm_apply', name: 'confirm_apply', status: 'completed', startedAt, endedAt, durationMs: 7_000, chapterNumber: 2 }
      ],
      promptCalls: [
        promptCall('production.write_scene', 120_000, { promptInputBytes: 32_000, outputBytes: 9_000 }),
        promptCall('diagnostics.diagnose_chapter', 40_000, { retryCount: 2, finishReason: 'repaired', promptInputBytes: 12_000, outputBytes: 3_500 }),
        promptCall('planning.generate_scene_cards', 55_000, { promptInputBytes: 14_000, outputBytes: 4_200, schemaBytes: 2_000 }),
        promptCall('memory.extract_canon_patch_proposal_slim', 30_000, { promptInputBytes: 10_000, outputBytes: 2_200, schemaBytes: 2_500 }),
        promptCall('codex.health_check', 9_000, { promptInputBytes: 1_000, outputBytes: 500 })
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
      summary: {
        generatedArtifactCount: 0,
        reusedArtifactCount: 0,
        archivedArtifactCount: 0,
        promptCallCount: 5,
        queueTransitionCount: 0,
        stateMutationCount: 0,
        snapshotCount: 0,
        errorCount: 0
      }
    },
    RunManifestV2Schema
  );
  await store.writeText(
    paths.runEvents(runId),
    `${JSON.stringify({
      eventId: 'event_001',
      runId,
      projectId: paths.projectId,
      timestamp: endedAt,
      eventType: 'RUN_COMPLETED',
      payload: { source: 'm27_profiler_fixture' },
      relatedArtifactPaths: [],
      severity: 'info'
    })}\n`
  );
}

function promptCall(
  promptId: string,
  latencyMs: number,
  options: { promptInputBytes?: number; outputBytes?: number; schemaBytes?: number; retryCount?: number; finishReason?: string }
) {
  const startedAt = '2026-07-06T00:00:00.000Z';
  const endedAt = '2026-07-06T00:00:01.000Z';
  return {
    promptId,
    provider: 'codex-text',
    model: 'codex-cli',
    transport: 'cli',
    codexProfile: 'clean',
    sandbox: 'read-only',
    status: 'succeeded',
    startedAt,
    endedAt,
    latencyMs,
    redacted: true,
    jsonParsed: promptId !== 'production.write_scene',
    schemaValid: promptId !== 'production.write_scene',
    retryCount: options.retryCount ?? 0,
    ...(options.finishReason === undefined ? {} : { finishReason: options.finishReason }),
    ...(options.promptInputBytes === undefined ? {} : { promptInputBytes: options.promptInputBytes }),
    ...(options.outputBytes === undefined ? {} : { outputBytes: options.outputBytes }),
    ...(options.schemaBytes === undefined ? {} : { schemaBytes: options.schemaBytes })
  };
}
