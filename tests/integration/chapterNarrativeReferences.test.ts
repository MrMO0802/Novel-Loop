import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import {
  ChapterMissionSchema,
  ChapterQueueSchema,
  RunManifestSchema,
  SceneCardsSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import {
  validCharacterState,
  validNarrativeDebt
} from '../fixtures/schemas/valid.js';
import {
  type FakeCodexMode,
  writeFakeCodex
} from '../helpers/fakeCodex.js';

const projectId = 'chapter-narrative-references';
const promptRoot = path.resolve('prompts');
const store = new FileStore();
let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-narrative-refs-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Narrative References\n\nMara Vale follows an impossible broadcast.\n'
  });
  await buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    runId: 'narrative_refs_bible'
  });
  await planGlobal({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    runId: 'narrative_refs_global_plan'
  });
  const storyState = await store.readJson(paths.storyState(), StoryStateSchema);
  await store.writeJson(paths.storyState(), {
    ...storyState,
    characters: [{
      ...validCharacterState,
      id: 'char_mara',
      name: 'Mara Vale',
      currentGoal: 'Trace the impossible broadcast.',
      lastUpdatedChapter: 0
    }],
    narrativeDebts: [
      {
        ...validNarrativeDebt,
        id: 'debt_open',
        status: 'open',
        relatedCharacters: ['char_mara']
      },
      {
        ...validNarrativeDebt,
        id: 'debt_resolved',
        status: 'resolved',
        relatedCharacters: ['char_mara']
      }
    ]
  }, StoryStateSchema);
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('chapter narrative reference integrity', () => {
  test('allows an explicitly declared first-chapter character without mutating Story State', async () => {
    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    await store.writeJson(paths.storyState(), {
      ...state,
      characters: []
    }, StoryStateSchema);
    const stateBefore = await sha256(paths.storyState());
    const fake = await writeFakeCodex(projectsRoot, 'valid');

    await runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'introduced_character_plan'
    });
    await runChapterUntilDraft({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'introduced_character_draft'
    });

    const mission = await store.readJson(
      paths.chapterArtifact(1, 'mission.json'),
      ChapterMissionSchema
    );
    expect(mission.charactersToIntroduce).toEqual([{
      characterId: 'char_lincheng',
      name: 'Lin Cheng',
      role: 'protagonist'
    }]);
    const cards = await store.readJson(
      paths.chapterArtifact(1, 'scene_cards.json'),
      SceneCardsSchema
    );
    expect(cards.every((card) => (
      card.characters.length > 0
      && card.characters.every((characterId) => characterId === 'char_lincheng')
    ))).toBe(true);
    expect(await sha256(paths.storyState())).toBe(stateBefore);
  }, 30_000);

  test.each([
    ['unknown', 'codex-mission-unknown-debt'],
    ['duplicate', 'codex-mission-duplicate-debt'],
    ['resolved-only', 'codex-mission-resolved-debt']
  ] as const)('rejects a %s mission debt reference before planning artifacts are written', async (_label, mode) => {
    const fake = await writeFakeCodex(projectsRoot, mode);
    const stateBefore = await sha256(paths.storyState());
    const runId = `mission_reference_${mode}`;

    await expect(runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId
    })).rejects.toMatchObject({
      code: 'CHAPTER_MISSION_INVALID_PROVIDER_OUTPUT'
    });

    await expect(store.exists(paths.chapterArtifact(1, 'mission.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'plan_candidates'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'ranking.json'))).resolves.toBe(false);
    expect(await sha256(paths.storyState())).toBe(stateBefore);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters[0]).toMatchObject({
      status: 'failed',
      currentStage: 'mission',
      failureReason: 'Chapter mission contains invalid narrative references.'
    });
    expect(queue.chapters[0].failureReason).not.toMatch(/debt_unknown|debt_open|debt_resolved|story_state/i);
    const manifest = await store.readJson(paths.runManifest(runId), RunManifestSchema);
    expect(manifest.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CHAPTER_MISSION_INVALID_PROVIDER_OUTPUT' })
    ]));
  }, 30_000);

  test('rejects a schema-valid reused mission with stale narrative references before provider fan-out', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'codex-mission-non-default-character');
    await preparePlan(fake.codexBin, 'codex-mission-non-default-character');
    const missionPath = paths.chapterArtifact(1, 'mission.json');
    const mission = await store.readJson(missionPath, ChapterMissionSchema);
    await store.writeJson(missionPath, {
      ...mission,
      debtsToPayOrAdvance: ['debt_unknown']
    }, ChapterMissionSchema);
    const callsBefore = await store.readText(fake.argsLogPath);
    const stateBefore = await sha256(paths.storyState());

    await expect(runChapterDryRun({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'reused_mission_reference_rejected'
    })).rejects.toMatchObject({
      code: 'CHAPTER_MISSION_INVALID_PROVIDER_OUTPUT'
    });

    expect(await store.readText(fake.argsLogPath)).toBe(callsBefore);
    expect(await sha256(paths.storyState())).toBe(stateBefore);
  }, 30_000);

  test('supplies canonical character context and accepts only its non-default ID in scene cards', async () => {
    const mode: FakeCodexMode = 'codex-scene-non-default-character';
    const fake = await writeFakeCodex(projectsRoot, mode);
    await preparePlan(fake.codexBin, mode);
    const runId = 'scene_non_default_character';

    await runChapterUntilDraft({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId
    });

    const cards = await store.readJson(paths.chapterArtifact(1, 'scene_cards.json'), SceneCardsSchema);
    expect(cards.every((card) => (
      card.characters.length > 0
      && card.characters.every((characterId) => characterId === 'char_mara')
    ))).toBe(true);
    const request = await store.readText(path.join(
      paths.runDir(runId),
      'prompts',
      'planning_generate_scene_cards_slim_request.md'
    ));
    expect(request).toContain('<character_id_name_map>');
    expect(request).toContain('"id": "char_mara"');
    expect(request).toContain('"name": "Mara Vale"');
    expect(request).toContain('<mission_character_refs>');
    expect(request).toContain('"char_mara"');
    expect(request).not.toContain('char_lincheng');
  }, 30_000);

  test.each([
    ['unknown ID', 'codex-scene-unknown-character'],
    ['display name', 'codex-scene-display-name'],
    ['empty character list', 'codex-scene-empty-characters']
  ] as const)('rejects scene cards containing an %s before draft fan-out', async (_label, mode) => {
    const fake = await writeFakeCodex(projectsRoot, mode);
    await preparePlan(fake.codexBin, mode);
    const stateBefore = await sha256(paths.storyState());
    const runId = `scene_reference_${mode}`;

    await expect(runChapterUntilDraft({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId
    })).rejects.toMatchObject({
      code: 'CHAPTER_SCENE_CARDS_INVALID_PROVIDER_OUTPUT'
    });

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
    expect(queue.chapters[0].failureReason).not.toMatch(/char_unknown|Mara Vale|story_state/i);
    const manifest = await store.readJson(paths.runManifest(runId), RunManifestSchema);
    expect(manifest.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CHAPTER_SCENE_CARDS_INVALID_PROVIDER_OUTPUT' })
    ]));
  }, 30_000);

  test('rejects schema-valid reused scene cards with an undeclared character before draft fan-out', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'codex-scene-non-default-character');
    await preparePlan(fake.codexBin, 'codex-scene-non-default-character');
    await runChapterUntilDraft({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'reused_scene_reference_prerequisite'
    });
    const cardsPath = paths.chapterArtifact(1, 'scene_cards.json');
    const cards = await store.readJson(cardsPath, SceneCardsSchema);
    await store.writeJson(cardsPath, cards.map((card, index) => (
      index === 0 ? { ...card, characters: ['char_unknown'] } : card
    )), SceneCardsSchema);
    const callsBefore = await store.readText(fake.argsLogPath);
    const stateBefore = await sha256(paths.storyState());

    await expect(runChapterUntilDraft({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'reused_scene_reference_rejected'
    })).rejects.toMatchObject({
      code: 'CHAPTER_SCENE_CARDS_INVALID_PROVIDER_OUTPUT'
    });

    expect(await store.readText(fake.argsLogPath)).toBe(callsBefore);
    expect(await sha256(paths.storyState())).toBe(stateBefore);
  }, 30_000);
});

async function preparePlan(codexBin: string, mode: FakeCodexMode): Promise<void> {
  await runChapterDryRun({
    projectId,
    projectsRoot,
    chapterNumber: 1,
    provider: 'codex-text',
    promptRoot,
    codexBin,
    runId: `scene_plan_${mode}`
  });
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await store.readText(filePath)).digest('hex');
}
