import { z } from 'zod';

export const SceneIdSchema = z.string().regex(/^scene_[0-9]{3}$/, 'sceneId must use scene_001 format');

export const SceneCardSchema = z.object({
  sceneId: SceneIdSchema,
  chapterNumber: z.number().int().positive(),
  order: z.number().int().positive(),
  purpose: z.string(),
  conflict: z.string(),
  entryPoint: z.string(),
  exitPoint: z.string(),
  characters: z.array(z.string()).min(1),
  location: z.string(),
  time: z.string(),
  informationDelta: z.array(z.string()),
  emotionalShift: z.string(),
  readerEffect: z.string(),
  constraints: z.array(z.string()),
  id: z.string().optional(),
  title: z.string().optional(),
  povCharacterId: z.string().optional(),
  entryState: z.string().optional(),
  beats: z.array(z.string()).min(1).optional(),
  characterDelta: z
    .array(
      z.object({
        characterId: z.string(),
        change: z.string()
      })
    )
    .default([]),
  exitHook: z.string().optional(),
  targetWordCount: z.number().int().positive().optional()
});

export const SceneCardsSchema = z.array(SceneCardSchema).min(1);

export type SceneCard = z.infer<typeof SceneCardSchema>;
export type SceneCards = z.infer<typeof SceneCardsSchema>;
