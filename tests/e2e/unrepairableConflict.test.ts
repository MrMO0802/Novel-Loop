import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { ConflictRepairReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m15-unrepairable-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('unrepairable canon patch conflicts', () => {
  test('does not commit when repair output cannot pass schema validation', async () => {
    const paths = await prepareCommittedThreeChapterProject();
    const store = new FileStore();

    const result = await runChapterFullProduction({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 4,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      mockScenario: 'patch-conflict-malformed-repair',
      repairConflicts: true,
      maxConflictRepairs: 2,
      runId: 'run_m15_malformed_repair'
    });

    expect(result.status).toBe('needs_human_review');
    await expect(store.exists(paths.chapterArtifact(4, 'canon_patch_repaired_v1.json'))).resolves.toBe(false);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 3 });
  });

  test('does not commit when repaired patch still has blocking conflicts', async () => {
    const paths = await prepareCommittedThreeChapterProject();
    const store = new FileStore();

    const result = await runChapterFullProduction({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 4,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      mockScenario: 'patch-conflict-still-conflicting',
      repairConflicts: true,
      maxConflictRepairs: 2,
      runId: 'run_m15_still_conflicting'
    });

    expect(result.status).toBe('needs_human_review');
    await expect(store.exists(paths.chapterArtifact(4, 'canon_patch_repaired_v1.json'))).resolves.toBe(true);
    const repairReport = await store.readJson(paths.chapterArtifact(4, 'conflict_repair_report_v1.json'), ConflictRepairReportSchema);
    expect(repairReport.remainingConflicts.length).toBeGreaterThan(0);
    expect(repairReport.committed).toBe(false);
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 3 });
  });

  test('repeated blocked conflict runs create v2 reports instead of overwriting v1', async () => {
    const paths = await prepareCommittedThreeChapterProject();
    const store = new FileStore();

    for (const runId of ['run_m15_conflict_v1', 'run_m15_conflict_v2']) {
      await expect(
        runChapterFullProduction({
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
          runId
        })
      ).rejects.toMatchObject({ code: 'CANON_PATCH_CONFLICT' });
    }

    await expect(store.exists(paths.chapterArtifact(4, 'conflict_report_v1.json'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(4, 'conflict_report_v2.json'))).resolves.toBe(true);
  });
});

async function prepareCommittedThreeChapterProject(): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m15_unrepairable_build' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m15_unrepairable_plan' });
  for (const chapterNumber of [1, 2, 3]) {
    await runChapterFullProduction({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      planningRunId: `run_m15_unrepairable_ch${chapterNumber}_planning`,
      draftRunId: `run_m15_unrepairable_ch${chapterNumber}_draft`,
      runId: `run_m15_unrepairable_ch${chapterNumber}_revision`
    });
  }
  return new ProjectPaths(tempRoot, projectId);
}
