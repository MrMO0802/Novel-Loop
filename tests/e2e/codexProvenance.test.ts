import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { execCodexJson } from '../../src/app/codexBoundary.js';
import { RunManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m21-codex-provenance-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M21 Codex provenance', () => {
  test('writes run manifest v2, events, raw output, final output, and parsed JSON artifacts', async () => {
    const fake = await writeFakeCodex(tempRoot);
    const promptPath = path.join(tempRoot, 'prompt.md');
    const schemaPath = path.join(tempRoot, 'schema.json');
    await writeFile(promptPath, 'Return the structured payload.\n', 'utf8');
    await writeFile(
      schemaPath,
      JSON.stringify({
        type: 'object',
        required: ['title', 'ok'],
        properties: {
          title: { type: 'string' },
          ok: { type: 'boolean' }
        },
        additionalProperties: false
      }),
      'utf8'
    );

    const result = await execCodexJson({
      codexBin: fake.codexBin,
      projectsRoot: tempRoot,
      projectId,
      promptPath,
      schemaPath,
      runId: 'run_m21_codex_json'
    });
    const paths = new ProjectPaths(tempRoot, projectId);
    const store = new FileStore();
    const manifest = await store.readJson(paths.runManifest(result.runId), RunManifestSchema);

    expect(manifest).toMatchObject({
      schemaVersion: '2',
      runId: 'run_m21_codex_json',
      command: 'codex',
      status: 'success',
      provider: 'codex-cli'
    });
    expect('schemaVersion' in manifest && manifest.schemaVersion === '2' ? manifest.resolvedContext.mode : undefined).toBe('codex');
    expect('schemaVersion' in manifest && manifest.schemaVersion === '2' ? manifest.promptCalls.length : 0).toBe(1);
    expect('schemaVersion' in manifest && manifest.schemaVersion === '2' ? manifest.artifacts.map((artifact) => artifact.path) : []).toEqual(
      expect.arrayContaining([result.rawOutputPath, result.finalOutputPath, result.parsedJsonPath])
    );

    const events = await store.readText(paths.runEvents(result.runId));
    expect(events).toContain('RUN_STARTED');
    expect(events).toContain('PROMPT_CALL_COMPLETED');
    expect(events).toContain('ARTIFACT_GENERATED');
    expect(events).toContain('RUN_COMPLETED');

    const rawOutput = await store.readText(paths.projectArtifact(result.rawOutputPath));
    expect(rawOutput).toContain('session.started');
    expect(rawOutput).not.toContain('sk-SECRET');
    expect(rawOutput).not.toContain('auth.json');
    expect(await store.readText(paths.projectArtifact(result.finalOutputPath))).toContain('Codex JSON');
    expect(JSON.parse(await store.readText(paths.projectArtifact(result.parsedJsonPath)))).toEqual({ title: 'Codex JSON', ok: true });
  });
});

async function writeFakeCodex(root: string): Promise<{ codexBin: string }> {
  const codexBin = path.join(root, 'fake-codex.cjs');
  await writeFile(
    codexBin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('codex-cli 9.9.9\\n');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  process.stdout.write('Logged in\\n');
  process.exit(0);
}
if (args[0] === 'doctor') {
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
  process.exit(0);
}
if (args.includes('exec')) {
  const outputFile = args[args.indexOf('--output-last-message') + 1];
  const finalText = JSON.stringify({ title: 'Codex JSON', ok: true });
  fs.writeFileSync(outputFile, finalText);
  process.stdout.write(JSON.stringify({ type: 'session.started', authFile: '/home/user/.codex/auth.json', token: 'sk-SECRET' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'message', text: finalText }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'session.completed' }) + '\\n');
  process.exit(0);
}
process.exit(2);
`,
    'utf8'
  );
  await chmod(codexBin, 0o755);
  return { codexBin };
}
