import path from 'node:path';
import type { z } from 'zod';

import { RunLogger } from '../logging/RunLogger.js';
import { normalizeDiagnostics } from '../providers/codex/normalizers.js';
import { resolveCodexOutputSchema } from '../providers/codex/schemas.js';
import { CodexTextProvider } from '../providers/codexTextProvider.js';
import type { CodexProfile, LLMJsonResult } from '../providers/providerTypes.js';
import { PromptService } from '../prompts/PromptService.js';
import {
  ChapterMissionSchema,
  CodexDiagnosticsBenchmarkReportSchema,
  CodexDiagnosticsContextFixReportSchema,
  CodexDiagnosticsContextAuditSchema,
  CodexDiagnosticsHardFailAnalysisSchema,
  CodexDiagnosticsHardFailureAnalysisSchema,
  DiagnosticsReportSchema,
  RevisionOpportunityReportSchema,
  RunManifestSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  ChapterMission,
  CodexDiagnosticsBenchmarkReport,
  CodexDiagnosticsBenchmarkSample,
  CodexDiagnosticsContextFixReport,
  CodexDiagnosticsContextAudit,
  CodexDiagnosticsEvidence,
  CodexDiagnosticsHardCheckName,
  CodexDiagnosticsHardFailAnalysis,
  CodexDiagnosticsHardFailureAnalysis,
  CodexDiagnosticsLikelyCause,
  DiagnosticsContextMode,
  DiagnosticsReport,
  RevisionOpportunityReport,
  RunManifest,
  RunManifestV2,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';
import { buildDiagnosticsContextManifest } from './codexDiagnosticsContextBuilder.js';

export { buildDiagnosticsContextManifest } from './codexDiagnosticsContextBuilder.js';

export interface GenerateCodexDiagnosticsHardFailAnalysisInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  contextMode?: DiagnosticsContextMode;
}

export interface GenerateCodexDiagnosticsHardFailAnalysisResult {
  analysis: CodexDiagnosticsHardFailAnalysis;
  analysisPath: string;
  analysisMarkdownPath: string;
  contextAudit: CodexDiagnosticsContextAudit;
  contextAuditPath: string;
  contextAuditMarkdownPath: string;
  revisionOpportunity: RevisionOpportunityReport;
  revisionOpportunityPath: string;
  revisionOpportunityMarkdownPath: string;
}

export interface RunCodexDiagnosticsBenchmarkInput {
  projectId: string;
  projectsRoot?: string;
  promptRoot?: string;
  chapterNumber: number;
  samples?: number;
  contextMode?: DiagnosticsContextMode;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
}

export interface RunCodexDiagnosticsBenchmarkResult {
  report: CodexDiagnosticsBenchmarkReport;
  reportPath: string;
  markdownPath: string;
  contextFixReport?: CodexDiagnosticsContextFixReport;
  contextFixReportPath?: string;
  contextFixReportMarkdownPath?: string;
}

interface SourceContext {
  paths: ProjectPaths;
  fileStore: FileStore;
  chapterNumber: number;
  storyState: StoryState;
  diagnostics: DiagnosticsReport;
  diagnosticsPath: string;
  draftText: string;
  draftPath: string;
  mission: ChapterMission | undefined;
  missionPath: string;
  selectedPlanText: string;
  selectedPlanPath: string;
  finalPath: string;
  finalExists: boolean;
  diagnosticsPromptPath: string;
  diagnosticsPromptText: string;
  contextManifestPath: string;
  promptContextBytes: number;
  promptContextBudgetBytes: number;
}

interface ContextArtifactAvailability {
  name: string;
  path: string;
  present: boolean;
  includedInDiagnosticsPrompt: boolean;
  bytes: number;
  note: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const HARD_CHECKS: CodexDiagnosticsHardCheckName[] = [
  'timeline_consistency',
  'character_knowledge_consistency',
  'world_rule_consistency',
  'no_unplanned_reveal'
];
const REQUIRED_CONTEXT_ARTIFACTS = [
  'story_state summary',
  'character states',
  'timeline',
  'reader_state',
  'open narrative debts',
  'unresolved foreshadowing',
  'selected plan',
  'chapter draft'
];

export async function generateCodexDiagnosticsHardFailAnalysis(
  input: GenerateCodexDiagnosticsHardFailAnalysisInput,
  fileStore = new FileStore()
): Promise<GenerateCodexDiagnosticsHardFailAnalysisResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const beforeState = await readOptionalText(paths.storyState(), fileStore);
  const context = await loadSourceContext(paths, fileStore, input.chapterNumber);
  const generatedAt = new Date().toISOString();
  const availability = await buildContextAvailability(context);
  const contextAuditArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'diagnostics_context_audit');
  const contextAudit = await fileStore.writeJson(
    contextAuditArtifact.jsonPath,
    buildContextAudit(context, availability, generatedAt, contextAuditArtifact.version),
    CodexDiagnosticsContextAuditSchema
  );
  await fileStore.writeText(contextAuditArtifact.mdPath, renderContextAuditMarkdown(contextAudit));

  const hardFailures = HARD_CHECKS
    .filter((checkName) => !context.diagnostics.hard_checks[checkName].passed)
    .map((checkName) => analyzeHardFailure(context, checkName, availability));
  const contextMode = input.contextMode ?? 'baseline';
  const latestContextFix =
    contextMode === 'enhanced'
      ? await readLatestVersionedJson(paths, fileStore, input.chapterNumber, 'codex_diagnostics_context_fix_report', CodexDiagnosticsContextFixReportSchema)
      : undefined;
  const contextFixReport = latestContextFix?.value;
  const hardFailuresAfter = applyContextFixClassifications(hardFailures, contextFixReport);
  const classificationChanged =
    contextFixReport?.hardCheckComparison.some((comparison) => comparison.changed || comparison.classificationBefore !== comparison.classificationAfter) ?? false;
  const remainingInsufficientEvidence =
    contextFixReport?.hardCheckComparison.filter((comparison) => comparison.classificationAfter === 'insufficient_evidence').map((comparison) => comparison.checkName) ??
    hardFailures.filter((failure) => failure.classification === 'insufficient_evidence').map((failure) => failure.checkName);
  const evidenceMap = uniqueEvidence(hardFailures.flatMap((failure) => [...failure.evidenceFromDraft, ...failure.evidenceFromPlan, ...failure.evidenceFromStoryState]));
  const suspectedRootCauses = suspectedRootCausesFor(hardFailures, contextAudit);
  const analysisArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'codex_diagnostics_hard_fail_analysis');
  const analysis = await fileStore.writeJson(
    analysisArtifact.jsonPath,
    {
      reportId: `codex_diagnostics_hard_fail_analysis_ch${formatChapterNumber(input.chapterNumber)}_v${analysisArtifact.version}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      generatedAt,
      contextMode,
      ...(latestContextFix === undefined ? {} : { contextFixReportPath: latestContextFix.relativePath }),
      classificationChanged,
      hardFailuresBefore: hardFailures,
      hardFailuresAfter,
      evidenceImprovementSummary:
        contextFixReport === undefined
          ? 'No enhanced diagnostics context comparison was available.'
          : `Enhanced context changed ${contextFixReport.hardCheckComparison.filter((comparison) => comparison.evidenceImproved).length} hard-check evidence classification(s).`,
      remainingInsufficientEvidence,
      sourceDiagnosticsPath: context.diagnosticsPath,
      sourceDraftPath: context.draftPath,
      sourceFinalPath: context.finalExists ? context.finalPath : '',
      sourceMissionPath: context.missionPath,
      sourceSelectedPlanPath: context.selectedPlanPath,
      sourceStoryStatePath: path.posix.join('state', 'story_state.json'),
      sourceReaderStateSummary: summarizeReaderState(context.storyState),
      hardFailures,
      softScoreSummary: summarizeSoftScores(context.diagnostics),
      suspectedRootCauses,
      evidenceMap,
      contextAvailability: {
        requiredArtifacts: availability,
        missingRequiredArtifacts: availability.filter((item) => !item.includedInDiagnosticsPrompt).map((item) => item.name),
        contextTruncated: contextAudit.contextTruncated,
        possibleContextLoss: contextAudit.possibleContextLoss
      },
      falsePositiveRisk: falsePositiveRiskFor(hardFailures, contextAudit),
      recommendedFixes: recommendedFixesFor(hardFailures, contextAudit),
      suggestedRetryCommand: suggestedRetryCommand(paths.projectId, input.chapterNumber),
      suggestedReviewCommand: suggestedReviewCommand(paths.projectId, input.chapterNumber),
      storyStateMutated: false
    },
    CodexDiagnosticsHardFailAnalysisSchema
  );
  await fileStore.writeText(analysisArtifact.mdPath, renderAnalysisMarkdown(analysis));

  const revisionArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'revision_opportunity_report');
  const revisionOpportunity = await fileStore.writeJson(
    revisionArtifact.jsonPath,
    buildRevisionOpportunity(paths.projectId, input.chapterNumber, hardFailures, generatedAt, revisionArtifact.version),
    RevisionOpportunityReportSchema
  );
  await fileStore.writeText(revisionArtifact.mdPath, renderRevisionOpportunityMarkdown(revisionOpportunity));

  const afterState = await readOptionalText(paths.storyState(), fileStore);
  if (afterState !== beforeState) {
    throw new Error('diagnostics-analysis mutated Story State');
  }

  return {
    analysis,
    analysisPath: analysisArtifact.relativeJsonPath,
    analysisMarkdownPath: analysisArtifact.relativeMdPath,
    contextAudit,
    contextAuditPath: contextAuditArtifact.relativeJsonPath,
    contextAuditMarkdownPath: contextAuditArtifact.relativeMdPath,
    revisionOpportunity,
    revisionOpportunityPath: revisionArtifact.relativeJsonPath,
    revisionOpportunityMarkdownPath: revisionArtifact.relativeMdPath
  };
}

export async function runCodexDiagnosticsBenchmark(
  input: RunCodexDiagnosticsBenchmarkInput,
  fileStore = new FileStore()
): Promise<RunCodexDiagnosticsBenchmarkResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const beforeState = await readOptionalText(paths.storyState(), fileStore);
  const contextMode = input.contextMode ?? 'baseline';
  const contextManifest = await buildDiagnosticsContextManifest(
    { projectId: paths.projectId, projectsRoot: paths.projectsRoot, chapterNumber: input.chapterNumber, mode: contextMode },
    fileStore
  );
  const samples: CodexDiagnosticsBenchmarkSample[] = [];
  const sampleCount = Math.max(1, input.samples ?? 1);
  for (let index = 0; index < sampleCount; index += 1) {
    samples.push(
      await runDiagnosticsSample(
        { ...input, projectsRoot: paths.projectsRoot, projectId: paths.projectId, contextMode, diagnosticsPromptContext: contextManifest.promptContext, sampleIndex: index + 1 },
        fileStore
      )
    );
  }
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'codex_diagnostics_benchmark');
  let report = await fileStore.writeJson(
    artifact.jsonPath,
    buildCodexDiagnosticsBenchmarkReport(paths.projectId, input.chapterNumber, samples, artifact.version, contextMode, contextManifest.manifestPath),
    CodexDiagnosticsBenchmarkReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderBenchmarkMarkdown(report));
  const contextFix =
    contextMode === 'enhanced'
      ? await maybeWriteContextFixReport(paths, fileStore, input.chapterNumber, report, artifact.relativeJsonPath, contextManifest.manifestPath)
      : undefined;
  if (contextFix !== undefined) {
    report = await fileStore.writeJson(
      artifact.jsonPath,
      { ...report, contextFixReportPath: contextFix.reportPath },
      CodexDiagnosticsBenchmarkReportSchema
    );
    await fileStore.writeText(artifact.mdPath, renderBenchmarkMarkdown(report));
  }
  const afterState = await readOptionalText(paths.storyState(), fileStore);
  if (afterState !== beforeState) {
    throw new Error('diagnostics-benchmark mutated Story State');
  }
  return {
    report,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath,
    ...(contextFix === undefined ? {} : { contextFixReport: contextFix.report, contextFixReportPath: contextFix.reportPath, contextFixReportMarkdownPath: contextFix.markdownPath })
  };
}

async function loadSourceContext(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<SourceContext> {
  const diagnostics = await readLatestVersionedJson(paths, fileStore, chapterNumber, 'diagnostics', DiagnosticsReportSchema);
  if (diagnostics === undefined) {
    throw new AppError('DIAGNOSTICS_NOT_FOUND', `No diagnostics_vN.json found for chapter ${chapterNumber}`, 1);
  }
  const draftPath = relativeChapterArtifact(chapterNumber, 'draft_v1.md');
  if (!(await fileStore.exists(paths.projectArtifact(draftPath)))) {
    throw new AppError('DRAFT_NOT_FOUND', `No draft_v1.md found for chapter ${chapterNumber}`, 1);
  }
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const missionPath = relativeChapterArtifact(chapterNumber, 'mission.json');
  const selectedPlanPath = relativeChapterArtifact(chapterNumber, 'selected_plan.md');
  const finalPath = relativeChapterArtifact(chapterNumber, 'final.md');
  const promptContext = await findLatestDiagnosticsPrompt(paths, fileStore, chapterNumber);
  return {
    paths,
    fileStore,
    chapterNumber,
    storyState,
    diagnostics: diagnostics.value,
    diagnosticsPath: diagnostics.relativePath,
    draftText: await fileStore.readText(paths.projectArtifact(draftPath)),
    draftPath,
    mission: await readOptionalJson(paths.projectArtifact(missionPath), fileStore, ChapterMissionSchema),
    missionPath,
    selectedPlanText: await readOptionalText(paths.projectArtifact(selectedPlanPath), fileStore),
    selectedPlanPath,
    finalPath,
    finalExists: await fileStore.exists(paths.projectArtifact(finalPath)),
    diagnosticsPromptPath: promptContext.promptPath,
    diagnosticsPromptText: promptContext.promptText,
    contextManifestPath: promptContext.contextManifestPath,
    promptContextBytes: promptContext.contextBytes,
    promptContextBudgetBytes: promptContext.contextBudgetBytes
  };
}

async function buildContextAvailability(context: SourceContext): Promise<ContextArtifactAvailability[]> {
  const promptText = context.diagnosticsPromptText.toLowerCase();
  const artifacts: Array<{ name: string; path: string; text: string; tokens: string[] }> = [
    {
      name: 'story_state summary',
      path: path.posix.join('state', 'story_state.json'),
      text: JSON.stringify({
        latestCommittedChapter: context.storyState.latestCommittedChapter,
        canonFacts: context.storyState.canonFacts.slice(-5),
        timeline: context.storyState.timeline.slice(-5)
      }),
      tokens: ['story_state', 'story state', 'canonfacts', 'latestcommittedchapter']
    },
    { name: 'character states', path: path.posix.join('state', 'story_state.json#characters'), text: JSON.stringify(context.storyState.characters), tokens: ['character states', 'characters', 'character_states'] },
    { name: 'timeline', path: path.posix.join('state', 'story_state.json#timeline'), text: JSON.stringify(context.storyState.timeline), tokens: ['timeline'] },
    { name: 'reader_state', path: path.posix.join('state', 'story_state.json#readerState'), text: JSON.stringify(context.storyState.readerState), tokens: ['reader_state', 'readerstate', 'reader state'] },
    {
      name: 'open narrative debts',
      path: path.posix.join('state', 'story_state.json#narrativeDebts'),
      text: JSON.stringify(context.storyState.narrativeDebts.filter((debt) => debt.status !== 'resolved')),
      tokens: ['narrative debts', 'narrativedebts', 'open debts']
    },
    {
      name: 'unresolved foreshadowing',
      path: path.posix.join('state', 'story_state.json#foreshadowing'),
      text: JSON.stringify(context.storyState.foreshadowing.filter((item) => item.status !== 'resolved')),
      tokens: ['foreshadowing']
    },
    { name: 'selected plan', path: context.selectedPlanPath, text: context.selectedPlanText, tokens: ['selected_plan', 'selected plan', 'plan_summary'] },
    { name: 'chapter draft', path: context.draftPath, text: context.draftText, tokens: ['draft_summary', 'draft_markdown', 'chapter draft'] }
  ];
  return artifacts.map((artifact) => {
    const present = artifact.text.trim().length > 0 || artifact.name === 'story_state summary';
    const includedInDiagnosticsPrompt = artifact.tokens.some((token) => promptText.includes(token));
    return {
      name: artifact.name,
      path: artifact.path,
      present,
      includedInDiagnosticsPrompt,
      bytes: byteLength(artifact.text),
      note: includedInDiagnosticsPrompt ? 'included in diagnostics prompt' : 'available in project but absent from diagnostics prompt'
    };
  });
}

function buildContextAudit(
  context: SourceContext,
  availability: ContextArtifactAvailability[],
  generatedAt: string,
  version: number
): CodexDiagnosticsContextAudit {
  const missingRequiredArtifacts = availability.filter((item) => !item.includedInDiagnosticsPrompt).map((item) => item.name);
  const includedArtifacts = availability
    .filter((item) => item.includedInDiagnosticsPrompt)
    .map((item) => ({ name: item.name, path: item.path, bytes: item.bytes, reason: item.note }));
  const excludedArtifacts = availability
    .filter((item) => !item.includedInDiagnosticsPrompt)
    .map((item) => ({ name: item.name, path: item.path, bytes: item.bytes, reason: item.note }));
  const possibleContextLoss = missingRequiredArtifacts.map((name) => `${name} was not visible to the diagnostics prompt.`);
  return CodexDiagnosticsContextAuditSchema.parse({
    reportId: `diagnostics_context_audit_ch${formatChapterNumber(context.chapterNumber)}_v${version}`,
    projectId: context.paths.projectId,
    chapterNumber: context.chapterNumber,
    diagnosticsPromptPath: context.diagnosticsPromptPath,
    contextManifestPath: context.contextManifestPath,
    includedArtifacts,
    excludedArtifacts,
    requiredArtifacts: REQUIRED_CONTEXT_ARTIFACTS,
    missingRequiredArtifacts,
    contextBytes: context.promptContextBytes,
    contextBudgetBytes: context.promptContextBudgetBytes,
    contextTruncated: context.diagnosticsPromptText.includes('[truncated]') || context.diagnosticsPromptText.includes('TRUNCATED'),
    possibleContextLoss,
    generatedAt,
    storyStateMutated: false
  });
}

function analyzeHardFailure(
  context: SourceContext,
  checkName: CodexDiagnosticsHardCheckName,
  availability: ContextArtifactAvailability[]
): CodexDiagnosticsHardFailureAnalysis {
  const check = context.diagnostics.hard_checks[checkName];
  const relatedIssueMessages = context.diagnostics.issues
    .map((issue) => issue.message)
    .filter((message) => issueLooksRelated(checkName, message));
  const diagnosticsMessage = [check.message, check.evidence, ...relatedIssueMessages].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(' | ');
  const likelyCause = likelyCauseForCheck(checkName);
  const evidenceFromDraft = extractEvidence('draft', context.draftPath, context.draftText, checkName, diagnosticsMessage);
  const evidenceFromPlan = extractEvidence('plan', context.selectedPlanPath, context.selectedPlanText, checkName, diagnosticsMessage);
  const missionText = context.mission === undefined ? '' : JSON.stringify(context.mission);
  evidenceFromPlan.push(...extractEvidence('mission', context.missionPath, missionText, checkName, diagnosticsMessage));
  const storyEvidence = extractStoryStateEvidence(context, checkName, diagnosticsMessage);
  const missingEvidence = missingEvidenceFor(availability, evidenceFromDraft, evidenceFromPlan, storyEvidence);
  return CodexDiagnosticsHardFailureAnalysisSchema.parse({
    checkName,
    failed: true,
    severity: check.severity ?? 'high',
    diagnosticsMessage: diagnosticsMessage || 'diagnostics hard check failed without detailed evidence',
    evidenceFromDraft,
    evidenceFromPlan,
    evidenceFromStoryState: storyEvidence,
    missingEvidence,
    likelyCause,
    classification: classificationFor({
      checkName,
      diagnosticsMessage,
      evidenceFromDraft,
      evidenceFromPlan,
      evidenceFromStoryState: storyEvidence,
      missingEvidence
    })
  });
}

function extractStoryStateEvidence(context: SourceContext, checkName: CodexDiagnosticsHardCheckName, diagnosticsMessage: string): CodexDiagnosticsEvidence[] {
  if (checkName === 'timeline_consistency') {
    return context.storyState.timeline.flatMap((event) =>
      extractEvidence('timeline', path.posix.join('state', 'story_state.json#timeline'), event.summary, checkName, diagnosticsMessage).map((evidence) => ({ ...evidence, relatedIds: [event.id] }))
    );
  }
  if (checkName === 'character_knowledge_consistency') {
    return context.storyState.characters.flatMap((character) =>
      extractEvidence('character_states', path.posix.join('state', 'story_state.json#characters'), JSON.stringify(character), checkName, diagnosticsMessage).map((evidence) => ({ ...evidence, relatedIds: [character.id] }))
    );
  }
  if (checkName === 'world_rule_consistency') {
    return context.storyState.worldRules.flatMap((rule) =>
      extractEvidence('story_state', path.posix.join('state', 'story_state.json#worldRules'), JSON.stringify(rule), checkName, diagnosticsMessage).map((evidence) => ({ ...evidence, relatedIds: [rule.id] }))
    );
  }
  return [
    ...context.storyState.revealSchedule.flatMap((reveal) =>
      extractEvidence('story_state', path.posix.join('state', 'story_state.json#revealSchedule'), JSON.stringify(reveal), checkName, diagnosticsMessage).map((evidence) => ({ ...evidence, relatedIds: [reveal.id] }))
    ),
    ...context.storyState.foreshadowing.flatMap((item) =>
      extractEvidence('foreshadowing', path.posix.join('state', 'story_state.json#foreshadowing'), JSON.stringify(item), checkName, diagnosticsMessage).map((evidence) => ({ ...evidence, relatedIds: [item.id] }))
    )
  ];
}

function extractEvidence(
  source: CodexDiagnosticsEvidence['source'],
  sourcePath: string,
  text: string,
  checkName: CodexDiagnosticsHardCheckName,
  diagnosticsMessage: string
): CodexDiagnosticsEvidence[] {
  if (text.trim().length === 0) return [];
  const keywords = evidenceKeywords(checkName, diagnosticsMessage);
  const snippets: CodexDiagnosticsEvidence[] = [];
  for (const keyword of keywords) {
    const index = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (index < 0) continue;
    snippets.push({
      source,
      path: sourcePath,
      excerpt: snippetAround(text, index),
      relatedIds: [],
      confidence: confidenceForKeyword(keyword)
    });
    if (snippets.length >= 3) break;
  }
  return uniqueEvidence(snippets);
}

function evidenceKeywords(checkName: CodexDiagnosticsHardCheckName, diagnosticsMessage: string): string[] {
  const fromMessage = diagnosticsMessage
    .split(/[^A-Za-z0-9\u4e00-\u9fff:：]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3)
    .slice(0, 10);
  if (checkName === 'timeline_consistency') {
    return uniqueStrings(['timeline', 'time', 'noon', '23:17', '23:29', '午高峰', '二十三点', '时间', '路线', ...fromMessage]);
  }
  if (checkName === 'character_knowledge_consistency') {
    return uniqueStrings(['knowledge', 'knows', '知道', '看见', '记得', '意识', '昨夜', ...fromMessage]);
  }
  if (checkName === 'world_rule_consistency') {
    return uniqueStrings(['world', 'rule', '规则', '收音机', '电梯', '十七楼', ...fromMessage]);
  }
  return uniqueStrings(['reveal', 'identity', 'truth', '揭示', '身份', '真相', '失踪', '十七楼', ...fromMessage]);
}

function classificationFor(input: {
  checkName: CodexDiagnosticsHardCheckName;
  diagnosticsMessage: string;
  evidenceFromDraft: CodexDiagnosticsEvidence[];
  evidenceFromPlan: CodexDiagnosticsEvidence[];
  evidenceFromStoryState: CodexDiagnosticsEvidence[];
  missingEvidence: string[];
}): CodexDiagnosticsHardFailureAnalysis['classification'] {
  const evidenceCount = input.evidenceFromDraft.length + input.evidenceFromPlan.length + input.evidenceFromStoryState.length;
  const generic = input.diagnosticsMessage.trim() === 'review required' || input.diagnosticsMessage.includes('without detailed evidence');
  if (generic) return 'insufficient_evidence';
  if (evidenceCount === 0) return 'insufficient_evidence';
  if (input.checkName === 'timeline_consistency' && input.evidenceFromDraft.length >= 2) return 'true_positive_draft_issue';
  if (input.evidenceFromStoryState.length === 0 && input.missingEvidence.some((item) => item.includes('story_state'))) return 'diagnostics_context_missing';
  return 'unknown';
}

function applyContextFixClassifications(
  hardFailures: CodexDiagnosticsHardFailureAnalysis[],
  contextFixReport: CodexDiagnosticsContextFixReport | undefined
): CodexDiagnosticsHardFailureAnalysis[] {
  if (contextFixReport === undefined) return hardFailures;
  const afterByCheck = new Map(contextFixReport.hardCheckComparison.map((comparison) => [comparison.checkName, comparison.classificationAfter]));
  return hardFailures
    .map((failure) => {
      const classification = afterByCheck.get(failure.checkName) ?? failure.classification;
      return { ...failure, classification };
    })
    .filter((failure) => failure.classification !== 'diagnostics_false_positive');
}

function missingEvidenceFor(
  availability: ContextArtifactAvailability[],
  draftEvidence: CodexDiagnosticsEvidence[],
  planEvidence: CodexDiagnosticsEvidence[],
  storyEvidence: CodexDiagnosticsEvidence[]
): string[] {
  const missing = availability.filter((item) => !item.includedInDiagnosticsPrompt).map((item) => item.name);
  if (draftEvidence.length === 0) missing.push('draft evidence snippet');
  if (planEvidence.length === 0) missing.push('plan or mission evidence snippet');
  if (storyEvidence.length === 0) missing.push('story_state evidence snippet');
  return uniqueStrings(missing);
}

function buildRevisionOpportunity(
  projectIdValue: string,
  chapterNumber: number,
  hardFailures: CodexDiagnosticsHardFailureAnalysis[],
  generatedAt: string,
  version: number
): RevisionOpportunityReport {
  const canRepairByLocalInstruction = hardFailures.some((failure) => failure.classification === 'true_positive_draft_issue');
  const requiresHumanReview = hardFailures.some((failure) => failure.classification === 'insufficient_evidence' || failure.classification === 'diagnostics_context_missing');
  return RevisionOpportunityReportSchema.parse({
    reportId: `revision_opportunity_ch${formatChapterNumber(chapterNumber)}_v${version}`,
    projectId: projectIdValue,
    chapterNumber,
    hardFailures,
    proposedRevisionTargets: hardFailures.map((failure) => ({
      target: failure.checkName === 'timeline_consistency' ? 'draft timeline wording and repeated sequence' : 'diagnostics context / whole chapter continuity',
      reason: failure.diagnosticsMessage,
      affectedHardChecks: [failure.checkName],
      suggestedChange:
        failure.classification === 'true_positive_draft_issue'
          ? 'Rewrite the affected passage so sequence, timestamps, and revealed information are internally consistent.'
          : 'Do not rewrite automatically; rerun diagnostics with fuller context or send to human review.',
      riskLevel: failure.classification === 'true_positive_draft_issue' ? 'medium' : 'high'
    })),
    canRepairByLocalInstruction,
    requiresRegenerateDraft: false,
    requiresHumanReview,
    suggestedRevisionPromptAddendum:
      'Before revising, preserve mission objectives and compare draft claims against story_state timeline, reader_state, selected_plan, open debts, and unresolved foreshadowing.',
    suggestedRetryCommand: suggestedRetryCommand(projectIdValue, chapterNumber),
    generatedAt,
    storyStateMutated: false
  });
}

async function runDiagnosticsSample(
  input: RunCodexDiagnosticsBenchmarkInput & { sampleIndex: number; contextMode: DiagnosticsContextMode; diagnosticsPromptContext: string },
  fileStore: FileStore
): Promise<CodexDiagnosticsBenchmarkSample> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const sampleId = `diagnostics_sample_${String(input.sampleIndex).padStart(3, '0')}`;
  const runId = createRunId(new Date(), `codex_diagnostics_benchmark_ch${formatChapterNumber(input.chapterNumber)}_${String(input.sampleIndex).padStart(3, '0')}`);
  const runLogger = new RunLogger(paths, fileStore);
  const stateBefore = await readOptionalText(paths.storyState(), fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex diagnostics-benchmark',
    args: {
      provider: 'codex-text',
      chapterNumber: input.chapterNumber,
      sampleId,
      contextMode: input.contextMode,
      storyStateCommitAllowed: false,
      codexProfile: input.codexProfile ?? 'clean'
    }
  });
  const started = Date.now();
  let diagnostics: DiagnosticsReport | undefined;
  let schemaValid = false;
  let retryCount = 0;
  let repairCount = 0;
  try {
    const renderedPrompt = await renderDiagnosticsPrompt(input, paths, fileStore, input.diagnosticsPromptContext);
    const outputSchema = resolveCodexOutputSchema('diagnostics.diagnose_chapter_slim');
    if (outputSchema === undefined) {
      throw new AppError('OUTPUT_SCHEMA_NOT_FOUND', 'No output schema registered for diagnostics.diagnose_chapter_slim', 1);
    }
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
    const response = await provider.complete({
      promptId: 'diagnostics.diagnose_chapter_slim',
      system: 'Novel Loop Engine diagnostics benchmark. Do not edit files.',
      user: renderedPrompt,
      responseFormat: 'json',
      metadata: {
        outputSchemaPath: outputSchema.schemaPath,
        schemaName: outputSchema.schemaName
      }
    });
    const raw = response.raw as LLMJsonResult;
    diagnostics = DiagnosticsReportSchema.parse(normalizeDiagnostics(raw.parsed, { projectId: paths.projectId, chapterNumber: input.chapterNumber }));
    schemaValid = true;
  } catch (error) {
    await runLogger.recordError(runId, { code: 'CODEX_DIAGNOSTICS_BENCHMARK_FAILED', message: getErrorMessage(error), recoverable: true });
  }
  const metrics = await readPromptMetrics(paths, fileStore, runId);
  retryCount = metrics.retryCount;
  repairCount = metrics.repairCount;
  await runLogger.endRun(runId, diagnostics === undefined ? 'failed' : 'success');
  const stateAfter = await readOptionalText(paths.storyState(), fileStore);
  if (stateAfter !== stateBefore) {
    throw new Error('diagnostics-benchmark sample mutated Story State');
  }
  const hardChecks = diagnostics?.hard_checks ?? {};
  const averageScore = diagnostics === undefined ? 0 : average(Object.values(diagnostics.soft_scores));
  return CodexDiagnosticsBenchmarkReportSchema.shape.samples.element.parse({
    sampleId,
    runId,
    durationMs: Math.max(0, Date.now() - started),
    schemaValid,
    hardChecks,
    averageScore,
    passed: diagnostics === undefined ? false : Object.values(diagnostics.hard_checks).every((check) => check.passed),
    retryCount,
    repairCount,
    rawOutputPath: metrics.rawOutputPath,
    finalOutputPath: metrics.finalOutputPath,
    parsedOutputPath: metrics.parsedOutputPath,
    providerSchemaValid: schemaValid,
    normalizationSucceeded: schemaValid,
    internalSchemaValid: schemaValid,
    semanticConsistency: schemaValid,
    storyStateMutated: false
  });
}

async function renderDiagnosticsPrompt(input: RunCodexDiagnosticsBenchmarkInput, paths: ProjectPaths, fileStore: FileStore, diagnosticsPromptContext: string): Promise<string> {
  const promptService = new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
  const draftPath = paths.chapterArtifact(input.chapterNumber, 'draft_v1.md');
  const draftText = await fileStore.readText(draftPath);
  return promptService.renderPrompt('diagnostics.diagnose_chapter_slim', {
    CHAPTER_NUMBER: input.chapterNumber,
    DRAFT_VERSION: 1,
    DRAFT_SUMMARY: summarizeText(draftText),
    DIAGNOSTICS_CONTEXT: diagnosticsPromptContext
  });
}

export function buildCodexDiagnosticsBenchmarkReport(
  projectIdValue: string,
  chapterNumber: number,
  samples: CodexDiagnosticsBenchmarkSample[],
  version: number,
  contextMode: DiagnosticsContextMode,
  diagnosticsContextManifestPath: string
): CodexDiagnosticsBenchmarkReport {
  const sampleCount = samples.length;
  const schemaValidSamples = samples.filter((sample) => sample.schemaValid);
  const successCount = schemaValidSamples.length;
  const failureCount = sampleCount - successCount;
  const observedFailureCountAllSamples = samples.filter((sample) => !sample.passed).length;
  const hardFailCountAmongSchemaValidSamples = schemaValidSamples.filter((sample) => !sample.passed).length;
  const hardCheckResultsDistribution = HARD_CHECKS.reduce<Record<string, { passed: number; failed: number }>>((accumulator, checkName) => {
    accumulator[checkName] = {
      passed: schemaValidSamples.filter((sample) => sample.hardChecks[checkName]?.passed === true).length,
      failed: schemaValidSamples.filter((sample) => sample.hardChecks[checkName]?.passed === false).length
    };
    return accumulator;
  }, {});
  const scores = samples.map((sample) => sample.averageScore);
  const observedFailureRateAllSamples = rate(observedFailureCountAllSamples, sampleCount);
  const hardFailRateAmongSchemaValidSamples = successCount === 0 ? null : rate(hardFailCountAmongSchemaValidSamples, successCount);
  const schemaValidRate = rate(successCount, sampleCount);
  return CodexDiagnosticsBenchmarkReportSchema.parse({
    reportId: `codex_diagnostics_benchmark_ch${formatChapterNumber(chapterNumber)}_v${version}`,
    projectId: projectIdValue,
    chapterNumber,
    sampleCount,
    successCount,
    failureCount,
    totalSampleCount: sampleCount,
    schemaValidSampleCount: successCount,
    schemaInvalidSampleCount: failureCount,
    schemaInvalidRate: rate(failureCount, sampleCount),
    observedFailureCountAllSamples,
    observedFailureRateAllSamples,
    hardFailCountAmongSchemaValidSamples,
    hardFailRateAmongSchemaValidSamples,
    experimentValid: successCount > 0,
    experimentInvalidReason: successCount === 0 ? 'diagnostics_schema_noncompliance' : null,
    hardCheckResultsDistribution,
    averageScoreDistribution: {
      min: scores.length === 0 ? 0 : Math.min(...scores),
      max: scores.length === 0 ? 0 : Math.max(...scores),
      mean: roundOne(average(scores))
    },
    retryRate: rate(samples.filter((sample) => sample.retryCount > 0).length, sampleCount),
    repairRate: rate(samples.filter((sample) => sample.repairCount > 0).length, sampleCount),
    schemaValidRate,
    samples,
    stableFailure: sampleCount > 0 && hardFailRateAmongSchemaValidSamples === 1 && schemaValidRate === 1,
    likelyFalsePositive: sampleCount > 0 && (hardFailRateAmongSchemaValidSamples ?? 0) > 0 && schemaValidRate === 1 && samples.every((sample) => sample.retryCount === 0),
    recommendation:
      successCount === 0
        ? 'Fix diagnostics structured-output schema compliance before interpreting hard-check results.'
        : hardFailRateAmongSchemaValidSamples === 1
          ? 'Run diagnostics-analysis and review evidence before retrying revision.'
          : 'Diagnostics result varies; collect more schema-valid samples before changing prompts.',
    contextMode,
    diagnosticsContextManifestPath,
    generatedAt: new Date().toISOString(),
    storyStateMutated: false
  });
}

async function maybeWriteContextFixReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  enhancedReport: CodexDiagnosticsBenchmarkReport,
  enhancedReportPath: string,
  contextManifestPath: string
): Promise<{ report: CodexDiagnosticsContextFixReport; reportPath: string; markdownPath: string } | undefined> {
  const baseline = await latestBenchmarkByMode(paths, fileStore, chapterNumber, 'baseline');
  if (baseline === undefined) return undefined;
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, chapterNumber, 'codex_diagnostics_context_fix_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    buildCodexDiagnosticsContextFixReport(paths.projectId, chapterNumber, baseline.value, baseline.relativePath, enhancedReport, enhancedReportPath, contextManifestPath, artifact.version),
    CodexDiagnosticsContextFixReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderContextFixMarkdown(report));
  return { report, reportPath: artifact.relativeJsonPath, markdownPath: artifact.relativeMdPath };
}

export function buildCodexDiagnosticsContextFixReport(
  projectIdValue: string,
  chapterNumber: number,
  baseline: CodexDiagnosticsBenchmarkReport,
  baselinePath: string,
  enhanced: CodexDiagnosticsBenchmarkReport,
  enhancedPath: string,
  contextManifestPath: string,
  version: number
): CodexDiagnosticsContextFixReport {
  const hardCheckComparison = HARD_CHECKS.map((checkName) => {
    const before = classifyBenchmarkCheck(baseline, checkName);
    const after = classifyBenchmarkCheck(enhanced, checkName);
    return {
      checkName,
      baselineResult: before.result,
      enhancedResult: after.result,
      changed: before.result !== after.result || before.classification !== after.classification,
      evidenceImproved: before.classification === 'insufficient_evidence' && after.classification !== 'insufficient_evidence',
      classificationBefore: before.classification,
      classificationAfter: after.classification,
      notes: after.note
    };
  });
  const baselineInsufficientEvidenceCount = hardCheckComparison.filter((item) => item.classificationBefore === 'insufficient_evidence').length;
  const enhancedInsufficientEvidenceCount = hardCheckComparison.filter((item) => item.classificationAfter === 'insufficient_evidence').length;
  return CodexDiagnosticsContextFixReportSchema.parse({
    reportId: `codex_diagnostics_context_fix_report_ch${formatChapterNumber(chapterNumber)}_v${version}`,
    projectId: projectIdValue,
    chapterNumber,
    generatedAt: new Date().toISOString(),
    baselineBenchmarkPath: baselinePath,
    enhancedBenchmarkPath: enhancedPath,
    totalSampleCount: enhanced.samples.length,
    schemaValidSampleCount: enhanced.samples.filter((sample) => sample.schemaValid).length,
    schemaInvalidSampleCount: enhanced.samples.filter((sample) => !sample.schemaValid).length,
    schemaInvalidRate: rate(enhanced.samples.filter((sample) => !sample.schemaValid).length, enhanced.samples.length),
    observedFailureCountAllSamples: enhanced.samples.filter((sample) => !sample.passed).length,
    observedFailureRateAllSamples: rate(enhanced.samples.filter((sample) => !sample.passed).length, enhanced.samples.length),
    hardFailCountAmongSchemaValidSamples: validHardFailCount(enhanced),
    hardFailRateAmongSchemaValidSamples: validHardFailRate(enhanced),
    experimentValid: experimentInvalidReason(baseline, enhanced) === null,
    experimentInvalidReason: experimentInvalidReason(baseline, enhanced),
    baselineHardFailRateAmongSchemaValidSamples: validHardFailRate(baseline),
    enhancedHardFailRateAmongSchemaValidSamples: validHardFailRate(enhanced),
    baselineFalsePositiveRisk: falsePositiveRiskLevel(baselineInsufficientEvidenceCount, validHardFailRate(baseline)),
    enhancedFalsePositiveRisk: falsePositiveRiskLevel(enhancedInsufficientEvidenceCount, validHardFailRate(enhanced)),
    baselineInsufficientEvidenceCount,
    enhancedInsufficientEvidenceCount,
    hardCheckComparison,
    contextManifestPath,
    conclusion: contextFixConclusion(baseline, enhanced, baselineInsufficientEvidenceCount, enhancedInsufficientEvidenceCount, hardCheckComparison),
    recommendedNextStep: recommendedNextStepForContextFix(enhanced, hardCheckComparison),
    storyStateMutated: false
  });
}

function classifyBenchmarkCheck(report: CodexDiagnosticsBenchmarkReport, checkName: CodexDiagnosticsHardCheckName): {
  result: string;
  classification: CodexDiagnosticsHardFailureAnalysis['classification'];
  note: string;
} {
  const checkResults = report.samples.filter((sample) => sample.schemaValid).map((sample) => sample.hardChecks[checkName]).filter((check): check is { passed: boolean; message: string; evidence?: string } => check !== undefined);
  if (checkResults.length === 0) {
    return { result: 'schema-invalid', classification: 'schema_or_normalizer_issue', note: 'No schema-valid sample exists for this hard check.' };
  }
  const failed = checkResults.filter((check) => !check.passed);
  if (failed.length === 0) {
    return { result: 'passed', classification: 'diagnostics_false_positive', note: 'Enhanced diagnostics passed this hard check or no failure remained.' };
  }
  const combined = failed.map((check) => `${check.message} ${check.evidence ?? ''}`).join(' | ').trim();
  const lower = combined.toLowerCase();
  if (lower.includes('sample failed before diagnostics schema validation')) {
    return { result: `failed: ${combined}`, classification: 'schema_or_normalizer_issue', note: 'Sample did not produce schema-valid diagnostics, so context impact cannot be interpreted as a draft issue.' };
  }
  if (lower.includes('confirmed contradiction') || lower.includes('confirmed by') || lower.includes('draft timestamps') || lower.includes('evidence:')) {
    return { result: `failed: ${combined}`, classification: 'true_positive_draft_issue', note: 'Failure includes specific evidence rather than only a generic hard-check failure.' };
  }
  if (combined.length === 0 || lower.includes('review required') || lower.includes('without detailed evidence') || lower.includes('hard check failed')) {
    return { result: `failed: ${combined || 'review required'}`, classification: 'insufficient_evidence', note: 'Failure is generic and does not cite enough evidence.' };
  }
  return { result: `failed: ${combined}`, classification: 'unknown', note: 'Failure is specific but could not be confidently classified.' };
}

function falsePositiveRiskLevel(insufficientEvidenceCount: number, hardFailRate: number | null): 'low' | 'medium' | 'high' {
  if (insufficientEvidenceCount >= 3 && (hardFailRate ?? 0) > 0) return 'high';
  if (insufficientEvidenceCount > 0 && (hardFailRate ?? 0) > 0) return 'medium';
  return 'low';
}

function contextFixConclusion(
  baseline: CodexDiagnosticsBenchmarkReport,
  enhanced: CodexDiagnosticsBenchmarkReport,
  baselineInsufficientEvidenceCount: number,
  enhancedInsufficientEvidenceCount: number,
  comparisons: Array<{ classificationAfter: CodexDiagnosticsHardFailureAnalysis['classification']; evidenceImproved: boolean }>
): CodexDiagnosticsContextFixReport['conclusion'] {
  const invalidReason = experimentInvalidReason(baseline, enhanced);
  if (invalidReason === 'diagnostics_schema_noncompliance') return 'diagnostics_schema_noncompliance';
  if (invalidReason === 'insufficient_valid_samples') return 'insufficient_valid_samples';
  if (comparisons.some((comparison) => comparison.classificationAfter === 'true_positive_draft_issue')) return 'true_positive_draft_issue_confirmed';
  const baselineRate = validHardFailRate(baseline);
  const enhancedRate = validHardFailRate(enhanced);
  if (enhancedRate === 0 && (baselineRate ?? 0) > 0) return 'context_fix_helped';
  if (enhancedInsufficientEvidenceCount < baselineInsufficientEvidenceCount) return 'context_fix_helped';
  if ((enhancedRate ?? 0) > 0 && enhancedInsufficientEvidenceCount > 0) return 'diagnostics_prompt_overstrict';
  if ((enhancedRate ?? 0) > 0) return 'requires_revision';
  if (baselineRate === enhancedRate) return 'context_fix_no_change';
  return 'requires_human_review';
}

function recommendedNextStepForContextFix(enhanced: CodexDiagnosticsBenchmarkReport, comparisons: Array<{ classificationAfter: CodexDiagnosticsHardFailureAnalysis['classification'] }>): string {
  if (enhanced.samples.every((sample) => !sample.schemaValid)) {
    return 'Fix diagnostics JSON schema compliance before interpreting enhanced context impact.';
  }
  if (comparisons.some((comparison) => comparison.classificationAfter === 'true_positive_draft_issue')) {
    return 'Treat the remaining hard failure as a draft issue; do not commit until a revision clears diagnostics.';
  }
  if (validHardFailRate(enhanced) === 0) {
    return 'Rerun chapter diagnostics with enhanced context before continuing the controlled commit.';
  }
  return 'Send the chapter to human review or refine diagnostics prompt evidence requirements.';
}

function renderContextFixMarkdown(report: CodexDiagnosticsContextFixReport): string {
  return [
    '# Codex Diagnostics Context Fix Report',
    '',
    `projectId: ${report.projectId}`,
    `chapterNumber: ${report.chapterNumber}`,
    `baselineHardFailRateAmongSchemaValidSamples: ${report.baselineHardFailRateAmongSchemaValidSamples ?? 'null'}`,
    `enhancedHardFailRateAmongSchemaValidSamples: ${report.enhancedHardFailRateAmongSchemaValidSamples ?? 'null'}`,
    `schemaInvalidRate: ${report.schemaInvalidRate}`,
    `experimentValid: ${String(report.experimentValid)}`,
    `experimentInvalidReason: ${report.experimentInvalidReason ?? 'none'}`,
    `baselineFalsePositiveRisk: ${report.baselineFalsePositiveRisk}`,
    `enhancedFalsePositiveRisk: ${report.enhancedFalsePositiveRisk}`,
    `conclusion: ${report.conclusion}`,
    `recommendedNextStep: ${report.recommendedNextStep}`,
    '',
    ...report.hardCheckComparison.map((item) => `- ${item.checkName}: ${item.classificationBefore} -> ${item.classificationAfter}`)
  ].join('\n') + '\n';
}

async function latestBenchmarkByMode(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  contextMode: DiagnosticsContextMode
): Promise<{ relativePath: string; value: CodexDiagnosticsBenchmarkReport } | undefined> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) return undefined;
  const entries = (await fileStore.list(chapterDir)).filter((entry) => /^codex_diagnostics_benchmark_v\d+\.json$/.test(entry));
  const candidates: Array<{ relativePath: string; value: CodexDiagnosticsBenchmarkReport }> = [];
  for (const entry of entries) {
    const relativePath = relativeChapterArtifact(chapterNumber, entry);
    const value = await fileStore.readJson(paths.projectArtifact(relativePath), CodexDiagnosticsBenchmarkReportSchema);
    if (value.contextMode === contextMode) candidates.push({ relativePath, value });
  }
  return candidates.at(-1);
}

async function readPromptMetrics(paths: ProjectPaths, fileStore: FileStore, runId: string): Promise<{
  retryCount: number;
  repairCount: number;
  rawOutputPath: string;
  finalOutputPath: string;
  parsedOutputPath: string;
}> {
  try {
    const manifest = await fileStore.readJson(paths.runManifest(runId), RunManifestSchema);
    if (!isV2(manifest)) return emptyPromptMetrics();
    const latestCall = manifest.promptCalls.at(-1);
    return {
      retryCount: manifest.promptCalls.reduce((sum, call) => sum + (call.retryCount ?? 0), 0),
      repairCount: manifest.promptCalls.filter((call) => call.finishReason === 'repaired').length,
      rawOutputPath: latestCall?.rawOutputPath ?? '',
      finalOutputPath: latestCall?.finalOutputPath ?? '',
      parsedOutputPath: latestCall?.parsedOutputPath ?? ''
    };
  } catch {
    return emptyPromptMetrics();
  }
}

function emptyPromptMetrics() {
  return { retryCount: 0, repairCount: 0, rawOutputPath: '', finalOutputPath: '', parsedOutputPath: '' };
}

async function findLatestDiagnosticsPrompt(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<{
  promptPath: string;
  promptText: string;
  contextManifestPath: string;
  contextBytes: number;
  contextBudgetBytes: number;
}> {
  const manifests = await readRunManifests(paths, fileStore);
  const candidates = manifests
    .flatMap((manifest) =>
      manifest.promptCalls
        .filter((call) => call.promptId === 'diagnostics.diagnose_chapter_slim' && (manifest.resolvedContext.chapterNumber ?? manifest.resolvedContext.resolvedChapterNumber) === chapterNumber)
        .map((call) => ({ manifest, call }))
    )
    .sort((left, right) => (Date.parse(right.call.endedAt) || 0) - (Date.parse(left.call.endedAt) || 0));
  const latest = candidates[0];
  const promptPath = latest?.call.inputArtifactPath ?? '';
  const promptText = promptPath.length > 0 && (await fileStore.exists(paths.projectArtifact(promptPath))) ? await fileStore.readText(paths.projectArtifact(promptPath)) : '';
  return {
    promptPath,
    promptText,
    contextManifestPath: await latestContextManifest(paths, fileStore),
    contextBytes: latest?.call.contextBytes ?? byteLength(promptText),
    contextBudgetBytes: 12_000
  };
}

async function readRunManifests(paths: ProjectPaths, fileStore: FileStore): Promise<RunManifestV2[]> {
  if (!(await fileStore.exists(paths.runsDir()))) return [];
  const manifests: RunManifestV2[] = [];
  for (const runId of await fileStore.list(paths.runsDir())) {
    const manifestPath = paths.runManifest(runId);
    if (!(await fileStore.exists(manifestPath))) continue;
    try {
      const manifest = await fileStore.readJson(manifestPath, RunManifestSchema);
      if (isV2(manifest)) manifests.push(manifest);
    } catch {
      // Project audit reports invalid manifests separately.
    }
  }
  return manifests;
}

function isV2(manifest: RunManifest): manifest is RunManifestV2 {
  return 'schemaVersion' in manifest && manifest.schemaVersion === '2';
}

async function latestContextManifest(paths: ProjectPaths, fileStore: FileStore): Promise<string> {
  const contextDir = paths.projectArtifact(path.posix.join('codex', 'context'));
  if (!(await fileStore.exists(contextDir))) return '';
  const fileName = (await fileStore.list(contextDir)).filter((entry) => /^context_manifest_v\d+\.json$/.test(entry)).at(-1);
  return fileName === undefined ? '' : path.posix.join('codex', 'context', fileName);
}

async function readLatestVersionedJson<T>(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string,
  schema: z.ZodType<T>
): Promise<{ relativePath: string; value: T } | undefined> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) return undefined;
  const fileName = (await fileStore.list(chapterDir)).filter((entry) => new RegExp(`^${baseName}_v\\d+\\.json$`).test(entry)).at(-1);
  if (fileName === undefined) return undefined;
  const relativePath = relativeChapterArtifact(chapterNumber, fileName);
  return { relativePath, value: await fileStore.readJson(paths.projectArtifact(relativePath), schema) };
}

async function readOptionalJson<T>(absolutePath: string, fileStore: FileStore, schema: z.ZodType<T>): Promise<T | undefined> {
  if (!(await fileStore.exists(absolutePath))) return undefined;
  return fileStore.readJson(absolutePath, schema);
}

async function readOptionalText(absolutePath: string, fileStore: FileStore): Promise<string> {
  if (!(await fileStore.exists(absolutePath))) return '';
  return fileStore.readText(absolutePath);
}

async function nextVersionedChapterArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const jsonPath = paths.chapterArtifact(chapterNumber, jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      const mdFile = `${baseName}_v${version}.md`;
      return {
        version,
        jsonPath,
        mdPath: paths.chapterArtifact(chapterNumber, mdFile),
        relativeJsonPath: relativeChapterArtifact(chapterNumber, jsonFile),
        relativeMdPath: relativeChapterArtifact(chapterNumber, mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName}.`);
}

function issueLooksRelated(checkName: CodexDiagnosticsHardCheckName, message: string): boolean {
  const lower = message.toLowerCase();
  if (checkName === 'timeline_consistency') return lower.includes('timeline') || lower.includes('time') || message.includes('时间');
  if (checkName === 'character_knowledge_consistency') return lower.includes('knowledge') || lower.includes('character') || message.includes('知道');
  if (checkName === 'world_rule_consistency') return lower.includes('world') || lower.includes('rule') || message.includes('规则');
  return lower.includes('reveal') || lower.includes('identity') || message.includes('揭示') || message.includes('身份');
}

function likelyCauseForCheck(checkName: CodexDiagnosticsHardCheckName): CodexDiagnosticsLikelyCause {
  if (checkName === 'timeline_consistency') return 'timeline_conflict';
  if (checkName === 'character_knowledge_consistency') return 'character_knowledge_conflict';
  if (checkName === 'world_rule_consistency') return 'world_rule_conflict';
  return 'unplanned_reveal';
}

function suspectedRootCausesFor(hardFailures: CodexDiagnosticsHardFailureAnalysis[], contextAudit: CodexDiagnosticsContextAudit): CodexDiagnosticsLikelyCause[] {
  const causes: CodexDiagnosticsLikelyCause[] = hardFailures.map((failure) => failure.likelyCause);
  if (contextAudit.missingRequiredArtifacts.length > 0) causes.push('diagnostics_missing_context');
  if (hardFailures.some((failure) => failure.classification === 'insufficient_evidence')) causes.push('diagnostics_prompt_overstrict');
  return uniqueStrings(causes) as CodexDiagnosticsLikelyCause[];
}

function falsePositiveRiskFor(hardFailures: CodexDiagnosticsHardFailureAnalysis[], contextAudit: CodexDiagnosticsContextAudit): CodexDiagnosticsHardFailAnalysis['falsePositiveRisk'] {
  const reasons: string[] = [];
  if (contextAudit.missingRequiredArtifacts.length > 0) reasons.push('Diagnostics prompt omitted required continuity context.');
  if (hardFailures.some((failure) => failure.classification === 'insufficient_evidence')) reasons.push('At least one hard failure has no direct supporting evidence.');
  if (hardFailures.some((failure) => failure.classification === 'true_positive_draft_issue')) reasons.push('At least one hard failure is supported by draft evidence.');
  const level = reasons.length === 0 ? 'low' : hardFailures.some((failure) => failure.classification === 'true_positive_draft_issue') ? 'medium' : 'high';
  return { level, reasons };
}

function recommendedFixesFor(hardFailures: CodexDiagnosticsHardFailureAnalysis[], contextAudit: CodexDiagnosticsContextAudit): string[] {
  const fixes = ['Review diagnostics evidence before trying to commit chapter state.'];
  if (contextAudit.missingRequiredArtifacts.length > 0) fixes.push('Rerun diagnostics with story_state summary, reader_state, selected_plan, mission, and draft context.');
  if (hardFailures.some((failure) => failure.classification === 'true_positive_draft_issue')) fixes.push('Use revision loop to rewrite draft passages with supported timeline or continuity conflicts.');
  if (hardFailures.some((failure) => failure.classification === 'insufficient_evidence')) fixes.push('Do not treat generic hard-check failures as canonical draft defects until evidence is available.');
  return uniqueStrings(fixes);
}

function summarizeReaderState(storyState: StoryState): string {
  return JSON.stringify({
    known: storyState.readerState.readerKnows.slice(-8),
    suspects: storyState.readerState.readerSuspects.slice(-8),
    expectations: storyState.readerState.readerExpectations.slice(-8)
  });
}

function summarizeSoftScores(report: DiagnosticsReport): CodexDiagnosticsHardFailAnalysis['softScoreSummary'] {
  const entries = Object.entries(report.soft_scores);
  const values = entries.map(([, score]) => score);
  return {
    averageScore: roundOne(average(values)),
    minScore: values.length === 0 ? 0 : Math.min(...values),
    maxScore: values.length === 0 ? 0 : Math.max(...values),
    scores: Object.fromEntries(entries)
  };
}

function renderContextAuditMarkdown(report: CodexDiagnosticsContextAudit): string {
  return [
    '# Diagnostics Context Audit',
    '',
    `projectId: ${report.projectId}`,
    `chapterNumber: ${report.chapterNumber}`,
    `contextBytes: ${report.contextBytes}`,
    `missingRequiredArtifacts: ${report.missingRequiredArtifacts.join(', ') || 'none'}`,
    `contextTruncated: ${String(report.contextTruncated)}`
  ].join('\n') + '\n';
}

function renderAnalysisMarkdown(report: CodexDiagnosticsHardFailAnalysis): string {
  return [
    '# Codex Diagnostics Hard-Fail Analysis',
    '',
    `projectId: ${report.projectId}`,
    `chapterNumber: ${report.chapterNumber}`,
    `contextMode: ${report.contextMode}`,
    `contextFixReportPath: ${report.contextFixReportPath ?? 'none'}`,
    `hardFailures: ${report.hardFailures.length}`,
    `falsePositiveRisk: ${report.falsePositiveRisk.level}`,
    '',
    ...report.hardFailures.map((failure) => `- ${failure.checkName}: ${failure.classification}; ${failure.likelyCause}`)
  ].join('\n') + '\n';
}

function renderRevisionOpportunityMarkdown(report: RevisionOpportunityReport): string {
  return [
    '# Revision Opportunity Report',
    '',
    `projectId: ${report.projectId}`,
    `chapterNumber: ${report.chapterNumber}`,
    `canRepairByLocalInstruction: ${String(report.canRepairByLocalInstruction)}`,
    `requiresHumanReview: ${String(report.requiresHumanReview)}`,
    `suggestedRetryCommand: ${report.suggestedRetryCommand}`
  ].join('\n') + '\n';
}

function renderBenchmarkMarkdown(report: CodexDiagnosticsBenchmarkReport): string {
  return [
    '# Codex Diagnostics Benchmark',
    '',
    `projectId: ${report.projectId}`,
    `chapterNumber: ${report.chapterNumber}`,
    `contextMode: ${report.contextMode}`,
    `diagnosticsContextManifestPath: ${report.diagnosticsContextManifestPath ?? 'none'}`,
    `contextFixReportPath: ${report.contextFixReportPath ?? 'none'}`,
    `sampleCount: ${report.sampleCount}`,
    `observedFailureRateAllSamples: ${report.observedFailureRateAllSamples}`,
    `hardFailRateAmongSchemaValidSamples: ${report.hardFailRateAmongSchemaValidSamples ?? 'null'}`,
    `experimentValid: ${String(report.experimentValid)}`,
    `experimentInvalidReason: ${report.experimentInvalidReason ?? 'none'}`,
    `schemaValidRate: ${report.schemaValidRate}`,
    `stableFailure: ${String(report.stableFailure)}`,
    `recommendation: ${report.recommendation}`
  ].join('\n') + '\n';
}

function uniqueEvidence(items: CodexDiagnosticsEvidence[]): CodexDiagnosticsEvidence[] {
  const seen = new Set<string>();
  const result: CodexDiagnosticsEvidence[] = [];
  for (const item of items) {
    const key = `${item.source}:${item.path}:${item.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function uniqueStrings<T extends string>(items: T[]): T[] {
  return [...new Set(items)];
}

function snippetAround(text: string, index: number): string {
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + 130);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function confidenceForKeyword(keyword: string): 'low' | 'medium' | 'high' {
  if (keyword.includes(':') || /[\u4e00-\u9fff]/u.test(keyword)) return 'high';
  return keyword.length >= 6 ? 'medium' : 'low';
}

function summarizeText(text: string, limit = 6000): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}...`;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validHardFailCount(report: CodexDiagnosticsBenchmarkReport): number {
  return report.samples.filter((sample) => sample.schemaValid && !sample.passed).length;
}

function validHardFailRate(report: CodexDiagnosticsBenchmarkReport): number | null {
  const validCount = report.samples.filter((sample) => sample.schemaValid).length;
  return validCount === 0 ? null : rate(validHardFailCount(report), validCount);
}

function experimentInvalidReason(
  baseline: CodexDiagnosticsBenchmarkReport,
  enhanced: CodexDiagnosticsBenchmarkReport
): 'diagnostics_schema_noncompliance' | 'insufficient_valid_samples' | null {
  const baselineValidCount = baseline.samples.filter((sample) => sample.schemaValid).length;
  const enhancedValidCount = enhanced.samples.filter((sample) => sample.schemaValid).length;
  if (baselineValidCount === 0 || enhancedValidCount === 0) return 'diagnostics_schema_noncompliance';
  if (baselineValidCount < Math.min(2, baseline.samples.length) || enhancedValidCount < Math.min(2, enhanced.samples.length)) {
    return 'insufficient_valid_samples';
  }
  return null;
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(4));
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.posix.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, ...segments);
}

function suggestedRetryCommand(projectIdValue: string, chapterNumber: number): string {
  return `corepack pnpm novel-loop chapter ${projectIdValue} ${chapterNumber} --provider codex-text --resume-from revision_plan --max-revisions 2 --commit`;
}

function suggestedReviewCommand(projectIdValue: string, chapterNumber: number): string {
  return `corepack pnpm novel-loop review ${projectIdValue} ${chapterNumber} --diagnostics --artifacts --suggest-next`;
}
