import { createHash } from 'node:crypto';
import { z } from 'zod';

import { checkCodexStatus, execCodexJsonPrompt, execCodexTextPrompt } from '../app/codexBoundary.js';
import type { CodexExecJsonResult, CodexExecResult } from '../app/codexBoundary.js';
import { JsonResponseParseError } from '../llm/JsonResponseParser.js';
import type { LLMClient, LLMRequest, LLMResponse } from '../llm/LLMClient.js';
import { RunLogger } from '../logging/RunLogger.js';
import { CodexErrorTypeSchema, CodexJsonFailureReportSchema } from '../schemas/index.js';
import type { CodexErrorType, LLMCallRecord } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import type { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { CODEX_TEXT_CAPABILITIES } from './providerCapabilities.js';
import { inferCodexPromptStage } from './codex/promptStageMapping.js';
import { resolveCodexOutputSchema } from './codex/schemas.js';
import type { CodexProfile, LLMJsonResult, LLMTextResult, ProviderCapabilities, ProviderHealth, ProviderJsonRequest, ProviderTextRequest } from './providerTypes.js';

const CodexFailureErrorSchema = z.object({
  errorType: CodexErrorTypeSchema,
  message: z.string()
});

export interface CodexTextProviderOptions {
  codexBin?: string;
  projectsRoot?: string;
  projectId?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
  telemetry?: {
    paths: ProjectPaths;
    runId: string;
    fileStore?: FileStore;
  };
}

export type CodexProviderFailureClassification =
  | 'unavailable'
  | 'login_required'
  | 'usage_limit'
  | 'invalid_output';

export class ProviderError extends Error {
  readonly code: string;
  readonly provider = 'codex-text';
  readonly recoverable: boolean;
  readonly classification: CodexProviderFailureClassification | undefined;

  constructor(
    code: string,
    message: string,
    recoverable = true,
    classification?: CodexProviderFailureClassification
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.recoverable = recoverable;
    this.classification = classification;
  }
}

export class CodexTextProvider implements LLMClient {
  private readonly fileStore: FileStore;
  private callIndex = 0;

  constructor(private readonly options: CodexTextProviderOptions = {}) {
    this.fileStore = options.telemetry?.fileStore ?? new FileStore();
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (request.responseFormat === 'json') {
      const result = await this.generateJson(request);
      return {
        text: result.text,
        json: result.parsed,
        model: result.model,
        raw: result
      };
    }

    const result = await this.generateText(request);
    return {
      text: result.text,
      model: result.model,
      raw: result
    };
  }

  getCapabilities(): ProviderCapabilities {
    return CODEX_TEXT_CAPABILITIES;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const status = await checkCodexStatus(this.boundaryInput());
    let execSmokeOk = false;
    let execJsonOk = false;
    try {
      await execCodexTextPrompt({
        ...this.boundaryInput(),
        runId: this.nextCallIdentity('health_smoke').childRunId,
        promptText: 'PROMPT_ID: provider.health_smoke\nReply with CODEX_TEXT_PROVIDER_OK.'
      });
      execSmokeOk = true;
    } catch {
      execSmokeOk = false;
    }

    try {
      const schema = resolveCodexOutputSchema('provider.health');
      const schemaPath = schema?.schemaPath ?? 'schemas/codex-output/provider.health.schema.json';
      await execCodexJsonPrompt({
        ...this.boundaryInput(),
        runId: this.nextCallIdentity('health_json').childRunId,
        promptText: 'PROMPT_ID: provider.health\nReturn {"ok": true}.',
        schemaPath
      });
      execJsonOk = true;
    } catch {
      execJsonOk = false;
    }

    const providerAvailable = !status.loginStatus.startsWith('Codex CLI command failed') && execSmokeOk && execJsonOk;
    return {
      providerId: 'codex-text',
      binaryAvailable: true,
      loginAvailable: !status.loginStatus.startsWith('Codex CLI command failed'),
      doctorHealthy: status.healthOk,
      execSmokeOk,
      execJsonOk,
      providerAvailable,
      available: providerAvailable,
      binaryPath: status.binaryPath,
      version: status.version,
      loginStatus: status.loginStatus,
      doctorStatus: status.healthOk ? 'healthy' : 'unhealthy'
    };
  }

  estimateCost(): { supported: false; estimatedCostUsd: undefined } {
    return {
      supported: false,
      estimatedCostUsd: undefined
    };
  }

  async generateText(request: ProviderTextRequest): Promise<LLMTextResult> {
    const startedAt = new Date().toISOString();
    try {
      const codexVersion = await this.codexVersion();
      const identity = this.nextCallIdentity(request.promptId);
      const result = await execCodexTextPrompt({
        ...this.boundaryInput(),
        runId: identity.childRunId,
        parentPromptCallId: identity.parentPromptCallId,
        parentPromptId: request.promptId,
        parentStage: inferCodexPromptStage(request.promptId).stage,
        ...(this.options.telemetry?.runId === undefined ? {} : { parentRunId: this.options.telemetry.runId }),
        promptText: this.renderBoundaryPrompt(request)
      });
      await this.recordProviderProvenance(request, result, {
        promptCallId: identity.parentPromptCallId,
        startedAt,
        codexVersion,
        jsonParsed: false,
        schemaValid: false
      });
      return {
        ok: true,
        provider: 'codex-text',
        model: 'codex-cli',
        text: result.text,
        rawResponseRedacted: result.rawResponseRedacted,
        latencyMs: result.latencyMs,
        requestId: result.runId,
        finishReason: 'completed'
      };
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async generateJson(request: ProviderJsonRequest): Promise<LLMJsonResult> {
    const startedAt = new Date().toISOString();
    const outputSchema = this.resolveRequestSchema(request);
    const useRegisteredSchema = request.metadata?.outputSchemaPath === undefined;
    const maxRetries = Math.max(0, this.options.codexJsonRetries ?? 1);
    const repairEnabled = this.options.codexJsonRepair ?? useRegisteredSchema;
    const repairRetries = Math.max(0, this.options.codexJsonRepairRetries ?? 1);
    const codexVersion = await this.codexVersion();
    const attempts: FailureAttempt[] = [];
    const repairAttempts: FailureAttempt[] = [];
    let lastError: unknown;

    for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
      try {
        const finishReason = attemptIndex === 0 ? 'completed' : 'retry_succeeded';
        const identity = this.nextCallIdentity(`${request.promptId}_attempt_${attemptIndex + 1}`);
        const result = await execCodexJsonPrompt({
          ...this.boundaryInput(),
          runId: identity.childRunId,
          parentPromptCallId: identity.parentPromptCallId,
          parentPromptId: request.promptId,
          parentStage: inferCodexPromptStage(request.promptId).stage,
          ...(this.options.telemetry?.runId === undefined ? {} : { parentRunId: this.options.telemetry.runId }),
          promptText: this.renderBoundaryPrompt(request, attemptIndex),
          schemaPath: outputSchema.schemaPath
        });
        await this.recordProviderProvenance(request, result, {
          promptCallId: identity.parentPromptCallId,
          startedAt,
          codexVersion,
          jsonParsed: true,
          schemaValid: true,
          outputSchemaPath: outputSchema.schemaPath,
          schemaName: outputSchema.schemaName,
          retryCount: attemptIndex,
          finishReason
        });
        return this.toJsonResult(result, outputSchema, finishReason);
      } catch (error) {
        lastError = error;
        attempts.push(this.failureAttempt(attemptIndex + 1, error));
      }
    }

    if (repairEnabled && isRepairableJsonError(lastError)) {
      for (let repairIndex = 0; repairIndex < repairRetries; repairIndex += 1) {
        try {
          const identity = this.nextCallIdentity(`${request.promptId}_repair_${repairIndex + 1}`);
          const result = await execCodexJsonPrompt({
            ...this.boundaryInput(),
            runId: identity.childRunId,
            parentPromptCallId: identity.parentPromptCallId,
            parentPromptId: request.promptId,
            parentStage: inferCodexPromptStage(request.promptId).stage,
            ...(this.options.telemetry?.runId === undefined ? {} : { parentRunId: this.options.telemetry.runId }),
            promptText: this.renderRepairPrompt(request, lastError),
            schemaPath: outputSchema.schemaPath
          });
          await this.recordProviderProvenance(request, result, {
            promptCallId: identity.parentPromptCallId,
            startedAt,
            codexVersion,
            jsonParsed: true,
            schemaValid: true,
            outputSchemaPath: outputSchema.schemaPath,
            schemaName: outputSchema.schemaName,
            retryCount: 0,
            finishReason: 'repaired'
          });
          return this.toJsonResult(result, outputSchema, 'repaired');
        } catch (error) {
          lastError = error;
          repairAttempts.push(this.failureAttempt(repairIndex + 1, error));
        }
      }
    }

    const finalErrorType: CodexErrorType = repairAttempts.length > 0 ? 'CODEX_REPAIR_FAILED' : classifyCodexError(lastError);
    await this.writeFailureReport(request, outputSchema.schemaPath, finalErrorType, lastError, attempts, repairAttempts);
    throw providerErrorFromFailure(lastError, finalErrorType, useRegisteredSchema);
  }

  private resolveRequestSchema(request: ProviderJsonRequest): { schemaPath: string; schemaName: string } {
    const metadataSchemaPath = request.metadata?.outputSchemaPath;
    if (typeof metadataSchemaPath === 'string' && metadataSchemaPath.length > 0) {
      return {
        schemaPath: metadataSchemaPath,
        schemaName: typeof request.metadata?.schemaName === 'string' ? request.metadata.schemaName : 'CodexOutputSchema'
      };
    }
    const schema = resolveCodexOutputSchema(request.promptId);
    if (schema === undefined) {
      throw new ProviderError('OUTPUT_SCHEMA_NOT_FOUND', `No Codex output schema is registered for promptId: ${request.promptId}`, false);
    }
    return schema;
  }

  private async recordProviderProvenance(
    request: LLMRequest,
    result: CodexExecResult | CodexExecJsonResult,
    metadata: {
      promptCallId: string;
      startedAt: string;
      codexVersion: string;
      jsonParsed: boolean;
      schemaValid: boolean;
      outputSchemaPath?: string;
      schemaName?: string;
      retryCount?: number;
      finishReason?: string;
    }
  ): Promise<void> {
    if (this.options.telemetry === undefined) return;
    const { paths, runId } = this.options.telemetry;
    if (!(await this.fileStore.exists(paths.runManifest(runId)))) return;
    const runLogger = new RunLogger(paths, this.fileStore);
    const finalText = result.text;
    const call: LLMCallRecord = {
      promptCallId: metadata.promptCallId,
      promptId: request.promptId,
      provider: 'codex-text',
      model: 'codex-cli',
      transport: 'cli',
      codexVersion: metadata.codexVersion,
      codexProfile: this.codexProfile(),
      sandbox: 'read-only',
      ...(metadata.outputSchemaPath === undefined ? {} : { outputSchemaPath: metadata.outputSchemaPath }),
      rawOutputPath: result.rawOutputPath,
      finalOutputPath: result.finalOutputPath,
      ...('parsedJsonPath' in result ? { parsedOutputPath: result.parsedJsonPath } : {}),
      requestId: result.runId,
      finishReason: metadata.finishReason ?? 'completed',
      status: 'succeeded',
      startedAt: metadata.startedAt,
      endedAt: new Date().toISOString(),
      latencyMs: result.latencyMs,
      promptInputBytes: byteLength(`${request.system}\n${request.user}`),
      contextBytes: byteLength(request.user),
      schemaBytes: metadata.outputSchemaPath === undefined ? 0 : await this.safeProjectOrWorkspaceFileBytes(paths, metadata.outputSchemaPath),
      outputBytes: byteLength(finalText),
      rawJsonlBytes: await this.safeProjectArtifactBytes(paths, result.rawOutputPath),
      inputHash: sha256(`${request.system}\n${request.user}`),
      outputHash: sha256(finalText),
      redacted: true,
      redactionReason: 'Codex raw output is redacted before persistence',
      jsonParsed: metadata.jsonParsed,
      schemaValid: metadata.schemaValid,
      ...(metadata.schemaName === undefined ? {} : { schemaName: metadata.schemaName }),
      retryCount: metadata.retryCount ?? 0
    };
    await runLogger.recordLlmCall(runId, call);
    await runLogger.recordArtifact(runId, result.rawOutputPath, {
      action: 'generated',
      stage: 'codex',
      provenanceNote: `codex-text raw output for ${request.promptId}`
    });
    await runLogger.recordArtifact(runId, result.finalOutputPath, {
      action: 'generated',
      stage: 'codex',
      derivedFrom: [result.rawOutputPath],
      provenanceNote: `codex-text final output for ${request.promptId}`
    });
    if ('parsedJsonPath' in result) {
      await runLogger.recordArtifact(runId, result.parsedJsonPath, {
        action: 'generated',
        stage: 'codex',
        derivedFrom: [result.finalOutputPath],
        provenanceNote: `codex-text parsed JSON output for ${request.promptId}`
      });
    }
  }

  private renderBoundaryPrompt(request: LLMRequest, attemptIndex = 0): string {
    return [
      `PROMPT_ID: ${request.promptId}`,
      'PROVIDER: codex-text',
      `CODEX_PROFILE: ${this.codexProfile()}`,
      attemptIndex > 0 ? 'RETRY_MODE: shorter prompt; return only final output.' : 'RETRY_MODE: initial',
      'SAFETY: read-only sandbox; do not modify files; do not run shell commands; do not commit Story State.',
      `<system>\n${request.system}\n</system>`,
      `<user>\n${request.user}\n</user>`
    ].join('\n\n');
  }

  private renderRepairPrompt(request: LLMRequest, error: unknown): string {
    return [
      `PROMPT_ID: ${request.promptId}`,
      'REPAIR_JSON_ONLY: true',
      'PROVIDER: codex-text',
      `CODEX_PROFILE: ${this.codexProfile()}`,
      'Return only corrected JSON matching the output schema.',
      'Do not add new plot content. Do not change semantic meaning.',
      `<target_prompt_id>${request.promptId}</target_prompt_id>`,
      `<error_message>${getErrorMessage(error)}</error_message>`,
      `<original_user_prompt>\n${request.user}\n</original_user_prompt>`
    ].join('\n\n');
  }

  private boundaryInput() {
    return {
      ...(this.options.codexBin === undefined ? process.env.NLE_CODEX_BIN === undefined ? {} : { codexBin: process.env.NLE_CODEX_BIN } : { codexBin: this.options.codexBin }),
      projectsRoot: this.options.projectsRoot ?? this.options.telemetry?.paths.projectsRoot ?? './projects',
      projectId: this.options.projectId ?? this.options.telemetry?.paths.projectId ?? 'codex-boundary',
      codexProfile: this.codexProfile(),
      ...(this.options.codexTimeoutMs === undefined ? {} : { timeoutMs: this.options.codexTimeoutMs })
    };
  }

  private codexProfile(): CodexProfile {
    return this.options.codexProfile ?? 'default';
  }

  private nextCallIdentity(promptId: string): { parentPromptCallId: string; childRunId: string } {
    this.callIndex += 1;
    const safePromptId = promptId.replace(/[^a-zA-Z0-9]+/g, '_');
    const sequence = String(this.callIndex).padStart(3, '0');
    const parent = this.options.telemetry?.runId ?? 'run_codex_text_provider';
    return {
      parentPromptCallId: `prompt_${sequence}_${safePromptId}`,
      childRunId: `${parent}_codex_${sequence}_${safePromptId}`
    };
  }

  private async codexVersion(): Promise<string> {
    try {
      const status = await checkCodexStatus(this.boundaryInput());
      return status.version || 'codex-cli';
    } catch {
      return 'codex-cli';
    }
  }

  private toJsonResult(
    result: CodexExecJsonResult,
    outputSchema: { schemaPath: string; schemaName: string },
    finishReason: string
  ): LLMJsonResult {
    return {
      ok: true,
      provider: 'codex-text',
      model: 'codex-cli',
      text: result.text,
      parsed: result.parsedJson,
      jsonParsed: true,
      schemaValid: true,
      schemaName: outputSchema.schemaName,
      rawResponseRedacted: result.rawResponseRedacted,
      latencyMs: result.latencyMs,
      requestId: result.runId,
      finishReason
    };
  }

  private failureAttempt(attemptNumber: number, error: unknown): FailureAttempt {
    return {
      attemptNumber,
      errorType: classifyCodexError(error),
      message: redactFailureMessage(getErrorMessage(error))
    };
  }

  private async safeProjectArtifactBytes(paths: ProjectPaths, relativePath: string): Promise<number> {
    try {
      return byteLength(await this.fileStore.readText(paths.projectArtifact(relativePath)));
    } catch {
      return 0;
    }
  }

  private async safeProjectOrWorkspaceFileBytes(paths: ProjectPaths, filePath: string): Promise<number> {
    try {
      const absolutePath = filePath.startsWith(paths.projectRoot) ? filePath : filePath.startsWith('/') ? filePath : paths.projectArtifact(filePath);
      return byteLength(await this.fileStore.readText(absolutePath));
    } catch {
      return 0;
    }
  }

  private async writeFailureReport(
    request: LLMRequest,
    outputSchemaPath: string,
    errorType: CodexErrorType,
    error: unknown,
    attempts: FailureAttempt[],
    repairAttempts: FailureAttempt[]
  ): Promise<void> {
    const paths = this.options.telemetry?.paths;
    if (paths === undefined) return;
    const runId = this.options.telemetry?.runId ?? 'run_codex_text_provider';
    const failureRoot = `codex/failures/${runId}`;
    const failedPromptPath = `${failureRoot}/failed_prompt.md`;
    const errorPath = `${failureRoot}/${errorType === 'CODEX_INVALID_JSON' ? 'parse_error.json' : 'schema_error.json'}`;
    await this.fileStore.writeText(paths.projectArtifact(failedPromptPath), this.renderBoundaryPrompt(request));
    await this.fileStore.writeJson(
      paths.projectArtifact(errorPath),
      {
        errorType,
        message: redactFailureMessage(getErrorMessage(error))
      },
      CodexFailureErrorSchema
    );
    const report = CodexJsonFailureReportSchema.parse({
      reportId: `codex_failure_${runId}`,
      projectId: paths.projectId,
      runId,
      promptId: request.promptId,
      provider: 'codex-text',
      generatedAt: new Date().toISOString(),
      errorType,
      errorMessage: redactFailureMessage(getErrorMessage(error)),
      codexProfile: this.codexProfile(),
      outputSchemaPath,
      failureRoot,
      failedPromptPath,
      ...(errorType === 'CODEX_INVALID_JSON' ? { parseErrorPath: errorPath } : { schemaErrorPath: errorPath }),
      stderrExcerpt: redactFailureMessage(getErrorMessage(error)).slice(0, 4000),
      attempts,
      repairAttempts,
      storyStateMutated: false,
      redacted: true
    });
    await this.fileStore.writeJson(paths.projectArtifact(`${failureRoot}/codex_failure_report.json`), report, CodexJsonFailureReportSchema);
  }
}

interface FailureAttempt {
  attemptNumber: number;
  errorType: CodexErrorType;
  message: string;
}

function providerErrorFromFailure(error: unknown, errorType: CodexErrorType, useRegisteredSchema: boolean): ProviderError {
  if (errorType === 'CODEX_OUTPUT_MISSING') {
    return new ProviderError('CODEX_OUTPUT_MISSING', getErrorMessage(error), true, 'invalid_output');
  }
  if (errorType === 'CODEX_REPAIR_FAILED') return new ProviderError('CODEX_REPAIR_FAILED', getErrorMessage(error));
  if (useRegisteredSchema && errorType === 'CODEX_INVALID_JSON') {
    return new ProviderError('CODEX_INVALID_JSON', getErrorMessage(error), true, 'invalid_output');
  }
  if (useRegisteredSchema && errorType === 'CODEX_SCHEMA_VALIDATION_FAILED') {
    return new ProviderError(
      'CODEX_SCHEMA_VALIDATION_FAILED',
      getErrorMessage(error),
      true,
      'invalid_output'
    );
  }
  return normalizeProviderError(error);
}

function normalizeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof JsonResponseParseError) {
    return new ProviderError('INVALID_JSON', error.message, true, 'invalid_output');
  }
  if (error instanceof AppError) {
    if (error.code === 'CODEX_TIMEOUT') {
      return new ProviderError('CODEX_TIMEOUT', error.message);
    }
    if (error.code === 'CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED') {
      return new ProviderError(
        'SCHEMA_VALIDATION_FAILED',
        error.message,
        true,
        'invalid_output'
      );
    }
    if (error.code === 'CODEX_BINARY_NOT_FOUND') {
      return new ProviderError(
        'CODEX_BINARY_NOT_FOUND',
        error.message,
        true,
        'unavailable'
      );
    }
    if (error.code === 'CODEX_EXEC_FAILED') {
      return new ProviderError(
        'CODEX_EXEC_FAILED',
        error.message,
        true,
        classifyExecFailure(error.message)
      );
    }
    if (error.code === 'CODEX_OUTPUT_MISSING') {
      return new ProviderError(
        'CODEX_OUTPUT_MISSING',
        error.message,
        true,
        'invalid_output'
      );
    }
    return new ProviderError(error.code, error.message);
  }
  return new ProviderError('CODEX_PROVIDER_ERROR', getErrorMessage(error));
}

function classifyExecFailure(message: string): CodexProviderFailureClassification {
  if (/usage limit|rate limit|quota|too many requests|limit reached|\b429\b/i.test(message)) {
    return 'usage_limit';
  }
  if (/not logged in|login required|run\s+codex\s+login|please (?:sign|log) in|authentication required|unauthorized|invalid (?:auth|credential)/i.test(message)) {
    return 'login_required';
  }
  return 'unavailable';
}

function isRepairableJsonError(error: unknown): boolean {
  const classified = classifyCodexError(error);
  return classified === 'CODEX_INVALID_JSON' || classified === 'CODEX_SCHEMA_VALIDATION_FAILED';
}

function classifyCodexError(error: unknown): CodexErrorType {
  if (error instanceof JsonResponseParseError) return 'CODEX_INVALID_JSON';
  if (error instanceof AppError) {
    if (error.code === 'CODEX_BINARY_NOT_FOUND') return 'CODEX_BINARY_MISSING';
    if (error.code === 'CODEX_TIMEOUT') return 'CODEX_TIMEOUT';
    if (error.code === 'CODEX_OUTPUT_MISSING') return 'CODEX_OUTPUT_MISSING';
    if (error.code === 'CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED') return 'CODEX_SCHEMA_VALIDATION_FAILED';
    if (error.code === 'CODEX_EXEC_FAILED') {
      if (/timed out|timeout/i.test(error.message)) return 'CODEX_TIMEOUT';
      if (/codex_core_plugins::manifest|interface\.defaultPrompt/i.test(error.message)) return 'CODEX_PLUGIN_WARNING';
      if (/codex_core_skills::loader|skill/i.test(error.message)) return 'CODEX_SKILL_MANIFEST_WARNING';
      return 'CODEX_EXEC_FAILED';
    }
  }
  if (/json|parse/i.test(getErrorMessage(error))) return 'CODEX_INVALID_JSON';
  return 'CODEX_UNKNOWN_ERROR';
}

function redactFailureMessage(message: string): string {
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/["']?[^"'\s,]*auth\.json["']?/g, '"[REDACTED_AUTH_FILE]"');
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
