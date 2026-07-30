import { describe, expect, test } from 'vitest';

import { normalizeMission } from '../../src/providers/codex/normalizers.js';

describe('Codex slim chapter mission normalization', () => {
  test('preserves bounded narrative promises and character deltas for author review', () => {
    const mission = normalizeMission({
      chapterNumber: 1,
      chapterFunction: 'Open the mystery through the old radio.',
      objectives: ['Advance the radio mystery.'],
      debtsToPayOrAdvance: [],
      debtsToIntroduce: [{
        type: 'mystery',
        promise: 'Why does the radio speak without power?',
        importance: 8
      }],
      characterDeltas: [{
        characterId: 'char_lincheng',
        from: 'skeptical',
        to: 'alert',
        evidenceRequired: 'He hears the broadcast without a power source.'
      }],
      readerKnowledge: ['The radio works without power.'],
      readerQuestions: ['Who is speaking?'],
      forbiddenMoves: ['Do not reveal the caller.']
    }, {
      projectId: 'codex-mission-normalizer',
      chapterNumber: 1
    });

    expect(mission.debtsToIntroduce).toEqual([{
      type: 'mystery',
      promise: 'Why does the radio speak without power?',
      importance: 8
    }]);
    expect(mission.characterDeltas).toEqual([{
      characterId: 'char_lincheng',
      from: 'skeptical',
      to: 'alert',
      evidenceRequired: 'He hears the broadcast without a power source.'
    }]);
  });
});
