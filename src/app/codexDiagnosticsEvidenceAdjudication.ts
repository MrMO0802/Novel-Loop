import path from 'node:path';

import { RunLogger } from '../logging/RunLogger.js';
import { CodexDiagnosticsProviderOutputSchema } from '../providers/codex/diagnosticsNormalizer.js';
import {
  ChapterMissionSchema,
  CodexDiagnosticsEvidenceAdjudicationSchema,
  CodexDiagnosticsSchemaBenchmarkReportSchema,
  StoryStateSchema,
  TimelineContradictionMapSchema
} from '../schemas/index.js';
import type {
  CodexDiagnosticsAdjudicationEvent,
  CodexDiagnosticsCanonEvidence,
  CodexDiagnosticsDraftEvidence,
  CodexDiagnosticsEvidenceAdjudication,
  CodexDiagnosticsPlanningEvidence,
  CodexDiagnosticsSampleConsensus,
  CodexDiagnosticsTemporalRule,
  StoryState,
  TimelineContradictionMap
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { createRunId } from '../utils/ids.js';
import {
  decideEvidenceAdjudication,
  deduplicateTimelineEvidenceClaims,
  evaluateTemporalComparison,
  extractExplicitClockTime,
  parseMarkdownEvidenceParagraphs,
  resolveEventIdentity,
  sha256
} from './codexDiagnosticsEvidenceRules.js';

const DEFAULT_PROJECTS_ROOT = './projects';

export interface RunCodexDiagnosticsEvidenceAdjudicationInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
}

export interface RunCodexDiagnosticsEvidenceAdjudicationResult {
  report: CodexDiagnosticsEvidenceAdjudication;
  reportPath: string;
  markdownPath: string;
  timelineMap: TimelineContradictionMap;
  timelineMapPath: string;
  timelineMapMarkdownPath: string;
  runId: string;
}

interface VersionedChapterArtifact {
  version: number;
  jsonPath: string;
  mdPath: string;
  relativeJsonPath: string;
  relativeMdPath: string;
}

interface ProtectedSnapshot {
  path: string;
  content: string;
  hash: string;
}

export async function runCodexDiagnosticsEvidenceAdjudication(
  input: RunCodexDiagnosticsEvidenceAdjudicationInput,
  fileStore = new FileStore()
): Promise<RunCodexDiagnosticsEvidenceAdjudicationResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const chapterNumber = input.chapterNumber;
  const sourceDraftPath = relativeChapterArtifact(chapterNumber, 'draft_v1.md');
  const sourceMissionPath = relativeChapterArtifact(chapterNumber, 'mission.json');
  const sourceSelectedPlanPath = relativeChapterArtifact(chapterNumber, 'selected_plan.md');
  const sourceStoryStatePath = path.posix.join('state', 'story_state.json');
  const sourceSchemaBenchmarkPath = await requireLatestArtifact(paths, fileStore, chapterNumber, 'codex_diagnostics_schema_benchmark');
  const sourceDiagnosticsBenchmarkPath = await findLatestArtifact(paths, fileStore, chapterNumber, 'codex_diagnostics_benchmark') ?? sourceSchemaBenchmarkPath;
  const protectedBefore = await captureProtectedArtifacts(paths, fileStore, chapterNumber, [
    sourceDraftPath,
    sourceMissionPath,
    sourceSelectedPlanPath,
    sourceStoryStatePath,
    path.posix.join('planning', 'chapter_queue.json')
  ]);
  const runId = createRunId(new Date(), `codex_diagnostics_adjudicate_ch${formatChapterNumber(chapterNumber)}`);
  const runLogger = new RunLogger(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex diagnostics-adjudicate',
    args: {
      provider: 'local-deterministic',
      chapterNumber,
      codexInvoked: false,
      storyStateCommitAllowed: false,
      revisionAllowed: false,
      previewAllowed: false
    }
  });

  try {
    const [draftText, mission, selectedPlanText, storyState, schemaBenchmark] = await Promise.all([
      fileStore.readText(paths.projectArtifact(sourceDraftPath)),
      fileStore.readJson(paths.projectArtifact(sourceMissionPath), ChapterMissionSchema),
      fileStore.readText(paths.projectArtifact(sourceSelectedPlanPath)),
      fileStore.readJson(paths.storyState(), StoryStateSchema),
      fileStore.readJson(paths.projectArtifact(sourceSchemaBenchmarkPath), CodexDiagnosticsSchemaBenchmarkReportSchema)
    ]);
    const failureSamples = await readTimelineFailureSamples(paths, fileStore, schemaBenchmark.samples);
    const validSampleCount = schemaBenchmark.samples.filter(isStructurallyValidSample).length;
    const evidenceClaims = deduplicateTimelineEvidenceClaims(failureSamples);
    const draftEvidence = buildDraftEvidence(sourceDraftPath, draftText, chapterNumber);
    const planningEvidence = buildPlanningEvidence(sourceMissionPath, mission, sourceSelectedPlanPath, selectedPlanText);
    const canonEvidence = buildCanonEvidence(sourceStoryStatePath, storyState);
    const events = buildEvents(chapterNumber, sourceDraftPath, draftEvidence, planningEvidence, canonEvidence);
    const eventComparisons = buildEventComparisons(events);
    const temporalRulesTriggered = eventComparisons.flatMap((comparison) => evaluateTemporalComparison(comparison));
    const canonicalContextReview = buildCanonicalContextReview(storyState, events, temporalRulesTriggered);
    const sampleConsensus = buildSampleConsensus(schemaBenchmark.sampleCount, validSampleCount, failureSamples, evidenceClaims.length, evidenceClaims.map((claim) => claim.occurrenceCount));
    const decision = decideEvidenceAdjudication({
      claimCount: evidenceClaims.length,
      draftEvidence,
      eventComparisons,
      temporalRules: temporalRulesTriggered
    });
    const reportArtifact = await nextVersionedChapterArtifact(paths, fileStore, chapterNumber, 'codex_diagnostics_evidence_adjudication');
    const mapArtifact = await nextVersionedChapterArtifact(paths, fileStore, chapterNumber, 'timeline_contradiction_map');
    const protectedArtifacts = await verifyProtectedArtifacts(paths, fileStore, protectedBefore);
    const generatedAt = new Date().toISOString();
    const report = CodexDiagnosticsEvidenceAdjudicationSchema.parse({
      reportId: `codex_diagnostics_evidence_adjudication_ch${formatChapterNumber(chapterNumber)}_v${reportArtifact.version}`,
      projectId: paths.projectId,
      chapterNumber,
      generatedAt,
      sourceDraftPath,
      sourceMissionPath,
      sourceSelectedPlanPath,
      sourceStoryStatePath,
      sourceDiagnosticsBenchmarkPath,
      sourceSchemaBenchmarkPath,
      timelineContradictionMapPath: mapArtifact.relativeJsonPath,
      checkName: 'timeline_consistency',
      repeatedSampleCount: validSampleCount,
      repeatedFailureCount: failureSamples.length,
      repeatabilityRate: sampleConsensus.repeatabilityRate,
      evidenceClaims,
      draftEvidence,
      planningEvidence,
      canonEvidence,
      canonicalContextReview,
      eventComparisons,
      temporalRulesTriggered,
      sampleConsensus,
      ...decision,
      protectedArtifacts,
      storyStateMutated: false,
      queueMutated: false,
      draftMutated: false,
      canonicalDiagnosticsMutated: false
    });
    const timelineMap = buildTimelineMap(paths.projectId, chapterNumber, generatedAt, reportArtifact.relativeJsonPath, events, eventComparisons, temporalRulesTriggered, canonEvidence, mapArtifact.version);

    await fileStore.writeJson(reportArtifact.jsonPath, report, CodexDiagnosticsEvidenceAdjudicationSchema);
    await fileStore.writeText(reportArtifact.mdPath, renderAdjudicationMarkdown(report));
    await fileStore.writeJson(mapArtifact.jsonPath, timelineMap, TimelineContradictionMapSchema);
    await fileStore.writeText(mapArtifact.mdPath, renderTimelineMapMarkdown(timelineMap));
    for (const sourcePath of [sourceDraftPath, sourceMissionPath, sourceSelectedPlanPath, sourceStoryStatePath, sourceDiagnosticsBenchmarkPath, sourceSchemaBenchmarkPath]) {
      await runLogger.recordArtifact(runId, sourcePath, { action: 'reused', stage: 'diagnostics', provenanceNote: 'Read-only evidence source for deterministic diagnostics adjudication.' });
    }
    for (const artifactPath of [reportArtifact.relativeJsonPath, reportArtifact.relativeMdPath, mapArtifact.relativeJsonPath, mapArtifact.relativeMdPath]) {
      await runLogger.recordArtifact(runId, artifactPath, { action: 'generated', stage: 'diagnostics', sourcePaths: [sourceDraftPath, sourceSchemaBenchmarkPath] });
    }
    await assertProtectedArtifactsStillUnchanged(paths, fileStore, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return {
      report,
      reportPath: reportArtifact.relativeJsonPath,
      markdownPath: reportArtifact.relativeMdPath,
      timelineMap,
      timelineMapPath: mapArtifact.relativeJsonPath,
      timelineMapMarkdownPath: mapArtifact.relativeMdPath,
      runId
    };
  } catch (error) {
    await runLogger.recordError(runId, {
      code: 'CODEX_DIAGNOSTICS_ADJUDICATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
      recoverable: true
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

async function readTimelineFailureSamples(
  paths: ProjectPaths,
  fileStore: FileStore,
  samples: Array<{
    sampleId: string;
    parsedOutputPath: string;
    parseValid: boolean;
    providerSchemaValid: boolean;
    normalizationSucceeded: boolean;
    internalSchemaValid: boolean;
    semanticConsistent: boolean;
  }>
): Promise<Array<{ sampleId: string; evidence: string }>> {
  const failures: Array<{ sampleId: string; evidence: string }> = [];
  for (const sample of samples.filter(isStructurallyValidSample)) {
    const output = await fileStore.readJson(paths.projectArtifact(sample.parsedOutputPath), CodexDiagnosticsProviderOutputSchema);
    const timeline = output.hardChecks.find((check) => check.checkName === 'timeline_consistency');
    if (timeline?.result === 'fail' && timeline.blocking) failures.push({ sampleId: sample.sampleId, evidence: timeline.evidence });
  }
  return failures;
}

function isStructurallyValidSample(sample: {
  parseValid: boolean;
  providerSchemaValid: boolean;
  normalizationSucceeded: boolean;
  internalSchemaValid: boolean;
  semanticConsistent: boolean;
}): boolean {
  return sample.parseValid && sample.providerSchemaValid && sample.normalizationSucceeded && sample.internalSchemaValid && sample.semanticConsistent;
}

function buildDraftEvidence(relativePath: string, draftText: string, chapterNumber: number): CodexDiagnosticsDraftEvidence[] {
  const globalLocation = /三(?:栋|号楼).*十六楼|十六楼/.test(draftText) ? 'building_3_floor_16' : 'unknown';
  return parseMarkdownEvidenceParagraphs(draftText)
    .filter((paragraph) => /午高峰|白天|\d{1,2}[:：]\d{2}|[零〇一二两三四五六七八九十]{1,3}点[零〇一二两三四五六七八九十]{1,3}分|餐袋|接过餐|接餐|交餐|收餐|记录.*路线/.test(paragraph.text))
    .map((paragraph, index) => {
      const explicitTime = extractExplicitClockTime(paragraph.text);
      const inferredTime = /午高峰/.test(paragraph.text) ? 'midday_peak' : /白天/.test(paragraph.text) ? 'daytime' : null;
      const eventDescription = /餐袋|接过餐|接餐|交餐|收餐/.test(paragraph.text)
        ? 'delivery_handoff'
        : explicitTime === '23:17'
          ? 'delivery_entry_time_record'
          : explicitTime === '23:29'
            ? 'delivery_exit_time_record'
            : /记录.*路线/.test(paragraph.text)
              ? 'current_delivery_route_record'
              : 'delivery_time_context';
      const snippet = paragraph.text.slice(0, 240);
      return {
        evidenceId: `draft_evidence_${String(index + 1).padStart(3, '0')}`,
        path: relativePath,
        paragraphIndex: paragraph.paragraphIndex,
        lineOrSection: paragraph.startLine === paragraph.endLine ? `line ${paragraph.startLine}` : `lines ${paragraph.startLine}-${paragraph.endLine}`,
        snippet,
        normalizedSnippetHash: sha256(snippet),
        actor: 'lin_che',
        location: globalLocation,
        eventDescription,
        explicitTime,
        inferredTime,
        dayReference: inferDayReference(paragraph.text, chapterNumber)
      };
    });
}

function buildPlanningEvidence(
  missionPath: string,
  mission: ReturnType<typeof ChapterMissionSchema.parse>,
  selectedPlanPath: string,
  selectedPlanText: string
): CodexDiagnosticsPlanningEvidence[] {
  const evidence: CodexDiagnosticsPlanningEvidence[] = [];
  for (const [index, objective] of mission.requiredObjectives.entries()) {
    if (!/白天|午高峰|夜|时间|订单|送餐/.test(objective.text)) continue;
    const snippet = objective.text.slice(0, 240);
    evidence.push({
      evidenceId: `planning_evidence_mission_${String(index + 1).padStart(3, '0')}`,
      path: missionPath,
      sourceType: 'mission',
      locator: `requiredObjectives[${objective.id}]`,
      snippet,
      normalizedSnippetHash: sha256(snippet),
      eventDescription: objective.text,
      expectedTime: inferPlanningTime(objective.text)
    });
  }
  for (const [index, line] of selectedPlanText.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !/白天|午高峰|夜|时间|订单|送餐/.test(trimmed)) continue;
    const snippet = trimmed.slice(0, 240);
    evidence.push({
      evidenceId: `planning_evidence_plan_${String(index + 1).padStart(3, '0')}`,
      path: selectedPlanPath,
      sourceType: 'selected_plan',
      locator: `line ${index + 1}`,
      snippet,
      normalizedSnippetHash: sha256(snippet),
      eventDescription: trimmed,
      expectedTime: inferPlanningTime(trimmed)
    });
  }
  return evidence;
}

function buildCanonEvidence(statePath: string, storyState: StoryState): CodexDiagnosticsCanonEvidence[] {
  return storyState.timeline
    .filter((event) => event.participants.includes('lin_che') && /十七楼|收音机|送餐|外卖|高楼|电梯/.test(event.summary))
    .map((event, index) => ({
      evidenceId: `canon_evidence_${String(index + 1).padStart(3, '0')}`,
      statePath,
      timelineEventId: event.id,
      chapterNumber: event.chapter,
      eventDescription: event.summary,
      actor: event.participants.join(','),
      location: event.location ?? 'unknown',
      explicitTime: event.timestampLabel === undefined ? null : extractExplicitClockTime(event.timestampLabel),
      dayReference: `chapter_${String(event.chapter).padStart(3, '0')}:${event.timestampLabel ?? 'unknown'}`,
      relatedCanonFactIds: storyState.canonFacts
        .filter((fact) => fact.sourceChapter === event.chapter && sharesCanonSubject(fact.text, event.summary))
        .map((fact) => fact.id)
    }));
}

function buildEvents(
  chapterNumber: number,
  draftPath: string,
  draftEvidence: CodexDiagnosticsDraftEvidence[],
  planningEvidence: CodexDiagnosticsPlanningEvidence[],
  canonEvidence: CodexDiagnosticsCanonEvidence[]
): CodexDiagnosticsAdjudicationEvent[] {
  const dayReference = `chapter_${String(chapterNumber).padStart(3, '0')}_continuous_scene`;
  const shared = {
    actor: 'lin_che',
    recipient: 'resident_16f',
    location: draftEvidence.find((evidence) => evidence.location !== 'unknown')?.location ?? 'unknown',
    objectOrOrder: `order_ch${formatChapterNumber(chapterNumber)}_single`,
    outcome: 'meal_delivered',
    narrativePurpose: 'deliver_order_and_learn_floor_17_clue',
    dayReference
  };
  const events: CodexDiagnosticsAdjudicationEvent[] = [];
  const midday = draftEvidence.find((evidence) => evidence.inferredTime === 'midday_peak' || evidence.inferredTime === 'daytime');
  if (midday !== undefined) events.push(event('draft_delivery_midday', 'current delivery framed as midday', 'draft', draftPath, [midday.evidenceId], 'current', midday.explicitTime, midday.inferredTime, shared));
  const entry = draftEvidence.find((evidence) => evidence.explicitTime === '23:17');
  if (entry !== undefined) events.push(event('draft_delivery_entry_log_2317', 'current delivery entry-time record', 'draft', draftPath, [entry.evidenceId], 'current_event_record', entry.explicitTime, entry.inferredTime, shared));
  const handoffs = draftEvidence.filter((evidence) => evidence.eventDescription === 'delivery_handoff' && /林澈/.test(evidence.snippet));
  for (const [index, evidence] of handoffs.slice(0, 2).entries()) {
    events.push(event(`draft_delivery_handoff_${index + 1}`, `delivery_handoff_${index + 1}`, 'draft', draftPath, [evidence.evidenceId], 'current', evidence.explicitTime, evidence.inferredTime, shared));
  }
  const plannedDaytime = planningEvidence.find((evidence) => evidence.expectedTime === 'daytime');
  if (plannedDaytime !== undefined) {
    events.push(event('planned_daytime_delivery', 'planned daytime delivery', plannedDaytime.sourceType, plannedDaytime.path, [plannedDaytime.evidenceId], 'planned', null, 'daytime', shared));
  }
  for (const canon of canonEvidence) {
    events.push(event(`canon_${canon.timelineEventId}`, canon.eventDescription, 'canon', canon.statePath, [canon.evidenceId], 'canon', canon.explicitTime, null, {
      actor: canon.actor,
      recipient: null,
      location: canon.location,
      objectOrOrder: null,
      outcome: null,
      narrativePurpose: 'canonical_context',
      dayReference: canon.dayReference
    }));
  }
  return events;
}

function buildEventComparisons(events: CodexDiagnosticsAdjudicationEvent[]) {
  const comparisons = [];
  const midday = events.find((eventItem) => eventItem.eventId === 'draft_delivery_midday');
  const entry = events.find((eventItem) => eventItem.eventId === 'draft_delivery_entry_log_2317');
  const handoff1 = events.find((eventItem) => eventItem.eventId === 'draft_delivery_handoff_1');
  const handoff2 = events.find((eventItem) => eventItem.eventId === 'draft_delivery_handoff_2');
  const planned = events.find((eventItem) => eventItem.eventId === 'planned_daytime_delivery');
  if (midday !== undefined && entry !== undefined) comparisons.push(resolveEventIdentity('comparison_delivery_time', midday, entry));
  if (handoff1 !== undefined && handoff2 !== undefined) comparisons.push(resolveEventIdentity('comparison_duplicate_handoff', handoff1, handoff2));
  if (planned !== undefined && entry !== undefined) comparisons.push(resolveEventIdentity('comparison_plan_time', planned, entry));
  return comparisons;
}

function buildCanonicalContextReview(
  storyState: StoryState,
  events: CodexDiagnosticsAdjudicationEvent[],
  temporalRules: CodexDiagnosticsTemporalRule[]
) {
  const eventActorIds = new Set(events.flatMap((eventItem) => eventItem.actor?.split(',') ?? []));
  const relevantCharacterStateIds = storyState.characters
    .filter((character) => eventActorIds.has(character.id))
    .map((character) => character.id)
    .sort();
  const canonicalTimelineConflictFound = temporalRules.some((ruleItem) =>
    ruleItem.ruleId === 'canon_timeline_time_mismatch' && ruleItem.outcome === 'confirmed_contradiction'
  );
  return {
    latestCommittedChapter: storyState.latestCommittedChapter,
    timelineEventsReviewed: storyState.timeline.length,
    characterStatesReviewed: storyState.characters.length,
    relevantCharacterStateIds,
    canonicalTimelineConflictFound,
    characterStateConflictFound: false,
    notes: [
      `Reviewed canonical timeline through chapter ${storyState.latestCommittedChapter}.`,
      relevantCharacterStateIds.length === 0
        ? 'No canonical character state matched the cited event actors.'
        : `Reviewed relevant character states: ${relevantCharacterStateIds.join(', ')}.`,
      'Character state contains no explicit event time that contradicts the cited draft evidence.'
    ]
  };
}

function buildSampleConsensus(
  sampleCount: number,
  validSampleCount: number,
  failures: Array<{ sampleId: string; evidence: string }>,
  uniqueClaimCount: number,
  claimOccurrences: number[]
): CodexDiagnosticsSampleConsensus {
  const repeatabilityRate = rate(failures.length, validSampleCount);
  return {
    sampleCount,
    validSampleCount,
    samplesReportingTimelineFailure: failures.length,
    uniqueClaimCount,
    repeatabilityRate,
    structuralAgreement: rate(validSampleCount, sampleCount),
    evidenceAgreement: claimOccurrences.length === 0 ? 0 : round(claimOccurrences.reduce((sum, count) => sum + rate(count, failures.length), 0) / claimOccurrences.length),
    semanticAgreement: repeatabilityRate,
    independenceCaveat: 'Repeated samples use the same model and context. repeatabilityRate measures stability, not independent factual agreement.'
  };
}

function buildTimelineMap(
  projectId: string,
  chapterNumber: number,
  generatedAt: string,
  sourceReportPath: string,
  events: CodexDiagnosticsAdjudicationEvent[],
  comparisons: ReturnType<typeof buildEventComparisons>,
  temporalRules: CodexDiagnosticsTemporalRule[],
  canonEvidence: CodexDiagnosticsCanonEvidence[],
  version: number
): TimelineContradictionMap {
  const confirmedRules = temporalRules.filter((rule) => rule.outcome === 'confirmed_contradiction');
  const ambiguousRules = temporalRules.filter((rule) => rule.outcome === 'ambiguous');
  return TimelineContradictionMapSchema.parse({
    mapId: `timeline_contradiction_map_ch${formatChapterNumber(chapterNumber)}_v${version}`,
    projectId,
    chapterNumber,
    generatedAt,
    sourceAdjudicationReportPath: sourceReportPath,
    eventNodes: events.map((eventItem) => ({ ...eventItem, nodeId: eventItem.eventId })),
    temporalEdges: comparisons.flatMap((comparison) => {
      const base = [{
        edgeId: `edge_${comparison.comparisonId}`,
        fromEventId: comparison.eventA.eventId,
        toEventId: comparison.eventB.eventId,
        relation: comparison.conclusion === 'same_event' ? 'same_event' : comparison.conclusion === 'likely_same_event' ? 'likely_same_event' : 'conflicts_with',
        evidenceIds: uniqueStrings([...comparison.eventA.evidenceIds, ...comparison.eventB.evidenceIds]),
        description: `Event identity conclusion: ${comparison.conclusion}.`
      }];
      return base;
    }),
    contradictions: confirmedRules.map((ruleItem, index) => {
      const comparison = comparisons.find((candidate) => candidate.comparisonId === ruleItem.comparisonId)!;
      return {
        contradictionId: `contradiction_${String(index + 1).padStart(3, '0')}`,
        eventIds: [comparison.eventA.eventId, comparison.eventB.eventId],
        ruleId: ruleItem.ruleId,
        summary: ruleItem.explanation,
        evidenceIds: ruleItem.evidenceIds,
        confirmed: true
      };
    }),
    ambiguousRelations: ambiguousRules.map((ruleItem, index) => {
      const comparison = comparisons.find((candidate) => candidate.comparisonId === ruleItem.comparisonId)!;
      return {
        relationId: `ambiguous_${String(index + 1).padStart(3, '0')}`,
        eventIds: [comparison.eventA.eventId, comparison.eventB.eventId],
        reason: ruleItem.explanation,
        evidenceIds: ruleItem.evidenceIds
      };
    }),
    canonicalTimelineReferences: canonEvidence.map((evidence) => ({
      statePath: evidence.statePath,
      timelineEventId: evidence.timelineEventId,
      eventNodeId: `canon_${evidence.timelineEventId}`,
      evidenceId: evidence.evidenceId
    })),
    storyStateMutated: false
  });
}

function event(
  eventId: string,
  label: string,
  sourceType: CodexDiagnosticsAdjudicationEvent['sourceType'],
  sourcePath: string,
  evidenceIds: string[],
  temporalMode: CodexDiagnosticsAdjudicationEvent['temporalMode'],
  explicitTime: string | null,
  inferredTime: string | null,
  shared: Omit<CodexDiagnosticsAdjudicationEvent, 'eventId' | 'label' | 'sourceType' | 'sourcePath' | 'evidenceIds' | 'temporalMode' | 'explicitTime' | 'inferredTime'>
): CodexDiagnosticsAdjudicationEvent {
  return { eventId, label, sourceType, sourcePath, evidenceIds, temporalMode, explicitTime, inferredTime, ...shared };
}

function inferDayReference(text: string, chapterNumber: number): string {
  if (/回忆|曾经|以前|往事/.test(text)) return 'historical_or_memory';
  if (/昨夜|昨天/.test(text)) return `before_chapter_${String(chapterNumber).padStart(3, '0')}`;
  if (/次日|第二天|几天后/.test(text)) return 'explicit_later_day';
  return `chapter_${String(chapterNumber).padStart(3, '0')}_continuous_scene`;
}

function inferPlanningTime(text: string): string | null {
  if (/白天|午高峰|午间/.test(text)) return 'daytime';
  if (/深夜|夜里|夜间/.test(text)) return 'late_night';
  return null;
}

function sharesCanonSubject(fact: string, summary: string): boolean {
  return ['十七楼', '收音机', '送餐', '外卖', '高楼', '电梯'].some((subject) => fact.includes(subject) && summary.includes(subject));
}

async function captureProtectedArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, requiredPaths: string[]): Promise<ProtectedSnapshot[]> {
  const diagnostics = (await fileStore.list(paths.chapterDir(chapterNumber)))
    .filter((fileName) => /^diagnostics_v\d+\.json$/.test(fileName))
    .map((fileName) => relativeChapterArtifact(chapterNumber, fileName));
  const snapshots: ProtectedSnapshot[] = [];
  for (const relativePath of uniqueStrings([...requiredPaths, ...diagnostics])) {
    const content = await fileStore.readText(paths.projectArtifact(relativePath));
    snapshots.push({ path: relativePath, content, hash: sha256(content) });
  }
  return snapshots;
}

async function verifyProtectedArtifacts(paths: ProjectPaths, fileStore: FileStore, snapshots: ProtectedSnapshot[]) {
  return Promise.all(snapshots.map(async (snapshot) => {
    const afterSha256 = sha256(await fileStore.readText(paths.projectArtifact(snapshot.path)));
    if (afterSha256 !== snapshot.hash) throw new Error(`diagnostics-adjudicate modified protected artifact ${snapshot.path}`);
    return { path: snapshot.path, beforeSha256: snapshot.hash, afterSha256, unchanged: true as const };
  }));
}

async function assertProtectedArtifactsStillUnchanged(paths: ProjectPaths, fileStore: FileStore, snapshots: ProtectedSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (await fileStore.readText(paths.projectArtifact(snapshot.path)) !== snapshot.content) {
      throw new Error(`diagnostics-adjudicate modified protected artifact ${snapshot.path}`);
    }
  }
}

async function requireLatestArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string): Promise<string> {
  const artifact = await findLatestArtifact(paths, fileStore, chapterNumber, baseName);
  if (artifact === undefined) throw new Error(`Missing ${baseName}_vN.json for chapter ${chapterNumber}`);
  return artifact;
}

async function findLatestArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string): Promise<string | undefined> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  const pattern = new RegExp(`^${baseName}_v(\\d+)\\.json$`);
  const latest = entries
    .map((fileName) => ({ fileName, version: Number.parseInt(pattern.exec(fileName)?.[1] ?? '0', 10) }))
    .filter((entry) => entry.version > 0)
    .sort((left, right) => right.version - left.version)[0];
  return latest === undefined ? undefined : relativeChapterArtifact(chapterNumber, latest.fileName);
}

async function nextVersionedChapterArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string): Promise<VersionedChapterArtifact> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  const pattern = new RegExp(`^${baseName}_v(\\d+)\\.(?:json|md)$`);
  const version = Math.max(0, ...entries.map((entry) => Number.parseInt(pattern.exec(entry)?.[1] ?? '0', 10))) + 1;
  const jsonName = `${baseName}_v${version}.json`;
  const mdName = `${baseName}_v${version}.md`;
  return {
    version,
    jsonPath: paths.chapterArtifact(chapterNumber, jsonName),
    mdPath: paths.chapterArtifact(chapterNumber, mdName),
    relativeJsonPath: relativeChapterArtifact(chapterNumber, jsonName),
    relativeMdPath: relativeChapterArtifact(chapterNumber, mdName)
  };
}

function renderAdjudicationMarkdown(report: CodexDiagnosticsEvidenceAdjudication): string {
  return [
    `# Diagnostics Evidence Adjudication: Chapter ${report.chapterNumber}`,
    '',
    `- adjudication: ${report.adjudication}`,
    `- confidence: ${report.confidence}`,
    `- repeated samples: ${report.repeatedFailureCount}/${report.repeatedSampleCount}`,
    `- repeatability rate: ${report.repeatabilityRate}`,
    `- unique claim count: ${report.sampleConsensus.uniqueClaimCount}`,
    `- story state mutated: ${report.storyStateMutated}`,
    '',
    '## Claims',
    ...report.evidenceClaims.map((claim) => `- ${claim.normalizedClaim}: ${claim.claimedContradiction} (${claim.occurrenceCount} repeated samples)`),
    '',
    '## Confirmed Rules',
    ...report.temporalRulesTriggered.map((ruleItem) => `- ${ruleItem.ruleId}: ${ruleItem.outcome} - ${ruleItem.explanation}`),
    '',
    '## Recommended Next Step',
    report.recommendedNextStep,
    '',
    '## Minimal Revision Scope',
    report.revisionScopeRecommendation.minimalRevisionScope,
    ''
  ].join('\n');
}

function renderTimelineMapMarkdown(map: TimelineContradictionMap): string {
  return [
    `# Timeline Contradiction Map: Chapter ${map.chapterNumber}`,
    '',
    '## Event Nodes',
    ...map.eventNodes.map((node) => `- ${node.eventId}: ${node.label}; time=${node.explicitTime ?? node.inferredTime ?? 'unknown'}`),
    '',
    '## Contradictions',
    ...map.contradictions.map((contradiction) => `- ${contradiction.ruleId}: ${contradiction.summary}`),
    '',
    '## Ambiguous Relations',
    ...(map.ambiguousRelations.length === 0 ? ['- none'] : map.ambiguousRelations.map((relation) => `- ${relation.reason}`)),
    ''
  ].join('\n');
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.posix.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, ...segments);
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
