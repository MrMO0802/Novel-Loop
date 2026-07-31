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
import { planGlobal } from '../../src/app/planGlobal.js';
import { CanonPatchSchema, CommitReportSchema, ConflictReportSchema, RunManifestSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { SnapshotStore } from '../../src/storage/SnapshotStore.js';

let tempRoot: string;
let briefPath: string;

const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m9-'));
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

describe('chapter canon patch commit', () => {
  test('runs chapter 1 through final, extracts a canon patch, snapshots before and after, and commits Story State', async () => {
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
      commit: true,
      runId: 'run_chapter_commit_test'
    });

    expect(result.status).toBe('committed');
    expect(result.artifacts).toContain('chapters/chapter_001/canon_patch.json');
    expect(result.artifacts).toContain('chapters/chapter_001/commit_report.json');
    expect(result.artifacts).toContain('state/story_state.json');

    const patch = await store.readJson(paths.chapterArtifact(1, 'canon_patch.json'), CanonPatchSchema);
    expect(patch.sourceFinalPath).toBe('chapters/chapter_001/final.md');
    expect(patch.latestCommittedChapter).toBe(1);
    expect(patch.newFacts.map((fact) => fact.id)).toEqual(['fact_ch001_radio_purchase', 'fact_ch001_radio_distress']);
    expect(patch.characterStates.map((character) => character.id)).toEqual(['char_lincheng']);
    expect(patch.timelineEvents).toHaveLength(2);
    expect(patch.narrativeDebtUpdates[0]?.action).toBe('create');
    expect(patch.foreshadowingUpdates[0]?.action).toBe('create');
    expect(patch.readerStatePatch.addKnows).toContain('旧收音机会在没有电池时播放求救声');
    expect(patch.relationshipUpdates[0]?.fromCharacterId).toBe('char_lincheng');

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(1);
    expect(state.canonFacts.map((fact) => fact.id)).toEqual(['fact_ch001_radio_purchase', 'fact_ch001_radio_distress']);
    expect(state.characters[0]?.id).toBe('char_lincheng');
    expect(state.timeline.map((event) => event.id)).toEqual(['event_ch001_market', 'event_ch001_room']);
    expect(state.readerState.readerKnows).toContain('旧收音机会在没有电池时播放求救声');
    expect(state.readerState.readerQuestions).toContain('十七楼求救声来自哪里？');
    expect(state.narrativeDebts[0]?.id).toBe('debt_ch001_seventeenth_floor');
    expect(state.foreshadowing[0]?.id).toBe('fs_ch001_scratched_floor_number');
    expect(state.relationshipGraph.edges[0]).toMatchObject({
      fromCharacterId: 'char_lincheng',
      toCharacterId: 'obj_old_radio'
    });

    const report = await store.readJson(paths.chapterArtifact(1, 'commit_report.json'), CommitReportSchema);
    const snapshotStore = new SnapshotStore(paths, store);
    const snapshots = await snapshotStore.listSnapshots();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((snapshot) => snapshot.reason).sort()).toEqual(['after_chapter_001_commit', 'before_chapter_001_commit']);
    const beforeSnapshot = await snapshotStore.readSnapshot(report.beforeSnapshot.snapshotId);
    const afterSnapshot = await snapshotStore.readSnapshot(report.afterSnapshot.snapshotId);
    expect(beforeSnapshot.storyState.latestCommittedChapter).toBe(0);
    expect(afterSnapshot.storyState.latestCommittedChapter).toBe(1);

    expect(report.status).toBe('committed');
    expect(report.appliedChanges).toMatchObject({
      canonFactsAdded: 2,
      characterStatesUpserted: 1,
      timelineEventsAdded: 2,
      narrativeDebtsChanged: 1,
      foreshadowingChanged: 1,
      relationshipEdgesChanged: 1,
      latestCommittedChapter: {
        from: 0,
        to: 1
      }
    });
    expect(report.conflicts.hard).toEqual([]);
    expect(snapshots.map((snapshot) => snapshot.path)).toContain(report.beforeSnapshot.path);
    expect(snapshots.map((snapshot) => snapshot.path)).toContain(report.afterSnapshot.path);

    const manifest = await store.readJson(paths.runManifest('run_chapter_commit_test'), RunManifestSchema);
    expect(JSON.stringify(manifest.artifacts)).toContain('chapters/chapter_001/commit_report.json');
  });

  test('does not commit when conflict checks find a hard conflict', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();

    await runChapterRevisionLoop({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      maxRevisions: 2,
      commit: true,
      runId: 'run_chapter_first_commit_test'
    });

    await expect(
      commitChapterState({
        projectId: 'demo-novel',
        projectsRoot: tempRoot,
        chapterNumber: 1,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        runId: 'run_chapter_duplicate_commit_test'
      })
    ).rejects.toMatchObject({ code: 'CANON_PATCH_CONFLICT' });

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(1);
    const conflictReport = await store.readJson(paths.chapterArtifact(1, 'conflict_report_v1.json'), ConflictReportSchema);
    expect(conflictReport.conflicts.some((conflict) => conflict.blocking)).toBe(true);
    const snapshots = await new SnapshotStore(paths, store).listSnapshots();
    expect(snapshots).toHaveLength(2);
  });
});
