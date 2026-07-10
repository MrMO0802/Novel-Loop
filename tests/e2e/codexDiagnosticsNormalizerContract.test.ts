import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  DiagnosticsSemanticContradictionError,
  normalizeDiagnosticsWithReport,
  validateDiagnosticsProviderOutput
} from '../../src/providers/codex/normalizers.js';

describe('M27.12A diagnostics normalizer contract', () => {
  test('provider JSON schema is closed and requires every declared property', async () => {
    const schema = JSON.parse(await readFile(path.resolve('schemas/codex-output/slim/diagnostics.report.slim.schema.json'), 'utf8')) as JsonSchemaNode;

    expectClosedRequiredSchema(schema);
  });

  test.each(['insufficient_evidence', 'possible_risk'] as const)('%s does not become a hard failure', (result) => {
    const normalized = normalizeDiagnosticsWithReport(providerDiagnostics({
      passed: true,
      hardChecks: hardChecks({ result, blocking: false })
    }), { projectId: 'demo-novel', chapterNumber: 2 });

    expect(normalized.report.hard_checks.timeline_consistency.passed).toBe(true);
    expect(normalized.report.hardFailures).toEqual([]);
  });

  test('only fail plus blocking=true becomes a blocking hard failure', () => {
    const nonBlocking = normalizeDiagnosticsWithReport(providerDiagnostics({
      passed: false,
      hardChecks: hardChecks({ result: 'fail', blocking: false })
    }), { projectId: 'demo-novel', chapterNumber: 2 });
    const blocking = normalizeDiagnosticsWithReport(providerDiagnostics({
      passed: false,
      hardChecks: hardChecks({ result: 'fail', blocking: true })
    }), { projectId: 'demo-novel', chapterNumber: 2 });

    expect(nonBlocking.report.hard_checks.timeline_consistency.passed).toBe(true);
    expect(nonBlocking.report.hardFailures).toEqual([]);
    expect(blocking.report.hard_checks.timeline_consistency.passed).toBe(false);
    expect(blocking.report.hardFailures).toHaveLength(1);
  });

  test('passed=true with a blocking failure raises a semantic contradiction', () => {
    expect(() => normalizeDiagnosticsWithReport(providerDiagnostics({
      passed: true,
      hardChecks: hardChecks({ result: 'fail', blocking: true })
    }), { projectId: 'demo-novel', chapterNumber: 2 })).toThrow(DiagnosticsSemanticContradictionError);
  });

  test('maps provider soft scores to their matching internal score fields', () => {
    const normalized = normalizeDiagnosticsWithReport(providerDiagnostics({
      averageScore: 7.5,
      passed: false,
      softScores: {
        plot_progression: 1,
        character_consistency: 2,
        tension_curve: 3,
        emotional_impact: 4,
        chapter_hook: 5,
        style_match: 6,
        genre_satisfaction: 7,
        reader_curiosity: 8
      }
    }), { projectId: 'demo-novel', chapterNumber: 2 });

    expect(normalized.report.soft_scores).toEqual({
      plot_progression: 1,
      character_consistency: 2,
      tension_curve: 3,
      emotional_impact: 4,
      chapter_hook: 5,
      style_match: 6,
      genre_satisfaction: 7,
      reader_curiosity: 8
    });
    expect(normalized.report.scores).toMatchObject({
      total: 7.5,
      plotProgression: 1,
      characterConsistency: 2,
      tensionCurve: 3,
      emotionalImpact: 4,
      hookStrength: 5,
      styleMatch: 6,
      genreSatisfaction: 7,
      readerCuriosity: 8,
      proseQuality: 6
    });
  });

  test('provider contract reports missing, additional, enum, and type violations precisely', () => {
    const missing = validateDiagnosticsProviderOutput({
      ...providerDiagnostics(),
      revisionRequired: undefined
    });
    const additional = validateDiagnosticsProviderOutput({
      ...providerDiagnostics(),
      inventedField: true
    });
    const invalidEnum = validateDiagnosticsProviderOutput(providerDiagnostics({
      hardChecks: hardChecks({ result: 'maybe' as 'pass', blocking: false })
    }));
    const invalidType = validateDiagnosticsProviderOutput({
      ...providerDiagnostics(),
      averageScore: 'eight'
    });

    expect(missing.missingRequiredFields).toContain('revisionRequired');
    expect(additional.unexpectedProperties).toContain('inventedField');
    expect(invalidEnum.invalidEnumValues).toContain('hardChecks[0].result=maybe');
    expect(invalidType.invalidTypes).toContain('averageScore: expected number');
  });
});

interface JsonSchemaNode {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  additionalProperties?: boolean;
}

function expectClosedRequiredSchema(schema: JsonSchemaNode): void {
  if (schema.type === 'object') {
    expect(schema.additionalProperties).toBe(false);
    expect(new Set(schema.required)).toEqual(new Set(Object.keys(schema.properties ?? {})));
    for (const child of Object.values(schema.properties ?? {})) expectClosedRequiredSchema(child);
  }
  if (schema.items !== undefined) expectClosedRequiredSchema(schema.items);
}

function providerDiagnostics(overrides: Record<string, unknown> = {}) {
  return {
    chapterNumber: 2,
    draftVersion: 1,
    passed: true,
    averageScore: 8.6,
    hardChecks: hardChecks(),
    softScores: {
      plot_progression: 8.6,
      character_consistency: 8.6,
      tension_curve: 8.6,
      emotional_impact: 8.6,
      chapter_hook: 8.6,
      style_match: 8.6,
      genre_satisfaction: 8.6,
      reader_curiosity: 8.6
    },
    diagnostics: [],
    revisionRequired: false,
    ...overrides
  };
}

function hardChecks(timeline: { result: 'pass' | 'fail' | 'insufficient_evidence' | 'possible_risk'; blocking: boolean } = { result: 'pass', blocking: false }) {
  return [
    check('timeline_consistency', timeline.result, timeline.blocking),
    check('character_knowledge_consistency', 'pass', false),
    check('world_rule_consistency', 'pass', false),
    check('no_unplanned_reveal', 'pass', false)
  ];
}

function check(checkName: string, result: string, blocking: boolean) {
  return {
    checkName,
    result,
    blocking,
    evidence: result === 'pass' ? '' : 'chapter evidence',
    explanation: result === 'pass' ? 'No contradiction found.' : 'Review the cited evidence.'
  };
}
