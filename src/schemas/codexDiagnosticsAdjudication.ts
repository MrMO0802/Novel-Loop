import { z } from 'zod';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const CodexDiagnosticsAdjudicationSchema = z.enum([
  'confirmed_true_positive',
  'likely_true_positive',
  'ambiguous',
  'false_positive',
  'insufficient_evidence'
]);

export const CodexDiagnosticsAdjudicationConfidenceSchema = z.enum(['low', 'medium', 'high']);

export const CodexDiagnosticsEvidenceClaimSchema = z.object({
  claimId: z.string(),
  normalizedClaim: z.string(),
  sourceSampleIds: z.array(z.string()).min(1),
  occurrenceCount: z.number().int().positive(),
  checkName: z.literal('timeline_consistency'),
  claimedEventA: z.string(),
  claimedEventB: z.string(),
  claimedContradiction: z.string(),
  sourceEvidenceText: z.array(z.string()).min(1),
  evidenceFingerprint: Sha256Schema
}).strict();

export const CodexDiagnosticsDraftEvidenceSchema = z.object({
  evidenceId: z.string(),
  path: z.string(),
  paragraphIndex: z.number().int().positive(),
  lineOrSection: z.string(),
  snippet: z.string().min(1).max(240),
  normalizedSnippetHash: Sha256Schema,
  actor: z.string(),
  location: z.string(),
  eventDescription: z.string(),
  explicitTime: z.string().nullable(),
  inferredTime: z.string().nullable(),
  dayReference: z.string()
}).strict();

export const CodexDiagnosticsPlanningEvidenceSchema = z.object({
  evidenceId: z.string(),
  path: z.string(),
  sourceType: z.enum(['mission', 'selected_plan']),
  locator: z.string(),
  snippet: z.string().min(1).max(240),
  normalizedSnippetHash: Sha256Schema,
  eventDescription: z.string(),
  expectedTime: z.string().nullable()
}).strict();

export const CodexDiagnosticsCanonEvidenceSchema = z.object({
  evidenceId: z.string(),
  statePath: z.string(),
  timelineEventId: z.string(),
  chapterNumber: z.number().int().positive(),
  eventDescription: z.string(),
  actor: z.string(),
  location: z.string(),
  explicitTime: z.string().nullable(),
  dayReference: z.string(),
  relatedCanonFactIds: z.array(z.string())
}).strict();

export const CodexDiagnosticsAdjudicationEventSchema = z.object({
  eventId: z.string(),
  label: z.string(),
  sourceType: z.enum(['draft', 'mission', 'selected_plan', 'canon']),
  sourcePath: z.string(),
  evidenceIds: z.array(z.string()).min(1),
  actor: z.string().nullable(),
  recipient: z.string().nullable(),
  location: z.string().nullable(),
  objectOrOrder: z.string().nullable(),
  outcome: z.string().nullable(),
  narrativePurpose: z.string().nullable(),
  temporalMode: z.enum(['current', 'current_event_record', 'memory', 'log', 'recording', 'historical', 'planned', 'canon']),
  explicitTime: z.string().nullable(),
  inferredTime: z.string().nullable(),
  dayReference: z.string()
}).strict();

export const CodexDiagnosticsEventComparisonSchema = z.object({
  comparisonId: z.string(),
  eventA: CodexDiagnosticsAdjudicationEventSchema,
  eventB: CodexDiagnosticsAdjudicationEventSchema,
  sameActor: z.boolean().nullable(),
  sameRecipient: z.boolean().nullable(),
  sameLocation: z.boolean().nullable(),
  sameObjectOrOrder: z.boolean().nullable(),
  sameOutcome: z.boolean().nullable(),
  sameNarrativePurpose: z.boolean().nullable(),
  sameDay: z.boolean().nullable(),
  sameEventConfidence: z.number().min(0).max(1),
  identityEvidence: z.array(z.string()),
  differenceEvidence: z.array(z.string()),
  conclusion: z.enum(['same_event', 'likely_same_event', 'different_events', 'ambiguous'])
}).strict();

export const CodexDiagnosticsTemporalRuleSchema = z.object({
  ruleId: z.enum([
    'same_event_same_day_explicit_time_conflict',
    'different_order_or_recipient',
    'memory_log_history_separation',
    'unclear_day_offset',
    'mission_plan_time_mismatch',
    'canon_timeline_time_mismatch',
    'duplicate_event_repetition'
  ]),
  comparisonId: z.string(),
  outcome: z.enum(['confirmed_contradiction', 'not_contradiction', 'ambiguous', 'insufficient_evidence']),
  evidenceIds: z.array(z.string()),
  explanation: z.string()
}).strict();

export const CodexDiagnosticsSampleConsensusSchema = z.object({
  sampleCount: z.number().int().nonnegative(),
  validSampleCount: z.number().int().nonnegative(),
  samplesReportingTimelineFailure: z.number().int().nonnegative(),
  uniqueClaimCount: z.number().int().nonnegative(),
  repeatabilityRate: z.number().min(0).max(1),
  structuralAgreement: z.number().min(0).max(1),
  evidenceAgreement: z.number().min(0).max(1),
  semanticAgreement: z.number().min(0).max(1),
  independenceCaveat: z.string()
}).strict();

export const CodexDiagnosticsRevisionScopeRecommendationSchema = z.object({
  affectedParagraphs: z.array(z.number().int().positive()),
  minimalRevisionScope: z.string(),
  factsToPreserve: z.array(z.string()),
  factsToCorrect: z.array(z.string()),
  forbiddenChanges: z.array(z.string()),
  suggestedRevisionInstruction: z.string(),
  diagnosticsPromptCalibrationSuggestion: z.string().nullable(),
  humanReviewQuestion: z.string().nullable(),
  timelineMetadataNeeded: z.array(z.string())
}).strict();

export const CodexDiagnosticsProtectedArtifactSchema = z.object({
  path: z.string(),
  beforeSha256: Sha256Schema,
  afterSha256: Sha256Schema,
  unchanged: z.literal(true)
}).strict();

export const CodexDiagnosticsCanonicalContextReviewSchema = z.object({
  latestCommittedChapter: z.number().int().nonnegative(),
  timelineEventsReviewed: z.number().int().nonnegative(),
  characterStatesReviewed: z.number().int().nonnegative(),
  relevantCharacterStateIds: z.array(z.string()),
  canonicalTimelineConflictFound: z.boolean(),
  characterStateConflictFound: z.boolean(),
  notes: z.array(z.string())
}).strict();

export const CodexDiagnosticsEvidenceAdjudicationSchema = z.object({
  reportId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string(),
  sourceDraftPath: z.string(),
  sourceMissionPath: z.string(),
  sourceSelectedPlanPath: z.string(),
  sourceStoryStatePath: z.string(),
  sourceDiagnosticsBenchmarkPath: z.string(),
  sourceSchemaBenchmarkPath: z.string(),
  timelineContradictionMapPath: z.string(),
  checkName: z.literal('timeline_consistency'),
  repeatedSampleCount: z.number().int().nonnegative(),
  repeatedFailureCount: z.number().int().nonnegative(),
  repeatabilityRate: z.number().min(0).max(1),
  evidenceClaims: z.array(CodexDiagnosticsEvidenceClaimSchema),
  draftEvidence: z.array(CodexDiagnosticsDraftEvidenceSchema),
  planningEvidence: z.array(CodexDiagnosticsPlanningEvidenceSchema),
  canonEvidence: z.array(CodexDiagnosticsCanonEvidenceSchema),
  canonicalContextReview: CodexDiagnosticsCanonicalContextReviewSchema.optional(),
  eventComparisons: z.array(CodexDiagnosticsEventComparisonSchema),
  temporalRulesTriggered: z.array(CodexDiagnosticsTemporalRuleSchema),
  sampleConsensus: CodexDiagnosticsSampleConsensusSchema,
  adjudication: CodexDiagnosticsAdjudicationSchema,
  confidence: CodexDiagnosticsAdjudicationConfidenceSchema,
  falsePositiveFactors: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  recommendedNextStep: z.string(),
  revisionScopeRecommendation: CodexDiagnosticsRevisionScopeRecommendationSchema,
  protectedArtifacts: z.array(CodexDiagnosticsProtectedArtifactSchema).min(1),
  storyStateMutated: z.literal(false),
  queueMutated: z.literal(false),
  draftMutated: z.literal(false),
  canonicalDiagnosticsMutated: z.literal(false)
}).strict().superRefine((report, context) => {
  if (report.repeatedFailureCount > report.sampleConsensus.validSampleCount) {
    context.addIssue({ code: 'custom', path: ['repeatedFailureCount'], message: 'repeatedFailureCount cannot exceed validSampleCount' });
  }
  if (report.adjudication === 'confirmed_true_positive') {
    if (report.evidenceClaims.length === 0 || report.draftEvidence.length === 0) {
      context.addIssue({ code: 'custom', path: ['adjudication'], message: 'confirmed_true_positive requires concrete claims and draft evidence' });
    }
    if (!report.temporalRulesTriggered.some((rule) => rule.outcome === 'confirmed_contradiction')) {
      context.addIssue({ code: 'custom', path: ['temporalRulesTriggered'], message: 'confirmed_true_positive requires a confirmed temporal rule' });
    }
  }
  if (report.adjudication === 'false_positive' && report.falsePositiveFactors.length === 0) {
    context.addIssue({ code: 'custom', path: ['falsePositiveFactors'], message: 'false_positive requires falsePositiveFactors' });
  }
});

export const TimelineContradictionEventNodeSchema = CodexDiagnosticsAdjudicationEventSchema.extend({
  nodeId: z.string()
}).strict();

export const TimelineContradictionEdgeSchema = z.object({
  edgeId: z.string(),
  fromEventId: z.string(),
  toEventId: z.string(),
  relation: z.enum(['before', 'after', 'same_event', 'likely_same_event', 'duplicate_of', 'records', 'conflicts_with']),
  evidenceIds: z.array(z.string()),
  description: z.string()
}).strict();

export const TimelineContradictionSchema = z.object({
  contradictionId: z.string(),
  eventIds: z.array(z.string()).min(2),
  ruleId: CodexDiagnosticsTemporalRuleSchema.shape.ruleId,
  summary: z.string(),
  evidenceIds: z.array(z.string()).min(1),
  confirmed: z.boolean()
}).strict();

export const TimelineAmbiguousRelationSchema = z.object({
  relationId: z.string(),
  eventIds: z.array(z.string()).min(2),
  reason: z.string(),
  evidenceIds: z.array(z.string())
}).strict();

export const TimelineCanonicalReferenceSchema = z.object({
  statePath: z.string(),
  timelineEventId: z.string(),
  eventNodeId: z.string(),
  evidenceId: z.string()
}).strict();

export const TimelineContradictionMapSchema = z.object({
  mapId: z.string(),
  projectId: z.string(),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string(),
  sourceAdjudicationReportPath: z.string(),
  eventNodes: z.array(TimelineContradictionEventNodeSchema),
  temporalEdges: z.array(TimelineContradictionEdgeSchema),
  contradictions: z.array(TimelineContradictionSchema),
  ambiguousRelations: z.array(TimelineAmbiguousRelationSchema),
  canonicalTimelineReferences: z.array(TimelineCanonicalReferenceSchema),
  storyStateMutated: z.literal(false)
}).strict();

export type CodexDiagnosticsAdjudication = z.infer<typeof CodexDiagnosticsAdjudicationSchema>;
export type CodexDiagnosticsEvidenceClaim = z.infer<typeof CodexDiagnosticsEvidenceClaimSchema>;
export type CodexDiagnosticsDraftEvidence = z.infer<typeof CodexDiagnosticsDraftEvidenceSchema>;
export type CodexDiagnosticsPlanningEvidence = z.infer<typeof CodexDiagnosticsPlanningEvidenceSchema>;
export type CodexDiagnosticsCanonEvidence = z.infer<typeof CodexDiagnosticsCanonEvidenceSchema>;
export type CodexDiagnosticsAdjudicationEvent = z.infer<typeof CodexDiagnosticsAdjudicationEventSchema>;
export type CodexDiagnosticsEventComparison = z.infer<typeof CodexDiagnosticsEventComparisonSchema>;
export type CodexDiagnosticsTemporalRule = z.infer<typeof CodexDiagnosticsTemporalRuleSchema>;
export type CodexDiagnosticsSampleConsensus = z.infer<typeof CodexDiagnosticsSampleConsensusSchema>;
export type CodexDiagnosticsRevisionScopeRecommendation = z.infer<typeof CodexDiagnosticsRevisionScopeRecommendationSchema>;
export type CodexDiagnosticsCanonicalContextReview = z.infer<typeof CodexDiagnosticsCanonicalContextReviewSchema>;
export type CodexDiagnosticsEvidenceAdjudication = z.infer<typeof CodexDiagnosticsEvidenceAdjudicationSchema>;
export type TimelineContradictionMap = z.infer<typeof TimelineContradictionMapSchema>;
