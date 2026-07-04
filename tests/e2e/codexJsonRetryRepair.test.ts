import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { initProject } from '../../src/app/initProject.js';
import { CodexTextProvider, ProviderError } from '../../src/providers/codexTextProvider.js';
import { RunLogger } from '../../src/logging/RunLogger.js';
import { CodexJsonFailureReportSchema, RunManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m23-json-retry-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M23 codex JSON retry and repair', () => {
  test('invalid JSON retries once and then succeeds with slim schema', async () => {
    const fake = await writeFakeCodex(tempRoot, 'retry-invalid-first');
    const { provider, paths, store } = await createProvider(fake.codexBin, {
      codexJsonRetries: 2,
      codexJsonRepair: false,
      runId: 'run_m23_retry'
    });

    const result = await provider.generateJson({
      promptId: 'planning.generate_arc_map_minimal_json',
      system: 'test',
      user: 'Return a minimal arc map.',
      responseFormat: 'json'
    });

    expect(result.schemaValid).toBe(true);
    expect(result.parsed).toMatchObject({ arcs: expect.any(Array) });
    const manifest = await store.readJson(paths.runManifest('run_m23_retry'), RunManifestSchema);
    if (!('schemaVersion' in manifest) || manifest.schemaVersion !== '2') throw new Error('expected run manifest v2');
    expect(manifest.promptCalls[0]?.retryCount).toBe(1);
  });

  test('schema invalid output can be repaired and records repair provenance', async () => {
    const fake = await writeFakeCodex(tempRoot, 'repair-schema-invalid');
    const { provider, paths, store } = await createProvider(fake.codexBin, {
      codexJsonRetries: 1,
      codexJsonRepair: true,
      codexJsonRepairRetries: 1,
      runId: 'run_m23_repair'
    });

    const result = await provider.generateJson({
      promptId: 'planning.generate_chapter_queue_minimal_json',
      system: 'test',
      user: 'Return a minimal queue.',
      responseFormat: 'json'
    });

    expect(result.schemaValid).toBe(true);
    const manifest = await store.readJson(paths.runManifest('run_m23_repair'), RunManifestSchema);
    if (!('schemaVersion' in manifest) || manifest.schemaVersion !== '2') throw new Error('expected run manifest v2');
    expect(manifest.promptCalls[0]?.retryCount).toBe(0);
    expect(manifest.promptCalls[0]?.finishReason).toBe('repaired');
  });

  test('repair failure writes a schema-valid codex_failure_report', async () => {
    const fake = await writeFakeCodex(tempRoot, 'repair-fails');
    const { provider, paths, store } = await createProvider(fake.codexBin, {
      codexJsonRetries: 0,
      codexJsonRepair: true,
      codexJsonRepairRetries: 1,
      runId: 'run_m23_repair_fails'
    });

    await expect(
      provider.generateJson({
        promptId: 'planning.generate_arc_map_minimal_json',
        system: 'test',
        user: 'Return a minimal arc map.',
        responseFormat: 'json'
      })
    ).rejects.toBeInstanceOf(ProviderError);

    const failureReportPath = paths.projectArtifact('codex/failures/run_m23_repair_fails/codex_failure_report.json');
    const report = await store.readJson(failureReportPath, CodexJsonFailureReportSchema);
    expect(report.errorType).toBe('CODEX_REPAIR_FAILED');
    expect(report.repairAttempts.length).toBe(1);
    expect(report.storyStateMutated).toBe(false);
  });
});

async function createProvider(
  codexBin: string,
  options: {
    runId: string;
    codexJsonRetries: number;
    codexJsonRepair: boolean;
    codexJsonRepairRetries?: number;
  }
) {
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
  const paths = new ProjectPaths(tempRoot, projectId);
  await new RunLogger(paths, store).startRun({
    runId: options.runId,
    command: 'codex-json-test',
    args: { provider: 'codex-text' }
  });
  const provider = new CodexTextProvider({
    codexBin,
    projectsRoot: tempRoot,
    projectId,
    codexProfile: 'clean',
    codexJsonRetries: options.codexJsonRetries,
    codexJsonRepair: options.codexJsonRepair,
    ...(options.codexJsonRepairRetries === undefined ? {} : { codexJsonRepairRetries: options.codexJsonRepairRetries }),
    telemetry: {
      paths,
      runId: options.runId,
      fileStore: store
    }
  });
  return { provider, paths, store };
}
