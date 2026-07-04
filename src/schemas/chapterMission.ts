import { z } from 'zod';

export const ChapterObjectiveSchema = z.object({
  id: z.string(),
  text: z.string(),
  type: z.enum(['plot', 'character', 'relationship', 'world', 'debt', 'foreshadowing', 'reader']),
  priority: z.enum(['must', 'should', 'could'])
});

export const ChapterMissionSchema = z.object({
  id: z.string(),
  chapterNumber: z.number().int().positive(),
  chapterFunction: z.string(),
  requiredObjectives: z.array(ChapterObjectiveSchema),
  debtsToPayOrAdvance: z.array(z.string()).default([]),
  debtsToIntroduce: z
    .array(
      z.object({
        type: z.string(),
        promise: z.string(),
        importance: z.number().min(1).max(10)
      })
    )
    .default([]),
  characterDeltas: z
    .array(
      z.object({
        characterId: z.string(),
        from: z.string(),
        to: z.string(),
        evidenceRequired: z.string()
      })
    )
    .default([]),
  readerInformationDelta: z.object({
    newKnowledge: z.array(z.string()).default([]),
    newSuspicions: z.array(z.string()).default([]),
    questionsToMaintain: z.array(z.string()).default([]),
    questionsToAnswer: z.array(z.string()).default([])
  }),
  forbiddenMoves: z.array(z.string()).default([]),
  targetEmotionalCurve: z.array(z.string()).default([]),
  targetWordCount: z.number().int().positive().optional()
});

export type ChapterObjective = z.infer<typeof ChapterObjectiveSchema>;
export type ChapterMission = z.infer<typeof ChapterMissionSchema>;
