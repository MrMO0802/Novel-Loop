import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { ChapterQueueSchema, RunEventSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m24-preview-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M24 codex controlled commit preview', () => {
  test('codex-text --commit without confirmation creates preview artifacts and does not mutate Story State', async () => {
    const { store, paths, codexBin } = await prepareCodexDraftProject(tempRoot, 'codex-controlled-valid');
    const before = await store.readJson(paths.storyState(), StoryStateSchema);

    const input: any = {
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin,
      codexProfile: 'clean',
      codexJsonRetries: 2,
      codexJsonRepair: true,
      maxRevisions: 2,
      commit: true,
      runId: 'run_m24_preview'
    };
    const result = await runChapterFullProduction(input, store) as any;

    expect(result.previewOnly).toBe(true);
    expect(result.status).toBe('codex_commit_preview');
    expect(result.stateDiffPath).toMatch(/^diffs\/state_diff_/);
    expect(result.codexPatchPath).toBe('chapters/chapter_001/canon_patch_codex_proposal_v1.json');
    expect(result.artifacts).toContain('chapters/chapter_001/final.md');
    expect(result.artifacts).toContain('chapters/chapter_001/canon_patch_codex_proposal_v1.json');
    expect(result.artifacts).toContain(result.stateDiffPath);

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(before);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 1)?.status).not.toBe('committed');
    await expect(store.exists(paths.chapterArtifact(1, 'codex_approval_record_v1.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);

    const events = (await store.readText(paths.runEvents('run_m24_preview')))
      .trim()
      .split('\n')
      .map((line) => RunEventSchema.parse(JSON.parse(line)));
    expect(events.map((event) => event.eventType)).toContain('CODEX_COMMIT_PREVIEW_CREATED');
    expect(events.map((event) => event.eventType)).not.toContain('STATE_MUTATION_APPLIED');
  });
});

async function prepareCodexDraftProject(root: string, fakeMode: string) {
  const fake = await writeFakeCodex(root, fakeMode as any);
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: root, briefPath }, store);
  await buildBible({ projectId, projectsRoot: root, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await planGlobal({ projectId, projectsRoot: root, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await runChapterDryRun({
    projectId,
    projectsRoot: root,
    chapterNumber: 1,
    provider: 'codex-text',
    promptRoot,
    codexBin: fake.codexBin,
    codexProfile: 'clean',
    runId: 'run_m24_preview_dryrun'
  }, store);
  await runChapterUntilDraft({
    projectId,
    projectsRoot: root,
    chapterNumber: 1,
    provider: 'codex-text',
    promptRoot,
    codexBin: fake.codexBin,
    codexProfile: 'clean',
    runId: 'run_m24_preview_draft'
  }, store);
  return { store, paths: new ProjectPaths(root, projectId), codexBin: fake.codexBin };
}
