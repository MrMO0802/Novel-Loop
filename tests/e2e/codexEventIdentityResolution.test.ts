import { describe, expect, test } from 'vitest';

import {
  decideEvidenceAdjudication,
  evaluateTemporalComparison,
  resolveEventIdentity
} from '../../src/app/codexDiagnosticsEvidenceRules.js';

describe('M27.12B event identity and temporal rules', () => {
  test('same delivery on the same day at midday and 23:17 is a confirmed contradiction', () => {
    const comparison = resolveEventIdentity('cmp_time', event({
      eventId: 'delivery_midday',
      inferredTime: 'midday_peak'
    }), event({
      eventId: 'delivery_log_2317',
      explicitTime: '23:17',
      temporalMode: 'current_event_record'
    }));

    expect(comparison.conclusion).toBe('same_event');
    const rules = evaluateTemporalComparison(comparison);
    expect(rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'same_event_same_day_explicit_time_conflict',
        outcome: 'confirmed_contradiction'
      })
    ]));
    expect(rules.some((rule) => rule.ruleId === 'duplicate_event_repetition')).toBe(false);
  });

  test('different orders are different events and do not produce a duplicate-event contradiction', () => {
    const comparison = resolveEventIdentity('cmp_orders', event({
      eventId: 'order_a',
      objectOrOrder: 'order_a'
    }), event({
      eventId: 'order_b',
      objectOrOrder: 'order_b'
    }));

    expect(comparison.conclusion).toBe('different_events');
    expect(evaluateTemporalComparison(comparison).some((rule) => rule.outcome === 'confirmed_contradiction')).toBe(false);
  });

  test('a false positive recommends prompt calibration and explicitly leaves the draft unchanged', () => {
    const comparison = resolveEventIdentity('cmp_false_positive', event({
      eventId: 'order_a',
      objectOrOrder: 'order_a'
    }), event({
      eventId: 'order_b',
      objectOrOrder: 'order_b'
    }));
    const decision = decideEvidenceAdjudication({
      claimCount: 1,
      draftEvidence: [],
      eventComparisons: [comparison],
      temporalRules: evaluateTemporalComparison(comparison)
    });

    expect(decision.adjudication).toBe('false_positive');
    expect(decision.revisionScopeRecommendation.affectedParagraphs).toEqual([]);
    expect(decision.revisionScopeRecommendation.suggestedRevisionInstruction).toBe('Do not revise the chapter.');
    expect(decision.revisionScopeRecommendation.diagnosticsPromptCalibrationSuggestion).toContain('order and recipient identity');
  });

  test('a memory or historical recording is not merged directly with the current scene', () => {
    const comparison = resolveEventIdentity('cmp_memory', event({
      eventId: 'current_delivery'
    }), event({
      eventId: 'remembered_delivery',
      temporalMode: 'memory'
    }));

    expect(comparison.conclusion).toBe('ambiguous');
    expect(evaluateTemporalComparison(comparison)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'memory_log_history_separation', outcome: 'ambiguous' })
    ]));
  });

  test('unclear day offset remains ambiguous even when event features otherwise match', () => {
    const comparison = resolveEventIdentity('cmp_day', event({
      eventId: 'delivery_day_unknown_a',
      dayReference: 'unknown'
    }), event({
      eventId: 'delivery_day_unknown_b',
      explicitTime: '23:17',
      dayReference: 'unknown'
    }));

    expect(comparison.sameDay).toBeNull();
    expect(evaluateTemporalComparison(comparison)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'unclear_day_offset', outcome: 'ambiguous' })
    ]));
  });
});

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'delivery',
    label: 'delivery handoff',
    sourceType: 'draft' as const,
    sourcePath: 'chapters/chapter_002/draft_v1.md',
    evidenceIds: ['draft_evidence_001'],
    actor: 'lin_che',
    recipient: 'resident_16f',
    location: 'building_3_floor_16',
    objectOrOrder: 'order_ch002_single',
    outcome: 'meal_delivered',
    narrativePurpose: 'deliver_order_and_learn_floor_17_clue',
    temporalMode: 'current' as const,
    explicitTime: null,
    inferredTime: null,
    dayReference: 'chapter_002_continuous_scene',
    ...overrides
  };
}
