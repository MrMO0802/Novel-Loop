import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { commitChapterState } from '../../src/app/chapterCommit.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { runChapterRevisionLoop } from '../../src/app/chapterRevisionLoop.js';
import { initProject } from '../../src/app/initProject.js';
import { inspectProject } from '../../src/app/inspectProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { rollbackProject } from '../../src/app/rollbackProject.js';
import { CommitReportSchema, RollbackReportSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { validCharacterState } from '../fixtures/schemas/valid.js';

let tempRoot: string;
let briefPath: string;

const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m10-'));
  briefPath = path.join(tempRoot, 'brief.md');
  await writeFile(briefPath, '# Demo Brief\n\nA controlled test brief.\n', 'utf8');
  await initProject({ projectId: 'demo-novel', briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId: 'demo-novel', projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_build_bible_test' });
  await planGlobal({ projectId: 'demo-novel', projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_plan_global_test' });
  const paths = new ProjectPaths(tempRoot, 'demo-novel');
  const store = new FileStore();
  const state = await store.readJson(paths.storyState(), StoryStateSchema);
  await store.writeJson(paths.storyState(), {
    ...state,
    characters: [{
      ...validCharacterState,
      knowledge: [],
      lastUpdatedChapter: 0
    }]
  }, StoryStateSchema);
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
  await runChapterRevisionLoop({
    projectId: 'demo-novel',
    projectsRoot: tempRoot,
    chapterNumber: 1,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    maxRevisions: 2,
    commit: true,
    runId: 'run_chapter_commit_test'
  });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('inspect, rollback, and manual chapter commit', () => {
  test('renders selected Story State sections for human inspection', async () => {
    const output = await inspectProject({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      debts: true,
      characters: true,
      reader: true,
      timeline: true,
      foreshadowing: true
    });

    expect(output).toContain('Project: demo-novel');
    expect(output).toContain('Latest committed chapter: 1');
    expect(output).toContain('Open Narrative Debts');
    expect(output).toContain('debt_ch001_seventeenth_floor');
    expect(output).toContain('Characters');
    expect(output).toContain('char_lincheng');
    expect(output).toContain('Reader State');
    expect(output).toContain('旧收音机会在没有电池时播放求救声');
    expect(output).toContain('Timeline');
    expect(output).toContain('event_ch001_room');
    expect(output).toContain('Foreshadowing');
    expect(output).toContain('fs_ch001_scratched_floor_number');
  });

  test('rolls back Story State without deleting chapter artifacts, then recommits from existing final.md', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();
    const originalReport = await store.readJson(paths.chapterArtifact(1, 'commit_report.json'), CommitReportSchema);

    const rollback = await rollbackProject({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      snapshotId: originalReport.beforeSnapshot.snapshotId
    });

    expect(rollback.artifacts).toEqual(['state/story_state.json', 'state/rollback_report.json']);
    const rolledBackState = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(rolledBackState.latestCommittedChapter).toBe(0);
    await expect(store.exists(paths.chapterArtifact(1, 'final.md'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(true);
    await expect(store.exists(paths.runManifest('run_chapter_commit_test'))).resolves.toBe(true);

    const rollbackReport = await store.readJson(path.join(paths.stateDir(), 'rollback_report.json'), RollbackReportSchema);
    expect(rollbackReport.snapshotId).toBe(originalReport.beforeSnapshot.snapshotId);
    expect(rollbackReport.restoredLatestCommittedChapter).toBe(0);
    expect(rollbackReport.preservedArtifacts).toBe(true);

    const recommit = await commitChapterState({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_commit_chapter_after_rollback'
    });

    expect(recommit.report.status).toBe('committed');
    expect(recommit.report.appliedChanges.latestCommittedChapter).toEqual({ from: 0, to: 1 });
    const recommittedState = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(recommittedState.latestCommittedChapter).toBe(1);
  });
});
