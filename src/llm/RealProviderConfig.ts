import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { AppError } from '../utils/AppError.js';

export interface LoadRealProviderConfigOptions {
  envPath?: string;
  env?: Record<string, string | undefined>;
}

export interface RealProviderConfigInput {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
}

export class RealProviderConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryBaseMs: number;
  readonly inputCostPer1M: number | undefined;
  readonly outputCostPer1M: number | undefined;

  constructor(input: RealProviderConfigInput) {
    this.apiKey = input.apiKey;
    this.model = input.model;
    this.baseUrl = input.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = input.timeoutMs;
    this.maxRetries = input.maxRetries;
    this.retryBaseMs = input.retryBaseMs;
    this.inputCostPer1M = input.inputCostPer1M;
    this.outputCostPer1M = input.outputCostPer1M;
  }

  toLogSafeJSON(): Record<string, unknown> {
    return {
      apiKey: '[redacted]',
      model: this.model,
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      retryBaseMs: this.retryBaseMs,
      inputCostPer1M: this.inputCostPer1M,
      outputCostPer1M: this.outputCostPer1M
    };
  }
}

export function loadRealProviderConfig(options: LoadRealProviderConfigOptions = {}): RealProviderConfig {
  const dotenvValues = readDotenv(options.envPath ?? path.resolve('.env'));
  const mergedEnv = {
    ...dotenvValues,
    ...(options.env ?? process.env)
  };
  const apiKey = mergedEnv.NLE_REAL_API_KEY ?? mergedEnv.OPENAI_API_KEY;
  const model = mergedEnv.NLE_REAL_MODEL ?? mergedEnv.OPENAI_MODEL;

  if (apiKey === undefined || apiKey.length === 0) {
    throw new AppError('REAL_PROVIDER_API_KEY_MISSING', 'Real provider API key is missing. Set NLE_REAL_API_KEY or OPENAI_API_KEY.', 2);
  }
  if (model === undefined || model.length === 0) {
    throw new AppError('REAL_PROVIDER_MODEL_MISSING', 'Real provider model is missing. Set NLE_REAL_MODEL or OPENAI_MODEL.', 2);
  }

  const configInput: RealProviderConfigInput = {
    apiKey,
    model,
    baseUrl: mergedEnv.NLE_REAL_BASE_URL ?? mergedEnv.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    timeoutMs: parsePositiveInteger(mergedEnv.NLE_REAL_TIMEOUT_MS, 60_000),
    maxRetries: parseNonNegativeInteger(mergedEnv.NLE_REAL_MAX_RETRIES, 2),
    retryBaseMs: parsePositiveInteger(mergedEnv.NLE_REAL_RETRY_BASE_MS, 500)
  };
  const inputCostPer1M = parseOptionalNumber(mergedEnv.NLE_REAL_INPUT_COST_PER_1M);
  const outputCostPer1M = parseOptionalNumber(mergedEnv.NLE_REAL_OUTPUT_COST_PER_1M);

  if (inputCostPer1M !== undefined) {
    configInput.inputCostPer1M = inputCostPer1M;
  }
  if (outputCostPer1M !== undefined) {
    configInput.outputCostPer1M = outputCostPer1M;
  }

  return new RealProviderConfig(configInput);
}

function readDotenv(envPath: string): Record<string, string> {
  const resolvedPath = path.resolve(envPath);
  if (!existsSync(resolvedPath)) {
    return {};
  }

  const content = readFileSync(resolvedPath, 'utf8');
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const rawValue = line.slice(equalsIndex + 1).trim();
    values[key] = stripQuotes(rawValue);
  }

  return values;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
