import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction as runFullPipeline } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import {
  CanonPatchSchema,
  CommitReportSchema,
  ConflictRepairReportSchema,
  PatchRepairPlanSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m15-repair-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('canon patch conflict recovery', () => {
  test('repairs a timeline conflict, revalidates patch, and commits safely', async () => {
    const paths = await prepareCommittedThreeChapterProject();
    const store = new FileStore();

    const result = await runFullPipeline({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 4,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      mockScenario: 'patch-conflict-timeline',
      repairConflicts: true,
      maxConflictRepairs: 2,
      runId: 'run_m15_repair_ch004_revision'
    });

    expect(result.status).toBe('committed');
    expect(result.repaired).toBe(true);
    expect(result.repairedPatchPath).toBe('chapters/chapter_004/canon_patch_repaired_v1.json');
    expect(result.conflictRepairReportPath).toBe('chapters/chapter_004/conflict_repair_report_v1.json');

    const repairPlan = await store.readJson(paths.chapterArtifact(4, 'patch_repair_plan_v1.json'), PatchRepairPlanSchema);
    expect(repairPlan.operations.map((operation) => operation.operationType)).toContain('append_without_overwrite');

    const repairedPatch = await store.readJson(paths.chapterArtifact(4, 'canon_patch_repaired_v1.json'), CanonPatchSchema);
    expect(repairedPatch.timelineEvents.map((event) => event.order)).toEqual([1, 2]);
    const state = await store.readJson(paths.storyState(), StoryStateSchema);

    const commitReport = await store.readJson(paths.chapterArtifact(4, 'commit_report.json'), CommitReportSchema);
    expect(commitReport).toMatchObject({
      repaired: true,
      repairedPatchPath: 'chapters/chapter_004/canon_patch_repaired_v1.json'
    });
    const repairReport = await store.readJson(paths.chapterArtifact(4, 'conflict_repair_report_v1.json'), ConflictRepairReportSchema);
    expect(repairReport).toMatchObject({
      repaired: true,
      committed: true,
      remainingConflicts: []
    });
    expect(state.latestCommittedChapter).toBe(4);
  });

  test('repair failure enters human review and does not update Story State', async () => {
    const paths = await prepareCommittedThreeChapterProject();
    const store = new FileStore();

    const result = await runFullPipeline({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 4,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      mockScenario: 'patch-conflict-unrepairable',
      repairConflicts: true,
      maxConflictRepairs: 2,
      runId: 'run_m15_unrepairable_ch004_revision'
    });

    expect(result.status).toBe('needs_human_review');
    await expect(store.exists(paths.chapterArtifact(4, 'needs_human_review.md'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(4, 'failure_report.json'))).resolves.toBe(true);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 3 });
  });

  test.each([
    ['patch-conflict-character-state', 'mark_existing_as_superseded'],
    ['patch-conflict-debt-invalid', 'defer_patch_item'],
    ['patch-conflict-reader-leak', 'convert_to_reader_suspicion']
  ])('repairs recoverable mock scenario %s', async (mockScenario, expectedOperation) => {
    const paths = await prepareCommittedThreeChapterProject();
    const store = new FileStore();

    const result = await runFullPipeline({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 4,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      mockScenario,
      repairConflicts: true,
      maxConflictRepairs: 2,
      runId: `run_m15_${mockScenario}`
    });

    expect(result.status).toBe('committed');
    expect(result.repaired).toBe(true);
    const repairPlan = await store.readJson(paths.chapterArtifact(4, 'patch_repair_plan_v1.json'), PatchRepairPlanSchema);
    expect(repairPlan.operations.map((operation) => operation.operationType)).toContain(expectedOperation);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 4 });
  });
});

async function prepareCommittedThreeChapterProject(): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m15_repair_build' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m15_repair_plan' });
  for (const chapterNumber of [1, 2, 3]) {
    await runFullPipeline({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      planningRunId: `run_m15_repair_ch${chapterNumber}_planning`,
      draftRunId: `run_m15_repair_ch${chapterNumber}_draft`,
      runId: `run_m15_repair_ch${chapterNumber}_revision`
    });
  }
  return new ProjectPaths(tempRoot, projectId);
}
