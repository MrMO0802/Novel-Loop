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
  RunEvent,
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
  processStartupMs: number;
  timeToFirstEventMs: number;
  modelResponseMs: number;
  finalMessageToExitMs: number;
  artifactWriteMs: number;
  parseMs: number;
  schemaValidationMs: number;
  measuredCodexBoundaryMs: number;
  measuredLocalProcessingMs: number;
  unexplainedMsAfterPrecision: number;
  timingOverlapDetected: boolean;
  timingOverlapWarning: string;
  overlapExplanation: string;
}

interface TimingMetrics {
  processStartupMs: number;
  timeToFirstEventMs: number;
  modelResponseMs: number;
  finalMessageToExitMs: number;
  artifactWriteMs: number;
  parseMs: number;
  schemaValidationMs: number;
  measuredCodexBoundaryMs: number;
  measuredLocalProcessingMs: number;
  missingPrecisionTiming: boolean;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function generateCodexRuntimeGapReport(input: GenerateCodexRuntimeGapReportInput, fileStore = new FileStore()): Promise<GenerateCodexRuntimeGapReportResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const storyStateBefore = await readOptionalText(paths.storyState(), fileStore);
  const benchmark = await readBestBenchmark(paths, fileStore);
  const profile = await readLatestProfile(paths, fileStore);
  const runGaps = await buildRunGaps(paths, fileStore, await readRunManifests(paths, fileStore));
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
  const precisionTotals = precisionTotalsFor(runGaps);
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
      ...precisionTotals,
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
        relativePath: path.posix.join('audit', fileName),
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
      relativePath: path.posix.join('audit', fileName),
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

async function buildRunGaps(paths: ProjectPaths, fileStore: FileStore, manifests: RunManifestV2[]): Promise<RunGapDraft[]> {
  const runGaps: RunGapDraft[] = [];
  for (const manifest of manifests) {
    const events = await readRunEvents(paths, fileStore, manifest.runId);
    const timing = timingMetricsFor(events);
    const wallClockMs = Math.round(manifest.durationMs ?? durationFromDates(manifest.startedAt, manifest.endedAt) ?? 0);
    const promptCallMs = Math.round(manifest.promptCalls.reduce((sum, call) => sum + call.latencyMs, 0));
    const localStageMs = Math.round(manifest.stages.reduce((sum, stage) => sum + (stage.durationMs ?? durationFromDates(stage.startedAt, stage.endedAt) ?? 0), 0));
    const eventDurationMs = wallClockMs;
    const unattributedGapMs = Math.max(0, wallClockMs - promptCallMs - localStageMs);
    const chapterNumber = manifest.resolvedContext.chapterNumber ?? manifest.resolvedContext.resolvedChapterNumber;
    const precisionApplicable = isCodexManifestForTiming(manifest);
    const measuredLocalProcessingMs = timing.measuredLocalProcessingMs;
    const hasPrecisionTiming = precisionApplicable && !timing.missingPrecisionTiming;
    const unexplainedMsAfterPrecision = hasPrecisionTiming ? Math.max(0, wallClockMs - timing.measuredCodexBoundaryMs - measuredLocalProcessingMs) : 0;
    const timingOverlapDetected = precisionApplicable && promptCallMs + localStageMs > wallClockMs;
    runGaps.push({
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
      suspectedSource: precisionApplicable && timing.missingPrecisionTiming ? 'event_timing_missing' : suspectedSourceForRun(manifest, unattributedGapMs, wallClockMs),
      stage: primaryStageForRun(manifest),
      processStartupMs: timing.processStartupMs,
      timeToFirstEventMs: timing.timeToFirstEventMs,
      modelResponseMs: timing.modelResponseMs,
      finalMessageToExitMs: timing.finalMessageToExitMs,
      artifactWriteMs: timing.artifactWriteMs,
      parseMs: timing.parseMs,
      schemaValidationMs: timing.schemaValidationMs,
      measuredCodexBoundaryMs: timing.measuredCodexBoundaryMs,
      measuredLocalProcessingMs,
      unexplainedMsAfterPrecision,
      timingOverlapDetected,
      timingOverlapWarning: timingOverlapDetected ? 'promptCallMs and localStageMs overlap wall-clock and must not be summed as total runtime.' : '',
      overlapExplanation: timingOverlapDetected ? 'Run stage timings and prompt-call timings are nested within wall-clock; v2 precision metrics use Codex boundary events separately.' : ''
    });
  }
  return runGaps;
}

function isCodexManifestForTiming(manifest: RunManifestV2): boolean {
  if ((manifest.provider ?? '').includes('codex')) return true;
  if (manifest.command.toLowerCase().includes('codex')) return true;
  return manifest.promptCalls.some((call) => call.provider.includes('codex') || call.promptId.toLowerCase().includes('codex'));
}

async function readRunEvents(paths: ProjectPaths, fileStore: FileStore, runId: string): Promise<RunEvent[]> {
  const eventPath = paths.runEvents(runId);
  if (!(await fileStore.exists(eventPath))) return [];
  return (await fileStore.readText(eventPath))
    .trim()
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as RunEvent];
      } catch {
        return [];
      }
    });
}

function timingMetricsFor(events: RunEvent[]): TimingMetrics {
  const at = (eventType: string): number | undefined => {
    const event = events.find((candidate) => candidate.eventType === eventType);
    if (event === undefined) return undefined;
    const parsed = Date.parse(event.timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const diff = (start: string, end: string): number => {
    const startMs = at(start);
    const endMs = at(end);
    if (startMs === undefined || endMs === undefined || endMs < startMs) return 0;
    return endMs - startMs;
  };
  const processStartupMs = diff('CODEX_PROCESS_SPAWN_STARTED', 'CODEX_PROCESS_SPAWNED');
  const timeToFirstEventMs = diff('CODEX_STDIN_WRITTEN', 'CODEX_FIRST_JSONL_EVENT');
  const modelResponseMs = diff('CODEX_FIRST_JSONL_EVENT', 'CODEX_FINAL_MESSAGE_SEEN');
  const finalMessageToExitMs = diff('CODEX_FINAL_MESSAGE_SEEN', 'CODEX_PROCESS_EXITED');
  const artifactWriteMs = pairedDuration(events, 'CODEX_ARTIFACT_WRITE_STARTED', 'CODEX_ARTIFACT_WRITE_COMPLETED');
  const parseMs = pairedDuration(events, 'CODEX_PARSE_STARTED', 'CODEX_PARSE_COMPLETED');
  const schemaValidationMs = pairedDuration(events, 'CODEX_SCHEMA_VALIDATE_STARTED', 'CODEX_SCHEMA_VALIDATE_COMPLETED');
  const measuredCodexBoundaryMs = diff('CODEX_PROCESS_SPAWN_STARTED', 'CODEX_PROCESS_EXITED');
  const measuredLocalProcessingMs = artifactWriteMs + parseMs + schemaValidationMs;
  const timingEventCount = events.filter((event) => event.eventType.startsWith('CODEX_')).length;
  return {
    processStartupMs,
    timeToFirstEventMs,
    modelResponseMs,
    finalMessageToExitMs,
    artifactWriteMs,
    parseMs,
    schemaValidationMs,
    measuredCodexBoundaryMs,
    measuredLocalProcessingMs,
    missingPrecisionTiming: timingEventCount === 0 || measuredCodexBoundaryMs === 0
  };
}

function pairedDuration(events: RunEvent[], startType: string, completedType: string): number {
  const starts = events.filter((event) => event.eventType === startType).map((event) => Date.parse(event.timestamp)).filter(Number.isFinite);
  const completed = events.filter((event) => event.eventType === completedType).map((event) => Date.parse(event.timestamp)).filter(Number.isFinite);
  let total = 0;
  for (let index = 0; index < Math.min(starts.length, completed.length); index += 1) {
    total += Math.max(0, completed[index]! - starts[index]!);
  }
  return total;
}

function precisionTotalsFor(runs: RunGapDraft[]) {
  const timingOverlapDetected = runs.some((run) => run.timingOverlapDetected);
  return {
    processStartupMs: sumRunMetric(runs, 'processStartupMs'),
    timeToFirstEventMs: sumRunMetric(runs, 'timeToFirstEventMs'),
    modelResponseMs: sumRunMetric(runs, 'modelResponseMs'),
    finalMessageToExitMs: sumRunMetric(runs, 'finalMessageToExitMs'),
    artifactWriteMs: sumRunMetric(runs, 'artifactWriteMs'),
    parseMs: sumRunMetric(runs, 'parseMs'),
    schemaValidationMs: sumRunMetric(runs, 'schemaValidationMs'),
    measuredCodexBoundaryMs: sumRunMetric(runs, 'measuredCodexBoundaryMs'),
    measuredLocalProcessingMs: sumRunMetric(runs, 'measuredLocalProcessingMs'),
    unexplainedMsAfterPrecision: sumRunMetric(runs, 'unexplainedMsAfterPrecision'),
    timingOverlapDetected,
    timingOverlapWarning: timingOverlapDetected ? 'promptCallMs and localStageMs overlap wall-clock and must not be summed as total runtime.' : '',
    overlapExplanation: timingOverlapDetected ? 'Run stage timings and prompt-call timings are nested within wall-clock; v2 precision metrics use Codex boundary events separately.' : ''
  };
}

function sumRunMetric(runs: RunGapDraft[], key: keyof Pick<RunGapDraft, 'processStartupMs' | 'timeToFirstEventMs' | 'modelResponseMs' | 'finalMessageToExitMs' | 'artifactWriteMs' | 'parseMs' | 'schemaValidationMs' | 'measuredCodexBoundaryMs' | 'measuredLocalProcessingMs' | 'unexplainedMsAfterPrecision'>): number {
  return runs.reduce((sum, run) => sum + run[key], 0);
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
        relativeJsonPath: path.posix.join('audit', jsonFile),
        relativeMdPath: path.posix.join('audit', mdFile)
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
    `measuredCodexBoundaryMs: ${report.measuredCodexBoundaryMs}`,
    `measuredLocalProcessingMs: ${report.measuredLocalProcessingMs}`,
    `unexplainedMsAfterPrecision: ${report.unexplainedMsAfterPrecision}`,
    `timingOverlapDetected: ${String(report.timingOverlapDetected)}`,
    report.timingOverlapWarning.length > 0 ? `timingOverlapWarning: ${report.timingOverlapWarning}` : '',
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
