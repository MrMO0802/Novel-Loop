import { z } from 'zod';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ArtifactPathSchema = z.string().min(1);

export const CandidateCommitMutationDecisionSchema = z.enum(['approve', 'reject', 'modify_required', 'needs_human_review']);

export const CandidateCommitMutationTypeSchema = z.enum([
  'canon_fact',
  'timeline_event',
  'character_state',
  'narrative_debt',
  'foreshadowing',
  'reader_state',
  'relationship',
  'latest_committed_chapter',
  'other'
]);

export const CandidatePatchEvidenceMutationSchema = z.object({
  mutationId: z.string().min(1),
  diffChangeIndex: z.number().int().nonnegative(),
  mutationType: CandidateCommitMutationTypeSchema,
  statePath: z.string().min(1),
  beforeValue: z.unknown(),
  afterValue: z.unknown(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  sourceFinalPath: ArtifactPathSchema,
  evidenceSnippets: z.array(z.string().min(1).max(240)),
  evidenceParagraphIndexes: z.array(z.number().int().positive()),
  evidenceHashes: z.array(Sha256Schema),
  relatedMissionGoals: z.array(z.string()),
  relatedPlanItems: z.array(z.string()),
  supportedByFinal: z.boolean(),
  supportedByMission: z.boolean(),
  supportedBySelectedPlan: z.boolean(),
  legalStateTransition: z.boolean(),
  duplicateRisk: z.boolean(),
  prematureResolutionRisk: z.boolean(),
  readerLeakRisk: z.boolean(),
  characterKnowledgeRisk: z.boolean(),
  decision: CandidateCommitMutationDecisionSchema,
  decisionReason: z.string().min(1)
}).strict().superRefine((mutation, context) => {
  if (mutation.evidenceSnippets.length !== mutation.evidenceParagraphIndexes.length || mutation.evidenceSnippets.length !== mutation.evidenceHashes.length) {
    context.addIssue({ code: 'custom', path: ['evidenceSnippets'], message: 'evidence snippets, paragraph indexes, and hashes must have equal lengths' });
  }
});

export const CandidatePatchEvidenceMapSchema = z.object({
  mapId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  runId: z.string().min(1),
  generatedAt: z.string().min(1),
  finalPreviewPath: ArtifactPathSchema,
  finalPreviewHash: Sha256Schema,
  normalizedPatchPath: ArtifactPathSchema,
  normalizedPatchHash: Sha256Schema,
  stateDiffPath: ArtifactPathSchema,
  stateDiffHash: Sha256Schema,
  missionPath: ArtifactPathSchema,
  missionHash: Sha256Schema,
  selectedPlanPath: ArtifactPathSchema,
  selectedPlanHash: Sha256Schema,
  diffChangeCount: z.number().int().nonnegative(),
  mutationCount: z.number().int().nonnegative(),
  allDiffChangesCovered: z.boolean(),
  mutations: z.array(CandidatePatchEvidenceMutationSchema),
  codexInvoked: z.literal(false),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict().superRefine((report, context) => {
  if (report.diffChangeCount !== report.mutations.length || report.mutationCount !== report.mutations.length) {
    context.addIssue({ code: 'custom', path: ['mutationCount'], message: 'mutation count must equal the number of mapped diff changes' });
  }
  if (new Set(report.mutations.map((mutation) => mutation.diffChangeIndex)).size !== report.mutations.length) {
    context.addIssue({ code: 'custom', path: ['mutations'], message: 'each diff change index must be mapped exactly once' });
  }
  if (!report.allDiffChangesCovered) {
    context.addIssue({ code: 'custom', path: ['allDiffChangesCovered'], message: 'candidate commit review requires complete diff coverage' });
  }
});

export const CandidateCommitReviewChangeSchema = z.object({
  mutationId: z.string().min(1),
  mutationType: CandidateCommitMutationTypeSchema,
  statePath: z.string().min(1),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  decision: CandidateCommitMutationDecisionSchema,
  decisionReason: z.string().min(1),
  evidenceMapPath: ArtifactPathSchema
}).strict();

export const CandidateCommitSectionReviewSchema = z.object({
  mutationIds: z.array(z.string()),
  total: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  modifyRequired: z.number().int().nonnegative(),
  needsHumanReview: z.number().int().nonnegative(),
  decision: z.enum(['approve', 'reject', 'modify_required', 'needs_human_review', 'not_applicable']),
  notes: z.array(z.string())
}).strict();

export const CandidateNarrativeDebtDetailSchema = z.object({
  mutationId: z.string().min(1),
  debtId: z.string().min(1),
  debtName: z.string().min(1),
  statusBefore: z.string().min(1),
  statusAfter: z.string().min(1),
  transitionAllowed: z.boolean(),
  evidenceInFinal: z.array(z.string().min(1).max(240)),
  payoffStrength: z.enum(['none', 'maintained', 'escalated', 'partial', 'full']),
  fullyResolvedInText: z.boolean(),
  partiallyPaidInText: z.boolean(),
  escalationSupported: z.boolean(),
  plannedPayoffChapter: z.number().int().positive().nullable(),
  prematureResolutionRisk: z.boolean(),
  downstreamPlanningImpact: z.array(z.string()),
  decision: CandidateCommitMutationDecisionSchema,
  decisionReason: z.string().min(1)
}).strict();

export const CandidateNarrativeDebtReviewSchema = CandidateCommitSectionReviewSchema.extend({
  details: z.array(CandidateNarrativeDebtDetailSchema)
}).strict();

export const CandidateRequiredHumanDecisionSchema = z.object({
  mutationId: z.string().min(1),
  statePath: z.string().min(1),
  question: z.string().min(1),
  recommendedDecision: CandidateCommitMutationDecisionSchema,
  decision: z.enum(['approve', 'reject', 'modify_required']).nullable(),
  rationaleRequired: z.boolean()
}).strict();

export const CandidateCommitOverallDecisionSchema = z.enum(['approved_for_commit', 'changes_required', 'rejected', 'human_review_incomplete']);

export const CandidatePatchReviewSchema = z.object({
  proposalSchemaValid: z.literal(true),
  normalizedSchemaValid: z.literal(true),
  proposalNormalizationEquivalent: z.boolean(),
  patchMutationCount: z.number().int().nonnegative(),
  decision: z.enum(['approve', 'reject', 'modify_required', 'needs_human_review']),
  notes: z.array(z.string())
}).strict();

export const CandidateConflictReviewSchema = z.object({
  conflictCheckPassed: z.boolean(),
  conflictCount: z.number().int().nonnegative(),
  conflictReportPath: ArtifactPathSchema.nullable(),
  decision: z.enum(['approve', 'reject', 'needs_human_review']),
  decisionReason: z.string().min(1)
}).strict();

export const CandidateCommitReviewSchema = z.object({
  reviewId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  runId: z.string().min(1),
  generatedAt: z.string().min(1),
  candidatePath: ArtifactPathSchema,
  adoptedDraftPath: ArtifactPathSchema,
  finalPreviewPath: ArtifactPathSchema,
  patchProposalPath: ArtifactPathSchema,
  normalizedPatchPath: ArtifactPathSchema,
  conflictReportPath: ArtifactPathSchema.nullable(),
  stateDiffPath: ArtifactPathSchema,
  completenessReportPath: ArtifactPathSchema,
  candidatePreviewReportPath: ArtifactPathSchema,
  evidenceMapPath: ArtifactPathSchema,
  evidenceMapHash: Sha256Schema,
  sourceStateHash: Sha256Schema,
  sourceQueueHash: Sha256Schema,
  sourceDraftHash: Sha256Schema,
  finalPreviewHash: Sha256Schema,
  normalizedPatchHash: Sha256Schema,
  stateDiffHash: Sha256Schema,
  changes: z.array(CandidateCommitReviewChangeSchema),
  highRiskChanges: z.array(CandidateCommitReviewChangeSchema),
  canonFactReview: CandidateCommitSectionReviewSchema,
  timelineReview: CandidateCommitSectionReviewSchema,
  narrativeDebtReview: CandidateNarrativeDebtReviewSchema,
  foreshadowingReview: CandidateCommitSectionReviewSchema,
  characterStateReview: CandidateCommitSectionReviewSchema,
  readerStateReview: CandidateCommitSectionReviewSchema,
  relationshipReview: CandidateCommitSectionReviewSchema,
  latestCommittedChapterReview: CandidateCommitSectionReviewSchema,
  patchReview: CandidatePatchReviewSchema.default({
    proposalSchemaValid: true,
    normalizedSchemaValid: true,
    proposalNormalizationEquivalent: true,
    patchMutationCount: 0,
    decision: 'approve',
    notes: ['Legacy D4A report generated before explicit patch review fields were persisted.']
  }),
  conflictReview: CandidateConflictReviewSchema.default({
    conflictCheckPassed: true,
    conflictCount: 0,
    conflictReportPath: null,
    decision: 'approve',
    decisionReason: 'Legacy D4A report inherited the complete D3 conflict gate.'
  }),
  overallDecision: CandidateCommitOverallDecisionSchema,
  blockingReasons: z.array(z.string()),
  warnings: z.array(z.string()),
  requiredHumanDecisions: z.array(CandidateRequiredHumanDecisionSchema),
  recommendedNextStep: z.enum(['record_human_commit_decisions', 'changes_required', 'reject_candidate', 'ready_for_commit_approval']),
  commitApprovalGenerated: z.literal(false),
  codexInvoked: z.literal(false),
  canonicalArtifactsGenerated: z.literal(false),
  snapshotCreated: z.literal(false),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict().superRefine((report, context) => {
  const highRiskIds = report.changes.filter((change) => change.riskLevel === 'high' || change.riskLevel === 'critical').map((change) => change.mutationId).sort();
  const listedIds = report.highRiskChanges.map((change) => change.mutationId).sort();
  if (JSON.stringify(highRiskIds) !== JSON.stringify(listedIds)) {
    context.addIssue({ code: 'custom', path: ['highRiskChanges'], message: 'high-risk review list must exactly match high-risk changes' });
  }
  if (report.overallDecision === 'approved_for_commit' && report.requiredHumanDecisions.some((decision) => decision.decision !== 'approve')) {
    context.addIssue({ code: 'custom', path: ['overallDecision'], message: 'commit cannot be approved before every required human decision explicitly passes' });
  }
});

export type CandidateCommitMutationDecision = z.infer<typeof CandidateCommitMutationDecisionSchema>;
export type CandidateCommitMutationType = z.infer<typeof CandidateCommitMutationTypeSchema>;
export type CandidatePatchEvidenceMutation = z.infer<typeof CandidatePatchEvidenceMutationSchema>;
export type CandidatePatchEvidenceMap = z.infer<typeof CandidatePatchEvidenceMapSchema>;
export type CandidateCommitReviewChange = z.infer<typeof CandidateCommitReviewChangeSchema>;
export type CandidateCommitSectionReview = z.infer<typeof CandidateCommitSectionReviewSchema>;
export type CandidateNarrativeDebtDetail = z.infer<typeof CandidateNarrativeDebtDetailSchema>;
export type CandidateCommitReview = z.infer<typeof CandidateCommitReviewSchema>;
