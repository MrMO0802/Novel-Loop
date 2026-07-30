import { describe, expect, test } from 'vitest';

import { normalizeSceneCards } from '../../src/providers/codex/normalizers.js';

const context = {
  projectId: 'scene-card-workload',
  chapterNumber: 1
};

describe('Codex slim scene-card workload normalization', () => {
  test('accepts the documented two-scene desktop workload', () => {
    expect(normalizeSceneCards({ scenes: validScenes() }, context)).toHaveLength(2);
  });

  test.each([
    {
      label: 'more than two scenes',
      mutate: () => [...validScenes(), validScene()]
    },
    {
      label: 'an oversized field',
      mutate: () => [
        { ...validScene(), purpose: 'x'.repeat(2_001) },
        validScene()
      ]
    },
    {
      label: 'more than eight character references',
      mutate: () => [
        {
          ...validScene(),
          characters: Array.from({ length: 9 }, (_, index) => `char_${index}`)
        },
        validScene()
      ]
    },
    {
      label: 'an oversized UTF-8 aggregate',
      mutate: () => [
        cjkHeavyScene(),
        cjkHeavyScene()
      ]
    }
  ])('rejects $label', ({ mutate }) => {
    expect(() => normalizeSceneCards({ scenes: mutate() }, context)).toThrow();
  });
});

function validScenes() {
  return [validScene(), validScene()];
}

function validScene() {
  return {
    purpose: 'Advance the radio mystery.',
    conflict: 'The evidence contradicts the protagonist.',
    entryPoint: 'The radio turns on.',
    exitPoint: 'A new address is heard.',
    location: 'Apartment',
    characters: ['char_lincheng']
  };
}

function cjkHeavyScene() {
  const heavy = '时'.repeat(2_000);
  return {
    purpose: heavy,
    conflict: heavy,
    entryPoint: heavy,
    exitPoint: heavy,
    location: heavy,
    characters: ['char_lincheng']
  };
}
