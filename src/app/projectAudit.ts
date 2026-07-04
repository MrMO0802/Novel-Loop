import path from 'node:path';

import {
  ArchiveManifestSchema,
  ArtifactIndexSchema,
  CanonPatchSchema,
  ChapterQueueSchema,
  CodexChapterQualityReportSchema,
  CodexCommitConsistencyReportSchema,
  CodexPatchFailureReportSchema,
  CodexSingleChapterSmokeReportSchema,
  CommitReportSchema,
  ConfigSchema,
  ProjectAuditReportSchema,
  RunEventSchema,
  RunManifestSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type { RunManifest } from '../schemas/index.js';
import type { AuditIssue, ProjectAuditReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { refreshArtifactIndex } from './artifactIndex.js';
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
  for (const [index, line] of events.entries()) {
    try {
      RunEventSchema.parse(JSON.parse(line));
    } catch (error) {
      issues.push(issue(`events_invalid_${runId}_${index + 1}`, 'error', 'event_log', relativeEventPath, `Event ${index + 1} failed schema validation: ${String(error)}`, 'Repair or regenerate events.ndjson.', true));
    }
  }
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
  if (await fileStore.exists(paths.auditDir())) {
    for (const fileName of await fileStore.list(paths.auditDir())) {
      if (/^codex_single_chapter_smoke_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, paths.auditArtifact(fileName), 'codex_smoke', path.join('audit', fileName), CodexSingleChapterSmokeReportSchema);
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
      if (/^codex_patch_failure_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_failure', relativePath, CodexPatchFailureReportSchema);
      }
      if (/^codex_commit_consistency_report_v\d+\.json$/.test(fileName)) {
        await checkJson(issues, fileStore, absolutePath, 'codex_commit', relativePath, CodexCommitConsistencyReportSchema);
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
