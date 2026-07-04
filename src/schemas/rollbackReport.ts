import { z } from 'zod';

export const RollbackReportSchema = z.object({
  projectId: z.string(),
  snapshotId: z.string(),
  restoredSnapshotPath: z.string(),
  storyStatePath: z.string(),
  restoredLatestCommittedChapter: z.number().int().nonnegative(),
  preservedArtifacts: z.literal(true),
  rolledBackAt: z.string()
});

export type RollbackReport = z.infer<typeof RollbackReportSchema>;
