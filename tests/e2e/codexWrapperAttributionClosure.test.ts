import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { profileCodexRuntime } from '../../src/app/codexRuntimeProfiler.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { CodexStageRuntimeProfileReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.7 Codex wrapper attribution closure', () => {
  test('keeps low-confidence orphan wrappers as structured warnings with artifact paths and suggested fixes', async () => {
    const tempRoot = await createTempRoot('novel-loop-m277-wrapper-closure-');
    try {
      const store = new FileStore();
      const projectId = 'codex-wrapper-closure';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build` }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan` }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      await store.writeText(paths.projectArtifact('codex/runs/run_orphan_exec_text/raw_output.jsonl'), '{}\n');
      await store.writeText(paths.projectArtifact('codex/runs/run_orphan_exec_text/final_output.md'), 'final\n');
      await writeWrapperRun(paths, store);

      const result = await profileCodexRuntime({ projectId, projectsRoot: tempRoot }, store);

      expect(result.report.wrapperBreakdown.orphanWrapperCalls).toEqual([
        expect.objectContaining({
          promptCallId: 'orphan_exec_text',
          runId: 'run_orphan_exec_text',
          command: 'codex exec-text operator smoke',
          wrapperCallType: 'exec_text',
          rawOutputPath: 'codex/runs/run_orphan_exec_text/raw_output.jsonl',
          finalOutputPath: 'codex/runs/run_orphan_exec_text/final_output.md',
          artifactPath: 'codex/runs/run_orphan_exec_text/final_output.md',
          timestamp: '2026-07-07T00:00:00.000Z',
          structuredReason: 'standalone_operator_command',
          suggestedFix: expect.stringContaining('parentPromptCallId'),
          attributionConfidence: 'low'
        })
      ]);
      expect(result.report.wrapperBreakdown.orphanWrapperWarnings).toEqual([
        expect.objectContaining({
          runId: 'run_orphan_exec_text',
          promptCallId: 'orphan_exec_text',
          reason: 'standalone_operator_command',
          suggestedFix: expect.stringContaining('operator')
        })
      ]);
      expect(result.report.otherCodexBreakdown.reasonCategories).toEqual(
        expect.arrayContaining([expect.objectContaining({ category: 'standalone_operator_command', totalCalls: 1 })])
      );
      await expect(store.readJson(paths.projectArtifact(result.reportPath), CodexStageRuntimeProfileReportSchema)).resolves.toMatchObject({
        wrapperBreakdown: {
          orphanWrapperCallCount: 1
        }
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);

  test('classifies legacy exec-json boundary wrappers as smoke_or_health instead of wrapper_orphan', async () => {
    const tempRoot = await createTempRoot('novel-loop-m277-wrapper-exec-json-');
    try {
      const store = new FileStore();
      const projectId = 'codex-wrapper-exec-json';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build` }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan` }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      await store.writeText(paths.projectArtifact('codex/runs/run_legacy_exec_json/raw_output.jsonl'), '{}\n');
      await store.writeText(paths.projectArtifact('codex/runs/run_legacy_exec_json/final_output.json'), '{"ok":true}\n');
      await store.writeText(paths.projectArtifact('codex/runs/run_legacy_exec_json/parsed_output.json'), '{"ok":true}\n');
      await writeLegacyExecJsonRun(paths, store);

      const result = await profileCodexRuntime({ projectId, projectsRoot: tempRoot }, store);

      expect(result.report.wrapperBreakdown.orphanWrapperWarnings).toEqual([
        expect.objectContaining({
          promptCallId: 'legacy_exec_json',
          reason: 'smoke_or_health',
          suggestedFix: expect.stringContaining('smoke_or_health')
        })
      ]);
      expect(result.report.otherCodexBreakdown.reasonCategories).toEqual(
        expect.arrayContaining([expect.objectContaining({ category: 'smoke_or_health', totalCalls: 1 })])
      );
      expect(result.report.otherCodexBreakdown.reasonCategories).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ category: 'wrapper_orphan' })])
      );
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});

async function writeWrapperRun(paths: ProjectPaths, store: FileStore): Promise<void> {
  const runId = 'run_orphan_exec_text';
  await store.ensureDir(paths.runDir(runId));
  await store.writeJson(
    paths.runManifest(runId),
    {
      schemaVersion: '2',
      runId,
      projectId: paths.projectId,
      command: 'codex exec-text operator smoke',
      args: {},
      argv: ['codex', 'exec-text'],
      cwd: paths.projectsRoot,
      startedAt: '2026-07-07T00:00:00.000Z',
      endedAt: '2026-07-07T00:00:31.000Z',
      durationMs: 31_000,
      status: 'success',
      packageVersion: '2.5.0-rc.1',
      nodeVersion: process.version,
      provider: 'codex-cli',
      redactionPolicy: { savePromptInputs: false, savePromptOutputs: true, redactSecrets: true, redactUserContent: false, redactedFields: [] },
      resolvedContext: { projectId: paths.projectId, mode: 'codex' },
      stages: [],
      promptCalls: [
        {
          promptCallId: 'orphan_exec_text',
          promptId: 'codex.exec-text',
          provider: 'codex-cli',
          model: 'local-codex-cli',
          transport: 'cli',
          codexProfile: 'clean',
          sandbox: 'read-only',
          wrapperCallType: 'exec_text',
          attributionMode: 'unclassified',
          attributionConfidence: 'low',
          attributionReason: 'boundary wrapper call has no parent metadata',
          rawOutputPath: 'codex/runs/run_orphan_exec_text/raw_output.jsonl',
          finalOutputPath: 'codex/runs/run_orphan_exec_text/final_output.md',
          status: 'succeeded',
          startedAt: '2026-07-07T00:00:00.000Z',
          endedAt: '2026-07-07T00:00:31.000Z',
          latencyMs: 31_000,
          promptInputBytes: 4_000,
          contextBytes: 4_000,
          schemaBytes: 0,
          outputBytes: 1_200,
          rawJsonlBytes: 700,
          redacted: true,
          jsonParsed: false,
          schemaValid: false,
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
}

async function writeLegacyExecJsonRun(paths: ProjectPaths, store: FileStore): Promise<void> {
  const runId = 'run_legacy_exec_json';
  await store.ensureDir(paths.runDir(runId));
  await store.writeJson(
    paths.runManifest(runId),
    {
      schemaVersion: '2',
      runId,
      projectId: paths.projectId,
      command: 'codex',
      args: {},
      argv: ['codex'],
      cwd: paths.projectsRoot,
      startedAt: '2026-07-07T00:00:00.000Z',
      endedAt: '2026-07-07T00:00:11.000Z',
      durationMs: 11_000,
      status: 'success',
      packageVersion: '2.5.0-rc.1',
      nodeVersion: process.version,
      provider: 'codex-cli',
      redactionPolicy: { savePromptInputs: false, savePromptOutputs: true, redactSecrets: true, redactUserContent: false, redactedFields: [] },
      resolvedContext: { projectId: paths.projectId, mode: 'codex' },
      stages: [],
      promptCalls: [
        {
          promptCallId: 'legacy_exec_json',
          promptId: 'codex.exec-json',
          provider: 'codex-cli',
          model: 'local-codex-cli',
          transport: 'cli',
          codexProfile: 'clean',
          sandbox: 'read-only',
          wrapperCallType: 'exec_json',
          attributionMode: 'unclassified',
          attributionConfidence: 'low',
          attributionReason: 'legacy boundary wrapper lacks explicit command metadata',
          rawOutputPath: 'codex/runs/run_legacy_exec_json/raw_output.jsonl',
          finalOutputPath: 'codex/runs/run_legacy_exec_json/final_output.json',
          parsedOutputPath: 'codex/runs/run_legacy_exec_json/parsed_output.json',
          status: 'succeeded',
          startedAt: '2026-07-07T00:00:00.000Z',
          endedAt: '2026-07-07T00:00:11.000Z',
          latencyMs: 11_000,
          promptInputBytes: 512,
          contextBytes: 128,
          schemaBytes: 256,
          outputBytes: 80,
          rawJsonlBytes: 120,
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
}
