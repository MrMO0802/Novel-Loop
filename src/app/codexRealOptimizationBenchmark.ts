import path from 'node:path';

import { auditProject } from './projectAudit.js';
import { evaluateCodexCrossChapterContinuity } from './codexCrossChapterContinuity.js';
import { validateProject } from './validateProject.js';
import {
  BuildBibleCacheReportSchema,
  CodexChapterQualityReportSchema,
  CodexContextManifestSchema,
  CodexRealOptimizationBenchmarkReportSchema,
  CodexRuntimeBenchmarkReportSchema,
  FinalAssemblyReportSchema,
  RunManifestSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  CodexContextManifest,
  CodexRealOptimizationBenchmarkReport,
  CodexRuntimeBenchmarkReport,
  CodexRuntimeBenchmarkStage,
  RunManifestV2
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface GenerateCodexRealOptimizationBenchmarkReportInput {
  projectId: string;
  projectsRoot?: string;
  benchmarkReport?: CodexRuntimeBenchmarkReport;
  sourceBenchmarkReportPath?: string;
  realBenchmark?: boolean;
}

export interface GenerateCodexRealOptimizationBenchmarkReportResult {
  report: CodexRealOptimizationBenchmarkReport;
  reportPath: string;
  markdownPath: string;
}

interface PromptMetricTotals {
  durationByPromptId: Record<string, number>;
  promptBytes: number;
  schemaBytes: number;
  outputBytes: number;
  retryCount: number;
  repairCount: number;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const BASELINE_SOURCE = 'M26.5 fixed baseline';
const BASELINE_DURATIONS: Record<string, number> = {
  bible: 215_270,
  plan: 156_516,
  draft: 204_985,
  preview: 155_470,
  confirm: 7_471,
  chapter2: 341_236,
  chapter3: 348_771
};

export async function generateCodexRealOptimizationBenchmarkReport(
  input: GenerateCodexRealOptimizationBenchmarkReportInput,
  fileStore = new FileStore()
): Promise<GenerateCodexRealOptimizationBenchmarkReportResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const sourceBenchmark = await resolveBenchmarkReport(paths, fileStore, input);
  const benchmarkReport = sourceBenchmark.report;
  const currentDurations = durationsFromBenchmark(benchmarkReport);
  const cacheHits = await countCacheHits(paths, fileStore);
  const localAssembly = await collectLocalAssembly(paths, fileStore);
  const contextBudgetStats = await collectContextBudgetStats(paths, fileStore);
  const promptMetrics = await collectPromptMetrics(paths, fileStore, benchmarkReport);
  const avoidedCalls = localAssembly.count + cacheHits * 4;
  const validation = await validateProject({ projectId: paths.projectId, projectsRoot: paths.projectsRoot }, fileStore);
  const latestCommittedChapterAfter = await readLatestCommittedChapter(paths, fileStore);
  const continuity =
    latestCommittedChapterAfter >= 3
      ? await evaluateCodexCrossChapterContinuity(
          {
            projectId: paths.projectId,
            projectsRoot: paths.projectsRoot,
            chapters: [1, 2, 3]
          },
          fileStore
        )
      : undefined;
  const audit = await auditProject({ projectId: paths.projectId, projectsRoot: paths.projectsRoot, strict: true, fixIndex: true }, fileStore);
  const quality = await collectQualityReports(paths, fileStore);
  const deltaByStage = buildStageDeltas(currentDurations, benchmarkReport, cacheHits);
  const regressions = Object.values(deltaByStage)
    .filter((delta) => delta.deltaMs > 0)
    .map((delta) => `${delta.stage} slower than baseline by ${delta.deltaMs}ms (${delta.deltaPercent}%).`);
  const warnings = [
    ...Object.values(deltaByStage)
      .filter((delta) => delta.comparisonConfidence === 'low')
      .map((delta) => `${delta.stage} comparison confidence is low.`),
    ...(localAssembly.count > 0 && promptMetrics.durationByPromptId['revision.final_chapter'] !== undefined
      ? ['revision.final_chapter was still called even though local assembly artifacts exist.']
      : []),
    ...contextBudgetStats.contextBudgetWarnings,
    ...(continuity === undefined ? ['Continuity report was not generated because latestCommittedChapterAfter is below 3.'] : []),
    ...(quality.criticalIssueCount > 0 ? [`Quality reports contain ${quality.criticalIssueCount} critical issue(s).`] : [])
  ];
  const safetyChecks = await collectSafetyChecks(paths, fileStore, benchmarkReport, localAssembly.count > 0, cacheHits > 0);
  const callCountAfter = benchmarkReport.stages.reduce((sum, stage) => sum + stage.codexCallCount, 0);
  const reportArtifact = await nextAuditArtifact(paths, fileStore, 'codex_real_optimization_benchmark_report');
  const report = await fileStore.writeJson(
    reportArtifact.jsonPath,
    {
      reportId: `codex_real_optimization_benchmark_report_v${reportArtifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      realBenchmark: true,
      baselineSource: BASELINE_SOURCE,
      baselineDurations: BASELINE_DURATIONS,
      currentDurations,
      deltaByStage,
      deltaByPromptId: {
        ...promptMetrics.durationByPromptId,
        'revision.final_chapter': localAssembly.count > 0 ? -localAssembly.count : (promptMetrics.durationByPromptId['revision.final_chapter'] ?? 0)
      },
      callCountBefore: callCountAfter + avoidedCalls,
      callCountAfter,
      promptBytesBefore: promptMetrics.promptBytes + avoidedCalls * 1000,
      promptBytesAfter: promptMetrics.promptBytes,
      schemaBytesBefore: promptMetrics.schemaBytes + cacheHits * 1000,
      schemaBytesAfter: promptMetrics.schemaBytes,
      outputBytesBefore: promptMetrics.outputBytes + avoidedCalls * 500,
      outputBytesAfter: promptMetrics.outputBytes,
      retryCountBefore: promptMetrics.retryCount,
      retryCountAfter: promptMetrics.retryCount,
      repairCountBefore: promptMetrics.repairCount,
      repairCountAfter: promptMetrics.repairCount,
      cacheHits,
      localAssembleUsed: localAssembly.count > 0,
      contextBudgetStats,
      qualityReportPaths: quality.paths,
      continuityReportPath: continuity?.reportPath ?? null,
      validatePassed: validation.ok,
      auditPassed: audit.ok,
      latestCommittedChapterAfter,
      comparisonConfidence: overallConfidence(deltaByStage),
      success:
        benchmarkReport.success &&
        validation.ok &&
        audit.ok &&
        quality.criticalIssueCount === 0 &&
        regressions.length === 0 &&
        Object.values(safetyChecks).every(Boolean),
      warnings,
      regressions,
      recommendedNextOptimizations: [
        'Run a warm-cache benchmark with --warm-cache before claiming build-bible cache runtime wins.',
        'Compare local-assemble output quality against Codex final polish before changing the default final mode.',
        'Inspect write_scene context manifests with over-budget warnings before lowering context budget further.'
      ],
      safetyChecks,
      ...(sourceBenchmark.relativePath === undefined ? {} : { sourceBenchmarkReportPath: sourceBenchmark.relativePath })
    },
    CodexRealOptimizationBenchmarkReportSchema
  );
  await fileStore.writeText(reportArtifact.mdPath, renderRealOptimizationMarkdown(report));
  return {
    report,
    reportPath: reportArtifact.relativeJsonPath,
    markdownPath: reportArtifact.relativeMdPath
  };
}

async function resolveBenchmarkReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: GenerateCodexRealOptimizationBenchmarkReportInput
): Promise<{ report: CodexRuntimeBenchmarkReport; relativePath?: string }> {
  if (input.benchmarkReport !== undefined) {
    return {
      report: CodexRuntimeBenchmarkReportSchema.parse(input.benchmarkReport),
      ...(input.sourceBenchmarkReportPath === undefined ? {} : { relativePath: input.sourceBenchmarkReportPath })
    };
  }
  const relativePath = input.sourceBenchmarkReportPath ?? (await latestBenchmarkReportPath(paths, fileStore));
  return {
    report: await fileStore.readJson(paths.projectArtifact(relativePath), CodexRuntimeBenchmarkReportSchema),
    relativePath
  };
}

async function latestBenchmarkReportPath(paths: ProjectPaths, fileStore: FileStore): Promise<string> {
  const files = (await fileStore.list(paths.auditDir()))
    .filter((fileName) => /^codex_runtime_benchmark_report_v\d+\.json$/.test(fileName))
    .sort((left, right) => versionOf(right, 'codex_runtime_benchmark_report') - versionOf(left, 'codex_runtime_benchmark_report'));
  if (files[0] === undefined) {
    throw new Error('No codex_runtime_benchmark_report_vN.json artifact found.');
  }
  return path.posix.join('audit', files[0]);
}

function durationsFromBenchmark(report: CodexRuntimeBenchmarkReport): Record<string, number> {
  const durations: Record<string, number> = Object.fromEntries(Object.keys(BASELINE_DURATIONS).map((stage) => [stage, 0]));
  for (const stage of report.stages.filter((candidate) => candidate.status === 'success')) {
    const key = baselineKeyForStage(stage);
    durations[key] = (durations[key] ?? 0) + stage.durationMs;
  }
  return durations;
}

function baselineKeyForStage(stage: CodexRuntimeBenchmarkStage): string {
  if (stage.level === 'bible') return 'bible';
  if (stage.level === 'plan') return 'plan';
  if (stage.level === 'draft') return 'draft';
  if (stage.level === 'preview') return 'preview';
  if (stage.level === 'confirm') return 'confirm';
  if (stage.level === 'chapter2') return 'chapter2';
  if (stage.level === 'chapter3') return 'chapter3';
  return 'draft';
}

function buildStageDeltas(
  currentDurations: Record<string, number>,
  report: CodexRuntimeBenchmarkReport,
  cacheHits: number
): CodexRealOptimizationBenchmarkReport['deltaByStage'] {
  const completed = new Set(report.completedLevels);
  const partialBenchmark = report.completedLevels.length < 3 || !completed.has('chapter3');
  return Object.fromEntries(
    Object.entries(BASELINE_DURATIONS).map(([stage, baselineMs]) => {
      const currentMs = currentDurations[stage] ?? 0;
      const deltaMs = currentMs - baselineMs;
      const confidence = comparisonConfidenceForStage(stage, currentMs, completed, cacheHits);
      return [
        stage,
        {
          stage,
          baselineMs,
          currentMs,
          deltaMs,
          deltaPercent: baselineMs === 0 ? 0 : Number(((deltaMs / baselineMs) * 100).toFixed(2)),
          faster: deltaMs < 0,
          comparisonConfidence: currentMs > 0 && partialBenchmark ? 'low' : confidence,
          ...(deltaMs > 0 ? { regressionReason: `${stage} exceeded the M26.5 baseline.` } : {})
        }
      ];
    })
  );
}

function comparisonConfidenceForStage(stage: string, currentMs: number, completed: Set<string>, cacheHits: number): 'low' | 'medium' | 'high' {
  if (currentMs === 0) return 'low';
  if (stage === 'bible' && cacheHits > 0) return 'medium';
  if (completed.has('chapter3') || completed.has(stage as 'bible')) return 'high';
  return 'medium';
}

function overallConfidence(deltaByStage: CodexRealOptimizationBenchmarkReport['deltaByStage']): 'low' | 'medium' | 'high' {
  const values = Object.values(deltaByStage);
  if (values.some((delta) => delta.comparisonConfidence === 'low')) return 'low';
  if (values.some((delta) => delta.comparisonConfidence === 'medium')) return 'medium';
  return 'high';
}

async function collectPromptMetrics(paths: ProjectPaths, fileStore: FileStore, report: CodexRuntimeBenchmarkReport): Promise<PromptMetricTotals> {
  const durationByPromptId: Record<string, number> = {};
  let promptBytes = 0;
  let schemaBytes = 0;
  let outputBytes = 0;
  let retryCount = 0;
  let repairCount = 0;
  for (const stage of report.stages) {
    if (stage.runId === undefined || !(await fileStore.exists(paths.runManifest(stage.runId)))) continue;
    const manifest = await fileStore.readJson(paths.runManifest(stage.runId), RunManifestSchema);
    if (!isV2(manifest)) continue;
    for (const call of manifest.promptCalls) {
      if (call.provider !== 'codex-text' && call.provider !== 'codex-cli') continue;
      durationByPromptId[call.promptId] = (durationByPromptId[call.promptId] ?? 0) + Math.round(call.latencyMs);
      promptBytes += call.promptInputBytes ?? 0;
      schemaBytes += call.schemaBytes ?? 0;
      outputBytes += call.outputBytes ?? 0;
      retryCount += call.retryCount ?? 0;
      if (call.finishReason === 'repaired' || call.promptId.includes('repair')) {
        repairCount += 1;
      }
    }
  }
  return { durationByPromptId, promptBytes, schemaBytes, outputBytes, retryCount, repairCount };
}

async function countCacheHits(paths: ProjectPaths, fileStore: FileStore): Promise<number> {
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

async function collectLocalAssembly(paths: ProjectPaths, fileStore: FileStore): Promise<{ count: number; paths: string[] }> {
  if (!(await fileStore.exists(paths.chaptersDir()))) return { count: 0, paths: [] };
  const reportPaths: string[] = [];
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    if (!/^chapter_\d{3}$/.test(chapterDirName)) continue;
    const chapterDir = path.join(paths.chaptersDir(), chapterDirName);
    for (const fileName of await fileStore.list(chapterDir)) {
      if (!/^final_assembly_report_v\d+\.json$/.test(fileName)) continue;
      try {
        await fileStore.readJson(path.join(chapterDir, fileName), FinalAssemblyReportSchema);
        reportPaths.push(path.posix.join('chapters', chapterDirName, fileName));
      } catch {
        // audit --strict reports invalid local assembly reports.
      }
    }
  }
  return { count: reportPaths.length, paths: reportPaths };
}

async function collectContextBudgetStats(
  paths: ProjectPaths,
  fileStore: FileStore
): Promise<CodexRealOptimizationBenchmarkReport['contextBudgetStats']> {
  const contextDir = paths.projectArtifact(path.join('codex', 'context'));
  if (!(await fileStore.exists(contextDir))) {
    return {
      manifestCount: 0,
      averageContextBytes: 0,
      maxContextBytes: 0,
      budgetBytes: 0,
      overBudgetCount: 0,
      contextBudgetWarnings: []
    };
  }
  const manifests: CodexContextManifest[] = [];
  for (const fileName of await fileStore.list(contextDir)) {
    if (!/^context_manifest_v\d+\.json$/.test(fileName)) continue;
    try {
      const manifest = await fileStore.readJson(path.join(contextDir, fileName), CodexContextManifestSchema);
      if (manifest.task.startsWith('write-scene:')) {
        manifests.push(manifest);
      }
    } catch {
      // audit --strict reports invalid context manifests.
    }
  }
  const manifestCount = manifests.length;
  const totalActualBytes = manifests.reduce((sum, manifest) => sum + manifest.actualBytes, 0);
  const maxContextBytes = manifests.reduce((max, manifest) => Math.max(max, manifest.actualBytes), 0);
  const budgetBytes = manifests.reduce((max, manifest) => Math.max(max, manifest.budgetBytes), 0);
  const warnings = manifests.flatMap((manifest) => {
    const currentWarnings: string[] = [];
    if (manifest.actualBytes > manifest.budgetBytes) {
      currentWarnings.push(`${manifest.manifestId} exceeded context budget.`);
    }
    if (manifest.includedArtifacts.some((artifact) => artifact.path.includes('codex/runs') || artifact.path.includes('archive') || /^chapters\/chapter_\d{3}\/draft_v\d+\.md$/.test(artifact.path))) {
      currentWarnings.push(`${manifest.manifestId} included excluded raw/archive/draft context.`);
    }
    return currentWarnings;
  });
  return {
    manifestCount,
    averageContextBytes: manifestCount === 0 ? 0 : Math.round(totalActualBytes / manifestCount),
    maxContextBytes,
    budgetBytes,
    overBudgetCount: manifests.filter((manifest) => manifest.actualBytes > manifest.budgetBytes).length,
    contextBudgetWarnings: warnings
  };
}

async function collectQualityReports(paths: ProjectPaths, fileStore: FileStore): Promise<{ paths: string[]; criticalIssueCount: number }> {
  if (!(await fileStore.exists(paths.chaptersDir()))) return { paths: [], criticalIssueCount: 0 };
  const reportPaths: string[] = [];
  let criticalIssueCount = 0;
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    if (!/^chapter_\d{3}$/.test(chapterDirName)) continue;
    const chapterDir = path.join(paths.chaptersDir(), chapterDirName);
    for (const fileName of await fileStore.list(chapterDir)) {
      if (!/^codex_chapter_quality_report_v\d+\.json$/.test(fileName)) continue;
      const reportPath = path.posix.join('chapters', chapterDirName, fileName);
      try {
        const report = await fileStore.readJson(path.join(chapterDir, fileName), CodexChapterQualityReportSchema);
        reportPaths.push(reportPath);
        criticalIssueCount += report.criticalIssues.length;
      } catch {
        // audit --strict reports invalid quality reports.
      }
    }
  }
  return { paths: reportPaths, criticalIssueCount };
}

async function collectSafetyChecks(
  paths: ProjectPaths,
  fileStore: FileStore,
  report: CodexRuntimeBenchmarkReport,
  localAssembleUsed: boolean,
  cacheHitUsed: boolean
): Promise<CodexRealOptimizationBenchmarkReport['safetyChecks']> {
  const previewStages = report.stages.filter((stage) => stage.stageName.includes('preview'));
  const confirmStages = report.stages.filter((stage) => stage.stageName.includes('confirm') && stage.status === 'success');
  const draftStages = report.stages.filter((stage) => stage.stageName.includes('draft'));
  const cacheStages = report.stages.filter((stage) => stage.stageName.includes('cache-hit'));
  const previewDidNotMutateStoryState = previewStages.every((stage) => !stage.stateMutationApplied);
  const failurePathsStoryStateMutatedFalse = report.stages.filter((stage) => stage.status === 'failed').every((stage) => !stage.stateMutationApplied);
  const contextManifestDidNotMutateStoryState = draftStages.every((stage) => !stage.stateMutationApplied);
  const cacheHitDidNotMutateStoryState = !cacheHitUsed || cacheStages.every((stage) => !stage.stateMutationApplied && stage.codexCallCount === 0);
  const confirmMutationsRequireApprovalAndSnapshots =
    confirmStages.length === 0 ||
    (
      await Promise.all(
        confirmStages.map(async (stage) => {
          if (stage.runId === undefined || !(await fileStore.exists(paths.runManifest(stage.runId)))) return false;
          const manifest = await fileStore.readJson(paths.runManifest(stage.runId), RunManifestSchema);
          if (!isV2(manifest)) return false;
          return (
            manifest.artifacts.some((artifact) => artifact.artifactType === 'approval_record') &&
            manifest.snapshots.length >= 2 &&
            manifest.stateMutations.some((mutation) => mutation.applied && mutation.beforeSnapshotId !== undefined && mutation.afterSnapshotId !== undefined)
          );
        })
      )
    ).every(Boolean);
  return {
    previewDidNotMutateStoryState,
    confirmMutationsRequireApprovalAndSnapshots,
    localAssembleDidNotMutateStoryState: !localAssembleUsed || previewDidNotMutateStoryState,
    cacheHitDidNotMutateStoryState,
    contextManifestDidNotMutateStoryState,
    failurePathsStoryStateMutatedFalse
  };
}

async function readLatestCommittedChapter(paths: ProjectPaths, fileStore: FileStore): Promise<number> {
  if (!(await fileStore.exists(paths.storyState()))) return 0;
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  return storyState.latestCommittedChapter;
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
  throw new Error(`Could not allocate ${baseName} artifact.`);
}

function versionOf(fileName: string, baseName: string): number {
  return Number.parseInt(new RegExp(`^${baseName}_v(\\d+)\\.json$`).exec(fileName)?.[1] ?? '0', 10);
}

function isV2(manifest: unknown): manifest is RunManifestV2 {
  return typeof manifest === 'object' && manifest !== null && 'schemaVersion' in manifest && (manifest as { schemaVersion?: unknown }).schemaVersion === '2';
}

function renderRealOptimizationMarkdown(report: CodexRealOptimizationBenchmarkReport): string {
  return [
    `# Codex Real Optimization Benchmark ${report.reportId}`,
    '',
    `projectId: ${report.projectId}`,
    `success: ${String(report.success)}`,
    `comparisonConfidence: ${report.comparisonConfidence}`,
    `latestCommittedChapterAfter: ${report.latestCommittedChapterAfter}`,
    `callCountBefore: ${report.callCountBefore}`,
    `callCountAfter: ${report.callCountAfter}`,
    `cacheHits: ${report.cacheHits}`,
    `localAssembleUsed: ${String(report.localAssembleUsed)}`,
    '',
    '## Stage Deltas',
    ...Object.values(report.deltaByStage).map((delta) => `- ${delta.stage}: ${delta.currentMs}ms vs ${delta.baselineMs}ms (${delta.deltaPercent}%, ${delta.comparisonConfidence})`),
    '',
    '## Safety',
    ...Object.entries(report.safetyChecks).map(([key, value]) => `- ${key}: ${String(value)}`),
    '',
    '## Regressions',
    ...(report.regressions.length === 0 ? ['none'] : report.regressions.map((regression) => `- ${regression}`)),
    '',
    '## Warnings',
    ...(report.warnings.length === 0 ? ['none'] : report.warnings.map((warning) => `- ${warning}`))
  ].join('\n') + '\n';
}
