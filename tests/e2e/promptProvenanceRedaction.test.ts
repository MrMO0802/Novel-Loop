import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, fixturesRoot, projectId, promptRoot, removeTempRoot } from './m16Helpers.js';
import { getArray, preparePlannedProject, readRunManifest } from './m19Helpers.js';

let tempRoot: string;
let previousRedaction: string | undefined;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m19-prompt-');
  previousRedaction = process.env.NLE_REDACT_PROMPT_ARTIFACTS;
});

afterEach(async () => {
  if (previousRedaction === undefined) {
    delete process.env.NLE_REDACT_PROMPT_ARTIFACTS;
  } else {
    process.env.NLE_REDACT_PROMPT_ARTIFACTS = previousRedaction;
  }
  await removeTempRoot(tempRoot);
});

describe('prompt provenance and redaction', () => {
  test('redacted prompt calls record hashes and do not expose raw prompt content in manifest', async () => {
    process.env.NLE_REDACT_PROMPT_ARTIFACTS = 'true';
    const paths = await preparePlannedProject(tempRoot);
    await runChapterDryRun({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      runId: 'run_m19_redacted_prompt'
    });

    const manifest = await readRunManifest(paths, 'run_m19_redacted_prompt');
    const redactionPolicy = manifest.redactionPolicy as Record<string, unknown>;
    expect(redactionPolicy).toMatchObject({
      savePromptInputs: true,
      savePromptOutputs: true,
      redactSecrets: true,
      redactUserContent: true
    });

    const promptCall = getArray(manifest, 'promptCalls')[0]!;
    expect(promptCall).toEqual(
      expect.objectContaining({
        inputArtifactPath: expect.stringContaining('_request.md'),
        outputArtifactPath: expect.stringContaining('_response.md'),
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        outputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        redacted: true,
        redactionReason: expect.stringContaining('NLE_REDACT_PROMPT_ARTIFACTS')
      })
    );
    expect(JSON.stringify(promptCall)).not.toContain('STORY_STATE_JSON');

    const store = new FileStore();
    const promptArtifact = await store.readText(paths.projectArtifact(promptCall.inputArtifactPath as string));
    expect(promptArtifact).toContain('[redacted prompt request artifact');
  });
});
