import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { PromptService } from '../../../src/prompts/PromptService.js';
import { TemplateRenderer } from '../../../src/prompts/TemplateRenderer.js';

let promptRoot: string;

beforeEach(async () => {
  promptRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-prompts-'));
  await mkdir(path.join(promptRoot, 'strategy'), { recursive: true });
  await writeFile(path.join(promptRoot, 'strategy', 'build_story_bible.md'), 'Brief:\n{{BRIEF}}\nLanguage: {{LANGUAGE}}\n', {
    encoding: 'utf8'
  });
});

afterEach(async () => {
  await rm(promptRoot, { recursive: true, force: true });
});

describe('TemplateRenderer', () => {
  test('replaces double-brace placeholders with provided values', () => {
    const renderer = new TemplateRenderer();

    expect(renderer.render('Hello {{NAME}}. Count: {{COUNT}}.', { NAME: 'Lin', COUNT: 3 })).toBe('Hello Lin. Count: 3.');
  });

  test('throws a clear error for missing placeholders', () => {
    const renderer = new TemplateRenderer();

    expect(() => renderer.render('Hello {{NAME}}.', {})).toThrow('Missing template value for NAME');
  });
});

describe('PromptService', () => {
  test('loads prompt templates by prompt id', async () => {
    const service = new PromptService(promptRoot);

    await expect(service.loadTemplate('strategy.build_story_bible')).resolves.toContain('Brief:');
  });

  test('renders loaded templates with variables', async () => {
    const service = new PromptService(promptRoot);

    await expect(
      service.renderPrompt('strategy.build_story_bible', {
        BRIEF: '# Demo',
        LANGUAGE: 'zh-CN'
      })
    ).resolves.toBe('Brief:\n# Demo\nLanguage: zh-CN\n');
  });
});
