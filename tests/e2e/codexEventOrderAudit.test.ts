import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.8A Codex event order audit', () => {
  test('strict audit blocks impossible Codex timing event order', async () => {
    const tempRoot = await createTempRoot('novel-loop-m278a-event-order-');
    try {
      const store = new FileStore();
      const projectId = 'codex-event-order';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build` }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan` }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      await writeRunWithEvents(paths, store, { runId: 'run_bad_order', reverseOrder: true });

      const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);

      expect(audit.exitCode).toBe(2);
      expect(audit.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'codex_event_timing',
            severity: 'error',
            blocking: true,
            path: 'runs/run_bad_order/events.ndjson'
          })
        ])
      );
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);

  test('strict audit warns but does not block legacy Codex runs missing precision timing events', async () => {
    const tempRoot = await createTempRoot('novel-loop-m278a-legacy-timing-');
    try {
      const store = new FileStore();
      const projectId = 'codex-legacy-timing';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build` }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan` }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      await writeRunWithEvents(paths, store, { runId: 'run_legacy_timing', omitTimingEvents: true });

      const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);

      expect(audit.ok).toBe(true);
      expect(audit.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'codex_event_timing',
            severity: 'warning',
            blocking: false,
            path: 'runs/run_legacy_timing/events.ndjson'
          })
        ])
      );
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});

async function writeRunWithEvents(paths: ProjectPaths, store: FileStore, input: { runId: string; reverseOrder?: boolean; omitTimingEvents?: boolean }): Promise<void> {
  const startedMs = Date.parse('2026-07-07T00:00:00.000Z');
  await store.ensureDir(paths.runDir(input.runId));
  await store.writeJson(
    paths.runManifest(input.runId),
    {
      schemaVersion: '2',
      runId: input.runId,
      projectId: paths.projectId,
      command: 'codex event order fixture',
      args: {},
      argv: ['codex', 'event', 'fixture'],
      cwd: paths.projectsRoot,
      startedAt: new Date(startedMs).toISOString(),
      endedAt: new Date(startedMs + 1_000).toISOString(),
      durationMs: 1_000,
      status: 'success',
      packageVersion: '2.5.0-rc.1',
      nodeVersion: process.version,
      provider: 'codex-text',
      redactionPolicy: { savePromptInputs: false, savePromptOutputs: true, redactSecrets: true, redactUserContent: false, redactedFields: [] },
      resolvedContext: { projectId: paths.projectId, mode: 'codex' },
      stages: [],
      promptCalls: [
        {
          promptCallId: 'prompt_fixture',
          promptId: 'planning.plan_chapter_mission_slim',
          provider: 'codex-text',
          model: 'codex-cli',
          status: 'succeeded',
          startedAt: new Date(startedMs).toISOString(),
          endedAt: new Date(startedMs + 900).toISOString(),
          latencyMs: 900,
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
  const events = [event(input.runId, paths.projectId, 'RUN_STARTED', startedMs), ...timingEvents, event(input.runId, paths.projectId, 'RUN_COMPLETED', startedMs + 1_000)];
  await store.writeText(paths.runEvents(input.runId), events.map((item) => `${JSON.stringify(item)}`).join('\n') + '\n');
}

function buildTimingEvents(runId: string, projectId: string, startedMs: number, reverseOrder: boolean) {
  return [
    event(runId, projectId, 'CODEX_PROCESS_SPAWN_STARTED', startedMs),
    event(runId, projectId, 'CODEX_PROCESS_SPAWNED', startedMs + 10),
    event(runId, projectId, 'CODEX_STDIN_WRITTEN', startedMs + 20),
    event(runId, projectId, 'CODEX_FIRST_JSONL_EVENT', startedMs + (reverseOrder ? 700 : 30)),
    event(runId, projectId, 'CODEX_FINAL_MESSAGE_SEEN', startedMs + (reverseOrder ? 600 : 600)),
    event(runId, projectId, 'CODEX_PROCESS_EXITED', startedMs + 650),
    event(runId, projectId, 'CODEX_ARTIFACT_WRITE_STARTED', startedMs + 660),
    event(runId, projectId, 'CODEX_ARTIFACT_WRITE_COMPLETED', startedMs + 670),
    event(runId, projectId, 'CODEX_PARSE_STARTED', startedMs + 680),
    event(runId, projectId, 'CODEX_PARSE_COMPLETED', startedMs + 690),
    event(runId, projectId, 'CODEX_SCHEMA_VALIDATE_STARTED', startedMs + 700),
    event(runId, projectId, 'CODEX_SCHEMA_VALIDATE_COMPLETED', startedMs + 710)
  ];
}

function event(runId: string, projectId: string, eventType: string, timestampMs: number) {
  return {
    eventId: `${runId}_${eventType}_${timestampMs}`,
    runId,
    projectId,
    timestamp: new Date(timestampMs).toISOString(),
    eventType,
    payload: {},
    relatedArtifactPaths: [],
    severity: 'info'
  };
}
