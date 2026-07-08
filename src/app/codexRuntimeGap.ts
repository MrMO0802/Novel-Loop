import path from 'node:path';

import { inferCodexPromptStage } from '../providers/codex/promptStageMapping.js';
import {
  CodexRuntimeBenchmarkReportSchema,
  CodexRuntimeGapReportSchema,
  CodexStageRuntimeProfileReportSchema,
  RunManifestSchema
} from '../schemas/index.js';
import type {
  CodexRuntimeBenchmarkReport,
  CodexRuntimeGapReport,
  CodexRuntimeBenchmarkStage,
  CodexStageRuntimeProfileReport,
  RunManifest,
  RunManifestV2
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface GenerateCodexRuntimeGapReportInput {
  projectId: string;
  projectsRoot?: string;
}

export interface GenerateCodexRuntimeGapReportResult {
  report: CodexRuntimeGapReport;
  reportPath: string;
  markdownPath: string;
}

interface RunGapDraft {
  runId: string;
  command: string;
  chapterNumber?: number;
  wallClockMs: number;
  promptCallMs: number;
  localStageMs: number;
  eventDurationMs: number;
  unattributedGapMs: number;
  gapPercent: number;
  status: string;
  suspectedSource: CodexRuntimeGapReport['gapByRun'][number]['suspectedSource'];
  stage: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function generateCodexRuntimeGapReport(input: GenerateCodexRuntimeGapReportInput, fileStore = new FileStore()): Promise<GenerateCodexRuntimeGapReportResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const storyStateBefore = await readOptionalText(paths.storyState(), fileStore);
  const benchmark = await readBestBenchmark(paths, fileStore);
  const profile = await readLatestProfile(paths, fileStore);
  const runGaps = buildRunGaps(await readRunManifests(paths, fileStore));
  const gapByRun = runGaps
    .map(({ stage, ...run }) => {
      void stage;
      return run;
    })
    .sort((left, right) => right.unattributedGapMs - left.unattributedGapMs || left.runId.localeCompare(right.runId));
  const gapByChapter = buildChapterGaps(benchmark?.report, profile?.report, runGaps);
  const gapByStage = buildStageGaps(benchmark?.report, runGaps);
  const totalWallClockMs = benchmark?.report.totalDurationMs ?? runGaps.reduce((sum, run) => sum + run.wallClockMs, 0);
  const totalPromptCallMs = profile?.report.businessRuntimeView.totalDurationMs ?? runGaps.reduce((sum, run) => sum + run.promptCallMs, 0);
  const totalLocalStageMs = runGaps.reduce((sum, run) => sum + run.localStageMs, 0);
  const totalUnattributedGapMs = Math.max(0, totalWallClockMs - totalPromptCallMs - totalLocalStageMs);
  const suspectedGapSources = buildSuspectedSources(runGaps);
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_runtime_gap_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_runtime_gap_report_v${artifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      sourceBenchmarkPath: benchmark?.relativePath ?? 'audit/codex_runtime_benchmark_report_missing.json',
      sourceProfilePath: profile?.relativePath ?? 'audit/codex_stage_runtime_profile_missing.json',
      totalWallClockMs,
      totalPromptCallMs,
      totalLocalStageMs,
      totalUnattributedGapMs,
      gapByChapter,
      gapByRun,
      gapByStage,
      suspectedGapSources,
      recommendations: buildRecommendations(totalUnattributedGapMs, totalWallClockMs, suspectedGapSources),
      storyStateMutated: false
    },
    CodexRuntimeGapReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderMarkdown(report));
  const storyStateAfter = await readOptionalText(paths.storyState(), fileStore);
  if (storyStateAfter !== storyStateBefore) {
    throw new Error('runtime-gap mutated Story State');
  }
  return { report, reportPath: artifact.relativeJsonPath, markdownPath: artifact.relativeMdPath };
}

async function readBestBenchmark(paths: ProjectPaths, fileStore: FileStore): Promise<{ relativePath: string; report: CodexRuntimeBenchmarkReport } | undefined> {
  if (!(await fileStore.exists(paths.auditDir()))) return undefined;
  const reports: Array<{ relativePath: string; report: CodexRuntimeBenchmarkReport; version: number }> = [];
  for (const fileName of await fileStore.list(paths.auditDir())) {
    if (!/^codex_runtime_benchmark_report_v\d+\.json$/.test(fileName)) continue;
    try {
      reports.push({
        relativePath: path.join('audit', fileName),
        report: await fileStore.readJson(paths.auditArtifact(fileName), CodexRuntimeBenchmarkReportSchema),
        version: versionOf(fileName)
      });
    } catch {
      // audit handles invalid benchmark reports.
    }
  }
  return reports
    .sort((left, right) => scoreBenchmark(right.report) - scoreBenchmark(left.report) || right.version - left.version)
    .at(0);
}

function scoreBenchmark(report: CodexRuntimeBenchmarkReport): number {
  return (report.stages.some((stage) => stage.level === 'chapter2') ? 10 : 0) + (report.stages.some((stage) => stage.level === 'chapter3') ? 10 : 0) + report.completedLevels.length;
}

async function readLatestProfile(paths: ProjectPaths, fileStore: FileStore): Promise<{ relativePath: string; report: CodexStageRuntimeProfileReport } | undefined> {
  if (!(await fileStore.exists(paths.auditDir()))) return undefined;
  const files = (await fileStore.list(paths.auditDir()))
    .filter((fileName) => /^codex_stage_runtime_profile_v\d+\.json$/.test(fileName))
    .sort((left, right) => versionOf(right) - versionOf(left));
  const fileName = files[0];
  if (fileName === undefined) return undefined;
  try {
    return {
      relativePath: path.join('audit', fileName),
      report: await fileStore.readJson(paths.auditArtifact(fileName), CodexStageRuntimeProfileReportSchema)
    };
  } catch {
    return undefined;
  }
}

async function readRunManifests(paths: ProjectPaths, fileStore: FileStore): Promise<RunManifestV2[]> {
  if (!(await fileStore.exists(paths.runsDir()))) return [];
  const manifests: RunManifestV2[] = [];
  for (const runId of await fileStore.list(paths.runsDir())) {
    const manifestPath = paths.runManifest(runId);
    if (!(await fileStore.exists(manifestPath))) continue;
    try {
      const manifest = await fileStore.readJson(manifestPath, RunManifestSchema);
      if (isV2(manifest)) manifests.push(manifest);
    } catch {
      // audit handles invalid manifests.
    }
  }
  return manifests;
}

function isV2(manifest: RunManifest): manifest is RunManifestV2 {
  return 'schemaVersion' in manifest && manifest.schemaVersion === '2';
}

function buildRunGaps(manifests: RunManifestV2[]): RunGapDraft[] {
  return manifests.map((manifest) => {
    const wallClockMs = Math.round(manifest.durationMs ?? durationFromDates(manifest.startedAt, manifest.endedAt) ?? 0);
    const promptCallMs = Math.round(manifest.promptCalls.reduce((sum, call) => sum + call.latencyMs, 0));
    const localStageMs = Math.round(manifest.stages.reduce((sum, stage) => sum + (stage.durationMs ?? durationFromDates(stage.startedAt, stage.endedAt) ?? 0), 0));
    const eventDurationMs = wallClockMs;
    const unattributedGapMs = Math.max(0, wallClockMs - promptCallMs - localStageMs);
    const chapterNumber = manifest.resolvedContext.chapterNumber ?? manifest.resolvedContext.resolvedChapterNumber;
    return {
      runId: manifest.runId,
      command: manifest.command,
      ...(chapterNumber === undefined ? {} : { chapterNumber }),
      wallClockMs,
      promptCallMs,
      localStageMs,
      eventDurationMs,
      unattributedGapMs,
      gapPercent: percent(unattributedGapMs, wallClockMs),
      status: manifest.status,
      suspectedSource: suspectedSourceForRun(manifest, unattributedGapMs, wallClockMs),
      stage: primaryStageForRun(manifest)
    };
  });
}

function buildChapterGaps(
  benchmark: CodexRuntimeBenchmarkReport | undefined,
  profile: CodexStageRuntimeProfileReport | undefined,
  runs: RunGapDraft[]
): CodexRuntimeGapReport['gapByChapter'] {
  const chapters = new Set<number>();
  for (const run of runs) if (run.chapterNumber !== undefined) chapters.add(run.chapterNumber);
  for (const stage of benchmark?.stages ?? []) {
    const chapter = chapterNumberForBenchmarkStage(stage);
    if (chapter !== undefined) chapters.add(chapter);
  }
  return [...chapters]
    .sort((left, right) => left - right)
    .map((chapterNumber) => {
      const chapterRuns = runs.filter((run) => run.chapterNumber === chapterNumber);
      const benchmarkWallClock = (benchmark?.stages ?? []).filter((stage) => chapterNumberForBenchmarkStage(stage) === chapterNumber).reduce((sum, stage) => sum + stage.durationMs, 0);
      const wallClockMs = benchmarkWallClock > 0 ? benchmarkWallClock : chapterRuns.reduce((sum, run) => sum + run.wallClockMs, 0);
      const promptCallMs = chapterRuns.reduce((sum, run) => sum + run.promptCallMs, 0) || (profile?.durationByChapter[`chapter_${String(chapterNumber).padStart(3, '0')}`] ?? 0);
      const localStageMs = chapterRuns.reduce((sum, run) => sum + run.localStageMs, 0);
      const unattributedGapMs = Math.max(0, wallClockMs - promptCallMs - localStageMs);
      const largest = [...chapterRuns].sort((left, right) => right.unattributedGapMs - left.unattributedGapMs).slice(0, 3);
      return {
        chapterNumber,
        wallClockMs,
        promptCallMs,
        localStageMs,
        unattributedGapMs,
        gapPercent: percent(unattributedGapMs, wallClockMs),
        largestGapRunIds: largest.map((run) => run.runId),
        largestGapStages: uniqueStrings(largest.map((run) => run.stage))
      };
    });
}

function buildStageGaps(benchmark: CodexRuntimeBenchmarkReport | undefined, runs: RunGapDraft[]): CodexRuntimeGapReport['gapByStage'] {
  const groups = new Map<string, RunGapDraft[]>();
  for (const run of runs) {
    const key = `${run.chapterNumber ?? 0}:${run.stage}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.entries()]
    .map(([, group]) => {
      const first = group[0]!;
      const benchmarkWallClock = (benchmark?.stages ?? [])
        .filter((stage) => chapterNumberForBenchmarkStage(stage) === first.chapterNumber && stageForBenchmarkStage(stage) === first.stage)
        .reduce((sum, stage) => sum + stage.durationMs, 0);
      const wallClockMs = benchmarkWallClock > 0 ? benchmarkWallClock : group.reduce((sum, run) => sum + run.wallClockMs, 0);
      const promptCallMs = group.reduce((sum, run) => sum + run.promptCallMs, 0);
      const localStageMs = group.reduce((sum, run) => sum + run.localStageMs, 0);
      const unattributedGapMs = Math.max(0, wallClockMs - promptCallMs - localStageMs);
      return {
        stage: first.stage,
        ...(first.chapterNumber === undefined ? {} : { chapterNumber: first.chapterNumber }),
        wallClockMs,
        promptCallMs,
        localStageMs,
        unattributedGapMs,
        gapPercent: percent(unattributedGapMs, wallClockMs)
      };
    })
    .sort((left, right) => right.unattributedGapMs - left.unattributedGapMs);
}

function buildSuspectedSources(runs: RunGapDraft[]): CodexRuntimeGapReport['suspectedGapSources'] {
  const groups = new Map<RunGapDraft['suspectedSource'], RunGapDraft[]>();
  for (const run of runs.filter((candidate) => candidate.unattributedGapMs > 0)) {
    groups.set(run.suspectedSource, [...(groups.get(run.suspectedSource) ?? []), run]);
  }
  return [...groups.entries()]
    .map(([suspectedSource, group]) => {
      const sorted = [...group].sort((left, right) => right.unattributedGapMs - left.unattributedGapMs);
      return {
        suspectedSource,
        totalGapMs: group.reduce((sum, run) => sum + run.unattributedGapMs, 0),
        runIds: sorted.slice(0, 5).map((run) => run.runId),
        evidence: sorted.slice(0, 5).map((run) => `gapMs=${run.unattributedGapMs}`)
      };
    })
    .sort((left, right) => right.totalGapMs - left.totalGapMs);
}

function buildRecommendations(
  totalGapMs: number,
  totalWallClockMs: number,
  sources: CodexRuntimeGapReport['suspectedGapSources']
): CodexRuntimeGapReport['recommendations'] {
  const gapPercent = percent(totalGapMs, totalWallClockMs);
  const recommendations: CodexRuntimeGapReport['recommendations'] = [];
  if (gapPercent >= 20) {
    recommendations.push({
      recommendedAction: 'fix_observability_before_prompt_compression',
      reason: `Unattributed runtime gap is ${gapPercent}%; close runtime attribution before prompt compression.`,
      suggestedCommand: 'corepack pnpm novel-loop codex runtime-gap <projectId>',
      priority: 'high'
    });
  }
  if (sources.some((source) => source.suspectedSource === 'codex_provider_latency_variance')) {
    recommendations.push({
      recommendedAction: 'measure_provider_variance',
      reason: 'Largest gaps look like provider latency variance outside prompt-call timings.',
      priority: 'medium'
    });
  }
  return recommendations;
}

function suspectedSourceForRun(manifest: RunManifestV2, gapMs: number, wallClockMs: number): RunGapDraft['suspectedSource'] {
  if (gapMs === 0) return 'unknown';
  if (manifest.promptCalls.length === 0) return 'legacy_manifest_gap';
  if (manifest.stages.length === 0 && gapMs > wallClockMs * 0.25) return 'codex_provider_latency_variance';
  if (manifest.command.toLowerCase().includes('codex')) return 'codex_provider_latency_variance';
  return 'unknown';
}

function primaryStageForRun(manifest: RunManifestV2): string {
  if (manifest.stages[0] !== undefined) return stageForText(`${manifest.stages[0].stage} ${manifest.stages[0].name}`);
  const slowestCall = [...manifest.promptCalls].sort((left, right) => right.latencyMs - left.latencyMs).at(0);
  if (slowestCall !== undefined) return inferCodexPromptStage(slowestCall.promptId).stage;
  return stageForText(manifest.command);
}

function stageForBenchmarkStage(stage: CodexRuntimeBenchmarkStage): string {
  return stageForText(stage.stageName);
}

function stageForText(value: string): string {
  const normalized = value.toLowerCase().replace(/-/g, '_');
  if (normalized.includes('mission') || normalized.includes('dry_run')) return 'chapter_mission';
  if (normalized.includes('scene_cards')) return 'scene_cards';
  if (normalized.includes('write_scene') || normalized.includes('draft')) return 'write_scene';
  if (normalized.includes('canon_patch') || normalized.includes('preview')) return 'canon_patch_proposal';
  if (normalized.includes('confirm')) return 'confirm_apply';
  if (normalized.includes('state_diff') || normalized.includes('diff')) return 'state_diff';
  return 'other_codex';
}

function chapterNumberForBenchmarkStage(stage: CodexRuntimeBenchmarkStage): number | undefined {
  if (stage.level === 'chapter2') return 2;
  if (stage.level === 'chapter3') return 3;
  const match = /chapter[-_](\d+)/i.exec(stage.stageName);
  return match === null ? undefined : Number.parseInt(match[1]!, 10);
}

function durationFromDates(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  if (startedAt === undefined || endedAt === undefined) return undefined;
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return undefined;
  return ended - started;
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
  throw new Error(`Could not allocate ${baseName} artifact.`);
}

function renderMarkdown(report: CodexRuntimeGapReport): string {
  return [
    `# Codex Runtime Gap ${report.projectId}`,
    '',
    `totalWallClockMs: ${report.totalWallClockMs}`,
    `totalPromptCallMs: ${report.totalPromptCallMs}`,
    `totalLocalStageMs: ${report.totalLocalStageMs}`,
    `totalUnattributedGapMs: ${report.totalUnattributedGapMs}`,
    '',
    '## Gap By Chapter',
    ...report.gapByChapter.map((chapter) => `- chapter ${chapter.chapterNumber}: gap=${chapter.unattributedGapMs}ms (${chapter.gapPercent}%)`),
    '',
    '## Largest Run Gaps',
    ...report.gapByRun.slice(0, 10).map((run) => `- ${run.runId}: gap=${run.unattributedGapMs}ms source=${run.suspectedSource}`),
    '',
    '## Recommendations',
    ...(report.recommendations.length === 0 ? ['- none'] : report.recommendations.map((item) => `- ${item.recommendedAction}: ${item.reason}`))
  ].join('\n') + '\n';
}

async function readOptionalText(filePath: string, fileStore: FileStore): Promise<string> {
  if (!(await fileStore.exists(filePath))) return '';
  return fileStore.readText(filePath);
}

function percent(delta: number, baseline: number): number {
  if (baseline === 0) return delta === 0 ? 0 : 100;
  return Math.round((delta / baseline) * 10_000) / 100;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function versionOf(fileName: string): number {
  return Number.parseInt(/_v(\d+)\.json$/.exec(fileName)?.[1] ?? '0', 10);
}
