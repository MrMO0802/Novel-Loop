import { describe, expect, test } from 'vitest';

import {
  assertMissionHasParticipants,
  missionCharacterReferencesAreValid,
  missionParticipantSet,
  sceneCharacterReferencesAreValid
} from '../../src/app/chapterReferenceValidation.js';
import {
  ChapterMissionSchema,
  SceneCardsSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import {
  validChapterMission,
  validSceneCard,
  validStoryState
} from '../fixtures/schemas/valid.js';

describe('chapter character reference validation', () => {
  test('defaults the backward-compatible participant roster to empty', () => {
    const mission = ChapterMissionSchema.parse(validChapterMission);

    expect(mission.participatingCharacterIds).toEqual([]);
  });

  test('collects valid explicit, changed, and introduced mission participants', () => {
    const storyState = StoryStateSchema.parse(validStoryState);
    const mission = ChapterMissionSchema.parse({
      ...validChapterMission,
      participatingCharacterIds: ['char_lincheng', 'char_new'],
      charactersToIntroduce: [{
        characterId: 'char_new',
        name: 'New Character',
        role: 'witness'
      }],
      characterDeltas: [{
        characterId: 'char_new',
        from: 'silent',
        to: 'cooperative',
        evidenceRequired: 'The witness answers one question.'
      }]
    });

    expect([...missionParticipantSet(mission, storyState)])
      .toEqual(['char_lincheng', 'char_new']);
    expect(() => assertMissionHasParticipants(mission, storyState)).not.toThrow();
  });

  test('rejects an empty participant roster with the dedicated engine error', () => {
    const storyState = StoryStateSchema.parse({
      ...validStoryState,
      characters: []
    });
    const mission = ChapterMissionSchema.parse({
      ...validChapterMission,
      debtsToPayOrAdvance: [],
      participatingCharacterIds: [],
      characterDeltas: [],
      charactersToIntroduce: []
    });

    expect(() => assertMissionHasParticipants(mission, storyState)).toThrow(
      expect.objectContaining({ code: 'CHAPTER_PARTICIPANT_ROSTER_MISSING' })
    );
  });

  test('accepts a provisional character declared by the mission', () => {
    const storyState = StoryStateSchema.parse({
      ...validStoryState,
      characters: []
    });
    const mission = ChapterMissionSchema.parse({
      ...validChapterMission,
      debtsToPayOrAdvance: [],
      charactersToIntroduce: [{
        characterId: 'char_lincheng',
        name: '林澈',
        role: 'protagonist'
      }]
    });
    const sceneCards = SceneCardsSchema.parse([{
      ...validSceneCard,
      characters: ['char_lincheng']
    }]);

    expect(missionCharacterReferencesAreValid(mission, storyState)).toBe(true);
    expect(sceneCharacterReferencesAreValid(sceneCards, storyState, mission)).toBe(true);
  });

  test('rejects a provisional character that collides with committed Story State', () => {
    const storyState = StoryStateSchema.parse(validStoryState);
    const mission = ChapterMissionSchema.parse({
      ...validChapterMission,
      charactersToIntroduce: [{
        characterId: 'char_lincheng',
        name: '林澈',
        role: 'protagonist'
      }]
    });

    expect(missionCharacterReferencesAreValid(mission, storyState)).toBe(false);
  });

  test('rejects duplicate provisional IDs and undeclared character deltas', () => {
    const storyState = StoryStateSchema.parse({
      ...validStoryState,
      characters: []
    });
    const duplicateMission = ChapterMissionSchema.parse({
      ...validChapterMission,
      debtsToPayOrAdvance: [],
      charactersToIntroduce: [
        { characterId: 'char_lincheng', name: '林澈', role: 'protagonist' },
        { characterId: 'char_lincheng', name: '另一个林澈', role: 'supporting' }
      ]
    });
    const unknownDeltaMission = ChapterMissionSchema.parse({
      ...validChapterMission,
      debtsToPayOrAdvance: [],
      charactersToIntroduce: [],
      characterDeltas: [{
        characterId: 'char_unknown',
        from: 'unknown',
        to: 'unknown',
        evidenceRequired: 'none'
      }]
    });

    expect(missionCharacterReferencesAreValid(duplicateMission, storyState)).toBe(false);
    expect(missionCharacterReferencesAreValid(unknownDeltaMission, storyState)).toBe(false);
  });

  test('rejects duplicate and undeclared participating character IDs', () => {
    const storyState = StoryStateSchema.parse(validStoryState);
    const duplicateMission = ChapterMissionSchema.parse({
      ...validChapterMission,
      participatingCharacterIds: ['char_lincheng', 'char_lincheng']
    });
    const unknownMission = ChapterMissionSchema.parse({
      ...validChapterMission,
      participatingCharacterIds: ['char_unknown']
    });

    expect(missionCharacterReferencesAreValid(duplicateMission, storyState)).toBe(false);
    expect(missionCharacterReferencesAreValid(unknownMission, storyState)).toBe(false);
  });

  test.each([
    ['point-of-view character', {
      ...validSceneCard,
      characters: ['char_lincheng'],
      povCharacterId: 'char_unknown'
    }],
    ['character delta', {
      ...validSceneCard,
      characters: ['char_lincheng'],
      characterDelta: [{
        characterId: 'char_unknown',
        change: 'Appears without being declared.'
      }]
    }]
  ])('rejects an undeclared %s reference in a scene card', (_label, sceneCard) => {
    const storyState = StoryStateSchema.parse(validStoryState);
    const mission = ChapterMissionSchema.parse({
      ...validChapterMission,
      charactersToIntroduce: []
    });
    const sceneCards = SceneCardsSchema.parse([sceneCard]);

    expect(sceneCharacterReferencesAreValid(sceneCards, storyState, mission)).toBe(false);
  });
});
