import { z } from 'zod';

export const PlanCandidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  markdown: z.string(),
  strengths: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([])
});

export const PlanCandidatesSchema = z.object({
  chapterNumber: z.number().int().positive(),
  candidates: z.array(PlanCandidateSchema).min(1)
});

export const ChapterPlanRankingScoresSchema = z.object({
  plot_progression: z.number().min(0).max(10),
  character_arc_value: z.number().min(0).max(10),
  tension_potential: z.number().min(0).max(10),
  continuity_risk: z.number().min(0).max(10),
  reader_hook_strength: z.number().min(0).max(10),
  genre_satisfaction: z.number().min(0).max(10)
});

export const RankedPlanCandidateSchema = z.object({
  candidateId: z.string(),
  planPath: z.string(),
  scores: ChapterPlanRankingScoresSchema,
  totalScore: z.number().min(0).max(10),
  strengths: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([])
});

export const ChapterPlanRankingSchema = z.object({
  chapterNumber: z.number().int().positive(),
  candidates: z.array(RankedPlanCandidateSchema).min(1),
  selectedCandidateId: z.string(),
  selectedPlanPath: z.string(),
  rationale: z.string()
});

export type PlanCandidate = z.infer<typeof PlanCandidateSchema>;
export type PlanCandidates = z.infer<typeof PlanCandidatesSchema>;
export type ChapterPlanRankingScores = z.infer<typeof ChapterPlanRankingScoresSchema>;
export type RankedPlanCandidate = z.infer<typeof RankedPlanCandidateSchema>;
export type ChapterPlanRanking = z.infer<typeof ChapterPlanRankingSchema>;
