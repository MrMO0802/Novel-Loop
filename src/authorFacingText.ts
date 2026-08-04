const MAX_NORMALIZATION_PASSES = 16;
const MAX_NORMALIZED_CHARACTERS = 2 * 1024 * 1024;

export function containsAuthorFacingInternalValue(text: string): boolean {
  const normalization = normalizeAuthorFacingText(text);
  if (!normalization.complete) return true;
  const normalized = normalization.text;
  const withoutWebUrls = normalized.replace(
    /\bhttps?:\/\/[^\s<>{}\[\]"']+/giu,
    ' '
  );
  return (
    /\bfile:\/\//iu.test(normalized)
    || /(?:^|[\s([{"'`=:])\/(?!\/)[^\s<>{}\[\]]+/u.test(withoutWebUrls)
    || /(?:^|[\s([{"'`=:])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/])[^\s<>{}\[\]]*/u
      .test(withoutWebUrls)
    || /(?:^|[\s([{"'`=:])(?:\.{1,2}[\\/])?(?:[A-Za-z0-9_.-]+[\\/])+(?:[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,12})(?=$|[\s`)'\]}>.,;:!?])/u
      .test(withoutWebUrls)
    || /\b(?:author_revision|candidate|chapter|character|char|debt|event|mission|objective|obj|plan|revision|run|scene|task)_[A-Za-z0-9][A-Za-z0-9_-]*\b/iu
      .test(normalized)
    || /\b[a-f0-9]{64}\b/iu.test(normalized)
    || /\b[A-Za-z0-9_.-]+\.schema(?:\.json)?\b/iu.test(normalized)
    || /\b(?:arc_map\.json|chapter_queue\.json|draft\.md|global_outline\.md|mission\.json|ranking\.json|scene_cards\.json|selected_plan\.md|story_state\.json|volume_[0-9]+_outline\.md)\b/iu
      .test(normalized)
    || /\b(?:auth|authorization|candidateId|profile|provider|runId|sourceHash|taskId)\s*[:=]/iu
      .test(normalized)
  );
}

function normalizeAuthorFacingText(text: string): {
  text: string;
  complete: boolean;
} {
  let normalized = text.normalize('NFKC');
  if (normalized.length > MAX_NORMALIZED_CHARACTERS) {
    return { text: '', complete: false };
  }
  for (let pass = 0; pass < MAX_NORMALIZATION_PASSES; pass += 1) {
    const previous = normalized;
    normalized = decodeAuthorFacingHtml(normalized);
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      normalized = normalized.replace(
        /%(25|2e|2f|3a|5c|5f)/giu,
        (_encoded, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))
      );
    }
    normalized = normalized
      .replace(/\\([/._:#?%])/gu, '$1')
      .normalize('NFKC');
    if (normalized.length > MAX_NORMALIZED_CHARACTERS) {
      return { text: '', complete: false };
    }
    if (normalized === previous) {
      return { text: normalized, complete: true };
    }
  }
  return { text: normalized, complete: false };
}

function decodeAuthorFacingHtml(value: string): string {
  return value.replace(
    /&(?:#([0-9]{1,7})|#x([0-9a-f]{1,6})|(amp|sol|bsol|colon|period|lowbar));/giu,
    (entity, decimal: string, hexadecimal: string, named: string) => {
      if (decimal) return safeCodePoint(decimal, 10, entity);
      if (hexadecimal) return safeCodePoint(hexadecimal, 16, entity);
      switch (named.toLowerCase()) {
        case 'amp': return '&';
        case 'sol': return '/';
        case 'bsol': return '\\';
        case 'colon': return ':';
        case 'period': return '.';
        case 'lowbar': return '_';
        default: return entity;
      }
    }
  );
}

function safeCodePoint(value: string, radix: number, fallback: string): string {
  const codePoint = Number.parseInt(value, radix);
  if (
    !Number.isInteger(codePoint)
    || codePoint < 0
    || codePoint > 0x10ffff
    || (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) return fallback;
  return String.fromCodePoint(codePoint);
}
