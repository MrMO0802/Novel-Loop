import type {
  ChapterMission,
  SceneCards,
  StoryState
} from '../schemas/index.js';
import { AppError } from '../utils/AppError.js';

const ADVANCEABLE_DEBT_STATUSES = new Set([
  'open',
  'escalated',
  'partially_paid'
]);
const STRUCTURED_OUTPUT_FAILURE_CODES = new Set([
  'CODEX_REPAIR_FAILED',
  'CODEX_INVALID_JSON',
  'INVALID_JSON',
  'CODEX_SCHEMA_VALIDATION_FAILED',
  'CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED',
  'SCHEMA_VALIDATION_FAILED'
]);

export function missionDebtReferencesAreValid(
  mission: ChapterMission,
  storyState: StoryState
): boolean {
  const debtsById = new Map(
    storyState.narrativeDebts.map((debt) => [debt.id, debt])
  );
  const seen = new Set<string>();
  for (const debtId of mission.debtsToPayOrAdvance) {
    const debt = debtsById.get(debtId);
    if (
      seen.has(debtId)
      || debt === undefined
      || !ADVANCEABLE_DEBT_STATUSES.has(debt.status)
    ) {
      return false;
    }
    seen.add(debtId);
  }
  return true;
}

export function missionCharacterReferencesAreValid(
  mission: ChapterMission,
  storyState: StoryState
): boolean {
  const committedCharacterIds = new Set(
    storyState.characters.map((character) => character.id)
  );
  const introducedCharacterIds = new Set<string>();
  for (const character of mission.charactersToIntroduce) {
    if (
      committedCharacterIds.has(character.characterId)
      || introducedCharacterIds.has(character.characterId)
    ) {
      return false;
    }
    introducedCharacterIds.add(character.characterId);
  }

  const validCharacterIds = new Set([
    ...committedCharacterIds,
    ...introducedCharacterIds
  ]);
  const participatingCharacterIds = new Set<string>();
  for (const characterId of mission.participatingCharacterIds) {
    if (
      participatingCharacterIds.has(characterId)
      || !validCharacterIds.has(characterId)
    ) {
      return false;
    }
    participatingCharacterIds.add(characterId);
  }

  return mission.characterDeltas.every((delta) => (
    validCharacterIds.has(delta.characterId)
  ));
}

export function missionParticipantSet(
  mission: ChapterMission,
  storyState: StoryState
): ReadonlySet<string> {
  return new Set([
    ...mission.participatingCharacterIds,
    ...mission.characterDeltas.map(({ characterId }) => characterId),
    ...mission.charactersToIntroduce.map(({ characterId }) => characterId)
  ].filter((id) => storyState.characters.some((item) => item.id === id)
    || mission.charactersToIntroduce.some((item) => item.characterId === id)));
}

export function assertMissionHasParticipants(
  mission: ChapterMission,
  storyState: StoryState
): void {
  if (missionParticipantSet(mission, storyState).size > 0) return;
  throw new AppError(
    'CHAPTER_PARTICIPANT_ROSTER_MISSING',
    'Chapter mission must declare at least one valid participant before scene generation.',
    2,
    {
      chapterNumber: mission.chapterNumber,
      stage: 'scene_cards'
    }
  );
}

export function sceneCharacterReferencesAreValid(
  sceneCards: SceneCards,
  storyState: StoryState,
  mission: ChapterMission
): boolean {
  const characterIds = new Set(
    [
      ...storyState.characters.map((character) => character.id),
      ...mission.charactersToIntroduce.map((character) => character.characterId)
    ]
  );
  return sceneCards.every((scene) => {
    const referencedCharacterIds = [
      ...scene.characters,
      ...(scene.povCharacterId === undefined ? [] : [scene.povCharacterId]),
      ...scene.characterDelta.map((delta) => delta.characterId)
    ];
    return scene.characters.length > 0
      && referencedCharacterIds.every((characterId) => characterIds.has(characterId));
  });
}

export function isStructuredOutputFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const providerError = error as Error & {
    code?: unknown;
    classification?: unknown;
  };
  return providerError.classification === 'invalid_output'
    || (
      typeof providerError.code === 'string'
      && STRUCTURED_OUTPUT_FAILURE_CODES.has(providerError.code)
    );
}
