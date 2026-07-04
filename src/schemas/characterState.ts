import { z } from 'zod';

export const CharacterKnowledgeSchema = z.object({
  factId: z.string().optional(),
  text: z.string(),
  status: z.enum(['knows', 'believes', 'suspects', 'misunderstands']),
  learnedInChapter: z.number().int().positive().optional()
});

export const CharacterArcSchema = z
  .object({
    startingPoint: z.string().optional(),
    currentStage: z.string().optional(),
    targetEndState: z.string().optional()
  })
  .default({});

export const CharacterStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['protagonist', 'deuteragonist', 'antagonist', 'supporting', 'minor']),
  age: z.number().int().positive().optional(),
  publicDescription: z.string(),
  privateTruths: z.array(z.string()).default([]),
  personality: z.array(z.string()).default([]),
  desire: z.string().optional(),
  fear: z.string().optional(),
  flaw: z.string().optional(),
  currentGoal: z.string().optional(),
  emotionalState: z.string().optional(),
  physicalState: z.string().optional(),
  knowledge: z.array(CharacterKnowledgeSchema).default([]),
  arc: CharacterArcSchema,
  constraints: z.array(z.string()).default([]),
  lastUpdatedChapter: z.number().int().nonnegative().default(0)
});

export type CharacterKnowledge = z.infer<typeof CharacterKnowledgeSchema>;
export type CharacterArc = z.infer<typeof CharacterArcSchema>;
export type CharacterState = z.infer<typeof CharacterStateSchema>;
