import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { inspectProject } from '../../src/app/inspectProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { validateProject } from '../../src/app/validateProject.js';
import {
  ArcMapSchema,
  CanonPatchSchema,
  ChapterMissionSchema,
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  CommitReportSchema,
  DiagnosticsReportSchema,
  RevisionPlanSchema,
  RunManifestSchema,
  SceneCardsSchema,
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
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-e2e-demo-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('mock demo e2e', () => {
  test('initializes, plans, drafts, revises, commits, inspects, and validates chapter 1 without real API keys', async () => {
    const paths = new ProjectPaths(tempRoot, projectId);
    const store = new FileStore();

    await initProject({ projectId, briefPath, projectsRoot: tempRoot });
    const bible = await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_demo_build_bible' });
    const globalPlan = await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_demo_plan_global' });
    const committed = await runChapterFullProduction({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      planningRunId: 'run_demo_chapter_planning',
      draftRunId: 'run_demo_chapter_draft',
      runId: 'run_demo_chapter_commit'
    });

    expect(committed.status).toBe('committed');
    const validation = await validateProject({ projectId, projectsRoot: tempRoot });
    expect(validation.ok).toBe(true);

    const inspectOutput = await inspectProject({ projectId, projectsRoot: tempRoot, debts: true, reader: true, characters: true });
    expect(inspectOutput).toContain('Latest committed chapter: 1');
    expect(inspectOutput).toContain('debt_ch001_seventeenth_floor');
    expect(inspectOutput).toContain('旧收音机会在没有电池时播放求救声');
    expect(inspectOutput).toContain('char_lincheng');

    const resultArtifacts = [...bible.artifacts, ...globalPlan.artifacts, ...committed.artifacts];
    expect(resultArtifacts.every(isSpecRelativeArtifactPath)).toBe(true);

    const expectedArtifacts = [
      'strategy/story_bible.md',
      'strategy/genre_contract.md',
      'strategy/reader_promise.md',
      'strategy/style_guide.md',
      'planning/global_outline.md',
      'planning/volume_01_outline.md',
      'planning/arc_map.json',
      'planning/chapter_queue.json',
      'chapters/chapter_001/mission.json',
      'chapters/chapter_001/plan_candidates/plan_001.md',
      'chapters/chapter_001/plan_candidates/plan_002.md',
      'chapters/chapter_001/plan_candidates/plan_003.md',
      'chapters/chapter_001/ranking.json',
      'chapters/chapter_001/selected_plan.md',
      'chapters/chapter_001/scene_cards.json',
      'chapters/chapter_001/scenes/scene_001.md',
      'chapters/chapter_001/scenes/scene_002.md',
      'chapters/chapter_001/draft_v1.md',
      'chapters/chapter_001/diagnostics_v1.json',
      'chapters/chapter_001/revision_plan_v1.json',
      'chapters/chapter_001/draft_v2.md',
      'chapters/chapter_001/diagnostics_v2.json',
      'chapters/chapter_001/final.md',
      'chapters/chapter_001/canon_patch.json',
      'state/story_state.json',
      'chapters/chapter_001/commit_report.json'
    ];
    for (const artifact of expectedArtifacts) {
      expect(resultArtifacts).toContain(artifact);
      await expect(store.exists(path.join(paths.projectRoot, artifact))).resolves.toBe(true);
    }

    const snapshotArtifacts = committed.artifacts.filter((artifact) => artifact.startsWith('snapshots/'));
    expect(snapshotArtifacts).toHaveLength(2);
    for (const snapshotArtifact of snapshotArtifacts) {
      expect(isSpecRelativeArtifactPath(snapshotArtifact)).toBe(true);
      await expect(store.exists(path.join(paths.projectRoot, snapshotArtifact))).resolves.toBe(true);
    }

    await expect(store.readJson(path.join(paths.planningDir(), 'arc_map.json'), ArcMapSchema)).resolves.toMatchObject({ projectId });
    await expect(store.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema)).resolves.toMatchObject({ projectId });
    await expect(store.readJson(paths.chapterArtifact(1, 'mission.json'), ChapterMissionSchema)).resolves.toMatchObject({ chapterNumber: 1 });
    await expect(store.readJson(paths.chapterArtifact(1, 'ranking.json'), ChapterPlanRankingSchema)).resolves.toMatchObject({ selectedCandidateId: 'plan_002' });
    await expect(store.readJson(paths.chapterArtifact(1, 'scene_cards.json'), SceneCardsSchema)).resolves.toHaveLength(2);
    await expect(store.readJson(paths.chapterArtifact(1, 'diagnostics_v1.json'), DiagnosticsReportSchema)).resolves.toMatchObject({
      hard_checks: {
        no_unplanned_reveal: {
          passed: false
        }
      }
    });
    await expect(store.readJson(paths.chapterArtifact(1, 'revision_plan_v1.json'), RevisionPlanSchema)).resolves.toMatchObject({ fromDraftVersion: 1 });
    await expect(store.readJson(paths.chapterArtifact(1, 'diagnostics_v2.json'), DiagnosticsReportSchema)).resolves.toMatchObject({
      hard_checks: {
        no_unplanned_reveal: {
          passed: true
        }
      }
    });
    await expect(store.readJson(paths.chapterArtifact(1, 'canon_patch.json'), CanonPatchSchema)).resolves.toMatchObject({ latestCommittedChapter: 1 });
    await expect(store.readJson(paths.chapterArtifact(1, 'commit_report.json'), CommitReportSchema)).resolves.toMatchObject({ status: 'committed' });
    await expect(store.readJson(paths.storyState(), StoryStateSchema)).resolves.toMatchObject({ latestCommittedChapter: 1 });

    for (const runId of ['run_demo_build_bible', 'run_demo_plan_global', 'run_demo_chapter_planning', 'run_demo_chapter_draft', 'run_demo_chapter_commit']) {
      const manifest = await store.readJson(paths.runManifest(runId), RunManifestSchema);
      expect(manifest.status).toBe('success');
      expect(manifest.artifacts.every((artifact) => isSpecRelativeArtifactPath(artifactPathFromManifestRecord(artifact)))).toBe(true);
    }
  });
});

function artifactPathFromManifestRecord(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'path' in value && typeof value.path === 'string') return value.path;
  return '';
}

function isSpecRelativeArtifactPath(value: string): boolean {
  return !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every((segment) => segment.length > 0);
}
