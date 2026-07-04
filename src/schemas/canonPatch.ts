import { z } from 'zod';

import { CharacterStateSchema } from './characterState.js';
import { CanonFactSchema, TimelineEventSchema } from './storyState.js';

export const ReaderStatePatchSchema = z
  .object({
    addKnows: z.array(z.string()).default([]),
    addSuspects: z.array(z.string()).default([]),
    addQuestions: z.array(z.string()).default([]),
    removeQuestions: z.array(z.string()).default([]),
    addExpectations: z.array(z.string()).default([]),
    addDoesNotKnow: z.array(z.string()).default([])
  })
  .default({
    addKnows: [],
    addSuspects: [],
    addQuestions: [],
    removeQuestions: [],
    addExpectations: [],
    addDoesNotKnow: []
  });

export const CanonPatchSchema = z.object({
  chapterNumber: z.number().int().positive(),
  sourceFinalPath: z.string(),
  latestCommittedChapter: z.number().int().positive().optional(),
  newFacts: z.array(CanonFactSchema).default([]),
  characterStates: z.array(CharacterStateSchema).default([]),
  characterUpdates: z
    .array(
      z.object({
        characterId: z.string(),
        field: z.string(),
        oldValueSummary: z.string().optional(),
        newValue: z.unknown(),
        reason: z.string()
      })
    )
    .default([]),
  timelineEvents: z.array(TimelineEventSchema).default([]),
  narrativeDebtUpdates: z
    .array(
      z.object({
        debtId: z.string().optional(),
        action: z.enum(['create', 'maintain', 'escalate', 'partially_pay', 'pay', 'cancel']),
        payload: z.unknown()
      })
    )
    .default([]),
  foreshadowingUpdates: z
    .array(
      z.object({
        foreshadowingId: z.string().optional(),
        action: z.enum(['create', 'reinforce', 'partially_pay', 'pay', 'abandon']),
        payload: z.unknown()
      })
    )
    .default([]),
  readerStatePatch: ReaderStatePatchSchema,
  relationshipUpdates: z
    .array(
      z.object({
        fromCharacterId: z.string(),
        toCharacterId: z.string(),
        change: z.string(),
        evidence: z.string()
      })
    )
    .default([]),
  revealScheduleUpdates: z
    .array(
      z.object({
        revealId: z.string().optional(),
        action: z.enum(['create', 'advance_stage', 'mark_revealed', 'delay']),
        payload: z.unknown()
      })
    )
    .default([])
});

export const PatchConflictReportSchema = z.object({
  hard: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});

export type ReaderStatePatch = z.infer<typeof ReaderStatePatchSchema>;
export type CanonPatch = z.infer<typeof CanonPatchSchema>;
export type PatchConflictReport = z.infer<typeof PatchConflictReportSchema>;
