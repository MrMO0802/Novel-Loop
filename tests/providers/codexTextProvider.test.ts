import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { CodexTextProvider, ProviderError } from '../../src/providers/codexTextProvider.js';
import { inspectProvider, listProviders } from '../../src/providers/providerRegistry.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m22-provider-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('CodexTextProvider', () => {
  test.each([
    ['upgrade-required', 'upgrade_required'],
    ['jsonl-usage-limit', 'usage_limit'],
    ['jsonl-login-required', 'login_required']
  ] as const)('classifies redacted JSONL-only execution errors: %s', async (mode, classification) => {
    const fake = await writeFakeCodex(tempRoot, mode);
    const provider = createProvider(fake.codexBin);
    const error: unknown = await provider.generateText({
      promptId: 'strategy.build_story_bible', system: 'system', user: 'user', responseFormat: 'markdown'
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'CODEX_EXEC_FAILED', classification });
    expect(String(error)).not.toMatch(/sk-SECRET|secret123|auth\.json/);
  });

  test('does not retry JSON generation when Codex must be upgraded', async () => {
    const fake = await writeFakeCodex(tempRoot, 'upgrade-required');
    const provider = createProvider(fake.codexBin);
    const schemaPath = path.join(tempRoot, 'output.schema.json');
    await writeFile(schemaPath, JSON.stringify({ type: 'object', properties: {}, additionalProperties: false }));
    await expect(provider.generateJson({
      promptId: 'provider.test_json', system: 'system', user: 'user', responseFormat: 'json',
      metadata: { outputSchemaPath: schemaPath }
    })).rejects.toMatchObject({ classification: 'upgrade_required', recoverable: false });
    const commands = (await readFile(fake.argsLogPath, 'utf8')).split('\n');
    expect(commands.filter((command) => /\bexec\b/.test(command))).toHaveLength(1);
  });
  test('appears in provider registry with read-only CLI capabilities', async () => {
    const providers = listProviders();
    const codex = providers.find((provider) => provider.providerId === 'codex-text');

    expect(codex).toBeDefined();
    expect(codex?.releaseStatus).toBe('pilot-rc');
    expect(codex?.capabilities).toMatchObject({
      supportsText: true,
      supportsJsonMode: true,
      supportsOutputSchema: true,
      supportsStreamingEvents: true,
      supportsWorkspaceRead: true,
      supportsWorkspaceWrite: false,
      transport: 'cli',
      defaultSandbox: 'read-only',
      allowCommitByDefault: false
    });
  });

  test('inspect distinguishes doctor unhealthy from executable smoke/json health', async () => {
    const fake = await writeFakeCodex(tempRoot, 'doctor-unhealthy');

    const detail = await inspectProvider('codex-text', { codexBin: fake.codexBin, projectsRoot: tempRoot, projectId: 'demo-novel' });

    expect(detail.providerId).toBe('codex-text');
    expect(detail.health).toMatchObject({
      binaryAvailable: true,
      loginAvailable: true,
      doctorHealthy: false,
      execSmokeOk: true,
      execJsonOk: true,
      available: true
    });
    expect(detail.capabilities.supportsOutputSchema).toBe(true);
    expect(detail.capabilities.defaultSandbox).toBe('read-only');
  });

  test('generateText returns a normalized LLMTextResult and redacted raw response', async () => {
    const fake = await writeFakeCodex(tempRoot);
    const provider = createProvider(fake.codexBin);

    const result = await provider.generateText({
      promptId: 'strategy.build_story_bible',
      system: 'system',
      user: 'user',
      responseFormat: 'markdown'
    });

    expect(result).toMatchObject({
      ok: true,
      provider: 'codex-text',
      model: 'codex-cli',
      finishReason: 'completed'
    });
    expect(result.text).toContain('Codex Story Bible');
    expect(result.rawResponseRedacted).not.toContain('sk-SECRET');
    expect(result.rawResponseRedacted).not.toContain('auth.json');
  });

  test('generateJson returns parsed schema-valid JSON output', async () => {
    const fake = await writeFakeCodex(tempRoot);
    const provider = createProvider(fake.codexBin);
    const schemaPath = path.join(tempRoot, 'provider-test.schema.json');
    await writeFile(
      schemaPath,
      JSON.stringify({
        type: 'object',
        required: ['title', 'ok', 'items'],
        properties: {
          title: { type: 'string' },
          ok: { type: 'boolean' },
          items: { type: 'array', items: { type: 'string' } }
        },
        additionalProperties: false
      }),
      'utf8'
    );

    const result = await provider.generateJson({
      promptId: 'provider.test_json',
      system: 'system',
      user: 'user',
      responseFormat: 'json',
      metadata: {
        outputSchemaPath: schemaPath,
        schemaName: 'ProviderTestSchema'
      }
    });

    expect(result.ok).toBe(true);
    expect(result.jsonParsed).toBe(true);
    expect(result.schemaValid).toBe(true);
    expect(result.schemaName).toBe('ProviderTestSchema');
    expect(result.parsed).toEqual({ title: 'Codex JSON', ok: true, items: ['alpha', 'beta'] });
  });

  test('generateJson normalizes malformed JSON and schema failures', async () => {
    const invalidJsonProvider = createProvider((await writeFakeCodex(tempRoot, 'invalid-json')).codexBin);
    const schemaInvalidProvider = createProvider((await writeFakeCodex(tempRoot, 'schema-invalid')).codexBin);
    const schemaPath = path.join(tempRoot, 'strict.schema.json');
    await writeFile(
      schemaPath,
      JSON.stringify({
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string' } },
        additionalProperties: false
      }),
      'utf8'
    );

    await expect(
      invalidJsonProvider.generateJson({
        promptId: 'provider.test_json',
        system: 'system',
        user: 'user',
        responseFormat: 'json',
        metadata: { outputSchemaPath: schemaPath }
      })
    ).rejects.toMatchObject({ code: 'INVALID_JSON' });

    await expect(
      schemaInvalidProvider.generateJson({
        promptId: 'provider.test_json',
        system: 'system',
        user: 'user',
        responseFormat: 'json',
        metadata: { outputSchemaPath: schemaPath }
      })
    ).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_FAILED' });
  });

  test('ProviderError is an Error with a stable code', () => {
    expect(new ProviderError('X', 'x')).toBeInstanceOf(Error);
    expect(new ProviderError('X', 'x')).toMatchObject({ code: 'X' });
  });
});

function createProvider(codexBin: string): CodexTextProvider {
  const paths = new ProjectPaths(tempRoot, 'demo-novel');
  return new CodexTextProvider({
    codexBin,
    projectsRoot: tempRoot,
    projectId: 'demo-novel',
    telemetry: {
      paths,
      runId: 'run_codex_text_provider_test',
      fileStore: new FileStore()
    }
  });
}
