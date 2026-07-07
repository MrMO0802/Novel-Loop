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

describe('M27.3 Codex wrapper attribution and net business runtime', () => {
  test('rolls explicit child wrapper calls into parent business calls without double counting business time', async () => {
    const tempRoot = await createTempRoot('novel-loop-m273-wrapper-direct-');
    try {
      const { paths, store } = await prepareProject(tempRoot, 'codex-wrapper-direct');
      const storyStateBefore = await store.readText(paths.storyState());

      await writeArtifacts(paths, store, 'run_parent_direct', ['parent_final.md']);
      await writeArtifacts(paths, store, 'run_child_direct', ['raw_output.jsonl', 'final_output.md']);
      await writeManifest(paths, store, {
        runId: 'run_parent_direct',
        command: 'chapter --provider codex-text',
        chapterNumber: 2,
        promptCalls: [
          promptCall('parent_write_scene', 'production.write_scene', 120_000, {
            requestId: 'run_child_direct',
            finalOutputPath: 'codex/runs/run_parent_direct/parent_final.md',
            promptInputBytes: 32_000,
            contextBytes: 28_000,
            outputBytes: 9_000
          })
        ]
      });
      await writeManifest(paths, store, {
        runId: 'run_child_direct',
        command: 'codex',
        chapterNumber: 2,
        promptCalls: [
          promptCall('child_exec_text', 'codex.exec-text', 120_000, {
            provider: 'codex-cli',
            rawOutputPath: 'codex/runs/run_child_direct/raw_output.jsonl',
            finalOutputPath: 'codex/runs/run_child_direct/final_output.md',
            promptInputBytes: 34_000,
            outputBytes: 9_100,
            parentPromptCallId: 'parent_write_scene',
            parentPromptId: 'production.write_scene',
            parentStage: 'write_scene',
            parentRunId: 'run_parent_direct',
            wrapperCallType: 'exec_text',
            attributionMode: 'parent_child',
            attributionConfidence: 'high',
            attributionReason: 'child wrapper declared parentPromptCallId'
          })
        ]
      });

      const result = await profileCodexRuntime({ projectId: paths.projectId, projectsRoot: tempRoot }, store);
      const report = result.report;

      expect(report.rawRuntimeView).toMatchObject({
        totalPromptCallCount: 2,
        totalDurationMs: 240_000,
        includesWrapperCalls: true
      });
      expect(report.businessRuntimeView).toMatchObject({
        totalBusinessCallCount: 1,
        totalDurationMs: 120_000,
        wrapperCallsRolledUp: true,
        doubleCountingRemoved: true
      });
      expect(report.businessRuntimeView.byBusinessStage.write_scene).toBe(120_000);
      expect(report.businessRuntimeView.byPromptId['production.write_scene']).toBe(120_000);
      expect(report.overheadRuntimeView).toMatchObject({
        wrapperCallCount: 1,
        wrapperDurationMs: 120_000
      });
      expect(report.wrapperBreakdown).toMatchObject({
        totalWrapperCalls: 1,
        totalWrapperDurationMs: 120_000,
        orphanWrapperCallCount: 0
      });
      expect(report.wrapperBreakdown.byWrapperType).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: 'exec_text', totalCalls: 1, totalDurationMs: 120_000 })])
      );
      expect(report.wrapperBreakdown.byParentStage).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: 'write_scene', totalCalls: 1, totalDurationMs: 120_000 })])
      );
      expect(report.slowestBusinessPromptCalls[0]).toMatchObject({
        businessPromptCallId: 'parent_write_scene',
        promptId: 'production.write_scene',
        stage: 'write_scene',
        runId: 'run_parent_direct',
        chapterNumber: 2,
        netDurationMs: 120_000,
        wrapperDurationMs: 120_000,
        providerLatencyMs: 120_000,
        childWrapperCallIds: ['child_exec_text']
      });
      expect(report.slowestPromptCalls.map((call) => call.promptId)).toContain('codex.exec-text');
      expect(report.remainingUnclassifiedCount).toBe(0);
      expect(report.optimizationCandidates[0]).toMatchObject({
        promptId: 'production.write_scene',
        stage: 'write_scene'
      });
      const markdown = await store.readText(paths.projectArtifact(result.markdownPath));
      expect(markdown).toContain('Raw Runtime View');
      expect(markdown).toContain('Business Runtime View');
      expect(markdown).toContain('Overhead Runtime View');
      expect(markdown).toContain('Wrapper Calls Rolled Up');
      expect(markdown).toContain('Top 10 Slowest Business Prompt Calls');
      expect(markdown).toContain('optimization should use business view');
      expect(await store.readJson(paths.projectArtifact(result.reportPath), CodexStageRuntimeProfileReportSchema)).toMatchObject({
        reportId: 'codex_stage_runtime_profile_v1'
      });
      expect(await store.readText(paths.storyState())).toBe(storyStateBefore);

      const audit = await auditProject({ projectId: paths.projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
      expect(audit.ok).toBe(true);
      expect(audit.report.issues.filter((issue) => issue.category === 'codex_profiling')).toHaveLength(0);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);

  test('infers legacy wrapper parent from parent requestId and does not leave codex.exec-text in other_codex', async () => {
    const tempRoot = await createTempRoot('novel-loop-m273-wrapper-legacy-');
    try {
      const { paths, store } = await prepareProject(tempRoot, 'codex-wrapper-legacy');

      await writeArtifacts(paths, store, 'run_parent_legacy', ['global_outline.md']);
      await writeArtifacts(paths, store, 'run_child_legacy', ['raw_output.jsonl', 'final_output.md']);
      await writeManifest(paths, store, {
        runId: 'run_parent_legacy',
        command: 'plan-global --provider codex-text',
        promptCalls: [
          promptCall('parent_global_outline', 'planning.generate_global_outline_text', 47_000, {
            requestId: 'run_child_legacy',
            finalOutputPath: 'codex/runs/run_parent_legacy/global_outline.md',
            promptInputBytes: 11_000,
            outputBytes: 2_900
          })
        ]
      });
      await writeManifest(paths, store, {
        runId: 'run_child_legacy',
        command: 'codex',
        promptCalls: [
          promptCall('legacy_exec_text', 'codex.exec-text', 47_000, {
            provider: 'codex-cli',
            rawOutputPath: 'codex/runs/run_child_legacy/raw_output.jsonl',
            finalOutputPath: 'codex/runs/run_child_legacy/final_output.md',
            promptInputBytes: 11_200,
            outputBytes: 2_900
          })
        ]
      });

      const report = (await profileCodexRuntime({ projectId: paths.projectId, projectsRoot: tempRoot }, store)).report;

      expect(report.wrapperBreakdown.inferredWrapperCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            promptCallId: 'legacy_exec_text',
            parentPromptCallId: 'parent_global_outline',
            parentPromptId: 'planning.generate_global_outline_text',
            parentStage: 'plan_global_outline',
            attributionMode: 'inferred',
            attributionConfidence: 'high'
          })
        ])
      );
      expect(report.otherCodexBreakdown.byPromptId.map((item) => item.key)).not.toContain('codex.exec-text');
      expect(report.remainingUnclassifiedCount).toBe(0);
      expect(report.businessRuntimeView.totalDurationMs).toBe(47_000);
      expect(report.rawRuntimeView.totalDurationMs).toBe(94_000);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);

  test('reports orphan wrapper calls as non-blocking audit warnings', async () => {
    const tempRoot = await createTempRoot('novel-loop-m273-wrapper-orphan-');
    try {
      const { paths, store } = await prepareProject(tempRoot, 'codex-wrapper-orphan');
      await writeArtifacts(paths, store, 'run_orphan_child', ['raw_output.jsonl', 'final_output.md']);
      await writeManifest(paths, store, {
        runId: 'run_orphan_child',
        command: 'codex',
        promptCalls: [
          promptCall('orphan_exec_text', 'codex.exec-text', 31_000, {
            provider: 'codex-cli',
            rawOutputPath: 'codex/runs/run_orphan_child/raw_output.jsonl',
            finalOutputPath: 'codex/runs/run_orphan_child/final_output.md',
            promptInputBytes: 4_000,
            outputBytes: 1_200
          })
        ]
      });

      const result = await profileCodexRuntime({ projectId: paths.projectId, projectsRoot: tempRoot }, store);
      expect(result.report.wrapperBreakdown.orphanWrapperCallCount).toBe(1);
      expect(result.report.wrapperBreakdown.orphanWrapperCalls[0]).toMatchObject({
        promptCallId: 'orphan_exec_text',
        wrapperCallType: 'exec_text',
        attributionMode: 'unclassified',
        attributionConfidence: 'low'
      });
      expect(result.report.otherCodexBreakdown.reasonCategories).toEqual(
        expect.arrayContaining([expect.objectContaining({ category: 'wrapper_orphan', totalCalls: 1, totalDurationMs: 31_000 })])
      );

      const audit = await auditProject({ projectId: paths.projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
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

  test('audit blocks wrapper calls that declare a missing parentPromptCallId', async () => {
    const tempRoot = await createTempRoot('novel-loop-m273-wrapper-bad-parent-');
    try {
      const { paths, store } = await prepareProject(tempRoot, 'codex-wrapper-bad-parent');
      await writeArtifacts(paths, store, 'run_bad_parent_child', ['raw_output.jsonl', 'final_output.md']);
      await writeManifest(paths, store, {
        runId: 'run_bad_parent_child',
        command: 'codex',
        promptCalls: [
          promptCall('bad_parent_exec_text', 'codex.exec-text', 21_000, {
            provider: 'codex-cli',
            rawOutputPath: 'codex/runs/run_bad_parent_child/raw_output.jsonl',
            finalOutputPath: 'codex/runs/run_bad_parent_child/final_output.md',
            parentPromptCallId: 'missing_parent_call',
            parentPromptId: 'production.write_scene',
            parentStage: 'write_scene',
            parentRunId: 'run_missing_parent',
            wrapperCallType: 'exec_text',
            attributionMode: 'parent_child',
            attributionConfidence: 'high',
            attributionReason: 'fixture declares missing parent'
          })
        ]
      });

      const result = await profileCodexRuntime({ projectId: paths.projectId, projectsRoot: tempRoot }, store);
      const audit = await auditProject({ projectId: paths.projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);

      expect(result.report.wrapperBreakdown.orphanWrapperCallCount).toBe(1);
      expect(audit.ok).toBe(false);
      expect(audit.exitCode).toBe(2);
      expect(audit.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'error',
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

async function prepareProject(tempRoot: string, projectId: string): Promise<{ paths: ProjectPaths; store: FileStore }> {
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build_bible` }, store);
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan_global` }, store);
  return { paths: new ProjectPaths(tempRoot, projectId), store };
}

async function writeArtifacts(paths: ProjectPaths, store: FileStore, runId: string, fileNames: string[]): Promise<void> {
  for (const fileName of fileNames) {
    await store.writeText(paths.projectArtifact(`codex/runs/${runId}/${fileName}`), `${runId}/${fileName}\n`);
  }
}

async function writeManifest(
  paths: ProjectPaths,
  store: FileStore,
  input: {
    runId: string;
    command: string;
    chapterNumber?: number;
    promptCalls: ReturnType<typeof promptCall>[];
  }
): Promise<void> {
  const startedAt = '2026-07-06T00:00:00.000Z';
  const endedAt = '2026-07-06T00:01:00.000Z';
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
      durationMs: input.promptCalls.reduce((sum, call) => sum + call.latencyMs, 0),
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
      stages: [],
      promptCalls: input.promptCalls,
      llmCalls: input.promptCalls,
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
      payload: { source: 'm27_3_wrapper_fixture' },
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
    provider?: string;
    requestId?: string;
    promptInputBytes?: number;
    contextBytes?: number;
    schemaBytes?: number;
    outputBytes?: number;
    rawOutputPath?: string;
    finalOutputPath?: string;
    parsedOutputPath?: string;
    parentPromptCallId?: string;
    parentPromptId?: string;
    parentStage?: string;
    parentRunId?: string;
    wrapperCallType?: 'exec_text' | 'exec_json' | 'health' | 'smoke' | 'repair' | 'unknown';
    attributionMode?: 'direct' | 'parent_child' | 'inferred' | 'unclassified';
    attributionConfidence?: 'high' | 'medium' | 'low';
    attributionReason?: string;
  }
) {
  return {
    promptCallId,
    promptId,
    provider: options.provider ?? 'codex-text',
    model: options.provider === 'codex-cli' ? 'local-codex-cli' : 'codex-cli',
    transport: 'cli',
    codexProfile: 'clean',
    sandbox: 'read-only',
    status: 'succeeded',
    startedAt: '2026-07-06T00:00:00.000Z',
    endedAt: '2026-07-06T00:00:01.000Z',
    latencyMs,
    promptInputBytes: options.promptInputBytes ?? 1_000,
    contextBytes: options.contextBytes ?? options.promptInputBytes ?? 1_000,
    schemaBytes: options.schemaBytes ?? 0,
    outputBytes: options.outputBytes ?? 500,
    rawJsonlBytes: options.rawOutputPath === undefined ? 0 : 700,
    retryCount: 0,
    redacted: true,
    jsonParsed: false,
    schemaValid: false,
    ...options
  };
}
