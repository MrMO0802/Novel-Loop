import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import {
  adoptDesktopChapterDraft,
  readDesktopChapterDraft
} from '../../src/desktop/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

const projectId = 'demo-novel';
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');
let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-desktop-draft-adoption-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  const briefPath = path.join(projectsRoot, 'brief.md');
  await writeFile(briefPath, '# Draft adoption\n\nA recoverable author draft.\n', 'utf8');
  await initProject({ projectId, projectsRoot, briefPath });
  await buildBible({ projectId, projectsRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'build_bible' });
  await planGlobal({ projectId, projectsRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'plan_global' });
  await runChapterDryRun({ projectId, projectsRoot, chapterNumber: 1, candidates: 3, provider: 'mock', promptRoot, fixturesRoot, runId: 'plan_chapter' });
  await runChapterUntilDraft({ projectId, projectsRoot, chapterNumber: 1, provider: 'mock', promptRoot, fixturesRoot, runId: 'draft_chapter' });
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('desktop draft adoption', () => {
  test('creates and activates an author draft revision without changing generated draft or Story State', async () => {
    const store = new FileStore();
    const generatedBefore = await readFile(paths.chapterArtifact(1, 'draft_v1.md'));
    const stateBefore = await readFile(paths.storyState());
    const current = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!current.available) throw new Error('Expected a generated draft.');

    await adoptDesktopChapterDraft({
      projectRoot: paths.projectRoot,
      markdown: `${current.markdown}\n\n作者采用的结尾。\n`,
      expectedSourceHash: createHash('sha256').update(current.markdown).digest('hex')
    });

    expect(await readFile(paths.chapterArtifact(1, 'draft_v1.md'))).toEqual(generatedBefore);
    expect(await readFile(paths.storyState())).toEqual(stateBefore);
    await expect(store.readText(paths.chapterQueue())).resolves.toContain('draft_assembly');
    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
      available: true,
      versionKind: 'author_adopted',
      markdown: expect.stringContaining('作者采用的结尾。')
    });
    await expect(store.exists(paths.chapterArtifact(1, 'author_revisions', 'draft_revision_v1.md'))).resolves.toBe(true);
  }, 30_000);
});
