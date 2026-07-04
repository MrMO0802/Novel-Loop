import path from 'node:path';

import { z } from 'zod';

export const ArcMapSchema = z.object({
  schemaVersion: z.literal('1.0'),
  projectId: z.string(),
  arcs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(['plot', 'character', 'relationship', 'world', 'theme']),
      summary: z.string(),
      startChapter: z.number().int().positive().optional(),
      targetEndChapter: z.number().int().positive().optional(),
      relatedCharacters: z.array(z.string()).default([]),
      relatedThreads: z.array(z.string()).default([])
    })
  )
});

export const ChapterQueueStatusSchema = z.preprocess(
  (value) => {
    if (value === 'ready') {
      return 'planned_ready';
    }
    if (value === 'drafted') {
      return 'draft_ready';
    }
    return value;
  },
  z.enum([
    'planned',
    'planning',
    'planned_ready',
    'drafting',
    'draft_ready',
    'diagnosing',
    'revision_required',
    'revising',
    'final_ready',
    'patch_extracted',
    'conflict_detected',
    'conflict_repairing',
    'conflict_repaired',
    'under_review',
    'manually_edited',
    'recommit_ready',
    'recommitting',
    'recommitted',
    'stale_due_to_history_edit',
    'committing',
    'committed',
    'failed',
    'blocked',
    'needs_human_review'
  ])
);

export const ChapterQueueStageSchema = z.enum([
  'none',
  'mission',
  'plan_candidates',
  'ranking',
  'scene_cards',
  'scene_drafts',
  'draft_assembly',
  'diagnostics',
  'revision',
  'final',
  'canon_patch',
  'commit'
]);

const ChapterQueueItemSchema = z
  .object({
    chapterNumber: z.number().int().positive(),
    title: z.string().default('Untitled Chapter'),
    status: ChapterQueueStatusSchema.default('planned'),
    artifactPath: z.string().optional(),
    latestRunId: z.string().nullable().default(null),
    startedAt: z.string().nullable().default(null),
    updatedAt: z.string().nullable().default(null),
    committedAt: z.string().nullable().default(null),
    failureReason: z.string().nullable().default(null),
    currentStage: ChapterQueueStageSchema.default('none'),
    completedStages: z.array(ChapterQueueStageSchema).default([]),
    summary: z.string().default(''),
    primaryFunction: z.string().default(''),
    targetDebts: z.array(z.string()).default([])
  })
  .transform((item) => ({
    ...item,
    artifactPath: item.artifactPath ?? path.join('chapters', `chapter_${String(item.chapterNumber).padStart(3, '0')}`)
  }));

export const ChapterQueueSchema = z.object({
  schemaVersion: z.literal('1.0'),
  projectId: z.string(),
  chapters: z.array(ChapterQueueItemSchema)
});

export type ArcMap = z.infer<typeof ArcMapSchema>;
export type ChapterQueue = z.infer<typeof ChapterQueueSchema>;
export type ChapterQueueItem = ChapterQueue['chapters'][number];
export type ChapterQueueStatus = z.infer<typeof ChapterQueueStatusSchema>;
export type ChapterQueueStage = z.infer<typeof ChapterQueueStageSchema>;
