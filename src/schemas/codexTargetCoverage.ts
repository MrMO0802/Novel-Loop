import { z } from 'zod';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RatioSchema = z.number().min(0).max(1);

export const CandidateDispositionResultSchema = z.enum([
  'rejected_no_improvement',
  'rejected_regression',
  'rejected_inconclusive',
  'rejected_insufficient_improvement'
]);

export const CandidateDispositionSchema = z.object({
  dispositionId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  candidatePath: z.string().min(1),
  candidateHash: Sha256Schema,
  experimentReportPath: z.string().min(1),
  experimentReportHash: Sha256Schema,
  sourceDraftPath: z.string().min(1),
  sourceDraftHash: Sha256Schema,
  result: CandidateDispositionResultSchema,
  adopted: z.literal(false),
  rejectionReasons: z.array(z.string().min(1)).min(1),
  baselineTimelineFailureRate: RatioSchema,
  candidateTimelineFailureRate: RatioSchema,
  baselineAverageScore: z.number().min(0).max(10).nullable(),
  candidateAverageScore: z.number().min(0).max(10).nullable(),
  scoreDelta: z.number().nullable(),
  retainForProvenance: z.literal(true),
  eligibleAsNextRevisionBase: z.literal(false),
  generatedAt: z.string().min(1),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict();

export const TargetCoverageStatusSchema = z.enum(['covered', 'partially_covered', 'uncovered', 'newly_exposed']);

export const TargetCoverageInitialTargetSchema = z.object({
  targetId: z.string().min(1),
  paragraphIndex: z.number().int().positive(),
  snippet: z.string().min(1),
  snippetHash: Sha256Schema,
  reason: z.string().min(1),
  linkedClaimIds: z.array(z.string()),
  linkedContradictionIds: z.array(z.string())
}).strict();

export const TargetCoverageResidualClaimSchema = z.object({
  claimId: z.string().min(1),
  normalizedClaim: z.string().min(1),
  relatedOriginalClaimIds: z.array(z.string()),
  relatedRules: z.array(z.string()).min(1),
  baselineEvidencePaths: z.array(z.string()).min(1),
  candidateEvidencePaths: z.array(z.string()).min(1),
  coverageStatus: TargetCoverageStatusSchema,
  uncoveredParagraphs: z.array(z.number().int().positive()),
  reasonFailurePersisted: z.string().min(1),
  evidenceFingerprint: Sha256Schema
}).strict();

export const TargetCoverageResidualEvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  sourceType: z.enum(['draft', 'candidate_diagnostics', 'mission', 'selected_plan']),
  path: z.string().min(1),
  paragraphIndex: z.number().int().positive().nullable(),
  snippet: z.string().min(1).max(600),
  snippetHash: Sha256Schema,
  eventIdentity: z.string().min(1),
  evidenceKind: z.enum(['explicit_time', 'inferred_time', 'action_sequence', 'mission_constraint', 'plan_constraint']),
  linkedClaimIds: z.array(z.string()).min(1),
  linkedContradictionIds: z.array(z.string()),
  initiallyTargeted: z.boolean(),
  residual: z.boolean()
}).strict();

export const TargetCoverageProposedTargetSchema = z.object({
  targetId: z.string().min(1),
  paragraphIndex: z.number().int().positive(),
  snippet: z.string().min(1).max(600),
  snippetHash: Sha256Schema,
  eventIdentity: z.string().min(1),
  reason: z.string().min(1),
  linkedClaimIds: z.array(z.string()).min(1),
  linkedContradictionIds: z.array(z.string()),
  allowedOperationTypes: z.array(z.enum(['replace_paragraph', 'delete_duplicate_paragraph', 'merge_target_paragraphs'])).min(1),
  factsToPreserve: z.array(z.string()).min(1),
  riskLevel: z.enum(['low', 'medium', 'high']),
  requiredForClosure: z.boolean()
}).strict();

export const TargetCoverageMetricsSchema = z.object({
  initialTargetCount: z.number().int().nonnegative(),
  proposedAdditionalTargetCount: z.number().int().nonnegative(),
  uniqueClaimCount: z.number().int().nonnegative(),
  coveredClaimCountBefore: z.number().int().nonnegative(),
  projectedCoveredClaimCountAfter: z.number().int().nonnegative(),
  contradictionEdgeCount: z.number().int().nonnegative(),
  coveredContradictionEdgesBefore: z.number().int().nonnegative(),
  projectedCoveredContradictionEdgesAfter: z.number().int().nonnegative(),
  eventOccurrenceCount: z.number().int().nonnegative(),
  coveredEventOccurrencesBefore: z.number().int().nonnegative(),
  projectedCoveredEventOccurrencesAfter: z.number().int().nonnegative()
}).strict().superRefine((metrics, context) => {
  for (const [coveredField, totalField] of [
    ['coveredClaimCountBefore', 'uniqueClaimCount'],
    ['projectedCoveredClaimCountAfter', 'uniqueClaimCount'],
    ['coveredContradictionEdgesBefore', 'contradictionEdgeCount'],
    ['projectedCoveredContradictionEdgesAfter', 'contradictionEdgeCount'],
    ['coveredEventOccurrencesBefore', 'eventOccurrenceCount'],
    ['projectedCoveredEventOccurrencesAfter', 'eventOccurrenceCount']
  ] as const) {
    if (metrics[coveredField] > metrics[totalField]) {
      context.addIssue({ code: 'custom', path: [coveredField], message: `${coveredField} cannot exceed ${totalField}` });
    }
  }
});

export const TargetCoverageGraphNodeSchema = z.object({
  nodeId: z.string().min(1),
  nodeType: z.enum(['event', 'paragraph_evidence', 'explicit_time', 'inferred_time', 'action_sequence', 'mission_constraint', 'plan_constraint']),
  label: z.string().min(1),
  sourcePath: z.string().nullable(),
  paragraphIndex: z.number().int().positive().nullable(),
  snippetHash: Sha256Schema.nullable(),
  eventIdentity: z.string().nullable(),
  mutableEndpoint: z.boolean(),
  initiallyTargeted: z.boolean(),
  proposedTarget: z.boolean(),
  explicitlyPreserved: z.boolean()
}).strict();

export const TargetCoverageGraphEdgeSchema = z.object({
  edgeId: z.string().min(1),
  edgeType: z.enum(['contradiction', 'duplicate_sequence', 'same_event_identity', 'contains', 'has_time', 'constrained_by']),
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  linkedClaimIds: z.array(z.string()),
  linkedContradictionIds: z.array(z.string()),
  description: z.string().min(1),
  coveredBefore: z.boolean(),
  projectedCoveredAfter: z.boolean()
}).strict();

export const TargetCoverageGraphSchema = z.object({
  graphId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string().min(1),
  sourceDraftPath: z.string().min(1),
  sourceDraftHash: Sha256Schema,
  sourceTimelineMapPath: z.string().min(1),
  sourceExperimentPath: z.string().min(1),
  nodes: z.array(TargetCoverageGraphNodeSchema).min(1),
  edges: z.array(TargetCoverageGraphEdgeSchema).min(1),
  uncoveredNodeIdsBefore: z.array(z.string()),
  uncoveredEdgeIdsBefore: z.array(z.string()),
  uncoveredNodeIdsAfter: z.array(z.string()),
  uncoveredEdgeIdsAfter: z.array(z.string()),
  coverageClosed: z.boolean(),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict().superRefine((graph, context) => {
  const nodeIds = new Set(graph.nodes.map((node) => node.nodeId));
  for (const [index, edge] of graph.edges.entries()) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      context.addIssue({ code: 'custom', path: ['edges', index], message: 'Graph edge references a missing node' });
    }
  }
  if (graph.coverageClosed && (graph.uncoveredNodeIdsAfter.length > 0 || graph.uncoveredEdgeIdsAfter.length > 0)) {
    context.addIssue({ code: 'custom', path: ['coverageClosed'], message: 'Closed graph cannot retain uncovered nodes or edges' });
  }
});

export const TargetCoverageProtectedArtifactSchema = z.object({
  path: z.string().min(1),
  beforeSha256: Sha256Schema,
  afterSha256: Sha256Schema,
  unchanged: z.literal(true)
}).strict();

export const TargetCoverageClosureReportSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string().min(1),
  sourceDraftPath: z.string().min(1),
  sourceDraftHash: Sha256Schema,
  sourceAdjudicationPath: z.string().min(1),
  sourceAdjudicationHash: Sha256Schema,
  sourceTimelineMapPath: z.string().min(1),
  sourceTimelineMapHash: Sha256Schema,
  sourceExperimentPath: z.string().min(1),
  sourceExperimentHash: Sha256Schema,
  sourceRevisionPlanPath: z.string().min(1),
  sourceRevisionPlanHash: Sha256Schema,
  sourceRevisionDiffPath: z.string().min(1),
  sourceRevisionDiffHash: Sha256Schema,
  rejectedCandidatePath: z.string().min(1),
  rejectedCandidateHash: Sha256Schema,
  candidateDispositionPath: z.string().min(1),
  candidateDispositionHash: Sha256Schema,
  targetCoverageGraphPath: z.string().min(1),
  targetCoverageGraphHash: Sha256Schema,
  initialTargets: z.array(TargetCoverageInitialTargetSchema).min(1),
  residualClaims: z.array(TargetCoverageResidualClaimSchema).min(1),
  residualEvidence: z.array(TargetCoverageResidualEvidenceSchema).min(1),
  proposedAdditionalTargets: z.array(TargetCoverageProposedTargetSchema),
  claimCoverageBefore: RatioSchema,
  projectedClaimCoverageAfter: RatioSchema,
  contradictionEdgeCoverageBefore: RatioSchema,
  projectedContradictionEdgeCoverageAfter: RatioSchema,
  eventOccurrenceCoverageBefore: RatioSchema,
  projectedEventOccurrenceCoverageAfter: RatioSchema,
  metrics: TargetCoverageMetricsSchema,
  coverageClosed: z.boolean(),
  humanApprovalRequired: z.literal(true),
  recommendedNextStep: z.string().min(1),
  candidateUsedAsRevisionBase: z.literal(false),
  protectedArtifacts: z.array(TargetCoverageProtectedArtifactSchema).min(1),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false),
  canonicalDraftMutated: z.literal(false),
  canonicalDiagnosticsMutated: z.literal(false)
}).strict().superRefine((report, context) => {
  const expectedRatios = {
    claimCoverageBefore: ratio(report.metrics.coveredClaimCountBefore, report.metrics.uniqueClaimCount),
    projectedClaimCoverageAfter: ratio(report.metrics.projectedCoveredClaimCountAfter, report.metrics.uniqueClaimCount),
    contradictionEdgeCoverageBefore: ratio(report.metrics.coveredContradictionEdgesBefore, report.metrics.contradictionEdgeCount),
    projectedContradictionEdgeCoverageAfter: ratio(report.metrics.projectedCoveredContradictionEdgesAfter, report.metrics.contradictionEdgeCount),
    eventOccurrenceCoverageBefore: ratio(report.metrics.coveredEventOccurrencesBefore, report.metrics.eventOccurrenceCount),
    projectedEventOccurrenceCoverageAfter: ratio(report.metrics.projectedCoveredEventOccurrencesAfter, report.metrics.eventOccurrenceCount)
  };
  if (report.metrics.initialTargetCount !== report.initialTargets.length) {
    context.addIssue({ code: 'custom', path: ['metrics', 'initialTargetCount'], message: 'initialTargetCount does not match initialTargets' });
  }
  if (report.metrics.proposedAdditionalTargetCount !== report.proposedAdditionalTargets.length) {
    context.addIssue({ code: 'custom', path: ['metrics', 'proposedAdditionalTargetCount'], message: 'proposedAdditionalTargetCount does not match proposedAdditionalTargets' });
  }
  if (report.metrics.uniqueClaimCount !== report.residualClaims.length) {
    context.addIssue({ code: 'custom', path: ['metrics', 'uniqueClaimCount'], message: 'uniqueClaimCount does not match residualClaims' });
  }
  for (const [field, expected] of Object.entries(expectedRatios) as Array<[keyof typeof expectedRatios, number]>) {
    if (Math.abs(report[field] - expected) > 0.000001) {
      context.addIssue({ code: 'custom', path: [field], message: `${field} does not match detailed metrics` });
    }
  }
  if (report.coverageClosed && (
    report.projectedClaimCoverageAfter !== 1 ||
    report.projectedContradictionEdgeCoverageAfter !== 1 ||
    report.projectedEventOccurrenceCoverageAfter !== 1 ||
    report.proposedAdditionalTargets.some((target) => target.requiredForClosure && !Sha256Schema.safeParse(target.snippetHash).success)
  )) {
    context.addIssue({ code: 'custom', path: ['coverageClosed'], message: 'coverageClosed requires complete projected coverage and hashed required targets' });
  }
});

const TargetExpansionApprovalBaseSchema = z.object({
  approvalId: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  coverageReportPath: z.string().min(1),
  coverageReportHash: Sha256Schema,
  proposedTargetIds: z.array(z.string()).min(1),
  sourceDraftPath: z.string().min(1),
  sourceDraftHash: Sha256Schema,
  sourceAdjudicationPath: z.string().min(1),
  sourceAdjudicationHash: Sha256Schema,
  sourceTimelineMapPath: z.string().min(1),
  sourceTimelineMapHash: Sha256Schema,
  sourceExperimentPath: z.string().min(1),
  sourceExperimentHash: Sha256Schema,
  candidateDispositionPath: z.string().min(1),
  candidateDispositionHash: Sha256Schema,
  forbiddenChanges: z.array(z.string()).min(1),
  suggestedApprovalCommand: z.string().min(1),
  generatedAt: z.string().min(1),
  candidateGenerated: z.literal(false),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false)
}).strict();

export const TargetExpansionApprovalPreviewSchema = TargetExpansionApprovalBaseSchema.extend({
  approved: z.literal(false),
  confirmedAt: z.null(),
  operator: z.null(),
  riskAcknowledged: z.literal(false)
}).strict();

export const TargetExpansionApprovalRecordSchema = TargetExpansionApprovalBaseSchema.extend({
  approved: z.literal(true),
  confirmedAt: z.string().min(1),
  operator: z.string().min(1),
  riskAcknowledged: z.literal(true),
  sourceApprovalPreviewPath: z.string().min(1),
  sourceApprovalPreviewHash: Sha256Schema
}).strict();

export type CandidateDisposition = z.infer<typeof CandidateDispositionSchema>;
export type TargetCoverageInitialTarget = z.infer<typeof TargetCoverageInitialTargetSchema>;
export type TargetCoverageResidualClaim = z.infer<typeof TargetCoverageResidualClaimSchema>;
export type TargetCoverageResidualEvidence = z.infer<typeof TargetCoverageResidualEvidenceSchema>;
export type TargetCoverageProposedTarget = z.infer<typeof TargetCoverageProposedTargetSchema>;
export type TargetCoverageMetrics = z.infer<typeof TargetCoverageMetricsSchema>;
export type TargetCoverageGraph = z.infer<typeof TargetCoverageGraphSchema>;
export type TargetCoverageClosureReport = z.infer<typeof TargetCoverageClosureReportSchema>;
export type TargetExpansionApprovalPreview = z.infer<typeof TargetExpansionApprovalPreviewSchema>;
export type TargetExpansionApprovalRecord = z.infer<typeof TargetExpansionApprovalRecordSchema>;

function ratio(value: number, total: number): number {
  return total === 0 ? 1 : value / total;
}
