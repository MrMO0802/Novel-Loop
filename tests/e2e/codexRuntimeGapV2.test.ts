import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { generateCodexRuntimeGapReport } from '../../src/app/codexRuntimeGap.js';
import { initProject } from '../../src/app/initProject.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { CodexRuntimeGapReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.8A Codex runtime gap v2', () => {
  test('derives precise boundary timing and marks local-stage wall-clock overlap without mutating Story State', async () => {
    const tempRoot = await createTempRoot('novel-loop-m278a-runtime-gap-');
    try {
      const store = new FileStore();
      const projectId = 'codex-runtime-gap-v2';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build` }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan` }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      await writeTimedRun(paths, store, {
        runId: 'run_precise_gap',
        chapterNumber: 2,
        runDurationMs: 1_000,
        promptLatencyMs: 900,
        localStageMs: 700
      });
      const stateBefore = await store.readText(paths.storyState());

      const result = await generateCodexRuntimeGapReport({ projectId, projectsRoot: tempRoot }, store);

      expect(result.report).toMatchObject({
        reportId: 'codex_runtime_gap_report_v1',
        processStartupMs: 10,
        timeToFirstEventMs: 20,
        modelResponseMs: 580,
        finalMessageToExitMs: 40,
        artifactWriteMs: 10,
        parseMs: 20,
        schemaValidationMs: 20,
        measuredCodexBoundaryMs: 650,
        measuredLocalProcessingMs: 50,
        unexplainedMsAfterPrecision: 300,
        timingOverlapDetected: true,
        storyStateMutated: false
      });
      expect(result.report.timingOverlapWarning).toContain('overlap');
      expect(result.report.overlapExplanation).toContain('wall-clock');
      const preciseRun = result.report.gapByRun.find((run) => run.runId === 'run_precise_gap');
      expect(preciseRun).toMatchObject({
        runId: 'run_precise_gap',
        processStartupMs: 10,
        timeToFirstEventMs: 20,
        modelResponseMs: 580,
        finalMessageToExitMs: 40,
        artifactWriteMs: 10,
        parseMs: 20,
        schemaValidationMs: 20,
        measuredCodexBoundaryMs: 650,
        measuredLocalProcessingMs: 50,
        unexplainedMsAfterPrecision: 300,
        timingOverlapDetected: true
      });
      expect(CodexRuntimeGapReportSchema.parse(result.report)).toMatchObject({ reportId: 'codex_runtime_gap_report_v1' });
      expect(await store.readText(paths.storyState())).toBe(stateBefore);

      const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
      expect(audit.ok).toBe(true);
      expect(audit.report.issues.filter((issue) => issue.category === 'codex_event_timing' && issue.severity === 'error')).toHaveLength(0);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});

export async function writeTimedRun(
  paths: ProjectPaths,
  store: FileStore,
  input: { runId: string; chapterNumber: number; runDurationMs: number; promptLatencyMs: number; localStageMs: number; reverseOrder?: boolean; omitTimingEvents?: boolean }
): Promise<void> {
  const startedMs = Date.parse('2026-07-07T00:00:00.000Z');
  const startedAt = new Date(startedMs).toISOString();
  const endedAt = new Date(startedMs + input.runDurationMs).toISOString();
  await store.ensureDir(paths.runDir(input.runId));
  await store.writeJson(
    paths.runManifest(input.runId),
    {
      schemaVersion: '2',
      runId: input.runId,
      projectId: paths.projectId,
      command: 'codex timing fixture',
      args: {},
      argv: ['codex', 'timing', 'fixture'],
      cwd: paths.projectsRoot,
      startedAt,
      endedAt,
      durationMs: input.runDurationMs,
      status: 'success',
      packageVersion: '2.5.0-rc.1',
      nodeVersion: process.version,
      provider: 'codex-text',
      redactionPolicy: { savePromptInputs: false, savePromptOutputs: true, redactSecrets: true, redactUserContent: false, redactedFields: [] },
      resolvedContext: { projectId: paths.projectId, chapterNumber: input.chapterNumber, resolvedChapterNumber: input.chapterNumber, mode: 'codex' },
      stages: [
        {
          stage: 'chapter_mission',
          name: 'chapter_mission',
          status: 'completed',
          startedAt,
          endedAt,
          durationMs: input.localStageMs,
          chapterNumber: input.chapterNumber
        }
      ],
      promptCalls: [
        {
          promptCallId: `prompt_${input.runId}`,
          promptId: 'planning.plan_chapter_mission_slim',
          provider: 'codex-text',
          model: 'codex-cli',
          status: 'succeeded',
          startedAt,
          endedAt,
          latencyMs: input.promptLatencyMs,
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
  const timingEvents = input.omitTimingEvents === true ? [] : buildTimingEvents(input.runId, paths.projectId, startedMs, input.reverseOrder === true);
  const events = [
    event(input.runId, paths.projectId, 'RUN_STARTED', startedMs, {}),
    ...timingEvents,
    event(input.runId, paths.projectId, 'RUN_COMPLETED', startedMs + input.runDurationMs, {})
  ];
  await store.writeText(paths.runEvents(input.runId), events.map((item) => `${JSON.stringify(item)}`).join('\n') + '\n');
}

function buildTimingEvents(runId: string, projectId: string, startedMs: number, reverseOrder: boolean) {
  const finalMessageMs = reverseOrder ? 580 : 610;
  const firstJsonlMs = reverseOrder ? 620 : 30;
  return [
    event(runId, projectId, 'CODEX_PROCESS_SPAWN_STARTED', startedMs, {}),
    event(runId, projectId, 'CODEX_PROCESS_SPAWNED', startedMs + 10, {}),
    event(runId, projectId, 'CODEX_STDIN_WRITTEN', startedMs + 10, {}),
    event(runId, projectId, 'CODEX_FIRST_JSONL_EVENT', startedMs + firstJsonlMs, {}),
    event(runId, projectId, 'CODEX_FINAL_MESSAGE_SEEN', startedMs + finalMessageMs, {}),
    event(runId, projectId, 'CODEX_PROCESS_EXITED', startedMs + 650, {}),
    event(runId, projectId, 'CODEX_ARTIFACT_WRITE_STARTED', startedMs + 650, { artifactKind: 'raw_output' }),
    event(runId, projectId, 'CODEX_ARTIFACT_WRITE_COMPLETED', startedMs + 660, { artifactKind: 'raw_output' }),
    event(runId, projectId, 'CODEX_PARSE_STARTED', startedMs + 660, {}),
    event(runId, projectId, 'CODEX_PARSE_COMPLETED', startedMs + 680, {}),
    event(runId, projectId, 'CODEX_SCHEMA_VALIDATE_STARTED', startedMs + 680, {}),
    event(runId, projectId, 'CODEX_SCHEMA_VALIDATE_COMPLETED', startedMs + 700, {})
  ];
}

function event(runId: string, projectId: string, eventType: string, timestampMs: number, payload: Record<string, unknown>) {
  return {
    eventId: `${runId}_${eventType}_${timestampMs}`,
    runId,
    projectId,
    timestamp: new Date(timestampMs).toISOString(),
    eventType,
    payload,
    relatedArtifactPaths: [],
    severity: 'info'
  };
}
