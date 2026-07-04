import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { qualityGate, runChapterRevisionLoop } from '../../src/app/chapterRevisionLoop.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { DiagnosticsReportSchema, FailureReportSchema, RevisionPlanSchema, RunManifestSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;
let briefPath: string;

const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m8-'));
  briefPath = path.join(tempRoot, 'brief.md');
  await writeFile(briefPath, '# Demo Brief\n\nA controlled test brief.\n', 'utf8');
  await initProject({ projectId: 'demo-novel', briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId: 'demo-novel', projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_build_bible_test' });
  await planGlobal({ projectId: 'demo-novel', projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_plan_global_test' });
  await runChapterDryRun({
    projectId: 'demo-novel',
    projectsRoot: tempRoot,
    chapterNumber: 1,
    candidates: 3,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    runId: 'run_chapter_dry_run_test'
  });
  await runChapterUntilDraft({
    projectId: 'demo-novel',
    projectsRoot: tempRoot,
    chapterNumber: 1,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    runId: 'run_chapter_draft_test'
  });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('chapter diagnostics and revision loop', () => {
  test('revises a failed draft, diagnoses again, and writes final when the quality gate passes', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();

    const result = await runChapterRevisionLoop({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      maxRevisions: 2,
      runId: 'run_chapter_revision_test'
    });

    expect(result.status).toBe('final_complete');
    expect(result.artifacts).toEqual([
      'chapters/chapter_001/diagnostics_v1.json',
      'chapters/chapter_001/revision_plan_v1.json',
      'chapters/chapter_001/draft_v2.md',
      'chapters/chapter_001/diagnostics_v2.json',
      'chapters/chapter_001/final.md'
    ]);

    const diagnosticsV1 = await store.readJson(paths.chapterArtifact(1, 'diagnostics_v1.json'), DiagnosticsReportSchema);
    expect(diagnosticsV1.hard_checks.no_unplanned_reveal.passed).toBe(false);
    expect(diagnosticsV1.soft_scores.reader_curiosity).toBe(8.8);
    expect(qualityGate(diagnosticsV1, 8.2).passed).toBe(false);

    const revisionPlan = await store.readJson(paths.chapterArtifact(1, 'revision_plan_v1.json'), RevisionPlanSchema);
    expect(revisionPlan.revision_strategy).toBe('delay_reveal');
    expect(revisionPlan.operations[0]).toMatchObject({
      target: {
        type: 'scene',
        sceneId: 'scene_002'
      },
      reason: 'draft_v1 过早暗示旧收音机与林澈母亲失踪案有关。',
      concrete_instruction: '删除母亲失踪案暗示，把结尾改成十七楼楼层谜题。'
    });

    const draftV2 = await store.readText(paths.chapterArtifact(1, 'draft_v2.md'));
    expect(draftV2).toContain('十七楼只是一个尚未解释的楼层谜题');

    const diagnosticsV2 = await store.readJson(paths.chapterArtifact(1, 'diagnostics_v2.json'), DiagnosticsReportSchema);
    expect(qualityGate(diagnosticsV2, 8.2).passed).toBe(true);
    expect(diagnosticsV2.hard_checks.no_unplanned_reveal.passed).toBe(true);

    const final = await store.readText(paths.chapterArtifact(1, 'final.md'));
    expect(final).toBe(draftV2);
    await expect(store.exists(paths.chapterArtifact(1, 'needs_human_review.md'))).resolves.toBe(false);

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(0);

    const manifest = await store.readJson(paths.runManifest('run_chapter_revision_test'), RunManifestSchema);
    expect(manifest.command).toBe('chapter');
    expect(manifest.status).toBe('success');
    expect(JSON.stringify(manifest.artifacts)).toContain('chapters/chapter_001/final.md');
  });

  test('writes human review artifacts when max revisions are exhausted before the gate passes', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();

    const result = await runChapterRevisionLoop({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      maxRevisions: 0,
      runId: 'run_chapter_human_review_test'
    });

    expect(result.status).toBe('needs_human_review');
    expect(result.artifacts).toEqual([
      'chapters/chapter_001/diagnostics_v1.json',
      'chapters/chapter_001/needs_human_review.md',
      'chapters/chapter_001/failure_report.json'
    ]);

    const failureReport = await store.readJson(paths.chapterArtifact(1, 'failure_report.json'), FailureReportSchema);
    expect(failureReport.reason).toBe('max_revisions_exhausted');
    expect(failureReport.failedDiagnosticsPath).toBe('chapters/chapter_001/diagnostics_v1.json');

    await expect(store.exists(paths.chapterArtifact(1, 'final.md'))).resolves.toBe(false);
    await expect(store.readText(paths.chapterArtifact(1, 'needs_human_review.md'))).resolves.toContain('diagnostics_v1.json');
  });
});
