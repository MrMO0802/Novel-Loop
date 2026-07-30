export const DESKTOP_SLIM_SCENE_COUNT = 2;
export const MAX_SCENE_CARD_FIELD_CHARS = 2_000;
export const MAX_SCENE_CARD_CHARACTERS = 8;
export const MAX_SCENE_CARD_ARRAY_ITEMS = 16;
export const MAX_SCENE_CARDS_BYTES = 32 * 1024;

export const MAX_DESKTOP_PLAN_CANDIDATES = 3;
export const MAX_PLAN_CANDIDATE_SEQUENCE = 999;
export const MAX_PLAN_CANDIDATE_BYTES = 256 * 1024;
export const MAX_PLAN_CANDIDATES_BYTES = 512 * 1024;

export function expectedPlanCandidateId(index: number): string {
  return `plan_${String(index).padStart(3, '0')}`;
}

export function expectedPlanCandidateIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => expectedPlanCandidateId(index + 1));
}

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
