import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { CanonPatchSchema, CodexChapterQualityReportSchema, CodexCommitConsistencyReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m25-reuse-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M25 codex confirm preview reuse', () => {
  test('confirmed commit reuses valid preview artifacts without invoking Codex again', async () => {
    const prepared = await preparePreviewedCodexProject();
    const lineCountBeforeConfirm = await codexArgsLineCount(prepared.argsLogPath);

    const result = await runCodexCommit(prepared.store, prepared.codexBin, {
      confirmCodexCommit: true,
      runId: 'run_m25_confirm_reuse'
    }) as any;

    expect(result.status).toBe('committed');
    expect(result.reusedPreviewArtifacts).toBe(true);
    expect(result.reusedPatchPath).toBe('chapters/chapter_001/canon_patch_codex_proposal_v1.json');
    expect(result.reusedStateDiffPath).toMatch(/^diffs\/state_diff_/);
    expect(result.consistencyReportPath).toBe('chapters/chapter_001/codex_commit_consistency_report_v1.json');
    await expect(codexArgsLineCount(prepared.argsLogPath)).resolves.toBe(lineCountBeforeConfirm);

    const proposal = await prepared.store.readJson(prepared.paths.chapterArtifact(1, 'canon_patch_codex_proposal_v1.json'), CanonPatchSchema);
    const normalized = await prepared.store.readJson(prepared.paths.chapterArtifact(1, 'canon_patch_codex_normalized_v1.json'), CanonPatchSchema);
    expect(normalized).toEqual(proposal);
    const consistency = await prepared.store.readJson(prepared.paths.chapterArtifact(1, 'codex_commit_consistency_report_v1.json'), CodexCommitConsistencyReportSchema);
    expect(consistency).toMatchObject({
      previewPatchPath: 'chapters/chapter_001/canon_patch_codex_proposal_v1.json',
      previewNormalizedPatchPath: 'chapters/chapter_001/canon_patch_codex_normalized_v1.json',
      confirmedPatchPath: 'chapters/chapter_001/canon_patch_codex_proposal_v1.json',
      patchesEquivalent: true,
      stateDiffsEquivalent: true,
      reusedPreviewArtifacts: true
    });
    const quality = await prepared.store.readJson(prepared.paths.chapterArtifact(1, 'codex_chapter_quality_report_v2.json'), CodexChapterQualityReportSchema);
    expect(quality).toMatchObject({
      provider: 'codex-text',
      jsonArtifactsConsistent: true,
      diagnosticsHardChecksPassed: true,
      blocking: false
    });

    const state = await prepared.store.readJson(prepared.paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(1);
  });

  test('--rerun-codex-on-confirm refreshes preview artifacts instead of reusing them', async () => {
    const prepared = await preparePreviewedCodexProject();
    const lineCountBeforeConfirm = await codexArgsLineCount(prepared.argsLogPath);

    const result = await runCodexCommit(prepared.store, prepared.codexBin, {
      confirmCodexCommit: true,
      rerunCodexOnConfirm: true,
      runId: 'run_m25_confirm_rerun'
    }) as any;

    expect(result.status).toBe('committed');
    expect(result.reusedPreviewArtifacts).toBe(false);
    expect(result.codexPatchPath).toBe('chapters/chapter_001/canon_patch_codex_proposal_v2.json');
    expect(await codexArgsLineCount(prepared.argsLogPath)).toBeGreaterThan(lineCountBeforeConfirm);
  });
});

async function preparePreviewedCodexProject() {
  const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await runChapterDryRun({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await runChapterUntilDraft({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await runCodexCommit(store, fake.codexBin, { runId: 'run_m25_preview' });
  return { store, paths: new ProjectPaths(tempRoot, projectId), codexBin: fake.codexBin, argsLogPath: fake.argsLogPath };
}

function runCodexCommit(store: FileStore, codexBin: string, options: Record<string, unknown>) {
  return runChapterFullProduction(
    {
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
      ...options
    } as any,
    store
  );
}

async function codexArgsLineCount(argsLogPath: string): Promise<number> {
  const text = await readFile(argsLogPath, 'utf8');
  return text.trim().split('\n').filter(Boolean).length;
}
