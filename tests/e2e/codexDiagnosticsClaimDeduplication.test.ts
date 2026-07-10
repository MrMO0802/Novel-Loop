import { describe, expect, test } from 'vitest';

import { deduplicateTimelineEvidenceClaims } from '../../src/app/codexDiagnosticsEvidenceRules.js';

describe('M27.12B diagnostics evidence claim deduplication', () => {
  test('deduplicates five repeated sample observations into two factual claims', () => {
    const evidence = [
      '开篇明确为“午高峰”，备忘录却记录“二十三点十七分”；住户收餐关门后又重复交餐。',
      '午高峰配送与23:17进门时间冲突，同时同一餐袋被住户接过两次。',
      '场景从午高峰连续到二十三点十七分，且收餐和关门过程重复发生。',
      '午高峰与23:17属于同一次配送；住户已经接餐后又出现第二次交餐。',
      '正文无时间跳转却从午高峰写到二十三点十七分，交餐连续出现两次。'
    ];

    const claims = deduplicateTimelineEvidenceClaims(evidence.map((text, index) => ({
      sampleId: `sample_${index + 1}`,
      evidence: text
    })));

    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.normalizedClaim).sort()).toEqual([
      'duplicate_delivery_handoff',
      'midday_vs_23_17_same_delivery'
    ]);
    expect(claims.every((claim) => claim.occurrenceCount === 5)).toBe(true);
    expect(claims.every((claim) => claim.sourceSampleIds.length === 5)).toBe(true);
    expect(new Set(claims.map((claim) => claim.evidenceFingerprint)).size).toBe(2);
  });
});
