import path from 'node:path';

import { ChapterQueueSchema, ArtifactIndexSchema, RunManifestSchema } from '../schemas/index.js';
import type { ArtifactIndex, ArtifactIndexItem, ArtifactLineageRecord, ArtifactStatus, ArtifactType, ChapterQueue, RunManifest } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { readFileMetadata } from './fileHash.js';

export interface ArtifactIndexInput {
  projectId: string;
  projectsRoot?: string;
}

export interface ListArtifactsInput extends ArtifactIndexInput {
  chapterNumber?: number;
  type?: ArtifactType;
  status?: ArtifactStatus;
  json?: boolean;
}

export interface ArtifactIndexResult {
  index: ArtifactIndex;
  indexPath: string;
}

export interface ListArtifactsResult {
  projectId: string;
  artifacts: ArtifactIndexItem[];
  artifactCount: number;
  staleCount: number;
  missingCount: number;
  invalidCount: number;
  indexPath: string;
  output: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function refreshArtifactIndex(input: ArtifactIndexInput, fileStore = new FileStore()): Promise<ArtifactIndexResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const index = await scanArtifactIndex(paths, fileStore);
  await fileStore.ensureDir(paths.artifactsDir());
  const written = await fileStore.writeJson(paths.artifactIndex(), index, ArtifactIndexSchema);
  return {
    index: written,
    indexPath: 'artifacts/artifact_index.json'
  };
}

export async function listArtifacts(input: ListArtifactsInput, fileStore = new FileStore()): Promise<ListArtifactsResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const index = await scanArtifactIndex(paths, fileStore);
  const artifacts = index.artifacts.filter((artifact) => {
    if (input.chapterNumber !== undefined && artifact.chapterNumber !== input.chapterNumber) return false;
    if (input.type !== undefined && artifact.artifactType !== input.type) return false;
    if (input.status !== undefined && artifact.status !== input.status) return false;
    return true;
  });
  const result = {
    projectId: paths.projectId,
    artifacts,
    artifactCount: artifacts.length,
    staleCount: artifacts.filter((artifact) => artifact.status === 'stale').length,
    missingCount: artifacts.filter((artifact) => artifact.status === 'missing').length,
    invalidCount: artifacts.filter((artifact) => artifact.status === 'invalid').length,
    indexPath: 'artifacts/artifact_index.json'
  };
  return {
    ...result,
    output: input.json === true ? `${JSON.stringify(result, null, 2)}\n` : renderArtifactList(result)
  };
}

async function scanArtifactIndex(paths: ProjectPaths, fileStore: FileStore): Promise<ArtifactIndex> {
  const started = Date.now();
  const queue = await readQueue(paths, fileStore);
  const files = (await listProjectFiles(paths, fileStore)).filter((file) => file !== 'artifacts/artifact_index.json');
  const lineageResult = await readManifestLineage(paths, fileStore);
  const lineage = lineageResult.artifacts;
  const lineageByPath = new Map(lineage.map((artifact) => [artifact.path, artifact]));
  const artifacts: ArtifactIndexItem[] = [];
  let hashedBytes = 0;
  for (const relativePath of files) {
    const absolutePath = paths.projectArtifact(relativePath);
    const metadata = await readFileMetadata(absolutePath, fileStore);
    hashedBytes += metadata.sizeBytes;
    const chapterNumber = chapterNumberFromPath(relativePath);
    const classification = classifyArtifact(relativePath);
    const lineageRecord = lineageByPath.get(relativePath);
    artifacts.push(
      ArtifactIndexSchema.shape.artifacts.element.parse({
        artifactId: artifactId(relativePath),
        ...(chapterNumber === undefined ? {} : { chapterNumber }),
        artifactType: classification.artifactType,
        phase: classification.phase,
        path: relativePath,
        ...(lineageRecord?.runId === undefined ? {} : { runId: lineageRecord.runId }),
        modifiedAt: metadata.modifiedAt,
        createdAt: metadata.createdAt,
        sha256: lineageRecord?.sha256 ?? metadata.sha256,
        sizeBytes: metadata.sizeBytes,
        ...(classification.schemaName === undefined ? {} : { schemaName: classification.schemaName }),
        status: statusFor(relativePath, chapterNumber, queue),
        provenance: lineageRecord === undefined ? provenanceFor(relativePath) : `${lineageRecord.provenanceNote ?? 'manifest v2 lineage'} (${lineageRecord.runId})`
      })
    );
  }
  const fileSet = new Set(files);
  for (const missing of lineage.filter((artifact) => !fileSet.has(artifact.path) && artifact.action !== 'archived')) {
    artifacts.push(
      ArtifactIndexSchema.shape.artifacts.element.parse({
        artifactId: artifactId(missing.path),
        ...(missing.chapterNumber === undefined ? {} : { chapterNumber: missing.chapterNumber }),
        artifactType: missing.artifactType,
        phase: missing.phase,
        path: missing.path,
        runId: missing.runId,
        modifiedAt: new Date().toISOString(),
        ...(missing.sha256 === undefined ? { sha256: '0'.repeat(64) } : { sha256: missing.sha256 }),
        sizeBytes: missing.sizeBytes ?? 0,
        ...(missing.schemaName === undefined ? {} : { schemaName: missing.schemaName }),
        status: 'missing',
        provenance: `${missing.provenanceNote ?? 'missing manifest v2 lineage'} (${missing.runId})`
      })
    );
  }
  return ArtifactIndexSchema.parse({
    projectId: paths.projectId,
    generatedAt: new Date().toISOString(),
    artifacts: artifacts.sort((left, right) => left.path.localeCompare(right.path)),
    performance: {
      durationMs: Date.now() - started,
      fileCount: files.length,
      artifactCount: artifacts.length,
      runManifestCount: lineageResult.runManifestCount,
      eventLogCount: files.filter((file) => file.endsWith('/events.ndjson')).length,
      archiveCount: files.filter((file) => file.includes('/archive/') && file.endsWith('/manifest.json')).length,
      snapshotCount: files.filter((file) => file.startsWith('snapshots/') && file.endsWith('.json')).length,
      hashedBytes
    }
  });
}

async function readManifestLineage(paths: ProjectPaths, fileStore: FileStore): Promise<{ artifacts: ArtifactLineageRecord[]; runManifestCount: number }> {
  if (!(await fileStore.exists(paths.runsDir()))) return { artifacts: [], runManifestCount: 0 };
  const lineage: ArtifactLineageRecord[] = [];
  let runManifestCount = 0;
  for (const runId of await fileStore.list(paths.runsDir())) {
    const manifestPath = paths.runManifest(runId);
    if (!(await fileStore.exists(manifestPath))) continue;
    const manifest = await fileStore.readJson(manifestPath, RunManifestSchema);
    runManifestCount += 1;
    if (isV2Manifest(manifest)) {
      lineage.push(...manifest.artifacts);
    }
  }
  return { artifacts: lineage, runManifestCount };
}

function isV2Manifest(manifest: RunManifest): manifest is Extract<RunManifest, { schemaVersion: '2' }> {
  return 'schemaVersion' in manifest && manifest.schemaVersion === '2';
}

async function readQueue(paths: ProjectPaths, fileStore: FileStore): Promise<ChapterQueue | undefined> {
  if (!(await fileStore.exists(paths.chapterQueue()))) {
    return undefined;
  }
  return fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema);
}

async function listProjectFiles(paths: ProjectPaths, fileStore: FileStore): Promise<string[]> {
  if (!(await fileStore.exists(paths.projectRoot))) {
    return [];
  }
  return listFiles(paths, fileStore, paths.projectRoot);
}

async function listFiles(paths: ProjectPaths, fileStore: FileStore, dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fileStore.list(dir)) {
    const absolutePath = path.join(dir, entry);
    if (await isDirectory(fileStore, absolutePath)) {
      files.push(...(await listFiles(paths, fileStore, absolutePath)));
    } else {
      files.push(path.relative(paths.projectRoot, absolutePath).split(path.sep).join(path.posix.sep));
    }
  }
  return files;
}

async function isDirectory(fileStore: FileStore, targetPath: string): Promise<boolean> {
  try {
    await fileStore.list(targetPath);
    return true;
  } catch {
    return false;
  }
}

function classifyArtifact(relativePath: string): { artifactType: ArtifactType; phase: string; schemaName?: string } {
  const fileName = path.posix.basename(relativePath);
  if (relativePath === 'brief.md') return { artifactType: 'brief', phase: 'init' };
  if (relativePath === 'config.json') return { artifactType: 'config', phase: 'init', schemaName: 'ConfigSchema' };
  if (relativePath === 'state/story_state.json') return { artifactType: 'story_state', phase: 'state', schemaName: 'StoryStateSchema' };
  if (relativePath.startsWith('codex/runs/') && fileName === 'prompt.md') return { artifactType: 'prompt_artifact', phase: 'codex' };
  if (relativePath.startsWith('codex/runs/') && fileName === 'raw_output.jsonl') return { artifactType: 'codex_raw_output', phase: 'codex' };
  if (relativePath.startsWith('codex/runs/') && fileName === 'parsed_output.json') return { artifactType: 'codex_parsed_json', phase: 'codex' };
  if (relativePath.startsWith('codex/runs/') && fileName.startsWith('final_output.')) return { artifactType: 'codex_final_output', phase: 'codex' };
  if (relativePath === 'strategy/story_bible.md') return { artifactType: 'story_bible', phase: 'strategy' };
  if (relativePath === 'strategy/genre_contract.md') return { artifactType: 'genre_contract', phase: 'strategy' };
  if (relativePath === 'strategy/reader_promise.md') return { artifactType: 'reader_promise', phase: 'strategy' };
  if (relativePath === 'strategy/style_guide.md') return { artifactType: 'style_guide', phase: 'strategy' };
  if (relativePath === 'planning/global_outline.md') return { artifactType: 'global_outline', phase: 'planning' };
  if (relativePath === 'planning/volume_01_outline.md') return { artifactType: 'volume_outline', phase: 'planning' };
  if (relativePath === 'planning/arc_map.json') return { artifactType: 'arc_map', phase: 'planning', schemaName: 'ArcMapSchema' };
  if (relativePath === 'planning/chapter_queue.json') return { artifactType: 'chapter_queue', phase: 'planning', schemaName: 'ChapterQueueSchema' };
  if (/^audit\/retention_report_v\d+\.(json|md)$/.test(relativePath)) {
    return fileName.endsWith('.json')
      ? { artifactType: 'retention_report', phase: 'retention', schemaName: 'RetentionReportSchema' }
      : { artifactType: 'retention_report', phase: 'retention' };
  }
  if (/^audit\/provenance_compaction_v\d+\.(json|md)$/.test(relativePath)) {
    return fileName.endsWith('.json')
      ? { artifactType: 'compaction_report', phase: 'compaction', schemaName: 'ProvenanceCompactionReportSchema' }
      : { artifactType: 'compaction_report', phase: 'compaction' };
  }
  if (/^planning\/regeneration_plan_v\d+\.(json|md)$/.test(relativePath)) {
    return fileName.endsWith('.json')
      ? { artifactType: 'regeneration_plan', phase: 'planning', schemaName: 'RegenerationPlanSchema' }
      : { artifactType: 'regeneration_plan', phase: 'planning' };
  }
  if (relativePath.startsWith('runs/') && fileName === 'run_manifest.json') return { artifactType: 'run_manifest', phase: 'run', schemaName: 'RunManifestSchema' };
  if (relativePath.startsWith('runs/') && fileName.endsWith('.ndjson')) return { artifactType: 'event_log', phase: 'run', schemaName: 'RunEventSchema' };
  if (relativePath.startsWith('runs/') && relativePath.includes('/prompts/')) return { artifactType: 'prompt_artifact', phase: 'prompt' };
  if (/^codex\/context\/context_manifest_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_context_manifest', phase: 'context', schemaName: 'CodexContextManifestSchema' };
  if (relativePath.startsWith('snapshots/') && fileName.endsWith('.json')) return { artifactType: 'snapshot', phase: 'snapshot', schemaName: 'SnapshotSchema' };
  if (relativePath.startsWith('diffs/')) {
    return fileName.endsWith('.json')
      ? { artifactType: 'state_diff', phase: 'diff', schemaName: 'StateDiffReportSchema' }
      : { artifactType: 'state_diff', phase: 'diff' };
  }
  if (relativePath.endsWith('/manifest.json') && relativePath.includes('/archive/')) return { artifactType: 'archive_manifest', phase: 'archive', schemaName: 'ArchiveManifestSchema' };
  if (fileName === 'mission.json') return { artifactType: 'mission', phase: 'chapter_planning', schemaName: 'ChapterMissionSchema' };
  if (relativePath.includes('/plan_candidates/')) return { artifactType: 'plan_candidate', phase: 'chapter_planning' };
  if (fileName === 'ranking.json') return { artifactType: 'ranking', phase: 'chapter_planning', schemaName: 'ChapterPlanRankingSchema' };
  if (fileName === 'selected_plan.md') return { artifactType: 'selected_plan', phase: 'chapter_planning' };
  if (fileName === 'scene_cards.json') return { artifactType: 'scene_card', phase: 'drafting', schemaName: 'SceneCardsSchema' };
  if (relativePath.includes('/scenes/')) return { artifactType: 'scene_draft', phase: 'drafting' };
  if (/^draft_v\d+\.md$/.test(fileName)) return { artifactType: 'draft', phase: 'drafting' };
  if (/^diagnostics_v\d+\.json$/.test(fileName)) return { artifactType: 'diagnostics', phase: 'diagnostics', schemaName: 'DiagnosticsReportSchema' };
  if (/^revision_plan_v\d+\.json$/.test(fileName)) return { artifactType: 'revision_plan', phase: 'revision', schemaName: 'RevisionPlanSchema' };
  if (fileName === 'final.md' || /^final_candidate_preview_v\d+\.md$/.test(fileName)) return { artifactType: 'final', phase: 'final' };
  if (/^state_diff_codex_preview_v\d+\.json$/.test(fileName)) return { artifactType: 'state_diff', phase: 'diff', schemaName: 'StateDiffReportSchema' };
  if (/^state_diff_codex_preview_v\d+\.md$/.test(fileName)) return { artifactType: 'state_diff', phase: 'diff' };
  if (fileName === 'canon_patch.json' || /^canon_patch_manual_v\d+\.json$/.test(fileName) || /^canon_patch_codex_(proposal|normalized)_v\d+\.json$/.test(fileName)) return { artifactType: 'canon_patch', phase: 'commit', schemaName: 'CanonPatchSchema' };
  if (fileName === 'commit_report.json') return { artifactType: 'commit_report', phase: 'commit', schemaName: 'CommitReportSchema' };
  if (/^commit_journal_v\d+\.json$/.test(fileName)) return { artifactType: 'commit_journal', phase: 'commit', schemaName: 'CommitJournalSchema' };
  if (/^codex_commit_report_v\d+\.json$/.test(fileName)) return { artifactType: 'commit_report', phase: 'commit', schemaName: 'CodexCommitReportSchema' };
  if (/^codex_commit_consistency_report_v\d+\.json$/.test(fileName)) return { artifactType: 'state_diff', phase: 'commit', schemaName: 'CodexCommitConsistencyReportSchema' };
  if (/^codex_patch_failure_report_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_patch_failure_report', phase: 'commit', schemaName: 'CodexPatchFailureReportSchema' };
  if (/^codex_preview_completeness_report_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_preview_completeness_report', phase: 'commit', schemaName: 'CodexPreviewCompletenessReportSchema' };
  if (/^codex_preview_completeness_report_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_preview_completeness_report', phase: 'commit' };
  if (/^codex_preview_failure_report_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_preview_failure_report', phase: 'commit', schemaName: 'CodexPreviewFailureReportSchema' };
  if (/^codex_preview_failure_report_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_preview_failure_report', phase: 'commit' };
  if (/^codex_diagnostics_hard_fail_analysis_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_diagnostics_hard_fail_analysis', phase: 'diagnostics', schemaName: 'CodexDiagnosticsHardFailAnalysisSchema' };
  if (/^codex_diagnostics_hard_fail_analysis_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_diagnostics_hard_fail_analysis', phase: 'diagnostics' };
  if (/^diagnostics_context_audit_v\d+\.json$/.test(fileName)) return { artifactType: 'diagnostics_context_audit', phase: 'diagnostics', schemaName: 'CodexDiagnosticsContextAuditSchema' };
  if (/^diagnostics_context_audit_v\d+\.md$/.test(fileName)) return { artifactType: 'diagnostics_context_audit', phase: 'diagnostics' };
  if (/^diagnostics_context_manifest_v\d+\.json$/.test(fileName)) return { artifactType: 'diagnostics_context_manifest', phase: 'diagnostics', schemaName: 'DiagnosticsContextManifestSchema' };
  if (/^diagnostics_context_manifest_v\d+\.md$/.test(fileName)) return { artifactType: 'diagnostics_context_manifest', phase: 'diagnostics' };
  if (/^codex_diagnostics_benchmark_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_diagnostics_benchmark', phase: 'diagnostics', schemaName: 'CodexDiagnosticsBenchmarkReportSchema' };
  if (/^codex_diagnostics_benchmark_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_diagnostics_benchmark', phase: 'diagnostics' };
  if (/^codex_diagnostics_context_fix_report_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_diagnostics_context_fix_report', phase: 'diagnostics', schemaName: 'CodexDiagnosticsContextFixReportSchema' };
  if (/^codex_diagnostics_context_fix_report_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_diagnostics_context_fix_report', phase: 'diagnostics' };
  if (/^diagnostics_schema_compliance_report_v\d+\.json$/.test(fileName)) return { artifactType: 'diagnostics_schema_compliance_report', phase: 'diagnostics', schemaName: 'DiagnosticsSchemaComplianceReportSchema' };
  if (/^diagnostics_schema_compliance_report_v\d+\.md$/.test(fileName)) return { artifactType: 'diagnostics_schema_compliance_report', phase: 'diagnostics' };
  if (/^diagnostics_normalization_report_v\d+\.json$/.test(fileName)) return { artifactType: 'diagnostics_normalization_report', phase: 'diagnostics', schemaName: 'DiagnosticsNormalizationReportSchema' };
  if (/^diagnostics_normalization_report_v\d+\.md$/.test(fileName)) return { artifactType: 'diagnostics_normalization_report', phase: 'diagnostics' };
  if (/^codex_diagnostics_schema_benchmark_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_diagnostics_schema_benchmark', phase: 'diagnostics', schemaName: 'CodexDiagnosticsSchemaBenchmarkReportSchema' };
  if (/^codex_diagnostics_schema_benchmark_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_diagnostics_schema_benchmark', phase: 'diagnostics' };
  if (/^codex_diagnostics_evidence_adjudication_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_diagnostics_evidence_adjudication', phase: 'diagnostics', schemaName: 'CodexDiagnosticsEvidenceAdjudicationSchema' };
  if (/^codex_diagnostics_evidence_adjudication_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_diagnostics_evidence_adjudication', phase: 'diagnostics' };
  if (/^timeline_contradiction_map_v\d+\.json$/.test(fileName)) return { artifactType: 'timeline_contradiction_map', phase: 'diagnostics', schemaName: 'TimelineContradictionMapSchema' };
  if (/^timeline_contradiction_map_v\d+\.md$/.test(fileName)) return { artifactType: 'timeline_contradiction_map', phase: 'diagnostics' };
  if (/^targeted_revision_operation_normalization_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_operation_normalization', phase: 'revision', schemaName: 'TargetedRevisionOperationNormalizationSchema' };
  if (/^targeted_revision_operation_normalization_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_operation_normalization', phase: 'revision' };
  if (/^targeted_revision_plan_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_plan', phase: 'revision', schemaName: 'TargetedRevisionPlanArtifactSchema' };
  if (/^targeted_revision_plan_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_plan', phase: 'revision' };
  if (/^draft_targeted_revision_candidate_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_candidate', phase: 'revision' };
  if (/^targeted_revision_scope_validation_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_scope_validation', phase: 'revision', schemaName: 'TargetedRevisionScopeValidationArtifactSchema' };
  if (/^targeted_revision_scope_validation_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_scope_validation', phase: 'revision' };
  if (/^targeted_revision_diff_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_diff', phase: 'revision', schemaName: 'TargetedRevisionDiffSchema' };
  if (/^targeted_revision_diff_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_diff', phase: 'revision' };
  if (/^targeted_revision_experiment_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_experiment', phase: 'diagnostics', schemaName: 'TargetedRevisionExperimentArtifactSchema' };
  if (/^targeted_revision_experiment_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_experiment', phase: 'diagnostics' };
  if (/^targeted_revision_candidate_disposition_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_candidate_disposition', phase: 'revision', schemaName: 'TargetedRevisionCandidateDispositionArtifactSchema' };
  if (/^targeted_revision_candidate_disposition_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_candidate_disposition', phase: 'revision' };
  if (/^targeted_revision_diagnostics_ab_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_diagnostics_ab', phase: 'diagnostics', schemaName: 'ExpandedTargetRevisionDiagnosticsABSchema' };
  if (/^targeted_revision_diagnostics_ab_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_diagnostics_ab', phase: 'diagnostics' };
  if (/^candidate_diagnostics_evidence_adjudication_v\d+\.json$/.test(fileName)) return { artifactType: 'candidate_diagnostics_evidence_adjudication', phase: 'diagnostics', schemaName: 'CandidateRevisionEvidenceAdjudicationSchema' };
  if (/^candidate_diagnostics_evidence_adjudication_v\d+\.md$/.test(fileName)) return { artifactType: 'candidate_diagnostics_evidence_adjudication', phase: 'diagnostics' };
  if (/^candidate_timeline_contradiction_map_v\d+\.json$/.test(fileName)) return { artifactType: 'candidate_timeline_contradiction_map', phase: 'diagnostics', schemaName: 'CandidateTimelineContradictionMapSchema' };
  if (/^candidate_timeline_contradiction_map_v\d+\.md$/.test(fileName)) return { artifactType: 'candidate_timeline_contradiction_map', phase: 'diagnostics' };
  if (/^targeted_revision_quality_report_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_quality_report', phase: 'quality', schemaName: 'ExpandedTargetRevisionQualityReportSchema' };
  if (/^targeted_revision_quality_report_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_quality_report', phase: 'quality' };
  if (/^target_coverage_graph_v\d+\.json$/.test(fileName)) return { artifactType: 'target_coverage_graph', phase: 'diagnostics', schemaName: 'TargetCoverageGraphSchema' };
  if (/^target_coverage_graph_v\d+\.md$/.test(fileName)) return { artifactType: 'target_coverage_graph', phase: 'diagnostics' };
  if (/^target_coverage_closure_report_v\d+\.json$/.test(fileName)) return { artifactType: 'target_coverage_closure_report', phase: 'diagnostics', schemaName: 'TargetCoverageClosureReportSchema' };
  if (/^target_coverage_closure_report_v\d+\.md$/.test(fileName)) return { artifactType: 'target_coverage_closure_report', phase: 'diagnostics' };
  if (/^target_expansion_approval_preview_v\d+\.json$/.test(fileName)) return { artifactType: 'target_expansion_approval_preview', phase: 'diagnostics', schemaName: 'TargetExpansionApprovalPreviewSchema' };
  if (/^target_expansion_approval_preview_v\d+\.md$/.test(fileName)) return { artifactType: 'target_expansion_approval_preview', phase: 'diagnostics' };
  if (/^target_expansion_approval_v\d+\.json$/.test(fileName)) return { artifactType: 'target_expansion_approval', phase: 'diagnostics', schemaName: 'TargetExpansionApprovalRecordSchema' };
  if (/^target_expansion_approval_v\d+\.md$/.test(fileName)) return { artifactType: 'target_expansion_approval', phase: 'diagnostics' };
  if (/^revision_candidate_review_v\d+\.json$/.test(fileName)) return { artifactType: 'revision_candidate_review', phase: 'review', schemaName: 'RevisionCandidateReviewSchema' };
  if (/^revision_candidate_review_v\d+\.md$/.test(fileName)) return { artifactType: 'revision_candidate_review', phase: 'review' };
  if (/^revision_candidate_adoption_approval_v\d+\.json$/.test(fileName)) return { artifactType: 'revision_candidate_adoption_approval', phase: 'review', schemaName: 'RevisionCandidateAdoptionApprovalSchema' };
  if (/^revision_candidate_adoption_approval_v\d+\.md$/.test(fileName)) return { artifactType: 'revision_candidate_adoption_approval', phase: 'review' };
  if (/^draft_adoption_manifest_v\d+\.json$/.test(fileName)) return { artifactType: 'draft_adoption_manifest', phase: 'revision', schemaName: 'DraftAdoptionManifestSchema' };
  if (/^draft_adoption_manifest_v\d+\.md$/.test(fileName)) return { artifactType: 'draft_adoption_manifest', phase: 'revision' };
  if (/^draft_selection_v\d+\.json$/.test(fileName)) return { artifactType: 'draft_selection', phase: 'revision', schemaName: 'DraftSelectionSchema' };
  if (/^codex_candidate_preview_report_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_candidate_preview_report', phase: 'commit', schemaName: 'CodexCandidatePreviewReportSchema' };
  if (/^codex_candidate_preview_report_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_candidate_preview_report', phase: 'commit' };
  if (/^candidate_patch_evidence_map_v\d+\.json$/.test(fileName)) return { artifactType: 'candidate_patch_evidence_map', phase: 'human_commit_review', schemaName: 'CandidatePatchEvidenceMapSchema' };
  if (/^candidate_patch_evidence_map_v\d+\.md$/.test(fileName)) return { artifactType: 'candidate_patch_evidence_map', phase: 'human_commit_review' };
  if (/^candidate_commit_review_v\d+\.json$/.test(fileName)) return { artifactType: 'candidate_commit_review', phase: 'human_commit_review', schemaName: 'CandidateCommitReviewSchema' };
  if (/^candidate_commit_review_v\d+\.md$/.test(fileName)) return { artifactType: 'candidate_commit_review', phase: 'human_commit_review' };
  if (/^candidate_patch_noop_analysis_v\d+\.json$/.test(fileName)) return { artifactType: 'candidate_patch_noop_analysis', phase: 'human_commit_review', schemaName: 'CandidatePatchNoopAnalysisSchema' };
  if (/^candidate_patch_noop_analysis_v\d+\.md$/.test(fileName)) return { artifactType: 'candidate_patch_noop_analysis', phase: 'human_commit_review' };
  if (/^candidate_commit_mutation_decision_v\d+\.json$/.test(fileName)) return { artifactType: 'candidate_commit_mutation_decision', phase: 'human_commit_review', schemaName: 'CandidateCommitMutationDecisionSchema' };
  if (/^candidate_commit_review_finalized_v\d+\.json$/.test(fileName)) return { artifactType: 'candidate_commit_review_finalized', phase: 'human_commit_review', schemaName: 'CandidateCommitReviewFinalizedSchema' };
  if (/^candidate_commit_review_finalized_v\d+\.md$/.test(fileName)) return { artifactType: 'candidate_commit_review_finalized', phase: 'human_commit_review' };
  if (/^candidate_commit_approval_v\d+\.json$/.test(fileName)) return { artifactType: 'candidate_commit_approval', phase: 'human_commit_review', schemaName: 'CandidateCommitApprovalSchema' };
  if (/^candidate_commit_approval_v\d+\.md$/.test(fileName)) return { artifactType: 'candidate_commit_approval', phase: 'human_commit_review' };
  if (/^revision_opportunity_report_v\d+\.json$/.test(fileName)) return { artifactType: 'revision_opportunity_report', phase: 'revision', schemaName: 'RevisionOpportunityReportSchema' };
  if (/^revision_opportunity_report_v\d+\.md$/.test(fileName)) return { artifactType: 'revision_opportunity_report', phase: 'revision' };
  if (/^codex_chapter_quality_report_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_chapter_quality_report', phase: 'quality', schemaName: 'CodexChapterQualityReportSchema' };
  if (/^codex_chapter_quality_report_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_chapter_quality_report', phase: 'quality' };
  if (fileName === 'chapter_summary_for_context.json') return { artifactType: 'codex_chapter_context_summary', phase: 'context', schemaName: 'ChapterContextSummarySchema' };
  if (fileName === 'chapter_summary_for_context.md') return { artifactType: 'codex_chapter_context_summary', phase: 'context' };
  if (/^final_assembly_report_v\d+\.json$/.test(fileName)) return { artifactType: 'final_assembly_report', phase: 'final', schemaName: 'FinalAssemblyReportSchema' };
  if (/^final_assembly_report_v\d+\.md$/.test(fileName)) return { artifactType: 'final_assembly_report', phase: 'final' };
  if (/^strategy\/build_bible_cache_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'build_bible_cache_report', phase: 'strategy', schemaName: 'BuildBibleCacheReportSchema' };
  if (/^strategy\/build_bible_cache_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'build_bible_cache_report', phase: 'strategy' };
  if (/^audit\/codex_single_chapter_smoke_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_single_chapter_smoke_report', phase: 'audit', schemaName: 'CodexSingleChapterSmokeReportSchema' };
  if (/^audit\/codex_single_chapter_smoke_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_single_chapter_smoke_report', phase: 'audit' };
  if (/^audit\/codex_multi_chapter_pilot_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_multi_chapter_pilot_report', phase: 'audit', schemaName: 'CodexMultiChapterPilotReportSchema' };
  if (/^audit\/codex_multi_chapter_pilot_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_multi_chapter_pilot_report', phase: 'audit' };
  if (/^audit\/codex_cross_chapter_drift_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_cross_chapter_drift_report', phase: 'audit', schemaName: 'CodexCrossChapterDriftReportSchema' };
  if (/^audit\/codex_cross_chapter_drift_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_cross_chapter_drift_report', phase: 'audit' };
  if (/^audit\/codex_cross_chapter_continuity_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_cross_chapter_continuity_report', phase: 'audit', schemaName: 'CodexCrossChapterContinuityReportSchema' };
  if (/^audit\/codex_cross_chapter_continuity_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_cross_chapter_continuity_report', phase: 'audit' };
  if (/^audit\/codex_budget_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_budget_report', phase: 'audit', schemaName: 'CodexBudgetReportSchema' };
  if (/^audit\/codex_budget_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_budget_report', phase: 'audit' };
  if (/^audit\/codex_call_reduction_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_call_reduction_report', phase: 'audit', schemaName: 'CodexCallReductionReportSchema' };
  if (/^audit\/codex_call_reduction_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_call_reduction_report', phase: 'audit' };
  if (/^audit\/codex_stage_runtime_profile_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_stage_runtime_profile_report', phase: 'audit', schemaName: 'CodexStageRuntimeProfileReportSchema' };
  if (/^audit\/codex_stage_runtime_profile_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_stage_runtime_profile_report', phase: 'audit' };
  if (/^audit\/codex_business_optimization_plan_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_business_optimization_plan', phase: 'audit', schemaName: 'CodexBusinessOptimizationPlanSchema' };
  if (/^audit\/codex_business_optimization_plan_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_business_optimization_plan', phase: 'audit' };
  if (/^audit\/codex_runtime_benchmark_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_runtime_benchmark_report', phase: 'audit', schemaName: 'CodexRuntimeBenchmarkReportSchema' };
  if (/^audit\/codex_runtime_benchmark_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_runtime_benchmark_report', phase: 'audit' };
  if (/^audit\/codex_runtime_optimization_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_runtime_optimization_report', phase: 'audit', schemaName: 'CodexRuntimeOptimizationReportSchema' };
  if (/^audit\/codex_runtime_optimization_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_runtime_optimization_report', phase: 'audit' };
  if (/^audit\/codex_real_optimization_benchmark_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_real_optimization_benchmark_report', phase: 'audit', schemaName: 'CodexRealOptimizationBenchmarkReportSchema' };
  if (/^audit\/codex_real_optimization_benchmark_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_real_optimization_benchmark_report', phase: 'audit' };
  if (/^audit\/codex_chapter_regression_analysis_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_chapter_regression_analysis', phase: 'audit', schemaName: 'CodexChapterRegressionAnalysisSchema' };
  if (/^audit\/codex_chapter_regression_analysis_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_chapter_regression_analysis', phase: 'audit' };
  if (/^audit\/codex_runtime_gap_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_runtime_gap_report', phase: 'audit', schemaName: 'CodexRuntimeGapReportSchema' };
  if (/^audit\/codex_runtime_gap_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_runtime_gap_report', phase: 'audit' };
  if (/^audit\/codex_runtime_sampling_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_runtime_sampling_report', phase: 'audit', schemaName: 'CodexRuntimeSamplingReportSchema' };
  if (/^audit\/codex_runtime_sampling_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_runtime_sampling_report', phase: 'audit' };
  if (/^audit\/codex_mission_retry_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_mission_retry_report', phase: 'audit', schemaName: 'CodexMissionRetryReportSchema' };
  if (/^audit\/codex_mission_retry_report_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_mission_retry_report', phase: 'audit' };
  if (/^audit\/codex_mission_micro_benchmark_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_mission_micro_benchmark_report', phase: 'audit', schemaName: 'CodexMissionMicroBenchmarkReportSchema' };
  if (/^audit\/codex_mission_micro_benchmark_v\d+\.md$/.test(relativePath)) return { artifactType: 'codex_mission_micro_benchmark_report', phase: 'audit' };
  if (/^audit\/mission_schema_diagnostics_v\d+\.json$/.test(relativePath)) return { artifactType: 'mission_schema_diagnostics_report', phase: 'audit', schemaName: 'MissionSchemaDiagnosticsReportSchema' };
  if (/^audit\/mission_schema_diagnostics_v\d+\.md$/.test(relativePath)) return { artifactType: 'mission_schema_diagnostics_report', phase: 'audit' };
  if (/^audit\/codex_runtime_failure_report_v\d+\.json$/.test(relativePath)) return { artifactType: 'codex_runtime_failure_report', phase: 'audit', schemaName: 'CodexRuntimeFailureReportSchema' };
  if (/^conflict_report_v\d+\.json$/.test(fileName)) return { artifactType: 'conflict_report', phase: 'conflict', schemaName: 'ConflictReportSchema' };
  if (/^patch_repair_plan_v\d+\.json$/.test(fileName)) return { artifactType: 'repair_plan', phase: 'conflict', schemaName: 'PatchRepairPlanSchema' };
  if (/^canon_patch_repaired_v\d+\.json$/.test(fileName)) return { artifactType: 'repaired_patch', phase: 'conflict', schemaName: 'CanonPatchSchema' };
  if (/^manual_review_report_v\d+\.json$/.test(fileName)) return { artifactType: 'manual_review_report', phase: 'review', schemaName: 'ManualReviewReportSchema' };
  if (/^recommit_report_v\d+\.json$/.test(fileName)) return { artifactType: 'recommit_report', phase: 'recommit', schemaName: 'RecommitReportSchema' };
  if (/^(codex_)?approval_record_v\d+\.json$/.test(fileName)) return { artifactType: 'approval_record', phase: fileName.startsWith('codex_') ? 'commit' : 'recommit', schemaName: 'ApprovalRecordSchema' };
  if (/^downstream_invalidation_report_v\d+\.json$/.test(fileName)) return { artifactType: 'downstream_invalidation_report', phase: 'historical_recommit', schemaName: 'DownstreamInvalidationReportSchema' };
  if (/^historical_recommit_report_v\d+\.json$/.test(fileName)) return { artifactType: 'historical_recommit_report', phase: 'historical_recommit', schemaName: 'HistoricalRecommitReportSchema' };
  return { artifactType: 'brief', phase: 'unknown' };
}

function statusFor(relativePath: string, chapterNumber: number | undefined, queue: ChapterQueue | undefined): ArtifactStatus {
  if (relativePath.includes('/archive/')) return 'archived';
  if (chapterNumber !== undefined && queue?.chapters.find((chapter) => chapter.chapterNumber === chapterNumber)?.status === 'stale_due_to_history_edit') {
    return 'stale';
  }
  return 'active';
}

function chapterNumberFromPath(relativePath: string): number | undefined {
  const match = /^chapters\/chapter_(\d{3})\//.exec(relativePath);
  return match === null ? undefined : Number.parseInt(match[1]!, 10);
}

function artifactId(relativePath: string): string {
  return relativePath.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function provenanceFor(relativePath: string): string {
  if (relativePath.includes('/archive/')) return 'archived copy';
  if (relativePath.startsWith('runs/')) return 'run manifest';
  if (relativePath.startsWith('snapshots/')) return 'snapshot store';
  return 'project artifact';
}

function renderArtifactList(result: Omit<ListArtifactsResult, 'output'>): string {
  const byStatus = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const artifact of result.artifacts) {
    byStatus.set(artifact.status, (byStatus.get(artifact.status) ?? 0) + 1);
    byType.set(artifact.artifactType, (byType.get(artifact.artifactType) ?? 0) + 1);
  }
  return [
    `artifactCount: ${result.artifactCount}`,
    `staleCount: ${result.staleCount}`,
    `missingCount: ${result.missingCount}`,
    `invalidCount: ${result.invalidCount}`,
    `indexPath: ${result.indexPath}`,
    `byStatus: ${JSON.stringify(Object.fromEntries(byStatus))}`,
    `byType: ${JSON.stringify(Object.fromEntries(byType))}`
  ].join('\n') + '\n';
}
