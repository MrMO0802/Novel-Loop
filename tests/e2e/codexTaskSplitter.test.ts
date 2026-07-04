import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { ArcMapSchema, ChapterQueueSchema, RunManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m23-task-splitter-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M23 codex task splitter', () => {
  test('plan-global codex-text uses split slim tasks and normalizes final planning artifacts', async () => {
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
      runId: 'run_m23_split_build'
    }, store);

    const result = await planGlobal({
      projectId,
      projectsRoot: tempRoot,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      codexProfile: 'clean',
      codexJsonRetries: 2,
      codexJsonRepair: true,
      runId: 'run_m23_split_plan'
    }, store);

    expect(result.artifacts).toEqual(expect.arrayContaining(['planning/global_outline.md', 'planning/volume_01_outline.md', 'planning/arc_map.json', 'planning/chapter_queue.json']));
    const paths = new ProjectPaths(tempRoot, projectId);
    expect(await store.readJson(paths.projectArtifact('planning/arc_map.json'), ArcMapSchema)).toMatchObject({
      schemaVersion: '1.0',
      projectId
    });
    expect(await store.readJson(paths.projectArtifact('planning/chapter_queue.json'), ChapterQueueSchema)).toMatchObject({
      schemaVersion: '1.0',
      projectId
    });

    const manifest = await store.readJson(paths.runManifest('run_m23_split_plan'), RunManifestSchema);
    if (!('schemaVersion' in manifest) || manifest.schemaVersion !== '2') throw new Error('expected run manifest v2');
    const promptIds = manifest.promptCalls.map((call) => call.promptId);
    expect(promptIds).toEqual(expect.arrayContaining([
      'planning.generate_global_outline_text',
      'planning.generate_volume_outline_text',
      'planning.generate_arc_map_minimal_json',
      'planning.generate_chapter_queue_minimal_json'
    ]));
    expect(promptIds).not.toContain('planning.generate_arc_map');
    expect(promptIds).not.toContain('planning.generate_chapter_queue');
    expect(manifest.promptCalls.filter((call) => call.promptId.endsWith('_minimal_json')).every((call) => call.outputSchemaPath?.includes('/slim/'))).toBe(true);
  });
});
