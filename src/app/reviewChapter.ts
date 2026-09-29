import path from 'node:path';
import type { z } from 'zod';

import {
  ChapterQueueSchema,
  CommitReportSchema,
  CodexDiagnosticsBenchmarkReportSchema,
  CodexDiagnosticsContextFixReportSchema,
  CodexDiagnosticsEvidenceAdjudicationSchema,
  DiagnosticsContextManifestSchema,
  CodexDiagnosticsContextAuditSchema,
  CodexDiagnosticsHardFailAnalysisSchema,
  CodexPreviewCompletenessReportSchema,
  CodexPreviewFailureReportSchema,
  ConflictRepairReportSchema,
  ConflictReportSchema,
  DiagnosticsReportSchema,
  FailureReportSchema,
  RevisionOpportunityReportSchema,
  StoryStateSchema,
  CandidateDispositionSchema,
  TargetCoverageClosureReportSchema,
  TargetCoverageGraphSchema,
  TargetExpansionApprovalPreviewSchema,
  TargetExpansionApprovalRecordSchema,
  CandidateRevisionEvidenceAdjudicationSchema,
  CandidateCommitReviewSchema,
  CandidatePatchEvidenceMapSchema,
  CandidatePatchNoopAnalysisSchema,
  CandidateCommitMutationDecisionSchema,
  CandidateCommitReviewFinalizedSchema,
  CandidateCommitApprovalSchema,
  CandidatePatchRefinementManifestSchema,
  CandidatePatchRefinementEquivalenceSchema,
  RefinedStateDiffReportSchema,
  CandidateCommitMutationLineageSchema,
  CandidateCommitDecisionCarryForwardSchema,
  ExpandedTargetRevisionCandidateDispositionSchema,
  ExpandedTargetRevisionDiagnosticsABSchema,
  ExpandedTargetRevisionQualityReportSchema,
  CodexCandidatePreviewReportSchema,
  DraftAdoptionManifestSchema,
  DraftSelectionSchema,
  RevisionCandidateAdoptionApprovalSchema,
  RevisionCandidateReviewSchema,
  TargetedRevisionCandidateDispositionArtifactSchema,
  TargetedRevisionDiffSchema,
  TargetedRevisionExperimentArtifactSchema,
  TargetedRevisionPlanArtifactSchema,
  TargetedRevisionScopeValidationArtifactSchema,
  TimelineContradictionMapSchema
} from '../schemas/index.js';
import type {
  CandidateRevisionEvidenceAdjudication,
  CandidateCommitReview,
  CandidatePatchEvidenceMap,
  CandidatePatchNoopAnalysis,
  CandidateCommitMutationDecision,
  CandidateCommitReviewFinalized,
  CandidateCommitApproval,
  CandidatePatchRefinementManifest,
  CandidatePatchRefinementEquivalence,
  RefinedStateDiffReport,
  CandidateCommitMutationLineage,
  CandidateCommitDecisionCarryForward,
  CandidateDisposition,
  CodexDiagnosticsEvidenceAdjudication,
  ConflictSeverity,
  ExpandedTargetRevisionCandidateDisposition,
  ExpandedTargetRevisionDiagnosticsAB,
  ExpandedTargetRevisionExperimentReport,
  ExpandedTargetRevisionPlan,
  ExpandedTargetRevisionQualityReport,
  CodexCandidatePreviewReport,
  DraftAdoptionManifest,
  DraftSelection,
  RevisionCandidateAdoptionApproval,
  RevisionCandidateReview,
  TargetCoverageClosureReport,
  TargetExpansionApprovalPreview,
  TargetExpansionApprovalRecord,
  TargetedRevisionExperimentReport
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface ReviewChapterInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  conflicts?: boolean;
  diagnostics?: boolean;
  state?: boolean;
  artifacts?: boolean;
  suggestNext?: boolean;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function reviewChapter(input: ReviewChapterInput, fileStore = new FileStore()): Promise<string> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const [queue, storyState] = await Promise.all([
    fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema),
    fileStore.readJson(paths.storyState(), StoryStateSchema)
  ]);
  const queueItem = queue.chapters.find((chapter) => chapter.chapterNumber === input.chapterNumber);
  const latestAdjudication = (await readReports(
    paths,
    fileStore,
    input.chapterNumber,
    'codex_diagnostics_evidence_adjudication',
    CodexDiagnosticsEvidenceAdjudicationSchema
  )).at(-1);
  const targetedExperiments = await readReports(
    paths,
    fileStore,
    input.chapterNumber,
    'targeted_revision_experiment',
    TargetedRevisionExperimentArtifactSchema
  );
  const latestTargetedExperiment = targetedExperiments.at(-1);
  const dispositions = await readReports(
    paths,
    fileStore,
    input.chapterNumber,
    'targeted_revision_candidate_disposition',
    TargetedRevisionCandidateDispositionArtifactSchema
  );
  const latestDisposition = dispositions.filter((report): report is { path: string; value: CandidateDisposition } => !('revisionRound' in report.value)).at(-1);
  const latestV2Disposition = dispositions.filter((report): report is { path: string; value: ExpandedTargetRevisionCandidateDisposition } => 'revisionRound' in report.value).at(-1);
  const targetedPlans = await readReports(paths, fileStore, input.chapterNumber, 'targeted_revision_plan', TargetedRevisionPlanArtifactSchema);
  const latestV2Plan = targetedPlans.filter((report): report is { path: string; value: ExpandedTargetRevisionPlan } => 'revisionRound' in report.value).at(-1);
  const latestV2Diagnostics = (await readReports(paths, fileStore, input.chapterNumber, 'targeted_revision_diagnostics_ab', ExpandedTargetRevisionDiagnosticsABSchema)).at(-1);
  const latestV2Adjudication = (await readReports(paths, fileStore, input.chapterNumber, 'candidate_diagnostics_evidence_adjudication', CandidateRevisionEvidenceAdjudicationSchema)).at(-1);
  const latestV2Quality = (await readReports(paths, fileStore, input.chapterNumber, 'targeted_revision_quality_report', ExpandedTargetRevisionQualityReportSchema)).at(-1);
  const latestCoverage = (await readReports(
    paths,
    fileStore,
    input.chapterNumber,
    'target_coverage_closure_report',
    TargetCoverageClosureReportSchema
  )).at(-1);
  const latestApprovalPreview = (await readReports(
    paths,
    fileStore,
    input.chapterNumber,
    'target_expansion_approval_preview',
    TargetExpansionApprovalPreviewSchema
  )).at(-1);
  const latestApproval = (await readReports(
    paths,
    fileStore,
    input.chapterNumber,
    'target_expansion_approval',
    TargetExpansionApprovalRecordSchema
  )).at(-1);
  const latestCandidateReview = (await readReports(paths, fileStore, input.chapterNumber, 'revision_candidate_review', RevisionCandidateReviewSchema)).at(-1);
  const latestCandidateApproval = (await readReports(paths, fileStore, input.chapterNumber, 'revision_candidate_adoption_approval', RevisionCandidateAdoptionApprovalSchema)).at(-1);
  const latestDraftAdoption = (await readReports(paths, fileStore, input.chapterNumber, 'draft_adoption_manifest', DraftAdoptionManifestSchema)).at(-1);
  const latestDraftSelection = (await readReports(paths, fileStore, input.chapterNumber, 'draft_selection', DraftSelectionSchema)).at(-1);
  const latestCandidatePreview = (await readReports(paths, fileStore, input.chapterNumber, 'codex_candidate_preview_report', CodexCandidatePreviewReportSchema)).at(-1);
  const latestCommitReview = (await readReports(paths, fileStore, input.chapterNumber, 'candidate_commit_review', CandidateCommitReviewSchema)).at(-1);
  const latestEvidenceMap = (await readReports(paths, fileStore, input.chapterNumber, 'candidate_patch_evidence_map', CandidatePatchEvidenceMapSchema)).at(-1);
  const mutationDecisions = await readReports(paths, fileStore, input.chapterNumber, 'candidate_commit_mutation_decision', CandidateCommitMutationDecisionSchema);
  const latestNoopAnalysis = (await readReports(paths, fileStore, input.chapterNumber, 'candidate_patch_noop_analysis', CandidatePatchNoopAnalysisSchema)).at(-1);
  const latestFinalizedCommitReview = (await readReports(paths, fileStore, input.chapterNumber, 'candidate_commit_review_finalized', CandidateCommitReviewFinalizedSchema)).at(-1);
  const latestCommitApproval = (await readReports(paths, fileStore, input.chapterNumber, 'candidate_commit_approval', CandidateCommitApprovalSchema)).at(-1);
  const latestPatchRefinement = (await readReports(paths, fileStore, input.chapterNumber, 'candidate_patch_refinement_manifest', CandidatePatchRefinementManifestSchema)).at(-1);
  const latestPatchEquivalence = (await readReports(paths, fileStore, input.chapterNumber, 'candidate_patch_refinement_equivalence', CandidatePatchRefinementEquivalenceSchema)).at(-1);
  const latestRefinedDiff = (await readReports(paths, fileStore, input.chapterNumber, 'state_diff_refined', RefinedStateDiffReportSchema)).at(-1);
  const latestMutationLineage = (await readReports(paths, fileStore, input.chapterNumber, 'candidate_commit_mutation_lineage', CandidateCommitMutationLineageSchema)).at(-1);
  const latestCarryForward = (await readReports(paths, fileStore, input.chapterNumber, 'candidate_commit_decision_carry_forward_preview', CandidateCommitDecisionCarryForwardSchema)).at(-1);
  const finalPath = relativeChapterArtifact(input.chapterNumber, 'final.md');
  const lines = [
    `Project: ${paths.projectId}`,
    `Chapter: ${input.chapterNumber}`,
    `Queue status: ${queueItem?.status ?? 'missing'}`,
    `Current stage: ${queueItem?.currentStage ?? 'none'}`,
    `Latest run: ${queueItem?.latestRunId ?? 'none'}`,
    `Final path: ${finalPath}`,
    `needs_human_review: ${String(queueItem?.status === 'needs_human_review')}`,
    `failureReason: ${queueItem?.failureReason ?? 'none'}`
  ];

  if (input.diagnostics === true) {
    lines.push('', 'Diagnostics');
    const diagnostics = await readLatestDiagnostics(paths, fileStore, input.chapterNumber);
    if (diagnostics === undefined) {
      lines.push('- none');
    } else {
      lines.push(`- path: ${diagnostics.path}`);
      lines.push(`- hard failures: ${diagnostics.hardFailures}`);
      lines.push(`- soft average: ${diagnostics.softAverage.toFixed(2)}`);
    }
    appendDiagnosticsEvidenceAdjudication(lines, latestAdjudication);
    appendTargetedRevisionExperiment(lines, latestTargetedExperiment);
    appendTargetCoverage(lines, latestDisposition, latestCoverage, latestApprovalPreview, latestApproval);
    appendExpandedTargetRevision(lines, latestV2Plan, latestV2Disposition, latestV2Diagnostics, latestV2Adjudication, latestV2Quality);
    appendCandidateAdoptionAndPreview(lines, latestCandidateReview, latestCandidateApproval, latestDraftAdoption, latestDraftSelection, latestCandidatePreview);
    appendCandidateCommitReview(lines, latestCommitReview, latestEvidenceMap);
    appendCandidateCommitDecisionFinalization(
      lines,
      mutationDecisions,
      latestCommitReview?.path,
      latestNoopAnalysis,
      latestFinalizedCommitReview,
      latestCommitApproval
    );
    appendCandidatePatchRefinement(lines, latestPatchRefinement, latestPatchEquivalence, latestRefinedDiff, latestMutationLineage, latestCarryForward);
  }

  if (input.conflicts === true) {
    lines.push('', 'Conflicts');
    const reports = await readReports(paths, fileStore, input.chapterNumber, 'conflict_report', ConflictReportSchema);
    if (reports.length === 0) {
      lines.push('- none');
    }
    for (const report of reports) {
      const highest = highestSeverity(report.value.conflicts.map((conflict) => conflict.severity));
      lines.push(`- ${report.path}: conflict count: ${report.value.conflicts.length}; highest severity: ${highest}; repairable: ${report.value.conflicts.every((conflict) => conflict.repairable)}`);
    }
  }

  if (input.artifacts === true) {
    lines.push('', 'Artifacts');
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'conflict_report', ConflictReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'conflict_repair_report', ConflictRepairReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'commit_report', CommitReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'failure_report', FailureReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'codex_preview_completeness_report', CodexPreviewCompletenessReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'codex_preview_failure_report', CodexPreviewFailureReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'codex_diagnostics_hard_fail_analysis', CodexDiagnosticsHardFailAnalysisSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'diagnostics_context_audit', CodexDiagnosticsContextAuditSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'diagnostics_context_manifest', DiagnosticsContextManifestSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'codex_diagnostics_benchmark', CodexDiagnosticsBenchmarkReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'codex_diagnostics_context_fix_report', CodexDiagnosticsContextFixReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'revision_opportunity_report', RevisionOpportunityReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'codex_diagnostics_evidence_adjudication', CodexDiagnosticsEvidenceAdjudicationSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'timeline_contradiction_map', TimelineContradictionMapSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_plan', TargetedRevisionPlanArtifactSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_scope_validation', TargetedRevisionScopeValidationArtifactSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_diff', TargetedRevisionDiffSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_experiment', TargetedRevisionExperimentArtifactSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_candidate_disposition', TargetedRevisionCandidateDispositionArtifactSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_diagnostics_ab', ExpandedTargetRevisionDiagnosticsABSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_diagnostics_evidence_adjudication', CandidateRevisionEvidenceAdjudicationSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_quality_report', ExpandedTargetRevisionQualityReportSchema);
    await appendMatchingFiles(lines, paths, fileStore, input.chapterNumber, /^candidate_timeline_contradiction_map_v\d+\.(?:json|md)$/);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'target_coverage_graph', TargetCoverageGraphSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'target_coverage_closure_report', TargetCoverageClosureReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'target_expansion_approval_preview', TargetExpansionApprovalPreviewSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'target_expansion_approval', TargetExpansionApprovalRecordSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'revision_candidate_review', RevisionCandidateReviewSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'revision_candidate_adoption_approval', RevisionCandidateAdoptionApprovalSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'draft_adoption_manifest', DraftAdoptionManifestSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'draft_selection', DraftSelectionSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'codex_candidate_preview_report', CodexCandidatePreviewReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_patch_evidence_map', CandidatePatchEvidenceMapSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_commit_review', CandidateCommitReviewSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_patch_noop_analysis', CandidatePatchNoopAnalysisSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_commit_mutation_decision', CandidateCommitMutationDecisionSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_commit_review_finalized', CandidateCommitReviewFinalizedSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_commit_approval', CandidateCommitApprovalSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_patch_refinement_manifest', CandidatePatchRefinementManifestSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_patch_refinement_equivalence', CandidatePatchRefinementEquivalenceSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'state_diff_refined', RefinedStateDiffReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_commit_mutation_lineage', CandidateCommitMutationLineageSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'candidate_commit_decision_carry_forward_preview', CandidateCommitDecisionCarryForwardSchema);
    await appendMatchingFiles(lines, paths, fileStore, input.chapterNumber, /^(?:candidate_patch_refined|candidate_patch_refined_validation|candidate_patch_refined_conflict|high_risk_state_change_review|codex_candidate_preview_refined|codex_preview_completeness_refined)_v\d+\.(?:json|md)$/);
    await appendMatchingFiles(lines, paths, fileStore, input.chapterNumber, /^(?:draft_v2|final_candidate_preview_v2)\.md$/);
    await appendMatchingFiles(lines, paths, fileStore, input.chapterNumber, /^(?:diagnostics_v2|codex_chapter_quality_report_v2|canon_patch_codex_(?:proposal|normalized)_v2|state_diff_codex_preview_v2)\.(?:json|md)$/);
    await appendMatchingFiles(lines, paths, fileStore, input.chapterNumber, /^draft_targeted_revision_candidate_v\d+\.md$/);
    await appendPreviewCompleteness(lines, paths, fileStore, input.chapterNumber);
    await appendDiagnosticsHardFailAnalysis(lines, paths, fileStore, input.chapterNumber);
    await appendDiagnosticsContextFix(lines, paths, fileStore, input.chapterNumber);
  }

  if (input.state === true) {
    lines.push('', 'State Summary');
    const openDebts = storyState.narrativeDebts.filter((debt) => debt.status === 'open' || debt.status === 'escalated' || debt.status === 'partially_paid');
    lines.push(`- latestCommittedChapter: ${storyState.latestCommittedChapter}`);
    lines.push(`- open narrative debts: ${openDebts.length}`);
    for (const debt of openDebts.slice(0, 5)) {
      lines.push(`  - ${debt.id} [${debt.status}] ${debt.readerQuestion}`);
    }
    lines.push(`- reader expectations: ${storyState.readerState.readerExpectations.length}`);
    for (const expectation of storyState.readerState.readerExpectations.slice(0, 5)) {
      lines.push(`  - ${expectation}`);
    }
  }

  if (input.suggestNext === true) {
    lines.push('', 'Suggested command:');
    lines.push(suggestNextCommand(
      paths.projectId,
      input.chapterNumber,
      queueItem?.status,
      latestAdjudication?.value,
      latestTargetedExperiment?.value,
      latestCoverage?.value,
      latestApprovalPreview?.value,
      latestApproval?.value,
      latestV2Disposition?.value,
      latestCandidateReview?.value,
      latestCandidateApproval?.value,
      latestDraftAdoption?.value,
      latestCandidatePreview?.value,
      latestCommitReview?.value,
      latestFinalizedCommitReview?.value,
      latestCommitApproval?.value,
      latestPatchRefinement?.value,
      latestCarryForward?.value
    ));
  }

  return `${lines.join('\n')}\n`;
}

async function readLatestDiagnostics(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number) {
  const reports = await readReports(paths, fileStore, chapterNumber, 'diagnostics', DiagnosticsReportSchema);
  const latest = reports.at(-1);
  if (latest === undefined) {
    return undefined;
  }
  const hardFailures = Object.values(latest.value.hard_checks).filter((check) => !check.passed).length;
  const softScores = Object.values(latest.value.soft_scores);
  const softAverage = softScores.reduce((sum, score) => sum + score, 0) / softScores.length;
  return {
    path: latest.path,
    hardFailures,
    softAverage
  };
}

async function appendArtifactList<T>(
  lines: string[],
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string,
  schema: z.ZodType<T>
): Promise<void> {
  const reports = await readReports(paths, fileStore, chapterNumber, baseName, schema);
  if (reports.length === 0) {
    lines.push(`- ${baseName}: none`);
    return;
  }
  for (const report of reports) {
    lines.push(`- ${report.path}`);
  }
}

async function appendMatchingFiles(
  lines: string[],
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  pattern: RegExp
): Promise<void> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) return;
  for (const fileName of (await fileStore.list(chapterDir)).filter((entry) => pattern.test(entry)).sort()) {
    lines.push(`- ${relativeChapterArtifact(chapterNumber, fileName)}`);
  }
}

async function readReports<T>(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string,
  schema: z.ZodType<T>
): Promise<Array<{ path: string; value: T }>> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) {
    return [];
  }
  const pattern = baseName === 'commit_report' || baseName === 'failure_report' ? new RegExp(`^${baseName}\\.json$`) : new RegExp(`^${baseName}_v\\d+\\.json$`);
  const entries = (await fileStore.list(chapterDir)).filter((entry) => pattern.test(entry));
  const reports: Array<{ path: string; value: T }> = [];
  for (const entry of entries) {
    reports.push({
      path: relativeChapterArtifact(chapterNumber, entry),
      value: await fileStore.readJson(paths.chapterArtifact(chapterNumber, entry), schema)
    });
  }
  return reports.sort((left, right) => versionedArtifactPathCompare(left.path, right.path));
}

function versionedArtifactPathCompare(left: string, right: string): number {
  const leftVersion = Number.parseInt(/_v(\d+)\.json$/.exec(left)?.[1] ?? '0', 10);
  const rightVersion = Number.parseInt(/_v(\d+)\.json$/.exec(right)?.[1] ?? '0', 10);
  return leftVersion - rightVersion || left.localeCompare(right);
}

function suggestNextCommand(
  projectId: string,
  chapterNumber: number,
  status: string | undefined,
  adjudication: CodexDiagnosticsEvidenceAdjudication | undefined,
  experiment: TargetedRevisionExperimentReport | ExpandedTargetRevisionExperimentReport | undefined,
  coverage: TargetCoverageClosureReport | undefined,
  approvalPreview: TargetExpansionApprovalPreview | undefined,
  approval: TargetExpansionApprovalRecord | undefined,
  v2Disposition: ExpandedTargetRevisionCandidateDisposition | undefined,
  candidateReview: RevisionCandidateReview | undefined,
  candidateApproval: RevisionCandidateAdoptionApproval | undefined,
  draftAdoption: DraftAdoptionManifest | undefined,
  candidatePreview: CodexCandidatePreviewReport | undefined,
  candidateCommitReview: CandidateCommitReview | undefined,
  finalizedCommitReview: CandidateCommitReviewFinalized | undefined,
  commitApproval: CandidateCommitApproval | undefined,
  patchRefinement: CandidatePatchRefinementManifest | undefined,
  carryForward: CandidateCommitDecisionCarryForward | undefined
): string {
  if (commitApproval !== undefined) {
    return `candidate commit approval ${commitApproval.approvalId} is ready for one controlled local commit; approval remains unconsumed`;
  }
  if (carryForward?.approved === true) {
    return `corepack pnpm novel-loop codex finalize-candidate-commit-review ${projectId} ${chapterNumber} --review latest`;
  }
  if (patchRefinement !== undefined && carryForward !== undefined && !carryForward.approved) {
    return `corepack pnpm novel-loop codex carry-forward-candidate-commit-decisions ${projectId} ${chapterNumber} --preview latest --confirm`;
  }
  if (finalizedCommitReview !== undefined) {
    if (finalizedCommitReview.overallDecision === 'approved_for_commit') {
      return `corepack pnpm novel-loop codex approve-candidate-commit ${projectId} ${chapterNumber} --review latest --confirm`;
    }
    if (finalizedCommitReview.overallDecision === 'human_review_incomplete') {
      return `record active decisions for mutations ${finalizedCommitReview.unresolvedMutationIds.join(', ')} and rerun finalize-candidate-commit-review`;
    }
    return `finalized commit review is ${finalizedCommitReview.overallDecision}; modify or reject the candidate patch before any approval`;
  }
  if (candidateCommitReview !== undefined) {
    return candidateCommitReview.overallDecision === 'human_review_incomplete'
      ? `record human commit decisions for ${candidateCommitReview.requiredHumanDecisions.map((decision) => decision.statePath).join(', ')}; no commit approval exists`
      : `review ${candidateCommitReview.recommendedNextStep}; D4A does not approve or execute commit`;
  }
  if (candidatePreview !== undefined) {
    return candidatePreview.previewComplete
      ? `human commit review required for ${candidatePreview.finalPath ?? candidatePreview.adoptedDraftPath}; D3 does not approve or execute commit`
      : `corepack pnpm novel-loop review ${projectId} ${chapterNumber} --diagnostics --artifacts --state --suggest-next`;
  }
  if (draftAdoption !== undefined) {
    return `corepack pnpm novel-loop codex resume-preview-with-candidate ${projectId} ${chapterNumber} --draft draft_v2 --approval latest --codex-profile clean --codex-json-retries 2 --codex-json-repair`;
  }
  if (candidateApproval !== undefined) {
    return `corepack pnpm novel-loop codex adopt-revision-candidate ${projectId} ${chapterNumber} --candidate latest --approval latest`;
  }
  if (candidateReview !== undefined) {
    return `corepack pnpm novel-loop codex approve-revision-candidate ${projectId} ${chapterNumber} --candidate latest --confirm`;
  }
  if (v2Disposition !== undefined) {
    return v2Disposition.result === 'accepted_for_preview_review'
      ? `corepack pnpm novel-loop codex review-revision-candidate ${projectId} ${chapterNumber} --candidate latest`
      : 'Candidate v2 requires human review. Automatic revision round 3 is disabled.';
  }
  if (coverage !== undefined && approval === undefined) {
    return coverage.coverageClosed
      ? approvalPreview?.suggestedApprovalCommand ?? `corepack pnpm novel-loop codex approve-target-expansion ${projectId} ${chapterNumber} --report latest --confirm`
      : 'Target coverage remains open. Do not approve or run a second targeted revision experiment.';
  }
  if (coverage !== undefined && approval !== undefined) {
    return `corepack pnpm novel-loop codex targeted-revision-experiment ${projectId} ${chapterNumber} --approval latest --revision-round 2 --samples 3 --context-mode enhanced --codex-profile clean --codex-json-retries 2 --codex-json-repair`;
  }
  if (experiment !== undefined && 'revisionRound' in experiment) {
    return experiment.recommendation;
  }
  if (experiment?.result === 'candidate_clears_timeline_failure') {
    return `human review the isolated candidate ${experiment.candidateDraftPath} and ${experiment.revisionDiffPath}; candidate adoption, preview, and commit remain disabled`;
  }
  if (experiment !== undefined) {
    return `${experiment.recommendation} No candidate was adopted.`;
  }
  if (adjudication?.adjudication === 'confirmed_true_positive' || adjudication?.adjudication === 'likely_true_positive') {
    return `corepack pnpm novel-loop codex targeted-revision-experiment ${projectId} ${chapterNumber} --adjudication latest --samples 3 --context-mode enhanced --codex-profile clean --codex-json-retries 2 --codex-json-repair`;
  }
  if (adjudication?.adjudication === 'false_positive') {
    return 'diagnostics prompt calibration is recommended; do not modify the chapter draft';
  }
  if (adjudication?.adjudication === 'ambiguous' || adjudication?.adjudication === 'insufficient_evidence') {
    return `corepack pnpm novel-loop review ${projectId} ${chapterNumber} --diagnostics --artifacts --state`;
  }
  if (status === 'blocked' || status === 'needs_human_review') {
    return `corepack pnpm novel-loop recommit ${projectId} ${chapterNumber} --from-final --confirm`;
  }
  return `corepack pnpm novel-loop review ${projectId} ${chapterNumber} --diagnostics --state --artifacts`;
}

function appendCandidateAdoptionAndPreview(
  lines: string[],
  review: { path: string; value: RevisionCandidateReview } | undefined,
  approval: { path: string; value: RevisionCandidateAdoptionApproval } | undefined,
  adoption: { path: string; value: DraftAdoptionManifest } | undefined,
  selection: { path: string; value: DraftSelection } | undefined,
  preview: { path: string; value: CodexCandidatePreviewReport } | undefined
): void {
  if (review !== undefined) {
    lines.push('', 'Candidate v2 review');
    lines.push(`- path: ${review.path}`);
    lines.push(`- candidatePath: ${review.value.candidatePath}`);
    lines.push(`- experimentResult: ${review.value.experimentResult}`);
    lines.push(`- disposition: ${review.value.disposition}`);
    lines.push(`- checklistPassed: ${String(review.value.humanReviewChecklist.every((item) => item.passed))}`);
    lines.push(`- approvedForAdoption: ${String(review.value.approvedForAdoption)}`);
  }
  if (approval !== undefined) {
    lines.push('', 'Candidate adoption approval');
    lines.push(`- path: ${approval.path}`);
    lines.push(`- approved: ${String(approval.value.approved)}`);
    lines.push(`- operator: ${approval.value.operator}`);
    lines.push(`- approvalScope: ${approval.value.approvalScope}`);
  }
  if (adoption !== undefined) {
    lines.push('', 'Draft adoption');
    lines.push(`- manifestPath: ${adoption.path}`);
    lines.push(`- candidatePath: ${adoption.value.candidatePath}`);
    lines.push(`- adoptedDraftPath: ${adoption.value.adoptedDraftPath}`);
    lines.push(`- canonical: ${String(adoption.value.canonical)}`);
    lines.push(`- storyStateMutated: ${String(adoption.value.storyStateMutated)}`);
  }
  if (selection !== undefined) {
    lines.push(`- draftSelectionPath: ${selection.path}`);
    lines.push(`- selectedDraftVersion: ${selection.value.selectedDraftVersion}`);
    lines.push(`- selectedDraftPath: ${selection.value.selectedDraftPath}`);
  }
  if (preview !== undefined) {
    lines.push('', 'Standard candidate diagnostics');
    lines.push(`- diagnosticsPath: ${preview.value.diagnosticsPath}`);
    lines.push(`- diagnosticsPassed: ${String(preview.value.diagnosticsPassed)}`);
    lines.push(`- abDiagnosticsReused: ${String(preview.value.abDiagnosticsReused)}`);
    lines.push('', 'Candidate preview');
    lines.push(`- path: ${preview.path}`);
    lines.push(`- finalPath: ${preview.value.finalPath ?? 'none'}`);
    lines.push(`- qualityReportPath: ${preview.value.qualityReportPath ?? 'none'}`);
    lines.push(`- patchProposalPath: ${preview.value.patchProposalPath ?? 'none'}`);
    lines.push(`- normalizedPatchPath: ${preview.value.normalizedPatchPath ?? 'none'}`);
    lines.push(`- conflictReportPath: ${preview.value.conflictReportPath ?? 'none'}`);
    lines.push(`- stateDiffPath: ${preview.value.stateDiffPath ?? 'none'}`);
    lines.push(`- completenessReportPath: ${preview.value.completenessReportPath}`);
    lines.push(`- previewComplete: ${String(preview.value.previewComplete)}`);
    lines.push(`- storyStateMutated: ${String(preview.value.storyStateMutated)}`);
    lines.push(`- queueCommitted: ${String(preview.value.queueCommitted)}`);
    lines.push(`- recommendedNextStep: ${preview.value.recommendedNextStep}`);
  }
}

function appendCandidateCommitReview(
  lines: string[],
  review: { path: string; value: CandidateCommitReview } | undefined,
  evidenceMap: { path: string; value: CandidatePatchEvidenceMap } | undefined
): void {
  if (evidenceMap !== undefined) {
    lines.push('', 'Patch evidence map');
    lines.push(`- path: ${evidenceMap.path}`);
    lines.push(`- mutationCount: ${evidenceMap.value.mutationCount}`);
    lines.push(`- allDiffChangesCovered: ${String(evidenceMap.value.allDiffChangesCovered)}`);
  }
  if (review !== undefined) {
    lines.push('', 'Candidate commit review');
    lines.push(`- path: ${review.path}`);
    lines.push(`- overallDecision: ${review.value.overallDecision}`);
    lines.push(`- changesReviewed: ${review.value.changes.length}`);
    lines.push(`- highRiskChanges: ${review.value.highRiskChanges.length}`);
    lines.push(`- requiredHumanDecisions: ${review.value.requiredHumanDecisions.length}`);
    lines.push(`- recommendedNextStep: ${review.value.recommendedNextStep}`);
    lines.push(`- commitApprovalGenerated: ${String(review.value.commitApprovalGenerated)}`);
    lines.push(`- storyStateMutated: ${String(review.value.storyStateMutated)}`);
    lines.push(`- queueMutated: ${String(review.value.queueMutated)}`);
  }
}

function appendCandidateCommitDecisionFinalization(
  lines: string[],
  decisions: Array<{ path: string; value: CandidateCommitMutationDecision }>,
  activeReviewPath: string | undefined,
  noop: { path: string; value: CandidatePatchNoopAnalysis } | undefined,
  finalized: { path: string; value: CandidateCommitReviewFinalized } | undefined,
  approval: { path: string; value: CandidateCommitApproval } | undefined
): void {
  const reviewDecisions = activeReviewPath === undefined
    ? decisions
    : decisions.filter((decision) => decision.value.commitReviewPath === activeReviewPath);
  const effective = new Map<string, { path: string; value: CandidateCommitMutationDecision }>();
  for (const decision of reviewDecisions) effective.set(decision.value.mutationId, decision);
  if (reviewDecisions.length > 0 || noop !== undefined || finalized !== undefined || approval !== undefined) {
    lines.push('', 'Candidate commit mutation decisions');
    const mutationCount = finalized?.value.mutationCount ?? noop?.value.mutationCount ?? 0;
    lines.push(`- decision progress: ${effective.size}/${mutationCount}`);
    lines.push(`- active decisions: ${effective.size}`);
    lines.push(`- superseded decisions: ${reviewDecisions.length - effective.size}`);
    for (const decision of effective.values()) {
      lines.push(`  - ${decision.value.mutationId}: ${decision.value.decision} (${decision.value.mutationOrigin})`);
    }
  }
  if (noop !== undefined) {
    lines.push(`- no-op analysis: ${noop.path}`);
    lines.push(`- semantic no-ops: ${noop.value.mutations.filter((mutation) => mutation.semanticNoop).map((mutation) => mutation.mutationId).join(', ') || 'none'}`);
  }
  if (finalized !== undefined) {
    lines.push('', 'Finalized candidate commit review');
    lines.push(`- path: ${finalized.path}`);
    lines.push(`- finalized overallDecision: ${finalized.value.overallDecision}`);
    lines.push(`- unresolved mutations: ${finalized.value.unresolvedMutationIds.join(', ') || 'none'}`);
    lines.push(`- modify-required mutations: ${finalized.value.modifyRequiredMutationIds.join(', ') || 'none'}`);
    lines.push(`- rejected mutations: ${finalized.value.rejectedMutationIds.join(', ') || 'none'}`);
  }
  if (approval !== undefined) {
    lines.push('', 'Candidate commit approval');
    lines.push(`- path: ${approval.path}`);
    lines.push(`- commit approval status: approved, ${approval.value.consumed ? 'consumed' : 'unconsumed'}`);
    lines.push(`- approvalScope: ${approval.value.approvalScope}`);
  } else if (finalized !== undefined) {
    lines.push('- commit approval status: not generated');
  }
}

function appendTargetCoverage(
  lines: string[],
  disposition: { path: string; value: CandidateDisposition } | undefined,
  coverage: { path: string; value: TargetCoverageClosureReport } | undefined,
  approvalPreview: { path: string; value: TargetExpansionApprovalPreview } | undefined,
  approval: { path: string; value: TargetExpansionApprovalRecord } | undefined
): void {
  if (disposition !== undefined) {
    lines.push('', 'Candidate disposition');
    lines.push(`- path: ${disposition.path}`);
    lines.push(`- result: ${disposition.value.result}`);
    lines.push(`- adopted: ${String(disposition.value.adopted)}`);
    lines.push(`- eligibleAsNextRevisionBase: ${String(disposition.value.eligibleAsNextRevisionBase)}`);
    lines.push(`- retainForProvenance: ${String(disposition.value.retainForProvenance)}`);
  }
  if (coverage !== undefined) {
    const uncovered = [...new Set(coverage.value.residualClaims.flatMap((claim) => claim.uncoveredParagraphs))].sort((left, right) => left - right);
    lines.push('', 'Target coverage closure');
    lines.push(`- path: ${coverage.path}`);
    lines.push(`- residualClaims: ${coverage.value.residualClaims.map((claim) => claim.normalizedClaim).join(', ')}`);
    lines.push(`- uncoveredParagraphs: ${uncovered.join(', ') || 'none'}`);
    lines.push(`- proposedAdditionalTargets: ${coverage.value.proposedAdditionalTargets.map((target) => `${target.targetId}(p${target.paragraphIndex})`).join(', ') || 'none'}`);
    lines.push(`- claimCoverage: ${coverage.value.claimCoverageBefore} -> ${coverage.value.projectedClaimCoverageAfter}`);
    lines.push(`- contradictionEdgeCoverage: ${coverage.value.contradictionEdgeCoverageBefore} -> ${coverage.value.projectedContradictionEdgeCoverageAfter}`);
    lines.push(`- eventOccurrenceCoverage: ${coverage.value.eventOccurrenceCoverageBefore} -> ${coverage.value.projectedEventOccurrenceCoverageAfter}`);
    lines.push(`- coverageClosed: ${String(coverage.value.coverageClosed)}`);
  }
  if (approval !== undefined) {
    lines.push('', 'Target expansion approval');
    lines.push(`- path: ${approval.path}`);
    lines.push(`- approved: ${String(approval.value.approved)}`);
    lines.push(`- operator: ${approval.value.operator}`);
    lines.push(`- confirmedAt: ${approval.value.confirmedAt}`);
    return;
  }
  if (approvalPreview !== undefined) {
    lines.push('', 'Target expansion approval');
    lines.push(`- path: ${approvalPreview.path}`);
    lines.push(`- approved: ${String(approvalPreview.value.approved)}`);
    lines.push(`- suggestedApprovalCommand: ${approvalPreview.value.suggestedApprovalCommand}`);
  }
}

function appendTargetedRevisionExperiment(
  lines: string[],
  latest: { path: string; value: TargetedRevisionExperimentReport | ExpandedTargetRevisionExperimentReport } | undefined
): void {
  if (latest === undefined) return;
  if ('revisionRound' in latest.value) {
    lines.push('', 'Expanded target revision experiment');
    lines.push(`- path: ${latest.path}`);
    lines.push(`- revisionRound: ${latest.value.revisionRound}`);
    lines.push(`- candidateDraftPath: ${latest.value.candidateDraftPath}`);
    lines.push(`- diagnosticsABPath: ${latest.value.diagnosticsABPath}`);
    lines.push(`- candidateAdjudicationPath: ${latest.value.candidateAdjudicationPath}`);
    lines.push(`- qualityReportPath: ${latest.value.qualityReportPath}`);
    lines.push(`- scoreDelta: ${latest.value.scoreDelta ?? 'null'}`);
    lines.push(`- result: ${latest.value.result}`);
    lines.push(`- candidateAdopted: ${String(latest.value.candidateAdopted)}`);
    lines.push(`- normalPreviewStarted: ${String(latest.value.normalPreviewStarted)}`);
    lines.push(`- commitStarted: ${String(latest.value.commitStarted)}`);
    return;
  }
  lines.push('', 'Targeted revision experiment');
  lines.push(`- path: ${latest.path}`);
  lines.push(`- candidateDraftPath: ${latest.value.candidateDraftPath}`);
  lines.push(`- scopeValidationPath: ${latest.value.scopeValidationPath}`);
  lines.push(`- revisionDiffPath: ${latest.value.revisionDiffPath}`);
  lines.push(`- executionOrder: ${latest.value.executionOrder.join(' -> ')}`);
  lines.push(`- baselineTimelineFailCount: ${latest.value.baselineSummary.timelineFailCount}`);
  lines.push(`- candidateTimelineFailCount: ${latest.value.candidateSummary.timelineFailCount}`);
  lines.push(`- result: ${latest.value.result}`);
  lines.push(`- candidateAdopted: ${String(latest.value.candidateAdopted)}`);
  lines.push(`- normalPreviewStarted: ${String(latest.value.normalPreviewStarted)}`);
  lines.push(`- commitStarted: ${String(latest.value.commitStarted)}`);
  lines.push(`- recommendation: ${latest.value.recommendation}`);
}

function appendExpandedTargetRevision(
  lines: string[],
  plan: { path: string; value: ExpandedTargetRevisionPlan } | undefined,
  disposition: { path: string; value: ExpandedTargetRevisionCandidateDisposition } | undefined,
  diagnostics: { path: string; value: ExpandedTargetRevisionDiagnosticsAB } | undefined,
  adjudication: { path: string; value: CandidateRevisionEvidenceAdjudication } | undefined,
  quality: { path: string; value: ExpandedTargetRevisionQualityReport } | undefined
): void {
  if (plan === undefined && disposition === undefined && diagnostics === undefined && adjudication === undefined && quality === undefined) return;
  lines.push('', 'Candidate v2 disposition');
  if (disposition !== undefined) {
    lines.push(`- path: ${disposition.path}`);
    lines.push(`- result: ${disposition.value.result}`);
    lines.push(`- adopted: ${String(disposition.value.adopted)}`);
    lines.push(`- committed: ${String(disposition.value.committed)}`);
    lines.push(`- eligibleForPreviewReview: ${String(disposition.value.eligibleForPreviewReview)}`);
    lines.push(`- recommendedNextStep: ${disposition.value.recommendedNextStep}`);
  }
  lines.push('', 'Target operation coverage');
  if (plan !== undefined) {
    lines.push(`- planPath: ${plan.path}`);
    for (const target of plan.value.targetOperationCoverage) {
      lines.push(`- ${target.targetId} (p${target.paragraphIndex}): ${target.disposition}; requiredForClosure=${String(target.requiredForClosure)}`);
    }
  }
  if (diagnostics !== undefined) {
    lines.push(`- diagnosticsABPath: ${diagnostics.path}`);
    lines.push(`- baselineTimelineFailureRate: ${diagnostics.value.baselineTimelineFailureRate}`);
    lines.push(`- candidateTimelineFailureRate: ${diagnostics.value.candidateTimelineFailureRate}`);
    lines.push(`- scoreDelta: ${diagnostics.value.scoreDelta ?? 'null'}`);
  }
  if (adjudication !== undefined) {
    lines.push(`- candidateAdjudicationPath: ${adjudication.path}`);
    lines.push(`- candidateAdjudication: ${adjudication.value.adjudication}`);
    lines.push(`- remainingContradictions: ${adjudication.value.remainingContradictions.length}`);
  }
  if (quality !== undefined) {
    lines.push(`- qualityReportPath: ${quality.path}`);
    lines.push(`- qualityResult: ${quality.value.qualityResult}`);
    lines.push(`- criticalIssueCount: ${quality.value.criticalIssueCount}`);
  }
  lines.push('- next: human review; no automatic preview, commit, or revision round 3');
}

function appendCandidatePatchRefinement(
  lines: string[],
  refinement: { path: string; value: CandidatePatchRefinementManifest } | undefined,
  equivalence: { path: string; value: CandidatePatchRefinementEquivalence } | undefined,
  refinedDiff: { path: string; value: RefinedStateDiffReport } | undefined,
  lineage: { path: string; value: CandidateCommitMutationLineage } | undefined,
  carryForward: { path: string; value: CandidateCommitDecisionCarryForward } | undefined
): void {
  if (refinement === undefined && equivalence === undefined && refinedDiff === undefined && lineage === undefined && carryForward === undefined) return;
  lines.push('', 'Candidate patch refinement');
  if (refinement !== undefined) {
    lines.push(`- manifestPath: ${refinement.path}`);
    lines.push(`- originalNormalizedPatch: ${refinement.value.sourceNormalizedPatchPath}`);
    lines.push(`- refinedPatch: ${refinement.value.refinedPatchPath}`);
    lines.push(`- removedNoopMutations: ${refinement.value.removedMutationIds.join(', ')}`);
  }
  if (equivalence !== undefined) {
    lines.push(`- equivalencePath: ${equivalence.path}`);
    lines.push(`- projectedStatesEquivalent: ${String(equivalence.value.projectedStatesEquivalent)}`);
    lines.push(`- businessStatesEquivalent: ${String(equivalence.value.businessStatesEquivalent)}`);
    lines.push(`- actualStateDeltaEquivalent: ${String(equivalence.value.actualStateDeltaEquivalent)}`);
  }
  if (refinedDiff !== undefined) {
    lines.push(`- refinedStateDiffPath: ${refinedDiff.path}`);
    lines.push(`- refinedMutationCount: ${refinedDiff.value.changes.length}`);
    lines.push(`- actualApplyBased: ${String(refinedDiff.value.actualApplyBased)}`);
  }
  if (lineage !== undefined) {
    lines.push(`- mutationLineagePath: ${lineage.path}`);
    lines.push(`- unchangedMutations: ${lineage.value.unchangedMutationCount}`);
    lines.push(`- removedNoopMutations: ${lineage.value.removedNoopMutationCount}`);
    lines.push(`- changedOrAddedMutations: ${lineage.value.changedMutationCount + lineage.value.addedMutationCount}`);
  }
  if (carryForward !== undefined) {
    lines.push(`- decisionCarryForwardPath: ${carryForward.path}`);
    lines.push(`- carryForwardApproved: ${String(carryForward.value.approved)}`);
    lines.push(`- carryForwardProgress: ${carryForward.value.approved ? carryForward.value.eligibleDecisionCount : 0}/${carryForward.value.eligibleDecisionCount}`);
  }
}

function appendDiagnosticsEvidenceAdjudication(
  lines: string[],
  latest: { path: string; value: CodexDiagnosticsEvidenceAdjudication } | undefined
): void {
  if (latest === undefined) return;
  const confirmedRules = latest.value.temporalRulesTriggered.filter((rule) => rule.outcome === 'confirmed_contradiction');
  lines.push('', 'Diagnostics evidence adjudication');
  lines.push(`- path: ${latest.path}`);
  lines.push(`- adjudication: ${latest.value.adjudication}`);
  lines.push(`- confidence: ${latest.value.confidence}`);
  lines.push(`- repeatabilityRate: ${latest.value.repeatabilityRate}`);
  lines.push(`- uniqueClaimCount: ${latest.value.sampleConsensus.uniqueClaimCount}`);
  lines.push(`- confirmedContradictions: ${confirmedRules.map((rule) => rule.ruleId).join(', ') || 'none'}`);
  lines.push(`- timelineMapPath: ${latest.value.timelineContradictionMapPath}`);
  lines.push(`- recommendedNextStep: ${latest.value.recommendedNextStep}`);
}

async function appendPreviewCompleteness(lines: string[], paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  const reports = await readReports(paths, fileStore, chapterNumber, 'codex_preview_completeness_report', CodexPreviewCompletenessReportSchema);
  const latest = reports.at(-1);
  if (latest === undefined) return;
  lines.push('', 'Preview completeness');
  lines.push(`- path: ${latest.path}`);
  lines.push(`- complete: ${String(latest.value.complete)}`);
  lines.push(`- blockingReasons: ${latest.value.blockingReasons.join(', ') || 'none'}`);
  lines.push(`- suggestedRetryCommand: ${latest.value.suggestedRetryCommand}`);
}

async function appendDiagnosticsHardFailAnalysis(lines: string[], paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  const reports = await readReports(paths, fileStore, chapterNumber, 'codex_diagnostics_hard_fail_analysis', CodexDiagnosticsHardFailAnalysisSchema);
  const latest = reports.at(-1);
  if (latest === undefined) return;
  const contextAudit = (await readReports(paths, fileStore, chapterNumber, 'diagnostics_context_audit', CodexDiagnosticsContextAuditSchema)).at(-1);
  const opportunity = (await readReports(paths, fileStore, chapterNumber, 'revision_opportunity_report', RevisionOpportunityReportSchema)).at(-1);
  lines.push('', 'Diagnostics hard-fail analysis');
  lines.push(`- path: ${latest.path}`);
  lines.push(`- hardFailures: ${latest.value.hardFailures.length}`);
  lines.push(`- falsePositiveRisk: ${latest.value.falsePositiveRisk.level}`);
  lines.push(`- contextAuditPath: ${contextAudit?.path ?? 'none'}`);
  lines.push(`- revisionOpportunityPath: ${opportunity?.path ?? 'none'}`);
  lines.push(`- suggestedRetryCommand: ${latest.value.suggestedRetryCommand}`);
}

async function appendDiagnosticsContextFix(lines: string[], paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  const reports = await readReports(paths, fileStore, chapterNumber, 'codex_diagnostics_context_fix_report', CodexDiagnosticsContextFixReportSchema);
  const latest = reports.at(-1);
  if (latest === undefined) return;
  lines.push('', 'Diagnostics context fix');
  lines.push(`- path: ${latest.path}`);
  lines.push(`- baselineHardFailRateAmongSchemaValidSamples: ${latest.value.baselineHardFailRateAmongSchemaValidSamples ?? 'null'}`);
  lines.push(`- enhancedHardFailRateAmongSchemaValidSamples: ${latest.value.enhancedHardFailRateAmongSchemaValidSamples ?? 'null'}`);
  lines.push(`- experimentValid: ${String(latest.value.experimentValid)}`);
  lines.push(`- experimentInvalidReason: ${latest.value.experimentInvalidReason ?? 'none'}`);
  lines.push(`- baselineFalsePositiveRisk: ${latest.value.baselineFalsePositiveRisk}`);
  lines.push(`- enhancedFalsePositiveRisk: ${latest.value.enhancedFalsePositiveRisk}`);
  lines.push(`- conclusion: ${latest.value.conclusion}`);
  lines.push(`- recommendedNextStep: ${latest.value.recommendedNextStep}`);
}

function highestSeverity(severities: ConflictSeverity[]): ConflictSeverity {
  const order: ConflictSeverity[] = ['low', 'medium', 'high', 'critical'];
  return severities.reduce<ConflictSeverity>((highest, severity) => (order.indexOf(severity) > order.indexOf(highest) ? severity : highest), 'low');
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.posix.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, ...segments);
}
