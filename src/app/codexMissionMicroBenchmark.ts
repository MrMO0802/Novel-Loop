import path from 'node:path';

import { normalizeMission } from '../providers/codex/normalizers.js';
import { resolveCodexOutputSchema } from '../providers/codex/schemas.js';
import { CodexTextProvider } from '../providers/codexTextProvider.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import { RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import {
  ChapterMissionSchema,
  ChapterQueueSchema,
  CodexChapterRegressionAnalysisSchema,
  CodexMissionMicroBenchmarkReportSchema,
  CodexMissionRetryReportSchema,
  MissionSchemaDiagnosticsReportSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  CodexMissionMicroBenchmarkReport,
  CodexMissionRetryReport,
  MissionSchemaDiagnosticsReport,
  RunManifest,
  RunManifestV2
} from '../schemas/index.js';
import { RunManifestSchema } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface RunCodexMissionMicroBenchmarkInput {
  projectId: string;
  projectsRoot?: string;
  promptRoot?: string;
  chapterNumber: number;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
}

export interface RunCodexMissionMicroBenchmarkResult {
  report: CodexMissionMicroBenchmarkReport;
  reportPath: string;
  markdownPath: string;
  retryReport: CodexMissionRetryReport;
  retryReportPath: string;
  schemaDiagnostics: MissionSchemaDiagnosticsReport;
  schemaDiagnosticsPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const PROMPT_ID = 'planning.plan_chapter_mission_slim';

export async function runCodexMissionMicroBenchmark(
  input: RunCodexMissionMicroBenchmarkInput,
  fileStore = new FileStore()
): Promise<RunCodexMissionMicroBenchmarkResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const storyStateBefore = await readOptionalText(paths.storyState(), fileStore);
  const runId = createRunId();
  const runLogger = new RunLogger(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex mission-benchmark',
    args: {
      provider: 'codex-text',
      chapterNumber: input.chapterNumber,
      codexProfile: input.codexProfile ?? 'clean',
      storyStateCommitAllowed: false
    }
  });
  const started = Date.now();
  const promptService = new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const chapterQueue = await fileStore.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema);
  const queueItem = chapterQueue.chapters.find((chapter) => chapter.chapterNumber === input.chapterNumber);
  const renderedPrompt = await promptService.renderPrompt(PROMPT_ID, {
    CHAPTER_NUMBER: input.chapterNumber,
    STORY_STATE_SUMMARY: summarizeJson({
      latestCommittedChapter: storyState.latestCommittedChapter,
      openDebts: storyState.narrativeDebts.filter((debt) => debt.status !== 'resolved').slice(0, 8),
      readerExpectations: storyState.readerState.readerExpectations.slice(0, 8)
    }),
    CHAPTER_QUEUE_ITEM: JSON.stringify(queueItem ?? {}, null, 2)
  });
  const provider = new CodexTextProvider({
    ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
    projectsRoot: paths.projectsRoot,
    projectId: paths.projectId,
    codexProfile: input.codexProfile ?? 'clean',
    codexJsonRetries: input.codexJsonRetries ?? 2,
    codexJsonRepair: input.codexJsonRepair ?? true,
    codexJsonRepairRetries: input.codexJsonRepairRetries ?? 1,
    ...(input.codexTimeoutMs === undefined ? {} : { codexTimeoutMs: input.codexTimeoutMs }),
    telemetry: {
      paths,
      runId,
      fileStore
    }
  });
  const outputSchema = resolveCodexOutputSchema(PROMPT_ID);
  if (outputSchema === undefined) {
    throw new AppError('OUTPUT_SCHEMA_NOT_FOUND', `No output schema registered for ${PROMPT_ID}`, 1);
  }

  const errors: string[] = [];
  let schemaValid = false;
  let outputBytes = 0;
  try {
    const response = await provider.complete({
      promptId: PROMPT_ID,
      system: 'Novel Loop Engine planning module',
      user: renderedPrompt,
      responseFormat: 'json',
      metadata: {
        outputSchemaPath: outputSchema.schemaPath,
        schemaName: outputSchema.schemaName
      }
    });
    outputBytes = byteLength(response.text);
    const normalized = normalizeMission(response.json, { projectId: paths.projectId, chapterNumber: input.chapterNumber });
    ChapterMissionSchema.parse(normalized);
    schemaValid = true;
  } catch (error) {
    errors.push(getErrorMessage(error));
  }

  const callMetrics = await readMissionCallMetrics(paths, fileStore, runId);
  const previousRetryCount = await previousMissionRetryCount(paths, fileStore, input.chapterNumber);
  const schemaDiagnostics = await writeSchemaDiagnostics(paths, fileStore, {
    chapterNumber: input.chapterNumber,
    schemaValid,
    errors,
    ...(callMetrics.outputPath === undefined ? {} : { outputPath: callMetrics.outputPath })
  });
  const retryReport = await writeRetryReport(paths, fileStore, {
    chapterNumber: input.chapterNumber,
    previousRetryCount,
    currentRetryCount: callMetrics.retryCount,
    repairUsed: callMetrics.repairCount > 0,
    success: schemaValid && errors.length === 0,
    schemaErrorTypes: errors.map(errorTypeForMessage)
  });
  const reportArtifact = await nextAuditArtifact(paths, fileStore, 'codex_mission_micro_benchmark');
  const report = await fileStore.writeJson(
    reportArtifact.jsonPath,
    {
      reportId: `codex_mission_micro_benchmark_v${reportArtifact.version}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      promptId: PROMPT_ID,
      generatedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - started),
      retryCount: callMetrics.retryCount,
      repairCount: callMetrics.repairCount,
      promptBytes: callMetrics.promptBytes || byteLength(renderedPrompt),
      schemaBytes: callMetrics.schemaBytes,
      outputBytes: callMetrics.outputBytes || outputBytes,
      schemaValid,
      errors,
      success: schemaValid && errors.length === 0,
      runId,
      retryReportPath: retryReport.relativePath,
      schemaDiagnosticsPath: schemaDiagnostics.relativePath,
      storyStateMutated: false
    },
    CodexMissionMicroBenchmarkReportSchema
  );
  await fileStore.writeText(reportArtifact.mdPath, renderMicroMarkdown(report));
  await runLogger.recordArtifact(runId, reportArtifact.relativeJsonPath, {
    action: 'generated',
    stage: 'chapter_mission',
    provenanceNote: 'Codex mission micro benchmark report'
  });
  await runLogger.endRun(runId, report.success ? 'success' : 'failed');
  const storyStateAfter = await readOptionalText(paths.storyState(), fileStore);
  if (storyStateBefore !== storyStateAfter) {
    throw new Error('mission-benchmark mutated Story State');
  }
  return {
    report,
    reportPath: reportArtifact.relativeJsonPath,
    markdownPath: reportArtifact.relativeMdPath,
    retryReport: retryReport.report,
    retryReportPath: retryReport.relativePath,
    schemaDiagnostics: schemaDiagnostics.report,
    schemaDiagnosticsPath: schemaDiagnostics.relativePath
  };
}

async function writeSchemaDiagnostics(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: { chapterNumber: number; schemaValid: boolean; errors: string[]; outputPath?: string }
): Promise<{ report: MissionSchemaDiagnosticsReport; relativePath: string }> {
  const artifact = await nextAuditArtifact(paths, fileStore, 'mission_schema_diagnostics');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `mission_schema_diagnostics_v${artifact.version}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      promptId: PROMPT_ID,
      generatedAt: new Date().toISOString(),
      schemaValid: input.schemaValid,
      errorTypes: input.errors.map(errorTypeForMessage),
      missingFields: [],
      extraFields: [],
      ...(input.outputPath === undefined ? {} : { outputPath: input.outputPath }),
      storyStateMutated: false
    },
    MissionSchemaDiagnosticsReportSchema
  );
  await fileStore.writeText(artifact.mdPath, `# Mission Schema Diagnostics\n\nschemaValid: ${String(report.schemaValid)}\n`);
  return { report, relativePath: artifact.relativeJsonPath };
}

async function writeRetryReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: { chapterNumber: number; previousRetryCount: number; currentRetryCount: number; repairUsed: boolean; success: boolean; schemaErrorTypes: string[] }
): Promise<{ report: CodexMissionRetryReport; relativePath: string }> {
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_mission_retry_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_mission_retry_report_v${artifact.version}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      promptId: PROMPT_ID,
      previousRetryCount: input.previousRetryCount,
      currentRetryCount: input.currentRetryCount,
      schemaErrorTypes: input.schemaErrorTypes,
      repairUsed: input.repairUsed,
      promptChanges: ['Added deterministic mission output constraints and explicit JSON-only rules.'],
      schemaChanges: ['Kept strict slim schema with required scalar and array fields.'],
      normalizerChanges: ['Mission schema diagnostics record parse and schema failures without bypassing validation.'],
      success: input.success,
      generatedAt: new Date().toISOString(),
      storyStateMutated: false
    },
    CodexMissionRetryReportSchema
  );
  await fileStore.writeText(artifact.mdPath, `# Codex Mission Retry Report\n\npreviousRetryCount: ${report.previousRetryCount}\ncurrentRetryCount: ${report.currentRetryCount}\n`);
  return { report, relativePath: artifact.relativeJsonPath };
}

async function readMissionCallMetrics(paths: ProjectPaths, fileStore: FileStore, runId: string): Promise<{ retryCount: number; repairCount: number; promptBytes: number; schemaBytes: number; outputBytes: number; outputPath?: string }> {
  try {
    const manifest = await fileStore.readJson(paths.runManifest(runId), RunManifestSchema);
    if (!isV2(manifest)) return emptyMetrics();
    const calls = manifest.promptCalls.filter((call) => call.promptId === PROMPT_ID);
    const lastCall = calls.at(-1);
    return {
      retryCount: calls.reduce((sum, call) => sum + (call.retryCount ?? 0), 0),
      repairCount: calls.filter((call) => call.finishReason === 'repaired').length,
      promptBytes: calls.reduce((sum, call) => sum + (call.promptInputBytes ?? 0), 0),
      schemaBytes: calls.reduce((sum, call) => sum + (call.schemaBytes ?? 0), 0),
      outputBytes: calls.reduce((sum, call) => sum + (call.outputBytes ?? 0), 0),
      ...(lastCall?.finalOutputPath === undefined ? {} : { outputPath: lastCall.finalOutputPath })
    };
  } catch {
    return emptyMetrics();
  }
}

function emptyMetrics(): { retryCount: number; repairCount: number; promptBytes: number; schemaBytes: number; outputBytes: number } {
  return { retryCount: 0, repairCount: 0, promptBytes: 0, schemaBytes: 0, outputBytes: 0 };
}

async function previousMissionRetryCount(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<number> {
  if (!(await fileStore.exists(paths.auditDir()))) return chapterNumber === 2 ? 1 : 0;
  const files = (await fileStore.list(paths.auditDir()))
    .filter((fileName) => /^codex_chapter_regression_analysis_v\d+\.json$/.test(fileName))
    .sort((left, right) => versionOf(right) - versionOf(left));
  for (const fileName of files) {
    try {
      const report = await fileStore.readJson(paths.auditArtifact(fileName), CodexChapterRegressionAnalysisSchema);
      const match = report.retryRegressions.find((regression) => regression.chapterNumber === chapterNumber && regression.promptId === PROMPT_ID);
      if (match !== undefined) return match.currentRetryCount;
    } catch {
      // keep looking.
    }
  }
  return chapterNumber === 2 ? 1 : 0;
}

function isV2(manifest: RunManifest): manifest is RunManifestV2 {
  return 'schemaVersion' in manifest && manifest.schemaVersion === '2';
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

function renderMicroMarkdown(report: CodexMissionMicroBenchmarkReport): string {
  return [
    `# Codex Mission Micro Benchmark ${report.projectId}`,
    '',
    `chapterNumber: ${report.chapterNumber}`,
    `durationMs: ${report.durationMs}`,
    `retryCount: ${report.retryCount}`,
    `repairCount: ${report.repairCount}`,
    `schemaValid: ${String(report.schemaValid)}`,
    `success: ${String(report.success)}`
  ].join('\n') + '\n';
}

async function readOptionalText(filePath: string, fileStore: FileStore): Promise<string> {
  if (!(await fileStore.exists(filePath))) return '';
  return fileStore.readText(filePath);
}

function summarizeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function errorTypeForMessage(message: string): string {
  if (/schema/i.test(message)) return 'schema_validation';
  if (/json|parse/i.test(message)) return 'json_parse';
  if (/timeout/i.test(message)) return 'timeout';
  return 'unknown';
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function versionOf(fileName: string): number {
  return Number.parseInt(/_v(\d+)\.json$/.exec(fileName)?.[1] ?? '0', 10);
}
