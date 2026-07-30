import type {
  ChapterMission,
  SceneCards,
  StoryState
} from '../schemas/index.js';

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

export function sceneCharacterReferencesAreValid(
  sceneCards: SceneCards,
  storyState: StoryState
): boolean {
  const characterIds = new Set(
    storyState.characters.map((character) => character.id)
  );
  return sceneCards.every((scene) => (
    scene.characters.length > 0
    && scene.characters.every((characterId) => characterIds.has(characterId))
  ));
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
