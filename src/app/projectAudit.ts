import path from 'node:path';

import {
  ArchiveManifestSchema,
  ArtifactIndexSchema,
  CanonPatchSchema,
  ChapterQueueSchema,
  ChapterContextSummarySchema,
  BuildBibleCacheReportSchema,
  CodexCallReductionReportSchema,
  CodexChapterRegressionAnalysisSchema,
  CodexChapterQualityReportSchema,
  CodexBudgetReportSchema,
  CodexBusinessOptimizationPlanSchema,
  CodexCommitConsistencyReportSchema,
  CodexContextManifestSchema,
  CodexDiagnosticsBenchmarkReportSchema,
  CodexDiagnosticsContextFixReportSchema,
  CodexDiagnosticsEvidenceAdjudicationSchema,
  CodexDiagnosticsSchemaBenchmarkReportSchema,
  CodexDiagnosticsContextAuditSchema,
  CodexDiagnosticsHardFailAnalysisSchema,
  DiagnosticsContextManifestSchema,
  DiagnosticsNormalizationReportSchema,
  DiagnosticsSchemaComplianceReportSchema,
  CodexCrossChapterContinuityReportSchema,
  CodexCrossChapterDriftReportSchema,
  CodexMultiChapterPilotReportSchema,
  CodexPatchFailureReportSchema,
  CodexPreviewCompletenessReportSchema,
  CodexPreviewFailureReportSchema,
  CodexCandidatePreviewReportSchema,
  CodexRuntimeBenchmarkReportSchema,
  CodexRuntimeFailureReportSchema,
  CodexRuntimeGapReportSchema,
  CodexRuntimeOptimizationReportSchema,
  CodexRuntimeSamplingReportSchema,
  CodexRealOptimizationBenchmarkReportSchema,
  CodexMissionMicroBenchmarkReportSchema,
  CodexMissionRetryReportSchema,
  CodexSingleChapterSmokeReportSchema,
  CodexStageRuntimeProfileReportSchema,
  CommitJournalSchema,
  CommitReportSchema,
  ConfigSchema,
  FinalAssemblyReportSchema,
  MissionSchemaDiagnosticsReportSchema,
  ProjectAuditReportSchema,
  RunEventSchema,
  RunManifestSchema,
  RunManifestV2Schema,
  RevisionOpportunityReportSchema,
  RevisionCandidateReviewSchema,
  RevisionCandidateAdoptionApprovalSchema,
  DraftAdoptionManifestSchema,
  DraftSelectionSchema,
  DiagnosticsReportSchema,
  StateDiffReportSchema,
  StoryStateSchema,
  CandidateDispositionSchema,
  CandidateRevisionEvidenceAdjudicationSchema,
  CandidateTimelineContradictionMapSchema,
  ExpandedTargetRevisionCandidateDispositionSchema,
  ExpandedTargetRevisionDiagnosticsABSchema,
  ExpandedTargetRevisionExperimentReportSchema,
  ExpandedTargetRevisionPlanSchema,
  ExpandedTargetRevisionQualityReportSchema,
  ExpandedTargetRevisionScopeValidationSchema,
  TargetCoverageClosureReportSchema,
  TargetCoverageGraphSchema,
  TargetExpansionApprovalPreviewSchema,
  TargetExpansionApprovalRecordSchema,
  TargetedRevisionOperationNormalizationSchema,
  TargetedRevisionOperationSchema,
  TargetedRevisionProviderOutputSchema,
  TargetedRevisionCandidateDispositionArtifactSchema,
  TargetedRevisionDiffSchema,
  TargetedRevisionExperimentArtifactSchema,
  TargetedRevisionExperimentReportSchema,
  TargetedRevisionPlanArtifactSchema,
  TargetedRevisionPlanSchema,
  TargetedRevisionScopeValidationArtifactSchema,
  TargetedRevisionScopeValidationSchema,
  TimelineContradictionMapSchema
} from '../schemas/index.js';
import type { CodexBusinessOptimizationPlan, CodexChapterRegressionAnalysis, CodexRuntimeGapReport, CodexRuntimeSamplingReport, CodexStageRuntimeProfileReport, ExpandedTargetRevisionExperimentReport, RunEvent, RunManifest } from '../schemas/index.js';
import type { AuditIssue, ProjectAuditReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { refreshArtifactIndex } from './artifactIndex.js';
import { isCompletedCommitJournal } from './commitJournal.js';
import { readFileMetadata } from './fileHash.js';
import { validateChapterQueueConsistency } from './chapterQueue.js';
import { verifySnapshots } from './snapshotBrowser.js';
import { parseMarkdownEvidenceParagraphs, sha256 } from './codexDiagnosticsEvidenceRules.js';

export interface ProjectAuditInput {
  projectId: string;
  projectsRoot?: string;
  json?: boolean;
  strict?: boolean;
  fixIndex?: boolean;
}

export interface ProjectAuditResult {
  ok: boolean;
  exitCode: number;
  report: ProjectAuditReport;
  reportPath: string;
  markdownPath: string;
  output: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function auditProject(input: ProjectAuditInput, fileStore = new FileStore()): Promise<ProjectAuditResult> {
  const started = Date.now();
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const issues: AuditIssue[] = [];
  let artifactIndexPath: string | undefined;

  if (input.fixIndex === true) {
    artifactIndexPath = (await refreshArtifactIndex({ projectId: paths.projectId, projectsRoot: paths.projectsRoot }, fileStore)).indexPath;
  } else if (!(await fileStore.exists(paths.artifactIndex()))) {
    issues.push(issue('artifact_index_missing', 'warning', 'artifact_index', 'artifacts/artifact_index.json', 'Artifact index is missing or stale.', 'Run novel-loop artifacts <projectId> --refresh or audit --fix-index.', false));
  }

  await checkJson(issues, fileStore, paths.config(), 'config', 'config.json', ConfigSchema);
  await checkJson(issues, fileStore, paths.storyState(), 'story_state', 'state/story_state.json', StoryStateSchema);
  await checkJson(issues, fileStore, paths.chapterQueue(), 'queue', 'planning/chapter_queue.json', ChapterQueueSchema);

  if ((await fileStore.exists(paths.storyState())) && (await fileStore.exists(paths.chapterQueue()))) {
    const [storyState, queue] = await Promise.all([
      fileStore.readJson(paths.storyState(), StoryStateSchema),
      fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema)
    ]);
    for (const message of validateChapterQueueConsistency(queue, storyState)) {
      issues.push(issue(`queue_state_${issues.length + 1}`, 'critical', 'queue', 'planning/chapter_queue.json', message, 'Fix chapter_queue.json or Story State consistency.', true));
    }
    for (const chapter of queue.chapters.filter((candidate) => candidate.status === 'stale_due_to_history_edit')) {
      if (!(await hasDownstreamInvalidationFor(paths, fileStore, chapter.chapterNumber))) {
        issues.push(issue(`stale_missing_report_ch${chapter.chapterNumber}`, 'error', 'downstream_invalidation', chapter.artifactPath, `Stale chapter ${chapter.chapterNumber} has no downstream invalidation report.`, 'Restore or regenerate downstream_invalidation_report_vN.json.', true));
      }
      if (storyState.canonFacts.some((fact) => fact.sourceChapter === chapter.chapterNumber)) {
        issues.push(issue(`stale_fact_pollution_ch${chapter.chapterNumber}`, 'critical', 'story_state', 'state/story_state.json', `Story State contains canon facts from stale chapter ${chapter.chapterNumber}.`, 'Rebase state from historical recommit base snapshot.', true));
      }
    }
    const latest = queue.chapters.find((chapter) => chapter.chapterNumber === storyState.latestCommittedChapter);
    if (latest !== undefined && ['committed', 'recommitted'].includes(latest.status)) {
      await checkJson(issues, fileStore, paths.chapterArtifact(latest.chapterNumber, 'commit_report.json'), 'commit', `chapters/chapter_${String(latest.chapterNumber).padStart(3, '0')}/commit_report.json`, CommitReportSchema);
      await checkJson(issues, fileStore, paths.chapterArtifact(latest.chapterNumber, 'canon_patch.json'), 'commit', `chapters/chapter_${String(latest.chapterNumber).padStart(3, '0')}/canon_patch.json`, CanonPatchSchema);
    }
  }

  await checkRunManifests(issues, paths, fileStore);
  await checkArchives(issues, paths, fileStore);
  await checkCommitJournals(issues, paths, fileStore);
  await checkCodexM25Artifacts(issues, paths, fileStore);
  await checkMissingTargetedRevisionOperationNormalizations(issues, paths, fileStore);
  const snapshotAudit = await verifySnapshots({ projectId: paths.projectId, projectsRoot: paths.projectsRoot }, fileStore);
  for (const snapshotIssue of snapshotAudit.report.issues) {
    issues.push(snapshotIssue);
  }

  const reportArtifact = await nextAuditArtifact(paths, fileStore, 'project_audit');
  const report = ProjectAuditReportSchema.parse({
    reportId: `project_audit_v${reportArtifact.version}`,
    projectId: paths.projectId,
    generatedAt: new Date().toISOString(),
    strict: input.strict === true,
    ok: issues.filter((candidate) => candidate.severity === 'error' || candidate.severity === 'critical').length === 0,
    summary: summarize(issues),
    issues,
    ...(artifactIndexPath === undefined ? {} : { artifactIndexPath }),
    performance: await collectAuditPerformance(paths, fileStore, started)
  });
  const written = await fileStore.writeJson(reportArtifact.jsonPath, report, ProjectAuditReportSchema);
  await fileStore.writeText(reportArtifact.mdPath, renderAuditMarkdown(written));
  const exitCode = input.strict === true && !written.ok ? 2 : 0;
  const result = {
    ok: written.ok,
    exitCode,
    report: written,
    reportPath: reportArtifact.relativeJsonPath,
    markdownPath: reportArtifact.relativeMdPath
  };
  return {
    ...result,
    output: input.json === true ? `${JSON.stringify(result, null, 2)}\n` : renderAuditOutput(result)
  };
}

async function checkJson<T>(
  issues: AuditIssue[],
  fileStore: FileStore,
  absolutePath: string,
  category: string,
  relativePath: string,
  schema: { parse: (value: unknown) => T }
): Promise<void> {
  if (!(await fileStore.exists(absolutePath))) {
    issues.push(issue(`missing_${relativePath.replace(/[^a-zA-Z0-9]+/g, '_')}`, 'error', category, relativePath, `${relativePath} is missing.`, 'Restore or regenerate the missing artifact.', true));
    return;
  }
  try {
    schema.parse(JSON.parse(await fileStore.readText(absolutePath)));
  } catch (error) {
    issues.push(issue(`invalid_${relativePath.replace(/[^a-zA-Z0-9]+/g, '_')}`, 'error', category, relativePath, `${relativePath} failed schema validation: ${String(error)}`, 'Regenerate or repair the JSON artifact.', true));
  }
}

async function hasDownstreamInvalidationFor(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<boolean> {
  if (!(await fileStore.exists(paths.chaptersDir()))) return false;
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    if (!/^chapter_\d{3}$/.test(chapterDirName)) continue;
    const chapterDir = path.join(paths.chaptersDir(), chapterDirName);
    for (const fileName of await fileStore.list(chapterDir)) {
      if (!/^downstream_invalidation_report_v\d+\.json$/.test(fileName)) continue;
      const report = JSON.parse(await fileStore.readText(path.join(chapterDir, fileName))) as {
        invalidatedChapters?: Array<{ chapterNumber?: number }>;
      };
      if (report.invalidatedChapters?.some((chapter) => chapter.chapterNumber === chapterNumber)) return true;
    }
  }
  return false;
}

async function checkCommitJournals(issues: AuditIssue[], paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (!(await fileStore.exists(paths.chaptersDir()))) return;
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    if (!/^chapter_\d{3}$/.test(chapterDirName)) continue;
    const chapterDir = path.join(paths.chaptersDir(), chapterDirName);
    for (const fileName of await fileStore.list(chapterDir)) {
      if (!/^commit_journal_v\d+\.json$/.test(fileName)) continue;
      const absolutePath = path.join(chapterDir, fileName);
      const relativePath = path.join('chapters', chapterDirName, fileName);
      try {
        const journal = await fileStore.readJson(absolutePath, CommitJournalSchema);
        if (!isCompletedCommitJournal(journal)) {
          issues.push(issue(`commit_journal_incomplete_${chapterDirName}_${fileName}`, 'critical', 'commit_journal', relativePath, 'Commit journal is not complete; Story State may have been partially committed.', 'Inspect the journal, snapshots, commit report, and queue before rerunning commit.', true));
        }
      } catch (error) {
        issues.push(issue(`commit_journal_invalid_${chapterDirName}_${fileName}`, 'error', 'commit_journal', relativePath, `Commit journal failed schema validation: ${String(error)}`, 'Repair or preserve the journal before recommitting.', true));
      }
    }
  }
}

async function checkRunManifests(issues: AuditIssue[], paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (!(await fileStore.exists(paths.runsDir()))) return;
  const manifests: Array<{ runId: string; relativeManifestPath: string; manifest?: RunManifest }> = [];
  for (const runId of await fileStore.list(paths.runsDir())) {
    const relativeManifestPath = path.join('runs', runId, 'run_manifest.json');
    await checkJson(issues, fileStore, paths.runManifest(runId), 'run_manifest', relativeManifestPath, RunManifestSchema);
    try {
      manifests.push({
        runId,
        relativeManifestPath,
        manifest: await fileStore.readJson(paths.runManifest(runId), RunManifestSchema)
      });
    } catch {
      manifests.push({ runId, relativeManifestPath });
    }
  }
  const latestWriterByPath = buildLatestWriterByPath(manifests);
  for (const { runId, relativeManifestPath, manifest } of manifests) {
    if (manifest === undefined) {
      continue;
    }
    if (!isV2Manifest(manifest)) {
      issues.push(issue(`legacy_run_manifest_${runId}`, 'warning', 'run_manifest', relativeManifestPath, 'Run manifest is legacy v1 and has limited provenance.', 'Regenerate the workflow or migrate runs when a migration command is available.', false));
      continue;
    }
    await checkRunEvents(issues, paths, fileStore, runId, manifest);
    await checkRunLineage(issues, paths, fileStore, runId, manifest, latestWriterByPath);
    await checkStateMutations(issues, paths, fileStore, runId, manifest);
  }
}

async function checkMissingTargetedRevisionOperationNormalizations(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore
): Promise<void> {
  if (!(await fileStore.exists(paths.runsDir())) || !(await fileStore.exists(paths.chaptersDir()))) return;
  const normalizedRawPaths = new Set<string>();
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    if (!/^chapter_\d{3}$/.test(chapterDirName)) continue;
    const chapterDir = path.join(paths.chaptersDir(), chapterDirName);
    for (const fileName of await fileStore.list(chapterDir)) {
      if (!/^targeted_revision_operation_normalization_v\d+\.json$/.test(fileName)) continue;
      try {
        const report = await fileStore.readJson(path.join(chapterDir, fileName), TargetedRevisionOperationNormalizationSchema);
        normalizedRawPaths.add(report.rawProviderOutputPath);
      } catch {
        // The chapter artifact schema scan reports malformed normalization reports.
      }
    }
  }

  for (const runId of await fileStore.list(paths.runsDir())) {
    try {
      const manifest = await fileStore.readJson(paths.runManifest(runId), RunManifestSchema);
      if (!isV2Manifest(manifest)) continue;
      const candidateParsedOutputPaths = new Set<string>([
        ...manifest.promptCalls
          .filter((candidate) => candidate.promptId === 'revision.targeted_revision_operations_slim' && candidate.parsedOutputPath !== undefined)
          .map((candidate) => candidate.parsedOutputPath!),
        ...manifest.artifacts
          .filter((artifact) => artifact.artifactType === 'targeted_revision_operation_normalization')
          .flatMap((artifact) => artifact.sourcePaths)
          .filter((sourcePath) => /(?:^|\/)codex\/runs\/[^/]+\/parsed_output\.json$/.test(sourcePath))
      ]);
      for (const parsedOutputPath of candidateParsedOutputPaths) {
        if (normalizedRawPaths.has(parsedOutputPath)) continue;
        const absoluteParsedPath = paths.projectArtifact(parsedOutputPath);
        if (!(await fileStore.exists(absoluteParsedPath))) continue;
        const providerOutput: unknown = JSON.parse(await fileStore.readText(absoluteParsedPath));
        const providerValidation = TargetedRevisionProviderOutputSchema.safeParse(providerOutput);
        if (!providerValidation.success) continue;
        const contractDrift = providerValidation.data.operations.some((operation) =>
          !TargetedRevisionOperationSchema.safeParse(operation).success
        );
        if (!contractDrift) continue;
        issues.push(issue(
          `targeted_revision_operation_normalization_missing_${sanitizeIssueId(parsedOutputPath)}`,
          'critical',
          'targeted_revision_operation_normalization',
          parsedOutputPath,
          'Provider-valid targeted revision operations require canonical normalization, but no normalization report references this parsed output.',
          'Run codex targeted-revision-contract-check against the immutable parsed output before interpreting or applying the operations.',
          true
        ));
      }
    } catch {
      // Run manifest and parsed-output validation is reported by the normal run audit checks.
    }
  }
}

function buildLatestWriterByPath(
  manifests: Array<{ runId: string; manifest?: RunManifest }>
): Map<string, { runId: string; startedAt: string }> {
  const latest = new Map<string, { runId: string; startedAt: string }>();
  for (const { runId, manifest } of manifests) {
    if (manifest === undefined || !isV2Manifest(manifest)) continue;
    for (const artifact of manifest.artifacts) {
      if (artifact.action === 'archived') continue;
      const current = latest.get(artifact.path);
      if (current === undefined || manifest.startedAt > current.startedAt) {
        latest.set(artifact.path, { runId, startedAt: manifest.startedAt });
      }
    }
  }
  return latest;
}

function isV2Manifest(manifest: RunManifest): manifest is Extract<RunManifest, { schemaVersion: '2' }> {
  return 'schemaVersion' in manifest && manifest.schemaVersion === '2';
}

async function checkRunEvents(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  runId: string,
  manifest: Extract<RunManifest, { schemaVersion: '2' }>
): Promise<void> {
  const eventPath = paths.runEvents(runId);
  const relativeEventPath = path.join('runs', runId, 'events.ndjson');
  if (!(await fileStore.exists(eventPath))) {
    issues.push(issue(`events_missing_${runId}`, 'error', 'event_log', relativeEventPath, 'Run event log is missing.', 'Regenerate the run or restore events.ndjson.', true));
    return;
  }
  const events = (await fileStore.readText(eventPath)).trim().split('\n').filter(Boolean);
  const parsedEvents: RunEvent[] = [];
  for (const [index, line] of events.entries()) {
    try {
      parsedEvents.push(RunEventSchema.parse(JSON.parse(line)));
    } catch (error) {
      issues.push(issue(`events_invalid_${runId}_${index + 1}`, 'error', 'event_log', relativeEventPath, `Event ${index + 1} failed schema validation: ${String(error)}`, 'Repair or regenerate events.ndjson.', true));
    }
  }
  checkCodexEventTiming(issues, relativeEventPath, manifest, parsedEvents);
  const expectedSummary = {
    generatedArtifactCount: manifest.artifacts.filter((artifact) => artifact.action === 'generated').length,
    reusedArtifactCount: manifest.artifacts.filter((artifact) => artifact.action === 'reused').length,
    archivedArtifactCount: manifest.artifacts.filter((artifact) => artifact.action === 'archived').length,
    promptCallCount: manifest.promptCalls.length,
    queueTransitionCount: manifest.queueTransitions.length,
    stateMutationCount: manifest.stateMutations.length,
    snapshotCount: manifest.snapshots.length,
    errorCount: manifest.errors.length
  };
  for (const [key, value] of Object.entries(expectedSummary)) {
    if (manifest.summary[key as keyof typeof expectedSummary] !== value) {
      issues.push(issue(`summary_mismatch_${runId}_${key}`, 'error', 'event_log', relativeEventPath, `Run summary ${key}=${manifest.summary[key as keyof typeof expectedSummary]} does not match manifest aggregate ${value}.`, 'Rebuild the run manifest from event log or restore a valid manifest.', true));
    }
  }
}

const CODEX_PRECISION_EVENTS = [
  'CODEX_PROCESS_SPAWN_STARTED',
  'CODEX_PROCESS_SPAWNED',
  'CODEX_STDIN_WRITTEN',
  'CODEX_FIRST_JSONL_EVENT',
  'CODEX_FINAL_MESSAGE_SEEN',
  'CODEX_PROCESS_EXITED',
  'CODEX_ARTIFACT_WRITE_STARTED',
  'CODEX_ARTIFACT_WRITE_COMPLETED',
  'CODEX_PARSE_STARTED',
  'CODEX_PARSE_COMPLETED',
  'CODEX_SCHEMA_VALIDATE_STARTED',
  'CODEX_SCHEMA_VALIDATE_COMPLETED'
] as const;

function checkCodexEventTiming(issues: AuditIssue[], relativeEventPath: string, manifest: Extract<RunManifest, { schemaVersion: '2' }>, events: RunEvent[]): void {
  if (!isCodexManifest(manifest)) return;
  const precisionEvents = events.filter((event) => CODEX_PRECISION_EVENTS.includes(event.eventType as (typeof CODEX_PRECISION_EVENTS)[number]));
  if (precisionEvents.length === 0) {
    issues.push(issue(
      `codex_event_timing_missing_${sanitizeIssueId(manifest.runId)}`,
      'warning',
      'codex_event_timing',
      relativeEventPath,
      'Legacy Codex run has no M27.8A precision timing events.',
      'Regenerate this run with the M27.8A Codex boundary to capture process and JSONL timing.',
      false
    ));
    return;
  }
  const missingEvents = CODEX_PRECISION_EVENTS.filter((eventType) => !events.some((event) => event.eventType === eventType));
  if (missingEvents.length > 0) {
    issues.push(issue(
      `codex_event_timing_partial_${sanitizeIssueId(manifest.runId)}`,
      'warning',
      'codex_event_timing',
      relativeEventPath,
      `Codex precision timing is partial; missing ${missingEvents.join(', ')}.`,
      'Regenerate this run if precise runtime attribution is required.',
      false
    ));
  }
  checkOrderedEvent(issues, relativeEventPath, manifest.runId, events, 'CODEX_PROCESS_SPAWN_STARTED', 'CODEX_PROCESS_SPAWNED');
  checkOrderedEvent(issues, relativeEventPath, manifest.runId, events, 'CODEX_PROCESS_SPAWNED', 'CODEX_STDIN_WRITTEN');
  checkOrderedEvent(issues, relativeEventPath, manifest.runId, events, 'CODEX_STDIN_WRITTEN', 'CODEX_FIRST_JSONL_EVENT');
  checkOrderedEvent(issues, relativeEventPath, manifest.runId, events, 'CODEX_FIRST_JSONL_EVENT', 'CODEX_FINAL_MESSAGE_SEEN');
  checkOrderedEvent(issues, relativeEventPath, manifest.runId, events, 'CODEX_FINAL_MESSAGE_SEEN', 'CODEX_PROCESS_EXITED');
  checkPairedEvents(issues, relativeEventPath, manifest.runId, events, 'CODEX_ARTIFACT_WRITE_STARTED', 'CODEX_ARTIFACT_WRITE_COMPLETED');
  checkPairedEvents(issues, relativeEventPath, manifest.runId, events, 'CODEX_PARSE_STARTED', 'CODEX_PARSE_COMPLETED');
  checkPairedEvents(issues, relativeEventPath, manifest.runId, events, 'CODEX_SCHEMA_VALIDATE_STARTED', 'CODEX_SCHEMA_VALIDATE_COMPLETED');
}

function isCodexManifest(manifest: Extract<RunManifest, { schemaVersion: '2' }>): boolean {
  if (manifest.args.codexInvoked === false) return false;
  if ((manifest.provider ?? '').includes('codex')) return true;
  if (manifest.command.toLowerCase().includes('codex')) return true;
  return manifest.promptCalls.some((call) => call.provider.includes('codex') || call.promptId.toLowerCase().includes('codex'));
}

function checkOrderedEvent(issues: AuditIssue[], relativeEventPath: string, runId: string, events: RunEvent[], beforeType: RunEvent['eventType'], afterType: RunEvent['eventType']): void {
  const before = firstEventMs(events, beforeType);
  const after = firstEventMs(events, afterType);
  if (before === undefined || after === undefined || after >= before) return;
  issues.push(issue(
    `codex_event_order_${sanitizeIssueId(runId)}_${beforeType.toLowerCase()}_${afterType.toLowerCase()}`,
    'error',
    'codex_event_timing',
    relativeEventPath,
    `${beforeType} must be <= ${afterType}.`,
    'Regenerate events.ndjson from a valid Codex run or repair event timestamps.',
    true
  ));
}

function checkPairedEvents(issues: AuditIssue[], relativeEventPath: string, runId: string, events: RunEvent[], startType: RunEvent['eventType'], completedType: RunEvent['eventType']): void {
  const starts = events.filter((event) => event.eventType === startType).map((event) => Date.parse(event.timestamp)).filter(Number.isFinite);
  const completed = events.filter((event) => event.eventType === completedType).map((event) => Date.parse(event.timestamp)).filter(Number.isFinite);
  for (let index = 0; index < Math.min(starts.length, completed.length); index += 1) {
    if (completed[index]! >= starts[index]!) continue;
    issues.push(issue(
      `codex_event_duration_${sanitizeIssueId(runId)}_${startType.toLowerCase()}_${index + 1}`,
      'error',
      'codex_event_timing',
      relativeEventPath,
      `${completedType} must be >= ${startType}; duration cannot be negative.`,
      'Regenerate events.ndjson from a valid Codex run or repair event timestamps.',
      true
    ));
  }
}

function firstEventMs(events: RunEvent[], eventType: RunEvent['eventType']): number | undefined {
  const event = events.find((candidate) => candidate.eventType === eventType);
  if (event === undefined) return undefined;
  const parsed = Date.parse(event.timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function checkRunLineage(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  runId: string,
  manifest: Extract<RunManifest, { schemaVersion: '2' }>,
  latestWriterByPath: Map<string, { runId: string; startedAt: string }>
): Promise<void> {
  for (const artifact of manifest.artifacts) {
    if (artifact.action === 'skipped') continue;
    if (artifact.path === 'state/story_state.json' || artifact.path === 'planning/chapter_queue.json') continue;
    const latestWriter = latestWriterByPath.get(artifact.path);
    if (latestWriter !== undefined && latestWriter.runId !== manifest.runId && latestWriter.startedAt > manifest.startedAt) continue;
    const artifactPath = paths.projectArtifact(artifact.path);
    if (!(await fileStore.exists(artifactPath))) {
      issues.push(issue(`lineage_missing_${runId}_${artifact.artifactId}`, 'error', 'artifact_lineage', artifact.path, 'Artifact lineage path is missing.', 'Restore the artifact or mark lineage status missing.', true));
      continue;
    }
    if (artifact.sha256 !== undefined) {
      const metadata = await readFileMetadata(artifactPath, fileStore);
      if (metadata.sha256 !== artifact.sha256) {
        issues.push(issue(`lineage_hash_${runId}_${artifact.artifactId}`, 'error', 'artifact_lineage', artifact.path, 'Artifact hash does not match run manifest lineage.', 'Restore artifact bytes or regenerate the run manifest.', true));
      }
    }
  }
  for (const call of manifest.promptCalls) {
    if (call.inputArtifactPath !== undefined && call.inputHash !== undefined && (await fileStore.exists(paths.projectArtifact(call.inputArtifactPath)))) {
      const metadata = await readFileMetadata(paths.projectArtifact(call.inputArtifactPath), fileStore);
      if (metadata.sha256 !== call.inputHash) {
        issues.push(issue(`prompt_input_hash_${runId}_${call.promptCallId ?? call.promptId}`, 'error', 'prompt_provenance', call.inputArtifactPath, 'Prompt input artifact hash does not match manifest.', 'Restore prompt artifact bytes or regenerate the run.', true));
      }
    }
    if (call.outputArtifactPath !== undefined && call.outputHash !== undefined && (await fileStore.exists(paths.projectArtifact(call.outputArtifactPath)))) {
      const metadata = await readFileMetadata(paths.projectArtifact(call.outputArtifactPath), fileStore);
      if (metadata.sha256 !== call.outputHash) {
        issues.push(issue(`prompt_output_hash_${runId}_${call.promptCallId ?? call.promptId}`, 'error', 'prompt_provenance', call.outputArtifactPath, 'Prompt output artifact hash does not match manifest.', 'Restore prompt artifact bytes or regenerate the run.', true));
      }
    }
  }
}

async function checkStateMutations(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  runId: string,
  manifest: Extract<RunManifest, { schemaVersion: '2' }>
): Promise<void> {
  for (const mutation of manifest.stateMutations) {
    for (const snapshotId of [mutation.beforeSnapshotId, mutation.afterSnapshotId]) {
      if (snapshotId !== undefined && !(await fileStore.exists(paths.snapshot(snapshotId)))) {
        issues.push(issue(`state_mutation_snapshot_missing_${runId}_${snapshotId}`, 'error', 'state_mutation', path.join('snapshots', `${snapshotId}.json`), 'State mutation references a missing snapshot.', 'Restore the snapshot or invalidate the mutation record.', true));
      }
    }
    if (mutation.mutationType === 'codex_controlled_commit') {
      if (mutation.applied && (mutation.beforeSnapshotId === undefined || mutation.afterSnapshotId === undefined)) {
        issues.push(issue(`codex_commit_snapshots_missing_${runId}_${mutation.mutationId}`, 'critical', 'codex_commit', 'runs', 'Codex confirmed commit mutation must record before/after snapshots.', 'Restore run manifest snapshot provenance or rerun the controlled commit.', true));
      }
      if (mutation.applied && !manifest.artifacts.some((artifact) => artifact.artifactType === 'approval_record' && artifact.action === 'generated')) {
        issues.push(issue(`codex_commit_approval_missing_${runId}_${mutation.mutationId}`, 'critical', 'codex_commit', 'runs', 'Codex confirmed commit must have an approval record artifact.', 'Restore codex_approval_record_vN.json or rerun confirmed commit.', true));
      }
      if (!mutation.applied && mutation.blockedReason?.includes('preview only') && mutation.latestCommittedChapterBefore !== mutation.latestCommittedChapterAfter) {
        issues.push(issue(`codex_preview_mutated_state_${runId}_${mutation.mutationId}`, 'critical', 'codex_commit', 'runs', 'Codex preview-only run changed latestCommittedChapter.', 'Restore Story State from snapshot and rerun preview.', true));
      }
    }
  }
}

async function checkCodexM25Artifacts(issues: AuditIssue[], paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  await checkBuildBibleCacheReports(issues, paths, fileStore);
  await checkCodexContextManifests(issues, paths, fileStore);
  if (await fileStore.exists(paths.auditDir())) {
    for (const fileName of await fileStore.list(paths.auditDir())) {
      if (/^codex_single_chapter_smoke_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_smoke', path.join('audit', fileName), CodexSingleChapterSmokeReportSchema);
      }
      if (/^codex_multi_chapter_pilot_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_pilot', path.join('audit', fileName), CodexMultiChapterPilotReportSchema);
      }
      if (/^codex_cross_chapter_drift_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_drift', path.join('audit', fileName), CodexCrossChapterDriftReportSchema);
      }
      if (/^codex_cross_chapter_continuity_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_continuity', path.join('audit', fileName), CodexCrossChapterContinuityReportSchema);
      }
      if (/^codex_budget_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_budget', path.join('audit', fileName), CodexBudgetReportSchema);
      }
      if (/^codex_call_reduction_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_call_reduction', path.join('audit', fileName), CodexCallReductionReportSchema);
      }
      if (/^codex_stage_runtime_profile_v\d+\.json$/.test(fileName)) {
        const relativePath = path.join('audit', fileName);
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_stage_profile', relativePath, CodexStageRuntimeProfileReportSchema);
        await checkCodexStageRuntimeProfile(issues, paths, fileStore, fileName, relativePath);
      }
      if (/^codex_runtime_benchmark_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_runtime_benchmark', path.join('audit', fileName), CodexRuntimeBenchmarkReportSchema);
      }
      if (/^codex_runtime_optimization_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_runtime_optimization', path.join('audit', fileName), CodexRuntimeOptimizationReportSchema);
      }
      if (/^codex_real_optimization_benchmark_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_real_optimization', path.join('audit', fileName), CodexRealOptimizationBenchmarkReportSchema);
      }
      if (/^codex_chapter_regression_analysis_v\d+\.json$/.test(fileName)) {
        const relativePath = path.join('audit', fileName);
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_regression_analysis', relativePath, CodexChapterRegressionAnalysisSchema);
        await checkCodexChapterRegressionAnalysis(issues, paths, fileStore, fileName, relativePath);
      }
      if (/^codex_runtime_gap_report_v\d+\.json$/.test(fileName)) {
        const relativePath = path.join('audit', fileName);
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_runtime_gap', relativePath, CodexRuntimeGapReportSchema);
        await checkCodexRuntimeGapReport(issues, paths, fileStore, fileName, relativePath);
      }
      if (/^codex_runtime_sampling_report_v\d+\.json$/.test(fileName)) {
        const relativePath = path.join('audit', fileName);
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_runtime_sampling', relativePath, CodexRuntimeSamplingReportSchema);
        await checkCodexRuntimeSamplingReport(issues, paths, fileStore, fileName, relativePath);
      }
      if (/^codex_mission_retry_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_mission_benchmark', path.join('audit', fileName), CodexMissionRetryReportSchema);
      }
      if (/^codex_mission_micro_benchmark_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_mission_benchmark', path.join('audit', fileName), CodexMissionMicroBenchmarkReportSchema);
      }
      if (/^mission_schema_diagnostics_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_mission_benchmark', path.join('audit', fileName), MissionSchemaDiagnosticsReportSchema);
      }
      if (/^codex_business_optimization_plan_v\d+\.json$/.test(fileName)) {
        const relativePath = path.join('audit', fileName);
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_optimization', relativePath, CodexBusinessOptimizationPlanSchema);
        await checkCodexBusinessOptimizationPlan(issues, paths, fileStore, fileName, relativePath);
      }
      if (/^codex_runtime_failure_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_runtime_failure', path.join('audit', fileName), CodexRuntimeFailureReportSchema);
      }
    }
  }
  if (!(await fileStore.exists(paths.chaptersDir()))) return;
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    if (!/^chapter_\d{3}$/.test(chapterDirName)) continue;
    const chapterDir = path.join(paths.chaptersDir(), chapterDirName);
    for (const fileName of await fileStore.list(chapterDir)) {
      const absolutePath = path.join(chapterDir, fileName);
      const relativePath = path.join('chapters', chapterDirName, fileName);
      if (/^codex_chapter_quality_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_quality', relativePath, CodexChapterQualityReportSchema);
      }
      if (fileName === 'chapter_summary_for_context.json') {
        await checkJson(issues, fileStore, absolutePath, 'codex_context_summary', relativePath, ChapterContextSummarySchema);
      }
      if (/^codex_patch_failure_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_failure', relativePath, CodexPatchFailureReportSchema);
      }
      if (/^codex_preview_completeness_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_preview', relativePath, CodexPreviewCompletenessReportSchema);
        await checkCodexPreviewCompletenessReport(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^codex_preview_failure_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_preview', relativePath, CodexPreviewFailureReportSchema);
        await checkCodexPreviewFailureReport(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^codex_diagnostics_hard_fail_analysis_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_diagnostics_analysis', relativePath, CodexDiagnosticsHardFailAnalysisSchema);
        await checkCodexDiagnosticsHardFailAnalysis(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^diagnostics_context_audit_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_diagnostics_context', relativePath, CodexDiagnosticsContextAuditSchema);
        await checkCodexDiagnosticsContextAudit(issues, absolutePath, relativePath, fileStore);
      }
      if (/^diagnostics_context_manifest_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'diagnostics_context_manifest', relativePath, DiagnosticsContextManifestSchema);
        await checkDiagnosticsContextManifest(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^codex_diagnostics_benchmark_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_diagnostics_benchmark', relativePath, CodexDiagnosticsBenchmarkReportSchema);
        await checkCodexDiagnosticsBenchmark(issues, paths, absolutePath, relativePath, fileStore);
      }
      if (/^codex_diagnostics_context_fix_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_diagnostics_context_fix', relativePath, CodexDiagnosticsContextFixReportSchema);
        await checkCodexDiagnosticsContextFixReport(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^diagnostics_schema_compliance_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'diagnostics_schema_compliance', relativePath, DiagnosticsSchemaComplianceReportSchema);
        await checkDiagnosticsSchemaComplianceReport(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^diagnostics_normalization_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'diagnostics_normalization', relativePath, DiagnosticsNormalizationReportSchema);
        await checkDiagnosticsNormalizationReport(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^codex_diagnostics_schema_benchmark_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_diagnostics_schema_benchmark', relativePath, CodexDiagnosticsSchemaBenchmarkReportSchema);
        await checkCodexDiagnosticsSchemaBenchmark(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^codex_diagnostics_evidence_adjudication_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'diagnostics_evidence_adjudication', relativePath, CodexDiagnosticsEvidenceAdjudicationSchema);
        await checkDiagnosticsEvidenceAdjudication(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^timeline_contradiction_map_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'timeline_contradiction_map', relativePath, TimelineContradictionMapSchema);
        await checkTimelineContradictionMap(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^targeted_revision_operation_normalization_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'targeted_revision_operation_normalization', relativePath, TargetedRevisionOperationNormalizationSchema);
        await checkTargetedRevisionOperationNormalization(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^targeted_revision_plan_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'targeted_revision', relativePath, TargetedRevisionPlanArtifactSchema);
      }
      if (/^targeted_revision_scope_validation_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'targeted_revision', relativePath, TargetedRevisionScopeValidationArtifactSchema);
      }
      if (/^targeted_revision_diff_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'targeted_revision', relativePath, TargetedRevisionDiffSchema);
      }
      if (/^targeted_revision_experiment_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'targeted_revision', relativePath, TargetedRevisionExperimentArtifactSchema);
        await checkTargetedRevisionExperiment(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^targeted_revision_candidate_disposition_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'target_coverage', relativePath, TargetedRevisionCandidateDispositionArtifactSchema);
        await checkCandidateDisposition(issues, absolutePath, relativePath, fileStore);
      }
      if (/^targeted_revision_diagnostics_ab_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'targeted_revision', relativePath, ExpandedTargetRevisionDiagnosticsABSchema);
      }
      if (/^candidate_diagnostics_evidence_adjudication_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'targeted_revision', relativePath, CandidateRevisionEvidenceAdjudicationSchema);
      }
      if (/^candidate_timeline_contradiction_map_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'targeted_revision', relativePath, CandidateTimelineContradictionMapSchema);
      }
      if (/^targeted_revision_quality_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'targeted_revision', relativePath, ExpandedTargetRevisionQualityReportSchema);
      }
      if (/^target_coverage_graph_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'target_coverage', relativePath, TargetCoverageGraphSchema);
        await checkTargetCoverageGraph(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^target_coverage_closure_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'target_coverage', relativePath, TargetCoverageClosureReportSchema);
        await checkTargetCoverageReport(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^target_expansion_approval_preview_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'target_coverage', relativePath, TargetExpansionApprovalPreviewSchema);
        await checkTargetExpansionApprovalPreview(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^target_expansion_approval_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'target_coverage', relativePath, TargetExpansionApprovalRecordSchema);
        await checkTargetExpansionApprovalRecord(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^revision_candidate_review_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'candidate_adoption', relativePath, RevisionCandidateReviewSchema);
        await checkRevisionCandidateReview(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^revision_candidate_adoption_approval_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'candidate_adoption', relativePath, RevisionCandidateAdoptionApprovalSchema);
        await checkRevisionCandidateApproval(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^draft_adoption_manifest_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'candidate_adoption', relativePath, DraftAdoptionManifestSchema);
        await checkDraftAdoptionManifest(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^draft_selection_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'candidate_adoption', relativePath, DraftSelectionSchema);
      }
      if (/^codex_candidate_preview_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'candidate_preview', relativePath, CodexCandidatePreviewReportSchema);
        await checkCandidatePreviewReport(issues, paths, fileStore, absolutePath, relativePath);
      }
      if (/^revision_opportunity_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'revision_opportunity', relativePath, RevisionOpportunityReportSchema);
        await checkRevisionOpportunityReport(issues, absolutePath, relativePath, fileStore);
      }
      if (/^codex_commit_consistency_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_commit', relativePath, CodexCommitConsistencyReportSchema);
      }
      if (/^final_assembly_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'final_assembly', relativePath, FinalAssemblyReportSchema);
        await checkFinalAssemblyReport(issues, paths, fileStore, absolutePath, relativePath);
      }
    }
  }
}

async function checkBuildBibleCacheReports(issues: AuditIssue[], paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (!(await fileStore.exists(paths.strategyDir()))) return;
  for (const fileName of await fileStore.list(paths.strategyDir())) {
    if (!/^build_bible_cache_report_v\d+\.json$/.test(fileName)) continue;
    const absolutePath = path.join(paths.strategyDir(), fileName);
    const relativePath = path.join('strategy', fileName);
    await checkJson(issues, fileStore, absolutePath, 'build_bible_cache', relativePath, BuildBibleCacheReportSchema);
    try {
      const report = await fileStore.readJson(absolutePath, BuildBibleCacheReportSchema);
      for (const artifactPath of report.reusedArtifacts) {
        if (!(await fileStore.exists(paths.projectArtifact(artifactPath)))) {
          issues.push(issue(
            `build_bible_cache_missing_reused_${sanitizeIssueId(fileName)}_${sanitizeIssueId(artifactPath)}`,
            'error',
            'build_bible_cache',
            relativePath,
            `Build bible cache report references missing reused artifact ${artifactPath}.`,
            'Restore the reused strategy artifact or regenerate build-bible with --force-regenerate.',
            true
          ));
        }
      }
    } catch {
      // checkJson already recorded schema problems.
    }
  }
}

async function checkDraftAdoptionManifest(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const manifest = await fileStore.readJson(absolutePath, DraftAdoptionManifestSchema);
    const sources: Array<[string, string, string]> = [
      ['candidate', manifest.candidatePath, manifest.candidateHash],
      ['adopted_draft', manifest.adoptedDraftPath, manifest.adoptedDraftHash],
      ['original_draft', manifest.originalDraftPath, manifest.originalDraftHash],
      ['approval', manifest.approvalPath, manifest.approvalHash],
      ['experiment', manifest.experimentPath, manifest.experimentHash],
      ['disposition', manifest.dispositionPath, manifest.dispositionHash],
      ['story_state', path.join('state', 'story_state.json'), manifest.sourceStateHash],
      ['chapter_queue', path.join('planning', 'chapter_queue.json'), manifest.sourceQueueHash]
    ];
    for (const [label, artifactPath, expectedHash] of sources) {
      await checkD3ArtifactHash(issues, paths, fileStore, relativePath, `draft_adoption_hash_${label}`, artifactPath, expectedHash);
    }
    const [candidateText, adoptedText] = await Promise.all([
      fileStore.readText(paths.projectArtifact(manifest.candidatePath)),
      fileStore.readText(paths.projectArtifact(manifest.adoptedDraftPath))
    ]);
    if (candidateText !== adoptedText || manifest.candidateHash !== manifest.adoptedDraftHash) {
      issues.push(issue(
        `draft_adoption_hash_candidate_copy_${sanitizeIssueId(relativePath)}`,
        'critical',
        'candidate_adoption',
        relativePath,
        'Adopted draft_v2 is not an exact copy of the approved candidate.',
        'Restore draft_v2 from the approved candidate and regenerate adoption provenance.',
        true
      ));
    }
  } catch {
    // checkJson already records malformed manifests; missing linked artifacts are recorded above when parsing succeeds.
  }
}

async function checkRevisionCandidateReview(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, RevisionCandidateReviewSchema);
    const sources: Array<[string, string, string]> = [
      ['review_candidate', report.candidatePath, report.candidateHash],
      ['review_source_draft', report.sourceDraftPath, report.sourceDraftHash],
      ['review_experiment', report.experimentReportPath, report.experimentReportHash],
      ['review_disposition', report.dispositionPath, report.dispositionHash],
      ['review_state', report.sourceStatePath, report.sourceStateHash],
      ['review_queue', report.sourceQueuePath, report.sourceQueueHash]
    ];
    for (const [label, artifactPath, expectedHash] of sources) {
      await checkD3ArtifactHash(issues, paths, fileStore, relativePath, label, artifactPath, expectedHash);
    }
  } catch {
    // checkJson records malformed reports.
  }
}

async function checkRevisionCandidateApproval(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const approval = await fileStore.readJson(absolutePath, RevisionCandidateAdoptionApprovalSchema);
    await checkD3ArtifactHash(issues, paths, fileStore, relativePath, 'approval_review', approval.reviewReportPath, approval.reviewReportHash);
    const review = await fileStore.readJson(paths.projectArtifact(approval.reviewReportPath), RevisionCandidateReviewSchema);
    const sources: Array<[string, string, string]> = [
      ['approval_candidate', approval.candidatePath, approval.candidateHash],
      ['approval_experiment', approval.experimentReportPath, approval.experimentReportHash],
      ['approval_disposition', approval.dispositionPath, approval.dispositionHash],
      ['approval_source_draft', review.sourceDraftPath, approval.sourceDraftHash],
      ['approval_state', review.sourceStatePath, approval.sourceStateHash],
      ['approval_queue', review.sourceQueuePath, approval.sourceQueueHash]
    ];
    for (const [label, artifactPath, expectedHash] of sources) {
      await checkD3ArtifactHash(issues, paths, fileStore, relativePath, label, artifactPath, expectedHash);
    }
  } catch {
    // checkJson and linked hash checks report malformed or stale approvals.
  }
}

async function checkCandidatePreviewReport(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, CodexCandidatePreviewReportSchema);
    const requiredPaths = [
      report.candidatePath,
      report.adoptedDraftPath,
      report.adoptionApprovalPath,
      report.draftAdoptionManifestPath,
      report.draftSelectionPath,
      report.experimentPath,
      report.diagnosticsContextManifestPath,
      report.diagnosticsPath,
      report.completenessReportPath,
      ...(report.finalPath === null ? [] : [report.finalPath]),
      ...(report.qualityReportPath === null ? [] : [report.qualityReportPath]),
      ...(report.patchProposalPath === null ? [] : [report.patchProposalPath]),
      ...(report.normalizedPatchPath === null ? [] : [report.normalizedPatchPath]),
      ...(report.stateDiffPath === null ? [] : [report.stateDiffPath])
    ];
    for (const artifactPath of requiredPaths) {
      if (await fileStore.exists(paths.projectArtifact(artifactPath))) continue;
      issues.push(issue(
        `candidate_preview_missing_${sanitizeIssueId(artifactPath)}`,
        'error',
        'candidate_preview',
        relativePath,
        `Candidate preview references missing artifact ${artifactPath}.`,
        'Restore the immutable preview artifact or rerun from a fresh adopted candidate.',
        true
      ));
    }
    const runManifestPath = path.join('runs', report.runId, 'run_manifest.json');
    const runEventsPath = path.join('runs', report.runId, 'events.ndjson');
    for (const provenancePath of [runManifestPath, runEventsPath]) {
      if (await fileStore.exists(paths.projectArtifact(provenancePath))) continue;
      issues.push(issue(
        `candidate_preview_missing_run_provenance_${sanitizeIssueId(provenancePath)}`,
        'critical',
        'candidate_preview',
        relativePath,
        `Candidate preview is missing run provenance ${provenancePath}.`,
        'Restore the immutable run manifest/event log or regenerate the isolated preview.',
        true
      ));
      return;
    }
    await checkD3ArtifactHash(issues, paths, fileStore, relativePath, 'candidate_preview_candidate', report.candidatePath, report.candidateHash);
    await checkD3ArtifactHash(issues, paths, fileStore, relativePath, 'candidate_preview_draft', report.adoptedDraftPath, report.adoptedDraftHash);
    await checkD3ArtifactHash(issues, paths, fileStore, relativePath, 'candidate_preview_approval', report.adoptionApprovalPath, report.adoptionApprovalHash);
    await checkD3ArtifactHash(issues, paths, fileStore, relativePath, 'candidate_preview_experiment', report.experimentPath, report.experimentHash);
    await checkD3ArtifactHash(issues, paths, fileStore, relativePath, 'candidate_preview_state', path.join('state', 'story_state.json'), report.sourceStateHash);
    await checkD3ArtifactHash(issues, paths, fileStore, relativePath, 'candidate_preview_queue', path.join('planning', 'chapter_queue.json'), report.sourceQueueHash);

    const [manifest, selection, diagnostics, context, completeness, storyState, queue, runManifest] = await Promise.all([
      fileStore.readJson(paths.projectArtifact(report.draftAdoptionManifestPath), DraftAdoptionManifestSchema),
      fileStore.readJson(paths.projectArtifact(report.draftSelectionPath), DraftSelectionSchema),
      fileStore.readJson(paths.projectArtifact(report.diagnosticsPath), DiagnosticsReportSchema),
      fileStore.readJson(paths.projectArtifact(report.diagnosticsContextManifestPath), DiagnosticsContextManifestSchema),
      fileStore.readJson(paths.projectArtifact(report.completenessReportPath), CodexPreviewCompletenessReportSchema),
      fileStore.readJson(paths.storyState(), StoryStateSchema),
      fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema),
      fileStore.readJson(paths.runManifest(report.runId), RunManifestV2Schema)
    ]);
    const queueItem = queue.chapters.find((chapter) => chapter.chapterNumber === report.chapterNumber);
    const contextUsesDraftV2 = context.includedArtifacts.some((artifact) => artifact.path === report.adoptedDraftPath);
    const diagnosticsPassed = diagnostics.passed === true && diagnostics.draftVersion === 2 &&
      diagnostics.hardFailures.length === 0 && Object.values(diagnostics.hard_checks).every((check) => check.passed);
    const sourceLinksValid = manifest.adoptedDraftPath === report.adoptedDraftPath &&
      manifest.adoptedDraftHash === report.adoptedDraftHash &&
      selection.selectedDraftPath === report.adoptedDraftPath &&
      selection.selectedDraftHash === report.adoptedDraftHash &&
      selection.selectedDraftVersion === 2 &&
      selection.scope === 'preview_only';
    if (!sourceLinksValid || !contextUsesDraftV2 || report.abDiagnosticsReused || !report.standardDiagnosticsReexecuted || report.diagnosticsPassed !== diagnosticsPassed) {
      issues.push(issue(
        `candidate_preview_wrong_draft_or_diagnostics_${sanitizeIssueId(relativePath)}`,
        'critical',
        'candidate_preview',
        relativePath,
        'Candidate preview did not use the approved draft_v2 with freshly executed standard diagnostics.',
        'Discard the preview and rerun resume-preview-with-candidate from the approved adoption manifest.',
        true
      ));
    }

    if (report.previewComplete) {
      const patchProposal = await fileStore.readJson(paths.projectArtifact(report.patchProposalPath!), CanonPatchSchema);
      const normalizedPatch = await fileStore.readJson(paths.projectArtifact(report.normalizedPatchPath!), CanonPatchSchema);
      const stateDiff = await fileStore.readJson(paths.projectArtifact(report.stateDiffPath!), StateDiffReportSchema);
      const quality = await fileStore.readJson(paths.projectArtifact(report.qualityReportPath!), CodexChapterQualityReportSchema);
      const patchValid = patchProposal.sourceFinalPath === report.finalPath &&
        normalizedPatch.sourceFinalPath === report.finalPath &&
        stateDiff.patchPath === report.normalizedPatchPath &&
        !stateDiff.unsafeToCommit;
      const qualityValid = quality.finalChapterPath === report.finalPath &&
        quality.canonPatchPath === report.normalizedPatchPath &&
        quality.diagnosticsPath === report.diagnosticsPath &&
        !quality.blocking && quality.criticalIssues.length === 0;
      if (!patchValid || !qualityValid || !completeness.complete || !report.patchSchemaValid || !report.conflictCheckPassed || !report.stateDiffGenerated) {
        issues.push(issue(
          `candidate_preview_incomplete_chain_${sanitizeIssueId(relativePath)}`,
          'critical',
          'candidate_preview',
          relativePath,
          'Complete candidate preview has inconsistent final, quality, patch, conflict, state diff, or completeness provenance.',
          'Do not use this preview for commit review; regenerate the isolated preview.',
          true
        ));
      }
    }

    const expectedPromptIds = ['diagnostics.diagnose_chapter_slim', 'memory.extract_canon_patch_proposal_slim'];
    const promptIds = runManifest.promptCalls.map((call) => call.promptId);
    const eventText = await fileStore.readText(paths.runEvents(report.runId));
    const mutationDetected = runManifest.stateMutations.some((mutation) => mutation.applied) ||
      runManifest.queueTransitions.length > 0 || runManifest.snapshots.length > 0 || eventText.includes('STATE_MUTATION_APPLIED');
    const canonicalArtifactDetected = await hasCandidatePreviewCommitArtifact(paths, fileStore, report.chapterNumber);
    if (
      storyState.latestCommittedChapter !== report.latestCommittedChapterBefore ||
      report.latestCommittedChapterAfter !== report.latestCommittedChapterBefore ||
      queueItem === undefined || ['committed', 'recommitted'].includes(queueItem.status) ||
      report.queueStatusAfter !== queueItem.status || report.storyStateMutated || report.queueCommitted ||
      report.commitStarted || report.snapshotCreated || report.canonicalPatchGenerated || mutationDetected || canonicalArtifactDetected ||
      (report.previewComplete && JSON.stringify(promptIds) !== JSON.stringify(expectedPromptIds))
    ) {
      issues.push(issue(
        `candidate_preview_safety_boundary_${sanitizeIssueId(relativePath)}`,
        'critical',
        'candidate_preview',
        relativePath,
        'Candidate preview crossed or inconsistently recorded the no-commit Story State/queue boundary.',
        'Restore canonical state and queue, remove invalid commit artifacts, and rerun preview without commit confirmation.',
        true
      ));
    }
  } catch {
    // Individual schema and missing artifact checks report actionable errors.
  }
}

async function checkD3ArtifactHash(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  reportPath: string,
  issuePrefix: string,
  artifactPath: string,
  expectedHash: string
): Promise<void> {
  const absolutePath = paths.projectArtifact(artifactPath);
  if (!(await fileStore.exists(absolutePath))) {
    issues.push(issue(`${issuePrefix}_missing_${sanitizeIssueId(artifactPath)}`, 'error', 'candidate_adoption', reportPath, `Missing D3 source artifact ${artifactPath}.`, 'Restore the immutable source artifact.', true));
    return;
  }
  const actualHash = sha256(await fileStore.readText(absolutePath));
  if (actualHash === expectedHash) return;
  issues.push(issue(
    `${issuePrefix}_mismatch_${sanitizeIssueId(artifactPath)}`,
    'critical',
    'candidate_adoption',
    reportPath,
    `D3 artifact hash mismatch for ${artifactPath}.`,
    'Treat the approval/adoption/preview as stale and regenerate from immutable sources.',
    true
  ));
}

async function hasCandidatePreviewCommitArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<boolean> {
  const candidates = ['commit_report.json', 'canon_patch.json'];
  for (const fileName of candidates) {
    if (await fileStore.exists(paths.chapterArtifact(chapterNumber, fileName))) return true;
  }
  if (!(await fileStore.exists(paths.chapterDir(chapterNumber)))) return false;
  return (await fileStore.list(paths.chapterDir(chapterNumber))).some((fileName) => /^codex_(?:approval_record|commit_report)_v\d+\.json$/.test(fileName));
}

async function checkCodexPreviewCompletenessReport(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, CodexPreviewCompletenessReportSchema);
    if (report.storyStateMutated) {
      issues.push(issue(
        `codex_preview_state_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'codex_preview',
        relativePath,
        'Codex preview completeness report indicates Story State mutation.',
        'Restore Story State from the pre-preview snapshot or rerun from a clean state.',
        true
      ));
    }
    if (!report.complete && report.failureReportPath === undefined) {
      const failure = await findLatestChapterArtifact(paths, fileStore, report.chapterNumber, 'codex_preview_failure_report');
      if (failure === undefined) {
        issues.push(issue(
          `codex_preview_failure_report_missing_ch${report.chapterNumber}_${sanitizeIssueId(relativePath)}`,
          'error',
          'codex_preview',
          relativePath,
          'Incomplete Codex preview has no preview failure report.',
          'Rerun the codex preview to regenerate failure diagnostics.',
          true
        ));
      }
    }
    const eventLog = paths.runEvents(report.previewRunId);
    if (await fileStore.exists(eventLog)) {
      const eventsText = await fileStore.readText(eventLog);
      if (!eventsText.includes('CODEX_PREVIEW_SUBSTAGE_')) {
        issues.push(issue(
          `codex_preview_legacy_events_${sanitizeIssueId(report.previewRunId)}`,
          'warning',
          'codex_preview',
          relativePath,
          'Codex preview report exists but the run event log has no preview sub-stage events.',
          'This may be a legacy run; rerun preview for full M27.9 sub-stage timeline.',
          false
        ));
      }
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function checkCodexPreviewFailureReport(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, CodexPreviewFailureReportSchema);
    if (report.storyStateMutated) {
      issues.push(issue(
        `codex_preview_failure_state_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'codex_preview',
        relativePath,
        'Codex preview failure report indicates Story State mutation.',
        'Restore Story State from the pre-preview snapshot before retrying.',
        true
      ));
    }
    const queue = await fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema);
    const chapter = queue.chapters.find((item) => item.chapterNumber === report.chapterNumber);
    if (chapter?.status === 'committed') {
      issues.push(issue(
        `codex_preview_failure_marked_committed_ch${report.chapterNumber}`,
        'critical',
        'codex_preview',
        relativePath,
        'Chapter queue is committed even though a Codex preview failure report exists.',
        'Inspect queue provenance and restore the chapter to a non-committed failure/review status.',
        true
      ));
    }
    if (!(await fileStore.exists(paths.projectArtifact(report.previewCompletenessReportPath)))) {
      issues.push(issue(
        `codex_preview_completeness_missing_for_failure_${sanitizeIssueId(relativePath)}`,
        'error',
        'codex_preview',
        relativePath,
        'Codex preview failure report references a missing completeness report.',
        'Restore the completeness report or rerun preview diagnostics.',
        true
      ));
    }
    if (report.errorCode === 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL') {
      const analysis = await findLatestChapterArtifact(paths, fileStore, report.chapterNumber, 'codex_diagnostics_hard_fail_analysis');
      if (analysis === undefined) {
        issues.push(issue(
          `codex_diagnostics_analysis_missing_ch${report.chapterNumber}_${sanitizeIssueId(relativePath)}`,
          'warning',
          'codex_diagnostics_analysis',
          relativePath,
          'Codex diagnostics hard fail has no hard-fail analysis report.',
          `Run novel-loop codex diagnostics-analysis ${paths.projectId} ${report.chapterNumber}.`,
          false
        ));
      }
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function checkCodexDiagnosticsHardFailAnalysis(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, CodexDiagnosticsHardFailAnalysisSchema);
    if (report.storyStateMutated) {
      issues.push(issue(
        `codex_diagnostics_analysis_state_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'codex_diagnostics_analysis',
        relativePath,
        'Diagnostics hard-fail analysis report indicates Story State mutation.',
        'Restore Story State and regenerate diagnostics-analysis from existing artifacts.',
        true
      ));
    }
    for (const sourcePath of [report.sourceDiagnosticsPath, report.sourceDraftPath, report.sourceStoryStatePath]) {
      if (sourcePath.length > 0 && !(await fileStore.exists(paths.projectArtifact(sourcePath)))) {
        issues.push(issue(
          `codex_diagnostics_analysis_missing_source_${sanitizeIssueId(relativePath)}_${sanitizeIssueId(sourcePath)}`,
          'error',
          'codex_diagnostics_analysis',
          relativePath,
          `Diagnostics hard-fail analysis references missing source ${sourcePath}.`,
          'Restore the source artifact or regenerate diagnostics-analysis.',
          true
        ));
      }
    }
    const queue = await fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema);
    const chapter = queue.chapters.find((item) => item.chapterNumber === report.chapterNumber);
    if (chapter?.status === 'committed' && report.hardFailures.length > 0) {
      issues.push(issue(
        `codex_diagnostics_hard_fail_committed_ch${report.chapterNumber}`,
        'critical',
        'codex_diagnostics_analysis',
        relativePath,
        'Chapter is committed while diagnostics hard-fail analysis still contains hard failures.',
        'Inspect commit provenance; do not treat hard-failed diagnostics as committed without an explicit recovery path.',
        true
      ));
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function checkCodexDiagnosticsContextAudit(issues: AuditIssue[], absolutePath: string, relativePath: string, fileStore: FileStore): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, CodexDiagnosticsContextAuditSchema);
    if (report.storyStateMutated) {
      issues.push(issue(
        `codex_diagnostics_context_state_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'codex_diagnostics_context',
        relativePath,
        'Diagnostics context audit report indicates Story State mutation.',
        'Regenerate context audit from existing artifacts without state writes.',
        true
      ));
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function checkDiagnosticsContextManifest(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, DiagnosticsContextManifestSchema);
    if (report.storyStateMutated) {
      issues.push(issue(
        `diagnostics_context_manifest_state_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'diagnostics_context_manifest',
        relativePath,
        'Diagnostics context manifest indicates Story State mutation.',
        'Regenerate diagnostics context from existing artifacts only.',
        true
      ));
    }
    for (const requiredPath of [path.join('state', 'story_state.json'), relativeChapterArtifact(report.chapterNumber, 'mission.json'), relativeChapterArtifact(report.chapterNumber, 'draft_v1.md')]) {
      if (!(await fileStore.exists(paths.projectArtifact(requiredPath)))) {
        issues.push(issue(
          `diagnostics_context_manifest_missing_required_${sanitizeIssueId(relativePath)}_${sanitizeIssueId(requiredPath)}`,
          'error',
          'diagnostics_context_manifest',
          relativePath,
          `Diagnostics context manifest requires missing canonical artifact ${requiredPath}.`,
          'Restore the canonical artifact before rerunning diagnostics benchmark.',
          true
        ));
      }
    }
    if (report.includedArtifacts.some((artifact) => artifact.path.includes('codex/runs') || artifact.path.includes('archive'))) {
      issues.push(issue(
        `diagnostics_context_manifest_raw_artifact_included_${sanitizeIssueId(relativePath)}`,
        'error',
        'diagnostics_context_manifest',
        relativePath,
        'Diagnostics context manifest includes raw Codex run/archive artifacts.',
        'Regenerate diagnostics context with canonical state, mission, plan, and draft artifacts only.',
        true
      ));
    }
    if (report.mode === 'enhanced' && report.missingRequiredArtifacts.length > 0) {
      issues.push(issue(
        `diagnostics_context_manifest_enhanced_missing_${sanitizeIssueId(relativePath)}`,
        'warning',
        'diagnostics_context_manifest',
        relativePath,
        `Enhanced diagnostics context is missing optional/required entries: ${report.missingRequiredArtifacts.join(', ')}.`,
        'Restore missing artifacts or treat benchmark conclusions cautiously.',
        false
      ));
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function checkCodexDiagnosticsBenchmark(
  issues: AuditIssue[],
  paths: ProjectPaths,
  absolutePath: string,
  relativePath: string,
  fileStore: FileStore
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, CodexDiagnosticsBenchmarkReportSchema);
    if (report.storyStateMutated || report.samples.some((sample) => sample.storyStateMutated)) {
      issues.push(issue(
        `codex_diagnostics_benchmark_state_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'codex_diagnostics_benchmark',
        relativePath,
        'Diagnostics benchmark report indicates Story State mutation.',
        'Restore Story State and discard benchmark artifacts generated by the mutating run.',
        true
      ));
    }
    if (report.diagnosticsContextManifestPath !== undefined && !(await fileStore.exists(paths.projectArtifact(report.diagnosticsContextManifestPath)))) {
      issues.push(issue(
        `codex_diagnostics_benchmark_missing_context_manifest_${sanitizeIssueId(relativePath)}`,
        'error',
        'codex_diagnostics_benchmark',
        relativePath,
        `Diagnostics benchmark references missing context manifest ${report.diagnosticsContextManifestPath}.`,
        'Restore the context manifest or regenerate diagnostics-benchmark.',
        true
      ));
    }
    if (report.contextMode === 'enhanced' && report.diagnosticsContextManifestPath === undefined) {
      issues.push(issue(
        `codex_diagnostics_benchmark_enhanced_missing_manifest_${sanitizeIssueId(relativePath)}`,
        'error',
        'codex_diagnostics_benchmark',
        relativePath,
        'Enhanced diagnostics benchmark has no diagnosticsContextManifestPath.',
        'Regenerate enhanced diagnostics-benchmark.',
        true
      ));
    }
    const rawReport = JSON.parse(await fileStore.readText(absolutePath)) as unknown;
    const hasM2712Statistics = isUnknownRecord(rawReport) && 'hardFailRateAmongSchemaValidSamples' in rawReport;
    if (!hasM2712Statistics) {
      issues.push(issue(
        `codex_diagnostics_benchmark_legacy_statistics_${sanitizeIssueId(relativePath)}`,
        'warning',
        'codex_diagnostics_benchmark',
        relativePath,
        'Legacy diagnostics benchmark has no schema-valid-only hard-fail statistics.',
        'Rerun diagnostics-benchmark after M27.12A before interpreting its hard-fail rate.',
        false
      ));
    } else {
      const validSamples = report.samples.filter((sample) => sample.schemaValid);
      const invalidSamples = report.samples.filter((sample) => !sample.schemaValid);
      const validHardFailCount = validSamples.filter((sample) => !sample.passed).length;
      const expectedHardFailRate = validSamples.length === 0 ? null : roundedRate(validHardFailCount, validSamples.length);
      if (
        report.schemaValidSampleCount !== validSamples.length ||
        report.schemaInvalidSampleCount !== invalidSamples.length ||
        report.hardFailCountAmongSchemaValidSamples !== validHardFailCount ||
        report.hardFailRateAmongSchemaValidSamples !== expectedHardFailRate
      ) {
        issues.push(issue(
          `codex_diagnostics_benchmark_invalid_denominator_${sanitizeIssueId(relativePath)}`,
          'error',
          'codex_diagnostics_benchmark',
          relativePath,
          'Diagnostics benchmark statistics include schema-invalid samples or do not match the schema-valid denominator.',
          'Regenerate diagnostics-benchmark with M27.12A statistics semantics.',
          true
        ));
      }
      if (validSamples.length === 0 && (report.hardFailRateAmongSchemaValidSamples !== null || report.experimentValid)) {
        issues.push(issue(
          `codex_diagnostics_benchmark_zero_valid_interpreted_${sanitizeIssueId(relativePath)}`,
          'error',
          'codex_diagnostics_benchmark',
          relativePath,
          'A zero-schema-valid diagnostics benchmark must have null hard-fail rate and experimentValid=false.',
          'Regenerate the benchmark after fixing diagnostics structured-output compliance.',
          true
        ));
      }
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function checkCodexDiagnosticsContextFixReport(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, CodexDiagnosticsContextFixReportSchema);
    if (report.storyStateMutated) {
      issues.push(issue(
        `codex_diagnostics_context_fix_state_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'codex_diagnostics_context_fix',
        relativePath,
        'Diagnostics context fix report indicates Story State mutation.',
        'Restore Story State and regenerate context-fix from benchmark artifacts only.',
        true
      ));
    }
    for (const sourcePath of [report.baselineBenchmarkPath, report.enhancedBenchmarkPath, report.contextManifestPath]) {
      if (!(await fileStore.exists(paths.projectArtifact(sourcePath)))) {
        issues.push(issue(
          `codex_diagnostics_context_fix_missing_source_${sanitizeIssueId(relativePath)}_${sanitizeIssueId(sourcePath)}`,
          'error',
          'codex_diagnostics_context_fix',
          relativePath,
          `Diagnostics context fix report references missing source ${sourcePath}.`,
          'Restore the source benchmark/context artifact or regenerate diagnostics benchmark.',
          true
        ));
      }
    }
    const rawReport = JSON.parse(await fileStore.readText(absolutePath)) as unknown;
    const hasM2712Statistics = isUnknownRecord(rawReport) && 'schemaValidSampleCount' in rawReport;
    if (hasM2712Statistics && report.schemaValidSampleCount === 0 && report.conclusion === 'requires_human_review') {
      issues.push(issue(
        `codex_diagnostics_context_fix_invalid_conclusion_${sanitizeIssueId(relativePath)}`,
        'error',
        'codex_diagnostics_context_fix',
        relativePath,
        'Context-fix report has no schema-valid sample but concludes requires_human_review.',
        'Use conclusion=diagnostics_schema_noncompliance until structured-output compliance is restored.',
        true
      ));
    }
    if ((report.enhancedHardFailRateAmongSchemaValidSamples ?? 0) > 0) {
      issues.push(issue(
        `codex_diagnostics_context_fix_hard_fail_persists_${sanitizeIssueId(relativePath)}`,
        'warning',
        'codex_diagnostics_context_fix',
        relativePath,
        'Enhanced diagnostics context still reports a hard-fail rate above zero.',
        'Do not commit automatically; revise draft or use human review.',
        false
      ));
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function checkDiagnosticsSchemaComplianceReport(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, DiagnosticsSchemaComplianceReportSchema);
    if (report.storyStateMutated) {
      issues.push(issue(
        `diagnostics_schema_compliance_state_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'diagnostics_schema_compliance',
        relativePath,
        'Diagnostics schema compliance report indicates Story State mutation.',
        'Restore Story State and discard the mutating benchmark artifacts.',
        true
      ));
    }
    for (const sample of report.violationsBySample) {
      for (const artifactPath of [sample.rawOutputPath, sample.finalOutputPath, sample.parsedOutputPath].filter((candidate) => candidate.length > 0)) {
        if (!(await fileStore.exists(paths.projectArtifact(artifactPath)))) {
          issues.push(issue(
            `diagnostics_schema_compliance_missing_artifact_${sanitizeIssueId(relativePath)}_${sanitizeIssueId(artifactPath)}`,
            'error',
            'diagnostics_schema_compliance',
            relativePath,
            `Diagnostics schema compliance report references missing artifact ${artifactPath}.`,
            'Restore the redacted Codex artifact or rerun diagnostics-schema-benchmark.',
            true
          ));
        }
      }
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function checkDiagnosticsNormalizationReport(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, DiagnosticsNormalizationReportSchema);
    if (report.storyStateMutated) {
      issues.push(issue(
        `diagnostics_normalization_state_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'diagnostics_normalization',
        relativePath,
        'Diagnostics normalization report indicates Story State mutation.',
        'Restore Story State and rerun the read-only schema benchmark.',
        true
      ));
    }
    if (report.parsedOutputPath.length > 0 && !(await fileStore.exists(paths.projectArtifact(report.parsedOutputPath)))) {
      issues.push(issue(
        `diagnostics_normalization_missing_parsed_${sanitizeIssueId(relativePath)}`,
        'error',
        'diagnostics_normalization',
        relativePath,
        `Diagnostics normalization report references missing parsed output ${report.parsedOutputPath}.`,
        'Restore parsed output or rerun diagnostics-schema-benchmark.',
        true
      ));
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function checkCodexDiagnosticsSchemaBenchmark(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, CodexDiagnosticsSchemaBenchmarkReportSchema);
    if (report.storyStateMutated || report.canonicalDiagnosticsMutated || report.samples.some((sample) => sample.storyStateMutated)) {
      issues.push(issue(
        `codex_diagnostics_schema_benchmark_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'codex_diagnostics_schema_benchmark',
        relativePath,
        'Diagnostics schema benchmark indicates canonical diagnostics or Story State mutation.',
        'Restore canonical artifacts and discard the mutating benchmark run.',
        true
      ));
    }
    for (const sourcePath of [report.diagnosticsContextManifestPath, report.complianceReportPath]) {
      if (!(await fileStore.exists(paths.projectArtifact(sourcePath)))) {
        issues.push(issue(
          `codex_diagnostics_schema_benchmark_missing_source_${sanitizeIssueId(relativePath)}_${sanitizeIssueId(sourcePath)}`,
          'error',
          'codex_diagnostics_schema_benchmark',
          relativePath,
          `Diagnostics schema benchmark references missing source ${sourcePath}.`,
          'Restore the source report or rerun diagnostics-schema-benchmark.',
          true
        ));
      }
    }
    for (const sample of report.samples) {
      for (const artifactPath of [sample.rawOutputPath, sample.finalOutputPath, sample.parsedOutputPath, sample.normalizationReportPath].filter((candidate) => candidate.length > 0)) {
        if (!(await fileStore.exists(paths.projectArtifact(artifactPath)))) {
          issues.push(issue(
            `codex_diagnostics_schema_benchmark_missing_artifact_${sanitizeIssueId(relativePath)}_${sanitizeIssueId(artifactPath)}`,
            'error',
            'codex_diagnostics_schema_benchmark',
            relativePath,
            `Diagnostics schema benchmark references missing artifact ${artifactPath}.`,
            'Restore the artifact or rerun diagnostics-schema-benchmark.',
            true
          ));
        }
      }
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function checkDiagnosticsEvidenceAdjudication(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, CodexDiagnosticsEvidenceAdjudicationSchema);
    const requiredSources = [
      report.sourceDraftPath,
      report.sourceMissionPath,
      report.sourceSelectedPlanPath,
      report.sourceStoryStatePath,
      report.sourceDiagnosticsBenchmarkPath,
      report.sourceSchemaBenchmarkPath,
      report.timelineContradictionMapPath
    ];
    for (const sourcePath of requiredSources) {
      if (sourcePath.length > 0 && await fileStore.exists(paths.projectArtifact(sourcePath))) continue;
      issues.push(issue(
        `diagnostics_evidence_adjudication_missing_source_${sanitizeIssueId(relativePath)}_${sanitizeIssueId(sourcePath || 'empty')}`,
        'error',
        'diagnostics_evidence_adjudication',
        relativePath,
        `Evidence adjudication references missing source ${sourcePath || '(empty path)'}.`,
        'Restore the cited artifact or regenerate diagnostics-adjudicate.',
        true
      ));
    }

    for (const evidence of report.draftEvidence) {
      const evidencePath = paths.projectArtifact(evidence.path);
      if (!(await fileStore.exists(evidencePath))) {
        issues.push(issue(
          `diagnostics_evidence_adjudication_missing_draft_${sanitizeIssueId(evidence.evidenceId)}`,
          'error',
          'diagnostics_evidence_adjudication',
          evidence.path,
          `Draft evidence ${evidence.evidenceId} references a missing path.`,
          'Restore the draft or regenerate the adjudication report.',
          true
        ));
        continue;
      }
      const paragraph = parseMarkdownEvidenceParagraphs(await fileStore.readText(evidencePath))[evidence.paragraphIndex - 1];
      if (paragraph === undefined || !paragraph.text.includes(evidence.snippet) || sha256(evidence.snippet) !== evidence.normalizedSnippetHash) {
        issues.push(issue(
          `diagnostics_evidence_adjudication_invalid_draft_citation_${sanitizeIssueId(evidence.evidenceId)}`,
          'error',
          'diagnostics_evidence_adjudication',
          evidence.path,
          `Draft evidence ${evidence.evidenceId} does not match its cited paragraph or snippet hash.`,
          'Regenerate evidence citations from the current draft without editing canonical artifacts.',
          true
        ));
      }
    }

    for (const evidence of report.planningEvidence) {
      const evidencePath = paths.projectArtifact(evidence.path);
      if (!(await fileStore.exists(evidencePath)) || !(await fileStore.readText(evidencePath)).includes(evidence.snippet) || sha256(evidence.snippet) !== evidence.normalizedSnippetHash) {
        issues.push(issue(
          `diagnostics_evidence_adjudication_invalid_planning_citation_${sanitizeIssueId(evidence.evidenceId)}`,
          'error',
          'diagnostics_evidence_adjudication',
          evidence.path,
          `Planning evidence ${evidence.evidenceId} does not match its source artifact.`,
          'Restore mission/selected plan or regenerate diagnostics-adjudicate.',
          true
        ));
      }
    }

    const storyState = await fileStore.readJson(paths.projectArtifact(report.sourceStoryStatePath), StoryStateSchema);
    const timelineIds = new Set(storyState.timeline.map((event) => event.id));
    const canonFactIds = new Set(storyState.canonFacts.map((fact) => fact.id));
    const characterIds = new Set(storyState.characters.map((character) => character.id));
    const expectedCanonConflict = report.temporalRulesTriggered.some((ruleItem) =>
      ruleItem.ruleId === 'canon_timeline_time_mismatch' && ruleItem.outcome === 'confirmed_contradiction'
    );
    const canonicalReview = report.canonicalContextReview;
    if (canonicalReview === undefined) {
      issues.push(issue(
        `diagnostics_evidence_adjudication_legacy_canonical_review_${sanitizeIssueId(relativePath)}`,
        'warning',
        'diagnostics_evidence_adjudication',
        report.sourceStoryStatePath,
        'Legacy adjudication report does not contain the canonical timeline and character-state review summary.',
        'Generate a new diagnostics-adjudicate report when an explicit canonical context review is required.',
        false
      ));
    } else if (
      canonicalReview.latestCommittedChapter !== storyState.latestCommittedChapter ||
      canonicalReview.timelineEventsReviewed !== storyState.timeline.length ||
      canonicalReview.characterStatesReviewed !== storyState.characters.length ||
      canonicalReview.relevantCharacterStateIds.some((characterId) => !characterIds.has(characterId)) ||
      canonicalReview.canonicalTimelineConflictFound !== expectedCanonConflict
    ) {
      issues.push(issue(
        `diagnostics_evidence_adjudication_invalid_canonical_review_${sanitizeIssueId(relativePath)}`,
        'error',
        'diagnostics_evidence_adjudication',
        report.sourceStoryStatePath,
        'Canonical timeline or character-state review does not match the cited Story State.',
        'Regenerate diagnostics-adjudicate from the current Story State.',
        true
      ));
    }
    for (const evidence of report.canonEvidence) {
      const missingTimeline = !timelineIds.has(evidence.timelineEventId);
      const missingFacts = evidence.relatedCanonFactIds.filter((factId) => !canonFactIds.has(factId));
      if (!missingTimeline && missingFacts.length === 0) continue;
      issues.push(issue(
        `diagnostics_evidence_adjudication_invalid_canon_citation_${sanitizeIssueId(evidence.evidenceId)}`,
        'error',
        'diagnostics_evidence_adjudication',
        evidence.statePath,
        `Canon evidence ${evidence.evidenceId} references missing timeline/fact ids: ${[...(missingTimeline ? [evidence.timelineEventId] : []), ...missingFacts].join(', ')}.`,
        'Regenerate adjudication from the current Story State.',
        true
      ));
    }

    const expectedRepeatability = report.sampleConsensus.validSampleCount === 0
      ? 0
      : roundedRate(report.repeatedFailureCount, report.sampleConsensus.validSampleCount);
    if (
      report.repeatedFailureCount > report.sampleConsensus.validSampleCount ||
      report.repeatabilityRate !== expectedRepeatability ||
      report.sampleConsensus.repeatabilityRate !== expectedRepeatability
    ) {
      issues.push(issue(
        `diagnostics_evidence_adjudication_invalid_repeatability_${sanitizeIssueId(relativePath)}`,
        'error',
        'diagnostics_evidence_adjudication',
        relativePath,
        'Repeated-failure counts or repeatabilityRate do not match the valid-sample denominator.',
        'Regenerate adjudication from the schema-valid sample set.',
        true
      ));
    }

    if (report.adjudication === 'confirmed_true_positive' && (
      report.evidenceClaims.length === 0 ||
      report.draftEvidence.length === 0 ||
      !report.temporalRulesTriggered.some((rule) => rule.outcome === 'confirmed_contradiction')
    )) {
      issues.push(issue(
        `diagnostics_evidence_adjudication_unsubstantiated_confirmation_${sanitizeIssueId(relativePath)}`,
        'error',
        'diagnostics_evidence_adjudication',
        relativePath,
        'confirmed_true_positive has no complete draft evidence and deterministic temporal rule.',
        'Downgrade the adjudication or regenerate it with concrete citations.',
        true
      ));
    }
    if (report.adjudication === 'false_positive' && report.falsePositiveFactors.length === 0) {
      issues.push(issue(
        `diagnostics_evidence_adjudication_unsubstantiated_false_positive_${sanitizeIssueId(relativePath)}`,
        'error',
        'diagnostics_evidence_adjudication',
        relativePath,
        'false_positive has no falsePositiveFactors.',
        'Record the concrete event-identity or citation reason before classifying a false positive.',
        true
      ));
    }
    if (report.adjudication === 'ambiguous' || report.adjudication === 'insufficient_evidence') {
      issues.push(issue(
        `diagnostics_evidence_adjudication_needs_review_${sanitizeIssueId(relativePath)}`,
        'warning',
        'diagnostics_evidence_adjudication',
        relativePath,
        `Diagnostics evidence adjudication is ${report.adjudication}.`,
        'Resolve the listed questions through human review before revising the chapter.',
        false
      ));
    }
    if (report.evidenceClaims.some((claim) => claim.normalizedClaim.startsWith('unclassified_'))) {
      issues.push(issue(
        `diagnostics_evidence_adjudication_legacy_evidence_${sanitizeIssueId(relativePath)}`,
        'warning',
        'diagnostics_evidence_adjudication',
        relativePath,
        'One or more diagnostics samples lack detailed evidence that can be deterministically classified.',
        'Regenerate structured diagnostics with explicit event A, event B, and contradiction evidence.',
        false
      ));
    }

    for (const protectedArtifact of report.protectedArtifacts) {
      const protectedPath = paths.projectArtifact(protectedArtifact.path);
      const currentHash = await fileStore.exists(protectedPath) ? sha256(await fileStore.readText(protectedPath)) : '';
      if (
        !protectedArtifact.unchanged ||
        protectedArtifact.beforeSha256 !== protectedArtifact.afterSha256 ||
        currentHash !== protectedArtifact.afterSha256
      ) {
        issues.push(issue(
          `diagnostics_evidence_adjudication_protected_artifact_changed_${sanitizeIssueId(protectedArtifact.path)}`,
          'critical',
          'diagnostics_evidence_adjudication',
          protectedArtifact.path,
          'A canonical artifact covered by diagnostics-adjudicate immutability checks has changed.',
          'Restore the protected artifact and rerun adjudication from a clean baseline.',
          true
        ));
      }
    }
  } catch {
    // checkJson already recorded schema or source errors.
  }
}

async function checkTimelineContradictionMap(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const map = await fileStore.readJson(absolutePath, TimelineContradictionMapSchema);
    if (!(await fileStore.exists(paths.projectArtifact(map.sourceAdjudicationReportPath)))) {
      issues.push(issue(
        `timeline_contradiction_map_missing_report_${sanitizeIssueId(relativePath)}`,
        'error',
        'timeline_contradiction_map',
        relativePath,
        `Timeline map references missing adjudication report ${map.sourceAdjudicationReportPath}.`,
        'Restore or regenerate diagnostics-adjudicate artifacts.',
        true
      ));
    }
    const eventIds = new Set(map.eventNodes.map((node) => node.eventId));
    for (const edge of map.temporalEdges) {
      if (eventIds.has(edge.fromEventId) && eventIds.has(edge.toEventId)) continue;
      issues.push(issue(
        `timeline_contradiction_map_missing_edge_node_${sanitizeIssueId(edge.edgeId)}`,
        'error',
        'timeline_contradiction_map',
        relativePath,
        `Temporal edge ${edge.edgeId} references a missing event node.`,
        'Regenerate the timeline contradiction map from adjudicated events.',
        true
      ));
    }
    for (const contradiction of map.contradictions) {
      if (contradiction.eventIds.every((eventId) => eventIds.has(eventId))) continue;
      issues.push(issue(
        `timeline_contradiction_map_missing_contradiction_node_${sanitizeIssueId(contradiction.contradictionId)}`,
        'error',
        'timeline_contradiction_map',
        relativePath,
        `Contradiction ${contradiction.contradictionId} references a missing event node.`,
        'Regenerate the map from valid event comparisons.',
        true
      ));
    }
    for (const reference of map.canonicalTimelineReferences) {
      const state = await fileStore.readJson(paths.projectArtifact(reference.statePath), StoryStateSchema);
      if (state.timeline.some((event) => event.id === reference.timelineEventId) && eventIds.has(reference.eventNodeId)) continue;
      issues.push(issue(
        `timeline_contradiction_map_invalid_canon_reference_${sanitizeIssueId(reference.timelineEventId)}`,
        'error',
        'timeline_contradiction_map',
        reference.statePath,
        `Canonical timeline reference ${reference.timelineEventId} or its event node does not exist.`,
        'Regenerate the map from the current Story State.',
        true
      ));
    }
  } catch {
    // checkJson already recorded schema or source errors.
  }
}

async function checkTargetedRevisionExperiment(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const artifact = await fileStore.readJson(absolutePath, TargetedRevisionExperimentArtifactSchema);
    if ('revisionRound' in artifact) {
      await checkExpandedTargetRevisionExperiment(issues, paths, fileStore, artifact, relativePath);
      return;
    }
    const report = TargetedRevisionExperimentReportSchema.parse(artifact);
    const requiredPaths = [
      report.sourceAdjudicationPath,
      report.targetedRevisionPlanPath,
      report.candidateDraftPath,
      report.scopeValidationPath,
      report.revisionDiffPath,
      report.sourceDraftPath
    ];
    const missing = [];
    for (const artifactPath of requiredPaths) {
      if (!(await fileStore.exists(paths.projectArtifact(artifactPath)))) missing.push(artifactPath);
    }
    if (missing.length > 0) {
      issues.push(issue(
        `targeted_revision_missing_artifacts_${sanitizeIssueId(relativePath)}`,
        'error',
        'targeted_revision',
        relativePath,
        `Targeted revision experiment references missing artifacts: ${missing.join(', ')}.`,
        'Restore the isolated experiment artifacts or rerun targeted-revision-experiment from a fresh adjudication.',
        true
      ));
      return;
    }

    const [plan, scope, diff, candidateText, sourceDraftText] = await Promise.all([
      fileStore.readJson(paths.projectArtifact(report.targetedRevisionPlanPath), TargetedRevisionPlanSchema),
      fileStore.readJson(paths.projectArtifact(report.scopeValidationPath), TargetedRevisionScopeValidationSchema),
      fileStore.readJson(paths.projectArtifact(report.revisionDiffPath), TargetedRevisionDiffSchema),
      fileStore.readText(paths.projectArtifact(report.candidateDraftPath)),
      fileStore.readText(paths.projectArtifact(report.sourceDraftPath))
    ]);
    const candidateHash = sha256(candidateText);
    const sourceHash = sha256(sourceDraftText);
    const allowedTargets = new Set(plan.allowedTargets.map((target) => target.targetId));
    const diffTargets = new Set(diff.changes.map((change) => change.targetId));
    const scopeTargets = new Set(scope.changedParagraphs.map((change) => change.targetId));
    const expectedOrder = Array.from({ length: report.sampleCountPerArm }, (_, index) => [`A${index + 1}`, `B${index + 1}`]).flat();
    const sampleOrderValid = report.samples.every((sample, index) => {
      const expectedArm = index % 2 === 0 ? 'baseline' : 'candidate';
      const expectedPair = Math.floor(index / 2) + 1;
      return sample.sequenceIndex === index + 1 && sample.arm === expectedArm && sample.pairIndex === expectedPair;
    });
    const resultConsistent = report.result !== 'candidate_clears_timeline_failure' || (
      report.baselineSummary.timelineFailCount > 0 &&
      report.candidateSummary.timelineFailCount === 0 &&
      report.candidateSummary.schemaValidCount > 0
    );
    const crossArtifactValid =
      scope.scopeValid &&
      scope.candidateDraftHash === candidateHash &&
      scope.sourceDraftHash === sourceHash &&
      plan.sourceDraftHash === sourceHash &&
      report.samples.filter((sample) => sample.arm === 'baseline').every((sample) => sample.draftHash === sourceHash) &&
      report.samples.filter((sample) => sample.arm === 'candidate').every((sample) => sample.draftHash === candidateHash) &&
      diff.changes.every((change) => allowedTargets.has(change.targetId)) &&
      [...diffTargets].every((targetId) => scopeTargets.has(targetId)) &&
      report.executionOrder.join('|') === expectedOrder.join('|') &&
      sampleOrderValid &&
      report.environmentConsistent &&
      resultConsistent;
    if (!crossArtifactValid) {
      issues.push(issue(
        `targeted_revision_cross_artifact_mismatch_${sanitizeIssueId(relativePath)}`,
        'error',
        'targeted_revision',
        relativePath,
        'Targeted candidate, source hashes, scope report, diff, environment, or paired sample order do not agree.',
        'Discard the altered experiment artifacts and rerun from the unchanged adjudicated source draft.',
        true
      ));
    }

    const manifest = await fileStore.readJson(paths.runManifest(report.runId), RunManifestV2Schema);
    const safetyValid =
      manifest.args.storyStateCommitAllowed === false &&
      manifest.args.normalPreviewAllowed === false &&
      manifest.args.candidateAdoptionAllowed === false &&
      manifest.args.queueMutationAllowed === false &&
      manifest.stateMutations.length === 0 &&
      manifest.queueTransitions.length === 0 &&
      manifest.promptCalls.length === 1 + report.sampleCountPerArm * 2;
    if (!safetyValid) {
      issues.push(issue(
        `targeted_revision_run_safety_${sanitizeIssueId(report.runId)}`,
        'critical',
        'targeted_revision',
        path.join('runs', report.runId, 'run_manifest.json'),
        'Targeted revision run provenance violates preview-only safety or call-count expectations.',
        'Restore canonical artifacts and investigate the run before using its candidate.',
        true
      ));
    }

    for (const protectedArtifact of report.protectedArtifacts) {
      const protectedPath = paths.projectArtifact(protectedArtifact.path);
      const currentHash = await fileStore.exists(protectedPath) ? sha256(await fileStore.readText(protectedPath)) : '';
      if (protectedArtifact.beforeSha256 === protectedArtifact.afterSha256 && currentHash === protectedArtifact.afterSha256) continue;
      issues.push(issue(
        `targeted_revision_protected_artifact_changed_${sanitizeIssueId(protectedArtifact.path)}`,
        'critical',
        'targeted_revision',
        protectedArtifact.path,
        'A canonical artifact protected by the targeted revision experiment has changed.',
        'Restore the protected artifact before interpreting the experiment.',
        true
      ));
    }
  } catch {
    // checkJson or source checks already record schema and reference failures.
  }
}

async function checkTargetedRevisionOperationNormalization(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, TargetedRevisionOperationNormalizationSchema);
    const referencedPaths = [
      report.rawProviderOutputPath,
      report.approvalRecordPath,
      report.coverageReportPath,
      report.targetCoverageGraphPath
    ];
    const missing: string[] = [];
    for (const artifactPath of referencedPaths) {
      if (!(await fileStore.exists(paths.projectArtifact(artifactPath)))) missing.push(artifactPath);
    }
    if (!(await fileStore.exists(paths.runManifest(report.runId)))) {
      missing.push(path.posix.join('runs', report.runId, 'run_manifest.json'));
    }
    if (missing.length > 0) {
      issues.push(issue(
        `targeted_revision_operation_normalization_missing_source_${sanitizeIssueId(relativePath)}`,
        'error',
        'targeted_revision_operation_normalization',
        relativePath,
        `Operation normalization references missing provenance: ${missing.join(', ')}.`,
        'Restore the immutable provider output and approval/coverage/run provenance, then rerun the contract check.',
        true
      ));
      return;
    }

    const [rawText, coverage, manifest] = await Promise.all([
      fileStore.readText(paths.projectArtifact(report.rawProviderOutputPath)),
      fileStore.readJson(paths.projectArtifact(report.coverageReportPath), TargetCoverageClosureReportSchema),
      fileStore.readJson(paths.runManifest(report.runId), RunManifestV2Schema)
    ]);
    let rawOutput: unknown;
    try {
      rawOutput = JSON.parse(rawText) as unknown;
    } catch {
      rawOutput = undefined;
    }
    const providerValidation = TargetedRevisionProviderOutputSchema.safeParse(rawOutput);
    const providerOperations = providerValidation.success ? providerValidation.data.operations : [];
    const providerById = new Map(providerOperations.map((operation) => [operation.operationId, operation]));
    const entriesBySource = new Map(report.operations.map((operation) => [operation.sourceOperationId, operation]));
    const normalizedById = new Map(report.normalizedOperations.map((operation) => [operation.operationId, operation]));
    const approvedFromCoverage = [...coverage.initialTargets, ...coverage.proposedAdditionalTargets]
      .map((target) => target.targetId)
      .sort();
    const reportApproved = [...report.approvedTargetIds].sort();

    const provenanceValid = report.normalizedOperations.every((operation) => {
      const entry = entriesBySource.get(operation.sourceOperationId);
      const providerOperation = providerById.get(operation.sourceOperationId);
      return entry !== undefined && providerOperation !== undefined &&
        operation.parentOperationId === operation.sourceOperationId &&
        entry.normalizedOperationIds.includes(operation.operationId) &&
        entry.normalizedTargetIds.includes(operation.targetIds[0] ?? '') &&
        entry.normalizationMode === operation.normalizationMode &&
        providerOperation.operationId === operation.parentOperationId &&
        operation.targetIds.every((targetId) => report.approvedTargetIds.includes(targetId)) &&
        (operation.operationType !== 'delete_duplicate_paragraph' || operation.targetIds.length === 1);
    }) && report.operations.every((entry) => {
      const children = entry.normalizedOperationIds.map((operationId) => normalizedById.get(operationId));
      return providerById.has(entry.sourceOperationId) && children.every((operation) => operation !== undefined) &&
        children.flatMap((operation) => operation?.targetIds ?? []).sort().join('|') === [...entry.normalizedTargetIds].sort().join('|');
    });

    const rawAndContractValid =
      sha256(rawText) === report.rawProviderOutputHash &&
      sha256(await fileStore.readText(paths.projectArtifact(report.targetCoverageGraphPath))) === report.targetCoverageGraphHash &&
      providerValidation.success === report.providerSchemaValid &&
      report.sourceOperationCount === (providerValidation.success ? providerOperations.length : rawOperationCountForAudit(rawOutput)) &&
      approvedFromCoverage.join('|') === reportApproved.join('|') &&
      report.normalizedOperations.every((operation) => report.approvedTargetIds.every((targetId) => typeof targetId === 'string') &&
        operation.newFactsIntroduced.length === 0) &&
      (!report.normalizationSucceeded || (report.canonicalSchemaValid && provenanceValid));

    const protectedValid = await allProtectedArtifactsCurrent(paths, fileStore, report.protectedArtifacts);
    const generatedPaths = manifest.artifacts.filter((artifact) => artifact.action === 'generated').map((artifact) => artifact.path);
    const forbiddenReplayArtifacts = generatedPaths.filter((artifactPath) =>
      /(?:draft_targeted_revision_candidate|targeted_revision_plan|targeted_revision_scope_validation|targeted_revision_diff|targeted_revision_experiment|final\.md|canon_patch|commit_report|snapshot)/i.test(artifactPath)
    );
    const runSafetyValid = report.mode !== 'contract_check' || (
      report.codexInvoked === false && manifest.command === 'codex targeted-revision-contract-check' &&
      manifest.promptCalls.length === 0 && manifest.stateMutations.length === 0 &&
      manifest.queueTransitions.length === 0 && manifest.snapshots.length === 0 && forbiddenReplayArtifacts.length === 0
    );

    if (!rawAndContractValid || !protectedValid || !runSafetyValid || (report.normalizationSucceeded && !provenanceValid)) {
      issues.push(issue(
        `targeted_revision_operation_normalization_invalid_${sanitizeIssueId(relativePath)}`,
        'critical',
        'targeted_revision_operation_normalization',
        relativePath,
        `Operation normalization raw hash, approved targets, canonical linkage, protected artifacts, or replay safety is inconsistent. forbiddenReplayArtifacts=${forbiddenReplayArtifacts.join(', ') || 'none'}.`,
        'Discard the derived normalization report and rerun normalization from the immutable parsed provider output and latest approval.',
        true
      ));
    }
  } catch {
    // checkJson records schema failures; source-specific checks above report valid-schema inconsistencies.
  }
}

function rawOperationCountForAudit(value: unknown): number {
  if (typeof value !== 'object' || value === null || !('operations' in value)) return 0;
  const operations = (value as { operations?: unknown }).operations;
  return Array.isArray(operations) ? operations.length : 0;
}

async function checkExpandedTargetRevisionExperiment(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  report: ExpandedTargetRevisionExperimentReport,
  relativePath: string
): Promise<void> {
  const requiredPaths = [
    report.approvalRecordPath,
    report.coverageReportPath,
    report.operationNormalizationReportPath,
    report.candidateV1DispositionPath,
    report.sourceAdjudicationPath,
    report.sourceDraftPath,
    report.targetedRevisionPlanPath,
    report.candidateDraftPath,
    report.scopeValidationPath,
    report.revisionDiffPath,
    report.diagnosticsABPath,
    report.candidateAdjudicationPath,
    report.candidateTimelineMapPath,
    report.qualityReportPath
  ];
  const missing: string[] = [];
  for (const artifactPath of requiredPaths) {
    if (!(await fileStore.exists(paths.projectArtifact(artifactPath)))) missing.push(artifactPath);
  }
  if (missing.length > 0) {
    issues.push(issue(
      `expanded_target_revision_missing_artifacts_${sanitizeIssueId(relativePath)}`,
      'error',
      'targeted_revision',
      relativePath,
      `Expanded-target revision references missing artifacts: ${missing.join(', ')}.`,
      'Restore the complete isolated round-2 artifact set or rerun from unchanged approved sources.',
      true
    ));
    return;
  }

  try {
    const [plan, normalization, scope, diff, diagnostics, adjudication, timelineMap, quality, approval, coverage, candidateV1Disposition, candidateText, sourceText, manifest] = await Promise.all([
      fileStore.readJson(paths.projectArtifact(report.targetedRevisionPlanPath), ExpandedTargetRevisionPlanSchema),
      fileStore.readJson(paths.projectArtifact(report.operationNormalizationReportPath), TargetedRevisionOperationNormalizationSchema),
      fileStore.readJson(paths.projectArtifact(report.scopeValidationPath), ExpandedTargetRevisionScopeValidationSchema),
      fileStore.readJson(paths.projectArtifact(report.revisionDiffPath), TargetedRevisionDiffSchema),
      fileStore.readJson(paths.projectArtifact(report.diagnosticsABPath), ExpandedTargetRevisionDiagnosticsABSchema),
      fileStore.readJson(paths.projectArtifact(report.candidateAdjudicationPath), CandidateRevisionEvidenceAdjudicationSchema),
      fileStore.readJson(paths.projectArtifact(report.candidateTimelineMapPath), CandidateTimelineContradictionMapSchema),
      fileStore.readJson(paths.projectArtifact(report.qualityReportPath), ExpandedTargetRevisionQualityReportSchema),
      fileStore.readJson(paths.projectArtifact(report.approvalRecordPath), TargetExpansionApprovalRecordSchema),
      fileStore.readJson(paths.projectArtifact(report.coverageReportPath), TargetCoverageClosureReportSchema),
      fileStore.readJson(paths.projectArtifact(report.candidateV1DispositionPath), CandidateDispositionSchema),
      fileStore.readText(paths.projectArtifact(report.candidateDraftPath)),
      fileStore.readText(paths.projectArtifact(report.sourceDraftPath)),
      fileStore.readJson(paths.runManifest(report.runId), RunManifestV2Schema)
    ]);
    const candidateHash = sha256(candidateText);
    const sourceHash = sha256(sourceText);
    const approvedFullSet = [...coverage.initialTargets.map((target) => target.targetId), ...coverage.proposedAdditionalTargets.map((target) => target.targetId)].sort();
    const planSet = [...plan.fullApprovedTargetIds].sort();
    const operationCoverageSet = plan.targetOperationCoverage.map((target) => target.targetId).sort();
    const requiredTargetsHandled = plan.targetOperationCoverage
      .filter((target) => target.requiredForClosure)
      .every((target) => target.disposition !== 'preserved_with_justification' && target.operationIds.length > 0);
    const baselineValid = diagnostics.samples.filter((sample) => sample.arm === 'baseline' && sample.schemaValid);
    const candidateValid = diagnostics.samples.filter((sample) => sample.arm === 'candidate' && sample.schemaValid);
    const expectedOrder = Array.from({ length: report.sampleCountPerArm }, (_, index) => [`A${index + 1}`, `B${index + 1}`]).flat();
    const sampleOrderValid = diagnostics.samples.every((sample, index) =>
      sample.sequenceIndex === index + 1 &&
      sample.pairIndex === Math.floor(index / 2) + 1 &&
      sample.arm === (index % 2 === 0 ? 'baseline' : 'candidate')
    );
    const denominatorValid =
      auditRate(baselineValid.length, report.sampleCountPerArm) === diagnostics.baselineSchemaValidRate &&
      auditRate(candidateValid.length, report.sampleCountPerArm) === diagnostics.candidateSchemaValidRate &&
      auditRate(baselineValid.filter((sample) => sample.timelineConsistencyPassed === false).length, baselineValid.length) === diagnostics.baselineTimelineFailureRate &&
      auditRate(candidateValid.filter((sample) => sample.timelineConsistencyPassed === false).length, candidateValid.length) === diagnostics.candidateTimelineFailureRate &&
      auditRate(baselineValid.filter((sample) => sample.allHardChecksPassed === false).length, baselineValid.length) === diagnostics.baselineAnyBlockingFailureRate &&
      auditRate(candidateValid.filter((sample) => sample.allHardChecksPassed === false).length, candidateValid.length) === diagnostics.candidateAnyBlockingFailureRate;
    const generatedPaths = manifest.artifacts.filter((artifact) => artifact.action === 'generated').map((artifact) => artifact.path);
    const diagnosticsPromptCalls = manifest.promptCalls.filter((call) => call.promptId === diagnostics.diagnosticsPromptId);
    const forbiddenGenerated = generatedPaths.filter((artifactPath) =>
      /(?:^|\/)(?:final\.md|canon_patch(?:_.*)?\.json|commit_report(?:_.*)?\.json|approval_record(?:_.*)?\.json)$/.test(artifactPath) ||
      /(?:preview|snapshot)/i.test(artifactPath)
    );
    const safetyValid =
      manifest.args.revisionRound === 2 &&
      manifest.args.sourceCandidatePath === null &&
      manifest.args.storyStateCommitAllowed === false &&
      manifest.args.normalPreviewAllowed === false &&
      manifest.args.candidateAdoptionAllowed === false &&
      manifest.args.queueMutationAllowed === false &&
      manifest.args.canonicalPatchAllowed === false &&
      manifest.args.snapshotAllowed === false &&
      manifest.args.automaticFurtherRevisionAllowed === false &&
      manifest.stateMutations.length === 0 && manifest.queueTransitions.length === 0 && manifest.snapshots.length === 0 &&
      manifest.promptCalls.length === 1 + report.sampleCountPerArm * 2 && forbiddenGenerated.length === 0;
    const protectedValid = await allProtectedArtifactsCurrent(paths, fileStore, report.protectedArtifacts);
    const sourceLinksValid =
      report.revisionRound === 2 && plan.revisionRound === 2 && scope.revisionRound === 2 && diagnostics.revisionRound === 2 &&
      report.sourceCandidatePath === null && plan.sourceCandidatePath === null && /draft_v1\.md$/.test(report.sourceDraftPath) &&
      report.approvalRecordPath === plan.approvalRecordPath && report.coverageReportPath === plan.coverageReportPath &&
      report.operationNormalizationReportPath === plan.operationNormalizationReportPath &&
      approval.coverageReportPath === report.coverageReportPath && approval.coverageReportHash === sha256(await fileStore.readText(paths.projectArtifact(report.coverageReportPath))) &&
      approval.approved && approval.riskAcknowledged && coverage.coverageClosed &&
      candidateV1Disposition.result === 'rejected_no_improvement' && !candidateV1Disposition.eligibleAsNextRevisionBase && !candidateV1Disposition.adopted;
    const artifactLinksValid =
      plan.sourceDraftHash === sourceHash && scope.sourceDraftHash === sourceHash && diagnostics.sourceDraftHash === sourceHash &&
      scope.candidateDraftHash === candidateHash && diagnostics.candidateDraftHash === candidateHash && timelineMap.sourceCandidateHash === candidateHash &&
      adjudication.sourceCandidateHash === candidateHash && adjudication.sourceDiagnosticsABPath === report.diagnosticsABPath &&
      adjudication.candidateTimelineContradictionMapPath === report.candidateTimelineMapPath &&
      approvedFullSet.join('|') === planSet.join('|') && planSet.join('|') === operationCoverageSet.join('|') &&
      normalization.mode === 'pipeline' && normalization.normalizationSucceeded && normalization.codexInvoked &&
      normalization.canonicalSchemaValid && normalization.coveragePreflightPassed && !normalization.semanticChangesIntroduced &&
      JSON.stringify(normalization.normalizedOperations) === JSON.stringify(plan.operations) &&
      requiredTargetsHandled && scope.requiredTargetsHandled && scope.fullApprovedTargetSetMatched && scope.nonTargetParagraphsUnchanged &&
      diff.changes.every((change) => planSet.includes(change.targetId)) &&
      diagnostics.executionOrder.join('|') === expectedOrder.join('|') && report.executionOrder.join('|') === expectedOrder.join('|') &&
      sampleOrderValid && denominatorValid &&
      diagnostics.provider === 'codex-text' && diagnosticsPromptCalls.length === report.sampleCountPerArm * 2 &&
      diagnosticsPromptCalls.every((call) => call.provider === diagnostics.provider && call.codexProfile === diagnostics.codexProfile &&
        call.outputSchemaPath === diagnostics.diagnosticsOutputSchemaPath && diagnostics.codexVersions.includes(call.codexVersion ?? '')) &&
      diagnostics.storyStateHash === sha256(await fileStore.readText(paths.storyState())) &&
      diagnostics.missionHash === sha256(await fileStore.readText(paths.chapterArtifact(report.chapterNumber, 'mission.json'))) &&
      diagnostics.selectedPlanHash === sha256(await fileStore.readText(paths.chapterArtifact(report.chapterNumber, 'selected_plan.md'))) &&
      diagnostics.samples.filter((sample) => sample.arm === 'baseline').every((sample) => sample.draftHash === sourceHash) &&
      diagnostics.samples.filter((sample) => sample.arm === 'candidate').every((sample) => sample.draftHash === candidateHash) &&
      quality.sourceDraftPath === report.sourceDraftPath && quality.candidateDraftPath === report.candidateDraftPath;
    const resultValid = report.result !== 'revision_effective' || (
      scope.scopeValid && report.fullApprovedTargetSetMatched && diagnostics.experimentValid &&
      diagnostics.baselineSchemaValidRate >= 0.8 && diagnostics.candidateSchemaValidRate >= 0.8 &&
      diagnostics.baselineTimelineFailureRate >= 0.8 && diagnostics.candidateTimelineFailureRate <= 0.2 &&
      diagnostics.newlyIntroducedHardChecks.length === 0 && adjudication.adjudication === 'no_remaining_contradiction' &&
      quality.criticalIssueCount === 0 && quality.scoreRegressionWithinLimit
    );
    if (!sourceLinksValid || !artifactLinksValid || !resultValid || !safetyValid || !protectedValid) {
      issues.push(issue(
        `expanded_target_revision_cross_artifact_invalid_${sanitizeIssueId(relativePath)}`,
        'critical',
        'targeted_revision',
        relativePath,
        `Round-2 approval, source, target coverage, A/B denominator, result, run safety, or protected hashes are inconsistent. forbiddenGenerated=${forbiddenGenerated.join(', ') || 'none'}.`,
        'Keep candidate v2 isolated, restore canonical files, and regenerate only from the latest unchanged approval.',
        true
      ));
    }
  } catch {
    // Individual schema and missing-source checks report malformed artifacts.
  }
}

async function checkCandidateDisposition(
  issues: AuditIssue[],
  absolutePath: string,
  relativePath: string,
  fileStore: FileStore
): Promise<void> {
  try {
    const artifact = await fileStore.readJson(absolutePath, TargetedRevisionCandidateDispositionArtifactSchema);
    if ('revisionRound' in artifact) {
      const disposition = ExpandedTargetRevisionCandidateDispositionSchema.parse(artifact);
      if (disposition.adopted || disposition.committed || disposition.automaticFurtherRevisionAllowed ||
        (disposition.result === 'accepted_for_preview_review') !== disposition.eligibleForPreviewReview) {
        issues.push(issue(
          `expanded_target_revision_invalid_disposition_${sanitizeIssueId(relativePath)}`,
          'critical',
          'targeted_revision',
          relativePath,
          'Candidate v2 disposition permits automatic adoption, commit, further revision, or inconsistent preview eligibility.',
          'Restore the isolated candidate disposition and require explicit human review.',
          true
        ));
      }
      return;
    }
    const disposition = CandidateDispositionSchema.parse(artifact);
    if (!disposition.result.startsWith('rejected_') || disposition.adopted || disposition.eligibleAsNextRevisionBase || !disposition.retainForProvenance) {
      issues.push(issue(
        `target_coverage_invalid_disposition_${sanitizeIssueId(relativePath)}`,
        'critical',
        'target_coverage',
        relativePath,
        'Rejected targeted candidate disposition permits adoption, reuse as a revision base, or provenance deletion.',
        'Restore the rejected disposition and keep candidate v1 only as immutable provenance.',
        true
      ));
    }
  } catch {
    // checkJson records schema failures.
  }
}

async function checkTargetCoverageGraph(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const graph = await fileStore.readJson(absolutePath, TargetCoverageGraphSchema);
    const draftPath = paths.projectArtifact(graph.sourceDraftPath);
    if (!(await fileStore.exists(draftPath)) || sha256(await fileStore.readText(draftPath)) !== graph.sourceDraftHash) {
      issues.push(issue(
        `target_coverage_graph_source_stale_${sanitizeIssueId(relativePath)}`,
        'error',
        'target_coverage',
        relativePath,
        'Target coverage graph source draft is missing or its hash changed.',
        'Regenerate coverage closure from the unchanged original draft and discard stale approval artifacts.',
        true
      ));
      return;
    }
    const paragraphs = parseMarkdownEvidenceParagraphs(await fileStore.readText(draftPath));
    for (const node of graph.nodes.filter((item) => item.nodeType === 'paragraph_evidence')) {
      const paragraph = node.paragraphIndex === null ? undefined : paragraphs[node.paragraphIndex - 1];
      if (paragraph !== undefined && node.snippetHash === sha256(paragraph.text.slice(0, 600))) continue;
      issues.push(issue(
        `target_coverage_graph_evidence_invalid_${sanitizeIssueId(node.nodeId)}`,
        'error',
        'target_coverage',
        relativePath,
        `Coverage graph node ${node.nodeId} references a missing paragraph or mismatched snippet hash.`,
        'Regenerate the coverage graph from the original draft.',
        true
      ));
    }
  } catch {
    // checkJson records schema failures.
  }
}

async function checkTargetCoverageReport(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, TargetCoverageClosureReportSchema);
    const hashedPaths: Array<[string, string]> = [
      [report.sourceDraftPath, report.sourceDraftHash],
      [report.sourceAdjudicationPath, report.sourceAdjudicationHash],
      [report.sourceTimelineMapPath, report.sourceTimelineMapHash],
      [report.sourceExperimentPath, report.sourceExperimentHash],
      [report.sourceRevisionPlanPath, report.sourceRevisionPlanHash],
      [report.sourceRevisionDiffPath, report.sourceRevisionDiffHash],
      [report.rejectedCandidatePath, report.rejectedCandidateHash],
      [report.candidateDispositionPath, report.candidateDispositionHash],
      [report.targetCoverageGraphPath, report.targetCoverageGraphHash]
    ];
    const stalePaths: string[] = [];
    for (const [artifactPath, expectedHash] of hashedPaths) {
      const targetPath = paths.projectArtifact(artifactPath);
      if (!(await fileStore.exists(targetPath)) || sha256(await fileStore.readText(targetPath)) !== expectedHash) stalePaths.push(artifactPath);
    }
    const sourceDraft = await fileStore.readText(paths.projectArtifact(report.sourceDraftPath));
    const paragraphs = parseMarkdownEvidenceParagraphs(sourceDraft);
    const invalidTargets = [...report.initialTargets, ...report.proposedAdditionalTargets].filter((target) => {
      const paragraph = paragraphs[target.paragraphIndex - 1];
      return paragraph === undefined || !paragraph.text.includes(target.snippet) || sha256(target.snippet) !== target.snippetHash;
    });
    const disposition = await fileStore.readJson(paths.projectArtifact(report.candidateDispositionPath), CandidateDispositionSchema);
    const graph = await fileStore.readJson(paths.projectArtifact(report.targetCoverageGraphPath), TargetCoverageGraphSchema);
    const protectedChanged: string[] = [];
    for (const artifact of report.protectedArtifacts) {
      const targetPath = paths.projectArtifact(artifact.path);
      if (!(await fileStore.exists(targetPath)) || sha256(await fileStore.readText(targetPath)) !== artifact.afterSha256 || artifact.beforeSha256 !== artifact.afterSha256) protectedChanged.push(artifact.path);
    }
    if (
      stalePaths.length > 0 ||
      invalidTargets.length > 0 ||
      disposition.adopted ||
      disposition.eligibleAsNextRevisionBase ||
      report.candidateUsedAsRevisionBase ||
      graph.coverageClosed !== report.coverageClosed ||
      protectedChanged.length > 0 ||
      (!report.coverageClosed && /approve-target-expansion/.test(report.recommendedNextStep))
    ) {
      issues.push(issue(
        `target_coverage_cross_artifact_invalid_${sanitizeIssueId(relativePath)}`,
        'critical',
        'target_coverage',
        relativePath,
        `Target coverage sources, hashes, metrics, graph, disposition, or protected artifacts are inconsistent. Stale: ${stalePaths.join(', ') || 'none'}; invalid targets: ${invalidTargets.map((target) => target.targetId).join(', ') || 'none'}; changed protected: ${protectedChanged.join(', ') || 'none'}.`,
        'Discard stale coverage and approval artifacts, restore canonical files, and regenerate diagnostics-target-coverage.',
        true
      ));
    }
    const chapterEntries = await fileStore.list(paths.chapterDir(report.chapterNumber));
    const experimentVersion = versionFromArtifactPath(report.sourceExperimentPath);
    let newerExperimentUsesCoverage = false;
    for (const entry of chapterEntries) {
      const match = /^targeted_revision_experiment_v(\d+)\.json$/.exec(entry);
      if (match === null || Number.parseInt(match[1]!, 10) <= experimentVersion) continue;
      try {
        const experiment = await fileStore.readJson(
          paths.chapterArtifact(report.chapterNumber, entry),
          TargetedRevisionExperimentArtifactSchema
        );
        if ('coverageReportPath' in experiment && experiment.coverageReportPath === relativePath) {
          newerExperimentUsesCoverage = true;
          break;
        }
      } catch {
        // The JSON artifact and its cross-links are validated separately.
      }
    }
    const approvalExists = await hasApprovalForCoverage(paths, fileStore, report.chapterNumber, relativePath);
    if (newerExperimentUsesCoverage && !approvalExists) {
      issues.push(issue(
        `target_coverage_unapproved_candidate_${sanitizeIssueId(relativePath)}`,
        'critical',
        'target_coverage',
        relativePath,
        'A newer targeted revision experiment exists without approval of the expanded target set.',
        'Remove the unauthorized candidate artifacts and restore the approval gate.',
        true
      ));
    }
  } catch {
    // checkJson records schema failures.
  }
}

async function checkTargetExpansionApprovalPreview(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const preview = await fileStore.readJson(absolutePath, TargetExpansionApprovalPreviewSchema);
    const reportPath = paths.projectArtifact(preview.coverageReportPath);
    if (!(await fileStore.exists(reportPath)) || sha256(await fileStore.readText(reportPath)) !== preview.coverageReportHash) {
      issues.push(issue(
        `target_coverage_approval_preview_stale_${sanitizeIssueId(relativePath)}`,
        'error',
        'target_coverage',
        relativePath,
        'Target expansion approval preview references a missing or changed coverage report.',
        'Regenerate diagnostics-target-coverage before approval.',
        true
      ));
    }
  } catch {
    // checkJson records schema failures.
  }
}

async function checkTargetExpansionApprovalRecord(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const record = await fileStore.readJson(absolutePath, TargetExpansionApprovalRecordSchema);
    const reportPath = paths.projectArtifact(record.coverageReportPath);
    const previewPath = paths.projectArtifact(record.sourceApprovalPreviewPath);
    if (
      !(await fileStore.exists(reportPath)) ||
      sha256(await fileStore.readText(reportPath)) !== record.coverageReportHash ||
      !(await fileStore.exists(previewPath)) ||
      sha256(await fileStore.readText(previewPath)) !== record.sourceApprovalPreviewHash
    ) {
      issues.push(issue(
        `target_coverage_approval_record_stale_${sanitizeIssueId(relativePath)}`,
        'critical',
        'target_coverage',
        relativePath,
        'Approved target expansion record references changed source artifacts.',
        'Invalidate this approval and regenerate target coverage from fresh sources.',
        true
      ));
    }
  } catch {
    // checkJson records schema failures.
  }
}

async function hasApprovalForCoverage(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, coveragePath: string): Promise<boolean> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  for (const entry of entries.filter((value) => /^target_expansion_approval_v\d+\.json$/.test(value))) {
    try {
      const record = await fileStore.readJson(paths.chapterArtifact(chapterNumber, entry), TargetExpansionApprovalRecordSchema);
      if (record.coverageReportPath === coveragePath) return true;
    } catch {
      // Schema validation reports the malformed approval separately.
    }
  }
  return false;
}

function versionFromArtifactPath(artifactPath: string): number {
  const match = /_v(\d+)\.json$/.exec(artifactPath);
  return match === null ? 0 : Number.parseInt(match[1]!, 10);
}

async function checkRevisionOpportunityReport(issues: AuditIssue[], absolutePath: string, relativePath: string, fileStore: FileStore): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, RevisionOpportunityReportSchema);
    if (report.storyStateMutated) {
      issues.push(issue(
        `revision_opportunity_state_mutated_${sanitizeIssueId(relativePath)}`,
        'critical',
        'revision_opportunity',
        relativePath,
        'Revision opportunity report indicates Story State mutation.',
        'Regenerate revision opportunity report from existing artifacts only.',
        true
      ));
    }
  } catch {
    // checkJson already recorded schema errors.
  }
}

async function findLatestChapterArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string
): Promise<string | undefined> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) return undefined;
  const pattern = new RegExp(`^${baseName}_v\\d+\\.json$`);
  const entry = (await fileStore.list(chapterDir)).filter((fileName) => pattern.test(fileName)).at(-1);
  return entry === undefined ? undefined : path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, entry);
}

async function checkCodexContextManifests(issues: AuditIssue[], paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  const contextDir = paths.projectArtifact(path.join('codex', 'context'));
  if (!(await fileStore.exists(contextDir))) return;
  for (const fileName of await fileStore.list(contextDir)) {
    if (!/^context_manifest_v\d+\.json$/.test(fileName)) continue;
    const absolutePath = path.join(contextDir, fileName);
    const relativePath = path.join('codex', 'context', fileName);
    await checkJson(issues, fileStore, absolutePath, 'codex_context', relativePath, CodexContextManifestSchema);
    try {
      const manifest = await fileStore.readJson(absolutePath, CodexContextManifestSchema);
      if (manifest.actualBytes > manifest.budgetBytes) {
        issues.push(issue(
          `codex_context_over_budget_${sanitizeIssueId(fileName)}`,
          'warning',
          'codex_context',
          relativePath,
          `Context manifest actualBytes=${manifest.actualBytes} exceeds budgetBytes=${manifest.budgetBytes}.`,
          'Reduce included artifacts or increase --codex-context-budget-bytes intentionally.',
          false
        ));
      }
    } catch {
      // checkJson already recorded schema problems.
    }
  }
}

async function checkFinalAssemblyReport(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  try {
    const report = await fileStore.readJson(absolutePath, FinalAssemblyReportSchema);
    if (!(await fileStore.exists(paths.projectArtifact(report.outputFinalPath)))) {
      issues.push(issue(
        `final_assembly_missing_final_${sanitizeIssueId(relativePath)}`,
        'error',
        'final_assembly',
        relativePath,
        `Final assembly report references missing final artifact ${report.outputFinalPath}.`,
        'Restore final.md or rerun the chapter final assembly stage.',
        true
      ));
    }
  } catch {
    // checkJson already recorded schema problems.
  }
}

async function checkCodexBusinessOptimizationPlan(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  fileName: string,
  relativePath: string
): Promise<void> {
  let report: CodexBusinessOptimizationPlan;
  try {
    report = await fileStore.readJson(paths.auditArtifact(fileName), CodexBusinessOptimizationPlanSchema);
  } catch {
    return;
  }
  const sourceProfileAbsolutePath = paths.projectArtifact(report.sourceProfilePath);
  if (!(await fileStore.exists(sourceProfileAbsolutePath))) {
    issues.push(issue(
      `codex_optimization_source_missing_${sanitizeIssueId(fileName)}`,
      'error',
      'codex_optimization',
      relativePath,
      `Business optimization plan references missing source profile ${report.sourceProfilePath}.`,
      'Regenerate codex profile-runtime and codex optimization-plan.',
      true
    ));
    return;
  }
  let sourceProfile: CodexStageRuntimeProfileReport | undefined;
  try {
    sourceProfile = await fileStore.readJson(sourceProfileAbsolutePath, CodexStageRuntimeProfileReportSchema);
  } catch {
    issues.push(issue(
      `codex_optimization_source_invalid_${sanitizeIssueId(fileName)}`,
      'error',
      'codex_optimization',
      report.sourceProfilePath,
      'Business optimization plan source profile is not schema-valid.',
      'Regenerate codex profile-runtime before regenerating optimization-plan.',
      true
    ));
  }
  const candidateIds = new Set(report.optimizationCandidates.map((candidate) => candidate.candidateId));
  for (const candidateId of report.recommendedExecutionOrder) {
    if (!candidateIds.has(candidateId)) {
      issues.push(issue(
        `codex_optimization_bad_order_${sanitizeIssueId(candidateId)}`,
        'error',
        'codex_optimization',
        relativePath,
        `recommendedExecutionOrder references missing candidate ${candidateId}.`,
        'Regenerate the business optimization plan.',
        true
      ));
    }
  }
  const knownStages = new Set<string>();
  if (sourceProfile !== undefined) {
    for (const stage of sourceProfile.slowestBusinessPromptCalls) {
      knownStages.add(stage.stage);
    }
    for (const call of sourceProfile.unclassifiedCalls) {
      knownStages.add(call.inferredStage);
      knownStages.add(call.promptId);
    }
  }
  for (const candidate of report.optimizationCandidates) {
    if (candidate.rollbackPlan.trim() === '' || candidate.safetyImpact.trim() === '') {
      issues.push(issue(
        `codex_optimization_candidate_incomplete_${sanitizeIssueId(candidate.candidateId)}`,
        'error',
        'codex_optimization',
        relativePath,
        `Optimization candidate ${candidate.candidateId} is missing safety or rollback data.`,
        'Regenerate the business optimization plan from a valid runtime profile.',
        true
      ));
    }
    if (sourceProfile !== undefined && !knownStages.has(candidate.stage) && candidate.stage !== 'other_codex') {
      issues.push(issue(
        `codex_optimization_unknown_stage_${sanitizeIssueId(candidate.candidateId)}`,
        'warning',
        'codex_optimization',
        relativePath,
        `Optimization candidate ${candidate.candidateId} references stage ${candidate.stage}, which was not found in the source profile.`,
        'Check stage mapping before acting on this candidate.',
        false
      ));
    }
  }
  const markdownPath = relativePath.replace(/\.json$/, '.md');
  const markdown = (await fileStore.exists(paths.projectArtifact(markdownPath))) ? await fileStore.readText(paths.projectArtifact(markdownPath)) : '';
  const safetyText = `${report.safetyNotes.join('\n')}\n${markdown}`;
  const requiredSafetyItems = [
    'CanonPatchSchema validation',
    'conflict checks',
    'quality critical checks',
    'state diff preview',
    'approval record',
    'before/after snapshots',
    'local applyCanonPatch',
    'audit provenance'
  ];
  for (const requiredItem of requiredSafetyItems) {
    if (!safetyText.includes(requiredItem)) {
      issues.push(issue(
        `codex_optimization_missing_safety_${sanitizeIssueId(requiredItem)}`,
        'error',
        'codex_optimization',
        relativePath,
        `Business optimization plan is missing Do Not Optimize Away item: ${requiredItem}.`,
        'Regenerate the business optimization plan with complete safety notes.',
        true
      ));
    }
  }
  if (sourceProfile !== undefined && sourceProfile.remainingUnclassifiedCount > 0) {
    issues.push(issue(
      `codex_optimization_source_unclassified_${sanitizeIssueId(fileName)}`,
      'warning',
      'codex_optimization',
      relativePath,
      `Source profile still has ${sourceProfile.remainingUnclassifiedCount} unclassified Codex call(s); optimization estimates may include attribution cleanup work.`,
      'Run the recommended orphan cleanup plan before treating all other_codex runtime as business runtime.',
      false
    ));
  }
}

async function checkCodexChapterRegressionAnalysis(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  fileName: string,
  relativePath: string
): Promise<void> {
  let report: CodexChapterRegressionAnalysis;
  try {
    report = await fileStore.readJson(paths.auditArtifact(fileName), CodexChapterRegressionAnalysisSchema);
  } catch {
    return;
  }
  if (!(await fileStore.exists(paths.projectArtifact(report.currentBenchmarkPath)))) {
    issues.push(issue(
      `codex_regression_benchmark_missing_${sanitizeIssueId(fileName)}`,
      'error',
      'codex_regression_analysis',
      relativePath,
      `Regression analysis references missing benchmark ${report.currentBenchmarkPath}.`,
      'Regenerate codex benchmark or rerun codex regression-analysis against an existing benchmark report.',
      true
    ));
  }
  for (const chapter of [...report.baselineChapters, ...report.currentChapters, ...report.regressions]) {
    if (chapter.baselineDurationMs < 0 || chapter.currentDurationMs < 0 || !Number.isFinite(chapter.deltaPercent)) {
      issues.push(issue(
        `codex_regression_bad_chapter_metric_${sanitizeIssueId(fileName)}_${chapter.chapterNumber}`,
        'error',
        'codex_regression_analysis',
        relativePath,
        `Regression analysis has invalid metrics for chapter ${chapter.chapterNumber}.`,
        'Regenerate codex regression-analysis from schema-valid benchmark/profile artifacts.',
        true
      ));
    }
    for (const stage of Object.values(chapter.durationByStage)) {
      if (stage.durationMs < 0 || !Number.isFinite(stage.comparedToBaselineDeltaPercent)) {
        issues.push(issue(
          `codex_regression_bad_stage_metric_${sanitizeIssueId(fileName)}_${chapter.chapterNumber}_${sanitizeIssueId(stage.stage)}`,
          'error',
          'codex_regression_analysis',
          relativePath,
          `Regression stage ${stage.stage} has invalid duration or percent values.`,
          'Regenerate codex regression-analysis from complete artifacts.',
          true
        ));
      }
    }
  }
  for (const cause of report.suspectedRootCauses) {
    if (cause.evidence.length === 0) {
      issues.push(issue(
        `codex_regression_root_cause_missing_evidence_${sanitizeIssueId(cause.rootCauseId)}`,
        'error',
        'codex_regression_analysis',
        relativePath,
        `Root cause ${cause.rootCauseId} has no evidence.`,
        'Regenerate regression analysis with evidence attached to every suspected root cause.',
        true
      ));
    }
  }
  for (const fix of report.recommendedFixes) {
    if (fix.rollbackPlan.trim() === '') {
      issues.push(issue(
        `codex_regression_fix_missing_rollback_${sanitizeIssueId(fix.experimentId)}`,
        'error',
        'codex_regression_analysis',
        relativePath,
        `Recommended fix ${fix.experimentId} is missing rollbackPlan.`,
        'Regenerate regression analysis with rollback plans for every experiment.',
        true
      ));
    }
  }
}

async function checkCodexRuntimeGapReport(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  fileName: string,
  relativePath: string
): Promise<void> {
  let report: CodexRuntimeGapReport;
  try {
    report = await fileStore.readJson(paths.auditArtifact(fileName), CodexRuntimeGapReportSchema);
  } catch {
    return;
  }
  for (const sourcePath of [report.sourceBenchmarkPath, report.sourceProfilePath]) {
    if (!sourcePath.endsWith('_missing.json') && !(await fileStore.exists(paths.projectArtifact(sourcePath)))) {
      issues.push(issue(
        `codex_runtime_gap_source_missing_${sanitizeIssueId(fileName)}_${sanitizeIssueId(sourcePath)}`,
        'error',
        'codex_runtime_gap',
        relativePath,
        `Runtime gap report references missing source file ${sourcePath}.`,
        'Regenerate runtime-gap after restoring benchmark/profile artifacts.',
        true
      ));
    }
  }
  const impossible =
    report.totalUnattributedGapMs > report.totalWallClockMs ||
    report.gapByRun.some((run) => run.unattributedGapMs > run.wallClockMs || run.gapPercent < 0) ||
    report.gapByChapter.some((chapter) => chapter.unattributedGapMs > chapter.wallClockMs || chapter.gapPercent < 0) ||
    report.gapByStage.some((stage) => stage.unattributedGapMs > stage.wallClockMs || stage.gapPercent < 0);
  if (impossible) {
    issues.push(issue(
      `codex_runtime_gap_impossible_metric_${sanitizeIssueId(fileName)}`,
      'error',
      'codex_runtime_gap',
      relativePath,
      'Runtime gap report contains an impossible negative or over-wall-clock gap metric.',
      'Regenerate runtime-gap from complete run manifest and benchmark artifacts.',
      true
    ));
  }
}

async function checkCodexRuntimeSamplingReport(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  fileName: string,
  relativePath: string
): Promise<void> {
  let report: CodexRuntimeSamplingReport;
  try {
    report = await fileStore.readJson(paths.auditArtifact(fileName), CodexRuntimeSamplingReportSchema);
  } catch {
    return;
  }
  if (report.sampleCount !== report.samples.length || report.successCount + report.failureCount !== report.sampleCount) {
    issues.push(issue(
      `codex_sampling_count_mismatch_${sanitizeIssueId(fileName)}`,
      'error',
      'codex_runtime_sampling',
      relativePath,
      'Runtime sampling report counts do not match sample records.',
      'Regenerate codex sample-stage for this project.',
      true
    ));
  }
  for (const sample of report.samples) {
    if (sample.stateMutated !== false) {
      issues.push(issue(
        `codex_sampling_state_mutated_${sanitizeIssueId(fileName)}_${sanitizeIssueId(sample.sampleId)}`,
        'critical',
        'codex_runtime_sampling',
        relativePath,
        `Runtime sample ${sample.sampleId} reports Story State mutation.`,
        'Restore Story State and rerun sample-stage with read-only boundaries.',
        true
      ));
    }
    if (!(await fileStore.exists(paths.runManifest(sample.runId)))) {
      issues.push(issue(
        `codex_sampling_run_missing_${sanitizeIssueId(fileName)}_${sanitizeIssueId(sample.runId)}`,
        'error',
        'codex_runtime_sampling',
        relativePath,
        `Runtime sample ${sample.sampleId} references missing run ${sample.runId}.`,
        'Restore the run manifest or regenerate the sampling report.',
        true
      ));
    }
    for (const artifactPath of sample.artifactPaths) {
      if (isCanonicalSamplingForbiddenPath(artifactPath)) {
        issues.push(issue(
          `codex_sampling_canonical_path_${sanitizeIssueId(fileName)}_${sanitizeIssueId(sample.sampleId)}_${sanitizeIssueId(artifactPath)}`,
          'error',
          'codex_runtime_sampling',
          artifactPath,
          `Runtime sample ${sample.sampleId} references canonical artifact ${artifactPath}.`,
          'Sampling artifacts must stay under audit/codex/samples or codex/runs.',
          true
        ));
      }
      if (!(await fileStore.exists(paths.projectArtifact(artifactPath)))) {
        issues.push(issue(
          `codex_sampling_artifact_missing_${sanitizeIssueId(fileName)}_${sanitizeIssueId(sample.sampleId)}_${sanitizeIssueId(artifactPath)}`,
          'error',
          'codex_runtime_sampling',
          artifactPath,
          `Runtime sample ${sample.sampleId} references missing artifact ${artifactPath}.`,
          'Restore the sample artifact or regenerate codex sample-stage.',
          true
        ));
      }
    }
    if (sample.failureReportPath !== undefined && !(await fileStore.exists(paths.projectArtifact(sample.failureReportPath)))) {
      issues.push(issue(
        `codex_sampling_failure_report_missing_${sanitizeIssueId(fileName)}_${sanitizeIssueId(sample.sampleId)}`,
        'error',
        'codex_runtime_sampling',
        sample.failureReportPath,
        `Runtime sample ${sample.sampleId} references a missing failure report.`,
        'Restore the failure report or regenerate codex sample-stage.',
        true
      ));
    }
  }
}

function isCanonicalSamplingForbiddenPath(artifactPath: string): boolean {
  const normalized = artifactPath.split(path.sep).join(path.posix.sep);
  if (normalized === 'state/story_state.json') return true;
  if (!normalized.startsWith('chapters/chapter_')) return false;
  return /\/(mission\.json|ranking\.json|selected_plan\.md|scene_cards\.json|draft_v\d+\.md|diagnostics_v\d+\.json|revision_plan_v\d+\.json|final\.md|canon_patch\.json|commit_report\.json)$/.test(normalized);
}

async function checkCodexStageRuntimeProfile(
  issues: AuditIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  fileName: string,
  relativePath: string
): Promise<void> {
  let report: CodexStageRuntimeProfileReport;
  let hasRuntimeViews = false;
  try {
    const rawReport = JSON.parse(await fileStore.readText(paths.auditArtifact(fileName))) as unknown;
    hasRuntimeViews = isUnknownRecord(rawReport) && 'rawRuntimeView' in rawReport;
    report = CodexStageRuntimeProfileReportSchema.parse(rawReport);
  } catch {
    return;
  }
  const actionableUnclassifiedCalls = report.unclassifiedCalls.filter((call) => !isDiagnosticProfileCall(call));
  if (actionableUnclassifiedCalls.length > 0) {
    issues.push(issue(
      `codex_profile_unclassified_${fileName}`,
      'warning',
      'codex_profiling',
      relativePath,
      `${actionableUnclassifiedCalls.length} Codex prompt call(s) remain attributed to other_codex.`,
      'Add promptId rules to src/providers/codex/promptStageMapping.ts for recurring unknown calls.',
      false
    ));
  }
  const actionableOrphanWrappers = report.wrapperBreakdown.orphanWrapperCalls.filter((wrapper) => !isDiagnosticWrapperCall(wrapper));
  if (actionableOrphanWrappers.length > 0) {
    issues.push(issue(
      `codex_profile_orphan_wrappers_${fileName}`,
      'warning',
      'codex_profiling',
      relativePath,
      `${actionableOrphanWrappers.length} Codex wrapper call(s) could not be linked to a parent business prompt.`,
      'Inspect wrapperBreakdown.orphanWrapperCalls and add parentPromptCallId or improve legacy inference.',
      false
    ));
  }
  for (const wrapper of report.wrapperBreakdown.orphanWrapperCalls) {
    if (wrapper.parentPromptCallId !== undefined) {
      issues.push(issue(
        `codex_profile_missing_parent_${fileName}_${sanitizeIssueId(wrapper.promptCallId)}`,
        'error',
        'codex_profiling',
        relativePath,
        `Wrapper call ${wrapper.promptCallId} declares parentPromptCallId=${wrapper.parentPromptCallId}, but the parent call was not found.`,
        'Restore the parent run manifest prompt call or regenerate provenance with a valid parentPromptCallId.',
        true
      ));
    }
  }
  const promptIdTotal = sumRecord(report.promptCallsByPromptId);
  const stageTotal = sumRecord(report.promptCallsByStage);
  const runTotal = sumRecord(report.promptCallsByRun);
  if (promptIdTotal !== report.profiledPromptCallCount || stageTotal !== report.profiledPromptCallCount || runTotal !== report.profiledPromptCallCount) {
    issues.push(issue(
      `codex_profile_count_mismatch_${fileName}`,
      'error',
      'codex_profiling',
      relativePath,
      'Codex profile prompt call attribution totals do not match profiledPromptCallCount.',
      'Regenerate the runtime profile from run manifest v2 data.',
      true
    ));
  }
  if (report.unclassifiedCalls.length !== report.remainingUnclassifiedCount) {
    issues.push(issue(
      `codex_profile_unclassified_count_mismatch_${fileName}`,
      'error',
      'codex_profiling',
      relativePath,
      'remainingUnclassifiedCount does not match unclassifiedCalls.length.',
      'Regenerate the runtime profile.',
      true
    ));
  }
  if (hasRuntimeViews && report.rawRuntimeView.totalPromptCallCount !== report.profiledPromptCallCount) {
    issues.push(issue(
      `codex_profile_raw_count_mismatch_${fileName}`,
      'error',
      'codex_profiling',
      relativePath,
      'rawRuntimeView.totalPromptCallCount does not match profiledPromptCallCount.',
      'Regenerate the runtime profile.',
      true
    ));
  }
  if (hasRuntimeViews && (sumRecord(report.businessRuntimeView.byBusinessStage) !== report.businessRuntimeView.totalDurationMs || sumRecord(report.businessRuntimeView.byPromptId) !== report.businessRuntimeView.totalDurationMs)) {
    issues.push(issue(
      `codex_profile_business_total_mismatch_${fileName}`,
      'error',
      'codex_profiling',
      relativePath,
      'businessRuntimeView totals are inconsistent with byBusinessStage or byPromptId.',
      'Regenerate the runtime profile from run manifest v2 data.',
      true
    ));
  }
  if (hasRuntimeViews && (report.wrapperBreakdown.totalWrapperCalls !== report.overheadRuntimeView.wrapperCallCount || report.wrapperBreakdown.totalWrapperDurationMs !== report.overheadRuntimeView.wrapperDurationMs)) {
    issues.push(issue(
      `codex_profile_wrapper_overhead_mismatch_${fileName}`,
      'error',
      'codex_profiling',
      relativePath,
      'wrapperBreakdown totals do not match overheadRuntimeView wrapper totals.',
      'Regenerate the runtime profile.',
      true
    ));
  }
  const otherStageCalls = report.promptCallsByStage.other_codex ?? 0;
  if (report.otherCodexBreakdown.totalCalls < Math.max(otherStageCalls, report.remainingUnclassifiedCount)) {
    issues.push(issue(
      `codex_profile_other_breakdown_mismatch_${fileName}`,
      'error',
      'codex_profiling',
      relativePath,
      'other_codex breakdown totalCalls does not cover promptCallsByStage.other_codex and remainingUnclassifiedCount.',
      'Regenerate the runtime profile.',
      true
    ));
  }
  for (const call of uniqueProfileCalls(report)) {
    for (const artifactPath of call.artifactPaths) {
      if (!(await fileStore.exists(paths.projectArtifact(artifactPath)))) {
        issues.push(issue(
          `codex_profile_missing_artifact_${sanitizeIssueId(fileName)}_${sanitizeIssueId(call.promptCallId)}_${sanitizeIssueId(artifactPath)}`,
          'error',
          'codex_profiling',
          artifactPath,
          `Profiled prompt call ${call.promptCallId} references a missing artifact.`,
          'Restore the Codex raw/final/parsed artifact or regenerate the profile after cleaning stale references.',
          true
        ));
      }
    }
  }
}

async function checkArchives(issues: AuditIssue[], paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (!(await fileStore.exists(paths.chaptersDir()))) return;
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    const archiveRoot = path.join(paths.chaptersDir(), chapterDirName, 'archive');
    if (!(await fileStore.exists(archiveRoot))) continue;
    for (const archiveDir of await fileStore.list(archiveRoot)) {
      const manifestPath = path.join(archiveRoot, archiveDir, 'manifest.json');
      const relativeManifestPath = path.join('chapters', chapterDirName, 'archive', archiveDir, 'manifest.json');
      if (!(await fileStore.exists(manifestPath))) {
        issues.push(issue(`archive_manifest_missing_${chapterDirName}_${archiveDir}`, 'error', 'archive', relativeManifestPath, 'Archive manifest is missing.', 'Restore archive manifest.', true));
        continue;
      }
      let manifest: ReturnType<typeof ArchiveManifestSchema.parse>;
      try {
        manifest = await fileStore.readJson(manifestPath, ArchiveManifestSchema);
      } catch (error) {
        issues.push(issue(`archive_manifest_invalid_${chapterDirName}_${archiveDir}`, 'error', 'archive', relativeManifestPath, `Archive manifest is invalid: ${String(error)}`, 'Repair or regenerate archive manifest.', true));
        continue;
      }
      for (const artifact of manifest.copiedArtifacts) {
        const archivedAbsolutePath = paths.projectArtifact(artifact.archivedPath);
        if (!(await fileStore.exists(archivedAbsolutePath))) {
          issues.push(issue(`archived_missing_${artifact.archivedPath.replace(/[^a-zA-Z0-9]+/g, '_')}`, 'error', 'archive', artifact.archivedPath, 'Archived file is missing.', 'Restore archived file from source artifact.', true));
          continue;
        }
        const metadata = await readFileMetadata(archivedAbsolutePath, fileStore);
        if (metadata.sha256 !== artifact.sha256) {
          issues.push(issue(`archive_hash_${artifact.archivedPath.replace(/[^a-zA-Z0-9]+/g, '_')}`, 'error', 'archive', artifact.archivedPath, 'Archived file hash does not match manifest.', 'Replace archived file with the original recorded bytes or update the archive by rerunning regeneration.', true));
        }
      }
    }
  }
}

async function collectAuditPerformance(paths: ProjectPaths, fileStore: FileStore, started: number): Promise<ProjectAuditReport['performance']> {
  const index = (await fileStore.exists(paths.artifactIndex()))
    ? await fileStore.readJson(paths.artifactIndex(), ArtifactIndexSchema)
    : undefined;
  const runManifestCount = (await fileStore.exists(paths.runsDir()))
    ? (await Promise.all((await fileStore.list(paths.runsDir())).map((runId) => fileStore.exists(paths.runManifest(runId)))))
        .filter(Boolean).length
    : 0;
  const snapshotCount = (await fileStore.exists(paths.snapshotsDir()))
    ? (await fileStore.list(paths.snapshotsDir())).filter((fileName) => fileName.endsWith('.json')).length
    : 0;
  const archiveCount = index?.artifacts.filter((artifact) => artifact.artifactType === 'archive_manifest').length ?? 0;
  return {
    durationMs: Date.now() - started,
    fileCount: index?.performance.fileCount ?? index?.artifacts.length ?? 0,
    artifactCount: index?.artifacts.length ?? 0,
    runManifestCount,
    eventLogCount: index?.performance.eventLogCount ?? 0,
    archiveCount,
    snapshotCount,
    hashedBytes: index?.performance.hashedBytes ?? 0
  };
}

async function nextAuditArtifact(paths: ProjectPaths, fileStore: FileStore, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const jsonPath = paths.auditArtifact(jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      const mdFile = `${baseName}_v${version}.md`;
      return {
        version,
        jsonPath,
        mdPath: paths.auditArtifact(mdFile),
        relativeJsonPath: path.join('audit', jsonFile),
        relativeMdPath: path.join('audit', mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName}.`);
}

function summarize(issues: AuditIssue[]): ProjectAuditReport['summary'] {
  return {
    totalIssues: issues.length,
    bySeverity: {
      info: issues.filter((candidate) => candidate.severity === 'info').length,
      warning: issues.filter((candidate) => candidate.severity === 'warning').length,
      error: issues.filter((candidate) => candidate.severity === 'error').length,
      critical: issues.filter((candidate) => candidate.severity === 'critical').length
    }
  };
}

function issue(issueId: string, severity: AuditIssue['severity'], category: string, issuePath: string, message: string, suggestedFix: string, blocking: boolean): AuditIssue {
  return { issueId, severity, category, path: issuePath, message, suggestedFix, blocking };
}

function sumRecord(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + value, 0);
}

function roundedRate(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(4));
}

function isDiagnosticProfileCall(call: CodexStageRuntimeProfileReport['unclassifiedCalls'][number]): boolean {
  const promptId = call.promptId.toLowerCase().replace(/-/g, '_');
  return (
    call.likelyCategory === 'smoke' ||
    call.likelyCategory === 'exec_json_smoke' ||
    call.likelyCategory === 'health_check' ||
    call.inferredStage === 'smoke' ||
    call.inferredStage === 'exec_json_smoke' ||
    call.inferredStage === 'health_check' ||
    promptId.includes('smoke') ||
    promptId.includes('exec_json') ||
    promptId.includes('health')
  );
}

function isDiagnosticWrapperCall(call: CodexStageRuntimeProfileReport['wrapperBreakdown']['orphanWrapperCalls'][number]): boolean {
  const promptCallId = call.promptCallId.toLowerCase().replace(/-/g, '_');
  return call.wrapperCallType === 'smoke' || call.wrapperCallType === 'health' || (call.wrapperCallType === 'exec_json' && (promptCallId.includes('exec_json') || promptCallId.includes('smoke')));
}

function uniqueProfileCalls(report: CodexStageRuntimeProfileReport): Array<CodexStageRuntimeProfileReport['slowestPromptCalls'][number]> {
  const calls = new Map<string, CodexStageRuntimeProfileReport['slowestPromptCalls'][number]>();
  for (const group of [
    report.slowestPromptCalls,
    report.largestPromptInputs,
    report.largestSchemas,
    report.largestOutputs,
    report.repairCalls,
    report.retryCalls,
    report.unclassifiedCalls
  ]) {
    for (const call of group) {
      calls.set(`${call.runId}:${call.promptCallId}`, call);
    }
  }
  return [...calls.values()];
}

async function allProtectedArtifactsCurrent(
  paths: ProjectPaths,
  fileStore: FileStore,
  artifacts: Array<{ path: string; beforeSha256: string; afterSha256: string; unchanged: true }>
): Promise<boolean> {
  for (const artifact of artifacts) {
    const artifactPath = paths.projectArtifact(artifact.path);
    if (!(await fileStore.exists(artifactPath)) || artifact.beforeSha256 !== artifact.afterSha256 ||
      sha256(await fileStore.readText(artifactPath)) !== artifact.afterSha256) return false;
  }
  return true;
}

function auditRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function sanitizeIssueId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'unknown';
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, ...segments);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderAuditMarkdown(report: ProjectAuditReport): string {
  const lines = [`# Project Audit ${report.reportId}`, '', `OK: ${String(report.ok)}`, `Issues: ${report.summary.totalIssues}`, ''];
  for (const issueItem of report.issues) {
    lines.push(`- [${issueItem.severity}] ${issueItem.category} ${issueItem.path}: ${issueItem.message}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderAuditOutput(result: Omit<ProjectAuditResult, 'output'>): string {
  return [
    `issueCount: ${result.report.summary.totalIssues}`,
    `info: ${result.report.summary.bySeverity.info}`,
    `warning: ${result.report.summary.bySeverity.warning}`,
    `error: ${result.report.summary.bySeverity.error}`,
    `critical: ${result.report.summary.bySeverity.critical}`,
    `reportPath: ${result.reportPath}`,
    `markdownPath: ${result.markdownPath}`,
    `strictResult: ${result.exitCode === 0 ? 'pass' : 'fail'}`,
    `suggestedFixes: ${result.report.issues.map((issueItem) => issueItem.suggestedFix).join(' | ') || 'none'}`
  ].join('\n') + '\n';
}
