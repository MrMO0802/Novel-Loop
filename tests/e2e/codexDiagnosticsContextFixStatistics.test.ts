import { describe, expect, test } from 'vitest';

import {
  buildCodexDiagnosticsBenchmarkReport,
  buildCodexDiagnosticsContextFixReport
} from '../../src/app/codexDiagnosticsHardFailAnalysis.js';

describe('M27.12A diagnostics benchmark statistics', () => {
  test('schema-invalid samples are excluded from the valid hard-fail denominator', () => {
    const report = buildCodexDiagnosticsBenchmarkReport('demo-novel', 2, [
      sample('valid-pass', true, true),
      sample('invalid', false, false)
    ], 1, 'enhanced', 'chapters/chapter_002/diagnostics_context_manifest_v1.json');

    expect(report.totalSampleCount).toBe(2);
    expect(report.schemaValidSampleCount).toBe(1);
    expect(report.schemaInvalidSampleCount).toBe(1);
    expect(report.hardFailCountAmongSchemaValidSamples).toBe(0);
    expect(report.hardFailRateAmongSchemaValidSamples).toBe(0);
    expect(report.observedFailureRateAllSamples).toBe(0.5);
    expect(report.experimentValid).toBe(true);
  });

  test('zero schema-valid samples yields a null hard-fail rate and schema noncompliance', () => {
    const baseline = buildCodexDiagnosticsBenchmarkReport('demo-novel', 2, [
      sample('invalid-1', false, false),
      sample('invalid-2', false, false)
    ], 1, 'baseline', 'chapters/chapter_002/diagnostics_context_manifest_v1.json');
    const report = buildCodexDiagnosticsBenchmarkReport('demo-novel', 2, [
      sample('invalid-3', false, false),
      sample('invalid-4', false, false)
    ], 2, 'enhanced', 'chapters/chapter_002/diagnostics_context_manifest_v2.json');
    const contextFix = buildCodexDiagnosticsContextFixReport(
      'demo-novel',
      2,
      baseline,
      'chapters/chapter_002/codex_diagnostics_benchmark_v1.json',
      report,
      'chapters/chapter_002/codex_diagnostics_benchmark_v2.json',
      'chapters/chapter_002/diagnostics_context_manifest_v2.json',
      1
    );

    expect(report.schemaValidSampleCount).toBe(0);
    expect(report.hardFailRateAmongSchemaValidSamples).toBeNull();
    expect(report.experimentValid).toBe(false);
    expect(report.experimentInvalidReason).toBe('diagnostics_schema_noncompliance');
    expect(contextFix.conclusion).toBe('diagnostics_schema_noncompliance');
    expect(contextFix.experimentValid).toBe(false);
    expect(contextFix.hardFailRateAmongSchemaValidSamples).toBeNull();
  });
});

function sample(sampleId: string, schemaValid: boolean, passed: boolean) {
  return {
    sampleId,
    runId: `run_${sampleId}`,
    durationMs: 10,
    schemaValid,
    hardChecks: schemaValid
      ? {
          timeline_consistency: { passed, message: passed ? 'ok' : 'blocking failure' },
          character_knowledge_consistency: { passed: true, message: 'ok' },
          world_rule_consistency: { passed: true, message: 'ok' },
          no_unplanned_reveal: { passed: true, message: 'ok' }
        }
      : {},
    averageScore: schemaValid ? 8.6 : 0,
    passed,
    retryCount: 0,
    repairCount: 0,
    storyStateMutated: false as const
  };
}
