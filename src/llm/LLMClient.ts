export type LLMResponseFormat = 'markdown' | 'json';

export interface LLMRequest {
  promptId: string;
  system: string;
  user: string;
  responseFormat: LLMResponseFormat;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface LLMResponse {
  text: string;
  json?: unknown;
  model?: string;
  usage?: LLMUsage;
  raw?: unknown;
}

export interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}
