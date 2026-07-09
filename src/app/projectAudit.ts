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
  CodexCrossChapterContinuityReportSchema,
  CodexCrossChapterDriftReportSchema,
  CodexMultiChapterPilotReportSchema,
  CodexPatchFailureReportSchema,
  CodexRuntimeBenchmarkReportSchema,
  CodexRuntimeFailureReportSchema,
  CodexRuntimeGapReportSchema,
  CodexRuntimeOptimizationReportSchema,
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
  StoryStateSchema
} from '../schemas/index.js';
import type { CodexBusinessOptimizationPlan, CodexChapterRegressionAnalysis, CodexRuntimeGapReport, CodexStageRuntimeProfileReport, RunEvent, RunManifest } from '../schemas/index.js';
import type { AuditIssue, ProjectAuditReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { refreshArtifactIndex } from './artifactIndex.js';
import { isCompletedCommitJournal } from './commitJournal.js';
import { readFileMetadata } from './fileHash.js';
import { validateChapterQueueConsistency } from './chapterQueue.js';
import { verifySnapshots } from './snapshotBrowser.js';

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

function sanitizeIssueId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'unknown';
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
