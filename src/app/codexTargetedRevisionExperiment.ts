import path from 'node:path';

import { RunLogger } from '../logging/RunLogger.js';
import { normalizeDiagnostics } from '../providers/codex/normalizers.js';
import { resolveCodexOutputSchema } from '../providers/codex/schemas.js';
import { CodexTextProvider } from '../providers/codexTextProvider.js';
import type { CodexProfile, LLMJsonResult } from '../providers/providerTypes.js';
import { PromptService } from '../prompts/PromptService.js';
import {
  ChapterMissionSchema,
  ChapterQueueSchema,
  CodexDiagnosticsEvidenceAdjudicationSchema,
  DiagnosticsReportSchema,
  RunManifestV2Schema,
  StoryStateSchema,
  TargetedRevisionDiagnosticsSampleSchema,
  TargetedRevisionDiffSchema,
  TargetedRevisionExperimentReportSchema,
  TargetedRevisionPlanSchema,
  TargetedRevisionProviderOutputSchema,
  TargetedRevisionScopeValidationSchema,
  TimelineContradictionMapSchema
} from '../schemas/index.js';
import type {
  CodexDiagnosticsEvidenceAdjudication,
  DiagnosticsContextMode,
  DiagnosticsReport,
  TargetedRevisionAllowedTarget,
  TargetedRevisionDiagnosticsSample,
  TargetedRevisionDiagnosticsSummary,
  TargetedRevisionDiff,
  TargetedRevisionExperimentReport,
  TargetedRevisionPlan,
  TargetedRevisionScopeValidation,
  TimelineContradictionMap
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';
import { buildDiagnosticsContextManifest } from './codexDiagnosticsContextBuilder.js';
import {
  parseMarkdownEvidenceParagraphs,
  sha256
} from './codexDiagnosticsEvidenceRules.js';
import {
  applyTargetedRevisionOperations,
  buildTargetedRevisionDiff,
  buildTargetedRevisionScopeValidation
} from './codexTargetedRevisionScope.js';

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DIAGNOSTICS_PROMPT_ID = 'diagnostics.diagnose_chapter_slim';
const OPERATIONS_PROMPT_ID = 'revision.targeted_revision_operations_slim';

export interface RunCodexTargetedRevisionExperimentInput {
  projectId: string;
  projectsRoot?: string;
  promptRoot?: string;
  chapterNumber: number;
  adjudication?: string;
  samples?: number;
  contextMode?: DiagnosticsContextMode;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
}

export interface RunCodexTargetedRevisionExperimentResult {
  runId: string;
  plan: TargetedRevisionPlan;
  planPath: string;
  planMarkdownPath: string;
  candidateDraftPath: string;
  scopeValidation: TargetedRevisionScopeValidation;
  scopeValidationPath: string;
  scopeValidationMarkdownPath: string;
  diff: TargetedRevisionDiff;
  diffPath: string;
  diffMarkdownPath: string;
  report: TargetedRevisionExperimentReport;
  reportPath: string;
  reportMarkdownPath: string;
}

interface FreshSource {
  adjudication: CodexDiagnosticsEvidenceAdjudication;
  adjudicationPath: string;
  timelineMap: TimelineContradictionMap;
  sourceDraft: string;
  missionText: string;
  selectedPlanText: string;
  storyStateText: string;
  queueText: string;
  allowedTargets: TargetedRevisionAllowedTarget[];
}

interface ArtifactSet {
  version: number;
  planPath: string;
  planMarkdownPath: string;
  candidateDraftPath: string;
  scopePath: string;
  scopeMarkdownPath: string;
  diffPath: string;
  diffMarkdownPath: string;
  reportPath: string;
  reportMarkdownPath: string;
}

interface ProtectedArtifact {
  path: string;
  content: string;
  hash: string;
}

export async function runCodexTargetedRevisionExperiment(
  input: RunCodexTargetedRevisionExperimentInput,
  fileStore = new FileStore()
): Promise<RunCodexTargetedRevisionExperimentResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const chapterNumber = input.chapterNumber;
  const sampleCount = Math.max(1, input.samples ?? 3);
  if ((input.contextMode ?? 'enhanced') !== 'enhanced') {
    throw new AppError('INVALID_DIAGNOSTICS_CONTEXT_MODE', 'targeted-revision-experiment requires context-mode enhanced', 2);
  }
  const source = await loadFreshSource(paths, fileStore, chapterNumber, input.adjudication ?? 'latest');
  const protectedBefore = await captureProtectedArtifacts(paths, fileStore, chapterNumber, source);
  const artifacts = await allocateArtifacts(paths, fileStore, chapterNumber);
  const runId = createRunId(new Date(), `codex_targeted_revision_experiment_ch${pad(chapterNumber)}`);
  const runLogger = new RunLogger(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex targeted-revision-experiment',
    args: {
      provider: 'codex-text',
      chapterNumber,
      sourceAdjudicationPath: source.adjudicationPath,
      samples: sampleCount,
      contextMode: 'enhanced',
      codexProfile: input.codexProfile ?? 'clean',
      storyStateCommitAllowed: false,
      normalPreviewAllowed: false,
      candidateAdoptionAllowed: false,
      queueMutationAllowed: false
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
    const operations = await generateOperations(input, paths, fileStore, provider, source);
    const plan = buildPlan(paths, chapterNumber, artifacts.version, generatedAt, source, operations);
    const planValidation = TargetedRevisionPlanSchema.safeParse(plan);
    if (!planValidation.success) {
      throw new AppError('CODEX_TARGETED_REVISION_SCOPE_VIOLATION', planValidation.error.issues.map((issue) => issue.message).join('; '), 2);
    }
    await fileStore.writeJson(paths.projectArtifact(artifacts.planPath), planValidation.data, TargetedRevisionPlanSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.planMarkdownPath), renderPlanMarkdown(planValidation.data));

    const applied = applyTargetedRevisionOperations(source.sourceDraft, planValidation.data);
    await fileStore.writeText(paths.projectArtifact(artifacts.candidateDraftPath), applied.candidateText);
    const scopeValidation = buildTargetedRevisionScopeValidation({
      projectId: paths.projectId,
      chapterNumber,
      version: artifacts.version,
      generatedAt,
      sourceDraftPath: source.adjudication.sourceDraftPath,
      candidateDraftPath: artifacts.candidateDraftPath,
      sourceDraft: source.sourceDraft,
      applied,
      plan: planValidation.data,
      planningText: `${source.missionText}\n${source.selectedPlanText}`
    });
    const diff = buildTargetedRevisionDiff({
      projectId: paths.projectId,
      chapterNumber,
      version: artifacts.version,
      generatedAt,
      sourceDraftPath: source.adjudication.sourceDraftPath,
      candidateDraftPath: artifacts.candidateDraftPath,
      changes: applied.changes
    });
    await fileStore.writeJson(paths.projectArtifact(artifacts.scopePath), scopeValidation, TargetedRevisionScopeValidationSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.scopeMarkdownPath), renderScopeMarkdown(scopeValidation));
    await fileStore.writeJson(paths.projectArtifact(artifacts.diffPath), diff, TargetedRevisionDiffSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.diffMarkdownPath), renderDiffMarkdown(diff));
    await recordCoreArtifacts(runLogger, runId, source, artifacts);
    if (!scopeValidation.scopeValid) {
      throw new AppError('CODEX_TARGETED_REVISION_SCOPE_VIOLATION', `Targeted candidate failed scope validation: ${scopeValidation.unauthorizedChanges.join('; ') || 'new content detected'}`, 2);
    }

    const context = await buildDiagnosticsContextManifest({
      projectId: paths.projectId,
      projectsRoot: paths.projectsRoot,
      chapterNumber,
      mode: 'enhanced'
    }, fileStore);
    const sharedContext = replaceDraftContext(context.promptContext, source.adjudication.sourceDraftPath, '<PAIRED_DRAFT_SLOT>');
    const diagnosticsSchema = resolveCodexOutputSchema(DIAGNOSTICS_PROMPT_ID);
    if (diagnosticsSchema === undefined) throw new AppError('OUTPUT_SCHEMA_NOT_FOUND', `No output schema registered for ${DIAGNOSTICS_PROMPT_ID}`, 2);
    const promptService = new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
    const samples: TargetedRevisionDiagnosticsSample[] = [];
    for (let pairIndex = 1; pairIndex <= sampleCount; pairIndex += 1) {
      samples.push(await runDiagnosticsArm({
        paths,
        fileStore,
        provider,
        promptService,
        runLogger,
        runId,
        chapterNumber,
        pairIndex,
        sequenceIndex: samples.length + 1,
        arm: 'baseline',
        armLabel: `A${pairIndex}`,
        draftPath: source.adjudication.sourceDraftPath,
        draftText: source.sourceDraft,
        baseContext: context.promptContext,
        diagnosticsSchema
      }));
      samples.push(await runDiagnosticsArm({
        paths,
        fileStore,
        provider,
        promptService,
        runLogger,
        runId,
        chapterNumber,
        pairIndex,
        sequenceIndex: samples.length + 1,
        arm: 'candidate',
        armLabel: `B${pairIndex}`,
        draftPath: artifacts.candidateDraftPath,
        draftText: applied.candidateText,
        baseContext: context.promptContext,
        diagnosticsSchema
      }));
    }

    const baselineSummary = summarizeDiagnostics(samples.filter((sample) => sample.arm === 'baseline'));
    const candidateSummary = summarizeDiagnostics(samples.filter((sample) => sample.arm === 'candidate'));
    const pairedComparisons = buildPairedComparisons(samples, sampleCount);
    const promptCalls = (await fileStore.readJson(paths.runManifest(runId), RunManifestV2Schema)).promptCalls;
    const codexVersions = [...new Set(promptCalls.map((call) => call.codexVersion).filter((value): value is string => value !== undefined && value.length > 0))];
    const environmentConsistent = codexVersions.length <= 1 && promptCalls.every((call) => call.provider === 'codex-text' && call.codexProfile === (input.codexProfile ?? 'clean'));
    const result = classifyExperimentResult(baselineSummary, candidateSummary, environmentConsistent);
    const protectedArtifacts = await verifyProtectedArtifacts(paths, fileStore, protectedBefore);
    const report = TargetedRevisionExperimentReportSchema.parse({
      reportId: `targeted_revision_experiment_ch${pad(chapterNumber)}_v${artifacts.version}`,
      projectId: paths.projectId,
      chapterNumber,
      runId,
      generatedAt: new Date().toISOString(),
      sourceAdjudicationPath: source.adjudicationPath,
      targetedRevisionPlanPath: artifacts.planPath,
      candidateDraftPath: artifacts.candidateDraftPath,
      scopeValidationPath: artifacts.scopePath,
      revisionDiffPath: artifacts.diffPath,
      sourceDraftPath: source.adjudication.sourceDraftPath,
      sampleCountPerArm: sampleCount,
      executionOrder: Array.from({ length: sampleCount }, (_, index) => [`A${index + 1}`, `B${index + 1}`]).flat(),
      contextMode: 'enhanced',
      provider: 'codex-text',
      codexProfile: input.codexProfile ?? 'clean',
      codexVersion: codexVersions[0] ?? 'unknown',
      environmentConsistent,
      diagnosticsPromptId: DIAGNOSTICS_PROMPT_ID,
      diagnosticsOutputSchemaPath: diagnosticsSchema.schemaPath,
      sharedContextHash: sha256(sharedContext),
      storyStateHash: sha256(source.storyStateText),
      missionHash: sha256(source.missionText),
      selectedPlanHash: sha256(source.selectedPlanText),
      samples,
      baselineSummary,
      candidateSummary,
      pairedComparisons,
      result,
      recommendation: recommendationFor(result),
      independenceCaveat: 'A/B samples use the same Codex model and context configuration. Repetition measures stability and does not represent independent review.',
      protectedArtifacts,
      candidateAdopted: false,
      normalPreviewStarted: false,
      commitStarted: false,
      storyStateMutated: false,
      queueMutated: false,
      originalDraftMutated: false,
      canonicalDiagnosticsMutated: false
    });
    await fileStore.writeJson(paths.projectArtifact(artifacts.reportPath), report, TargetedRevisionExperimentReportSchema);
    await fileStore.writeText(paths.projectArtifact(artifacts.reportMarkdownPath), renderExperimentMarkdown(report));
    await runLogger.recordArtifact(runId, context.manifestPath, { action: 'generated', stage: 'diagnostics' });
    await runLogger.recordArtifact(runId, artifacts.reportPath, { action: 'generated', stage: 'diagnostics', sourcePaths: [artifacts.planPath, artifacts.scopePath, artifacts.diffPath] });
    await runLogger.recordArtifact(runId, artifacts.reportMarkdownPath, { action: 'generated', stage: 'diagnostics', sourcePaths: [artifacts.reportPath] });
    await assertProtectedArtifactsStillUnchanged(paths, fileStore, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return {
      runId,
      plan: planValidation.data,
      planPath: artifacts.planPath,
      planMarkdownPath: artifacts.planMarkdownPath,
      candidateDraftPath: artifacts.candidateDraftPath,
      scopeValidation,
      scopeValidationPath: artifacts.scopePath,
      scopeValidationMarkdownPath: artifacts.scopeMarkdownPath,
      diff,
      diffPath: artifacts.diffPath,
      diffMarkdownPath: artifacts.diffMarkdownPath,
      report,
      reportPath: artifacts.reportPath,
      reportMarkdownPath: artifacts.reportMarkdownPath
    };
  } catch (error) {
    await assertProtectedArtifactsStillUnchanged(paths, fileStore, protectedBefore);
    await runLogger.recordError(runId, {
      code: error instanceof AppError ? error.code : 'CODEX_TARGETED_REVISION_EXPERIMENT_FAILED',
      message: getErrorMessage(error),
      recoverable: true
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

async function loadFreshSource(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, requestedPath: string): Promise<FreshSource> {
  const adjudicationPath = requestedPath === 'latest'
    ? await requireLatestChapterArtifact(paths, fileStore, chapterNumber, 'codex_diagnostics_evidence_adjudication')
    : resolveSafeProjectPath(paths, requestedPath, chapterNumber);
  const adjudication = await fileStore.readJson(paths.projectArtifact(adjudicationPath), CodexDiagnosticsEvidenceAdjudicationSchema);
  const staleReasons: string[] = [];
  if (adjudication.adjudication !== 'confirmed_true_positive') staleReasons.push('adjudication is not confirmed_true_positive');
  if (adjudication.confidence !== 'high') staleReasons.push('adjudication confidence is not high');
  for (const sourcePath of [
    adjudication.sourceDraftPath,
    adjudication.sourceMissionPath,
    adjudication.sourceSelectedPlanPath,
    adjudication.sourceStoryStatePath,
    adjudication.sourceDiagnosticsBenchmarkPath,
    adjudication.sourceSchemaBenchmarkPath,
    adjudication.timelineContradictionMapPath
  ]) {
    if (!(await fileStore.exists(paths.projectArtifact(sourcePath)))) staleReasons.push(`missing source ${sourcePath}`);
  }
  if (staleReasons.length > 0) throw staleSource(staleReasons);
  const [sourceDraft, missionText, selectedPlanText, storyStateText, queueText, timelineMap] = await Promise.all([
    fileStore.readText(paths.projectArtifact(adjudication.sourceDraftPath)),
    fileStore.readText(paths.projectArtifact(adjudication.sourceMissionPath)),
    fileStore.readText(paths.projectArtifact(adjudication.sourceSelectedPlanPath)),
    fileStore.readText(paths.storyState()),
    fileStore.readText(paths.chapterQueue()),
    fileStore.readJson(paths.projectArtifact(adjudication.timelineContradictionMapPath), TimelineContradictionMapSchema)
  ]);
  const storyState = StoryStateSchema.parse(JSON.parse(storyStateText));
  const queue = ChapterQueueSchema.parse(JSON.parse(queueText));
  ChapterMissionSchema.parse(JSON.parse(missionText));
  const queueItem = queue.chapters.find((item) => item.chapterNumber === chapterNumber);
  if (storyState.latestCommittedChapter !== chapterNumber - 1) staleReasons.push(`latestCommittedChapter is ${storyState.latestCommittedChapter}, expected ${chapterNumber - 1}`);
  if (queueItem === undefined) staleReasons.push('chapter queue item is missing');
  if (queueItem?.status === 'committed' || queueItem?.status === 'recommitted' || queueItem?.committedAt !== null) staleReasons.push('chapter is already committed');
  const recordedDraft = adjudication.protectedArtifacts.find((artifact) => artifact.path === adjudication.sourceDraftPath);
  if (recordedDraft === undefined || recordedDraft.afterSha256 !== sha256(sourceDraft)) staleReasons.push('source draft hash does not match adjudication');
  const sourceDiagnostics = adjudication.protectedArtifacts.filter((artifact) => /^chapters\/chapter_\d{3}\/diagnostics_v\d+\.json$/.test(artifact.path));
  if (sourceDiagnostics.length === 0) staleReasons.push('adjudication does not identify source diagnostics');
  for (const diagnostics of sourceDiagnostics) {
    if (!(await fileStore.exists(paths.projectArtifact(diagnostics.path)))) staleReasons.push(`missing source diagnostics ${diagnostics.path}`);
  }
  const paragraphs = parseMarkdownEvidenceParagraphs(sourceDraft);
  const affected = adjudication.revisionScopeRecommendation.affectedParagraphs;
  const allowedTargets: TargetedRevisionAllowedTarget[] = [];
  for (const paragraphIndex of affected) {
    const paragraph = paragraphs[paragraphIndex - 1];
    const evidence = adjudication.draftEvidence.filter((item) => item.paragraphIndex === paragraphIndex);
    if (paragraph === undefined || evidence.length === 0 || evidence.some((item) => !paragraph.text.includes(item.snippet) || sha256(item.snippet) !== item.normalizedSnippetHash)) {
      staleReasons.push(`paragraph ${paragraphIndex} evidence hash does not match source draft`);
      continue;
    }
    const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
    const relatedClaims = adjudication.evidenceClaims.filter((claim) =>
      evidence.some((item) => claimMatchesEvidence(claim.normalizedClaim, item.eventDescription, item.explicitTime, item.inferredTime))
    ).map((claim) => claim.claimId);
    const relatedContradictions = timelineMap.contradictions.filter((contradiction) => contradiction.evidenceIds.some((evidenceId) => evidenceIds.has(evidenceId))).map((contradiction) => contradiction.contradictionId);
    allowedTargets.push({
      targetId: `target_p${String(paragraphIndex).padStart(3, '0')}`,
      paragraphIndex,
      originalSnippetHash: evidence[0]!.normalizedSnippetHash,
      reason: evidence.map((item) => item.eventDescription).join(', '),
      relatedClaimIds: relatedClaims,
      relatedContradictionIds: relatedContradictions
    });
  }
  if (staleReasons.length > 0) throw staleSource(staleReasons);
  return { adjudication, adjudicationPath, timelineMap, sourceDraft, missionText, selectedPlanText, storyStateText, queueText, allowedTargets };
}

async function generateOperations(
  input: RunCodexTargetedRevisionExperimentInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  provider: CodexTextProvider,
  source: FreshSource
) {
  const outputSchema = resolveCodexOutputSchema(OPERATIONS_PROMPT_ID);
  if (outputSchema === undefined) throw new AppError('OUTPUT_SCHEMA_NOT_FOUND', `No output schema registered for ${OPERATIONS_PROMPT_ID}`, 2);
  const promptService = new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
  const user = await promptService.renderPrompt(OPERATIONS_PROMPT_ID, {
    CHAPTER_NUMBER: input.chapterNumber,
    OBJECTIVE: source.adjudication.revisionScopeRecommendation.minimalRevisionScope,
    ALLOWED_TARGETS: JSON.stringify(source.allowedTargets, null, 2),
    FACTS_TO_PRESERVE: JSON.stringify(source.adjudication.revisionScopeRecommendation.factsToPreserve, null, 2),
    FORBIDDEN_CHANGES: JSON.stringify(source.adjudication.revisionScopeRecommendation.forbiddenChanges, null, 2),
    EXPECTED_RESOLVED_RULES: JSON.stringify(source.adjudication.temporalRulesTriggered.filter((rule) => rule.outcome === 'confirmed_contradiction').map((rule) => rule.ruleId), null, 2)
  });
  const response = await provider.complete({
    promptId: OPERATIONS_PROMPT_ID,
    system: 'Novel Loop Engine targeted revision planner. Read only. Return operations only; do not rewrite the chapter or edit files.',
    user,
    responseFormat: 'json',
    metadata: { outputSchemaPath: outputSchema.schemaPath, schemaName: outputSchema.schemaName }
  });
  return TargetedRevisionProviderOutputSchema.parse(response.json).operations;
}

function buildPlan(
  paths: ProjectPaths,
  chapterNumber: number,
  version: number,
  generatedAt: string,
  source: FreshSource,
  operations: ReturnType<typeof TargetedRevisionProviderOutputSchema.parse>['operations']
): TargetedRevisionPlan {
  return {
    planId: `targeted_revision_plan_ch${pad(chapterNumber)}_v${version}`,
    projectId: paths.projectId,
    chapterNumber,
    sourceAdjudicationPath: source.adjudicationPath,
    sourceDraftPath: source.adjudication.sourceDraftPath,
    sourceDraftHash: sha256(source.sourceDraft),
    generatedAt,
    objective: source.adjudication.revisionScopeRecommendation.minimalRevisionScope,
    allowedTargets: source.allowedTargets,
    operations,
    factsToPreserve: source.adjudication.revisionScopeRecommendation.factsToPreserve,
    forbiddenChanges: source.adjudication.revisionScopeRecommendation.forbiddenChanges,
    expectedResolvedRules: [...new Set(source.adjudication.temporalRulesTriggered.filter((rule) => rule.outcome === 'confirmed_contradiction').map((rule) => rule.ruleId))],
    storyStateMutated: false
  };
}

async function runDiagnosticsArm(input: {
  paths: ProjectPaths;
  fileStore: FileStore;
  provider: CodexTextProvider;
  promptService: PromptService;
  runLogger: RunLogger;
  runId: string;
  chapterNumber: number;
  pairIndex: number;
  sequenceIndex: number;
  arm: 'baseline' | 'candidate';
  armLabel: string;
  draftPath: string;
  draftText: string;
  baseContext: string;
  diagnosticsSchema: { schemaPath: string; schemaName: string };
}): Promise<TargetedRevisionDiagnosticsSample> {
  const startedAt = Date.now();
  let diagnostics: DiagnosticsReport | undefined;
  let requestId = '';
  let errorMessage: string | null = null;
  try {
    const promptContext = replaceDraftContext(input.baseContext, input.draftPath, input.draftText);
    const rendered = await input.promptService.renderPrompt(DIAGNOSTICS_PROMPT_ID, {
      CHAPTER_NUMBER: input.chapterNumber,
      DRAFT_VERSION: `targeted-${input.armLabel}`,
      DRAFT_SUMMARY: summarizeText(input.draftText),
      DIAGNOSTICS_CONTEXT: promptContext
    });
    const response = await input.provider.complete({
      promptId: DIAGNOSTICS_PROMPT_ID,
      system: 'Novel Loop Engine paired diagnostics experiment. Read only; do not edit files or lower hard checks.',
      user: `EXPERIMENT_ARM: ${input.armLabel}\nEXPERIMENT_DRAFT_PATH: ${input.draftPath}\n\n${rendered}`,
      responseFormat: 'json',
      metadata: { outputSchemaPath: input.diagnosticsSchema.schemaPath, schemaName: input.diagnosticsSchema.schemaName }
    });
    const raw = response.raw as LLMJsonResult;
    requestId = raw.requestId ?? '';
    diagnostics = DiagnosticsReportSchema.parse(normalizeDiagnostics(raw.parsed, { projectId: input.paths.projectId, chapterNumber: input.chapterNumber }));
  } catch (error) {
    errorMessage = getErrorMessage(error);
  }
  const manifest = await input.fileStore.readJson(input.paths.runManifest(input.runId), RunManifestV2Schema);
  const call = requestId.length === 0 ? manifest.promptCalls.at(-1) : manifest.promptCalls.find((candidate) => candidate.requestId === requestId);
  const hardChecks = diagnostics?.hard_checks ?? {};
  const values = diagnostics === undefined ? [] : Object.values(diagnostics.soft_scores);
  return TargetedRevisionDiagnosticsSampleSchema.parse({
    sampleId: `targeted_revision_${input.armLabel.toLowerCase()}`,
    pairIndex: input.pairIndex,
    arm: input.arm,
    sequenceIndex: input.sequenceIndex,
    runId: requestId || input.runId,
    promptCallId: call?.promptCallId ?? `missing_prompt_call_${input.sequenceIndex}`,
    durationMs: Math.max(0, Date.now() - startedAt),
    draftPath: input.draftPath,
    draftHash: sha256(input.draftText),
    schemaValid: diagnostics !== undefined,
    timelineConsistencyPassed: diagnostics?.hard_checks.timeline_consistency.passed ?? null,
    allHardChecksPassed: diagnostics === undefined ? null : Object.values(diagnostics.hard_checks).every((check) => check.passed),
    hardChecks,
    averageScore: values.length === 0 ? null : round(values.reduce((sum, value) => sum + value, 0) / values.length),
    retryCount: call?.retryCount ?? 0,
    repairCount: call?.finishReason === 'repaired' ? 1 : 0,
    rawOutputPath: call?.rawOutputPath ?? '',
    finalOutputPath: call?.finalOutputPath ?? '',
    parsedOutputPath: call?.parsedOutputPath ?? '',
    error: errorMessage,
    storyStateMutated: false
  });
}

function summarizeDiagnostics(samples: TargetedRevisionDiagnosticsSample[]): TargetedRevisionDiagnosticsSummary {
  const valid = samples.filter((sample) => sample.schemaValid);
  const scores = valid.map((sample) => sample.averageScore).filter((score): score is number => score !== null);
  const timelinePassCount = valid.filter((sample) => sample.timelineConsistencyPassed === true).length;
  const timelineFailCount = valid.filter((sample) => sample.timelineConsistencyPassed === false).length;
  const allPassCount = valid.filter((sample) => sample.allHardChecksPassed === true).length;
  return {
    sampleCount: samples.length,
    schemaValidCount: valid.length,
    timelinePassCount,
    timelineFailCount,
    timelinePassRateAmongSchemaValid: valid.length === 0 ? null : rate(timelinePassCount, valid.length),
    allHardChecksPassCount: allPassCount,
    allHardChecksPassRateAmongSchemaValid: valid.length === 0 ? null : rate(allPassCount, valid.length),
    averageScoreMean: scores.length === 0 ? null : round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    retryCount: samples.reduce((sum, sample) => sum + sample.retryCount, 0),
    repairCount: samples.reduce((sum, sample) => sum + sample.repairCount, 0)
  };
}

function buildPairedComparisons(samples: TargetedRevisionDiagnosticsSample[], sampleCount: number) {
  return Array.from({ length: sampleCount }, (_, index) => {
    const pairIndex = index + 1;
    const baseline = samples.find((sample) => sample.pairIndex === pairIndex && sample.arm === 'baseline')!;
    const candidate = samples.find((sample) => sample.pairIndex === pairIndex && sample.arm === 'candidate')!;
    let timelineOutcome: 'improved' | 'regressed' | 'unchanged_pass' | 'unchanged_fail' | 'inconclusive';
    if (!baseline.schemaValid || !candidate.schemaValid || baseline.timelineConsistencyPassed === null || candidate.timelineConsistencyPassed === null) timelineOutcome = 'inconclusive';
    else if (!baseline.timelineConsistencyPassed && candidate.timelineConsistencyPassed) timelineOutcome = 'improved';
    else if (baseline.timelineConsistencyPassed && !candidate.timelineConsistencyPassed) timelineOutcome = 'regressed';
    else timelineOutcome = baseline.timelineConsistencyPassed ? 'unchanged_pass' : 'unchanged_fail';
    return {
      pairIndex,
      baselineSampleId: baseline.sampleId,
      candidateSampleId: candidate.sampleId,
      timelineOutcome,
      scoreDelta: baseline.averageScore === null || candidate.averageScore === null ? null : round(candidate.averageScore - baseline.averageScore)
    };
  });
}

function classifyExperimentResult(
  baseline: TargetedRevisionDiagnosticsSummary,
  candidate: TargetedRevisionDiagnosticsSummary,
  environmentConsistent: boolean
): TargetedRevisionExperimentReport['result'] {
  if (!environmentConsistent || baseline.schemaValidCount === 0 || candidate.schemaValidCount === 0) return 'inconclusive';
  const before = baseline.timelinePassRateAmongSchemaValid ?? 0;
  const after = candidate.timelinePassRateAmongSchemaValid ?? 0;
  if (before < 1 && after === 1) return 'candidate_clears_timeline_failure';
  if (after > before) return 'candidate_improves_but_not_clear';
  if (after < before) return 'regression';
  return 'no_improvement';
}

function recommendationFor(result: TargetedRevisionExperimentReport['result']): string {
  if (result === 'candidate_clears_timeline_failure') return 'Send the isolated candidate and diff to human review. Do not adopt, preview, or commit automatically.';
  if (result === 'candidate_improves_but_not_clear') return 'Collect five paired samples or refine only the adjudicated operations; keep the candidate isolated.';
  if (result === 'regression') return 'Reject the candidate and retain the original draft unchanged.';
  if (result === 'no_improvement') return 'Keep the original draft and review whether the adjudicated target set is sufficient.';
  return 'Do not interpret the candidate until paired schema-valid samples use one consistent environment.';
}

async function captureProtectedArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, source: FreshSource): Promise<ProtectedArtifact[]> {
  const chapterEntries = await fileStore.list(paths.chapterDir(chapterNumber));
  const optionalCanonical = chapterEntries.filter((name) => /^diagnostics_v\d+\.json$/.test(name) || name === 'final.md' || /^canon_patch(?:_.*)?\.json$/.test(name));
  const relativePaths = [...new Set([
    source.adjudication.sourceDraftPath,
    source.adjudication.sourceMissionPath,
    source.adjudication.sourceSelectedPlanPath,
    path.posix.join('state', 'story_state.json'),
    path.posix.join('planning', 'chapter_queue.json'),
    ...optionalCanonical.map((name) => relativeChapterArtifact(chapterNumber, name))
  ])];
  return Promise.all(relativePaths.map(async (relativePath) => {
    const content = await fileStore.readText(paths.projectArtifact(relativePath));
    return { path: relativePath, content, hash: sha256(content) };
  }));
}

async function verifyProtectedArtifacts(paths: ProjectPaths, fileStore: FileStore, protectedBefore: ProtectedArtifact[]) {
  return Promise.all(protectedBefore.map(async (artifact) => {
    const afterSha256 = sha256(await fileStore.readText(paths.projectArtifact(artifact.path)));
    if (afterSha256 !== artifact.hash) throw new Error(`targeted-revision-experiment modified protected artifact ${artifact.path}`);
    return { path: artifact.path, beforeSha256: artifact.hash, afterSha256, unchanged: true as const };
  }));
}

async function assertProtectedArtifactsStillUnchanged(paths: ProjectPaths, fileStore: FileStore, protectedBefore: ProtectedArtifact[]): Promise<void> {
  for (const artifact of protectedBefore) {
    if (await fileStore.readText(paths.projectArtifact(artifact.path)) !== artifact.content) {
      throw new Error(`targeted-revision-experiment modified protected artifact ${artifact.path}`);
    }
  }
}

async function recordCoreArtifacts(runLogger: RunLogger, runId: string, source: FreshSource, artifacts: ArtifactSet): Promise<void> {
  for (const sourcePath of [source.adjudicationPath, source.adjudication.sourceDraftPath, source.adjudication.sourceMissionPath, source.adjudication.sourceSelectedPlanPath, source.adjudication.sourceStoryStatePath]) {
    await runLogger.recordArtifact(runId, sourcePath, { action: 'reused', stage: 'revision', provenanceNote: 'Read-only source for targeted revision experiment.' });
  }
  for (const generatedPath of [artifacts.planPath, artifacts.planMarkdownPath, artifacts.candidateDraftPath, artifacts.scopePath, artifacts.scopeMarkdownPath, artifacts.diffPath, artifacts.diffMarkdownPath]) {
    await runLogger.recordArtifact(runId, generatedPath, { action: 'generated', stage: 'revision', sourcePaths: [source.adjudicationPath, source.adjudication.sourceDraftPath] });
  }
}

async function allocateArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<ArtifactSet> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  const pattern = /^(?:targeted_revision_plan|draft_targeted_revision_candidate|targeted_revision_scope_validation|targeted_revision_diff|targeted_revision_experiment)_v(\d+)\.(?:json|md)$/;
  const version = Math.max(0, ...entries.map((entry) => Number.parseInt(pattern.exec(entry)?.[1] ?? '0', 10))) + 1;
  return {
    version,
    planPath: relativeChapterArtifact(chapterNumber, `targeted_revision_plan_v${version}.json`),
    planMarkdownPath: relativeChapterArtifact(chapterNumber, `targeted_revision_plan_v${version}.md`),
    candidateDraftPath: relativeChapterArtifact(chapterNumber, `draft_targeted_revision_candidate_v${version}.md`),
    scopePath: relativeChapterArtifact(chapterNumber, `targeted_revision_scope_validation_v${version}.json`),
    scopeMarkdownPath: relativeChapterArtifact(chapterNumber, `targeted_revision_scope_validation_v${version}.md`),
    diffPath: relativeChapterArtifact(chapterNumber, `targeted_revision_diff_v${version}.json`),
    diffMarkdownPath: relativeChapterArtifact(chapterNumber, `targeted_revision_diff_v${version}.md`),
    reportPath: relativeChapterArtifact(chapterNumber, `targeted_revision_experiment_v${version}.json`),
    reportMarkdownPath: relativeChapterArtifact(chapterNumber, `targeted_revision_experiment_v${version}.md`)
  };
}

async function requireLatestChapterArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string): Promise<string> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  const pattern = new RegExp(`^${baseName}_v(\\d+)\\.json$`);
  const latest = entries.map((entry) => ({ entry, version: Number.parseInt(pattern.exec(entry)?.[1] ?? '0', 10) }))
    .filter((item) => item.version > 0)
    .sort((left, right) => right.version - left.version)[0];
  if (latest === undefined) throw staleSource([`missing ${baseName}_vN.json`]);
  return relativeChapterArtifact(chapterNumber, latest.entry);
}

function resolveSafeProjectPath(paths: ProjectPaths, requestedPath: string, chapterNumber: number): string {
  const absolute = path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(paths.projectRoot, requestedPath);
  const rootPrefix = `${paths.projectRoot}${path.sep}`;
  const expectedDir = paths.chapterDir(chapterNumber);
  if (!absolute.startsWith(rootPrefix) || path.dirname(absolute) !== expectedDir || !/^codex_diagnostics_evidence_adjudication_v\d+\.json$/.test(path.basename(absolute))) {
    throw staleSource([`unsafe or invalid adjudication path ${requestedPath}`]);
  }
  return path.relative(paths.projectRoot, absolute).split(path.sep).join(path.posix.sep);
}

function replaceDraftContext(baseContext: string, draftPath: string, draftText: string): string {
  const marker = '## chapter draft\n';
  const start = baseContext.indexOf(marker);
  if (start < 0) return `${baseContext}\n${marker}path: ${draftPath}\n${draftText.trim()}\n`;
  const contentStart = start + marker.length;
  const nextSection = baseContext.indexOf('\n## ', contentStart);
  const suffix = nextSection < 0 ? '' : baseContext.slice(nextSection);
  return `${baseContext.slice(0, contentStart)}path: ${draftPath}\n${draftText.trim()}\n${suffix}`;
}

function claimMatchesEvidence(normalizedClaim: string, eventDescription: string, explicitTime: string | null, inferredTime: string | null): boolean {
  if (normalizedClaim === 'duplicate_delivery_handoff') return eventDescription === 'delivery_handoff';
  if (normalizedClaim === 'midday_vs_23_17_same_delivery') return explicitTime !== null || inferredTime !== null || eventDescription.includes('time');
  return false;
}

function staleSource(reasons: string[]): AppError {
  return new AppError('CODEX_REVISION_SOURCE_STALE', `Targeted revision source is stale: ${reasons.join('; ')}`, 2);
}

function renderPlanMarkdown(plan: TargetedRevisionPlan): string {
  return [
    `# Targeted Revision Plan: Chapter ${plan.chapterNumber}`,
    '',
    `sourceAdjudicationPath: ${plan.sourceAdjudicationPath}`,
    `objective: ${plan.objective}`,
    '',
    '## Allowed Targets',
    ...plan.allowedTargets.map((target) => `- ${target.targetId}: paragraph ${target.paragraphIndex}; ${target.reason}`),
    '',
    '## Operations',
    ...plan.operations.map((operation) => `- ${operation.operationId}: ${operation.operationType} ${operation.targetIds.join(', ')} - ${operation.reason}`),
    ''
  ].join('\n');
}

function renderScopeMarkdown(report: TargetedRevisionScopeValidation): string {
  return [
    `# Targeted Revision Scope Validation: Chapter ${report.chapterNumber}`,
    '',
    `scopeValid: ${String(report.scopeValid)}`,
    `chapterTitleUnchanged: ${String(report.chapterTitleUnchanged)}`,
    `nonTargetParagraphsUnchanged: ${String(report.nonTargetParagraphsUnchanged)}`,
    `missionTimeAligned: ${String(report.missionTimeAligned)}`,
    `unauthorizedChanges: ${report.unauthorizedChanges.join(', ') || 'none'}`,
    `newEntities: ${report.newEntities.join(', ') || 'none'}`,
    `newOrders: ${report.newOrders.join(', ') || 'none'}`,
    `newRecipients: ${report.newRecipients.join(', ') || 'none'}`,
    `newReveals: ${report.newReveals.join(', ') || 'none'}`,
    ''
  ].join('\n');
}

function renderDiffMarkdown(diff: TargetedRevisionDiff): string {
  return [
    `# Targeted Revision Diff: Chapter ${diff.chapterNumber}`,
    '',
    ...diff.changes.flatMap((change) => [
      `## ${change.targetId} (${change.changeType})`,
      `paragraph: ${change.paragraphIndexBefore} -> ${change.paragraphIndexAfter ?? 'deleted'}`,
      '',
      'Before:',
      change.beforeSnippet || '(empty)',
      '',
      'After:',
      change.afterSnippet || '(deleted)',
      ''
    ])
  ].join('\n');
}

function renderExperimentMarkdown(report: TargetedRevisionExperimentReport): string {
  return [
    `# Targeted Revision Experiment: Chapter ${report.chapterNumber}`,
    '',
    `result: ${report.result}`,
    `sampleCountPerArm: ${report.sampleCountPerArm}`,
    `executionOrder: ${report.executionOrder.join(' -> ')}`,
    `baselineTimelinePassRate: ${report.baselineSummary.timelinePassRateAmongSchemaValid ?? 'null'}`,
    `candidateTimelinePassRate: ${report.candidateSummary.timelinePassRateAmongSchemaValid ?? 'null'}`,
    `candidateAdopted: ${String(report.candidateAdopted)}`,
    `storyStateMutated: ${String(report.storyStateMutated)}`,
    '',
    report.recommendation,
    '',
    report.independenceCaveat,
    ''
  ].join('\n');
}

function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= 6000 ? normalized : `${normalized.slice(0, 5997)}...`;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
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
