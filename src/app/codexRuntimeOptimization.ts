import path from 'node:path';

import { CodexRuntimeBenchmarkReportSchema, CodexRuntimeOptimizationReportSchema } from '../schemas/index.js';
import type { CodexRuntimeBenchmarkReport, CodexRuntimeOptimizationReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface GenerateCodexRuntimeOptimizationReportInput {
  projectId: string;
  projectsRoot?: string;
  baselinePath?: string;
  realBenchmark: boolean;
  currentDurationsMs?: Record<string, number>;
}

export interface GenerateCodexRuntimeOptimizationReportResult {
  report: CodexRuntimeOptimizationReport;
  reportPath: string;
  markdownPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_BASELINE = {
  bible: 215_270,
  plan: 156_516,
  draft: 204_985,
  preview: 155_470,
  confirm: 7_471,
  chapter2: 341_236,
  chapter3: 348_771
};

export async function generateCodexRuntimeOptimizationReport(
  input: GenerateCodexRuntimeOptimizationReportInput,
  fileStore = new FileStore()
): Promise<GenerateCodexRuntimeOptimizationReportResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const baseline = await readBaseline(input.baselinePath ?? path.resolve('benchmarks/codex_runtime_baseline.json'), fileStore);
  const current = input.currentDurationsMs ?? (await currentFromLatestBenchmark(paths, fileStore)) ?? baseline;
  const deltaPercent = Object.fromEntries(
    Object.entries(baseline).map(([stage, baselineMs]) => {
      const currentMs = current[stage] ?? baselineMs;
      return [stage, baselineMs === 0 ? 0 : Number((((currentMs - baselineMs) / baselineMs) * 100).toFixed(2))];
    })
  );
  const improvedStages = Object.entries(deltaPercent)
    .filter(([, delta]) => delta < 0)
    .map(([stage]) => stage);
  const regressedStages = Object.entries(deltaPercent)
    .filter(([, delta]) => delta > 10)
    .map(([stage]) => stage);
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_runtime_optimization_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_runtime_optimization_report_v${artifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      realBenchmark: input.realBenchmark,
      baseline,
      current,
      deltaPercent,
      improvedStages,
      regressedStages,
      notes: [
        input.realBenchmark
          ? 'Report generated from local Codex benchmark artifacts.'
          : 'Report generated without a fresh real Codex benchmark; treat current values as fake or supplied metrics.',
        'A negative delta means current runtime is faster than the M26.5 baseline.'
      ]
    },
    CodexRuntimeOptimizationReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderOptimizationMarkdown(report));
  return {
    report,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath
  };
}

async function readBaseline(baselinePath: string, fileStore: FileStore): Promise<Record<string, number>> {
  try {
    return JSON.parse(await fileStore.readText(baselinePath)) as Record<string, number>;
  } catch {
    return DEFAULT_BASELINE;
  }
}

async function currentFromLatestBenchmark(paths: ProjectPaths, fileStore: FileStore): Promise<Record<string, number> | undefined> {
  if (!(await fileStore.exists(paths.auditDir()))) return undefined;
  const files = (await fileStore.list(paths.auditDir()))
    .filter((entry) => /^codex_runtime_benchmark_report_v\d+\.json$/.test(entry))
    .sort((left, right) => versionOf(right) - versionOf(left));
  if (files.length === 0) return undefined;
  const report = await fileStore.readJson(paths.auditArtifact(files[0]!), CodexRuntimeBenchmarkReportSchema);
  return durationsFromBenchmark(report);
}

function durationsFromBenchmark(report: CodexRuntimeBenchmarkReport): Record<string, number> {
  const result: Record<string, number> = {};
  for (const stage of report.stages) {
    if (stage.level === 'bible') result.bible = (result.bible ?? 0) + stage.durationMs;
    if (stage.level === 'plan') result.plan = (result.plan ?? 0) + stage.durationMs;
    if (stage.level === 'draft') result.draft = (result.draft ?? 0) + stage.durationMs;
    if (stage.level === 'preview') result.preview = (result.preview ?? 0) + stage.durationMs;
    if (stage.level === 'confirm') result.confirm = (result.confirm ?? 0) + stage.durationMs;
    if (stage.level === 'chapter2') result.chapter2 = (result.chapter2 ?? 0) + stage.durationMs;
    if (stage.level === 'chapter3') result.chapter3 = (result.chapter3 ?? 0) + stage.durationMs;
  }
  return result;
}

async function nextAuditArtifact(paths: ProjectPaths, fileStore: FileStore, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const mdFile = `${baseName}_v${version}.md`;
    const jsonPath = paths.auditArtifact(jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      return {
        version,
        jsonPath,
        mdPath: paths.auditArtifact(mdFile),
        relativeJsonPath: path.join('audit', jsonFile),
        relativeMdPath: path.join('audit', mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName} audit artifact.`);
}

function versionOf(fileName: string): number {
  return Number.parseInt(/^codex_runtime_benchmark_report_v(\d+)\.json$/.exec(fileName)?.[1] ?? '0', 10);
}

function renderOptimizationMarkdown(report: CodexRuntimeOptimizationReport): string {
  return [
    `# Codex Runtime Optimization ${report.projectId}`,
    '',
    `realBenchmark: ${String(report.realBenchmark)}`,
    `improvedStages: ${report.improvedStages.join(', ') || 'none'}`,
    `regressedStages: ${report.regressedStages.join(', ') || 'none'}`,
    '',
    '## Delta Percent',
    ...Object.entries(report.deltaPercent).map(([stage, delta]) => `- ${stage}: ${delta}%`)
  ].join('\n') + '\n';
}
