import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MockLLMClient } from '../../../src/llm/MockLLMClient.js';
import { PromptService } from '../../../src/prompts/PromptService.js';
import { resolveBundledAssetPath } from '../../../src/runtime/packageAssets.js';

const repoRoot = process.cwd();
let tempRoot: string | undefined;

afterEach(async () => {
  process.chdir(repoRoot);
  if (tempRoot !== undefined) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe.sequential('package asset resolution', () => {
  it('falls back to bundled prompts when default cwd prompts are missing', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-assets-'));
    process.chdir(tempRoot);

    const resolvedRoot = resolveBundledAssetPath('./prompts', 'prompts');
    const service = new PromptService('./prompts');

    expect(resolvedRoot).toBe(path.join(repoRoot, 'prompts'));
    expect(service.resolvePromptPath('strategy.build_story_bible')).toBe(
      path.join(repoRoot, 'prompts', 'strategy', 'build_story_bible.md')
    );
  });

  it('falls back to bundled mock fixtures when default cwd fixtures are missing', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-assets-'));
    process.chdir(tempRoot);

    const client = new MockLLMClient({ fixturesRoot: './fixtures/llm' });
    const response = await client.complete({
      promptId: 'strategy.build_story_bible',
      system: '',
      user: '',
      responseFormat: 'markdown'
    });

    expect(response.model).toBe('mock');
    expect(response.text).toContain('# Story Bible');
  });
});

