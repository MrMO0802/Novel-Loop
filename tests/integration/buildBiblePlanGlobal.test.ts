import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { ArcMapSchema, ChapterQueueSchema, RunManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;
let briefPath: string;

const promptRoot = path.resolve('tests/fixtures/prompts');
const fixturesRoot = path.resolve('tests/fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m5-'));
  briefPath = path.join(tempRoot, 'brief.md');
  await writeFile(briefPath, '# Demo Brief\n\nA controlled test brief.\n', 'utf8');
  await initProject({ projectId: 'demo-novel', briefPath, projectsRoot: tempRoot });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('buildBible and planGlobal', () => {
  test('builds strategy markdown artifacts and records a run manifest', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();

    const result = await buildBible({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_build_bible_test'
    });

    expect(result.artifacts).toEqual([
      'strategy/story_bible.md',
      'strategy/genre_contract.md',
      'strategy/reader_promise.md',
      'strategy/style_guide.md'
    ]);
    await expect(store.readText(path.join(paths.strategyDir(), 'story_bible.md'))).resolves.toContain('# Story Bible');
    await expect(store.readText(path.join(paths.strategyDir(), 'style_guide.md'))).resolves.toContain('# Style Guide');

    const manifest = await store.readJson(paths.runManifest('run_build_bible_test'), RunManifestSchema);
    expect(manifest.command).toBe('build-bible');
    expect(manifest.status).toBe('success');
    expect(JSON.stringify(manifest.artifacts)).toContain('strategy/story_bible.md');
  });

  test('plans global markdown and schema-validated JSON artifacts', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();
    await buildBible({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_build_bible_test'
    });

    const result = await planGlobal({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_plan_global_test'
    });

    expect(result.artifacts).toEqual([
      'planning/global_outline.md',
      'planning/volume_01_outline.md',
      'planning/arc_map.json',
      'planning/chapter_queue.json'
    ]);
    await expect(store.readText(path.join(paths.planningDir(), 'global_outline.md'))).resolves.toContain('# Global Outline');
    await expect(store.readJson(path.join(paths.planningDir(), 'arc_map.json'), ArcMapSchema)).resolves.toMatchObject({
      projectId: 'demo-novel'
    });
    await expect(store.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema)).resolves.toMatchObject({
      projectId: 'demo-novel'
    });

    const manifest = await store.readJson(paths.runManifest('run_plan_global_test'), RunManifestSchema);
    expect(manifest.command).toBe('plan-global');
    expect(manifest.status).toBe('success');
    expect(JSON.stringify(manifest.artifacts)).toContain('planning/chapter_queue.json');
  });
});
