import path from 'node:path';
import { z } from 'zod';

import { JsonResponseParser } from '../llm/JsonResponseParser.js';
import { RunLogger } from '../logging/RunLogger.js';
import {
  CodexDiagnosticsSchemaBenchmarkReportSchema,
  DiagnosticsNormalizationReportSchema,
  DiagnosticsReportSchema,
  DiagnosticsSchemaComplianceReportSchema,
  RunManifestSchema
} from '../schemas/index.js';
import type {
  CodexDiagnosticsSchemaBenchmarkReport,
  CodexDiagnosticsSchemaBenchmarkSample,
  DiagnosticsContextMode,
  DiagnosticsNormalizationReport,
  DiagnosticsSchemaComplianceReport,
  DiagnosticsSchemaFailureLayer,
  DiagnosticsSchemaViolationSample,
  RunManifest
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { createRunId } from '../utils/ids.js';
import { getErrorMessage } from '../utils/AppError.js';
import { PromptService } from '../prompts/PromptService.js';
import { CodexTextProvider } from '../providers/codexTextProvider.js';
import type { CodexProfile, LLMJsonResult } from '../providers/providerTypes.js';
import {
  DiagnosticsSemanticContradictionError,
  normalizeDiagnosticsWithReport,
  validateDiagnosticsProviderOutput
} from '../providers/codex/normalizers.js';
import { resolveCodexOutputSchema } from '../providers/codex/schemas.js';
import { buildDiagnosticsContextManifest } from './codexDiagnosticsContextBuilder.js';

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';

export interface RunCodexDiagnosticsSchemaBenchmarkInput {
  projectId: string;
  projectsRoot?: string;
  promptRoot?: string;
  chapterNumber: number;
  samples?: number;
  contextMode?: DiagnosticsContextMode;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
}

export interface RunCodexDiagnosticsSchemaBenchmarkResult {
  report: CodexDiagnosticsSchemaBenchmarkReport;
  reportPath: string;
  markdownPath: string;
  complianceReport: DiagnosticsSchemaComplianceReport;
  complianceReportPath: string;
  complianceMarkdownPath: string;
}

export interface DiagnosticsContractInspection {
  providerSchemaValid: boolean;
  providerSchemaErrors: string[];
  unexpectedProperties: string[];
  missingRequiredFields: string[];
  invalidEnumValues: string[];
  invalidTypes: string[];
}

interface SampleDraft {
  sample: CodexDiagnosticsSchemaBenchmarkSample;
  violation: DiagnosticsSchemaViolationSample;
}

export function inspectDiagnosticsContractValue(value: unknown): DiagnosticsContractInspection {
  const validation = validateDiagnosticsProviderOutput(value);
  return {
    providerSchemaValid: validation.success,
    providerSchemaErrors: validation.providerSchemaErrors,
    unexpectedProperties: validation.unexpectedProperties,
    missingRequiredFields: validation.missingRequiredFields,
    invalidEnumValues: validation.invalidEnumValues,
    invalidTypes: validation.invalidTypes
  };
}

export async function runCodexDiagnosticsSchemaBenchmark(
  input: RunCodexDiagnosticsSchemaBenchmarkInput,
  fileStore = new FileStore()
): Promise<RunCodexDiagnosticsSchemaBenchmarkResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const sampleCount = Math.max(1, input.samples ?? 5);
  const contextMode = input.contextMode ?? 'enhanced';
  const stateBefore = await readOptionalText(paths.storyState(), fileStore);
  const canonicalDiagnosticsPath = paths.chapterArtifact(input.chapterNumber, 'diagnostics_v1.json');
  const canonicalDiagnosticsBefore = await readOptionalText(canonicalDiagnosticsPath, fileStore);
  const context = await buildDiagnosticsContextManifest({
    projectId: input.projectId,
    projectsRoot: paths.projectsRoot,
    chapterNumber: input.chapterNumber,
    mode: contextMode
  }, fileStore);
  const renderedPrompt = await renderDiagnosticsPrompt(input, paths, fileStore, context.promptContext);
  const outputSchema = resolveCodexOutputSchema('diagnostics.diagnose_chapter_slim');
  if (outputSchema === undefined) throw new Error('No output schema registered for diagnostics.diagnose_chapter_slim');

  const drafts: SampleDraft[] = [];
  for (let index = 1; index <= sampleCount; index += 1) {
    drafts.push(await runSchemaSample(input, paths, fileStore, renderedPrompt, outputSchema, contextMode, index));
  }

  const stateAfter = await readOptionalText(paths.storyState(), fileStore);
  const canonicalDiagnosticsAfter = await readOptionalText(canonicalDiagnosticsPath, fileStore);
  if (stateAfter !== stateBefore) throw new Error('diagnostics-schema-benchmark mutated Story State');
  if (canonicalDiagnosticsAfter !== canonicalDiagnosticsBefore) throw new Error('diagnostics-schema-benchmark mutated canonical diagnostics');

  const complianceArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'diagnostics_schema_compliance_report');
  const complianceReport = await fileStore.writeJson(
    complianceArtifact.jsonPath,
    buildComplianceReport(paths, input.chapterNumber, contextMode, outputSchema.schemaPath, drafts, complianceArtifact.version),
    DiagnosticsSchemaComplianceReportSchema
  );
  await fileStore.writeText(complianceArtifact.mdPath, renderComplianceMarkdown(complianceReport));

  const benchmarkArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'codex_diagnostics_schema_benchmark');
  const report = await fileStore.writeJson(
    benchmarkArtifact.jsonPath,
    buildSchemaBenchmarkReport(
      paths,
      input.chapterNumber,
      contextMode,
      outputSchema.schemaPath,
      context.manifestPath,
      complianceArtifact.relativeJsonPath,
      drafts.map((draft) => draft.sample),
      benchmarkArtifact.version
    ),
    CodexDiagnosticsSchemaBenchmarkReportSchema
  );
  await fileStore.writeText(benchmarkArtifact.mdPath, renderBenchmarkMarkdown(report));

  return {
    report,
    reportPath: benchmarkArtifact.relativeJsonPath,
    markdownPath: benchmarkArtifact.relativeMdPath,
    complianceReport,
    complianceReportPath: complianceArtifact.relativeJsonPath,
    complianceMarkdownPath: complianceArtifact.relativeMdPath
  };
}

async function runSchemaSample(
  input: RunCodexDiagnosticsSchemaBenchmarkInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  renderedPrompt: string,
  outputSchema: { schemaPath: string; schemaName: string },
  contextMode: DiagnosticsContextMode,
  sampleIndex: number
): Promise<SampleDraft> {
  const sampleId = `diagnostics_schema_sample_${String(sampleIndex).padStart(3, '0')}`;
  const runId = createRunId(new Date(), `codex_diagnostics_schema_benchmark_ch${formatChapterNumber(input.chapterNumber)}_${String(sampleIndex).padStart(3, '0')}`);
  const runLogger = new RunLogger(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex diagnostics-schema-benchmark',
    args: {
      provider: 'codex-text',
      chapterNumber: input.chapterNumber,
      sampleId,
      contextMode,
      storyStateCommitAllowed: false,
      codexProfile: input.codexProfile ?? 'clean'
    }
  });

  const startedAt = Date.now();
  let parsedValue: unknown;
  let parseValid = false;
  let providerInspection: DiagnosticsContractInspection = emptyInspection();
  let normalizationSucceeded = false;
  let internalSchemaValid = false;
  let semanticConsistent = false;
  let normalizationWarnings: DiagnosticsNormalizationReport['normalizationWarnings'] = [];
  const parseErrors: string[] = [];
  const normalizationErrors: string[] = [];
  const internalSchemaErrors: string[] = [];
  const semanticContradictions: string[] = [];

  try {
    const provider = new CodexTextProvider({
      ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
      projectsRoot: paths.projectsRoot,
      projectId: paths.projectId,
      codexProfile: input.codexProfile ?? 'clean',
      codexJsonRetries: input.codexJsonRetries ?? 2,
      codexJsonRepair: input.codexJsonRepair ?? true,
      codexJsonRepairRetries: input.codexJsonRepairRetries ?? 1,
      ...(input.codexTimeoutMs === undefined ? {} : { codexTimeoutMs: input.codexTimeoutMs }),
      telemetry: { paths, runId, fileStore }
    });
    const response = await provider.complete({
      promptId: 'diagnostics.diagnose_chapter_slim',
      system: 'Novel Loop Engine diagnostics schema benchmark. Read only; do not edit files.',
      user: renderedPrompt,
      responseFormat: 'json',
      metadata: { outputSchemaPath: outputSchema.schemaPath, schemaName: outputSchema.schemaName }
    });
    const raw = response.raw as LLMJsonResult;
    parsedValue = raw.parsed;
    parseValid = true;
    providerInspection = inspectDiagnosticsContractValue(parsedValue);
    if (providerInspection.providerSchemaValid) {
      try {
        const normalized = normalizeDiagnosticsWithReport(parsedValue, { projectId: paths.projectId, chapterNumber: input.chapterNumber });
        normalizationSucceeded = true;
        normalizationWarnings = normalized.normalizationWarnings;
        const internal = DiagnosticsReportSchema.safeParse(normalized.report);
        internalSchemaValid = internal.success;
        if (!internal.success) internalSchemaErrors.push(...zodMessages(internal.error));
        semanticConsistent = normalized.semanticContradictions.length === 0;
      } catch (error) {
        if (error instanceof DiagnosticsSemanticContradictionError) {
          semanticContradictions.push(...error.contradictions);
        } else {
          normalizationErrors.push(getErrorMessage(error));
        }
      }
    }
  } catch (error) {
    parseErrors.push(getErrorMessage(error));
    await runLogger.recordError(runId, { code: 'CODEX_DIAGNOSTICS_SCHEMA_SAMPLE_FAILED', message: getErrorMessage(error), recoverable: true });
  }

  await runLogger.endRun(runId, internalSchemaValid && semanticConsistent ? 'success' : 'failed');
  const evidence = await collectSampleEvidence(paths, fileStore, runId);
  if (!parseValid && evidence.finalOutputPath.length > 0) {
    try {
      const finalText = await fileStore.readText(paths.projectArtifact(evidence.finalOutputPath));
      parsedValue = new JsonResponseParser().parse(finalText);
      parseValid = true;
      parseErrors.length = 0;
      providerInspection = inspectDiagnosticsContractValue(parsedValue);
      if (evidence.parsedOutputPath.length === 0) {
        evidence.parsedOutputPath = relativeChapterArtifact(input.chapterNumber, 'diagnostics_schema_samples', sampleId, 'parsed_output.json');
        await fileStore.writeJson(paths.projectArtifact(evidence.parsedOutputPath), parsedValue, z.unknown());
      }
    } catch (error) {
      parseErrors.push(getErrorMessage(error));
    }
  }
  const rawErrors = await readCodexErrorMessages(paths, fileStore, evidence.rawOutputPath);
  if (rawErrors.some((message) => message.includes('invalid_json_schema'))) {
    providerInspection = {
      ...providerInspection,
      providerSchemaValid: false,
      providerSchemaErrors: unique([...providerInspection.providerSchemaErrors, ...rawErrors])
    };
  }

  const metrics = await readSampleMetrics(paths, fileStore, runId);
  const normalizationArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'diagnostics_normalization_report');
  const normalizationReport = await fileStore.writeJson(normalizationArtifact.jsonPath, {
    reportId: `diagnostics_normalization_report_ch${formatChapterNumber(input.chapterNumber)}_v${normalizationArtifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    contextMode,
    sampleId,
    runId,
    parsedOutputPath: evidence.parsedOutputPath,
    generatedAt: new Date().toISOString(),
    normalizationSucceeded,
    internalSchemaValid,
    normalizationWarnings,
    normalizationErrors,
    internalSchemaErrors,
    semanticContradictions,
    storyStateMutated: false
  }, DiagnosticsNormalizationReportSchema);
  await fileStore.writeText(normalizationArtifact.mdPath, renderNormalizationMarkdown(normalizationReport));

  const violation: DiagnosticsSchemaViolationSample = {
    sampleId,
    runId,
    rawOutputPath: evidence.rawOutputPath,
    finalOutputPath: evidence.finalOutputPath,
    parsedOutputPath: evidence.parsedOutputPath,
    providerSchemaValid: providerInspection.providerSchemaValid,
    normalizationSucceeded,
    internalSchemaValid,
    providerSchemaErrors: providerInspection.providerSchemaErrors,
    parseErrors: unique(parseErrors),
    normalizationErrors: unique(normalizationErrors),
    internalSchemaErrors: unique(internalSchemaErrors),
    unexpectedProperties: providerInspection.unexpectedProperties,
    missingRequiredFields: providerInspection.missingRequiredFields,
    invalidEnumValues: providerInspection.invalidEnumValues,
    invalidTypes: providerInspection.invalidTypes,
    semanticContradictions: unique(semanticContradictions)
  };
  const errors = unique([
    ...violation.providerSchemaErrors,
    ...violation.parseErrors,
    ...violation.normalizationErrors,
    ...violation.internalSchemaErrors,
    ...violation.semanticContradictions
  ]);
  const sample: CodexDiagnosticsSchemaBenchmarkSample = {
    sampleId,
    runId,
    durationMs: Math.max(0, Date.now() - startedAt),
    rawOutputPath: evidence.rawOutputPath,
    finalOutputPath: evidence.finalOutputPath,
    parsedOutputPath: evidence.parsedOutputPath,
    normalizationReportPath: normalizationArtifact.relativeJsonPath,
    parseValid,
    providerSchemaValid: providerInspection.providerSchemaValid,
    normalizationSucceeded,
    internalSchemaValid,
    semanticConsistent,
    retryCount: metrics.retryCount,
    repairUsed: metrics.repairUsed,
    errors,
    storyStateMutated: false
  };
  return { sample, violation };
}

function buildComplianceReport(
  paths: ProjectPaths,
  chapterNumber: number,
  contextMode: DiagnosticsContextMode,
  providerSchemaPath: string,
  drafts: SampleDraft[],
  version: number
): DiagnosticsSchemaComplianceReport {
  const violations = drafts.map((draft) => draft.violation);
  const validSampleCount = violations.filter((sample) => sample.providerSchemaValid && sample.normalizationSucceeded && sample.internalSchemaValid && sample.semanticContradictions.length === 0).length;
  const layers = failureLayers(violations);
  return DiagnosticsSchemaComplianceReportSchema.parse({
    reportId: `diagnostics_schema_compliance_report_ch${formatChapterNumber(chapterNumber)}_v${version}`,
    projectId: paths.projectId,
    chapterNumber,
    contextMode,
    generatedAt: new Date().toISOString(),
    providerSchemaPath,
    internalSchemaName: 'DiagnosticsReportSchema',
    sampleCount: violations.length,
    validSampleCount,
    invalidSampleCount: violations.length - validSampleCount,
    violationsBySample: violations,
    violationSummary: {
      providerSchemaViolationCount: sumLengths(violations, 'providerSchemaErrors'),
      parseErrorCount: sumLengths(violations, 'parseErrors'),
      normalizationErrorCount: sumLengths(violations, 'normalizationErrors'),
      internalSchemaErrorCount: sumLengths(violations, 'internalSchemaErrors'),
      semanticContradictionCount: sumLengths(violations, 'semanticContradictions'),
      missingRequiredFieldCount: sumLengths(violations, 'missingRequiredFields'),
      unexpectedPropertyCount: sumLengths(violations, 'unexpectedProperties'),
      invalidEnumValueCount: sumLengths(violations, 'invalidEnumValues'),
      invalidTypeCount: sumLengths(violations, 'invalidTypes')
    },
    likelyFailureLayer: likelyFailureLayer(layers),
    recommendedFixes: recommendedFixes(layers),
    storyStateMutated: false
  });
}

function buildSchemaBenchmarkReport(
  paths: ProjectPaths,
  chapterNumber: number,
  contextMode: DiagnosticsContextMode,
  providerSchemaPath: string,
  diagnosticsContextManifestPath: string,
  complianceReportPath: string,
  samples: CodexDiagnosticsSchemaBenchmarkSample[],
  version: number
): CodexDiagnosticsSchemaBenchmarkReport {
  const sampleCount = samples.length;
  const parseValidRate = rate(samples.filter((sample) => sample.parseValid).length, sampleCount);
  const providerSchemaValidRate = rate(samples.filter((sample) => sample.providerSchemaValid).length, sampleCount);
  const normalizationSuccessRate = rate(samples.filter((sample) => sample.normalizationSucceeded).length, sampleCount);
  const internalSchemaValidRate = rate(samples.filter((sample) => sample.internalSchemaValid).length, sampleCount);
  const semanticConsistencyRate = rate(samples.filter((sample) => sample.semanticConsistent).length, sampleCount);
  const releaseGateReasons = [
    ...(sampleCount < 5 ? ['sampleCount must be at least 5'] : []),
    ...(providerSchemaValidRate < 0.8 ? ['providerSchemaValidRate is below 0.8'] : []),
    ...(normalizationSuccessRate < 0.8 ? ['normalizationSuccessRate is below 0.8'] : []),
    ...(internalSchemaValidRate < 0.8 ? ['internalSchemaValidRate is below 0.8'] : []),
    ...(semanticConsistencyRate < 0.8 ? ['semanticConsistencyRate is below 0.8'] : [])
  ];
  return CodexDiagnosticsSchemaBenchmarkReportSchema.parse({
    reportId: `codex_diagnostics_schema_benchmark_ch${formatChapterNumber(chapterNumber)}_v${version}`,
    projectId: paths.projectId,
    chapterNumber,
    contextMode,
    generatedAt: new Date().toISOString(),
    providerSchemaPath,
    internalSchemaName: 'DiagnosticsReportSchema',
    diagnosticsContextManifestPath,
    complianceReportPath,
    sampleCount,
    parseValidRate,
    providerSchemaValidRate,
    normalizationSuccessRate,
    internalSchemaValidRate,
    semanticConsistencyRate,
    repairRate: rate(samples.filter((sample) => sample.repairUsed).length, sampleCount),
    retryRate: rate(samples.filter((sample) => sample.retryCount > 0).length, sampleCount),
    samples,
    releaseGatePassed: releaseGateReasons.length === 0,
    releaseGateReasons,
    canonicalDiagnosticsMutated: false,
    storyStateMutated: false
  });
}

async function renderDiagnosticsPrompt(
  input: RunCodexDiagnosticsSchemaBenchmarkInput,
  paths: ProjectPaths,
  fileStore: FileStore,
  diagnosticsPromptContext: string
): Promise<string> {
  const promptService = new PromptService(path.join(input.promptRoot ?? DEFAULT_PROMPT_ROOT, 'codex-text'), fileStore);
  const draftText = await fileStore.readText(paths.chapterArtifact(input.chapterNumber, 'draft_v1.md'));
  return promptService.renderPrompt('diagnostics.diagnose_chapter_slim', {
    CHAPTER_NUMBER: input.chapterNumber,
    DRAFT_VERSION: 1,
    DRAFT_SUMMARY: summarizeText(draftText),
    DIAGNOSTICS_CONTEXT: diagnosticsPromptContext
  });
}

async function collectSampleEvidence(paths: ProjectPaths, fileStore: FileStore, parentRunId: string): Promise<{
  rawOutputPath: string;
  finalOutputPath: string;
  parsedOutputPath: string;
}> {
  const root = paths.projectArtifact(path.posix.join('codex', 'runs'));
  if (!(await fileStore.exists(root))) return { rawOutputPath: '', finalOutputPath: '', parsedOutputPath: '' };
  const childRunId = (await fileStore.list(root)).filter((entry) => entry.startsWith(`${parentRunId}_codex_`)).sort().at(-1);
  if (childRunId === undefined) return { rawOutputPath: '', finalOutputPath: '', parsedOutputPath: '' };
  const base = path.posix.join('codex', 'runs', childRunId);
  const rawOutputPath = path.posix.join(base, 'raw_output.jsonl');
  const jsonFinal = path.posix.join(base, 'final_output.json');
  const markdownFinal = path.posix.join(base, 'final_output.md');
  const parsedOutputPath = path.posix.join(base, 'parsed_output.json');
  return {
    rawOutputPath: (await fileStore.exists(paths.projectArtifact(rawOutputPath))) ? rawOutputPath : '',
    finalOutputPath: (await fileStore.exists(paths.projectArtifact(jsonFinal))) ? jsonFinal : (await fileStore.exists(paths.projectArtifact(markdownFinal))) ? markdownFinal : '',
    parsedOutputPath: (await fileStore.exists(paths.projectArtifact(parsedOutputPath))) ? parsedOutputPath : ''
  };
}

async function readSampleMetrics(paths: ProjectPaths, fileStore: FileStore, runId: string): Promise<{ retryCount: number; repairUsed: boolean }> {
  try {
    const manifest = await fileStore.readJson(paths.runManifest(runId), RunManifestSchema);
    if (!isRunManifestV2(manifest)) return { retryCount: 0, repairUsed: false };
    return {
      retryCount: manifest.promptCalls.reduce((sum, call) => sum + (call.retryCount ?? 0), 0),
      repairUsed: manifest.promptCalls.some((call) => call.finishReason === 'repaired')
    };
  } catch {
    return { retryCount: 0, repairUsed: false };
  }
}

async function readCodexErrorMessages(paths: ProjectPaths, fileStore: FileStore, rawOutputPath: string): Promise<string[]> {
  if (rawOutputPath.length === 0 || !(await fileStore.exists(paths.projectArtifact(rawOutputPath)))) return [];
  const text = await fileStore.readText(paths.projectArtifact(rawOutputPath));
  const messages: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (!isRecord(value)) continue;
      if (typeof value.message === 'string') messages.push(value.message);
      if (isRecord(value.error) && typeof value.error.message === 'string') messages.push(value.error.message);
      if (isRecord(value.item) && value.item.type === 'error' && typeof value.item.message === 'string') messages.push(value.item.message);
    } catch {
      // Raw output remains preserved; malformed JSONL is reported by parseErrors.
    }
  }
  return unique(messages);
}

function failureLayers(violations: DiagnosticsSchemaViolationSample[]): Set<DiagnosticsSchemaFailureLayer> {
  const layers = new Set<DiagnosticsSchemaFailureLayer>();
  for (const sample of violations) {
    if (sample.providerSchemaErrors.some((message) => message.includes('invalid_json_schema'))) layers.add('provider_json_schema');
    else if (sample.providerSchemaErrors.length > 0) layers.add('codex_final_output');
    if (sample.parseErrors.length > 0) layers.add('json_parser');
    if (sample.normalizationErrors.length > 0 || sample.semanticContradictions.length > 0) layers.add('provider_normalizer');
    if (sample.internalSchemaErrors.length > 0) layers.add('internal_zod_schema');
  }
  return layers;
}

function likelyFailureLayer(layers: Set<DiagnosticsSchemaFailureLayer>): DiagnosticsSchemaFailureLayer {
  if (layers.size === 0) return 'unknown';
  if (layers.size > 1) return 'cross_layer_schema_drift';
  return [...layers][0] ?? 'unknown';
}

function recommendedFixes(layers: Set<DiagnosticsSchemaFailureLayer>): string[] {
  const fixes: string[] = [];
  if (layers.has('provider_json_schema')) fixes.push('Make every declared provider schema property required and keep all provider objects closed.');
  if (layers.has('codex_final_output')) fixes.push('Align the diagnostics prompt and Codex final output with the single provider slim schema.');
  if (layers.has('json_parser')) fixes.push('Inspect redacted raw JSONL and final output; do not treat JSONL events as final JSON.');
  if (layers.has('provider_normalizer')) fixes.push('Align explicit hard-check mappings and resolve semantic contradictions before internal validation.');
  if (layers.has('internal_zod_schema')) fixes.push('Repair provider-to-internal field mapping without weakening DiagnosticsReportSchema.');
  return fixes.length === 0 ? ['No schema contract violation detected in the sampled outputs.'] : fixes;
}

function renderComplianceMarkdown(report: DiagnosticsSchemaComplianceReport): string {
  return [
    '# Diagnostics Schema Compliance Report',
    '',
    `projectId: ${report.projectId}`,
    `chapterNumber: ${report.chapterNumber}`,
    `contextMode: ${report.contextMode}`,
    `sampleCount: ${report.sampleCount}`,
    `validSampleCount: ${report.validSampleCount}`,
    `invalidSampleCount: ${report.invalidSampleCount}`,
    `likelyFailureLayer: ${report.likelyFailureLayer}`,
    '',
    ...report.recommendedFixes.map((fix) => `- ${fix}`)
  ].join('\n') + '\n';
}

function renderNormalizationMarkdown(report: DiagnosticsNormalizationReport): string {
  return [
    '# Diagnostics Normalization Report',
    '',
    `sampleId: ${report.sampleId}`,
    `runId: ${report.runId}`,
    `normalizationSucceeded: ${String(report.normalizationSucceeded)}`,
    `internalSchemaValid: ${String(report.internalSchemaValid)}`,
    `normalizationWarnings: ${report.normalizationWarnings.length}`,
    `semanticContradictions: ${report.semanticContradictions.length}`
  ].join('\n') + '\n';
}

function renderBenchmarkMarkdown(report: CodexDiagnosticsSchemaBenchmarkReport): string {
  return [
    '# Codex Diagnostics Schema Benchmark',
    '',
    `projectId: ${report.projectId}`,
    `chapterNumber: ${report.chapterNumber}`,
    `contextMode: ${report.contextMode}`,
    `sampleCount: ${report.sampleCount}`,
    `parseValidRate: ${report.parseValidRate}`,
    `providerSchemaValidRate: ${report.providerSchemaValidRate}`,
    `normalizationSuccessRate: ${report.normalizationSuccessRate}`,
    `internalSchemaValidRate: ${report.internalSchemaValidRate}`,
    `semanticConsistencyRate: ${report.semanticConsistencyRate}`,
    `repairRate: ${report.repairRate}`,
    `retryRate: ${report.retryRate}`,
    `releaseGatePassed: ${String(report.releaseGatePassed)}`,
    ...report.releaseGateReasons.map((reason) => `- ${reason}`)
  ].join('\n') + '\n';
}

async function nextVersionedChapterArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const jsonPath = paths.chapterArtifact(chapterNumber, jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      const mdFile = `${baseName}_v${version}.md`;
      return {
        version,
        jsonPath,
        mdPath: paths.chapterArtifact(chapterNumber, mdFile),
        relativeJsonPath: relativeChapterArtifact(chapterNumber, jsonFile),
        relativeMdPath: relativeChapterArtifact(chapterNumber, mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName}.`);
}

function emptyInspection(): DiagnosticsContractInspection {
  return {
    providerSchemaValid: false,
    providerSchemaErrors: [],
    unexpectedProperties: [],
    missingRequiredFields: [],
    invalidEnumValues: [],
    invalidTypes: []
  };
}

function zodMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${formatZodPath(issue.path)}: ${issue.message}`);
}

function formatZodPath(issuePath: PropertyKey[]): string {
  return issuePath.length === 0 ? '$' : issuePath.map(String).join('.');
}

function isRunManifestV2(manifest: RunManifest): manifest is Extract<RunManifest, { schemaVersion: '2' }> {
  return 'schemaVersion' in manifest && manifest.schemaVersion === '2';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sumLengths<K extends keyof DiagnosticsSchemaViolationSample>(items: DiagnosticsSchemaViolationSample[], key: K): number {
  return items.reduce((sum, item) => sum + (Array.isArray(item[key]) ? item[key].length : 0), 0);
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(4));
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function summarizeText(text: string, limit = 6000): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}...`;
}

async function readOptionalText(filePath: string, fileStore: FileStore): Promise<string | undefined> {
  return (await fileStore.exists(filePath)) ? fileStore.readText(filePath) : undefined;
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.posix.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, ...segments);
}
