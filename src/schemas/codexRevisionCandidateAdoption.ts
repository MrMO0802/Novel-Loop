import { z } from 'zod';

import {
  ExpandedTargetRevisionCandidateDispositionResultSchema,
  ExpandedTargetRevisionExperimentResultSchema
} from './codexExpandedTargetRevision.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ArtifactPathSchema = z.string().min(1);

export const RevisionCandidateReviewChecklistItemSchema = z.object({
  checkId: z.string().min(1),
  label: z.string().min(1),
  passed: z.boolean(),
  evidence: z.string().min(1)
}).strict();

export const RevisionCandidateReviewSchema = z.object({
  reviewId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  candidatePath: ArtifactPathSchema,
  candidateHash: Sha256Schema,
  sourceDraftPath: ArtifactPathSchema,
  sourceDraftHash: Sha256Schema,
  experimentReportPath: ArtifactPathSchema,
  experimentReportHash: Sha256Schema,
  dispositionPath: ArtifactPathSchema,
  dispositionHash: Sha256Schema,
  scopeValidationPath: ArtifactPathSchema,
  diagnosticsABPath: ArtifactPathSchema,
  adjudicationPath: ArtifactPathSchema,
  qualityReportPath: ArtifactPathSchema,
  experimentResult: ExpandedTargetRevisionExperimentResultSchema,
  disposition: ExpandedTargetRevisionCandidateDispositionResultSchema,
  scopeValid: z.boolean(),
  contradictionsResolved: z.boolean(),
  newBlockingHardChecks: z.array(z.string()),
  baselineMedianScore: z.number().min(0).max(10).nullable(),
  candidateMedianScore: z.number().min(0).max(10).nullable(),
  scoreDelta: z.number().nullable(),
  sourceStatePath: z.literal('state/story_state.json'),
  sourceStateHash: Sha256Schema,
  sourceQueuePath: z.literal('planning/chapter_queue.json'),
  sourceQueueHash: Sha256Schema,
  humanReviewChecklist: z.array(RevisionCandidateReviewChecklistItemSchema).min(1),
  approvedForAdoption: z.literal(false),
  generatedAt: z.string().min(1),
  codexInvoked: z.literal(false),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict();

export const RevisionCandidateAdoptionApprovalSchema = z.object({
  approvalId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  candidatePath: ArtifactPathSchema,
  candidateHash: Sha256Schema,
  reviewReportPath: ArtifactPathSchema,
  reviewReportHash: Sha256Schema,
  experimentReportPath: ArtifactPathSchema,
  experimentReportHash: Sha256Schema,
  dispositionPath: ArtifactPathSchema,
  dispositionHash: Sha256Schema,
  approved: z.literal(true),
  confirmedAt: z.string().min(1),
  operator: z.string().min(1),
  riskAcknowledged: z.literal(true),
  approvalScope: z.literal('preview_only'),
  sourceStateHash: Sha256Schema,
  sourceQueueHash: Sha256Schema,
  sourceDraftHash: Sha256Schema,
  command: z.string().min(1),
  generatedAt: z.string().min(1),
  codexInvoked: z.literal(false),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict();

export const DraftAdoptionManifestSchema = z.object({
  adoptionId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  candidatePath: ArtifactPathSchema,
  candidateHash: Sha256Schema,
  adoptedDraftPath: ArtifactPathSchema,
  adoptedDraftHash: Sha256Schema,
  originalDraftPath: ArtifactPathSchema,
  originalDraftHash: Sha256Schema,
  approvalPath: ArtifactPathSchema,
  approvalHash: Sha256Schema,
  experimentPath: ArtifactPathSchema,
  experimentHash: Sha256Schema,
  dispositionPath: ArtifactPathSchema,
  dispositionHash: Sha256Schema,
  sourceStateHash: Sha256Schema,
  sourceQueueHash: Sha256Schema,
  adoptionScope: z.literal('preview_only'),
  canonical: z.literal(false),
  adoptedAt: z.string().min(1),
  storyStateMutated: z.literal(false),
  queueCommitted: z.literal(false)
}).strict().superRefine((manifest, context) => {
  if (manifest.candidateHash !== manifest.adoptedDraftHash) {
    context.addIssue({ code: 'custom', path: ['adoptedDraftHash'], message: 'adopted draft must match the approved candidate hash' });
  }
});

export const DraftSelectionSchema = z.object({
  selectionId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  selectedDraftPath: ArtifactPathSchema,
  selectedDraftHash: Sha256Schema,
  selectedDraftVersion: z.literal(2),
  candidatePath: ArtifactPathSchema,
  approvalPath: ArtifactPathSchema,
  adoptionManifestPath: ArtifactPathSchema,
  scope: z.literal('preview_only'),
  selectedAt: z.string().min(1),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict();

export const CodexCandidatePreviewRecommendedNextStepSchema = z.enum([
  'human_commit_review',
  'human_review',
  'patch_review',
  'diagnostics_review',
  'candidate_rejected'
]);

export const CodexCandidatePreviewReportSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  runId: z.string().min(1),
  candidatePath: ArtifactPathSchema,
  candidateHash: Sha256Schema,
  adoptedDraftPath: ArtifactPathSchema,
  adoptedDraftHash: Sha256Schema,
  adoptionApprovalPath: ArtifactPathSchema,
  adoptionApprovalHash: Sha256Schema,
  draftAdoptionManifestPath: ArtifactPathSchema,
  draftSelectionPath: ArtifactPathSchema,
  experimentPath: ArtifactPathSchema,
  experimentHash: Sha256Schema,
  diagnosticsContextManifestPath: ArtifactPathSchema,
  diagnosticsPath: ArtifactPathSchema,
  finalPath: ArtifactPathSchema.nullable(),
  qualityReportPath: ArtifactPathSchema.nullable(),
  patchProposalPath: ArtifactPathSchema.nullable(),
  normalizedPatchPath: ArtifactPathSchema.nullable(),
  conflictReportPath: ArtifactPathSchema.nullable(),
  stateDiffPath: ArtifactPathSchema.nullable(),
  completenessReportPath: ArtifactPathSchema,
  previewComplete: z.boolean(),
  diagnosticsPassed: z.boolean(),
  standardDiagnosticsReexecuted: z.literal(true),
  abDiagnosticsReused: z.literal(false),
  qualityPassed: z.boolean(),
  patchSchemaValid: z.boolean(),
  conflictCheckPassed: z.boolean(),
  stateDiffGenerated: z.boolean(),
  sourceStateHash: Sha256Schema,
  sourceQueueHash: Sha256Schema,
  latestCommittedChapterBefore: z.number().int().nonnegative(),
  latestCommittedChapterAfter: z.number().int().nonnegative(),
  queueStatusBefore: z.string().min(1),
  queueStatusAfter: z.string().min(1),
  storyStateMutated: z.literal(false),
  queueCommitted: z.literal(false),
  commitStarted: z.literal(false),
  snapshotCreated: z.literal(false),
  canonicalPatchGenerated: z.literal(false),
  failureCode: z.string().min(1).nullable(),
  failureReason: z.string().min(1).nullable(),
  recommendedNextStep: CodexCandidatePreviewRecommendedNextStepSchema,
  generatedAt: z.string().min(1)
}).strict().superRefine((report, context) => {
  if (report.latestCommittedChapterBefore !== report.latestCommittedChapterAfter) {
    context.addIssue({ code: 'custom', path: ['latestCommittedChapterAfter'], message: 'candidate preview cannot advance latestCommittedChapter' });
  }
  if (report.previewComplete && (!report.diagnosticsPassed || !report.qualityPassed || !report.patchSchemaValid || !report.conflictCheckPassed || !report.stateDiffGenerated)) {
    context.addIssue({ code: 'custom', path: ['previewComplete'], message: 'complete preview requires all diagnostics, quality, patch, conflict, and diff gates' });
  }
  if (report.previewComplete && [report.finalPath, report.qualityReportPath, report.patchProposalPath, report.normalizedPatchPath, report.stateDiffPath].some((value) => value === null)) {
    context.addIssue({ code: 'custom', path: ['previewComplete'], message: 'complete preview requires all versioned preview artifact paths' });
  }
});

export type RevisionCandidateReview = z.infer<typeof RevisionCandidateReviewSchema>;
export type RevisionCandidateAdoptionApproval = z.infer<typeof RevisionCandidateAdoptionApprovalSchema>;
export type DraftAdoptionManifest = z.infer<typeof DraftAdoptionManifestSchema>;
export type DraftSelection = z.infer<typeof DraftSelectionSchema>;
export type CodexCandidatePreviewReport = z.infer<typeof CodexCandidatePreviewReportSchema>;
