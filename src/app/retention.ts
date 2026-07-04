import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

import { RetentionReportSchema, RunManifestSchema } from '../schemas/index.js';
import type { RetentionReport, RunManifest } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface RetentionPolicyInput {
  projectId: string;
  projectsRoot?: string;
  keepRuns: number;
  keepArchivesPerChapter?: number;
}

export interface ApplyRetentionPolicyInput extends RetentionPolicyInput {
  apply?: boolean;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function previewRetentionPolicy(input: RetentionPolicyInput, fileStore = new FileStore()): Promise<RetentionReport> {
  return buildRetentionReport(input, false, fileStore);
}

export async function applyRetentionPolicy(input: ApplyRetentionPolicyInput, fileStore = new FileStore()): Promise<RetentionReport> {
  const report = await buildRetentionReport(input, true, fileStore);
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await moveRuns(paths, fileStore, report.retainedRunIds);
  const reportArtifact = await nextAuditArtifact(paths, fileStore, 'retention_report');
  const written = await fileStore.writeJson(
    reportArtifact.jsonPath,
    {
      ...report,
      reportPath: reportArtifact.relativeJsonPath
    },
    RetentionReportSchema
  );
  await fileStore.writeText(reportArtifact.mdPath, renderRetentionMarkdown(written));
  return written;
}

async function buildRetentionReport(input: RetentionPolicyInput, applied: boolean, fileStore: FileStore): Promise<RetentionReport> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const runs = await listRuns(paths, fileStore);
  const keepRuns = assertPositive(input.keepRuns, 'keepRuns');
  const sorted = runs.sort((left, right) => {
    const dateCompare = left.startedAt.localeCompare(right.startedAt);
    return dateCompare === 0 ? left.runId.localeCompare(right.runId) : dateCompare;
  });
  const candidateRunIds = sorted.slice(0, Math.max(0, sorted.length - keepRuns)).map((run) => run.runId);
  const keptRunIds = sorted.slice(Math.max(0, sorted.length - keepRuns)).map((run) => run.runId);
  return RetentionReportSchema.parse({
    reportId: `retention_${Date.now().toString(36)}`,
    projectId: paths.projectId,
    generatedAt: new Date().toISOString(),
    applied,
    policy: {
      keepRuns,
      keepArchivesPerChapter: input.keepArchivesPerChapter ?? 2
    },
    candidateRunIds,
    retainedRunIds: applied ? candidateRunIds : [],
    keptRunIds,
    candidateArchivePaths: [],
    retainedArchivePaths: [],
    keptArchivePaths: [],
    notes: [
      applied
        ? 'Old run directories were moved to retention/runs; Story State was not modified.'
        : 'Preview only; no files were moved and Story State was not modified.'
    ]
  });
}

async function listRuns(paths: ProjectPaths, fileStore: FileStore): Promise<Array<{ runId: string; startedAt: string; manifest: RunManifest }>> {
  if (!(await fileStore.exists(paths.runsDir()))) {
    return [];
  }
  const runs = [];
  for (const runId of await fileStore.list(paths.runsDir())) {
    const manifestPath = paths.runManifest(runId);
    if (!(await fileStore.exists(manifestPath))) {
      continue;
    }
    const manifest = await fileStore.readJson(manifestPath, RunManifestSchema);
    runs.push({ runId, startedAt: manifest.startedAt, manifest });
  }
  return runs;
}

async function moveRuns(paths: ProjectPaths, fileStore: FileStore, runIds: string[]): Promise<void> {
  const retainedRunsRoot = paths.projectArtifact(path.join('retention', 'runs'));
  await fileStore.ensureDir(retainedRunsRoot);
  for (const runId of runIds) {
    const source = paths.runDir(runId);
    const target = path.join(retainedRunsRoot, runId);
    if (!(await fileStore.exists(source))) {
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await rename(source, target);
  }
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
        relativeJsonPath: path.posix.join('audit', jsonFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName}.`);
}

function renderRetentionMarkdown(report: RetentionReport): string {
  return [
    `# Retention Report ${report.reportId}`,
    '',
    `Applied: ${String(report.applied)}`,
    `Keep runs: ${report.policy.keepRuns}`,
    `Retained runs: ${report.retainedRunIds.length}`,
    `Kept runs: ${report.keptRunIds.length}`,
    ''
  ].join('\n');
}

function assertPositive(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}
