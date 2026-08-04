import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { generateSceneCards } from '../../src/app/chapterDrafting.js';
import { ProviderFactory } from '../../src/llm/ProviderFactory.js';
import {
  ChapterMissionSchema,
  ChapterQueueSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import {
  validChapterMission,
  validStoryState
} from '../fixtures/schemas/valid.js';

const projectId = 'desktop-participant-repair';
const promptRoot = path.resolve('prompts');

let projectsRoot: string;
let paths: ProjectPaths;
let store: FileStore;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-participant-repair-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await new FileStore().ensureDir(paths.projectRoot);
  store = FileStore.forProject(paths.projectRoot);
  await store.ensureDir(paths.chapterDir(1));
  await store.ensureDir(paths.planningDir());
  await store.writeJson(paths.chapterQueue(), {
    schemaVersion: '1.0',
    projectId,
    chapters: [{
      chapterNumber: 1,
      status: 'planned_ready',
      currentStage: 'ranking',
      completedStages: ['mission', 'plan_candidates', 'ranking']
    }]
  }, ChapterQueueSchema);
  await store.writeText(
    paths.chapterArtifact(1, 'selected_plan.md'),
    '# Participant repair\n\nUse only mission participants.\n'
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('desktop chapter participant preflight', () => {
  test('rejects the failed-project empty roster before any scene-card provider call', async () => {
    await writeStoryState([]);
    await writeMission({
      participatingCharacterIds: [],
      charactersToIntroduce: [],
      characterDeltas: []
    });
    const complete = vi.fn().mockResolvedValue(sceneResponse('char_unused'));
    vi.spyOn(ProviderFactory, 'create').mockReturnValue({ complete });
    const stateBefore = await sha256(paths.storyState());

    const error = await generateSceneCards({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot
    }, store).then(() => undefined, (caught: unknown) => caught);

    expect(complete).not.toHaveBeenCalled();
    expect(error).toMatchObject({ code: 'CHAPTER_PARTICIPANT_ROSTER_MISSING' });
    expect(await sha256(paths.storyState())).toBe(stateBefore);
  });

  test('rejects a duplicate nonempty participant roster before any scene-card provider call', async () => {
    await writeStoryState([{
      ...validStoryState.characters[0],
      id: 'char_committed',
      name: 'Mara Vale'
    }]);
    await writeMission({
      participatingCharacterIds: ['char_committed', 'char_committed'],
      charactersToIntroduce: [],
      characterDeltas: []
    });
    const complete = vi.fn().mockResolvedValue(sceneResponse('char_committed'));
    vi.spyOn(ProviderFactory, 'create').mockReturnValue({ complete });

    const error = await generateSceneCards({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot
    }, store).then(() => undefined, (caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'CHAPTER_MISSION_INVALID_CHARACTER_REFERENCES'
    });
    expect(complete).not.toHaveBeenCalled();
  });

  test('rejects an unknown nonempty participant before any scene-card provider call', async () => {
    await writeStoryState([{
      ...validStoryState.characters[0],
      id: 'char_committed',
      name: 'Mara Vale'
    }]);
    await writeMission({
      participatingCharacterIds: ['char_committed', 'char_unknown'],
      charactersToIntroduce: [],
      characterDeltas: []
    });
    const complete = vi.fn().mockResolvedValue(sceneResponse('char_committed'));
    vi.spyOn(ProviderFactory, 'create').mockReturnValue({ complete });

    const error = await generateSceneCards({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot
    }, store).then(() => undefined, (caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'CHAPTER_MISSION_INVALID_CHARACTER_REFERENCES'
    });
    expect(complete).not.toHaveBeenCalled();
  });

  test('sends a committed mission participant as an ID/name map and accepts its scene references', async () => {
    await writeStoryState([{
      ...validStoryState.characters[0],
      id: 'char_committed',
      name: 'Mara Vale'
    }]);
    await writeMission({
      participatingCharacterIds: ['char_committed'],
      charactersToIntroduce: [],
      characterDeltas: []
    });
    const complete = vi.fn().mockResolvedValue(sceneResponse('char_committed'));
    vi.spyOn(ProviderFactory, 'create').mockReturnValue({ complete });

    const result = await generateSceneCards({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot
    }, store);

    expect(result.sceneCards.every((scene) => scene.characters.includes('char_committed')))
      .toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[0].user).toContain(
      '"id": "char_committed"'
    );
    expect(complete.mock.calls[0]?.[0].user).toContain('"name": "Mara Vale"');
  });

  test('sends a provisional introduced participant and accepts its scene references', async () => {
    await writeStoryState([]);
    await writeMission({
      participatingCharacterIds: ['char_provisional_0123456789abcdef'],
      charactersToIntroduce: [{
        characterId: 'char_provisional_0123456789abcdef',
        name: 'Lin Mo',
        role: 'investigator'
      }],
      characterDeltas: []
    });
    const complete = vi.fn().mockResolvedValue(
      sceneResponse('char_provisional_0123456789abcdef')
    );
    vi.spyOn(ProviderFactory, 'create').mockReturnValue({ complete });

    const result = await generateSceneCards({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot
    }, store);

    expect(result.sceneCards[0]?.characters)
      .toEqual(['char_provisional_0123456789abcdef']);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[0].user).toContain(
      '"id": "char_provisional_0123456789abcdef"'
    );
    expect(complete.mock.calls[0]?.[0].user).toContain('"name": "Lin Mo"');
  });
});

async function writeStoryState(
  characters: typeof validStoryState.characters
): Promise<void> {
  await store.writeJson(paths.storyState(), {
    ...validStoryState,
    projectId,
    latestCommittedChapter: 0,
    characters
  }, StoryStateSchema);
}

async function writeMission(overrides: {
  participatingCharacterIds: string[];
  charactersToIntroduce: Array<{
    characterId: string;
    name: string;
    role: string;
  }>;
  characterDeltas: Array<{
    characterId: string;
    from: string;
    to: string;
    evidenceRequired: string;
  }>;
}): Promise<void> {
  await store.writeJson(paths.chapterArtifact(1, 'mission.json'), {
    ...validChapterMission,
    chapterNumber: 1,
    debtsToPayOrAdvance: [],
    ...overrides
  }, ChapterMissionSchema);
}

function sceneResponse(characterId: string) {
  const json = {
    scenes: [
      {
        purpose: 'Establish the clue.',
        conflict: 'The evidence appears impossible.',
        entryPoint: 'The participant enters the archive.',
        exitPoint: 'A hidden record is found.',
        location: 'Archive',
        characters: [characterId]
      },
      {
        purpose: 'Escalate the investigation.',
        conflict: 'The record contradicts the witness.',
        entryPoint: 'The participant compares accounts.',
        exitPoint: 'The next lead is identified.',
        location: 'Office',
        characters: [characterId]
      }
    ]
  };
  return { text: JSON.stringify(json), json };
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await store.readText(filePath))
    .digest('hex');
}
