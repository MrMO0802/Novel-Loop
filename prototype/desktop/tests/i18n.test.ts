import { describe, expect, test } from 'vitest';
import { t, type MessageKey } from '../src/i18n/t';

if (false) {
  // @ts-expect-error Interpolated messages require their values.
  t('library.words');
  // @ts-expect-error Placeholder names are specific to each message key.
  t('library.words', { chapter: 3 });
  // @ts-expect-error Plain messages do not accept interpolation values.
  t('library.title', { count: 3 });
}

const unsafeT = t as (
  key: MessageKey,
  values?: Record<string, number | string>
) => string;

describe('translations', () => {
  test('interpolates the placeholders required by a message key', () => {
    expect(t('library.chapter', { chapter: 3, title: '回声' })).toBe('第 3 章 · 回声');
  });

  test('throws rather than rendering an unresolved placeholder', () => {
    expect(() => unsafeT('library.words')).toThrow(
      'Missing message value "count" for "library.words".'
    );
  });
});
