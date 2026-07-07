import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { profileCodexRuntime } from '../../src/app/codexRuntimeProfiler.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.5 Codex attribution cleanup', () => {
  test('classifies standalone exec-json smoke calls without orphan wrapper warnings', async () => {
    const tempRoot = await createTempRoot('novel-loop-m275-attr-exec-json-');
    try {
      const store = new FileStore();
      const projectId = 'codex-attr-exec-json';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_attr_build' }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      const stateBefore = await store.readText(paths.storyState());
      await writeCodexExecJsonSmokeRun(paths, store);

      const profile = await profileCodexRuntime({ projectId, projectsRoot: tempRoot }, store);

      expect(profile.report.promptCallsByStage.exec_json_smoke).toBe(1);
      expect(profile.report.wrapperBreakdown.orphanWrapperCallCount).toBe(0);
      expect(profile.report.wrapperBreakdown.orphanWrapperCalls).toHaveLength(0);
      expect(profile.report.remainingUnclassifiedCount).toBe(0);
      expect(profile.report.otherCodexBreakdown.totalCalls).toBe(0);
      expect(await store.readText(paths.storyState())).toBe(stateBefore);
    } finally {
      await removeTempRoot(tempRoot);
    }
  });

  test('plan-global codex-text writes validation summary through local deterministic assembly', async () => {
    const tempRoot = await createTempRoot('novel-loop-m275-attr-planning-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const projectId = 'codex-attr-planning';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_attr_planning_build' }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      const stateBefore = await store.readText(paths.storyState());

      const result = await planGlobal(
        {
          projectId,
          projectsRoot: tempRoot,
          provider: 'codex-text',
          promptRoot,
          codexBin: fake.codexBin,
          codexProfile: 'clean',
          runId: 'run_attr_plan_global'
        },
        store
      );

      const manifest = await store.readJson(paths.runManifest(result.runId), RunManifestV2Schema);
      expect(manifest.promptCalls.map((call) => call.promptId)).not.toContain('planning.validate_and_assemble');
      expect(await store.readText(paths.planningArtifact('validation_summary.md'))).toContain('Local planning assembly');
      const profile = await profileCodexRuntime({ projectId, projectsRoot: tempRoot }, store);
      expect(profile.report.remainingUnclassifiedCount).toBe(0);
      expect(profile.report.businessRuntimeView.byPromptId['planning.validate_and_assemble']).toBeUndefined();
      expect(await store.readText(paths.storyState())).toBe(stateBefore);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});

async function writeCodexExecJsonSmokeRun(paths: ProjectPaths, store: FileStore): Promise<void> {
  await store.writeText(paths.projectArtifact('codex/runs/run_exec_json/raw_output.jsonl'), '{"type":"turn.completed"}\n');
  await store.writeText(paths.projectArtifact('codex/runs/run_exec_json/final_output.json'), '{"ok":true}\n');
  await store.writeText(paths.projectArtifact('codex/runs/run_exec_json/parsed_output.json'), '{"ok":true}\n');
  await store.ensureDir(paths.runDir('run_exec_json'));
  await store.writeJson(
    paths.runManifest('run_exec_json'),
    {
      schemaVersion: '2',
      runId: 'run_exec_json',
      projectId: paths.projectId,
      command: 'codex exec-json --output-schema examples/codex_output.schema.json',
      args: {},
      argv: ['codex', 'exec-json', '--output-schema'],
      cwd: paths.projectsRoot,
      startedAt: '2026-07-07T00:00:00.000Z',
      endedAt: '2026-07-07T00:00:01.000Z',
      durationMs: 1_000,
      status: 'success',
      packageVersion: '2.5.0-rc.1',
      nodeVersion: process.version,
      provider: 'codex-cli',
      redactionPolicy: {
        savePromptInputs: false,
        savePromptOutputs: true,
        redactSecrets: true,
        redactUserContent: false,
        redactedFields: []
      },
      resolvedContext: {
        projectId: paths.projectId,
        mode: 'codex'
      },
      stages: [],
      promptCalls: [
        {
          promptCallId: 'call_exec_json_smoke',
          promptId: 'codex.exec-json',
          provider: 'codex-cli',
          model: 'local-codex-cli',
          transport: 'cli',
          codexProfile: 'clean',
          sandbox: 'read-only',
          status: 'succeeded',
          startedAt: '2026-07-07T00:00:00.000Z',
          endedAt: '2026-07-07T00:00:01.000Z',
          latencyMs: 9_000,
          promptInputBytes: 512,
          contextBytes: 128,
          schemaBytes: 256,
          outputBytes: 80,
          rawJsonlBytes: 120,
          retryCount: 0,
          redacted: true,
          jsonParsed: true,
          schemaValid: true,
          rawOutputPath: 'codex/runs/run_exec_json/raw_output.jsonl',
          finalOutputPath: 'codex/runs/run_exec_json/final_output.json',
          parsedOutputPath: 'codex/runs/run_exec_json/parsed_output.json'
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
      summary: {
        generatedArtifactCount: 0,
        reusedArtifactCount: 0,
        archivedArtifactCount: 0,
        promptCallCount: 1,
        queueTransitionCount: 0,
        stateMutationCount: 0,
        snapshotCount: 0,
        errorCount: 0
      }
    },
    RunManifestV2Schema
  );
}
