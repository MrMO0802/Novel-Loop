import { JsonResponseParser } from './JsonResponseParser.js';
import type { LLMClient, LLMRequest, LLMResponse, LLMUsage } from './LLMClient.js';
import { RealProviderConfig } from './RealProviderConfig.js';

export type ProviderErrorType = 'auth' | 'rate_limit' | 'timeout' | 'network' | 'server' | 'invalid_json' | 'provider_response' | 'unknown';

export interface RealLLMClientOptions {
  config: RealProviderConfig | ConstructorParameters<typeof RealProviderConfig>[0];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  parser?: JsonResponseParser;
}

export class RealProviderError extends Error {
  readonly errorType: ProviderErrorType;
  readonly statusCode: number | undefined;
  readonly retryable: boolean;

  constructor(input: { errorType: ProviderErrorType; message: string; statusCode?: number; retryable?: boolean }) {
    super(input.message);
    this.name = 'RealProviderError';
    this.errorType = input.errorType;
    this.statusCode = input.statusCode;
    this.retryable = input.retryable ?? false;
  }
}

export class RealLLMClient implements LLMClient {
  private readonly config: RealProviderConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly parser: JsonResponseParser;

  constructor(options: RealLLMClientOptions) {
    this.config = options.config instanceof RealProviderConfig ? options.config : new RealProviderConfig(options.config);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.parser = options.parser ?? new JsonResponseParser();
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    let attempt = 0;

    while (true) {
      try {
        return await this.completeOnce(request);
      } catch (error) {
        const providerError = this.toProviderError(error);
        if (!providerError.retryable || attempt >= this.config.maxRetries) {
          throw providerError;
        }

        await this.sleep(this.config.retryBaseMs * 2 ** attempt);
        attempt += 1;
      }
    }
  }

  private async completeOnce(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: request.system
          },
          {
            role: 'user',
            content: request.user
          }
        ],
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {})
      })
    });

    const responseJson = await readResponseJson(response);
    if (!response.ok) {
      throw this.errorFromHttpStatus(response.status, getProviderMessage(responseJson));
    }

    const text = extractAssistantText(responseJson);
    const model = extractModel(responseJson) ?? this.config.model;
    const usage = this.extractUsage(responseJson);
    const llmResponse: LLMResponse = {
      text,
      model,
      raw: responseJson
    };

    if (usage !== undefined) {
      llmResponse.usage = usage;
    }
    if (request.responseFormat === 'json') {
      try {
        llmResponse.json = this.parser.parseWithRepair(text);
      } catch (error) {
        throw new RealProviderError({
          errorType: 'invalid_json',
          message: sanitizeMessage(error instanceof Error ? error.message : String(error), this.config.apiKey),
          retryable: false
        });
      }
    }

    return llmResponse;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new RealProviderError({
          errorType: 'timeout',
          message: `Real provider request timed out after ${this.config.timeoutMs}ms.`,
          retryable: true
        });
      }

      throw new RealProviderError({
        errorType: 'network',
        message: sanitizeMessage(error instanceof Error ? error.message : String(error), this.config.apiKey),
        retryable: true
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private errorFromHttpStatus(statusCode: number, providerMessage: string): RealProviderError {
    const errorType = classifyHttpStatus(statusCode);
    return new RealProviderError({
      errorType,
      statusCode,
      message: sanitizeMessage(`Real provider ${statusCode}: ${providerMessage}`, this.config.apiKey),
      retryable: errorType === 'rate_limit' || errorType === 'server'
    });
  }

  private toProviderError(error: unknown): RealProviderError {
    if (error instanceof RealProviderError) {
      return error;
    }

    return new RealProviderError({
      errorType: 'unknown',
      message: sanitizeMessage(error instanceof Error ? error.message : String(error), this.config.apiKey),
      retryable: false
    });
  }

  private extractUsage(responseJson: unknown): LLMUsage | undefined {
    if (!isRecord(responseJson) || !isRecord(responseJson.usage)) {
      return undefined;
    }

    const inputTokens = readNumber(responseJson.usage.prompt_tokens) ?? readNumber(responseJson.usage.input_tokens);
    const outputTokens = readNumber(responseJson.usage.completion_tokens) ?? readNumber(responseJson.usage.output_tokens);
    const totalTokens = readNumber(responseJson.usage.total_tokens);
    const usage: LLMUsage = {};

    if (inputTokens !== undefined) {
      usage.inputTokens = inputTokens;
    }
    if (outputTokens !== undefined) {
      usage.outputTokens = outputTokens;
    }
    if (totalTokens !== undefined) {
      usage.totalTokens = totalTokens;
    }

    const costUsd = estimateCostUsd(inputTokens, outputTokens, this.config.inputCostPer1M, this.config.outputCostPer1M);
    if (costUsd !== undefined) {
      usage.costUsd = costUsd;
    }

    return Object.keys(usage).length === 0 ? undefined : usage;
  }
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      return JSON.parse(await response.text());
    } catch {
      return {};
    }
  }
}

function extractAssistantText(responseJson: unknown): string {
  if (!isRecord(responseJson) || !Array.isArray(responseJson.choices)) {
    throw new RealProviderError({
      errorType: 'provider_response',
      message: 'Real provider response did not include choices.',
      retryable: false
    });
  }

  const choice = responseJson.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string') {
    throw new RealProviderError({
      errorType: 'provider_response',
      message: 'Real provider response did not include message content.',
      retryable: false
    });
  }

  return choice.message.content;
}

function extractModel(responseJson: unknown): string | undefined {
  return isRecord(responseJson) && typeof responseJson.model === 'string' ? responseJson.model : undefined;
}

function getProviderMessage(responseJson: unknown): string {
  if (isRecord(responseJson) && isRecord(responseJson.error) && typeof responseJson.error.message === 'string') {
    return responseJson.error.message;
  }

  return 'request failed';
}

function classifyHttpStatus(statusCode: number): ProviderErrorType {
  if (statusCode === 401 || statusCode === 403) {
    return 'auth';
  }
  if (statusCode === 429) {
    return 'rate_limit';
  }
  if (statusCode >= 500) {
    return 'server';
  }
  if (statusCode >= 400) {
    return 'provider_response';
  }

  return 'unknown';
}

function estimateCostUsd(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  inputCostPer1M: number | undefined,
  outputCostPer1M: number | undefined
): number | undefined {
  if (inputTokens === undefined || outputTokens === undefined || inputCostPer1M === undefined || outputCostPer1M === undefined) {
    return undefined;
  }

  return (inputTokens * inputCostPer1M + outputTokens * outputCostPer1M) / 1_000_000;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function sanitizeMessage(message: string, apiKey: string): string {
  return message.split(apiKey).join('[redacted]');
}
