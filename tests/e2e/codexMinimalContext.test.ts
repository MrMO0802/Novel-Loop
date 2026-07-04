import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { CodexContextManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m23-context-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M23 codex minimal context builder', () => {
  test('writes context manifest and excludes full raw artifact dumps', async () => {
    const fake = await writeFakeCodex(tempRoot, 'slim-valid');
    const store = new FileStore();
    await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
    await buildBible({
      projectId,
      projectsRoot: tempRoot,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      codexProfile: 'clean',
      runId: 'run_m23_context_build'
    }, store);

    await planGlobal({
      projectId,
      projectsRoot: tempRoot,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      codexProfile: 'clean',
      runId: 'run_m23_context_plan'
    }, store);

    const paths = new ProjectPaths(tempRoot, projectId);
    const contextPath = paths.projectArtifact('codex/context/context_manifest_v1.json');
    const manifest = await store.readJson(contextPath, CodexContextManifestSchema);
    expect(manifest.includedArtifacts.map((artifact) => artifact.path)).toEqual(expect.arrayContaining(['brief.md', 'strategy/story_bible.md']));
    expect(manifest.excludedArtifacts.some((artifact) => artifact.reason.includes('too large') || artifact.reason.includes('not needed'))).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain('FINAL_MARKDOWN');
  });
});
