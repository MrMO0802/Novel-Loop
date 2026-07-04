import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { runChapterRevisionLoop } from '../../src/app/chapterRevisionLoop.js';
import { initProject } from '../../src/app/initProject.js';
import { inspectProject } from '../../src/app/inspectProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { validateProject } from '../../src/app/validateProject.js';
import { RunManifestSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

const requiredBaselineFiles = [
  'strategy/story_bible.md',
  'strategy/genre_contract.md',
  'strategy/reader_promise.md',
  'strategy/style_guide.md',
  'planning/global_outline.md',
  'planning/volume_01_outline.md',
  'planning/arc_map.json',
  'planning/chapter_queue.json',
  'state/story_state.json',
  'chapters/chapter_001/mission.json',
  'chapters/chapter_001/ranking.json',
  'chapters/chapter_001/selected_plan.md',
  'chapters/chapter_001/scene_cards.json',
  'chapters/chapter_001/draft_v1.md',
  'chapters/chapter_001/diagnostics_v1.json',
  'chapters/chapter_001/revision_plan_v1.json',
  'chapters/chapter_001/draft_v2.md',
  'chapters/chapter_001/diagnostics_v2.json',
  'chapters/chapter_001/final.md',
  'chapters/chapter_001/canon_patch.json',
  'chapters/chapter_001/commit_report.json'
] as const;

const deterministicJsonArtifacts = [
  'config.json',
  'planning/arc_map.json',
  'planning/chapter_queue.json',
  'state/story_state.json',
  'chapters/chapter_001/mission.json',
  'chapters/chapter_001/ranking.json',
  'chapters/chapter_001/scene_cards.json',
  'chapters/chapter_001/diagnostics_v1.json',
  'chapters/chapter_001/revision_plan_v1.json',
  'chapters/chapter_001/diagnostics_v2.json',
  'chapters/chapter_001/canon_patch.json',
  'chapters/chapter_001/commit_report.json'
] as const;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-release-audit-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('v1 mock baseline release audit', () => {
  test('runs the clean mock baseline and verifies every required artifact class', async () => {
    const paths = await runBaseline(tempRoot);
    const store = new FileStore();

    const validation = await validateProject({ projectId, projectsRoot: tempRoot });
    expect(validation.ok).toBe(true);

    const inspectOutput = await inspectProject({ projectId, projectsRoot: tempRoot, debts: true, reader: true, characters: true });
    expect(inspectOutput).toContain('Latest committed chapter: 1');
    expect(inspectOutput).toContain('Open Narrative Debts');
    expect(inspectOutput).toContain('Reader State');
    expect(inspectOutput).toContain('Characters');

    for (const artifact of requiredBaselineFiles) {
      await expect(store.exists(path.join(paths.projectRoot, artifact))).resolves.toBe(true);
    }

    await expect(listRelativeFiles(paths.chapterArtifact(1, 'plan_candidates'))).resolves.toEqual(['plan_001.md', 'plan_002.md', 'plan_003.md']);
    await expect(listRelativeFiles(paths.chapterArtifact(1, 'scenes'))).resolves.toEqual(['scene_001.md', 'scene_002.md']);
    const snapshots = await listRelativeFiles(paths.snapshotsDir());
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every((file) => file.startsWith('snapshot_') && file.endsWith('.json'))).toBe(true);
    const runs = await listRelativeFiles(paths.runsDir());
    expect(runs.filter((file) => file.endsWith('run_manifest.json'))).toEqual([
      'run_release_build_bible/run_manifest.json',
      'run_release_chapter_draft/run_manifest.json',
      'run_release_chapter_planning/run_manifest.json',
      'run_release_chapter_revision/run_manifest.json',
      'run_release_plan_global/run_manifest.json'
    ]);
    expect(runs.some((file) => file.includes('/prompts/'))).toBe(true);
  });

  test('freezes chapter side effects by mode', async () => {
    const paths = await preparePlannedProject(tempRoot);
    const store = new FileStore();

    await runChapterDryRun({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      candidates: 3,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_side_effect_dry_run'
    });

    await expect(listRelativeFiles(paths.chapterDir(1))).resolves.toEqual([
      'mission.json',
      'plan_candidates/plan_001.md',
      'plan_candidates/plan_002.md',
      'plan_candidates/plan_003.md',
      'ranking.json',
      'selected_plan.md'
    ]);
    await expect(readLatestCommittedChapter(paths, store)).resolves.toBe(0);

    await runChapterUntilDraft({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_side_effect_draft'
    });

    const draftFiles = await listRelativeFiles(paths.chapterDir(1));
    expect(draftFiles).toEqual([
      'draft_v1.md',
      'mission.json',
      'plan_candidates/plan_001.md',
      'plan_candidates/plan_002.md',
      'plan_candidates/plan_003.md',
      'ranking.json',
      'scene_cards.json',
      'scenes/scene_001.md',
      'scenes/scene_002.md',
      'selected_plan.md'
    ]);
    expect(draftFiles).not.toContain('final.md');
    expect(draftFiles).not.toContain('canon_patch.json');
    expect(draftFiles).not.toContain('commit_report.json');
    await expect(readLatestCommittedChapter(paths, store)).resolves.toBe(0);

    await runChapterRevisionLoop({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      maxRevisions: 2,
      runId: 'run_side_effect_revision_no_commit'
    });
    await expect(store.exists(paths.chapterArtifact(1, 'final.md'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
    await expect(readLatestCommittedChapter(paths, store)).resolves.toBe(0);

    await runChapterFullProduction({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      maxRevisions: 2,
      commit: true,
      runId: 'run_side_effect_commit'
    });
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(true);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(true);
    await expect(readLatestCommittedChapter(paths, store)).resolves.toBe(1);
  });

  test('keeps deterministic mock JSON artifacts stable across identical runs', async () => {
    const firstRoot = path.join(tempRoot, 'first');
    const secondRoot = path.join(tempRoot, 'second');
    const firstPaths = await runBaseline(firstRoot);
    const secondPaths = await runBaseline(secondRoot);
    const store = new FileStore();

    for (const artifact of deterministicJsonArtifacts) {
      const first = JSON.parse(await store.readText(path.join(firstPaths.projectRoot, artifact))) as unknown;
      const second = JSON.parse(await store.readText(path.join(secondPaths.projectRoot, artifact))) as unknown;
      expect(normalizeJsonArtifact(artifact, first)).toEqual(normalizeJsonArtifact(artifact, second));
    }

    for (const runId of [
      'run_release_build_bible',
      'run_release_plan_global',
      'run_release_chapter_planning',
      'run_release_chapter_draft',
      'run_release_chapter_revision'
    ]) {
      const firstManifest = await store.readJson(firstPaths.runManifest(runId), RunManifestSchema);
      const secondManifest = await store.readJson(secondPaths.runManifest(runId), RunManifestSchema);
      expect(normalizeRunManifest(firstManifest)).toEqual(normalizeRunManifest(secondManifest));
    }
  });
});

async function runBaseline(projectsRoot: string): Promise<ProjectPaths> {
  const paths = await preparePlannedProject(projectsRoot);
  await runChapterFullProduction({
    projectId,
    projectsRoot,
    chapterNumber: 1,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    candidates: 3,
    maxRevisions: 2,
    commit: true,
    planningRunId: 'run_release_chapter_planning',
    draftRunId: 'run_release_chapter_draft',
    runId: 'run_release_chapter_revision'
  });
  return paths;
}

async function preparePlannedProject(projectsRoot: string): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot });
  await buildBible({ projectId, projectsRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_release_build_bible' });
  await planGlobal({ projectId, projectsRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_release_plan_global' });
  return new ProjectPaths(projectsRoot, projectId);
}

async function readLatestCommittedChapter(paths: ProjectPaths, store: FileStore): Promise<number> {
  const state = await store.readJson(paths.storyState(), StoryStateSchema);
  return state.latestCommittedChapter;
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(path.relative(root, fullPath).split(path.sep).join('/'));
      }
    }
  }

  if ((await stat(root)).isDirectory()) {
    await walk(root);
  }

  return files.sort();
}

function normalizeJsonArtifact(artifact: string, value: unknown): unknown {
  const normalized = structuredClone(value);

  if (artifact === 'state/story_state.json' && isRecord(normalized)) {
    normalized.updatedAt = '<timestamp>';
  }

  if (artifact === 'planning/chapter_queue.json' && isRecord(normalized) && Array.isArray(normalized.chapters)) {
    normalized.chapters = normalized.chapters.map((chapter) =>
      isRecord(chapter)
        ? {
            ...chapter,
            startedAt: chapter.startedAt === null ? null : '<timestamp>',
            updatedAt: chapter.updatedAt === null ? null : '<timestamp>',
            committedAt: chapter.committedAt === null ? null : '<timestamp>'
          }
        : chapter
    );
  }

  if (artifact === 'chapters/chapter_001/commit_report.json' && isRecord(normalized)) {
    normalized.committedAt = '<timestamp>';
    normalized.beforeSnapshot = normalizeSnapshotMeta(normalized.beforeSnapshot);
    normalized.afterSnapshot = normalizeSnapshotMeta(normalized.afterSnapshot);
  }

  return normalized;
}

function normalizeSnapshotMeta(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    snapshotId: '<snapshot>',
    path: '<snapshot-path>',
    createdAt: '<timestamp>',
    runId: '<run>'
  };
}

function normalizeRunManifest(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    runId: '<run>',
    startedAt: '<timestamp>',
    endedAt: '<timestamp>',
    durationMs: '<duration>',
    artifacts: Array.isArray(value.artifacts) ? value.artifacts.map(normalizeArtifactPath) : value.artifacts,
    promptCalls: Array.isArray(value.promptCalls)
      ? value.promptCalls.map(normalizePromptCall)
      : value.promptCalls,
    llmCalls: Array.isArray(value.llmCalls)
      ? value.llmCalls.map(normalizePromptCall)
      : value.llmCalls,
    stages: Array.isArray(value.stages)
      ? value.stages.map((stage) => (isRecord(stage) ? { ...stage, startedAt: '<timestamp>', endedAt: '<timestamp>', durationMs: '<duration>' } : stage))
      : value.stages,
    queueTransitions: Array.isArray(value.queueTransitions)
      ? value.queueTransitions.map((transition) => (isRecord(transition) ? { ...transition, transitionId: '<transition>', timestamp: '<timestamp>' } : transition))
      : value.queueTransitions,
    stateMutations: Array.isArray(value.stateMutations)
      ? value.stateMutations.map((mutation) =>
          isRecord(mutation)
            ? {
                ...mutation,
                mutationId: '<mutation>',
                beforeSnapshotId: mutation.beforeSnapshotId === undefined ? undefined : '<snapshot>',
                afterSnapshotId: mutation.afterSnapshotId === undefined ? undefined : '<snapshot>',
                beforeStateHash: mutation.beforeStateHash === undefined ? undefined : '<state-hash>',
                afterStateHash: mutation.afterStateHash === undefined ? undefined : '<state-hash>'
              }
            : mutation
        )
      : value.stateMutations,
    snapshots: Array.isArray(value.snapshots)
      ? value.snapshots.map((snapshot) => (isRecord(snapshot) ? { ...snapshot, snapshotId: '<snapshot>', path: '<snapshot-path>', stateHash: '<state-hash>' } : snapshot))
      : value.snapshots,
    errors: Array.isArray(value.errors)
      ? value.errors.map((error) => (isRecord(error) ? { ...error, createdAt: error.createdAt === undefined ? undefined : '<timestamp>' } : error))
      : value.errors
  };
}

function normalizeArtifactPath(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/snapshots\/snapshot_[^/]+\.json/g, 'snapshots/<snapshot>.json');
  if (!isRecord(value)) return value;
  return {
    ...value,
    artifactId: typeof value.artifactId === 'string' ? value.artifactId.replace(/snapshot_\d{8}_\d{6}_[a-f0-9]+/g, 'snapshot_<snapshot>') : value.artifactId,
    path: typeof value.path === 'string' ? value.path.replace(/snapshots\/snapshot_[^/]+\.json/g, 'snapshots/<snapshot>.json') : value.path,
    sha256: value.sha256 === undefined ? undefined : '<artifact-hash>',
    sizeBytes: value.sizeBytes === undefined ? undefined : '<artifact-size>'
  };
}

function normalizePromptCall(call: unknown): unknown {
  return isRecord(call)
    ? {
        ...call,
        startedAt: '<timestamp>',
        endedAt: '<timestamp>',
        latencyMs: '<latency>',
        inputHash: '<prompt-input-hash>',
        outputHash: '<prompt-output-hash>'
      }
    : call;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
