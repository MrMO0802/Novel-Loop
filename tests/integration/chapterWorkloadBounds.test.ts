import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import {
  planChapterMission,
  runChapterDryRun
} from '../../src/app/chapterPlanning.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import {
  ChapterQueueSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { validCharacterState } from '../fixtures/schemas/valid.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

const projectId = 'chapter-workload-bounds';
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');
const store = new FileStore();
let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-workload-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Workload Bounds\n\nA radio leads Mara into a closed building.\n'
  });
  await buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    runId: 'workload_bible'
  });
  await planGlobal({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    runId: 'workload_global_plan'
  });
  const state = await store.readJson(paths.storyState(), StoryStateSchema);
  await store.writeJson(paths.storyState(), {
    ...state,
    characters: [validCharacterState]
  }, StoryStateSchema);
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('chapter planning workload bounds', () => {
  test('rejects an over-limit slim scene-card response before write-scene fan-out', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'codex-scene-over-limit');
    await runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      candidates: 3,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      codexJsonRetries: 0,
      codexJsonRepair: false,
      runId: 'workload_scene_plan'
    });
    const callsBefore = await fakePromptCalls(fake.statePath);
    const stateBefore = await sha256(paths.storyState());

    await expect(runChapterUntilDraft({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      codexJsonRetries: 0,
      codexJsonRepair: false,
      runId: 'workload_scene_draft'
    })).rejects.toMatchObject({
      code: 'CHAPTER_SCENE_CARDS_INVALID_PROVIDER_OUTPUT'
    });

    const callsAfter = await fakePromptCalls(fake.statePath);
    expect(callsAfter['planning.generate_scene_cards_slim:json:normal']).toBe(
      (callsBefore['planning.generate_scene_cards_slim:json:normal'] ?? 0) + 1
    );
    expect(
      Object.keys(callsAfter).filter((key) => key.startsWith('production.write_scene:'))
    ).toEqual([]);
    await expect(store.exists(paths.chapterArtifact(1, 'scene_cards.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'scenes'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'draft_v1.md'))).resolves.toBe(false);
    expect(await sha256(paths.storyState())).toBe(stateBefore);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters[0]).toMatchObject({
      status: 'failed',
      currentStage: 'scene_cards',
      failureReason: 'Chapter scene cards contain invalid character references.'
    });
  }, 30_000);

  test.each([
    {
      label: 'a valid three-candidate set plus a fourth file',
      files: [
        ['plan_001.md', '# Plan 001'],
        ['plan_002.md', '# Plan 002'],
        ['plan_003.md', '# Plan 003'],
        ['plan_004.md', '# Plan 004']
      ]
    },
    {
      label: 'an alias filename',
      files: [
        ['plan_001.md', '# Plan 001'],
        ['plan_002.md', '# Plan 002'],
        ['plan_2.md', '# Alias for Plan 002']
      ]
    },
    {
      label: 'aggregate candidate bytes above the bounded budget',
      files: [
        ['plan_001.md', `# Plan 001\n\n${'a'.repeat(220 * 1024)}`],
        ['plan_002.md', `# Plan 002\n\n${'b'.repeat(220 * 1024)}`],
        ['plan_003.md', `# Plan 003\n\n${'c'.repeat(220 * 1024)}`]
      ]
    }
  ])('rejects partial recovery with $label before ranking provider invocation', async ({ files }) => {
    await planChapterMission({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot
    });
    await store.ensureDir(paths.chapterArtifact(1, 'plan_candidates'));
    for (const [fileName, content] of files) {
      await store.writeText(paths.chapterArtifact(1, 'plan_candidates', fileName), content);
    }
    const fake = await writeFakeCodex(projectsRoot, 'valid');
    const stateBefore = await sha256(paths.storyState());

    await expect(runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      candidates: 3,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      codexJsonRetries: 0,
      codexJsonRepair: false,
      runId: 'workload_candidate_recovery'
    })).rejects.toMatchObject({
      code: 'CHAPTER_PLAN_CANDIDATES_INVALID_OUTPUT'
    });

    await expect(store.exists(fake.argsLogPath)).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'ranking.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'selected_plan.md'))).resolves.toBe(false);
    expect(await sha256(paths.storyState())).toBe(stateBefore);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters[0]).toMatchObject({
      status: 'failed',
      currentStage: 'plan_candidates',
      failureReason: 'Chapter plan candidates are invalid.'
    });
  }, 30_000);
});

async function fakePromptCalls(statePath: string): Promise<Record<string, number>> {
  if (!(await store.exists(statePath))) return {};
  const parsed: unknown = JSON.parse(await store.readText(statePath));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number'
    )
  );
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await store.readText(filePath)).digest('hex');
}
