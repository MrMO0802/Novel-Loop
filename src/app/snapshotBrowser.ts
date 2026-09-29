import path from 'node:path';

import { SnapshotAuditReportSchema, SnapshotSchema, StoryStateSchema } from '../schemas/index.js';
import type { AuditIssue, SnapshotAuditReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { SnapshotStore } from '../storage/SnapshotStore.js';
import { readFileMetadata } from './fileHash.js';

export interface SnapshotListInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber?: number;
  kind?: 'before' | 'after' | 'initial' | 'manual';
  json?: boolean;
}

export interface SnapshotSummary {
  snapshotId: string;
  path: string;
  createdAt: string;
  reason: string;
  chapterNumber?: number;
  kind: 'before' | 'after' | 'initial' | 'manual';
}

export interface SnapshotListResult {
  projectId: string;
  snapshotCount: number;
  missingBaseSnapshotCount: number;
  latestBeforeSnapshot?: SnapshotSummary;
  latestAfterSnapshot?: SnapshotSummary;
  snapshots: SnapshotSummary[];
  output: string;
}

export interface SnapshotDetail {
  snapshotId: string;
  path: string;
  createdAt: string;
  reason: string;
  chapterNumber?: number;
  relatedRunId?: string;
  relatedReportPath?: string;
  latestCommittedChapter: number;
  sha256: string;
  sizeBytes: number;
  schemaValid: boolean;
}

export interface SnapshotAuditResult {
  ok: boolean;
  report: SnapshotAuditReport;
  reportPath: string;
  markdownPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function listSnapshotsForProject(input: SnapshotListInput, fileStore = new FileStore()): Promise<SnapshotListResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const snapshots = (await new SnapshotStore(paths, fileStore).listSnapshots()).map((meta) => ({
    snapshotId: meta.snapshotId,
    path: meta.path,
    createdAt: meta.createdAt,
    reason: meta.reason,
    ...(meta.sourceChapter === undefined ? {} : { chapterNumber: meta.sourceChapter }),
    kind: snapshotKind(meta.reason)
  }));
  const filtered = snapshots.filter((snapshot) => {
    if (input.chapterNumber !== undefined && snapshot.chapterNumber !== input.chapterNumber) return false;
    if (input.kind !== undefined && snapshot.kind !== input.kind) return false;
    return true;
  });
  const latestBeforeSnapshot = [...snapshots].reverse().find((snapshot) => snapshot.kind === 'before');
  const latestAfterSnapshot = [...snapshots].reverse().find((snapshot) => snapshot.kind === 'after');
  const missingBaseSnapshotCount = await countMissingBaseSnapshots(paths, fileStore);
  const result: Omit<SnapshotListResult, 'output'> = {
    projectId: paths.projectId,
    snapshotCount: filtered.length,
    missingBaseSnapshotCount,
    ...(latestBeforeSnapshot === undefined ? {} : { latestBeforeSnapshot }),
    ...(latestAfterSnapshot === undefined ? {} : { latestAfterSnapshot }),
    snapshots: filtered
  };
  return {
    ...result,
    output: input.json === true ? `${JSON.stringify(result, null, 2)}\n` : renderSnapshots(result)
  };
}

export async function readSnapshotDetail(
  input: { projectId: string; projectsRoot?: string; snapshotId: string },
  fileStore = new FileStore()
): Promise<SnapshotDetail> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const snapshot = await fileStore.readJson(paths.snapshot(input.snapshotId), SnapshotSchema);
  const metadata = await readFileMetadata(paths.snapshot(input.snapshotId), fileStore);
  const parsed = StoryStateSchema.safeParse(snapshot.storyState);
  return {
    snapshotId: snapshot.meta.snapshotId,
    path: snapshot.meta.path,
    createdAt: snapshot.meta.createdAt,
    reason: snapshot.meta.reason,
    ...(snapshot.meta.sourceChapter === undefined ? {} : { chapterNumber: snapshot.meta.sourceChapter }),
    ...(snapshot.meta.runId === undefined ? {} : { relatedRunId: snapshot.meta.runId }),
    latestCommittedChapter: snapshot.storyState.latestCommittedChapter,
    sha256: metadata.sha256,
    sizeBytes: metadata.sizeBytes,
    schemaValid: parsed.success
  };
}

export async function verifySnapshots(
  input: { projectId: string; projectsRoot?: string },
  fileStore = new FileStore()
): Promise<SnapshotAuditResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const issues: AuditIssue[] = [];
  let snapshotsChecked = 0;
  if (await fileStore.exists(paths.snapshotsDir())) {
    for (const entry of await fileStore.list(paths.snapshotsDir())) {
      if (!entry.endsWith('.json')) continue;
      snapshotsChecked += 1;
      try {
        await fileStore.readJson(path.join(paths.snapshotsDir(), entry), SnapshotSchema);
      } catch (error) {
        issues.push(issue('snapshot_invalid', 'error', 'snapshot', `snapshots/${entry}`, `Snapshot ${entry} is invalid: ${String(error)}`, 'Restore or remove invalid snapshot.', true));
      }
    }
  }
  const requiredBaseIssues = await missingBaseSnapshotIssues(paths, fileStore);
  issues.push(...requiredBaseIssues);
  const artifact = await nextAuditArtifact(paths, fileStore, 'snapshot_audit_report');
  const report = SnapshotAuditReportSchema.parse({
    reportId: `snapshot_audit_report_v${artifact.version}`,
    projectId: paths.projectId,
    generatedAt: new Date().toISOString(),
    ok: issues.filter((candidate) => candidate.severity === 'error' || candidate.severity === 'critical').length === 0,
    snapshotsChecked,
    requiredBaseSnapshotsMissing: requiredBaseIssues.length,
    issues
  });
  const written = await fileStore.writeJson(artifact.jsonPath, report, SnapshotAuditReportSchema);
  await fileStore.writeText(artifact.mdPath, renderSnapshotAudit(written));
  return {
    ok: written.ok,
    report: written,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath
  };
}

async function countMissingBaseSnapshots(paths: ProjectPaths, fileStore: FileStore): Promise<number> {
  return (await missingBaseSnapshotIssues(paths, fileStore)).length;
}

async function missingBaseSnapshotIssues(paths: ProjectPaths, fileStore: FileStore): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  const snapshots = await new SnapshotStore(paths, fileStore).listSnapshots();
  const reasons = new Set(snapshots.map((snapshot) => snapshot.reason));
  for (const chapterNumber of committedChapterNumbersFromSnapshots(snapshots)) {
    if (chapterNumber <= 1) continue;
    const required = `after_chapter_${String(chapterNumber - 1).padStart(3, '0')}_commit`;
    if (!reasons.has(required)) {
      issues.push(issue(`missing_base_snapshot_ch${chapterNumber}`, 'error', 'snapshot', 'snapshots', `Required base snapshot ${required} is missing.`, 'Restore the missing base snapshot before historical recommit.', true));
    }
  }
  return issues;
}

function committedChapterNumbersFromSnapshots(snapshots: Array<{ reason: string; sourceChapter?: number | undefined }>): number[] {
  return snapshots
    .filter((snapshot) => /^after_chapter_\d{3}_commit$/.test(snapshot.reason) && snapshot.sourceChapter !== undefined)
    .map((snapshot) => snapshot.sourceChapter!)
    .sort((left, right) => left - right);
}

function snapshotKind(reason: string): SnapshotSummary['kind'] {
  if (reason.startsWith('before_')) return 'before';
  if (reason.startsWith('after_')) return 'after';
  if (reason.includes('initial')) return 'initial';
  return 'manual';
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
        relativeJsonPath: path.posix.join('audit', jsonFile),
        relativeMdPath: path.posix.join('audit', mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName}.`);
}

function issue(issueId: string, severity: AuditIssue['severity'], category: string, issuePath: string, message: string, suggestedFix: string, blocking: boolean): AuditIssue {
  return { issueId, severity, category, path: issuePath, message, suggestedFix, blocking };
}

function renderSnapshots(result: Omit<SnapshotListResult, 'output'>): string {
  return [
    `snapshotCount: ${result.snapshotCount}`,
    `missingBaseSnapshotCount: ${result.missingBaseSnapshotCount}`,
    `latestBeforeSnapshot: ${result.latestBeforeSnapshot?.snapshotId ?? 'none'}`,
    `latestAfterSnapshot: ${result.latestAfterSnapshot?.snapshotId ?? 'none'}`
  ].join('\n') + '\n';
}

function renderSnapshotAudit(report: SnapshotAuditReport): string {
  return [`# Snapshot Audit ${report.reportId}`, '', `OK: ${String(report.ok)}`, `Issues: ${report.issues.length}`].join('\n') + '\n';
}
