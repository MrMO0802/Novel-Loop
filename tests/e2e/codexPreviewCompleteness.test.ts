import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { listArtifacts } from '../../src/app/artifactIndex.js';
import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import { readRunDetail } from '../../src/app/runBrowser.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { classifyCodexPreviewCompleteness, writeCodexPreviewCompletenessReport } from '../../src/app/codexPreviewDiagnostics.js';
import { hashJson } from '../../src/logging/RunLogger.js';
import { StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex, type FakeCodexMode } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m279-preview-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M27.9 codex preview completeness diagnostics', () => {
  test('complete codex preview writes completeness report and sub-stage timeline without mutating Story State', async () => {
    const { store, paths, codexBin } = await prepareCodexDraftProject(tempRoot, 'codex-controlled-valid');
    const before = await store.readJson(paths.storyState(), StoryStateSchema);

    const result = await runPreview(store, codexBin, 'run_m279_preview_complete');

    expect(result.status).toBe('codex_commit_preview');
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(before);
    const report = await readJson(store, paths.chapterArtifact(1, 'codex_preview_completeness_report_v1.json'));
    expect(report).toMatchObject({
      projectId,
      chapterNumber: 1,
      provider: 'codex-text',
      previewRunId: 'run_m279_preview_complete',
      previewStage: 'controlled_commit_preview',
      complete: true,
      missingArtifacts: [],
      invalidArtifacts: [],
      blockingReasons: []
    });
    expect(report.suggestedRetryCommand).toContain('--confirm-codex-commit');
    expect(report.suggestedInspectCommands).toContain(`corepack pnpm novel-loop artifacts ${projectId} --chapter 1`);
    expect(report.subStageTimeline.map((stage: { name: string; status: string }) => `${stage.name}:${stage.status}`)).toContain('completeness_check:completed');

    const detail = await readRunDetail({ projectId, projectsRoot: tempRoot, runId: 'run_m279_preview_complete' }, store);
    expect(detail.events.map((event) => event.eventType)).toContain('CODEX_PREVIEW_SUBSTAGE_STARTED');
    expect(detail.events.map((event) => event.eventType)).toContain('CODEX_PREVIEW_SUBSTAGE_COMPLETED');
    expect(detail.stages).toContain('preview.completeness_check');
  });

  test('diagnostics hard fail writes classified preview failure reports and guidance', async () => {
    const { store, paths, codexBin } = await prepareCodexDraftProject(tempRoot, 'codex-controlled-diagnostics-fail');
    const before = await store.readJson(paths.storyState(), StoryStateSchema);

    const result = await runPreview(store, codexBin, 'run_m279_diagnostics_fail');

    expect(result.status).toBe('needs_human_review');
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toEqual(before);
    const completeness = await readJson(store, paths.chapterArtifact(1, 'codex_preview_completeness_report_v1.json'));
    expect(completeness.complete).toBe(false);
    expect(completeness.invalidArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactType: 'diagnostics',
          blocking: true,
          reason: expect.stringContaining('hard check')
        })
      ])
    );
    expect(completeness.blockingReasons).toContain('CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL');

    const failure = await readJson(store, paths.chapterArtifact(1, 'codex_preview_failure_report_v1.json'));
    expect(failure).toMatchObject({
      failureStage: 'controlled_commit_preview',
      errorCode: 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL',
      previewCompletenessReportPath: 'chapters/chapter_001/codex_preview_completeness_report_v1.json',
      failedSubStage: 'diagnostics',
      lastSuccessfulSubStage: 'draft_ready_check',
      latestCommittedChapterBefore: 0,
      latestCommittedChapterAfter: 0,
      storyStateMutated: false
    });
    expect(failure.suggestedRetryCommand).toContain('--resume-from revision_plan');
    expect(failure.suggestedInspectCommands).toContain(`corepack pnpm novel-loop review ${projectId} 1 --diagnostics --artifacts --suggest-next`);

    const review = await reviewChapter({ projectId, projectsRoot: tempRoot, chapterNumber: 1, diagnostics: true, artifacts: true, suggestNext: true }, store);
    expect(review).toContain('Preview completeness');
    expect(review).toContain('CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL');

    const artifacts = await listArtifacts({ projectId, projectsRoot: tempRoot, chapterNumber: 1 }, store);
    expect(artifacts.artifacts.map((artifact) => artifact.artifactType)).toContain('codex_preview_completeness_report');
    expect(artifacts.artifacts.map((artifact) => artifact.artifactType)).toContain('codex_preview_failure_report');

    const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.ok).toBe(true);
  });

  test('missing preview contract artifacts are classified precisely', async () => {
    const finalCase = await prepareCodexDraftProject(tempRoot, 'codex-controlled-valid');
    const finalPreview = await runPreview(finalCase.store, finalCase.codexBin, 'run_m279_missing_final');
    expect(finalPreview.status).toBe('codex_commit_preview');
    await rm(finalCase.paths.chapterArtifact(1, 'final.md'), { force: true });
    const finalReport = await rewriteCompleteness(finalCase.store, finalCase.paths, 'run_m279_missing_final');
    expect(classifyCodexPreviewCompleteness(finalReport)).toBe('CODEX_PREVIEW_FINAL_MISSING');

    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m279-preview-'));
    const patchCase = await prepareCodexDraftProject(tempRoot, 'codex-controlled-valid');
    const patchPreview = await runPreview(patchCase.store, patchCase.codexBin, 'run_m279_missing_patch');
    expect(patchPreview.status).toBe('codex_commit_preview');
    await rm(patchCase.paths.chapterArtifact(1, 'canon_patch_codex_proposal_v1.json'), { force: true });
    await rm(patchCase.paths.chapterArtifact(1, 'canon_patch_codex_normalized_v1.json'), { force: true });
    const patchReport = await rewriteCompleteness(patchCase.store, patchCase.paths, 'run_m279_missing_patch');
    expect(classifyCodexPreviewCompleteness(patchReport)).toBe('CODEX_PREVIEW_PATCH_PROPOSAL_MISSING');

    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m279-preview-'));
    const diffCase = await prepareCodexDraftProject(tempRoot, 'codex-controlled-valid');
    const diffPreview = await runPreview(diffCase.store, diffCase.codexBin, 'run_m279_missing_diff');
    if (diffPreview.stateDiffPath === undefined) throw new Error('state diff path missing from valid preview');
    await rm(diffCase.paths.projectArtifact(diffPreview.stateDiffPath), { force: true });
    const diffReport = await rewriteCompleteness(diffCase.store, diffCase.paths, 'run_m279_missing_diff');
    expect(classifyCodexPreviewCompleteness(diffReport)).toBe('CODEX_PREVIEW_STATE_DIFF_MISSING');
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

async function rewriteCompleteness(store: FileStore, paths: ProjectPaths, runId: string) {
  const state = await store.readJson(paths.storyState(), StoryStateSchema);
  const result = await writeCodexPreviewCompletenessReport({
    paths,
    fileStore: store,
    chapterNumber: 1,
    previewRunId: runId,
    previewStage: 'controlled_commit_preview',
    subStageTimeline: [],
    latestCommittedChapterBefore: state.latestCommittedChapter,
    latestCommittedChapterAfter: state.latestCommittedChapter,
    storyStateHashBefore: hashJson(state),
    storyStateHashAfter: hashJson(state)
  });
  return result.report;
}

async function readJson(store: FileStore, filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await store.readText(filePath)) as Record<string, unknown>;
}
