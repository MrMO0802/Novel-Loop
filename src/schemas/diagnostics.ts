import { z } from 'zod';

export const DiagnosticsScoreSchema = z.number().min(0).max(10);

export const HardCheckResultSchema = z.object({
  passed: z.boolean(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  message: z.string(),
  evidence: z.string().optional()
});

export const DiagnosticsHardChecksSchema = z.object({
  timeline_consistency: HardCheckResultSchema,
  character_knowledge_consistency: HardCheckResultSchema,
  world_rule_consistency: HardCheckResultSchema,
  no_unplanned_reveal: HardCheckResultSchema
});

export const DiagnosticsSoftScoresSchema = z.object({
  plot_progression: DiagnosticsScoreSchema,
  character_consistency: DiagnosticsScoreSchema,
  tension_curve: DiagnosticsScoreSchema,
  emotional_impact: DiagnosticsScoreSchema,
  chapter_hook: DiagnosticsScoreSchema,
  style_match: DiagnosticsScoreSchema,
  genre_satisfaction: DiagnosticsScoreSchema,
  reader_curiosity: DiagnosticsScoreSchema
});

export const DiagnosticsReportSchema = z.object({
  chapterNumber: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
  hard_checks: DiagnosticsHardChecksSchema,
  soft_scores: DiagnosticsSoftScoresSchema,
  hardFailures: z
    .array(
      z.object({
        code: z.string(),
        severity: z.enum(['critical', 'high']),
        message: z.string(),
        evidence: z.string().optional(),
        suggestedFix: z.string().optional()
      })
    )
    .default([]),
  scores: z.object({
    total: DiagnosticsScoreSchema,
    plotProgression: DiagnosticsScoreSchema,
    characterConsistency: DiagnosticsScoreSchema,
    tensionCurve: DiagnosticsScoreSchema,
    emotionalImpact: DiagnosticsScoreSchema,
    hookStrength: DiagnosticsScoreSchema,
    styleMatch: DiagnosticsScoreSchema,
    genreSatisfaction: DiagnosticsScoreSchema,
    readerCuriosity: DiagnosticsScoreSchema,
    proseQuality: DiagnosticsScoreSchema
  }),
  missionSatisfaction: z.object({
    allRequiredSatisfied: z.boolean(),
    objectiveResults: z.array(
      z.object({
        objectiveId: z.string(),
        satisfied: z.boolean(),
        evidence: z.string().optional(),
        issue: z.string().optional()
      })
    )
  }),
  issues: z
    .array(
      z.object({
        type: z.enum(['timeline', 'character', 'knowledge', 'world_rule', 'pacing', 'style', 'hook', 'debt', 'reveal', 'prose']),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        message: z.string(),
        locationHint: z.string().optional(),
        recommendation: z.string().optional()
      })
    )
    .default([])
});

export type DiagnosticsHardChecks = z.infer<typeof DiagnosticsHardChecksSchema>;
export type DiagnosticsSoftScores = z.infer<typeof DiagnosticsSoftScoresSchema>;
export type DiagnosticsReport = z.infer<typeof DiagnosticsReportSchema>;
