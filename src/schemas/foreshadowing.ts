import { z } from 'zod';

export const ForeshadowingSchema = z.object({
  id: z.string(),
  surfaceDetail: z.string(),
  hiddenMeaning: z.string(),
  introducedInChapter: z.number().int().positive(),
  payoffTargetChapter: z.number().int().positive().optional(),
  status: z.enum(['unresolved', 'reinforced', 'partially_paid', 'resolved', 'paid', 'abandoned']),
  subtlety: z.enum(['obvious', 'medium', 'subtle']),
  relatedDebtId: z.string().optional(),
  payoffText: z.string().optional()
});

export type Foreshadowing = z.infer<typeof ForeshadowingSchema>;
