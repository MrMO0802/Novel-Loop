import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { JsonResponseParser } from '../../../src/llm/JsonResponseParser.js';
import { MockLLMClient } from '../../../src/llm/MockLLMClient.js';
import { ProviderFactory } from '../../../src/llm/ProviderFactory.js';
import type { LLMClient, LLMRequest } from '../../../src/llm/LLMClient.js';

const fixturesRoot = path.resolve('tests/fixtures/llm');

const jsonRequest: LLMRequest = {
  promptId: 'diagnostics.diagnose_chapter',
  system: 'system',
  user: 'user',
  responseFormat: 'json'
};

describe('JsonResponseParser', () => {
  test('parses pure JSON', () => {
    const parser = new JsonResponseParser();

    expect(parser.parse('{"ok":true}')).toEqual({ ok: true });
  });

  test('parses fenced JSON', () => {
    const parser = new JsonResponseParser();

    expect(parser.parse('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  test('throws a clear error for invalid JSON', () => {
    const parser = new JsonResponseParser();

    expect(() => parser.parse('{"ok":')).toThrow('Invalid JSON response');
  });
});

describe('MockLLMClient', () => {
  test('implements the LLMClient interface and returns scenario fixtures by promptId', async () => {
    const client: LLMClient = new MockLLMClient({ fixturesRoot, scenario: 'pass' });

    const response = await client.complete(jsonRequest);

    expect(response.model).toBe('mock');
    expect(response.json).toMatchObject({
      chapterNumber: 1,
      hardFailures: []
    });
  });

  test('can select diagnostics failure fixtures', async () => {
    const client = new MockLLMClient({ fixturesRoot, scenario: 'fail' });

    const response = await client.complete(jsonRequest);

    expect(response.json).toMatchObject({
      hardFailures: [
        {
          code: 'FORBIDDEN_REVEAL'
        }
      ]
    });
  });

  test('surfaces invalid JSON fixture errors', async () => {
    const client = new MockLLMClient({ fixturesRoot, scenario: 'invalid-json' });

    await expect(client.complete(jsonRequest)).rejects.toThrow('Invalid JSON response');
  });

  test('returns markdown fixtures without parsing JSON', async () => {
    const client = new MockLLMClient({ fixturesRoot });

    const response = await client.complete({
      promptId: 'production.write_scene',
      system: 'system',
      user: 'user',
      responseFormat: 'markdown'
    });

    expect(response.text).toContain('旧收音机');
    expect(response.json).toBeUndefined();
  });
});

describe('ProviderFactory', () => {
  test('creates a mock provider without API keys', async () => {
    const client = ProviderFactory.create({
      provider: 'mock',
      fixturesRoot,
      scenario: 'pass'
    });

    const response = await client.complete(jsonRequest);

    expect(response.json).toMatchObject({ chapterNumber: 1 });
  });

  test('real providers require API key configuration', () => {
    expect(() => ProviderFactory.create({ provider: 'openai', envPath: path.join(fixturesRoot, 'missing.env') })).toThrow(
      'Real provider API key is missing'
    );
  });
});
