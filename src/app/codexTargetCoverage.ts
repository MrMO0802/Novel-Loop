import path from 'node:path';

import { RunLogger } from '../logging/RunLogger.js';
import {
  CandidateDispositionSchema,
  ChapterQueueSchema,
  CodexDiagnosticsEvidenceAdjudicationSchema,
  StoryStateSchema,
  TargetCoverageClosureReportSchema,
  TargetCoverageGraphSchema,
  TargetExpansionApprovalPreviewSchema,
  TargetExpansionApprovalRecordSchema,
  TargetedRevisionDiffSchema,
  TargetedRevisionExperimentReportSchema,
  TargetedRevisionPlanSchema,
  TimelineContradictionMapSchema
} from '../schemas/index.js';
import type {
  CandidateDisposition,
  TargetCoverageClosureReport,
  TargetCoverageGraph,
  TargetCoverageMetrics,
  TargetCoverageProposedTarget,
  TargetCoverageResidualClaim,
  TargetCoverageResidualEvidence,
  TargetExpansionApprovalPreview,
  TargetExpansionApprovalRecord,
  TargetedRevisionExperimentReport
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';
import {
  extractExplicitClockTime,
  parseMarkdownEvidenceParagraphs,
  sha256
} from './codexDiagnosticsEvidenceRules.js';

const DEFAULT_PROJECTS_ROOT = './projects';
const FORBIDDEN_CHANGES = [
  'Do not add scenes, characters, orders, or recipients.',
  'Do not rewrite the whole chapter.',
  'Do not change character goals, Reader State, or Story State.',
  'Do not add plot reveals.',
  'Do not use the rejected candidate as the next revision base.'
];

export interface RunCodexDiagnosticsTargetCoverageInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
}

export interface RunCodexDiagnosticsTargetCoverageResult {
  runId: string;
  disposition: CandidateDisposition;
  dispositionPath: string;
  dispositionMarkdownPath: string;
  graph: TargetCoverageGraph;
  graphPath: string;
  graphMarkdownPath: string;
  report: TargetCoverageClosureReport;
  reportPath: string;
  reportMarkdownPath: string;
  approvalPreview: TargetExpansionApprovalPreview;
  approvalPreviewPath: string;
  approvalPreviewMarkdownPath: string;
}

export interface ApproveCodexTargetExpansionInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  report?: string;
  confirm?: boolean;
  operator?: string;
}

export interface ApproveCodexTargetExpansionResult {
  previewOnly: boolean;
  preview: TargetExpansionApprovalPreview;
  record: TargetExpansionApprovalRecord | null;
  recordPath: string | null;
  recordMarkdownPath: string | null;
  runId: string | null;
}

interface SourceSet {
  experiment: TargetedRevisionExperimentReport;
  experimentPath: string;
  experimentText: string;
  plan: ReturnType<typeof TargetedRevisionPlanSchema.parse>;
  planText: string;
  diff: ReturnType<typeof TargetedRevisionDiffSchema.parse>;
  diffText: string;
  adjudication: ReturnType<typeof CodexDiagnosticsEvidenceAdjudicationSchema.parse>;
  adjudicationText: string;
  timelineMap: ReturnType<typeof TimelineContradictionMapSchema.parse>;
  timelineMapText: string;
  sourceDraft: string;
  candidateDraft: string;
  storyStateText: string;
  queueText: string;
}

interface ProtectedSnapshot {
  path: string;
  content: string;
  hash: string;
}

interface DeliverySequence {
  sequenceId: string;
  paragraphIndexes: number[];
  startParagraph: number;
  endParagraph: number;
}

interface CoverageArtifacts {
  version: number;
  dispositionVersion: number;
  dispositionPath: string;
  dispositionMarkdownPath: string;
  graphPath: string;
  graphMarkdownPath: string;
  reportPath: string;
  reportMarkdownPath: string;
  approvalPreviewPath: string;
  approvalPreviewMarkdownPath: string;
}

export async function runCodexDiagnosticsTargetCoverage(
  input: RunCodexDiagnosticsTargetCoverageInput,
  fileStore = new FileStore()
): Promise<RunCodexDiagnosticsTargetCoverageResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const sources = await loadCoverageSources(paths, fileStore, input.chapterNumber);
  const protectedBefore = await captureProtectedArtifacts(paths, fileStore, input.chapterNumber, sources);
  const artifacts = await allocateCoverageArtifacts(paths, fileStore, input.chapterNumber, sources.experimentPath);
  const runId = createRunId(new Date(), `codex_target_coverage_ch${pad(input.chapterNumber)}`);
  const runLogger = new RunLogger(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex diagnostics-target-coverage',
    args: {
      provider: 'local-deterministic',
      chapterNumber: input.chapterNumber,
      codexInvoked: false,
      candidateGenerationAllowed: false,
      diagnosticsAllowed: false,
      previewAllowed: false,
      storyStateCommitAllowed: false,
      queueMutationAllowed: false
    }
  });

  try {
    const generatedAt = new Date().toISOString();
    const disposition = buildCandidateDisposition(paths, input.chapterNumber, artifacts.dispositionVersion, generatedAt, sources);
    await writeOrValidateDisposition(paths, fileStore, artifacts, disposition);
    const dispositionText = await fileStore.readText(paths.projectArtifact(artifacts.dispositionPath));

    const analysis = analyzeCoverage(paths, input.chapterNumber, generatedAt, sources);
    const graph = TargetCoverageGraphSchema.parse({
      ...analysis.graph,
      graphId: `target_coverage_graph_ch${pad(input.chapterNumber)}_v${artifacts.version}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      generatedAt,
      sourceDraftPath: sources.experiment.sourceDraftPath,
      sourceDraftHash: sha256(sources.sourceDraft),
      sourceTimelineMapPath: sources.adjudication.timelineContradictionMapPath,
      sourceExperimentPath: sources.experimentPath,
      storyStateMutated: false,
      queueMutated: false
    });
    await fileStore.writeJson(paths.projectArtifact(artifacts.graphPath), graph, TargetCoverageGraphSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.graphMarkdownPath), renderGraphMarkdown(graph));
    const graphText = await fileStore.readText(paths.projectArtifact(artifacts.graphPath));

    const protectedArtifacts = await verifyProtectedArtifacts(paths, fileStore, protectedBefore);
    const report = TargetCoverageClosureReportSchema.parse({
      reportId: `target_coverage_closure_report_ch${pad(input.chapterNumber)}_v${artifacts.version}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      generatedAt,
      sourceDraftPath: sources.experiment.sourceDraftPath,
      sourceDraftHash: sha256(sources.sourceDraft),
      sourceAdjudicationPath: sources.experiment.sourceAdjudicationPath,
      sourceAdjudicationHash: sha256(sources.adjudicationText),
      sourceTimelineMapPath: sources.adjudication.timelineContradictionMapPath,
      sourceTimelineMapHash: sha256(sources.timelineMapText),
      sourceExperimentPath: sources.experimentPath,
      sourceExperimentHash: sha256(sources.experimentText),
      sourceRevisionPlanPath: sources.experiment.targetedRevisionPlanPath,
      sourceRevisionPlanHash: sha256(sources.planText),
      sourceRevisionDiffPath: sources.experiment.revisionDiffPath,
      sourceRevisionDiffHash: sha256(sources.diffText),
      rejectedCandidatePath: sources.experiment.candidateDraftPath,
      rejectedCandidateHash: sha256(sources.candidateDraft),
      candidateDispositionPath: artifacts.dispositionPath,
      candidateDispositionHash: sha256(dispositionText),
      targetCoverageGraphPath: artifacts.graphPath,
      targetCoverageGraphHash: sha256(graphText),
      initialTargets: analysis.initialTargets,
      residualClaims: analysis.residualClaims,
      residualEvidence: analysis.residualEvidence,
      proposedAdditionalTargets: analysis.proposedTargets,
      claimCoverageBefore: ratio(analysis.metrics.coveredClaimCountBefore, analysis.metrics.uniqueClaimCount),
      projectedClaimCoverageAfter: ratio(analysis.metrics.projectedCoveredClaimCountAfter, analysis.metrics.uniqueClaimCount),
      contradictionEdgeCoverageBefore: ratio(analysis.metrics.coveredContradictionEdgesBefore, analysis.metrics.contradictionEdgeCount),
      projectedContradictionEdgeCoverageAfter: ratio(analysis.metrics.projectedCoveredContradictionEdgesAfter, analysis.metrics.contradictionEdgeCount),
      eventOccurrenceCoverageBefore: ratio(analysis.metrics.coveredEventOccurrencesBefore, analysis.metrics.eventOccurrenceCount),
      projectedEventOccurrenceCoverageAfter: ratio(analysis.metrics.projectedCoveredEventOccurrencesAfter, analysis.metrics.eventOccurrenceCount),
      metrics: analysis.metrics,
      coverageClosed: graph.coverageClosed,
      humanApprovalRequired: true,
      recommendedNextStep: graph.coverageClosed
        ? approvalCommand(paths.projectId, input.chapterNumber)
        : 'Keep the rejected candidate isolated and resolve all uncovered evidence before requesting target expansion approval.',
      candidateUsedAsRevisionBase: false,
      protectedArtifacts,
      storyStateMutated: false,
      queueMutated: false,
      canonicalDraftMutated: false,
      canonicalDiagnosticsMutated: false
    });
    await fileStore.writeJson(paths.projectArtifact(artifacts.reportPath), report, TargetCoverageClosureReportSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.reportMarkdownPath), renderCoverageMarkdown(report));
    const reportText = await fileStore.readText(paths.projectArtifact(artifacts.reportPath));

    const approvalPreview = TargetExpansionApprovalPreviewSchema.parse({
      approvalId: `target_expansion_approval_preview_ch${pad(input.chapterNumber)}_v${artifacts.version}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      coverageReportPath: artifacts.reportPath,
      coverageReportHash: sha256(reportText),
      proposedTargetIds: report.proposedAdditionalTargets.filter((target) => target.requiredForClosure).map((target) => target.targetId),
      sourceDraftPath: report.sourceDraftPath,
      sourceDraftHash: report.sourceDraftHash,
      sourceAdjudicationPath: report.sourceAdjudicationPath,
      sourceAdjudicationHash: report.sourceAdjudicationHash,
      sourceTimelineMapPath: report.sourceTimelineMapPath,
      sourceTimelineMapHash: report.sourceTimelineMapHash,
      sourceExperimentPath: report.sourceExperimentPath,
      sourceExperimentHash: report.sourceExperimentHash,
      candidateDispositionPath: report.candidateDispositionPath,
      candidateDispositionHash: report.candidateDispositionHash,
      forbiddenChanges: FORBIDDEN_CHANGES,
      suggestedApprovalCommand: approvalCommand(paths.projectId, input.chapterNumber),
      generatedAt,
      approved: false,
      confirmedAt: null,
      operator: null,
      riskAcknowledged: false,
      candidateGenerated: false,
      storyStateMutated: false,
      queueMutated: false
    });
    await fileStore.writeJson(paths.projectArtifact(artifacts.approvalPreviewPath), approvalPreview, TargetExpansionApprovalPreviewSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.approvalPreviewMarkdownPath), renderApprovalPreviewMarkdown(approvalPreview));

    for (const sourcePath of sourceArtifactPaths(sources)) {
      await runLogger.recordArtifact(runId, sourcePath, { action: 'reused', stage: 'diagnostics', provenanceNote: 'Read-only source for deterministic target coverage closure.' });
    }
    for (const generatedPath of [
      artifacts.dispositionPath,
      artifacts.dispositionMarkdownPath,
      artifacts.graphPath,
      artifacts.graphMarkdownPath,
      artifacts.reportPath,
      artifacts.reportMarkdownPath,
      artifacts.approvalPreviewPath,
      artifacts.approvalPreviewMarkdownPath
    ]) {
      await runLogger.recordArtifact(runId, generatedPath, { action: 'generated', stage: 'diagnostics', sourcePaths: [sources.experimentPath, sources.experiment.sourceDraftPath] });
    }
    await assertProtectedArtifactsStillUnchanged(paths, fileStore, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return {
      runId,
      disposition,
      dispositionPath: artifacts.dispositionPath,
      dispositionMarkdownPath: artifacts.dispositionMarkdownPath,
      graph,
      graphPath: artifacts.graphPath,
      graphMarkdownPath: artifacts.graphMarkdownPath,
      report,
      reportPath: artifacts.reportPath,
      reportMarkdownPath: artifacts.reportMarkdownPath,
      approvalPreview,
      approvalPreviewPath: artifacts.approvalPreviewPath,
      approvalPreviewMarkdownPath: artifacts.approvalPreviewMarkdownPath
    };
  } catch (error) {
    await assertProtectedArtifactsStillUnchanged(paths, fileStore, protectedBefore);
    await runLogger.recordError(runId, {
      code: error instanceof AppError ? error.code : 'CODEX_TARGET_COVERAGE_FAILED',
      message: getErrorMessage(error),
      recoverable: true
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

export async function approveCodexTargetExpansion(
  input: ApproveCodexTargetExpansionInput,
  fileStore = new FileStore()
): Promise<ApproveCodexTargetExpansionResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const latestReportPath = await requireLatestArtifact(paths, fileStore, input.chapterNumber, 'target_coverage_closure_report');
  const reportPath = input.report === undefined || input.report === 'latest'
    ? latestReportPath
    : resolveSafeChapterPath(paths, input.chapterNumber, input.report, /^target_coverage_closure_report_v\d+\.json$/);
  if (reportPath !== latestReportPath) {
    throw staleCoverage([`coverage report ${reportPath} is superseded by ${latestReportPath}`]);
  }
  const reportText = await fileStore.readText(paths.projectArtifact(reportPath));
  const report = TargetCoverageClosureReportSchema.parse(JSON.parse(reportText));
  const version = versionFromPath(reportPath);
  const previewPath = relativeChapterArtifact(input.chapterNumber, `target_expansion_approval_preview_v${version}.json`);
  const preview = await fileStore.readJson(paths.projectArtifact(previewPath), TargetExpansionApprovalPreviewSchema);
  await assertApprovalFresh(paths, fileStore, input.chapterNumber, report, reportText, preview);
  if (!report.coverageClosed) {
    throw new AppError('CODEX_TARGET_COVERAGE_NOT_CLOSED', 'Target expansion cannot be approved until target coverage is closed.', 2);
  }
  if (input.confirm !== true) {
    return { previewOnly: true, preview, record: null, recordPath: null, recordMarkdownPath: null, runId: null };
  }

  const protectedBefore = await captureApprovalProtectedArtifacts(paths, fileStore, input.chapterNumber, report);
  const existing = await findApprovalForReport(paths, fileStore, input.chapterNumber, reportPath);
  if (existing !== undefined) {
    return { previewOnly: false, preview, record: existing.record, recordPath: existing.path, recordMarkdownPath: existing.markdownPath, runId: null };
  }
  const approvalVersion = await nextArtifactVersion(paths, fileStore, input.chapterNumber, 'target_expansion_approval');
  const recordPath = relativeChapterArtifact(input.chapterNumber, `target_expansion_approval_v${approvalVersion}.json`);
  const recordMarkdownPath = relativeChapterArtifact(input.chapterNumber, `target_expansion_approval_v${approvalVersion}.md`);
  const runId = createRunId(new Date(), `codex_approve_target_expansion_ch${pad(input.chapterNumber)}`);
  const runLogger = new RunLogger(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex approve-target-expansion',
    args: {
      provider: 'local-deterministic',
      chapterNumber: input.chapterNumber,
      coverageReportPath: reportPath,
      codexInvoked: false,
      candidateGenerationAllowed: false,
      storyStateCommitAllowed: false,
      queueMutationAllowed: false,
      confirmed: true
    }
  });
  try {
    const previewText = await fileStore.readText(paths.projectArtifact(previewPath));
    const confirmedAt = new Date().toISOString();
    const record = TargetExpansionApprovalRecordSchema.parse({
      ...preview,
      approvalId: `target_expansion_approval_ch${pad(input.chapterNumber)}_v${approvalVersion}`,
      approved: true,
      confirmedAt,
      operator: input.operator?.trim() || process.env.USER || 'local-operator',
      riskAcknowledged: true,
      generatedAt: confirmedAt,
      sourceApprovalPreviewPath: previewPath,
      sourceApprovalPreviewHash: sha256(previewText)
    });
    await fileStore.writeJson(paths.projectArtifact(recordPath), record, TargetExpansionApprovalRecordSchema);
    await fileStore.writeText(paths.projectArtifact(recordMarkdownPath), renderApprovalRecordMarkdown(record));
    await runLogger.recordArtifact(runId, reportPath, { action: 'reused', stage: 'diagnostics', provenanceNote: 'Approved target set only; no candidate generation.' });
    await runLogger.recordArtifact(runId, previewPath, { action: 'reused', stage: 'diagnostics' });
    await runLogger.recordArtifact(runId, recordPath, { action: 'generated', stage: 'diagnostics', sourcePaths: [reportPath, previewPath] });
    await runLogger.recordArtifact(runId, recordMarkdownPath, { action: 'generated', stage: 'diagnostics', sourcePaths: [recordPath] });
    await assertProtectedArtifactsStillUnchanged(paths, fileStore, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return { previewOnly: false, preview, record, recordPath, recordMarkdownPath, runId };
  } catch (error) {
    await assertProtectedArtifactsStillUnchanged(paths, fileStore, protectedBefore);
    await runLogger.recordError(runId, {
      code: error instanceof AppError ? error.code : 'CODEX_TARGET_EXPANSION_APPROVAL_FAILED',
      message: getErrorMessage(error),
      recoverable: true
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

export function evaluateTargetCoverageClosure(input: {
  metrics: TargetCoverageMetrics;
  requiredTargetsHaveHashes: boolean;
  unresolvedSameEventTimeReferences: number;
  uncoveredDuplicateSequences: number;
}): boolean {
  return ratio(input.metrics.projectedCoveredClaimCountAfter, input.metrics.uniqueClaimCount) === 1 &&
    ratio(input.metrics.projectedCoveredContradictionEdgesAfter, input.metrics.contradictionEdgeCount) === 1 &&
    ratio(input.metrics.projectedCoveredEventOccurrencesAfter, input.metrics.eventOccurrenceCount) === 1 &&
    input.requiredTargetsHaveHashes &&
    input.unresolvedSameEventTimeReferences === 0 &&
    input.uncoveredDuplicateSequences === 0;
}

async function loadCoverageSources(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<SourceSet> {
  const experimentPath = await requireLatestArtifact(paths, fileStore, chapterNumber, 'targeted_revision_experiment');
  const experimentText = await fileStore.readText(paths.projectArtifact(experimentPath));
  const experiment = TargetedRevisionExperimentReportSchema.parse(JSON.parse(experimentText));
  if (experiment.result === 'candidate_clears_timeline_failure') {
    throw new AppError('CODEX_TARGET_COVERAGE_NOT_REQUIRED', 'The latest candidate cleared the timeline failure; target expansion closure is not applicable.', 2);
  }
  const [planText, diffText, adjudicationText, sourceDraft, candidateDraft, storyStateText, queueText] = await Promise.all([
    fileStore.readText(paths.projectArtifact(experiment.targetedRevisionPlanPath)),
    fileStore.readText(paths.projectArtifact(experiment.revisionDiffPath)),
    fileStore.readText(paths.projectArtifact(experiment.sourceAdjudicationPath)),
    fileStore.readText(paths.projectArtifact(experiment.sourceDraftPath)),
    fileStore.readText(paths.projectArtifact(experiment.candidateDraftPath)),
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue())
  ]);
  const plan = TargetedRevisionPlanSchema.parse(JSON.parse(planText));
  const diff = TargetedRevisionDiffSchema.parse(JSON.parse(diffText));
  const adjudication = CodexDiagnosticsEvidenceAdjudicationSchema.parse(JSON.parse(adjudicationText));
  const timelineMapText = await fileStore.readText(paths.projectArtifact(adjudication.timelineContradictionMapPath));
  const timelineMap = TimelineContradictionMapSchema.parse(JSON.parse(timelineMapText));
  const storyState = StoryStateSchema.parse(JSON.parse(storyStateText));
  const queue = ChapterQueueSchema.parse(JSON.parse(queueText));
  const staleReasons: string[] = [];
  if (storyState.latestCommittedChapter !== chapterNumber - 1) staleReasons.push(`latestCommittedChapter is ${storyState.latestCommittedChapter}, expected ${chapterNumber - 1}`);
  const queueItem = queue.chapters.find((item) => item.chapterNumber === chapterNumber);
  if (queueItem === undefined) staleReasons.push('chapter queue item is missing');
  if (queueItem?.status === 'committed' || queueItem?.status === 'recommitted' || queueItem?.committedAt !== null) staleReasons.push('chapter is already committed');
  if (sha256(sourceDraft) !== plan.sourceDraftHash) staleReasons.push('source draft hash does not match targeted revision plan');
  if (experiment.samples.filter((sample) => sample.arm === 'baseline').some((sample) => sample.draftHash !== sha256(sourceDraft))) staleReasons.push('baseline sample hash does not match source draft');
  if (experiment.samples.filter((sample) => sample.arm === 'candidate').some((sample) => sample.draftHash !== sha256(candidateDraft))) staleReasons.push('candidate sample hash does not match rejected candidate');
  if (adjudication.adjudication !== 'confirmed_true_positive' || adjudication.confidence !== 'high') staleReasons.push('source adjudication is not confirmed_true_positive/high');
  if (timelineMap.sourceAdjudicationReportPath !== experiment.sourceAdjudicationPath) staleReasons.push('timeline map does not reference source adjudication');
  for (const protectedArtifact of experiment.protectedArtifacts) {
    if (!(await fileStore.exists(paths.projectArtifact(protectedArtifact.path)))) {
      staleReasons.push(`missing protected source ${protectedArtifact.path}`);
      continue;
    }
    if (sha256(await fileStore.readText(paths.projectArtifact(protectedArtifact.path))) !== protectedArtifact.afterSha256) staleReasons.push(`protected source changed ${protectedArtifact.path}`);
  }
  if (staleReasons.length > 0) throw staleCoverage(staleReasons);
  return {
    experiment,
    experimentPath,
    experimentText,
    plan,
    planText,
    diff,
    diffText,
    adjudication,
    adjudicationText,
    timelineMap,
    timelineMapText,
    sourceDraft,
    candidateDraft,
    storyStateText,
    queueText
  };
}

function buildCandidateDisposition(
  paths: ProjectPaths,
  chapterNumber: number,
  version: number,
  generatedAt: string,
  sources: SourceSet
): CandidateDisposition {
  const baselineRate = ratio(sources.experiment.baselineSummary.timelineFailCount, sources.experiment.baselineSummary.schemaValidCount);
  const candidateRate = ratio(sources.experiment.candidateSummary.timelineFailCount, sources.experiment.candidateSummary.schemaValidCount);
  const baselineAverage = sources.experiment.baselineSummary.averageScoreMean;
  const candidateAverage = sources.experiment.candidateSummary.averageScoreMean;
  const result = sources.experiment.result === 'regression'
    ? 'rejected_regression'
    : sources.experiment.result === 'inconclusive'
      ? 'rejected_inconclusive'
      : sources.experiment.result === 'candidate_improves_but_not_clear'
        ? 'rejected_insufficient_improvement'
        : 'rejected_no_improvement';
  const rejectionReasons = [
    `Candidate timeline failure rate is ${formatRate(candidateRate)} versus baseline ${formatRate(baselineRate)}.`,
    ...(candidateAverage !== null && baselineAverage !== null && candidateAverage < baselineAverage
      ? [`Candidate average score decreased by ${round(candidateAverage - baselineAverage)}.`]
      : []),
    'The paired diagnostics still cite uncovered same-event time or duplicate-sequence evidence.'
  ];
  return CandidateDispositionSchema.parse({
    dispositionId: `targeted_revision_candidate_disposition_ch${pad(chapterNumber)}_v${version}`,
    projectId: paths.projectId,
    chapterNumber,
    candidatePath: sources.experiment.candidateDraftPath,
    candidateHash: sha256(sources.candidateDraft),
    experimentReportPath: sources.experimentPath,
    experimentReportHash: sha256(sources.experimentText),
    sourceDraftPath: sources.experiment.sourceDraftPath,
    sourceDraftHash: sha256(sources.sourceDraft),
    result,
    adopted: false,
    rejectionReasons,
    baselineTimelineFailureRate: baselineRate,
    candidateTimelineFailureRate: candidateRate,
    baselineAverageScore: baselineAverage,
    candidateAverageScore: candidateAverage,
    scoreDelta: baselineAverage === null || candidateAverage === null ? null : round(candidateAverage - baselineAverage),
    retainForProvenance: true,
    eligibleAsNextRevisionBase: false,
    generatedAt,
    storyStateMutated: false,
    queueMutated: false
  });
}

function analyzeCoverage(paths: ProjectPaths, chapterNumber: number, generatedAt: string, sources: SourceSet) {
  const paragraphs = parseMarkdownEvidenceParagraphs(sources.sourceDraft);
  const paragraphByIndex = new Map(paragraphs.map((paragraph) => [paragraph.paragraphIndex, paragraph]));
  const initialIndexes = new Set(sources.plan.allowedTargets.map((target) => target.paragraphIndex));
  const originalEvidenceByParagraph = new Map(sources.adjudication.draftEvidence.map((evidence) => [evidence.paragraphIndex, evidence]));
  const initialTargets = sources.plan.allowedTargets
    .map((target) => {
      const paragraph = paragraphByIndex.get(target.paragraphIndex);
      const evidence = originalEvidenceByParagraph.get(target.paragraphIndex);
      if (paragraph === undefined || evidence === undefined || !paragraph.text.includes(evidence.snippet) || target.originalSnippetHash !== evidence.normalizedSnippetHash) {
        throw staleCoverage([`initial target paragraph/hash mismatch for ${target.targetId}`]);
      }
      return {
        targetId: target.targetId,
        paragraphIndex: target.paragraphIndex,
        snippet: evidence.snippet,
        snippetHash: target.originalSnippetHash,
        reason: target.reason,
        linkedClaimIds: target.relatedClaimIds,
        linkedContradictionIds: target.relatedContradictionIds
      };
    })
    .sort((left, right) => left.paragraphIndex - right.paragraphIndex);

  const sequences = findDeliverySequences(paragraphs);
  const duplicateSequences = sequences.slice(1);
  const residualSequenceIndexes = uniqueNumbers(duplicateSequences.flatMap((sequence) => sequence.paragraphIndexes).filter((index) => !initialIndexes.has(index)));
  const lateTimeEvidence = sources.adjudication.draftEvidence.filter((evidence) => isLateTime(evidence.explicitTime));
  const residualTimeIndexes = uniqueNumbers(lateTimeEvidence.map((evidence) => evidence.paragraphIndex).filter((index) => !initialIndexes.has(index)));
  const timeClaimId = `residual_claim_${sha256('midday_vs_late_exit_same_delivery').slice(0, 12)}`;
  const duplicateClaimId = `residual_claim_${sha256('duplicate_delivery_sequence').slice(0, 12)}`;
  const baselineEvidencePaths = diagnosticEvidencePaths(sources.experiment, 'baseline');
  const candidateEvidencePaths = diagnosticEvidencePaths(sources.experiment, 'candidate');
  const originalTimeClaims = sources.adjudication.evidenceClaims.filter((claim) => /midday|time|23_/.test(claim.normalizedClaim)).map((claim) => claim.claimId);
  const originalDuplicateClaims = sources.adjudication.evidenceClaims.filter((claim) => /duplicate|handoff|delivery/.test(claim.normalizedClaim)).map((claim) => claim.claimId);
  const timeContradictions = sources.timelineMap.contradictions.filter((item) => item.ruleId === 'same_event_same_day_explicit_time_conflict' || item.ruleId === 'mission_plan_time_mismatch').map((item) => item.contradictionId);
  const duplicateContradictions = sources.timelineMap.contradictions.filter((item) => item.ruleId === 'duplicate_event_repetition').map((item) => item.contradictionId);
  const residualClaims: TargetCoverageResidualClaim[] = [
    {
      claimId: timeClaimId,
      normalizedClaim: 'midday_vs_late_exit_same_delivery',
      relatedOriginalClaimIds: originalTimeClaims,
      relatedRules: ['same_event_same_day_explicit_time_conflict', 'mission_plan_time_mismatch'],
      baselineEvidencePaths,
      candidateEvidencePaths,
      coverageStatus: initialIndexes.size > 0 ? 'partially_covered' : 'uncovered',
      uncoveredParagraphs: residualTimeIndexes,
      reasonFailurePersisted: 'The initial target set changed one late entry reference but left another explicit late exit reference for the same daytime delivery.',
      evidenceFingerprint: sha256(`midday_vs_late_exit_same_delivery|${residualTimeIndexes.map((index) => paragraphByIndex.get(index)?.text ?? '').join('|')}`)
    },
    {
      claimId: duplicateClaimId,
      normalizedClaim: 'duplicate_delivery_sequence',
      relatedOriginalClaimIds: originalDuplicateClaims,
      relatedRules: ['duplicate_event_repetition'],
      baselineEvidencePaths,
      candidateEvidencePaths,
      coverageStatus: sources.diff.changes.some((change) => change.addressedRules.includes('duplicate_event_repetition')) ? 'partially_covered' : 'uncovered',
      uncoveredParagraphs: residualSequenceIndexes,
      reasonFailurePersisted: 'The initial operation changed one handoff paragraph but left the second opening, receipt, dialogue, and closing sequence in place.',
      evidenceFingerprint: sha256(`duplicate_delivery_sequence|${residualSequenceIndexes.map((index) => paragraphByIndex.get(index)?.text ?? '').join('|')}`)
    }
  ];

  const proposedTargets = buildProposedTargets(
    paragraphs,
    residualTimeIndexes,
    residualSequenceIndexes,
    timeClaimId,
    duplicateClaimId,
    timeContradictions,
    duplicateContradictions,
    sources.adjudication.revisionScopeRecommendation.factsToPreserve
  );
  const proposedIndexes = new Set(proposedTargets.map((target) => target.paragraphIndex));
  const residualEvidence: TargetCoverageResidualEvidence[] = [
    ...proposedTargets.map((target) => ({
      evidenceId: `residual_evidence_p${pad(target.paragraphIndex)}`,
      sourceType: 'draft' as const,
      path: sources.experiment.sourceDraftPath,
      paragraphIndex: target.paragraphIndex,
      snippet: target.snippet,
      snippetHash: target.snippetHash,
      eventIdentity: target.eventIdentity,
      evidenceKind: residualTimeIndexes.includes(target.paragraphIndex) ? 'explicit_time' as const : 'action_sequence' as const,
      linkedClaimIds: target.linkedClaimIds,
      linkedContradictionIds: target.linkedContradictionIds,
      initiallyTargeted: false,
      residual: true
    })),
    ...sources.experiment.samples.filter((sample) => sample.arm === 'candidate' && sample.timelineConsistencyPassed === false).map((sample) => {
      const timelineCheck = sample.hardChecks.timeline_consistency;
      const evidence = timelineCheck?.evidence ?? timelineCheck?.message ?? 'Candidate diagnostics retained a timeline consistency failure.';
      return {
        evidenceId: `candidate_diagnostics_${sample.sampleId}`,
        sourceType: 'candidate_diagnostics' as const,
        path: sample.parsedOutputPath || `${sources.experimentPath}#${sample.sampleId}`,
        paragraphIndex: null,
        snippet: evidence.slice(0, 600),
        snippetHash: sha256(evidence),
        eventIdentity: `chapter_${pad(chapterNumber)}_single_delivery`,
        evidenceKind: /23:29|二十三点二十九分/.test(evidence) ? 'explicit_time' as const : 'action_sequence' as const,
        linkedClaimIds: /23:29|二十三点二十九分/.test(evidence) ? [timeClaimId] : [duplicateClaimId],
        linkedContradictionIds: /23:29|二十三点二十九分/.test(evidence) ? timeContradictions : duplicateContradictions,
        initiallyTargeted: false,
        residual: true
      };
    })
  ];

  const graphBuild = buildCoverageGraph({
    paths,
    chapterNumber,
    sources,
    paragraphs,
    initialIndexes,
    proposedIndexes,
    sequences,
    lateTimeEvidence,
    residualClaims,
    timeClaimId,
    duplicateClaimId,
    timeContradictions,
    duplicateContradictions
  });
  const contradictionEdges = graphBuild.edges.filter((edge) => edge.edgeType === 'contradiction' || edge.edgeType === 'duplicate_sequence');
  const eventOccurrences = graphBuild.eventOccurrences;
  const metrics: TargetCoverageMetrics = {
    initialTargetCount: initialTargets.length,
    proposedAdditionalTargetCount: proposedTargets.length,
    uniqueClaimCount: residualClaims.length,
    coveredClaimCountBefore: residualClaims.filter((claim) => claim.coverageStatus === 'covered').length,
    projectedCoveredClaimCountAfter: residualClaims.filter((claim) => claim.uncoveredParagraphs.every((index) => proposedIndexes.has(index))).length,
    contradictionEdgeCount: contradictionEdges.length,
    coveredContradictionEdgesBefore: contradictionEdges.filter((edge) => edge.coveredBefore).length,
    projectedCoveredContradictionEdgesAfter: contradictionEdges.filter((edge) => edge.projectedCoveredAfter).length,
    eventOccurrenceCount: eventOccurrences.length,
    coveredEventOccurrencesBefore: eventOccurrences.filter((occurrence) => occurrence.coveredBefore).length,
    projectedCoveredEventOccurrencesAfter: eventOccurrences.filter((occurrence) => occurrence.projectedCoveredAfter).length
  };
  const requiredTargetsHaveHashes = proposedTargets.filter((target) => target.requiredForClosure).every((target) => /^[a-f0-9]{64}$/.test(target.snippetHash));
  const unresolvedSameEventTimeReferences = residualTimeIndexes.filter((index) => !proposedIndexes.has(index)).length;
  const uncoveredDuplicateSequences = duplicateSequences.filter((sequence) => sequence.paragraphIndexes.some((index) => !initialIndexes.has(index) && !proposedIndexes.has(index))).length;
  const coverageClosed = evaluateTargetCoverageClosure({ metrics, requiredTargetsHaveHashes, unresolvedSameEventTimeReferences, uncoveredDuplicateSequences });
  const graph = {
    nodes: graphBuild.nodes,
    edges: graphBuild.edges,
    uncoveredNodeIdsBefore: graphBuild.nodes.filter((node) => node.mutableEndpoint && !node.initiallyTargeted && !node.explicitlyPreserved).map((node) => node.nodeId),
    uncoveredEdgeIdsBefore: contradictionEdges.filter((edge) => !edge.coveredBefore).map((edge) => edge.edgeId),
    uncoveredNodeIdsAfter: graphBuild.nodes.filter((node) => node.mutableEndpoint && !node.initiallyTargeted && !node.proposedTarget && !node.explicitlyPreserved).map((node) => node.nodeId),
    uncoveredEdgeIdsAfter: contradictionEdges.filter((edge) => !edge.projectedCoveredAfter).map((edge) => edge.edgeId),
    coverageClosed
  };
  return { initialTargets, residualClaims, residualEvidence, proposedTargets, metrics, graph, generatedAt };
}

function buildProposedTargets(
  paragraphs: ReturnType<typeof parseMarkdownEvidenceParagraphs>,
  timeIndexes: number[],
  sequenceIndexes: number[],
  timeClaimId: string,
  duplicateClaimId: string,
  timeContradictions: string[],
  duplicateContradictions: string[],
  factsToPreserve: string[]
): TargetCoverageProposedTarget[] {
  const timeSet = new Set(timeIndexes);
  return uniqueNumbers([...timeIndexes, ...sequenceIndexes]).map((paragraphIndex) => {
    const paragraph = paragraphs[paragraphIndex - 1];
    if (paragraph === undefined) throw staleCoverage([`proposed paragraph ${paragraphIndex} does not exist`]);
    const timeTarget = timeSet.has(paragraphIndex);
    return {
      targetId: `target_p${pad(paragraphIndex)}`,
      paragraphIndex,
      snippet: paragraph.text.slice(0, 600),
      snippetHash: sha256(paragraph.text.slice(0, 600)),
      eventIdentity: timeTarget ? 'single_delivery_time_record' : 'duplicate_delivery_sequence',
      reason: timeTarget
        ? 'The explicit late exit time remains linked to the same mission-required daytime delivery.'
        : 'This paragraph is inside the complete second opening, handoff, receipt, and closing sequence cited by candidate diagnostics.',
      linkedClaimIds: [timeTarget ? timeClaimId : duplicateClaimId],
      linkedContradictionIds: timeTarget ? timeContradictions : duplicateContradictions,
      allowedOperationTypes: timeTarget
        ? ['replace_paragraph', 'merge_target_paragraphs'] as const
        : ['replace_paragraph', 'delete_duplicate_paragraph', 'merge_target_paragraphs'] as const,
      factsToPreserve,
      riskLevel: 'medium' as const,
      requiredForClosure: true
    };
  });
}

function buildCoverageGraph(input: {
  paths: ProjectPaths;
  chapterNumber: number;
  sources: SourceSet;
  paragraphs: ReturnType<typeof parseMarkdownEvidenceParagraphs>;
  initialIndexes: Set<number>;
  proposedIndexes: Set<number>;
  sequences: DeliverySequence[];
  lateTimeEvidence: SourceSet['adjudication']['draftEvidence'];
  residualClaims: TargetCoverageResidualClaim[];
  timeClaimId: string;
  duplicateClaimId: string;
  timeContradictions: string[];
  duplicateContradictions: string[];
}) {
  const relevantIndexes = uniqueNumbers([
    ...input.initialIndexes,
    ...input.proposedIndexes,
    ...input.sequences.flatMap((sequence) => sequence.paragraphIndexes)
  ]);
  const paragraphNodes = relevantIndexes.map((index) => {
    const paragraph = input.paragraphs[index - 1]!;
    const inPrimarySequence = input.sequences[0]?.paragraphIndexes.includes(index) ?? false;
    return {
      nodeId: `paragraph_p${pad(index)}`,
      nodeType: 'paragraph_evidence' as const,
      label: `paragraph ${index}: ${paragraph.text.slice(0, 80)}`,
      sourcePath: input.sources.experiment.sourceDraftPath,
      paragraphIndex: index,
      snippetHash: sha256(paragraph.text.slice(0, 600)),
      eventIdentity: `chapter_${pad(input.chapterNumber)}_single_delivery`,
      mutableEndpoint: input.initialIndexes.has(index) || input.proposedIndexes.has(index),
      initiallyTargeted: input.initialIndexes.has(index),
      proposedTarget: input.proposedIndexes.has(index),
      explicitlyPreserved: inPrimarySequence && !input.initialIndexes.has(index)
    };
  });
  const eventNode = {
    nodeId: 'event_single_delivery',
    nodeType: 'event' as const,
    label: 'Single chapter delivery to the sixteenth-floor resident',
    sourcePath: input.sources.experiment.sourceDraftPath,
    paragraphIndex: null,
    snippetHash: null,
    eventIdentity: `chapter_${pad(input.chapterNumber)}_single_delivery`,
    mutableEndpoint: false,
    initiallyTargeted: false,
    proposedTarget: false,
    explicitlyPreserved: true
  };
  const inferredEvidence = input.sources.adjudication.draftEvidence.find((evidence) => evidence.inferredTime === 'midday_peak' || evidence.inferredTime === 'daytime');
  const inferredNode = {
    nodeId: 'time_inferred_daytime',
    nodeType: 'inferred_time' as const,
    label: inferredEvidence?.inferredTime ?? 'daytime',
    sourcePath: inferredEvidence?.path ?? input.sources.experiment.sourceDraftPath,
    paragraphIndex: inferredEvidence?.paragraphIndex ?? null,
    snippetHash: inferredEvidence?.normalizedSnippetHash ?? null,
    eventIdentity: `chapter_${pad(input.chapterNumber)}_single_delivery`,
    mutableEndpoint: inferredEvidence !== undefined,
    initiallyTargeted: inferredEvidence === undefined ? false : input.initialIndexes.has(inferredEvidence.paragraphIndex),
    proposedTarget: inferredEvidence === undefined ? false : input.proposedIndexes.has(inferredEvidence.paragraphIndex),
    explicitlyPreserved: false
  };
  const explicitTimeNodes = input.lateTimeEvidence.map((evidence) => ({
    nodeId: `time_explicit_p${pad(evidence.paragraphIndex)}`,
    nodeType: 'explicit_time' as const,
    label: evidence.explicitTime ?? 'late time',
    sourcePath: evidence.path,
    paragraphIndex: evidence.paragraphIndex,
    snippetHash: evidence.normalizedSnippetHash,
    eventIdentity: `chapter_${pad(input.chapterNumber)}_single_delivery`,
    mutableEndpoint: true,
    initiallyTargeted: input.initialIndexes.has(evidence.paragraphIndex),
    proposedTarget: input.proposedIndexes.has(evidence.paragraphIndex),
    explicitlyPreserved: false
  }));
  const sequenceNodes = input.sequences.map((sequence, index) => ({
    nodeId: sequence.sequenceId,
    nodeType: 'action_sequence' as const,
    label: `${index === 0 ? 'primary' : 'duplicate'} delivery action sequence paragraphs ${sequence.startParagraph}-${sequence.endParagraph}`,
    sourcePath: input.sources.experiment.sourceDraftPath,
    paragraphIndex: sequence.startParagraph,
    snippetHash: sha256(sequence.paragraphIndexes.map((paragraphIndex) => input.paragraphs[paragraphIndex - 1]!.text).join('\n')),
    eventIdentity: `chapter_${pad(input.chapterNumber)}_single_delivery`,
    mutableEndpoint: index > 0,
    initiallyTargeted: index > 0 && sequence.paragraphIndexes.every((paragraphIndex) => input.initialIndexes.has(paragraphIndex)),
    proposedTarget: index > 0 && sequence.paragraphIndexes.every((paragraphIndex) => input.initialIndexes.has(paragraphIndex) || input.proposedIndexes.has(paragraphIndex)),
    explicitlyPreserved: index === 0
  }));
  const missionEvidence = input.sources.adjudication.planningEvidence.find((evidence) => evidence.sourceType === 'mission' && evidence.expectedTime === 'daytime');
  const planEvidence = input.sources.adjudication.planningEvidence.find((evidence) => evidence.sourceType === 'selected_plan' && evidence.expectedTime === 'daytime');
  const missionNode = constraintNode('constraint_mission_daytime', 'mission_constraint', missionEvidence, 'Mission requires daytime delivery.');
  const planNode = constraintNode('constraint_plan_daytime', 'plan_constraint', planEvidence, 'Selected plan requires daytime delivery.');
  const nodes = [eventNode, ...paragraphNodes, inferredNode, ...explicitTimeNodes, ...sequenceNodes, missionNode, planNode];
  const edges: TargetCoverageGraph['edges'] = [];
  for (const paragraphNode of paragraphNodes) {
    edges.push(graphEdge(`edge_contains_${paragraphNode.nodeId}`, 'contains', eventNode.nodeId, paragraphNode.nodeId, [], [], 'The paragraph is evidence for the single delivery event.', paragraphNode.initiallyTargeted || paragraphNode.explicitlyPreserved, paragraphNode.initiallyTargeted || paragraphNode.proposedTarget || paragraphNode.explicitlyPreserved));
  }
  edges.push(graphEdge('edge_same_event_daytime', 'same_event_identity', eventNode.nodeId, inferredNode.nodeId, [input.timeClaimId], input.timeContradictions, 'The inferred daytime context belongs to the same order, recipient, location, and day.', inferredNode.initiallyTargeted, inferredNode.initiallyTargeted || inferredNode.proposedTarget));
  for (const timeNode of explicitTimeNodes) {
    const coveredBefore = timeNode.initiallyTargeted;
    const coveredAfter = timeNode.initiallyTargeted || timeNode.proposedTarget;
    edges.push(graphEdge(`edge_has_time_${timeNode.nodeId}`, 'has_time', eventNode.nodeId, timeNode.nodeId, [input.timeClaimId], input.timeContradictions, 'The explicit clock record belongs to the same delivery event.', coveredBefore, coveredAfter));
    edges.push(graphEdge(`edge_time_contradiction_${timeNode.nodeId}`, 'contradiction', inferredNode.nodeId, timeNode.nodeId, [input.timeClaimId], input.timeContradictions, 'Daytime framing conflicts with the explicit late-night record for the same event.', coveredBefore, coveredAfter));
    edges.push(graphEdge(`edge_mission_contradiction_${timeNode.nodeId}`, 'contradiction', missionNode.nodeId, timeNode.nodeId, [input.timeClaimId], input.timeContradictions, 'Mission and selected-plan daytime constraints conflict with the late-night record.', coveredBefore, coveredAfter));
  }
  edges.push(graphEdge('edge_event_constrained_mission', 'constrained_by', eventNode.nodeId, missionNode.nodeId, [input.timeClaimId], input.timeContradictions, 'The event is constrained by the mission daytime requirement.', true, true));
  edges.push(graphEdge('edge_event_constrained_plan', 'constrained_by', eventNode.nodeId, planNode.nodeId, [input.timeClaimId], input.timeContradictions, 'The event is constrained by the selected plan daytime requirement.', true, true));
  for (const sequenceNode of sequenceNodes) {
    edges.push(graphEdge(`edge_same_event_${sequenceNode.nodeId}`, 'same_event_identity', eventNode.nodeId, sequenceNode.nodeId, [input.duplicateClaimId], input.duplicateContradictions, 'The action sequence uses the same order, recipient, location, and completed outcome.', sequenceNode.initiallyTargeted || sequenceNode.explicitlyPreserved, sequenceNode.initiallyTargeted || sequenceNode.proposedTarget || sequenceNode.explicitlyPreserved));
  }
  if (sequenceNodes.length >= 2) {
    for (const duplicateNode of sequenceNodes.slice(1)) {
      edges.push(graphEdge(`edge_duplicate_${duplicateNode.nodeId}`, 'duplicate_sequence', sequenceNodes[0]!.nodeId, duplicateNode.nodeId, [input.duplicateClaimId], input.duplicateContradictions, 'The second opening, handoff, receipt, and closing sequence repeats the completed delivery.', duplicateNode.initiallyTargeted, duplicateNode.initiallyTargeted || duplicateNode.proposedTarget));
    }
  }
  const eventOccurrences = [
    { occurrenceId: 'occurrence_daytime', coveredBefore: inferredNode.initiallyTargeted, projectedCoveredAfter: inferredNode.initiallyTargeted || inferredNode.proposedTarget },
    ...explicitTimeNodes.map((node) => ({ occurrenceId: `occurrence_${node.nodeId}`, coveredBefore: node.initiallyTargeted, projectedCoveredAfter: node.initiallyTargeted || node.proposedTarget })),
    ...sequenceNodes.map((node) => ({ occurrenceId: `occurrence_${node.nodeId}`, coveredBefore: node.initiallyTargeted || node.explicitlyPreserved, projectedCoveredAfter: node.initiallyTargeted || node.proposedTarget || node.explicitlyPreserved }))
  ];
  return { nodes, edges, eventOccurrences };
}

function findDeliverySequences(paragraphs: ReturnType<typeof parseMarkdownEvidenceParagraphs>): DeliverySequence[] {
  const sequences: DeliverySequence[] = [];
  let searchIndex = 0;
  while (searchIndex < paragraphs.length) {
    const startOffset = paragraphs.findIndex((paragraph, index) => index >= searchIndex && /门(?:又)?开|开门|敲门/.test(paragraph.text));
    if (startOffset < 0) break;
    const window = paragraphs.slice(startOffset, Math.min(paragraphs.length, startOffset + 10));
    const handoffOffset = window.findIndex((paragraph) => /餐袋|接过餐|接餐|交餐|收餐|递给/.test(paragraph.text));
    const closeOffset = window.findIndex((paragraph, index) =>
      index >= Math.max(0, handoffOffset) && /门[^。！？]{0,80}(?:关上|合上)|关门|锁舌/.test(paragraph.text)
    );
    if (handoffOffset < 0 || closeOffset < 0) {
      searchIndex = startOffset + 1;
      continue;
    }
    const selected = window.slice(0, closeOffset + 1);
    sequences.push({
      sequenceId: `action_sequence_${String(sequences.length + 1).padStart(3, '0')}`,
      paragraphIndexes: selected.map((paragraph) => paragraph.paragraphIndex),
      startParagraph: selected[0]!.paragraphIndex,
      endParagraph: selected.at(-1)!.paragraphIndex
    });
    searchIndex = startOffset + closeOffset + 1;
  }
  return sequences;
}

async function assertApprovalFresh(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  report: TargetCoverageClosureReport,
  reportText: string,
  preview: TargetExpansionApprovalPreview
): Promise<void> {
  const checks: Array<[string, string]> = [
    [report.sourceDraftPath, report.sourceDraftHash],
    [report.sourceAdjudicationPath, report.sourceAdjudicationHash],
    [report.sourceTimelineMapPath, report.sourceTimelineMapHash],
    [report.sourceExperimentPath, report.sourceExperimentHash],
    [report.candidateDispositionPath, report.candidateDispositionHash],
    [report.rejectedCandidatePath, report.rejectedCandidateHash],
    [report.targetCoverageGraphPath, report.targetCoverageGraphHash]
  ];
  const staleReasons: string[] = [];
  for (const [artifactPath, expectedHash] of checks) {
    if (!(await fileStore.exists(paths.projectArtifact(artifactPath)))) {
      staleReasons.push(`missing source ${artifactPath}`);
      continue;
    }
    if (sha256(await fileStore.readText(paths.projectArtifact(artifactPath))) !== expectedHash) staleReasons.push(`source hash changed ${artifactPath}`);
  }
  if (preview.coverageReportHash !== sha256(reportText)) staleReasons.push('coverage report hash changed');
  const disposition = await fileStore.readJson(paths.projectArtifact(report.candidateDispositionPath), CandidateDispositionSchema);
  if (disposition.adopted || disposition.eligibleAsNextRevisionBase || !disposition.result.startsWith('rejected_')) staleReasons.push('candidate disposition is no longer rejected');
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const queue = await fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema);
  const queueItem = queue.chapters.find((item) => item.chapterNumber === chapterNumber);
  if (storyState.latestCommittedChapter !== chapterNumber - 1) staleReasons.push(`latestCommittedChapter is ${storyState.latestCommittedChapter}, expected ${chapterNumber - 1}`);
  if (queueItem === undefined || queueItem.status === 'committed' || queueItem.status === 'recommitted' || queueItem.committedAt !== null) staleReasons.push('chapter is missing or already committed');
  if (staleReasons.length > 0) throw staleCoverage(staleReasons);
}

async function captureProtectedArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, sources: SourceSet): Promise<ProtectedSnapshot[]> {
  const chapterEntries = await fileStore.list(paths.chapterDir(chapterNumber));
  const diagnostics = chapterEntries.filter((entry) => /^diagnostics_v\d+\.json$/.test(entry)).map((entry) => relativeChapterArtifact(chapterNumber, entry));
  const artifactPaths = uniqueStrings([
    path.posix.join('state', 'story_state.json'),
    path.posix.join('planning', 'chapter_queue.json'),
    sources.experiment.sourceDraftPath,
    sources.experiment.candidateDraftPath,
    sources.adjudication.sourceMissionPath,
    sources.adjudication.sourceSelectedPlanPath,
    ...diagnostics
  ]);
  return Promise.all(artifactPaths.map(async (artifactPath) => {
    const content = await fileStore.readText(paths.projectArtifact(artifactPath));
    return { path: artifactPath, content, hash: sha256(content) };
  }));
}

async function captureApprovalProtectedArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, report: TargetCoverageClosureReport): Promise<ProtectedSnapshot[]> {
  const chapterEntries = await fileStore.list(paths.chapterDir(chapterNumber));
  const diagnostics = chapterEntries.filter((entry) => /^diagnostics_v\d+\.json$/.test(entry)).map((entry) => relativeChapterArtifact(chapterNumber, entry));
  const artifactPaths = uniqueStrings([
    path.posix.join('state', 'story_state.json'),
    path.posix.join('planning', 'chapter_queue.json'),
    report.sourceDraftPath,
    report.rejectedCandidatePath,
    ...diagnostics
  ]);
  return Promise.all(artifactPaths.map(async (artifactPath) => {
    const content = await fileStore.readText(paths.projectArtifact(artifactPath));
    return { path: artifactPath, content, hash: sha256(content) };
  }));
}

async function verifyProtectedArtifacts(paths: ProjectPaths, fileStore: FileStore, protectedBefore: ProtectedSnapshot[]) {
  return Promise.all(protectedBefore.map(async (snapshot) => {
    const currentHash = sha256(await fileStore.readText(paths.projectArtifact(snapshot.path)));
    if (currentHash !== snapshot.hash) throw new Error(`target coverage modified protected artifact ${snapshot.path}`);
    return { path: snapshot.path, beforeSha256: snapshot.hash, afterSha256: currentHash, unchanged: true as const };
  }));
}

async function assertProtectedArtifactsStillUnchanged(paths: ProjectPaths, fileStore: FileStore, protectedBefore: ProtectedSnapshot[]): Promise<void> {
  for (const snapshot of protectedBefore) {
    if (await fileStore.readText(paths.projectArtifact(snapshot.path)) !== snapshot.content) {
      throw new Error(`target coverage modified protected artifact ${snapshot.path}`);
    }
  }
}

async function writeOrValidateDisposition(paths: ProjectPaths, fileStore: FileStore, artifacts: CoverageArtifacts, disposition: CandidateDisposition): Promise<void> {
  const absolute = paths.projectArtifact(artifacts.dispositionPath);
  if (await fileStore.exists(absolute)) {
    const existing = await fileStore.readJson(absolute, CandidateDispositionSchema);
    if (existing.candidateHash !== disposition.candidateHash || existing.experimentReportHash !== disposition.experimentReportHash || existing.result !== disposition.result) {
      throw staleCoverage(['existing candidate disposition does not match source experiment']);
    }
    return;
  }
  await fileStore.writeJson(absolute, disposition, CandidateDispositionSchema);
  await fileStore.writeText(paths.projectArtifact(artifacts.dispositionMarkdownPath), renderDispositionMarkdown(disposition));
}

async function allocateCoverageArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, experimentPath: string): Promise<CoverageArtifacts> {
  const version = await nextArtifactVersion(paths, fileStore, chapterNumber, 'target_coverage_closure_report');
  const dispositionVersion = versionFromPath(experimentPath);
  return {
    version,
    dispositionVersion,
    dispositionPath: relativeChapterArtifact(chapterNumber, `targeted_revision_candidate_disposition_v${dispositionVersion}.json`),
    dispositionMarkdownPath: relativeChapterArtifact(chapterNumber, `targeted_revision_candidate_disposition_v${dispositionVersion}.md`),
    graphPath: relativeChapterArtifact(chapterNumber, `target_coverage_graph_v${version}.json`),
    graphMarkdownPath: relativeChapterArtifact(chapterNumber, `target_coverage_graph_v${version}.md`),
    reportPath: relativeChapterArtifact(chapterNumber, `target_coverage_closure_report_v${version}.json`),
    reportMarkdownPath: relativeChapterArtifact(chapterNumber, `target_coverage_closure_report_v${version}.md`),
    approvalPreviewPath: relativeChapterArtifact(chapterNumber, `target_expansion_approval_preview_v${version}.json`),
    approvalPreviewMarkdownPath: relativeChapterArtifact(chapterNumber, `target_expansion_approval_preview_v${version}.md`)
  };
}

async function nextArtifactVersion(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string): Promise<number> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  const pattern = new RegExp(`^${baseName}_v(\\d+)\\.(?:json|md)$`);
  return Math.max(0, ...entries.map((entry) => Number.parseInt(pattern.exec(entry)?.[1] ?? '0', 10))) + 1;
}

async function requireLatestArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string): Promise<string> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  const pattern = new RegExp(`^${baseName}_v(\\d+)\\.json$`);
  const latest = entries.map((entry) => ({ entry, version: Number.parseInt(pattern.exec(entry)?.[1] ?? '0', 10) }))
    .filter((item) => item.version > 0)
    .sort((left, right) => right.version - left.version)[0];
  if (latest === undefined) throw staleCoverage([`missing ${baseName}_vN.json`]);
  return relativeChapterArtifact(chapterNumber, latest.entry);
}

function resolveSafeChapterPath(paths: ProjectPaths, chapterNumber: number, requestedPath: string, pattern: RegExp): string {
  const absolute = path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(paths.projectRoot, requestedPath);
  if (path.dirname(absolute) !== paths.chapterDir(chapterNumber) || !pattern.test(path.basename(absolute))) {
    throw staleCoverage([`unsafe or invalid report path ${requestedPath}`]);
  }
  return path.relative(paths.projectRoot, absolute).split(path.sep).join(path.posix.sep);
}

async function findApprovalForReport(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, reportPath: string) {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  for (const entry of entries.filter((value) => /^target_expansion_approval_v\d+\.json$/.test(value)).sort().reverse()) {
    const relativePath = relativeChapterArtifact(chapterNumber, entry);
    const record = await fileStore.readJson(paths.projectArtifact(relativePath), TargetExpansionApprovalRecordSchema);
    if (record.coverageReportPath === reportPath) {
      return { record, path: relativePath, markdownPath: relativePath.replace(/\.json$/, '.md') };
    }
  }
  return undefined;
}

function constraintNode(
  nodeId: string,
  nodeType: 'mission_constraint' | 'plan_constraint',
  evidence: SourceSet['adjudication']['planningEvidence'][number] | undefined,
  fallback: string
) {
  return {
    nodeId,
    nodeType,
    label: evidence?.snippet ?? fallback,
    sourcePath: evidence?.path ?? null,
    paragraphIndex: null,
    snippetHash: evidence?.normalizedSnippetHash ?? null,
    eventIdentity: 'planned_single_delivery',
    mutableEndpoint: false,
    initiallyTargeted: false,
    proposedTarget: false,
    explicitlyPreserved: true
  };
}

function graphEdge(
  edgeId: string,
  edgeType: TargetCoverageGraph['edges'][number]['edgeType'],
  fromNodeId: string,
  toNodeId: string,
  linkedClaimIds: string[],
  linkedContradictionIds: string[],
  description: string,
  coveredBefore: boolean,
  projectedCoveredAfter: boolean
): TargetCoverageGraph['edges'][number] {
  return { edgeId, edgeType, fromNodeId, toNodeId, linkedClaimIds, linkedContradictionIds, description, coveredBefore, projectedCoveredAfter };
}

function diagnosticEvidencePaths(experiment: TargetedRevisionExperimentReport, arm: 'baseline' | 'candidate'): string[] {
  const paths = experiment.samples.filter((sample) => sample.arm === arm).map((sample) => sample.parsedOutputPath || `${experiment.runId}#${sample.sampleId}`);
  return paths.length > 0 ? paths : [experiment.sourceDraftPath];
}

function sourceArtifactPaths(sources: SourceSet): string[] {
  return uniqueStrings([
    sources.experimentPath,
    sources.experiment.sourceDraftPath,
    sources.experiment.candidateDraftPath,
    sources.experiment.sourceAdjudicationPath,
    sources.adjudication.timelineContradictionMapPath,
    sources.experiment.targetedRevisionPlanPath,
    sources.experiment.revisionDiffPath
  ]);
}

function isLateTime(value: string | null): boolean {
  if (value === null) return false;
  const hour = Number.parseInt(value.split(':')[0] ?? '', 10);
  return Number.isFinite(hour) && (hour >= 22 || hour < 5);
}

function staleCoverage(reasons: string[]): AppError {
  return new AppError('CODEX_TARGET_COVERAGE_SOURCE_STALE', `Target coverage source is stale: ${reasons.join('; ')}`, 2);
}

function ratio(value: number, total: number): number {
  return total === 0 ? 1 : round(value / total);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function formatRate(value: number): string {
  return `${round(value * 100)}%`;
}

function versionFromPath(artifactPath: string): number {
  const match = /_v(\d+)\.json$/.exec(artifactPath);
  if (match === null) throw staleCoverage([`version missing from ${artifactPath}`]);
  return Number.parseInt(match[1]!, 10);
}

function pad(value: number): string {
  return String(value).padStart(3, '0');
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.posix.join('chapters', `chapter_${pad(chapterNumber)}`, fileName);
}

function uniqueNumbers(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function approvalCommand(projectId: string, chapterNumber: number): string {
  return `corepack pnpm novel-loop codex approve-target-expansion ${projectId} ${chapterNumber} --report latest --confirm`;
}

function renderDispositionMarkdown(disposition: CandidateDisposition): string {
  return [
    `# Candidate Disposition: Chapter ${disposition.chapterNumber}`,
    '',
    `result: ${disposition.result}`,
    `adopted: ${String(disposition.adopted)}`,
    `eligibleAsNextRevisionBase: ${String(disposition.eligibleAsNextRevisionBase)}`,
    `retainForProvenance: ${String(disposition.retainForProvenance)}`,
    `baselineTimelineFailureRate: ${disposition.baselineTimelineFailureRate}`,
    `candidateTimelineFailureRate: ${disposition.candidateTimelineFailureRate}`,
    `scoreDelta: ${disposition.scoreDelta ?? 'null'}`,
    '',
    ...disposition.rejectionReasons.map((reason) => `- ${reason}`),
    ''
  ].join('\n');
}

function renderGraphMarkdown(graph: TargetCoverageGraph): string {
  return [
    `# Target Coverage Graph: Chapter ${graph.chapterNumber}`,
    '',
    `coverageClosed: ${String(graph.coverageClosed)}`,
    `nodes: ${graph.nodes.length}`,
    `edges: ${graph.edges.length}`,
    `uncoveredBefore: ${graph.uncoveredNodeIdsBefore.join(', ') || 'none'}`,
    `uncoveredAfter: ${graph.uncoveredNodeIdsAfter.join(', ') || 'none'}`,
    '',
    '## Contradiction and Duplicate Edges',
    ...graph.edges.filter((edge) => edge.edgeType === 'contradiction' || edge.edgeType === 'duplicate_sequence')
      .map((edge) => `- ${edge.edgeId}: before=${edge.coveredBefore}; projected=${edge.projectedCoveredAfter}; ${edge.description}`),
    ''
  ].join('\n');
}

function renderCoverageMarkdown(report: TargetCoverageClosureReport): string {
  return [
    `# Target Coverage Closure: Chapter ${report.chapterNumber}`,
    '',
    `coverageClosed: ${String(report.coverageClosed)}`,
    `candidateUsedAsRevisionBase: ${String(report.candidateUsedAsRevisionBase)}`,
    `claimCoverage: ${report.claimCoverageBefore} -> ${report.projectedClaimCoverageAfter}`,
    `contradictionEdgeCoverage: ${report.contradictionEdgeCoverageBefore} -> ${report.projectedContradictionEdgeCoverageAfter}`,
    `eventOccurrenceCoverage: ${report.eventOccurrenceCoverageBefore} -> ${report.projectedEventOccurrenceCoverageAfter}`,
    '',
    '## Residual Claims',
    ...report.residualClaims.map((claim) => `- ${claim.normalizedClaim}: ${claim.coverageStatus}; uncovered paragraphs ${claim.uncoveredParagraphs.join(', ') || 'none'}`),
    '',
    '## Proposed Additional Targets',
    ...report.proposedAdditionalTargets.map((target) => `- ${target.targetId}: paragraph ${target.paragraphIndex}; ${target.reason}`),
    '',
    `Next: ${report.recommendedNextStep}`,
    ''
  ].join('\n');
}

function renderApprovalPreviewMarkdown(preview: TargetExpansionApprovalPreview): string {
  return [
    `# Target Expansion Approval Preview: Chapter ${preview.chapterNumber}`,
    '',
    `approved: ${String(preview.approved)}`,
    `riskAcknowledged: ${String(preview.riskAcknowledged)}`,
    `proposedTargetIds: ${preview.proposedTargetIds.join(', ')}`,
    '',
    `Approval command: ${preview.suggestedApprovalCommand}`,
    ''
  ].join('\n');
}

function renderApprovalRecordMarkdown(record: TargetExpansionApprovalRecord): string {
  return [
    `# Target Expansion Approval: Chapter ${record.chapterNumber}`,
    '',
    `approved: ${String(record.approved)}`,
    `operator: ${record.operator}`,
    `confirmedAt: ${record.confirmedAt}`,
    `riskAcknowledged: ${String(record.riskAcknowledged)}`,
    `candidateGenerated: ${String(record.candidateGenerated)}`,
    `proposedTargetIds: ${record.proposedTargetIds.join(', ')}`,
    ''
  ].join('\n');
}
