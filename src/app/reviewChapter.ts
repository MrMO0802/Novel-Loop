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
  TargetedRevisionDiffSchema,
  TargetedRevisionExperimentReportSchema,
  TargetedRevisionPlanSchema,
  TargetedRevisionScopeValidationSchema,
  TimelineContradictionMapSchema
} from '../schemas/index.js';
import type {
  CandidateDisposition,
  CodexDiagnosticsEvidenceAdjudication,
  ConflictSeverity,
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
  const latestTargetedExperiment = (await readReports(
    paths,
    fileStore,
    input.chapterNumber,
    'targeted_revision_experiment',
    TargetedRevisionExperimentReportSchema
  )).at(-1);
  const latestDisposition = (await readReports(
    paths,
    fileStore,
    input.chapterNumber,
    'targeted_revision_candidate_disposition',
    CandidateDispositionSchema
  )).at(-1);
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
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_plan', TargetedRevisionPlanSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_scope_validation', TargetedRevisionScopeValidationSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_diff', TargetedRevisionDiffSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_experiment', TargetedRevisionExperimentReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'targeted_revision_candidate_disposition', CandidateDispositionSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'target_coverage_graph', TargetCoverageGraphSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'target_coverage_closure_report', TargetCoverageClosureReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'target_expansion_approval_preview', TargetExpansionApprovalPreviewSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'target_expansion_approval', TargetExpansionApprovalRecordSchema);
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
      latestApproval?.value
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
  return reports.sort((left, right) => left.path.localeCompare(right.path));
}

function suggestNextCommand(
  projectId: string,
  chapterNumber: number,
  status: string | undefined,
  adjudication: CodexDiagnosticsEvidenceAdjudication | undefined,
  experiment: TargetedRevisionExperimentReport | undefined,
  coverage: TargetCoverageClosureReport | undefined,
  approvalPreview: TargetExpansionApprovalPreview | undefined,
  approval: TargetExpansionApprovalRecord | undefined
): string {
  if (coverage !== undefined && approval === undefined) {
    return coverage.coverageClosed
      ? approvalPreview?.suggestedApprovalCommand ?? `corepack pnpm novel-loop codex approve-target-expansion ${projectId} ${chapterNumber} --report latest --confirm`
      : 'Target coverage remains open. Do not approve or run a second targeted revision experiment.';
  }
  if (coverage !== undefined && approval !== undefined) {
    return 'Expanded targets are approved. Keep candidate v1 rejected and wait for the M27.12D2 second-round experiment command.';
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
  latest: { path: string; value: TargetedRevisionExperimentReport } | undefined
): void {
  if (latest === undefined) return;
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
  return path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, ...segments);
}
