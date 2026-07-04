import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { inspectProvider } from '../../src/providers/providerRegistry.js';
import { RunManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m23-profile-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M23 codex runtime profile', () => {
  test('clean profile is recorded in provider provenance and inspect output', async () => {
    const fake = await writeFakeCodex(tempRoot, 'plugin-warning');
    const store = new FileStore();
    await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);

    await buildBible({
      projectId,
      projectsRoot: tempRoot,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      codexProfile: 'clean',
      runId: 'run_m23_profile'
    }, store);

    const paths = new ProjectPaths(tempRoot, projectId);
    const manifest = await store.readJson(paths.runManifest('run_m23_profile'), RunManifestSchema);
    if (!('schemaVersion' in manifest) || manifest.schemaVersion !== '2') throw new Error('expected run manifest v2');
    expect(manifest.args).toMatchObject({ provider: 'codex-text', codexProfile: 'clean' });
    expect(manifest.promptCalls.every((call) => call.codexProfile === 'clean')).toBe(true);

    const argsLog = await readFile(fake.argsLogPath, 'utf8');
    expect(argsLog).toContain('--sandbox read-only');
    expect(argsLog).toContain('--ephemeral');

    const inspect = await inspectProvider('codex-text', { codexBin: fake.codexBin, projectsRoot: tempRoot, projectId });
    expect(inspect.capabilities.supportedProfiles).toEqual(expect.arrayContaining(['default', 'clean', 'debug']));
  });
});
