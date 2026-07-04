import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { writePromptRunArtifacts } from '../../../src/logging/PromptArtifactWriter.js';
import { FileStore } from '../../../src/storage/FileStore.js';
import { ProjectPaths } from '../../../src/storage/ProjectPaths.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-prompt-redaction-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('writePromptRunArtifacts', () => {
  test('redacts prompt artifacts when configured', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();

    await writePromptRunArtifacts(store, paths, 'run_redaction_test', 'strategy.build_story_bible', 'secret prompt', 'secret response', {
      env: {
        NLE_REDACT_PROMPT_ARTIFACTS: 'true'
      }
    });

    const request = await store.readText(path.join(paths.runDir('run_redaction_test'), 'prompts', 'strategy_build_story_bible_request.md'));
    const response = await store.readText(path.join(paths.runDir('run_redaction_test'), 'prompts', 'strategy_build_story_bible_response.md'));

    expect(request).toContain('[redacted');
    expect(response).toContain('[redacted');
    expect(request).not.toContain('secret prompt');
    expect(response).not.toContain('secret response');
  });
});
