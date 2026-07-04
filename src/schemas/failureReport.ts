import { z } from 'zod';

export const FailureReportSchema = z.object({
  chapterNumber: z.number().int().positive(),
  finalDraftVersion: z.number().int().positive().default(1),
  maxRevisions: z.number().int().nonnegative().default(0),
  reason: z.enum(['max_revisions_exhausted', 'conflict_repair_failed']),
  failedDiagnosticsPath: z.string().default(''),
  hardCheckFailures: z.array(z.string()).default([]),
  softScoreAverage: z.number().min(0).max(10).default(0),
  threshold: z.number().min(0).max(10).default(0),
  conflictReportPath: z.string().optional(),
  repairPlanPath: z.string().optional(),
  repairedPatchPath: z.string().optional(),
  remainingConflictCount: z.number().int().nonnegative().optional(),
  createdAt: z.string()
});

export type FailureReport = z.infer<typeof FailureReportSchema>;
