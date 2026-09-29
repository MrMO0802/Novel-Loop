import path from 'node:path';

import {
  BuildBibleCacheReportSchema,
  CodexContextManifestSchema,
  CodexRuntimeBenchmarkReportSchema,
  CodexRuntimeOptimizationReportSchema,
  CodexStageRuntimeProfileReportSchema,
  FinalAssemblyReportSchema
} from '../schemas/index.js';
import type {
  CodexContextManifest,
  CodexRuntimeBenchmarkReport,
  CodexRuntimeOptimizationReport,
  CodexStageRuntimeProfileReport
} from '../schemas/index.js';
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
  const latestProfile = await readLatestProfile(paths, fileStore);
  const current = input.currentDurationsMs ?? (await currentFromLatestBenchmark(paths, fileStore)) ?? currentFromProfile(latestProfile) ?? baseline;
  const promptIdDurations = latestProfile?.businessRuntimeView.byPromptId ?? latestProfile?.durationByPromptId ?? {};
  const deltaByPromptId = ensurePromptDelta(promptIdDurations);
  const contextBudgetStats = await collectContextBudgetStats(paths, fileStore);
  const cacheHits = await countBuildBibleCacheHits(paths, fileStore);
  const localAssembleUsage = await countLocalAssemblyReports(paths, fileStore);
  const callCountAfter = latestProfile?.profiledPromptCallCount ?? 0;
  const callCountBefore = callCountAfter;
  const warnings = [
    ...(latestProfile === undefined ? ['No codex_stage_runtime_profile report found; promptId-level deltas use fallback values.'] : []),
    ...(contextBudgetStats.overBudgetCount > 0 ? [`${contextBudgetStats.overBudgetCount} context manifest(s) exceeded their budget.`] : [])
  ];
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
      deltaByPromptId,
      callCountBefore,
      callCountAfter,
      cacheHits,
      localAssembleUsage,
      contextBudgetStats,
      warnings,
      improvedStages,
      regressedStages,
      nextRecommendations: [
        'Use local assemble for final_chapter when no Codex polish is required.',
        'Use build-bible cache when the project brief hash has not changed.',
        'Keep write_scene context budget compact and inspect over-budget manifests before widening context.'
      ],
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

async function readLatestProfile(paths: ProjectPaths, fileStore: FileStore): Promise<CodexStageRuntimeProfileReport | undefined> {
  if (!(await fileStore.exists(paths.auditDir()))) return undefined;
  const files = (await fileStore.list(paths.auditDir()))
    .filter((entry) => /^codex_stage_runtime_profile_v\d+\.json$/.test(entry))
    .sort((left, right) => versionOfStageProfile(right) - versionOfStageProfile(left));
  if (files[0] === undefined) return undefined;
  try {
    return await fileStore.readJson(paths.auditArtifact(files[0]), CodexStageRuntimeProfileReportSchema);
  } catch {
    return undefined;
  }
}

function currentFromProfile(profile: CodexStageRuntimeProfileReport | undefined): Record<string, number> | undefined {
  if (profile === undefined) return undefined;
  return {
    bible: profile.durationByStage.build_bible ?? 0,
    plan:
      (profile.durationByStage.plan_global_outline ?? 0) +
      (profile.durationByStage.plan_volume_outline ?? 0) +
      (profile.durationByStage.plan_arc_map ?? 0) +
      (profile.durationByStage.plan_chapter_queue ?? 0),
    draft:
      (profile.durationByStage.chapter_mission ?? 0) +
      (profile.durationByStage.plan_candidates ?? 0) +
      (profile.durationByStage.ranking ?? 0) +
      (profile.durationByStage.scene_cards ?? 0) +
      (profile.durationByStage.write_scene ?? 0),
    preview:
      (profile.durationByStage.diagnostics ?? 0) +
      (profile.durationByStage.revision_plan ?? 0) +
      (profile.durationByStage.final_chapter ?? 0) +
      (profile.durationByStage.canon_patch_proposal ?? 0) +
      (profile.durationByStage.state_diff ?? 0),
    confirm: profile.durationByStage.confirm_apply ?? 0,
    chapter2: profile.durationByChapter.chapter_002 ?? 0,
    chapter3: profile.durationByChapter.chapter_003 ?? 0
  };
}

function ensurePromptDelta(promptIdDurations: Record<string, number>): Record<string, number> {
  return {
    'revision.final_chapter': promptIdDurations['revision.final_chapter'] ?? 0,
    ...promptIdDurations
  };
}

async function collectContextBudgetStats(paths: ProjectPaths, fileStore: FileStore): Promise<CodexRuntimeOptimizationReport['contextBudgetStats']> {
  const contextDir = paths.projectArtifact(path.posix.join('codex', 'context'));
  if (!(await fileStore.exists(contextDir))) {
    return {
      manifestCount: 0,
      overBudgetCount: 0,
      averageActualBytes: 0,
      averageBudgetBytes: 0
    };
  }
  const manifests: CodexContextManifest[] = [];
  for (const fileName of await fileStore.list(contextDir)) {
    if (!/^context_manifest_v\d+\.json$/.test(fileName)) continue;
    try {
      manifests.push(await fileStore.readJson(path.join(contextDir, fileName), CodexContextManifestSchema));
    } catch {
      // audit --strict reports invalid context manifests.
    }
  }
  const manifestCount = manifests.length;
  const actualBytes = manifests.reduce((sum, manifest) => sum + manifest.actualBytes, 0);
  const budgetBytes = manifests.reduce((sum, manifest) => sum + manifest.budgetBytes, 0);
  return {
    manifestCount,
    overBudgetCount: manifests.filter((manifest) => manifest.actualBytes > manifest.budgetBytes).length,
    averageActualBytes: manifestCount === 0 ? 0 : Math.round(actualBytes / manifestCount),
    averageBudgetBytes: manifestCount === 0 ? 0 : Math.round(budgetBytes / manifestCount)
  };
}

async function countBuildBibleCacheHits(paths: ProjectPaths, fileStore: FileStore): Promise<number> {
  if (!(await fileStore.exists(paths.strategyDir()))) return 0;
  let hits = 0;
  for (const fileName of await fileStore.list(paths.strategyDir())) {
    if (!/^build_bible_cache_report_v\d+\.json$/.test(fileName)) continue;
    try {
      const report = await fileStore.readJson(path.join(paths.strategyDir(), fileName), BuildBibleCacheReportSchema);
      if (report.cacheHit) hits += 1;
    } catch {
      // audit --strict reports invalid cache reports.
    }
  }
  return hits;
}

async function countLocalAssemblyReports(paths: ProjectPaths, fileStore: FileStore): Promise<number> {
  if (!(await fileStore.exists(paths.chaptersDir()))) return 0;
  let count = 0;
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    if (!/^chapter_\d{3}$/.test(chapterDirName)) continue;
    const chapterDir = path.join(paths.chaptersDir(), chapterDirName);
    for (const fileName of await fileStore.list(chapterDir)) {
      if (!/^final_assembly_report_v\d+\.json$/.test(fileName)) continue;
      try {
        await fileStore.readJson(path.join(chapterDir, fileName), FinalAssemblyReportSchema);
        count += 1;
      } catch {
        // audit --strict reports invalid final assembly reports.
      }
    }
  }
  return count;
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
        relativeJsonPath: path.posix.join('audit', jsonFile),
        relativeMdPath: path.posix.join('audit', mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName} audit artifact.`);
}

function versionOf(fileName: string): number {
  return Number.parseInt(/^codex_runtime_benchmark_report_v(\d+)\.json$/.exec(fileName)?.[1] ?? '0', 10);
}

function versionOfStageProfile(fileName: string): number {
  return Number.parseInt(/^codex_stage_runtime_profile_v(\d+)\.json$/.exec(fileName)?.[1] ?? '0', 10);
}

function renderOptimizationMarkdown(report: CodexRuntimeOptimizationReport): string {
  return [
    `# Codex Runtime Optimization ${report.projectId}`,
    '',
    `realBenchmark: ${String(report.realBenchmark)}`,
    `improvedStages: ${report.improvedStages.join(', ') || 'none'}`,
    `regressedStages: ${report.regressedStages.join(', ') || 'none'}`,
    `callCountBefore: ${report.callCountBefore}`,
    `callCountAfter: ${report.callCountAfter}`,
    `cacheHits: ${report.cacheHits}`,
    `localAssembleUsage: ${report.localAssembleUsage}`,
    `contextManifestCount: ${report.contextBudgetStats.manifestCount}`,
    '',
    '## Delta Percent',
    ...Object.entries(report.deltaPercent).map(([stage, delta]) => `- ${stage}: ${delta}%`),
    '',
    '## Prompt Deltas',
    ...Object.entries(report.deltaByPromptId).map(([promptId, delta]) => `- ${promptId}: ${delta}ms`),
    '',
    '## Recommendations',
    ...report.nextRecommendations.map((recommendation) => `- ${recommendation}`)
  ].join('\n') + '\n';
}
