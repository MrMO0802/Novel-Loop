import { z } from 'zod';

export const RevisionStrategySchema = z.enum([
  'local_patch',
  'rewrite_scene',
  'reorder_scenes',
  'strengthen_hook',
  'reduce_exposition',
  'fix_character_motivation',
  'delay_reveal',
  'payoff_debt',
  'full_chapter_rewrite',
  'human_review'
]);

export const RevisionTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('scene'),
    sceneId: z.string()
  }),
  z.object({
    type: z.literal('whole_chapter')
  })
]);

export const RevisionOperationSchema = z.object({
  target: RevisionTargetSchema,
  operation: z.string(),
  reason: z.string(),
  concrete_instruction: z.string(),
  instruction: z.string().optional(),
  expectedEffect: z.string().optional()
});

export const RevisionPlanSchema = z.object({
  chapterNumber: z.number().int().positive(),
  fromDraftVersion: z.number().int().positive(),
  revision_strategy: RevisionStrategySchema,
  strategy: RevisionStrategySchema,
  operations: z.array(RevisionOperationSchema).min(1),
  riskNotes: z.array(z.string()).default([])
});

export type RevisionTarget = z.infer<typeof RevisionTargetSchema>;
export type RevisionStrategy = z.infer<typeof RevisionStrategySchema>;
export type RevisionOperation = z.infer<typeof RevisionOperationSchema>;
export type RevisionPlan = z.infer<typeof RevisionPlanSchema>;
