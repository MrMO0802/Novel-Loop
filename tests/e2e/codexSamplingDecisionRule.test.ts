import { describe, expect, test } from 'vitest';

import { summarizeRuntimeSamples } from '../../src/app/codexRuntimeSampling.js';

describe('M27.8B Codex sampling decision rules', () => {
  test('identifies stable bottlenecks when median and tail are close with low retry rate', () => {
    const summary = summarizeRuntimeSamples([
      sample(1, 10_000),
      sample(2, 10_200),
      sample(3, 10_400),
      sample(4, 10_600),
      sample(5, 10_800)
    ]);

    expect(summary).toMatchObject({
      medianDurationMs: 10_400,
      p90DurationMs: 10_800,
      p95DurationMs: 10_800,
      retryRate: 0,
      schemaValidRate: 1,
      interpretation: {
        varianceLevel: 'low',
        stableBottleneck: true,
        likelyRuntimeVariance: false,
        enoughEvidenceForPromptOptimization: true
      },
      recommendation: 'prompt/context/schema optimization'
    });
  });

  test('identifies runtime variance when the tail is far above median with low retry rate', () => {
    const summary = summarizeRuntimeSamples([
      sample(1, 8_000),
      sample(2, 8_100),
      sample(3, 8_200),
      sample(4, 15_000),
      sample(5, 42_000)
    ]);

    expect(summary.interpretation).toMatchObject({
      varianceLevel: 'high',
      stableBottleneck: false,
      likelyRuntimeVariance: true,
      enoughEvidenceForPromptOptimization: false
    });
    expect(summary.recommendation).toBe('runtime variance strategy / repeated benchmark / timeout tuning');
  });

  test('identifies retry-heavy schema failures as prompt/schema hardening work', () => {
    const summary = summarizeRuntimeSamples([
      sample(1, 12_000, { retryCount: 2, schemaValid: false }),
      sample(2, 11_500, { retryCount: 1, schemaValid: true }),
      sample(3, 12_300, { retryCount: 2, schemaValid: false }),
      sample(4, 11_800, { retryCount: 1, schemaValid: true }),
      sample(5, 12_100, { retryCount: 3, schemaValid: false })
    ]);

    expect(summary.retryRate).toBe(1);
    expect(summary.schemaValidRate).toBe(0.4);
    expect(summary.interpretation).toMatchObject({
      stableBottleneck: false,
      likelyRuntimeVariance: false,
      enoughEvidenceForPromptOptimization: false
    });
    expect(summary.recommendation).toBe('prompt/schema hardening');
  });
});

function sample(sampleNumber: number, durationMs: number, overrides: Partial<Parameters<typeof summarizeRuntimeSamples>[0][number]> = {}): Parameters<typeof summarizeRuntimeSamples>[0][number] {
  return {
    sampleId: `sample_${sampleNumber}`,
    runId: `run_${sampleNumber}`,
    promptCallId: `prompt_${sampleNumber}`,
    durationMs,
    retryCount: 0,
    repairCount: 0,
    schemaValid: true,
    jsonParsed: true,
    promptInputBytes: 100,
    schemaBytes: 50,
    outputBytes: 75,
    artifactPaths: [`audit/codex/samples/sample_${sampleNumber}/parsed_output.json`],
    stateMutated: false,
    ...overrides
  };
}
