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
import { ChapterQueueSchema, CodexPatchFailureReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex, type FakeCodexMode } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m24-failure-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M24 codex controlled commit failures', () => {
  test('invalid patch proposal schema is rejected without Story State mutation', async () => {
    const { store, paths, codexBin } = await prepareCodexDraftProject(tempRoot, 'codex-controlled-invalid-patch');
    const before = await store.readJson(paths.storyState(), StoryStateSchema);

    await expect(runControlledCommit(store, codexBin, 'run_m24_invalid_schema')).rejects.toMatchObject({
      code: 'CODEX_SCHEMA_VALIDATION_FAILED'
    });

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(before);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
    const failureReport = await store.readJson(paths.chapterArtifact(1, 'codex_patch_failure_report_v1.json'), CodexPatchFailureReportSchema);
    expect(failureReport).toMatchObject({
      projectId,
      runId: 'run_m24_invalid_schema',
      chapterNumber: 1,
      stage: 'canon_patch',
      provider: 'codex-text',
      errorCode: 'CODEX_SCHEMA_VALIDATION_FAILED',
      storyStateMutated: false,
      redacted: true
    });
    expect(failureReport.suggestedRetryCommand).toContain('--codex-profile debug');
    expect(failureReport.suggestedFixes).toContain('enable --codex-json-repair');
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 1)?.status).toBe('failed');
  });

  test('conflicting patch proposal is blocked without Story State mutation', async () => {
    const { store, paths, codexBin } = await prepareCodexDraftProject(tempRoot, 'codex-controlled-conflict');
    const before = await store.readJson(paths.storyState(), StoryStateSchema);

    await expect(runControlledCommit(store, codexBin, 'run_m24_conflict')).rejects.toMatchObject({
      code: 'CANON_PATCH_CONFLICT'
    });

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(before);
    await expect(store.exists(paths.chapterArtifact(1, 'conflict_report_v1.json'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 1)?.status).toBe('blocked');
  });

  test('diagnostics hard fail enters human review before final or patch proposal', async () => {
    const { store, paths, codexBin } = await prepareCodexDraftProject(tempRoot, 'codex-controlled-diagnostics-fail');
    const before = await store.readJson(paths.storyState(), StoryStateSchema);

    const result = await runControlledCommit(store, codexBin, 'run_m24_diagnostics_fail');

    expect(result.status).toBe('needs_human_review');
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(before);
    await expect(store.exists(paths.chapterArtifact(1, 'final.md'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch_codex_proposal_v1.json'))).resolves.toBe(false);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 1)?.status).toBe('needs_human_review');
  });
});

async function prepareCodexDraftProject(root: string, fakeMode: FakeCodexMode) {
  const fake = await writeFakeCodex(root, fakeMode);
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: root, briefPath }, store);
  await buildBible({ projectId, projectsRoot: root, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await planGlobal({ projectId, projectsRoot: root, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await runChapterDryRun({ projectId, projectsRoot: root, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await runChapterUntilDraft({ projectId, projectsRoot: root, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  return { store, paths: new ProjectPaths(root, projectId), codexBin: fake.codexBin };
}

function runControlledCommit(store: FileStore, codexBin: string, runId: string) {
  return runChapterFullProduction(
    {
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin,
      codexProfile: 'clean',
      codexJsonRetries: 1,
      codexJsonRepair: false,
      maxRevisions: 2,
      commit: true,
      confirmCodexCommit: true,
      runId
    },
    store
  );
}
