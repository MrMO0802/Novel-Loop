import { z } from 'zod';

import { StoryStateSchema } from './storyState.js';

export const SnapshotMetaSchema = z.object({
  snapshotId: z.string(),
  path: z.string(),
  createdAt: z.string(),
  reason: z.string(),
  sourceChapter: z.number().int().positive().optional(),
  runId: z.string().optional(),
  configHash: z.string().optional()
});

export const SnapshotSchema = z.object({
  meta: SnapshotMetaSchema,
  storyState: StoryStateSchema
});

export type SnapshotMeta = z.infer<typeof SnapshotMetaSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
