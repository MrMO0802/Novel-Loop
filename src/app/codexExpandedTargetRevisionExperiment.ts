import path from 'node:path';

import { RunLogger } from '../logging/RunLogger.js';
import { resolveCodexOutputSchema } from '../providers/codex/schemas.js';
import { CodexTextProvider } from '../providers/codexTextProvider.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import { PromptService } from '../prompts/PromptService.js';
import {
  CandidateDispositionSchema,
  CandidateRevisionEvidenceAdjudicationSchema,
  CandidateTimelineContradictionMapSchema,
  ChapterMissionSchema,
  ChapterQueueSchema,
  CodexDiagnosticsEvidenceAdjudicationSchema,
  ExpandedTargetRevisionCandidateDispositionSchema,
  ExpandedTargetRevisionDiagnosticsABSchema,
  ExpandedTargetRevisionExperimentReportSchema,
  ExpandedTargetRevisionPlanSchema,
  ExpandedTargetRevisionQualityReportSchema,
  ExpandedTargetRevisionScopeValidationSchema,
  RunManifestV2Schema,
  StoryStateSchema,
  TargetCoverageClosureReportSchema,
  TargetExpansionApprovalRecordSchema,
  TargetedRevisionDiffSchema,
  TargetedRevisionProviderOutputSchema,
  TimelineContradictionMapSchema
} from '../schemas/index.js';
import type {
  CandidateDisposition,
  CandidateRevisionEvidenceAdjudication,
  CandidateTimelineContradictionMap,
  ExpandedTargetRevisionAllowedTarget,
  ExpandedTargetRevisionCandidateDisposition,
  ExpandedTargetRevisionDiagnosticsAB,
  ExpandedTargetRevisionExperimentReport,
  ExpandedTargetRevisionPlan,
  ExpandedTargetRevisionQualityReport,
  ExpandedTargetRevisionScopeValidation,
  TargetCoverageClosureReport,
  TargetExpansionApprovalRecord,
  TargetOperationCoverage,
  TargetedRevisionDiagnosticsSample,
  TargetedRevisionOperation
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';
import { buildDiagnosticsContextManifest } from './codexDiagnosticsContextBuilder.js';
import { parseMarkdownEvidenceParagraphs, sha256 } from './codexDiagnosticsEvidenceRules.js';
import {
  replaceDraftContext,
  runDiagnosticsArm,
  summarizeDiagnostics
} from './codexTargetedRevisionExperiment.js';
import {
  applyTargetedRevisionOperations,
  buildTargetedRevisionDiff,
  buildTargetedRevisionScopeValidation,
  parseMarkdownParagraphBlocks
} from './codexTargetedRevisionScope.js';

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const OPERATIONS_PROMPT_ID = 'revision.targeted_revision_operations_slim';
const DIAGNOSTICS_PROMPT_ID = 'diagnostics.diagnose_chapter_slim';

export interface RunCodexExpandedTargetRevisionExperimentInput {
  projectId: string;
  projectsRoot?: string;
  promptRoot?: string;
  chapterNumber: number;
  approval?: string;
  revisionRound: number;
  samples?: number;
  contextMode?: 'enhanced';
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
}

export interface RunCodexExpandedTargetRevisionExperimentResult {
  runId: string;
  plan: ExpandedTargetRevisionPlan;
  planPath: string;
  planMarkdownPath: string;
  candidateDraftPath: string;
  scopeValidation: ExpandedTargetRevisionScopeValidation;
  scopeValidationPath: string;
  scopeValidationMarkdownPath: string;
  diffPath: string;
  diffMarkdownPath: string;
  diagnosticsAB: ExpandedTargetRevisionDiagnosticsAB;
  diagnosticsABPath: string;
  diagnosticsABMarkdownPath: string;
  candidateAdjudicationPath: string;
  candidateAdjudicationMarkdownPath: string;
  candidateTimelineMapPath: string;
  candidateTimelineMapMarkdownPath: string;
  qualityReportPath: string;
  qualityReportMarkdownPath: string;
  report: ExpandedTargetRevisionExperimentReport;
  reportPath: string;
  reportMarkdownPath: string;
  disposition: ExpandedTargetRevisionCandidateDisposition;
  dispositionPath: string;
  dispositionMarkdownPath: string;
}

interface ExpandedSource {
  approval: TargetExpansionApprovalRecord;
  approvalPath: string;
  approvalText: string;
  coverage: TargetCoverageClosureReport;
  coveragePath: string;
  coverageText: string;
  disposition: CandidateDisposition;
  dispositionPath: string;
  dispositionText: string;
  adjudicationPath: string;
  sourceDraft: string;
  missionText: string;
  selectedPlanText: string;
  storyStateText: string;
  queueText: string;
  allowedTargets: ExpandedTargetRevisionAllowedTarget[];
  fullApprovedTargetIds: string[];
  factsToPreserve: string[];
  forbiddenChanges: string[];
  expectedResolvedClaims: string[];
  expectedResolvedRules: string[];
}

interface ExpandedArtifacts {
  version: number;
  planPath: string;
  planMarkdownPath: string;
  candidateDraftPath: string;
  scopePath: string;
  scopeMarkdownPath: string;
  diffPath: string;
  diffMarkdownPath: string;
  diagnosticsABPath: string;
  diagnosticsABMarkdownPath: string;
  candidateAdjudicationPath: string;
  candidateAdjudicationMarkdownPath: string;
  candidateTimelineMapPath: string;
  candidateTimelineMapMarkdownPath: string;
  qualityPath: string;
  qualityMarkdownPath: string;
  reportPath: string;
  reportMarkdownPath: string;
  dispositionPath: string;
  dispositionMarkdownPath: string;
}

interface ProtectedArtifact {
  path: string;
  content: string;
  hash: string;
}

export async function runCodexExpandedTargetRevisionExperiment(
  input: RunCodexExpandedTargetRevisionExperimentInput,
  fileStore = new FileStore()
): Promise<RunCodexExpandedTargetRevisionExperimentResult> {
  if (input.revisionRound > 2) {
    throw new AppError('CODEX_TARGETED_REVISION_MAX_ROUNDS_REACHED', 'Automatic isolated targeted revision is limited to revision round 2.', 2);
  }
  if (input.revisionRound !== 2) {
    throw new AppError('INVALID_TARGETED_REVISION_ROUND', 'Expanded-target experiment requires --revision-round 2.', 2);
  }
  if (input.approval === undefined || input.approval.trim().length === 0) {
    throw new AppError('CODEX_TARGET_EXPANSION_NOT_APPROVED', 'Revision round 2 requires an explicit --approval path or latest.', 2);
  }
  if ((input.contextMode ?? 'enhanced') !== 'enhanced') {
    throw new AppError('INVALID_DIAGNOSTICS_CONTEXT_MODE', 'Expanded-target experiment requires context-mode enhanced.', 2);
  }

  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const source = await loadApprovedSource(paths, fileStore, input.chapterNumber, input.approval);
  const protectedBefore = await captureProtectedArtifacts(paths, fileStore, input.chapterNumber, source);
  const artifacts = await allocateArtifacts(paths, fileStore, input.chapterNumber);
  const sampleCount = Math.max(1, input.samples ?? 3);
  const runId = createRunId(new Date(), `codex_expanded_target_revision_ch${pad(input.chapterNumber)}`);
  const runLogger = new RunLogger(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex targeted-revision-experiment',
    args: {
      provider: 'codex-text',
      chapterNumber: input.chapterNumber,
      revisionRound: 2,
      approvalRecordPath: source.approvalPath,
      coverageReportPath: source.coveragePath,
      sourceDraftPath: source.coverage.sourceDraftPath,
      sourceCandidatePath: null,
      samples: sampleCount,
      contextMode: 'enhanced',
      codexProfile: input.codexProfile ?? 'clean',
      storyStateCommitAllowed: false,
      normalPreviewAllowed: false,
      candidateAdoptionAllowed: false,
      queueMutationAllowed: false,
      canonicalPatchAllowed: false,
      snapshotAllowed: false,
      automaticFurtherRevisionAllowed: false
    }
  });

  try {
    const provider = new CodexTextProvider({
      ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
      projectsRoot: paths.projectsRoot,
      projectId: paths.projectId,
      codexProfile: input.codexProfile ?? 'clean',
      codexJsonRetries: input.codexJsonRetries ?? 2,
      codexJsonRepair: input.codexJsonRepair ?? true,
      codexJsonRepairRetries: input.codexJsonRepairRetries ?? 1,
      ...(input.codexTimeoutMs === undefined ? {} : { codexTimeoutMs: input.codexTimeoutMs }),
      telemetry: { paths, runId, fileStore }
    });
    const generatedAt = new Date().toISOString();
    const operations = await generateOperations(input, fileStore, provider, source);
    const operationCoverage = buildOperationCoverage(source.allowedTargets, operations);
    const missingRequired = operationCoverage.filter((target) => target.requiredForClosure && target.disposition === 'preserved_with_justification');
    if (missingRequired.length > 0) {
      throw new AppError(
        'CODEX_TARGETED_REVISION_INCOMPLETE_TARGET_COVERAGE',
        `Required approved targets were omitted: ${missingRequired.map((target) => target.targetId).join(', ')}`,
        2
      );
    }
    const planValidation = ExpandedTargetRevisionPlanSchema.safeParse({
      planId: `targeted_revision_plan_ch${pad(input.chapterNumber)}_v${artifacts.version}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      revisionRound: 2,
      sourceAdjudicationPath: source.adjudicationPath,
      sourceDraftPath: source.coverage.sourceDraftPath,
      sourceDraftHash: sha256(source.sourceDraft),
      sourceCandidatePath: null,
      approvalRecordPath: source.approvalPath,
      coverageReportPath: source.coveragePath,
      generatedAt,
      objective: 'Resolve the approved full target set for the single delivery event without changing any non-target paragraph or introducing facts.',
      fullApprovedTargetIds: source.fullApprovedTargetIds,
      allowedTargets: source.allowedTargets,
      operations,
      targetOperationCoverage: operationCoverage,
      factsToPreserve: source.factsToPreserve,
      forbiddenChanges: source.forbiddenChanges,
      expectedResolvedClaims: source.expectedResolvedClaims,
      expectedResolvedRules: source.expectedResolvedRules,
      storyStateMutated: false
    });
    if (!planValidation.success) {
      throw new AppError(
        'CODEX_TARGETED_REVISION_SCOPE_VIOLATION',
        `Expanded target revision plan failed local schema validation: ${planValidation.error.issues.map((issue) => issue.message).join('; ')}`,
        2
      );
    }
    const plan = planValidation.data;
    await fileStore.writeJson(paths.projectArtifact(artifacts.planPath), plan, ExpandedTargetRevisionPlanSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.planMarkdownPath), renderPlan(plan));

    const applied = applyTargetedRevisionOperations(source.sourceDraft, plan);
    const scope = buildExpandedScope(paths, input.chapterNumber, artifacts, generatedAt, source, plan, applied);
    const diff = buildTargetedRevisionDiff({
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      version: artifacts.version,
      generatedAt,
      sourceDraftPath: source.coverage.sourceDraftPath,
      candidateDraftPath: artifacts.candidateDraftPath,
      changes: applied.changes
    });
    await fileStore.writeText(paths.projectArtifact(artifacts.candidateDraftPath), applied.candidateText);
    await fileStore.writeJson(paths.projectArtifact(artifacts.scopePath), scope, ExpandedTargetRevisionScopeValidationSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.scopeMarkdownPath), renderScope(scope));
    await fileStore.writeJson(paths.projectArtifact(artifacts.diffPath), diff, TargetedRevisionDiffSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.diffMarkdownPath), renderDiff(diff));
    await recordRevisionArtifacts(runLogger, runId, source, artifacts);
    if (!scope.scopeValid) {
      const scopeDisposition = buildScopeViolationDisposition(paths, input.chapterNumber, artifacts, scope, applied.candidateText);
      await fileStore.writeJson(paths.projectArtifact(artifacts.dispositionPath), scopeDisposition, ExpandedTargetRevisionCandidateDispositionSchema);
      await fileStore.writeText(paths.projectArtifact(artifacts.dispositionMarkdownPath), renderDisposition(scopeDisposition));
      await runLogger.recordArtifact(runId, artifacts.dispositionPath, { action: 'generated', stage: 'revision', sourcePaths: [artifacts.scopePath, artifacts.candidateDraftPath] });
      await runLogger.recordArtifact(runId, artifacts.dispositionMarkdownPath, { action: 'generated', stage: 'revision', sourcePaths: [artifacts.dispositionPath] });
      throw new AppError('CODEX_TARGETED_REVISION_SCOPE_VIOLATION', `Expanded candidate failed scope validation: ${scope.unauthorizedChanges.join('; ') || 'approved coverage remains unresolved'}`, 2);
    }

    const diagnostics = await runDiagnosticsAB(input, paths, fileStore, provider, runLogger, runId, source, artifacts, applied.candidateText, sampleCount);
    await fileStore.writeJson(paths.projectArtifact(artifacts.diagnosticsABPath), diagnostics, ExpandedTargetRevisionDiagnosticsABSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.diagnosticsABMarkdownPath), renderDiagnosticsAB(diagnostics));

    const timelineMap = buildCandidateTimelineMap(paths, input.chapterNumber, artifacts, generatedAt, source, scope, applied.candidateText);
    const adjudication = buildCandidateAdjudication(paths, input.chapterNumber, artifacts, generatedAt, diagnostics, timelineMap);
    await fileStore.writeJson(paths.projectArtifact(artifacts.candidateTimelineMapPath), timelineMap, CandidateTimelineContradictionMapSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.candidateTimelineMapMarkdownPath), renderTimelineMap(timelineMap));
    await fileStore.writeJson(paths.projectArtifact(artifacts.candidateAdjudicationPath), adjudication, CandidateRevisionEvidenceAdjudicationSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.candidateAdjudicationMarkdownPath), renderAdjudication(adjudication));

    const quality = buildQualityReport(paths, input.chapterNumber, artifacts, generatedAt, source, scope, diagnostics, applied.candidateText);
    await fileStore.writeJson(paths.projectArtifact(artifacts.qualityPath), quality, ExpandedTargetRevisionQualityReportSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.qualityMarkdownPath), renderQuality(quality));

    const result = decideExperiment(scope, diagnostics, adjudication, quality);
    const protectedArtifacts = await verifyProtectedArtifacts(paths, fileStore, protectedBefore);
    const report = ExpandedTargetRevisionExperimentReportSchema.parse({
      reportId: `targeted_revision_experiment_ch${pad(input.chapterNumber)}_v${artifacts.version}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      revisionRound: 2,
      runId,
      generatedAt: new Date().toISOString(),
      approvalRecordPath: source.approvalPath,
      coverageReportPath: source.coveragePath,
      candidateV1DispositionPath: source.dispositionPath,
      sourceAdjudicationPath: source.adjudicationPath,
      sourceDraftPath: source.coverage.sourceDraftPath,
      sourceCandidatePath: null,
      targetedRevisionPlanPath: artifacts.planPath,
      candidateDraftPath: artifacts.candidateDraftPath,
      scopeValidationPath: artifacts.scopePath,
      revisionDiffPath: artifacts.diffPath,
      diagnosticsABPath: artifacts.diagnosticsABPath,
      candidateAdjudicationPath: artifacts.candidateAdjudicationPath,
      candidateTimelineMapPath: artifacts.candidateTimelineMapPath,
      qualityReportPath: artifacts.qualityPath,
      fullApprovedTargetIds: source.fullApprovedTargetIds,
      sampleCountPerArm: sampleCount,
      executionOrder: diagnostics.executionOrder,
      baselineSchemaValidRate: diagnostics.baselineSchemaValidRate,
      candidateSchemaValidRate: diagnostics.candidateSchemaValidRate,
      baselineTimelineFailureRate: diagnostics.baselineTimelineFailureRate,
      candidateTimelineFailureRate: diagnostics.candidateTimelineFailureRate,
      baselineAnyBlockingFailureRate: diagnostics.baselineAnyBlockingFailureRate,
      candidateAnyBlockingFailureRate: diagnostics.candidateAnyBlockingFailureRate,
      baselineAverageScoreMedian: diagnostics.baselineAverageScoreMedian,
      candidateAverageScoreMedian: diagnostics.candidateAverageScoreMedian,
      scoreDelta: diagnostics.scoreDelta,
      newlyIntroducedHardChecks: diagnostics.newlyIntroducedHardChecks,
      resolvedHardChecks: diagnostics.resolvedHardChecks,
      candidateAdjudication: adjudication.adjudication,
      qualityCriticalIssueCount: quality.criticalIssueCount,
      scopeValid: scope.scopeValid,
      fullApprovedTargetSetMatched: scope.fullApprovedTargetSetMatched,
      experimentValid: diagnostics.experimentValid,
      result,
      recommendation: recommendationFor(result),
      requiresHumanReview: true,
      protectedArtifacts,
      candidateAdopted: false,
      normalPreviewStarted: false,
      commitStarted: false,
      canonicalPatchGenerated: false,
      snapshotCreated: false,
      storyStateMutated: false,
      queueMutated: false,
      originalDraftMutated: false,
      canonicalDiagnosticsMutated: false
    });
    await fileStore.writeJson(paths.projectArtifact(artifacts.reportPath), report, ExpandedTargetRevisionExperimentReportSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.reportMarkdownPath), renderExperiment(report));
    const disposition = buildDisposition(paths, input.chapterNumber, artifacts, report, applied.candidateText);
    await fileStore.writeJson(paths.projectArtifact(artifacts.dispositionPath), disposition, ExpandedTargetRevisionCandidateDispositionSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.dispositionMarkdownPath), renderDisposition(disposition));
    await recordOutcomeArtifacts(runLogger, runId, source, artifacts);
    await assertProtectedArtifactsStillUnchanged(paths, fileStore, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return {
      runId,
      plan,
      planPath: artifacts.planPath,
      planMarkdownPath: artifacts.planMarkdownPath,
      candidateDraftPath: artifacts.candidateDraftPath,
      scopeValidation: scope,
      scopeValidationPath: artifacts.scopePath,
      scopeValidationMarkdownPath: artifacts.scopeMarkdownPath,
      diffPath: artifacts.diffPath,
      diffMarkdownPath: artifacts.diffMarkdownPath,
      diagnosticsAB: diagnostics,
      diagnosticsABPath: artifacts.diagnosticsABPath,
      diagnosticsABMarkdownPath: artifacts.diagnosticsABMarkdownPath,
      candidateAdjudicationPath: artifacts.candidateAdjudicationPath,
      candidateAdjudicationMarkdownPath: artifacts.candidateAdjudicationMarkdownPath,
      candidateTimelineMapPath: artifacts.candidateTimelineMapPath,
      candidateTimelineMapMarkdownPath: artifacts.candidateTimelineMapMarkdownPath,
      qualityReportPath: artifacts.qualityPath,
      qualityReportMarkdownPath: artifacts.qualityMarkdownPath,
      report,
      reportPath: artifacts.reportPath,
      reportMarkdownPath: artifacts.reportMarkdownPath,
      disposition,
      dispositionPath: artifacts.dispositionPath,
      dispositionMarkdownPath: artifacts.dispositionMarkdownPath
    };
  } catch (error) {
    await assertProtectedArtifactsStillUnchanged(paths, fileStore, protectedBefore);
    await runLogger.recordError(runId, {
      code: error instanceof AppError ? error.code : 'CODEX_EXPANDED_TARGET_REVISION_FAILED',
      message: getErrorMessage(error),
      recoverable: true
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

async function loadApprovedSource(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  requestedApproval: string
): Promise<ExpandedSource> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  const latestCoveragePath = requireLatestPath(entries, chapterNumber, 'target_coverage_closure_report', 'CODEX_TARGET_EXPANSION_NOT_APPROVED');
  const latestApprovalPath = requireLatestPath(entries, chapterNumber, 'target_expansion_approval', 'CODEX_TARGET_EXPANSION_NOT_APPROVED');
  const approvalPath = requestedApproval === 'latest'
    ? latestApprovalPath
    : resolveSafeArtifactPath(paths, chapterNumber, requestedApproval, /^target_expansion_approval_v\d+\.json$/);
  const [approvalText, coverageText] = await Promise.all([
    fileStore.readText(paths.projectArtifact(approvalPath)),
    fileStore.readText(paths.projectArtifact(latestCoveragePath))
  ]);
  const approval = TargetExpansionApprovalRecordSchema.parse(JSON.parse(approvalText));
  const coverage = TargetCoverageClosureReportSchema.parse(JSON.parse(coverageText));
  const approvalPreviewPath = paths.projectArtifact(approval.sourceApprovalPreviewPath);
  const approvalPreviewValid = await fileStore.exists(approvalPreviewPath) &&
    sha256(await fileStore.readText(approvalPreviewPath)) === approval.sourceApprovalPreviewHash;
  if (!approval.approved || !approval.riskAcknowledged || !coverage.coverageClosed ||
    approvalPath !== latestApprovalPath ||
    !approvalPreviewValid ||
    approval.coverageReportPath !== latestCoveragePath || approval.coverageReportHash !== sha256(coverageText) ||
    approval.sourceDraftPath !== coverage.sourceDraftPath || approval.sourceAdjudicationPath !== coverage.sourceAdjudicationPath ||
    approval.sourceTimelineMapPath !== coverage.sourceTimelineMapPath || approval.sourceExperimentPath !== coverage.sourceExperimentPath ||
    approval.candidateDispositionPath !== coverage.candidateDispositionPath ||
    sorted(approval.proposedTargetIds).join('|') !== sorted(coverage.proposedAdditionalTargets.map((target) => target.targetId)).join('|')) {
    throw new AppError('CODEX_TARGET_EXPANSION_APPROVAL_STALE', 'Target expansion approval does not match the latest closed coverage report.', 2);
  }

  const dispositionPath = coverage.candidateDispositionPath;
  const sourcePaths = [
    coverage.sourceDraftPath,
    coverage.sourceAdjudicationPath,
    coverage.sourceTimelineMapPath,
    coverage.sourceExperimentPath,
    coverage.sourceRevisionPlanPath,
    coverage.sourceRevisionDiffPath,
    coverage.rejectedCandidatePath,
    dispositionPath
  ];
  for (const sourcePath of sourcePaths) {
    if (!(await fileStore.exists(paths.projectArtifact(sourcePath)))) throw staleSource([`missing ${sourcePath}`]);
  }
  const [sourceDraft, adjudicationText, timelineMapText, experimentText, revisionPlanText, revisionDiffText, rejectedCandidateText, dispositionText, missionText, selectedPlanText, storyStateText, queueText] = await Promise.all([
    fileStore.readText(paths.projectArtifact(coverage.sourceDraftPath)),
    fileStore.readText(paths.projectArtifact(coverage.sourceAdjudicationPath)),
    fileStore.readText(paths.projectArtifact(coverage.sourceTimelineMapPath)),
    fileStore.readText(paths.projectArtifact(coverage.sourceExperimentPath)),
    fileStore.readText(paths.projectArtifact(coverage.sourceRevisionPlanPath)),
    fileStore.readText(paths.projectArtifact(coverage.sourceRevisionDiffPath)),
    fileStore.readText(paths.projectArtifact(coverage.rejectedCandidatePath)),
    fileStore.readText(paths.projectArtifact(dispositionPath)),
    fileStore.readText(paths.chapterArtifact(chapterNumber, 'mission.json')),
    fileStore.readText(paths.chapterArtifact(chapterNumber, 'selected_plan.md')),
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue())
  ]);
  const staleReasons: string[] = [];
  for (const [label, actual, expected] of [
    ['source draft', sourceDraft, coverage.sourceDraftHash],
    ['source adjudication', adjudicationText, coverage.sourceAdjudicationHash],
    ['source timeline map', timelineMapText, coverage.sourceTimelineMapHash],
    ['source experiment', experimentText, coverage.sourceExperimentHash],
    ['source revision plan', revisionPlanText, coverage.sourceRevisionPlanHash],
    ['source revision diff', revisionDiffText, coverage.sourceRevisionDiffHash],
    ['rejected candidate', rejectedCandidateText, coverage.rejectedCandidateHash],
    ['candidate disposition', dispositionText, coverage.candidateDispositionHash]
  ] as const) {
    if (sha256(actual) !== expected) staleReasons.push(`${label} hash changed`);
  }
  for (const [label, actual, expected] of [
    ['approval source draft', sourceDraft, approval.sourceDraftHash],
    ['approval source adjudication', adjudicationText, approval.sourceAdjudicationHash],
    ['approval source timeline map', timelineMapText, approval.sourceTimelineMapHash],
    ['approval source experiment', experimentText, approval.sourceExperimentHash],
    ['approval candidate disposition', dispositionText, approval.candidateDispositionHash]
  ] as const) {
    if (sha256(actual) !== expected) staleReasons.push(`${label} hash changed`);
  }
  if (staleReasons.length > 0) throw staleSource(staleReasons);

  const adjudication = CodexDiagnosticsEvidenceAdjudicationSchema.parse(JSON.parse(adjudicationText));
  TimelineContradictionMapSchema.parse(JSON.parse(timelineMapText));
  const disposition = CandidateDispositionSchema.parse(JSON.parse(dispositionText));
  if (disposition.result !== 'rejected_no_improvement' || disposition.eligibleAsNextRevisionBase || disposition.adopted) {
    throw new AppError('CODEX_REJECTED_CANDIDATE_BASE_FORBIDDEN', 'Candidate v1 must remain rejected_no_improvement and ineligible as a revision base.', 2);
  }
  const storyState = StoryStateSchema.parse(JSON.parse(storyStateText));
  const queue = ChapterQueueSchema.parse(JSON.parse(queueText));
  ChapterMissionSchema.parse(JSON.parse(missionText));
  const queueItem = queue.chapters.find((chapter) => chapter.chapterNumber === chapterNumber);
  if (storyState.latestCommittedChapter !== chapterNumber - 1) staleReasons.push(`latestCommittedChapter is ${storyState.latestCommittedChapter}`);
  if (queueItem?.status !== 'needs_human_review' || queueItem.committedAt !== null) staleReasons.push('chapter queue status is not needs_human_review/uncommitted');
  if (adjudication.adjudication !== 'confirmed_true_positive' || adjudication.confidence !== 'high') staleReasons.push('source adjudication is not confirmed_true_positive/high');
  if (coverage.sourceDraftPath !== relativeChapterArtifact(chapterNumber, 'draft_v1.md')) staleReasons.push('source draft is not draft_v1.md');
  if (staleReasons.length > 0) throw staleSource(staleReasons);

  const paragraphs = parseMarkdownEvidenceParagraphs(sourceDraft);
  const initialTargets: ExpandedTargetRevisionAllowedTarget[] = coverage.initialTargets.map((target) => ({
    targetId: target.targetId,
    paragraphIndex: target.paragraphIndex,
    originalSnippet: target.snippet,
    originalSnippetHash: target.snippetHash,
    reason: target.reason,
    relatedClaimIds: target.linkedClaimIds,
    relatedContradictionIds: target.linkedContradictionIds,
    source: 'initial',
    requiredForClosure: false,
    allowedOperationTypes: /time/i.test(target.reason)
      ? ['replace_paragraph', 'merge_target_paragraphs']
      : ['replace_paragraph', 'delete_duplicate_paragraph', 'merge_target_paragraphs'],
    factsToPreserve: adjudication.revisionScopeRecommendation.factsToPreserve
  }));
  const expandedTargets: ExpandedTargetRevisionAllowedTarget[] = coverage.proposedAdditionalTargets.map((target) => ({
    targetId: target.targetId,
    paragraphIndex: target.paragraphIndex,
    originalSnippet: target.snippet,
    originalSnippetHash: target.snippetHash,
    reason: target.reason,
    relatedClaimIds: target.linkedClaimIds,
    relatedContradictionIds: target.linkedContradictionIds,
    source: 'expanded',
    requiredForClosure: target.requiredForClosure,
    allowedOperationTypes: target.allowedOperationTypes,
    factsToPreserve: target.factsToPreserve
  }));
  const allowedTargets = [...initialTargets, ...expandedTargets].sort((left, right) => left.paragraphIndex - right.paragraphIndex);
  const approvedEvidenceById = new Map(
    [...coverage.initialTargets, ...coverage.proposedAdditionalTargets].map((target) => [target.targetId, target])
  );
  for (const target of allowedTargets) {
    const paragraph = paragraphs[target.paragraphIndex - 1];
    const approvedEvidence = approvedEvidenceById.get(target.targetId);
    if (paragraph === undefined || approvedEvidence === undefined || !paragraph.text.includes(approvedEvidence.snippet) ||
      sha256(approvedEvidence.snippet) !== target.originalSnippetHash) {
      staleReasons.push(`approved target ${target.targetId} no longer matches source draft`);
    }
  }
  if (staleReasons.length > 0) throw staleSource(staleReasons);
  return {
    approval,
    approvalPath,
    approvalText,
    coverage,
    coveragePath: latestCoveragePath,
    coverageText,
    disposition,
    dispositionPath,
    dispositionText,
    adjudicationPath: coverage.sourceAdjudicationPath,
    sourceDraft,
    missionText,
    selectedPlanText,
    storyStateText,
    queueText,
    allowedTargets,
    fullApprovedTargetIds: allowedTargets.map((target) => target.targetId),
    factsToPreserve: [...new Set([...adjudication.revisionScopeRecommendation.factsToPreserve, ...expandedTargets.flatMap((target) => target.factsToPreserve)])],
    forbiddenChanges: adjudication.revisionScopeRecommendation.forbiddenChanges,
    expectedResolvedClaims: coverage.residualClaims.map((claim) => claim.normalizedClaim),
    expectedResolvedRules: [...new Set(coverage.residualClaims.flatMap((claim) => claim.relatedRules))]
  };
}

async function generateOperations(
  input: RunCodexExpandedTargetRevisionExperimentInput,
  fileStore: FileStore,
  provider: CodexTextProvider,
  source: ExpandedSource
): Promise<TargetedRevisionOperation[]> {
  const descriptor = resolveCodexOutputSchema(OPERATIONS_PROMPT_ID);
  if (descriptor === undefined) throw new AppError('OUTPUT_SCHEMA_NOT_FOUND', `No output schema registered for ${OPERATIONS_PROMPT_ID}.`, 2);
  const promptService = new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
  const user = await promptService.renderPrompt(OPERATIONS_PROMPT_ID, {
    CHAPTER_NUMBER: input.chapterNumber,
    OBJECTIVE: 'Resolve all approved residual same-delivery time and duplicate-sequence edges. Every requiredForClosure target must be handled.',
    ALLOWED_TARGETS: JSON.stringify(source.allowedTargets, null, 2),
    FACTS_TO_PRESERVE: JSON.stringify(source.factsToPreserve, null, 2),
    FORBIDDEN_CHANGES: JSON.stringify(source.forbiddenChanges, null, 2),
    EXPECTED_RESOLVED_RULES: JSON.stringify(source.expectedResolvedRules, null, 2)
  });
  const response = await provider.complete({
    promptId: OPERATIONS_PROMPT_ID,
    system: 'Novel Loop Engine expanded-target revision planner. Read only. Use the original draft only. Return operations, never a whole chapter or file edit.',
    user,
    responseFormat: 'json',
    metadata: { outputSchemaPath: descriptor.schemaPath, schemaName: descriptor.schemaName }
  });
  return TargetedRevisionProviderOutputSchema.parse(response.json).operations;
}

function buildOperationCoverage(
  targets: ExpandedTargetRevisionAllowedTarget[],
  operations: TargetedRevisionOperation[]
): TargetOperationCoverage[] {
  const approved = new Set(targets.map((target) => target.targetId));
  for (const operation of operations) {
    for (const targetId of operation.targetIds) {
      if (!approved.has(targetId)) throw new AppError('CODEX_TARGETED_REVISION_SCOPE_VIOLATION', `Operation ${operation.operationId} references unapproved target ${targetId}.`, 2);
    }
  }
  return targets.map((target) => {
    const matches = operations.filter((operation) => operation.targetIds.includes(target.targetId));
    const operation = matches[0];
    const disposition = operation === undefined
      ? 'preserved_with_justification' as const
      : operation.operationType === 'replace_paragraph'
        ? 'replaced' as const
        : operation.operationType === 'delete_duplicate_paragraph'
          ? 'deleted_as_duplicate' as const
          : 'merged_into_target' as const;
    return {
      targetId: target.targetId,
      paragraphIndex: target.paragraphIndex,
      requiredForClosure: target.requiredForClosure,
      operationIds: matches.map((item) => item.operationId),
      disposition,
      justification: operation === undefined
        ? 'Initial target remains unchanged because approved expanded endpoints close its residual evidence edge locally.'
        : operation.reason,
      coveredClaimIds: target.relatedClaimIds,
      coveredContradictionIds: target.relatedContradictionIds
    };
  });
}

function buildExpandedScope(
  paths: ProjectPaths,
  chapterNumber: number,
  artifacts: ExpandedArtifacts,
  generatedAt: string,
  source: ExpandedSource,
  plan: ExpandedTargetRevisionPlan,
  applied: ReturnType<typeof applyTargetedRevisionOperations>
): ExpandedTargetRevisionScopeValidation {
  const base = buildTargetedRevisionScopeValidation({
    projectId: paths.projectId,
    chapterNumber,
    version: artifacts.version,
    generatedAt,
    sourceDraftPath: source.coverage.sourceDraftPath,
    candidateDraftPath: artifacts.candidateDraftPath,
    sourceDraft: source.sourceDraft,
    applied,
    plan,
    planningText: `${source.missionText}\n${source.selectedPlanText}`
  });
  const candidateBlocks = parseMarkdownEvidenceParagraphs(applied.candidateText);
  const residualTimeReferences = candidateBlocks.filter((paragraph) => /(?:二十三点(?:十七|二十九)分|23[:：](?:17|29)|深夜|凌晨)/.test(paragraph.text)).map((paragraph) => ({
    paragraphIndex: paragraph.paragraphIndex,
    snippet: paragraph.text.slice(0, 600),
    ruleIds: ['same_event_same_day_explicit_time_conflict', 'mission_plan_time_mismatch']
  }));
  const residualDuplicateSequenceFragments = findResidualDuplicateFragments(candidateBlocks);
  const approvedSet = sorted(source.fullApprovedTargetIds);
  const planSet = sorted(plan.fullApprovedTargetIds);
  const fullApprovedTargetSetMatched = approvedSet.join('|') === planSet.join('|');
  const requiredTargetsHandled = plan.targetOperationCoverage.filter((target) => target.requiredForClosure)
    .every((target) => target.disposition !== 'preserved_with_justification' && target.operationIds.length > 0);
  const unauthorizedTimeChanges = applied.changes.filter((change) => /(?:二十三点|23[:：]|深夜|凌晨)/.test(change.afterText)).map((change) => `${change.targetId}: ${change.afterText.slice(0, 120)}`);
  const totalDeletedParagraphCount = applied.changes.filter((change) => change.paragraphIndexAfter === null).length;
  const totalMergedParagraphCount = applied.changes.filter((change) => change.operation.operationType === 'merge_target_paragraphs').length;
  const sourceWordCount = countTextUnits(source.sourceDraft);
  const candidateWordCount = countTextUnits(applied.candidateText);
  const changeRatio = round(new Set(applied.changes.map((change) => change.paragraphIndexBefore)).size / Math.max(1, applied.sourceBlocks.length));
  const coverageResolved = residualTimeReferences.length === 0 && residualDuplicateSequenceFragments.length === 0;
  const unauthorizedChanges = [
    ...base.unauthorizedChanges,
    ...(changeRatio > 0.6 ? [`Expanded revision change ratio ${changeRatio} exceeds the 0.6 isolation threshold.`] : [])
  ];
  const scopeValid = base.scopeValid && fullApprovedTargetSetMatched && requiredTargetsHandled && coverageResolved && unauthorizedTimeChanges.length === 0 && unauthorizedChanges.length === 0;
  return ExpandedTargetRevisionScopeValidationSchema.parse({
    ...base,
    reportId: `targeted_revision_scope_validation_ch${pad(chapterNumber)}_v${artifacts.version}`,
    revisionRound: 2,
    fullApprovedTargetSetMatched,
    requiredTargetsHandled,
    targetOperationCoverage: plan.targetOperationCoverage,
    residualTimeReferences,
    residualDuplicateSequenceFragments,
    unauthorizedTimeChanges,
    totalChangedParagraphCount: new Set(applied.changes.map((change) => change.paragraphIndexBefore)).size,
    totalDeletedParagraphCount,
    totalMergedParagraphCount,
    wordCountDelta: candidateWordCount - sourceWordCount,
    changeRatio,
    coverageResolved,
    unauthorizedChanges,
    scopeValid
  });
}

function findResidualDuplicateFragments(paragraphs: ReturnType<typeof parseMarkdownEvidenceParagraphs>) {
  const handoffs = paragraphs.filter((paragraph) => /(?:接过|递给|递过去|交给)[^。！？]{0,30}(?:餐|餐袋)|(?:餐|餐袋)[^。！？]{0,30}(?:接过|递给|递过去|交给)/.test(paragraph.text));
  const opening = paragraphs.filter((paragraph) => /(?:十六楼的门(?:又|再次)?开|十六楼的门开得|住户[^。！？]{0,12}(?:又|再次)开门)/.test(paragraph.text));
  const residual = [...handoffs.slice(1), ...opening.slice(1)];
  return [...new Map(residual.map((paragraph) => [paragraph.paragraphIndex, paragraph])).values()].map((paragraph) => ({
    paragraphIndex: paragraph.paragraphIndex,
    snippet: paragraph.text.slice(0, 600),
    ruleIds: ['duplicate_event_repetition']
  }));
}

async function runDiagnosticsAB(
  input: RunCodexExpandedTargetRevisionExperimentInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  provider: CodexTextProvider,
  runLogger: RunLogger,
  runId: string,
  source: ExpandedSource,
  artifacts: ExpandedArtifacts,
  candidateText: string,
  sampleCount: number
): Promise<ExpandedTargetRevisionDiagnosticsAB> {
  const context = await buildDiagnosticsContextManifest({
    projectId: paths.projectId,
    projectsRoot: paths.projectsRoot,
    chapterNumber: input.chapterNumber,
    mode: 'enhanced'
  }, fileStore);
  const descriptor = resolveCodexOutputSchema(DIAGNOSTICS_PROMPT_ID);
  if (descriptor === undefined) throw new AppError('OUTPUT_SCHEMA_NOT_FOUND', `No output schema registered for ${DIAGNOSTICS_PROMPT_ID}.`, 2);
  const promptService = new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
  const samples: TargetedRevisionDiagnosticsSample[] = [];
  for (let pairIndex = 1; pairIndex <= sampleCount; pairIndex += 1) {
    samples.push(await runDiagnosticsArm({
      paths, fileStore, provider, promptService, runLogger, runId, chapterNumber: input.chapterNumber,
      pairIndex, sequenceIndex: samples.length + 1, arm: 'baseline', armLabel: `A${pairIndex}`,
      draftPath: source.coverage.sourceDraftPath, draftText: source.sourceDraft, baseContext: context.promptContext,
      diagnosticsSchema: descriptor
    }));
    samples.push(await runDiagnosticsArm({
      paths, fileStore, provider, promptService, runLogger, runId, chapterNumber: input.chapterNumber,
      pairIndex, sequenceIndex: samples.length + 1, arm: 'candidate', armLabel: `B${pairIndex}`,
      draftPath: artifacts.candidateDraftPath, draftText: candidateText, baseContext: context.promptContext,
      diagnosticsSchema: descriptor
    }));
  }
  const baseline = samples.filter((sample) => sample.arm === 'baseline');
  const candidate = samples.filter((sample) => sample.arm === 'candidate');
  const baselineSummary = summarizeDiagnostics(baseline);
  const candidateSummary = summarizeDiagnostics(candidate);
  const manifest = await fileStore.readJson(paths.runManifest(runId), RunManifestV2Schema);
  const versions = [...new Set(manifest.promptCalls.map((call) => call.codexVersion).filter((value): value is string => value !== undefined))];
  const diagnosticsCalls = manifest.promptCalls.filter((call) => call.promptId === DIAGNOSTICS_PROMPT_ID);
  const environmentConsistent = versions.length <= 1 && diagnosticsCalls.length === sampleCount * 2 &&
    manifest.promptCalls.every((call) => call.provider === 'codex-text' && call.codexProfile === (input.codexProfile ?? 'clean')) &&
    diagnosticsCalls.every((call) => call.schemaName === descriptor.schemaName && call.outputSchemaPath === descriptor.schemaPath);
  const baselineValid = baseline.filter((sample) => sample.schemaValid);
  const candidateValid = candidate.filter((sample) => sample.schemaValid);
  const baselineSchemaValidRate = ratio(baselineValid.length, sampleCount);
  const candidateSchemaValidRate = ratio(candidateValid.length, sampleCount);
  const baselineMedian = median(baselineValid.map((sample) => sample.averageScore).filter((score): score is number => score !== null));
  const candidateMedian = median(candidateValid.map((sample) => sample.averageScore).filter((score): score is number => score !== null));
  const baselineFailures = failedChecks(baselineValid);
  const candidateFailures = failedChecks(candidateValid);
  const newlyIntroducedHardChecks = [...candidateFailures].filter((check) => !baselineFailures.has(check)).sort();
  const resolvedHardChecks = [...baselineFailures].filter((check) => !candidateFailures.has(check)).sort();
  return ExpandedTargetRevisionDiagnosticsABSchema.parse({
    reportId: `targeted_revision_diagnostics_ab_ch${pad(input.chapterNumber)}_v${artifacts.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    revisionRound: 2,
    runId,
    generatedAt: new Date().toISOString(),
    sourceDraftPath: source.coverage.sourceDraftPath,
    sourceDraftHash: sha256(source.sourceDraft),
    candidateDraftPath: artifacts.candidateDraftPath,
    candidateDraftHash: sha256(candidateText),
    sampleCountPerArm: sampleCount,
    executionOrder: Array.from({ length: sampleCount }, (_, index) => [`A${index + 1}`, `B${index + 1}`]).flat(),
    samples,
    baselineSummary,
    candidateSummary,
    provider: 'codex-text',
    codexProfile: input.codexProfile ?? 'clean',
    codexVersions: versions,
    diagnosticsPromptId: DIAGNOSTICS_PROMPT_ID,
    diagnosticsOutputSchemaPath: descriptor.schemaPath,
    sharedContextHash: sha256(replaceDraftContext(context.promptContext, source.coverage.sourceDraftPath, '<PAIRED_DRAFT_SLOT>')),
    storyStateHash: sha256(source.storyStateText),
    missionHash: sha256(source.missionText),
    selectedPlanHash: sha256(source.selectedPlanText),
    baselineSchemaValidRate,
    candidateSchemaValidRate,
    baselineTimelineFailureRate: ratio(baselineValid.filter((sample) => sample.timelineConsistencyPassed === false).length, baselineValid.length),
    candidateTimelineFailureRate: ratio(candidateValid.filter((sample) => sample.timelineConsistencyPassed === false).length, candidateValid.length),
    baselineAnyBlockingFailureRate: ratio(baselineValid.filter((sample) => sample.allHardChecksPassed === false).length, baselineValid.length),
    candidateAnyBlockingFailureRate: ratio(candidateValid.filter((sample) => sample.allHardChecksPassed === false).length, candidateValid.length),
    baselineAverageScoreMedian: baselineMedian,
    candidateAverageScoreMedian: candidateMedian,
    scoreDelta: baselineMedian === null || candidateMedian === null ? null : round(candidateMedian - baselineMedian),
    newlyIntroducedHardChecks,
    resolvedHardChecks,
    schemaInvalidSamplesExcludedFromHardFailDenominator: true,
    environmentConsistent,
    experimentValid: environmentConsistent && baselineSchemaValidRate >= 0.8 && candidateSchemaValidRate >= 0.8,
    independenceCaveat: 'Repeated A/B samples use the same Codex model and measure repeatability, not independent review.',
    storyStateMutated: false,
    queueMutated: false,
    canonicalDiagnosticsMutated: false
  });
}

function buildCandidateTimelineMap(
  paths: ProjectPaths,
  chapterNumber: number,
  artifacts: ExpandedArtifacts,
  generatedAt: string,
  source: ExpandedSource,
  scope: ExpandedTargetRevisionScopeValidation,
  candidateText: string
): CandidateTimelineContradictionMap {
  const contradictions = [
    ...(scope.residualTimeReferences.length === 0 ? [] : [{
      contradictionId: `candidate_time_conflict_ch${pad(chapterNumber)}_v${artifacts.version}`,
      ruleId: 'same_event_same_day_explicit_time_conflict' as const,
      paragraphIndexes: scope.residualTimeReferences.map((item) => item.paragraphIndex),
      evidence: scope.residualTimeReferences.map((item) => item.snippet),
      summary: 'Late explicit time remains attached to the mission-required daytime delivery.',
      confirmed: true
    }, {
      contradictionId: `candidate_mission_time_conflict_ch${pad(chapterNumber)}_v${artifacts.version}`,
      ruleId: 'mission_plan_time_mismatch' as const,
      paragraphIndexes: scope.residualTimeReferences.map((item) => item.paragraphIndex),
      evidence: scope.residualTimeReferences.map((item) => item.snippet),
      summary: 'Candidate time remains inconsistent with mission and selected plan.',
      confirmed: true
    }]),
    ...(scope.residualDuplicateSequenceFragments.length === 0 ? [] : [{
      contradictionId: `candidate_duplicate_delivery_ch${pad(chapterNumber)}_v${artifacts.version}`,
      ruleId: 'duplicate_event_repetition' as const,
      paragraphIndexes: scope.residualDuplicateSequenceFragments.map((item) => item.paragraphIndex),
      evidence: scope.residualDuplicateSequenceFragments.map((item) => item.snippet),
      summary: 'A second opening or delivery handoff remains in the candidate.',
      confirmed: true
    }])
  ];
  const necessaryCluesPreserved = /餐/.test(candidateText) && /(?:十七楼|失踪)/.test(candidateText);
  return CandidateTimelineContradictionMapSchema.parse({
    mapId: `candidate_timeline_contradiction_map_ch${pad(chapterNumber)}_v${artifacts.version}`,
    projectId: paths.projectId,
    chapterNumber,
    revisionRound: 2,
    generatedAt,
    sourceCandidatePath: artifacts.candidateDraftPath,
    sourceCandidateHash: sha256(candidateText),
    expectedResolvedClaims: source.expectedResolvedClaims,
    expectedResolvedRules: source.expectedResolvedRules,
    contradictions,
    residualTimeReferences: scope.residualTimeReferences,
    residualDuplicateSequenceFragments: scope.residualDuplicateSequenceFragments,
    necessaryCluesPreserved,
    coverageResolved: contradictions.length === 0 && necessaryCluesPreserved,
    storyStateMutated: false
  });
}

function buildCandidateAdjudication(
  paths: ProjectPaths,
  chapterNumber: number,
  artifacts: ExpandedArtifacts,
  generatedAt: string,
  diagnostics: ExpandedTargetRevisionDiagnosticsAB,
  timelineMap: CandidateTimelineContradictionMap
): CandidateRevisionEvidenceAdjudication {
  const checks = {
    middayVsLateExitResolved: timelineMap.residualTimeReferences.length === 0,
    duplicateDeliverySequenceResolved: timelineMap.residualDuplicateSequenceFragments.length === 0,
    missionPlanTimeMismatchResolved: timelineMap.residualTimeReferences.length === 0,
    late2329ReferenceResolved: timelineMap.residualTimeReferences.every((item) => !/(?:23[:：]29|二十三点二十九分)/.test(item.snippet)),
    secondOpeningSequenceResolved: timelineMap.residualDuplicateSequenceFragments.length === 0,
    noNewTimeContradiction: !timelineMap.contradictions.some((item) => item.ruleId === 'new_time_contradiction'),
    necessaryActionsAndCluesPreserved: timelineMap.necessaryCluesPreserved
  };
  const noRemaining = Object.values(checks).every(Boolean) && timelineMap.contradictions.length === 0;
  const adjudication = noRemaining ? 'no_remaining_contradiction' as const : 'confirmed_true_positive' as const;
  return CandidateRevisionEvidenceAdjudicationSchema.parse({
    reportId: `candidate_diagnostics_evidence_adjudication_ch${pad(chapterNumber)}_v${artifacts.version}`,
    projectId: paths.projectId,
    chapterNumber,
    revisionRound: 2,
    generatedAt,
    sourceCandidatePath: artifacts.candidateDraftPath,
    sourceCandidateHash: timelineMap.sourceCandidateHash,
    sourceDiagnosticsABPath: artifacts.diagnosticsABPath,
    candidateTimelineContradictionMapPath: artifacts.candidateTimelineMapPath,
    checks,
    remainingContradictions: timelineMap.contradictions,
    newlyIntroducedContradictions: [],
    adjudication,
    confidence: diagnostics.experimentValid ? 'high' : 'medium',
    recommendedNextStep: noRemaining ? 'Human-review candidate v2; do not adopt, preview, or commit automatically.' : 'Keep the original draft and require human review. Automatic revision round 3 is disabled.',
    storyStateMutated: false,
    queueMutated: false
  });
}

function buildQualityReport(
  paths: ProjectPaths,
  chapterNumber: number,
  artifacts: ExpandedArtifacts,
  generatedAt: string,
  source: ExpandedSource,
  scope: ExpandedTargetRevisionScopeValidation,
  diagnostics: ExpandedTargetRevisionDiagnosticsAB,
  candidateText: string
): ExpandedTargetRevisionQualityReport {
  const sourceBlocks = parseMarkdownParagraphBlocks(source.sourceDraft);
  const candidateBlocks = parseMarkdownParagraphBlocks(candidateText);
  const sourceTitle = sourceBlocks[0]?.text ?? '';
  const candidateTitle = candidateBlocks[0]?.text ?? '';
  const hasPlaceholder = /\{\{[^}]+\}\}|\b(?:TODO|TBD|PLACEHOLDER)\b|待补|占位符/i.test(candidateText);
  const duplicateParagraph = new Set(candidateBlocks.slice(1).map((block) => block.text.trim()).filter(Boolean)).size !== candidateBlocks.slice(1).map((block) => block.text.trim()).filter(Boolean).length;
  const checks = [
    qualityCheck('chapter_title_preserved', sourceTitle === candidateTitle, 'critical', 'Original chapter title must remain unchanged.'),
    qualityCheck('authorized_entities_only', scope.newEntities.length === 0 && scope.newOrders.length === 0 && scope.newRecipients.length === 0 && scope.newReveals.length === 0, 'critical', 'No unauthorized person, order, recipient, or reveal may be introduced.'),
    qualityCheck('protagonist_preserved', !/林澈/.test(source.sourceDraft) || /林澈/.test(candidateText), 'critical', 'The protagonist must remain in the candidate.'),
    qualityCheck('location_preserved', !/十六楼/.test(source.sourceDraft) || /十六楼/.test(candidateText), 'critical', 'The sixteenth-floor delivery location must remain.'),
    qualityCheck('order_preserved', !/餐/.test(source.sourceDraft) || /餐/.test(candidateText), 'critical', 'The existing delivery order must remain.'),
    qualityCheck('recipient_preserved', !/住户/.test(source.sourceDraft) || /住户/.test(candidateText), 'critical', 'The existing recipient must remain.'),
    qualityCheck('core_conflict_preserved', /(?:十七楼|失踪)/.test(candidateText), 'critical', 'The seventeenth-floor disappearance conflict must remain.'),
    qualityCheck('chapter_hook_preserved', /(?:十七楼|失踪|路线|杂音|收音机)/.test(candidateText), 'error', 'The chapter must retain its investigative hook.'),
    qualityCheck('no_placeholder', !hasPlaceholder, 'critical', 'Candidate must contain no placeholder text.'),
    qualityCheck('no_duplicate_delivery', scope.residualDuplicateSequenceFragments.length === 0, 'critical', 'Candidate must contain one delivery sequence.'),
    qualityCheck('time_consistent', scope.residualTimeReferences.length === 0, 'critical', 'Candidate delivery time must be internally consistent.'),
    qualityCheck('mission_plan_aligned', scope.missionTimeAligned, 'critical', 'Candidate must retain the mission and selected-plan daytime constraint.'),
    qualityCheck('non_target_facts_preserved', scope.nonTargetParagraphsUnchanged, 'critical', 'Every non-target paragraph must remain byte-for-byte unchanged.'),
    qualityCheck('no_new_hard_check', diagnostics.newlyIntroducedHardChecks.length === 0, 'critical', 'Candidate must not introduce a new blocking hard check.'),
    qualityCheck('prose_continuity', !duplicateParagraph && candidateBlocks.length >= 3, 'error', 'Candidate prose must remain continuous after local paragraph operations.')
  ];
  const scoreDelta = diagnostics.scoreDelta;
  const scoreRegressionWithinLimit = scoreDelta === null || scoreDelta >= -0.25;
  checks.push(qualityCheck('score_regression_limit', scoreRegressionWithinLimit, 'error', 'Candidate median score may not fall more than 0.25 below baseline.'));
  const criticalIssueCount = checks.filter((check) => !check.passed && check.severity === 'critical').length;
  const errorIssueCount = checks.filter((check) => !check.passed && check.severity === 'error').length;
  return ExpandedTargetRevisionQualityReportSchema.parse({
    reportId: `targeted_revision_quality_report_ch${pad(chapterNumber)}_v${artifacts.version}`,
    projectId: paths.projectId,
    chapterNumber,
    revisionRound: 2,
    generatedAt,
    sourceDraftPath: source.coverage.sourceDraftPath,
    candidateDraftPath: artifacts.candidateDraftPath,
    checks,
    criticalIssueCount,
    errorIssueCount,
    baselineMedianScore: diagnostics.baselineAverageScoreMedian,
    candidateMedianScore: diagnostics.candidateAverageScoreMedian,
    scoreDelta,
    scoreRegressionLimit: 0.25,
    scoreRegressionWithinLimit,
    qualityResult: criticalIssueCount > 0 || errorIssueCount > 0 ? 'fail' : 'pass',
    storyStateMutated: false,
    queueMutated: false
  });
}

function decideExperiment(
  scope: ExpandedTargetRevisionScopeValidation,
  diagnostics: ExpandedTargetRevisionDiagnosticsAB,
  adjudication: CandidateRevisionEvidenceAdjudication,
  quality: ExpandedTargetRevisionQualityReport
): ExpandedTargetRevisionExperimentReport['result'] {
  if (!scope.scopeValid) return 'scope_violation';
  if (!diagnostics.experimentValid) return 'experiment_inconclusive';
  if ((diagnostics.baselineTimelineFailureRate > 0 && diagnostics.baselineTimelineFailureRate < 1) ||
    (diagnostics.candidateTimelineFailureRate > 0 && diagnostics.candidateTimelineFailureRate < 1)) return 'experiment_inconclusive';
  if (diagnostics.newlyIntroducedHardChecks.length > 0 || quality.criticalIssueCount > 0 || !quality.scoreRegressionWithinLimit) return 'revision_introduced_regression';
  if (diagnostics.baselineSchemaValidRate >= 0.8 && diagnostics.candidateSchemaValidRate >= 0.8 &&
    diagnostics.baselineTimelineFailureRate >= 0.8 && diagnostics.candidateTimelineFailureRate <= 0.2 &&
    adjudication.adjudication === 'no_remaining_contradiction' && quality.criticalIssueCount === 0 && quality.scoreRegressionWithinLimit) {
    return 'revision_effective';
  }
  if (diagnostics.candidateTimelineFailureRate < diagnostics.baselineTimelineFailureRate) return 'revision_partially_effective';
  return 'revision_ineffective';
}

function buildDisposition(
  paths: ProjectPaths,
  chapterNumber: number,
  artifacts: ExpandedArtifacts,
  report: ExpandedTargetRevisionExperimentReport,
  candidateText: string
): ExpandedTargetRevisionCandidateDisposition {
  const result = report.result === 'revision_effective'
    ? 'accepted_for_preview_review' as const
    : report.result === 'experiment_inconclusive'
      ? 'inconclusive_requires_more_samples' as const
      : report.result === 'scope_violation'
        ? 'rejected_scope_violation' as const
        : report.result === 'revision_introduced_regression'
          ? 'rejected_quality_regression' as const
          : 'rejected_no_improvement' as const;
  return ExpandedTargetRevisionCandidateDispositionSchema.parse({
    dispositionId: `targeted_revision_candidate_disposition_ch${pad(chapterNumber)}_v${artifacts.version}`,
    projectId: paths.projectId,
    chapterNumber,
    revisionRound: 2,
    candidatePath: artifacts.candidateDraftPath,
    candidateHash: sha256(candidateText),
    scopeValidationPath: artifacts.scopePath,
    experimentReportPath: artifacts.reportPath,
    experimentReportHash: sha256(JSON.stringify(report, null, 2) + '\n'),
    result,
    adopted: false,
    committed: false,
    eligibleForPreviewReview: result === 'accepted_for_preview_review',
    requiresHumanReview: true,
    automaticFurtherRevisionAllowed: false,
    maxAutomaticRevisionRound: 2,
    reasons: [report.recommendation],
    recommendedNextStep: result === 'accepted_for_preview_review' ? 'preview_review' : result === 'inconclusive_requires_more_samples' ? 'collect_five_samples' : 'human_review',
    generatedAt: new Date().toISOString(),
    storyStateMutated: false,
    queueMutated: false
  });
}

function buildScopeViolationDisposition(
  paths: ProjectPaths,
  chapterNumber: number,
  artifacts: ExpandedArtifacts,
  scope: ExpandedTargetRevisionScopeValidation,
  candidateText: string
): ExpandedTargetRevisionCandidateDisposition {
  return ExpandedTargetRevisionCandidateDispositionSchema.parse({
    dispositionId: `targeted_revision_candidate_disposition_ch${pad(chapterNumber)}_v${artifacts.version}`,
    projectId: paths.projectId,
    chapterNumber,
    revisionRound: 2,
    candidatePath: artifacts.candidateDraftPath,
    candidateHash: sha256(candidateText),
    scopeValidationPath: artifacts.scopePath,
    experimentReportPath: null,
    experimentReportHash: null,
    result: 'rejected_scope_violation',
    adopted: false,
    committed: false,
    eligibleForPreviewReview: false,
    requiresHumanReview: true,
    automaticFurtherRevisionAllowed: false,
    maxAutomaticRevisionRound: 2,
    reasons: [`Scope rejected candidate v2: residual time references=${scope.residualTimeReferences.length}, residual duplicate fragments=${scope.residualDuplicateSequenceFragments.length}.`],
    recommendedNextStep: 'human_review',
    generatedAt: new Date().toISOString(),
    storyStateMutated: false,
    queueMutated: false
  });
}

async function captureProtectedArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, source: ExpandedSource): Promise<ProtectedArtifact[]> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  const canonical = entries.filter((name) => /^diagnostics_v\d+\.json$/.test(name) || name === 'final.md' || name === 'mission.json' || name === 'selected_plan.md' || /^canon_patch(?:_.*)?\.json$/.test(name) || /^commit_report(?:_.*)?\.json$/.test(name));
  const relativePaths = [...new Set([
    source.coverage.sourceDraftPath,
    relativeChapterArtifact(chapterNumber, 'mission.json'),
    relativeChapterArtifact(chapterNumber, 'selected_plan.md'),
    path.posix.join('state', 'story_state.json'),
    path.posix.join('planning', 'chapter_queue.json'),
    ...canonical.map((name) => relativeChapterArtifact(chapterNumber, name))
  ])];
  return Promise.all(relativePaths.map(async (relativePath) => {
    const content = await fileStore.readText(paths.projectArtifact(relativePath));
    return { path: relativePath, content, hash: sha256(content) };
  }));
}

async function verifyProtectedArtifacts(paths: ProjectPaths, fileStore: FileStore, before: ProtectedArtifact[]) {
  return Promise.all(before.map(async (artifact) => {
    const afterSha256 = sha256(await fileStore.readText(paths.projectArtifact(artifact.path)));
    if (afterSha256 !== artifact.hash) throw new Error(`expanded-target experiment modified protected artifact ${artifact.path}`);
    return { path: artifact.path, beforeSha256: artifact.hash, afterSha256, unchanged: true as const };
  }));
}

async function assertProtectedArtifactsStillUnchanged(paths: ProjectPaths, fileStore: FileStore, before: ProtectedArtifact[]): Promise<void> {
  for (const artifact of before) {
    if (await fileStore.readText(paths.projectArtifact(artifact.path)) !== artifact.content) {
      throw new Error(`expanded-target experiment modified protected artifact ${artifact.path}`);
    }
  }
}

async function allocateArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<ExpandedArtifacts> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  const pattern = /^(?:targeted_revision_plan|draft_targeted_revision_candidate|targeted_revision_scope_validation|targeted_revision_diff|targeted_revision_experiment)_v(\d+)\.(?:json|md)$/;
  const version = Math.max(0, ...entries.map((entry) => Number.parseInt(pattern.exec(entry)?.[1] ?? '0', 10))) + 1;
  const artifact = (name: string, extension: 'json' | 'md') => relativeChapterArtifact(chapterNumber, `${name}_v${version}.${extension}`);
  return {
    version,
    planPath: artifact('targeted_revision_plan', 'json'), planMarkdownPath: artifact('targeted_revision_plan', 'md'),
    candidateDraftPath: relativeChapterArtifact(chapterNumber, `draft_targeted_revision_candidate_v${version}.md`),
    scopePath: artifact('targeted_revision_scope_validation', 'json'), scopeMarkdownPath: artifact('targeted_revision_scope_validation', 'md'),
    diffPath: artifact('targeted_revision_diff', 'json'), diffMarkdownPath: artifact('targeted_revision_diff', 'md'),
    diagnosticsABPath: artifact('targeted_revision_diagnostics_ab', 'json'), diagnosticsABMarkdownPath: artifact('targeted_revision_diagnostics_ab', 'md'),
    candidateAdjudicationPath: artifact('candidate_diagnostics_evidence_adjudication', 'json'), candidateAdjudicationMarkdownPath: artifact('candidate_diagnostics_evidence_adjudication', 'md'),
    candidateTimelineMapPath: artifact('candidate_timeline_contradiction_map', 'json'), candidateTimelineMapMarkdownPath: artifact('candidate_timeline_contradiction_map', 'md'),
    qualityPath: artifact('targeted_revision_quality_report', 'json'), qualityMarkdownPath: artifact('targeted_revision_quality_report', 'md'),
    reportPath: artifact('targeted_revision_experiment', 'json'), reportMarkdownPath: artifact('targeted_revision_experiment', 'md'),
    dispositionPath: artifact('targeted_revision_candidate_disposition', 'json'), dispositionMarkdownPath: artifact('targeted_revision_candidate_disposition', 'md')
  };
}

async function recordRevisionArtifacts(runLogger: RunLogger, runId: string, source: ExpandedSource, artifacts: ExpandedArtifacts): Promise<void> {
  for (const sourcePath of [source.approvalPath, source.coveragePath, source.dispositionPath, source.adjudicationPath, source.coverage.sourceDraftPath]) {
    await runLogger.recordArtifact(runId, sourcePath, { action: 'reused', stage: 'revision', provenanceNote: 'Approved read-only source for expanded-target revision round 2.' });
  }
  for (const generated of [artifacts.planPath, artifacts.planMarkdownPath, artifacts.candidateDraftPath, artifacts.scopePath, artifacts.scopeMarkdownPath, artifacts.diffPath, artifacts.diffMarkdownPath]) {
    await runLogger.recordArtifact(runId, generated, { action: 'generated', stage: 'revision', sourcePaths: [source.approvalPath, source.coveragePath, source.coverage.sourceDraftPath] });
  }
}

async function recordOutcomeArtifacts(runLogger: RunLogger, runId: string, source: ExpandedSource, artifacts: ExpandedArtifacts): Promise<void> {
  for (const generated of [
    artifacts.diagnosticsABPath, artifacts.diagnosticsABMarkdownPath, artifacts.candidateTimelineMapPath, artifacts.candidateTimelineMapMarkdownPath,
    artifacts.candidateAdjudicationPath, artifacts.candidateAdjudicationMarkdownPath, artifacts.qualityPath, artifacts.qualityMarkdownPath,
    artifacts.reportPath, artifacts.reportMarkdownPath, artifacts.dispositionPath, artifacts.dispositionMarkdownPath
  ]) {
    await runLogger.recordArtifact(runId, generated, { action: 'generated', stage: 'diagnostics', sourcePaths: [source.approvalPath, artifacts.planPath, artifacts.candidateDraftPath] });
  }
}

function requireLatestPath(entries: string[], chapterNumber: number, baseName: string, errorCode: string): string {
  const pattern = new RegExp(`^${baseName}_v(\\d+)\\.json$`);
  const latest = entries.map((entry) => ({ entry, version: Number.parseInt(pattern.exec(entry)?.[1] ?? '0', 10) }))
    .filter((item) => item.version > 0).sort((left, right) => right.version - left.version)[0];
  if (latest === undefined) throw new AppError(errorCode, `Missing ${baseName}_vN.json.`, 2);
  return relativeChapterArtifact(chapterNumber, latest.entry);
}

function resolveSafeArtifactPath(paths: ProjectPaths, chapterNumber: number, requestedPath: string, filePattern: RegExp): string {
  const absolute = path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(paths.projectRoot, requestedPath);
  if (path.dirname(absolute) !== paths.chapterDir(chapterNumber) || !filePattern.test(path.basename(absolute))) {
    throw new AppError('CODEX_TARGET_EXPANSION_APPROVAL_STALE', `Unsafe or invalid approval path ${requestedPath}.`, 2);
  }
  return path.relative(paths.projectRoot, absolute).split(path.sep).join(path.posix.sep);
}

function staleSource(reasons: string[]): AppError {
  return new AppError('CODEX_REVISION_SOURCE_STALE', `Expanded-target revision source is stale: ${reasons.join('; ')}`, 2);
}

function failedChecks(samples: TargetedRevisionDiagnosticsSample[]): Set<string> {
  return new Set(samples.flatMap((sample) => Object.entries(sample.hardChecks).filter(([, check]) => !check.passed).map(([name]) => name)));
}

function qualityCheck(checkId: string, passed: boolean, severity: 'error' | 'critical', message: string) {
  return { checkId, passed, severity, message } as const;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle]! : round((ordered[middle - 1]! + ordered[middle]!) / 2);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function countTextUnits(value: string): number {
  return Array.from(value.replace(/\s+/g, '')).length;
}

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function pad(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.posix.join('chapters', `chapter_${pad(chapterNumber)}`, ...segments);
}

function recommendationFor(result: ExpandedTargetRevisionExperimentReport['result']): string {
  if (result === 'revision_effective') return 'Candidate v2 is eligible for explicit human preview review only; it remains unadopted and uncommitted.';
  if (result === 'experiment_inconclusive') return 'Collect five paired samples only under explicit human control; do not generate revision round 3.';
  if (result === 'revision_partially_effective') return 'Require human review; automatic target expansion and revision round 3 are disabled.';
  if (result === 'revision_introduced_regression') return 'Reject candidate v2 for quality or hard-check regression and keep the original draft.';
  if (result === 'scope_violation') return 'Reject candidate v2 because it violated the approved target scope.';
  if (result === 'approval_stale') return 'Refresh approval against unchanged sources before any new isolated experiment.';
  return 'Reject candidate v2 because it did not improve the confirmed contradiction; require human review.';
}

function renderPlan(plan: ExpandedTargetRevisionPlan): string {
  return `# Expanded Target Revision Plan: Chapter ${plan.chapterNumber}\n\nrevisionRound: 2\nsourceDraftPath: ${plan.sourceDraftPath}\nsourceCandidatePath: null\napprovalRecordPath: ${plan.approvalRecordPath}\ncoverageReportPath: ${plan.coverageReportPath}\n\n## Target Operation Coverage\n${plan.targetOperationCoverage.map((target) => `- ${target.targetId} (p${target.paragraphIndex}): ${target.disposition}; ${target.justification}`).join('\n')}\n`;
}

function renderScope(report: ExpandedTargetRevisionScopeValidation): string {
  return `# Expanded Target Scope Validation: Chapter ${report.chapterNumber}\n\nscopeValid: ${report.scopeValid}\ncoverageResolved: ${report.coverageResolved}\nfullApprovedTargetSetMatched: ${report.fullApprovedTargetSetMatched}\nrequiredTargetsHandled: ${report.requiredTargetsHandled}\nresidualTimeReferences: ${report.residualTimeReferences.length}\nresidualDuplicateSequenceFragments: ${report.residualDuplicateSequenceFragments.length}\nchangeRatio: ${report.changeRatio}\n`;
}

function renderDiff(diff: ReturnType<typeof buildTargetedRevisionDiff>): string {
  return `# Expanded Target Revision Diff: Chapter ${diff.chapterNumber}\n\n${diff.changes.map((change) => `## ${change.targetId}\n\nBefore: ${change.beforeSnippet || '(empty)'}\n\nAfter: ${change.afterSnippet || '(deleted)'}\n`).join('\n')}`;
}

function renderDiagnosticsAB(report: ExpandedTargetRevisionDiagnosticsAB): string {
  return `# Expanded Target Diagnostics A/B: Chapter ${report.chapterNumber}\n\nexecutionOrder: ${report.executionOrder.join(' -> ')}\nbaselineSchemaValidRate: ${report.baselineSchemaValidRate}\ncandidateSchemaValidRate: ${report.candidateSchemaValidRate}\nbaselineTimelineFailureRate: ${report.baselineTimelineFailureRate}\ncandidateTimelineFailureRate: ${report.candidateTimelineFailureRate}\nscoreDelta: ${report.scoreDelta ?? 'null'}\n`;
}

function renderTimelineMap(report: CandidateTimelineContradictionMap): string {
  return `# Candidate Timeline Contradiction Map: Chapter ${report.chapterNumber}\n\ncoverageResolved: ${report.coverageResolved}\ncontradictions: ${report.contradictions.length}\n${report.contradictions.map((item) => `- ${item.ruleId}: ${item.summary}`).join('\n')}\n`;
}

function renderAdjudication(report: CandidateRevisionEvidenceAdjudication): string {
  return `# Candidate Evidence Adjudication: Chapter ${report.chapterNumber}\n\nadjudication: ${report.adjudication}\nconfidence: ${report.confidence}\nremainingContradictions: ${report.remainingContradictions.length}\nrecommendedNextStep: ${report.recommendedNextStep}\n`;
}

function renderQuality(report: ExpandedTargetRevisionQualityReport): string {
  return `# Expanded Target Revision Quality: Chapter ${report.chapterNumber}\n\nqualityResult: ${report.qualityResult}\ncriticalIssueCount: ${report.criticalIssueCount}\nscoreDelta: ${report.scoreDelta ?? 'null'}\nscoreRegressionWithinLimit: ${report.scoreRegressionWithinLimit}\n${report.checks.map((check) => `- ${check.checkId}: ${check.passed ? 'pass' : 'fail'} (${check.severity})`).join('\n')}\n`;
}

function renderExperiment(report: ExpandedTargetRevisionExperimentReport): string {
  return `# Expanded Target Revision Experiment: Chapter ${report.chapterNumber}\n\nresult: ${report.result}\nrevisionRound: 2\ncandidateAdjudication: ${report.candidateAdjudication}\nscoreDelta: ${report.scoreDelta ?? 'null'}\ncandidateAdopted: false\nnormalPreviewStarted: false\ncommitStarted: false\n\n${report.recommendation}\n`;
}

function renderDisposition(report: ExpandedTargetRevisionCandidateDisposition): string {
  return `# Candidate v2 Disposition: Chapter ${report.chapterNumber}\n\nresult: ${report.result}\nadopted: false\ncommitted: false\neligibleForPreviewReview: ${report.eligibleForPreviewReview}\nautomaticFurtherRevisionAllowed: false\nrecommendedNextStep: ${report.recommendedNextStep}\n`;
}
