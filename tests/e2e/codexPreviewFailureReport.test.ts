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
import { StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex, type FakeCodexMode } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m279-failure-report-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M27.9 codex preview failure reports', () => {
  test('patch schema invalid is classified without Story State mutation', async () => {
    const { store, paths, codexBin } = await prepareCodexDraftProject(tempRoot, 'codex-controlled-invalid-patch');
    const before = await store.readJson(paths.storyState(), StoryStateSchema);

    await expect(runPreview(store, codexBin, 'run_m279_invalid_patch')).rejects.toMatchObject({
      code: 'CODEX_SCHEMA_VALIDATION_FAILED'
    });

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(before);
    const report = await readJson<CodexPreviewFailureJson>(store, paths.chapterArtifact(1, 'codex_preview_failure_report_v1.json'));
    expect(report.errorCode).toBe('CODEX_PREVIEW_PATCH_SCHEMA_INVALID');
    expect(report.failedSubStage).toBe('canon_patch_proposal');
    expect(report.storyStateMutated).toBe(false);
    expect(report.suggestedRetryCommand).toContain('--resume-from patch_normalization');
  });

  test('conflict detected is classified without committing queue or Story State', async () => {
    const { store, paths, codexBin } = await prepareCodexDraftProject(tempRoot, 'codex-controlled-conflict');
    const before = await store.readJson(paths.storyState(), StoryStateSchema);

    await expect(runPreview(store, codexBin, 'run_m279_conflict')).rejects.toMatchObject({
      code: 'CANON_PATCH_CONFLICT'
    });

    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(before);
    const report = await readJson<CodexPreviewFailureJson>(store, paths.chapterArtifact(1, 'codex_preview_failure_report_v1.json'));
    expect(report.errorCode).toBe('CODEX_PREVIEW_CONFLICT_DETECTED');
    expect(report.failedSubStage).toBe('conflict_check');
    expect(report.conflictReportPath).toBe('chapters/chapter_001/conflict_report_v1.json');
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
  });
});

interface CodexPreviewFailureJson extends Record<string, unknown> {
  errorCode: string;
  failedSubStage?: string;
  storyStateMutated: boolean;
  suggestedRetryCommand: string;
  conflictReportPath?: string;
}

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

function runPreview(store: FileStore, codexBin: string, runId: string) {
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
      runId
    },
    store
  );
}

async function readJson<T extends Record<string, unknown>>(store: FileStore, filePath: string): Promise<T> {
  return JSON.parse(await store.readText(filePath)) as T;
}
