import path from 'node:path';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { briefPath, fixturesRoot, projectId, promptRoot } from './m16Helpers.js';

export async function preparePlannedProject(tempRoot: string): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m19_build' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m19_plan' });
  return new ProjectPaths(tempRoot, projectId);
}

export async function prepareCommittedChapterOne(tempRoot: string): Promise<ProjectPaths> {
  const paths = await preparePlannedProject(tempRoot);
  await runChapterFullProduction({
    projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    candidates: 3,
    maxRevisions: 2,
    commit: true,
    planningRunId: 'run_m19_ch1_planning',
    draftRunId: 'run_m19_ch1_draft',
    runId: 'run_m19_ch1_revision'
  });
  return paths;
}

export async function readRunManifest(paths: ProjectPaths, runId: string): Promise<Record<string, unknown>> {
  return readJsonRecord(paths.runManifest(runId));
}

export async function readEvents(paths: ProjectPaths, runId: string): Promise<Array<Record<string, unknown>>> {
  const store = new FileStore();
  const text = await store.readText(path.join(paths.runDir(runId), 'events.ndjson'));
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => parseRecord(line));
}

export async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  const store = new FileStore();
  return parseRecord(await store.readText(filePath));
}

export function getArray(record: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} is not an array`);
  }
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`${key} contains a non-record item`);
    }
    return item as Record<string, unknown>;
  });
}

export function getRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${key} is not a record`);
  }
  return value as Record<string, unknown>;
}

function parseRecord(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected JSON object');
  }
  return parsed as Record<string, unknown>;
}
