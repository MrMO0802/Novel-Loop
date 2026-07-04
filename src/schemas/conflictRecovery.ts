import { z } from 'zod';

export const ConflictTypeSchema = z.enum([
  'DUPLICATE_CANON_FACT_ID',
  'CANON_FACT_OVERWRITE',
  'TIMELINE_ORDER_CONFLICT',
  'CHARACTER_STATE_CONFLICT',
  'CHARACTER_KNOWLEDGE_LEAK',
  'READER_KNOWLEDGE_LEAK',
  'NARRATIVE_DEBT_INVALID_TRANSITION',
  'FORESHADOWING_INVALID_TRANSITION',
  'CHAPTER_NUMBER_OUT_OF_ORDER',
  'PATCH_TARGET_ALREADY_COMMITTED',
  'UNKNOWN_PATCH_CONFLICT'
]);

export const ConflictSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const ConflictItemSchema = z.object({
  conflictId: z.string(),
  conflictType: ConflictTypeSchema,
  severity: ConflictSeveritySchema,
  statePath: z.string(),
  patchPath: z.string(),
  existingValue: z.unknown(),
  proposedValue: z.unknown(),
  explanation: z.string(),
  suggestedResolution: z.string(),
  blocking: z.boolean(),
  repairable: z.boolean()
});

export const ConflictReportSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  sourcePatchPath: z.string(),
  generatedAt: z.string(),
  conflicts: z.array(ConflictItemSchema)
});

export const PatchRepairStrategySchema = z.enum([
  'preserve_state',
  'preserve_patch',
  'merge_append',
  'rename_ids',
  'mark_superseded',
  'defer_reveal',
  'require_human_review'
]);

export const PatchRepairOperationTypeSchema = z.enum([
  'rename_patch_id',
  'append_without_overwrite',
  'change_status_transition',
  'remove_unplanned_reveal',
  'convert_to_reader_suspicion',
  'mark_existing_as_superseded',
  'defer_patch_item',
  'no_auto_repair'
]);

export const PatchRepairOperationSchema = z.object({
  operationId: z.string(),
  conflictId: z.string(),
  operationType: PatchRepairOperationTypeSchema,
  targetPath: z.string(),
  reason: z.string(),
  instruction: z.string(),
  expectedEffect: z.string()
});

export const PatchRepairPlanSchema = z.object({
  repairPlanId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  sourceConflictReportPath: z.string(),
  sourcePatchPath: z.string(),
  strategy: PatchRepairStrategySchema,
  operations: z.array(PatchRepairOperationSchema),
  unrepairableConflicts: z.array(z.string()),
  generatedAt: z.string()
});

export const ConflictRepairReportSchema = z.object({
  repairReportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  originalPatchPath: z.string(),
  repairedPatchPath: z.string().optional(),
  conflictReportPath: z.string(),
  repairPlanPath: z.string().optional(),
  repairAttempts: z.number().int().nonnegative(),
  repaired: z.boolean(),
  remainingConflicts: z.array(ConflictItemSchema),
  committed: z.boolean(),
  generatedAt: z.string()
});

export type ConflictType = z.infer<typeof ConflictTypeSchema>;
export type ConflictSeverity = z.infer<typeof ConflictSeveritySchema>;
export type ConflictItem = z.infer<typeof ConflictItemSchema>;
export type ConflictReport = z.infer<typeof ConflictReportSchema>;
export type PatchRepairStrategy = z.infer<typeof PatchRepairStrategySchema>;
export type PatchRepairOperationType = z.infer<typeof PatchRepairOperationTypeSchema>;
export type PatchRepairOperation = z.infer<typeof PatchRepairOperationSchema>;
export type PatchRepairPlan = z.infer<typeof PatchRepairPlanSchema>;
export type ConflictRepairReport = z.infer<typeof ConflictRepairReportSchema>;
