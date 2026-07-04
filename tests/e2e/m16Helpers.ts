import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

export const projectId = 'demo-novel';
export const briefPath = path.resolve('examples/brief.md');
export const promptRoot = path.resolve('prompts');
export const fixturesRoot = path.resolve('fixtures/llm');

export async function createTempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeTempRoot(tempRoot: string): Promise<void> {
  await rm(tempRoot, { recursive: true, force: true });
}

export async function prepareCommittedThreeChapterProject(tempRoot: string): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m16_build' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m16_plan' });

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
      planningRunId: `run_m16_ch${chapterNumber}_planning`,
      draftRunId: `run_m16_ch${chapterNumber}_draft`,
      runId: `run_m16_ch${chapterNumber}_revision`
    });
  }

  return new ProjectPaths(tempRoot, projectId);
}
