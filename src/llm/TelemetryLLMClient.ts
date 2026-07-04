import { RunLogger } from '../logging/RunLogger.js';
import type { LLMCallRecord } from '../schemas/index.js';
import type { FileStore } from '../storage/FileStore.js';
import type { ProjectPaths } from '../storage/ProjectPaths.js';
import type { LLMClient, LLMRequest, LLMResponse } from './LLMClient.js';
import { RealProviderError } from './RealLLMClient.js';

export interface LLMClientTelemetryOptions {
  paths: ProjectPaths;
  runId: string;
  provider: string;
  fileStore?: FileStore;
}

export class TelemetryLLMClient implements LLMClient {
  private readonly runLogger: RunLogger;

  constructor(
    private readonly inner: LLMClient,
    private readonly options: LLMClientTelemetryOptions
  ) {
    this.runLogger = new RunLogger(options.paths, options.fileStore);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();

    try {
      const response = await this.inner.complete(request);
      await this.recordCall({
        promptId: request.promptId,
        provider: this.options.provider,
        model: response.model ?? 'unknown',
        ...(typeof request.metadata?.fixtureScenario === 'string' ? { mockScenario: request.metadata.fixtureScenario } : {}),
        status: 'succeeded',
        startedAt,
        endedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAtDate.getTime(),
        redacted: false,
        jsonParsed: response.json !== undefined,
        retryCount: 0,
        ...(response.usage === undefined ? {} : { usage: response.usage })
      });

      return response;
    } catch (error) {
      await this.recordCall({
        promptId: request.promptId,
        provider: this.options.provider,
        model: 'unknown',
        ...(typeof request.metadata?.fixtureScenario === 'string' ? { mockScenario: request.metadata.fixtureScenario } : {}),
        status: 'failed',
        startedAt,
        endedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAtDate.getTime(),
        redacted: false,
        jsonParsed: false,
        retryCount: 0,
        errorType: getErrorType(error)
      });
      throw error;
    }
  }

  private async recordCall(call: LLMCallRecord): Promise<void> {
    try {
      await this.runLogger.recordLlmCall(this.options.runId, call);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return;
      }

      throw error;
    }
  }
}

function getErrorType(error: unknown): string {
  if (error instanceof RealProviderError) {
    return error.errorType;
  }
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return 'unknown';
}
