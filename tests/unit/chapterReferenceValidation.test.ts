import { describe, expect, test } from 'vitest';

import {
  missionCharacterReferencesAreValid,
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
});
