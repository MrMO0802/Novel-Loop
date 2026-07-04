import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { initProject } from '../../src/app/initProject.js';
import { CodexTextProvider } from '../../src/providers/codexTextProvider.js';
import { CodexJsonFailureReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m23-classify-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M23 codex failure classification', () => {
  test('plugin warnings do not fail when final output is valid', async () => {
    const fake = await writeFakeCodex(tempRoot, 'plugin-warning');
    const { provider } = await createProvider(fake.codexBin, 'run_m23_plugin_warning');

    const result = await provider.generateJson({
      promptId: 'planning.generate_arc_map_minimal_json',
      system: 'test',
      user: 'Return valid JSON even with stderr warnings.',
      responseFormat: 'json'
    });

    expect(result.schemaValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('missing final output is classified and written to failure report', async () => {
    const fake = await writeFakeCodex(tempRoot, 'missing-output');
    const { provider, paths, store } = await createProvider(fake.codexBin, 'run_m23_missing_output');

    await expect(
      provider.generateJson({
        promptId: 'planning.generate_arc_map_minimal_json',
        system: 'test',
        user: 'Return JSON but omit output file.',
        responseFormat: 'json'
      })
    ).rejects.toMatchObject({ code: 'CODEX_OUTPUT_MISSING' });

    const report = await store.readJson(paths.projectArtifact('codex/failures/run_m23_missing_output/codex_failure_report.json'), CodexJsonFailureReportSchema);
    expect(report.errorType).toBe('CODEX_OUTPUT_MISSING');
    expect(report.stderrExcerpt).not.toContain('sk-SECRET');
  });
});

async function createProvider(codexBin: string, runId: string) {
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
  const paths = new ProjectPaths(tempRoot, projectId);
  const provider = new CodexTextProvider({
    codexBin,
    projectsRoot: tempRoot,
    projectId,
    codexProfile: 'clean',
    codexJsonRetries: 0,
    codexJsonRepair: false,
    telemetry: {
      paths,
      runId,
      fileStore: store
    }
  });
  return { provider, paths, store };
}
