import { z } from 'zod';

export const NarrativeDebtTypeSchema = z.enum([
  'mystery',
  'character',
  'relationship',
  'power',
  'revenge',
  'theme',
  'world',
  'promise'
]);

export const NarrativeDebtStatusSchema = z.enum(['open', 'escalated', 'partially_paid', 'resolved', 'paid', 'cancelled']);

export const DebtPayoffHistorySchema = z.object({
  chapter: z.number().int().positive(),
  text: z.string(),
  effect: z.enum(['maintained', 'escalated', 'partially_paid', 'paid'])
});

export const NarrativeDebtSchema = z.object({
  id: z.string(),
  type: NarrativeDebtTypeSchema,
  promise: z.string(),
  readerQuestion: z.string(),
  introducedInChapter: z.number().int().positive(),
  introducedInSceneId: z.string().optional(),
  status: NarrativeDebtStatusSchema,
  importance: z.number().min(1).max(10),
  urgency: z.number().min(1).max(10),
  payoffTargetChapter: z.number().int().positive().optional(),
  relatedCharacters: z.array(z.string()).default([]),
  relatedThreads: z.array(z.string()).default([]),
  payoffHistory: z.array(DebtPayoffHistorySchema).default([])
});

export type NarrativeDebtType = z.infer<typeof NarrativeDebtTypeSchema>;
export type NarrativeDebtStatus = z.infer<typeof NarrativeDebtStatusSchema>;
export type DebtPayoffHistory = z.infer<typeof DebtPayoffHistorySchema>;
export type NarrativeDebt = z.infer<typeof NarrativeDebtSchema>;
