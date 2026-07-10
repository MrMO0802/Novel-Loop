import { z } from 'zod';

import {
  DiagnosticsNormalizationWarningSchema,
  DiagnosticsReportSchema
} from '../../schemas/index.js';
import type {
  DiagnosticsNormalizationWarning,
  DiagnosticsReport
} from '../../schemas/index.js';

const HARD_CHECK_NAMES = [
  'timeline_consistency',
  'character_knowledge_consistency',
  'world_rule_consistency',
  'no_unplanned_reveal'
] as const;

const SOFT_SCORE_NAMES = [
  'plot_progression',
  'character_consistency',
  'tension_curve',
  'emotional_impact',
  'chapter_hook',
  'style_match',
  'genre_satisfaction',
  'reader_curiosity'
] as const;

const PASSED_SCORE_FLOOR = 8.5;

export const CodexDiagnosticsProviderHardCheckSchema = z.object({
  checkName: z.enum(HARD_CHECK_NAMES),
  result: z.enum(['pass', 'fail', 'insufficient_evidence', 'possible_risk']),
  blocking: z.boolean(),
  evidence: z.string(),
  explanation: z.string()
}).strict();

export const CodexDiagnosticsProviderSoftScoresSchema = z.object({
  plot_progression: z.number().min(0).max(10),
  character_consistency: z.number().min(0).max(10),
  tension_curve: z.number().min(0).max(10),
  emotional_impact: z.number().min(0).max(10),
  chapter_hook: z.number().min(0).max(10),
  style_match: z.number().min(0).max(10),
  genre_satisfaction: z.number().min(0).max(10),
  reader_curiosity: z.number().min(0).max(10)
}).strict();

export const CodexDiagnosticsProviderIssueSchema = z.object({
  type: z.enum(['timeline', 'character', 'knowledge', 'world_rule', 'pacing', 'style', 'hook', 'debt', 'reveal', 'prose']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  message: z.string(),
  evidence: z.string(),
  recommendation: z.string()
}).strict();

export const CodexDiagnosticsProviderOutputSchema = z.object({
  chapterNumber: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
  passed: z.boolean(),
  averageScore: z.number().min(0).max(10),
  hardChecks: z.array(CodexDiagnosticsProviderHardCheckSchema).length(HARD_CHECK_NAMES.length),
  softScores: CodexDiagnosticsProviderSoftScoresSchema,
  diagnostics: z.array(CodexDiagnosticsProviderIssueSchema),
  revisionRequired: z.boolean()
}).strict().superRefine((value, context) => {
  for (const checkName of HARD_CHECK_NAMES) {
    const count = value.hardChecks.filter((check) => check.checkName === checkName).length;
    if (count !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['hardChecks'],
        message: `hardChecks must contain exactly one ${checkName}; received ${count}`
      });
    }
  }
});

export interface DiagnosticsProviderValidationResult {
  success: boolean;
  providerSchemaErrors: string[];
  unexpectedProperties: string[];
  missingRequiredFields: string[];
  invalidEnumValues: string[];
  invalidTypes: string[];
}

export interface DiagnosticsNormalizationResult {
  report: DiagnosticsReport;
  normalizationWarnings: DiagnosticsNormalizationWarning[];
  semanticContradictions: string[];
}

export class DiagnosticsSemanticContradictionError extends Error {
  readonly contradictions: string[];

  constructor(contradictions: string[]) {
    super(`Diagnostics semantic contradiction: ${contradictions.join('; ')}`);
    this.name = 'DiagnosticsSemanticContradictionError';
    this.contradictions = contradictions;
  }
}

export function validateDiagnosticsProviderOutput(value: unknown): DiagnosticsProviderValidationResult {
  const parsed = CodexDiagnosticsProviderOutputSchema.safeParse(value);
  if (parsed.success) {
    return {
      success: true,
      providerSchemaErrors: [],
      unexpectedProperties: [],
      missingRequiredFields: [],
      invalidEnumValues: [],
      invalidTypes: []
    };
  }

  const unexpectedProperties: string[] = [];
  const missingRequiredFields: string[] = [];
  const invalidEnumValues: string[] = [];
  const invalidTypes: string[] = [];
  const providerSchemaErrors = parsed.error.issues.map((issue) => {
    const issuePath = formatIssuePath(issue.path);
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        unexpectedProperties.push(joinIssuePath(issuePath, key));
      }
    } else if (issue.code === 'invalid_type') {
      const actual = valueAtPath(value, issue.path);
      if (actual === undefined) {
        missingRequiredFields.push(issuePath);
      } else {
        invalidTypes.push(`${issuePath}: expected ${issue.expected}`);
      }
    } else if (issue.code === 'invalid_value') {
      invalidEnumValues.push(`${issuePath}=${String(valueAtPath(value, issue.path))}`);
    }
    return `${issuePath}: ${issue.message}`;
  });

  return {
    success: false,
    providerSchemaErrors: unique(providerSchemaErrors),
    unexpectedProperties: unique(unexpectedProperties),
    missingRequiredFields: unique(missingRequiredFields),
    invalidEnumValues: unique(invalidEnumValues),
    invalidTypes: unique(invalidTypes)
  };
}

export function normalizeDiagnosticsWithReport(
  value: unknown,
  context: { projectId: string; chapterNumber?: number }
): DiagnosticsNormalizationResult {
  const slim = CodexDiagnosticsProviderOutputSchema.parse(value);
  const contradictions = semanticContradictions(slim);
  if (contradictions.length > 0) {
    throw new DiagnosticsSemanticContradictionError(contradictions);
  }

  const score = slim.passed ? Math.max(slim.averageScore, PASSED_SCORE_FLOOR) : slim.averageScore;
  const softScores = Object.fromEntries(SOFT_SCORE_NAMES.map((field) => [
    field,
    slim.passed ? Math.max(slim.softScores[field], PASSED_SCORE_FLOOR) : slim.softScores[field]
  ])) as z.infer<typeof CodexDiagnosticsProviderSoftScoresSchema>;
  const normalizationWarnings = [
    ...diagnosticsNormalizationWarnings('averageScore', slim.averageScore, score, slim.passed),
    ...SOFT_SCORE_NAMES.flatMap((field) => diagnosticsNormalizationWarnings(
      `softScores.${field}`,
      slim.softScores[field],
      softScores[field],
      slim.passed
    ))
  ];
  const byName = Object.fromEntries(slim.hardChecks.map((check) => [check.checkName, check])) as Record<(typeof HARD_CHECK_NAMES)[number], z.infer<typeof CodexDiagnosticsProviderHardCheckSchema>>;
  const hardChecks = Object.fromEntries(HARD_CHECK_NAMES.map((checkName) => {
    const check = byName[checkName];
    const blockingFailure = check.result === 'fail' && check.blocking;
    return [checkName, {
      passed: !blockingFailure,
      ...(blockingFailure ? { severity: 'high' as const } : {}),
      message: check.explanation,
      ...(check.evidence.length === 0 ? {} : { evidence: check.evidence })
    }];
  }));
  const hardFailures = slim.hardChecks
    .filter((check) => check.result === 'fail' && check.blocking)
    .map((check) => ({
      code: check.checkName,
      severity: 'high' as const,
      message: check.explanation,
      ...(check.evidence.length === 0 ? {} : { evidence: check.evidence })
    }));

  const report = DiagnosticsReportSchema.parse({
    chapterNumber: context.chapterNumber ?? slim.chapterNumber,
    draftVersion: slim.draftVersion,
    hard_checks: hardChecks,
    soft_scores: softScores,
    hardFailures,
    scores: {
      total: score,
      plotProgression: softScores.plot_progression,
      characterConsistency: softScores.character_consistency,
      tensionCurve: softScores.tension_curve,
      emotionalImpact: softScores.emotional_impact,
      hookStrength: softScores.chapter_hook,
      styleMatch: softScores.style_match,
      genreSatisfaction: softScores.genre_satisfaction,
      readerCuriosity: softScores.reader_curiosity,
      proseQuality: softScores.style_match
    },
    missionSatisfaction: {
      allRequiredSatisfied: slim.passed && hardFailures.length === 0,
      objectiveResults: []
    },
    issues: slim.diagnostics.map((issue) => ({
      type: issue.type,
      severity: issue.severity,
      message: issue.message,
      ...(issue.evidence.length === 0 ? {} : { locationHint: issue.evidence }),
      ...(issue.recommendation.length === 0 ? {} : { recommendation: issue.recommendation })
    })),
    normalizationWarnings
  });

  return { report, normalizationWarnings: report.normalizationWarnings, semanticContradictions: [] };
}

function semanticContradictions(value: z.infer<typeof CodexDiagnosticsProviderOutputSchema>): string[] {
  const contradictions: string[] = [];
  const blockingFailures = value.hardChecks.filter((check) => check.result === 'fail' && check.blocking);
  if (value.passed && blockingFailures.length > 0) {
    contradictions.push(`passed=true conflicts with blocking failures: ${blockingFailures.map((check) => check.checkName).join(', ')}`);
  }
  return contradictions;
}

function diagnosticsNormalizationWarnings(field: string, originalScore: number, normalizedScore: number, passed: boolean): DiagnosticsNormalizationWarning[] {
  if (!passed || originalScore >= normalizedScore) return [];
  return [DiagnosticsNormalizationWarningSchema.parse({
    field,
    originalValue: originalScore,
    normalizedValue: normalizedScore,
    reason: 'Codex diagnostics returned passed=true below the local quality gate floor; the coercion is recorded explicitly.',
    promptId: 'diagnostics.diagnose_chapter_slim',
    artifactPath: ''
  })];
}

function valueAtPath(value: unknown, issuePath: PropertyKey[]): unknown {
  let current = value;
  for (const segment of issuePath) {
    if (typeof segment !== 'string' && typeof segment !== 'number') return undefined;
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function formatIssuePath(issuePath: PropertyKey[]): string {
  if (issuePath.length === 0) return '$';
  return issuePath.reduce<string>((result, segment) => {
    if (typeof segment === 'number') return `${result}[${segment}]`;
    return result.length === 0 ? String(segment) : `${result}.${String(segment)}`;
  }, '');
}

function joinIssuePath(prefix: string, key: string): string {
  return prefix === '$' || prefix.length === 0 ? key : `${prefix}.${key}`;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
