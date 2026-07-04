import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { ProviderFactory } from '../../../src/llm/ProviderFactory.js';
import { RealLLMClient, RealProviderError } from '../../../src/llm/RealLLMClient.js';
import { loadRealProviderConfig } from '../../../src/llm/RealProviderConfig.js';
import { RunLogger } from '../../../src/logging/RunLogger.js';
import { RunManifestSchema } from '../../../src/schemas/index.js';
import { FileStore } from '../../../src/storage/FileStore.js';
import { ProjectPaths } from '../../../src/storage/ProjectPaths.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-real-provider-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('real provider configuration', () => {
  test('loads API key, model, endpoint, timeout, retry, and cost settings from .env without exposing the key', async () => {
    const envPath = path.join(tempRoot, '.env');
    await writeFile(
      envPath,
      [
        'NLE_REAL_API_KEY=secret-env-key',
        'NLE_REAL_MODEL=test-model',
        'NLE_REAL_BASE_URL=https://llm.example/v1',
        'NLE_REAL_TIMEOUT_MS=1234',
        'NLE_REAL_MAX_RETRIES=4',
        'NLE_REAL_RETRY_BASE_MS=25',
        'NLE_REAL_INPUT_COST_PER_1M=2',
        'NLE_REAL_OUTPUT_COST_PER_1M=6'
      ].join('\n'),
      'utf8'
    );

    const config = await loadRealProviderConfig({ envPath, env: {} });

    expect(config).toMatchObject({
      model: 'test-model',
      baseUrl: 'https://llm.example/v1',
      timeoutMs: 1234,
      maxRetries: 4,
      retryBaseMs: 25,
      inputCostPer1M: 2,
      outputCostPer1M: 6
    });
    expect(config.apiKey).toBe('secret-env-key');
    expect(JSON.stringify(config.toLogSafeJSON())).not.toContain('secret-env-key');
  });
});

describe('RealLLMClient', () => {
  test('retries retryable failures, repairs simple JSON, and maps provider usage to response metadata', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      if (calls.length === 1) {
        return jsonResponse(429, { error: { message: 'rate limited' } });
      }

      return jsonResponse(200, {
        model: 'real-test-model',
        choices: [
          {
            message: {
              content: 'Here is JSON:\n{"ok":true,}'
            }
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15
        }
      });
    };
    const client = new RealLLMClient({
      config: {
        apiKey: 'secret-api-key',
        model: 'real-test-model',
        baseUrl: 'https://llm.example/v1',
        timeoutMs: 5000,
        maxRetries: 1,
        retryBaseMs: 1,
        inputCostPer1M: 2,
        outputCostPer1M: 6
      },
      fetchImpl,
      sleep: async () => {}
    });

    const response = await client.complete({
      promptId: 'diagnostics.diagnose_chapter',
      system: 'system',
      user: 'user',
      responseFormat: 'json'
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://llm.example/v1/chat/completions');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer secret-api-key');
    expect(response.model).toBe('real-test-model');
    expect(response.json).toEqual({ ok: true });
    expect(response.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15
    });
    expect(response.usage?.costUsd).toBeCloseTo((10 * 2 + 5 * 6) / 1_000_000);
  });

  test('classifies provider errors and redacts API keys from messages', async () => {
    const client = new RealLLMClient({
      config: {
        apiKey: 'secret-api-key',
        model: 'real-test-model',
        baseUrl: 'https://llm.example/v1',
        timeoutMs: 5000,
        maxRetries: 0,
        retryBaseMs: 1
      },
      fetchImpl: async () => jsonResponse(401, { error: { message: 'bad secret-api-key' } }),
      sleep: async () => {}
    });

    await expect(
      client.complete({
        promptId: 'strategy.build_story_bible',
        system: 'system',
        user: 'user',
        responseFormat: 'markdown'
      })
    ).rejects.toMatchObject({
      errorType: 'auth'
    });
    await client
      .complete({
        promptId: 'strategy.build_story_bible',
        system: 'system',
        user: 'user',
        responseFormat: 'markdown'
      })
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(RealProviderError);
        expect(String(error)).not.toContain('secret-api-key');
      });
  });
});

describe('ProviderFactory real provider telemetry', () => {
  test('creates a real provider and records usage metadata in the run manifest without API keys', async () => {
    const envPath = path.join(tempRoot, '.env');
    await writeFile(envPath, 'NLE_REAL_API_KEY=secret-env-key\nNLE_REAL_MODEL=real-test-model\nNLE_REAL_BASE_URL=https://llm.example/v1\n', 'utf8');
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();
    const runLogger = new RunLogger(paths, store);
    await runLogger.startRun({
      runId: 'run_real_provider_test',
      command: 'unit-test',
      args: {}
    });

    const client = ProviderFactory.create({
      provider: 'real',
      envPath,
      fetchImpl: async () =>
        jsonResponse(200, {
          model: 'real-test-model',
          choices: [
            {
              message: {
                content: '# Story Bible'
              }
            }
          ],
          usage: {
            prompt_tokens: 7,
            completion_tokens: 3,
            total_tokens: 10
          }
        }),
      sleep: async () => {},
      telemetry: {
        paths,
        runId: 'run_real_provider_test',
        fileStore: store
      }
    });

    await client.complete({
      promptId: 'strategy.build_story_bible',
      system: 'system',
      user: 'user',
      responseFormat: 'markdown'
    });

    const manifest = await store.readJson(paths.runManifest('run_real_provider_test'), RunManifestSchema);
    expect(manifest.llmCalls).toHaveLength(1);
    expect(manifest.llmCalls[0]).toMatchObject({
      promptId: 'strategy.build_story_bible',
      provider: 'real',
      model: 'real-test-model',
      status: 'succeeded',
      usage: {
        inputTokens: 7,
        outputTokens: 3,
        totalTokens: 10
      }
    });
    expect(JSON.stringify(manifest)).not.toContain('secret-env-key');
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}
