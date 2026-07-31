import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { checkCodexStatus, execCodexJson, runCodexSmoke } from '../../src/app/codexBoundary.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { createStressFixture } from '../../src/app/stressFixture.js';
import { StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m21-codex-boundary-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M21 Codex execution boundary', () => {
  test('reports a clear error when codex binary is missing', async () => {
    await expect(checkCodexStatus({ codexBin: path.join(tempRoot, 'missing-codex'), projectsRoot: tempRoot })).rejects.toMatchObject({
      code: 'CODEX_BINARY_NOT_FOUND'
    });
  });

  test('status uses codex version, login status, and redacted doctor health output', async () => {
    const fake = await writeFakeCodex(tempRoot);

    const result = await checkCodexStatus({ codexBin: fake.codexBin, projectsRoot: tempRoot });

    expect(result.binaryFound).toBe(true);
    expect(result.version).toBe('codex-cli 9.9.9');
    expect(result.loginStatus).toContain('Logged in');
    expect(result.healthOk).toBe(true);
    expect(result.doctorJson).not.toContain('sk-SECRET');
    expect(result.doctorJson).not.toContain('CODEX_ACCESS_TOKEN');
  });

  test('smoke runs codex exec with read-only sandbox and no workspace write flags', async () => {
    const fake = await writeFakeCodex(tempRoot);

    const result = await runCodexSmoke({ codexBin: fake.codexBin, projectsRoot: tempRoot });

    expect(result.ok).toBe(true);
    expect(result.sandbox).toBe('read-only');
    const argsLog = await readFile(fake.argsLogPath, 'utf8');
    expect(argsLog).toContain('exec');
    expect(argsLog).toContain('--sandbox read-only');
    expect(argsLog).toContain('--json');
    expect(argsLog).toContain('--output-last-message');
    expect(argsLog).not.toContain('workspace-write');
    expect(argsLog).not.toContain('danger-full-access');
    expect(argsLog).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  test('exec-json parses output-schema JSON without modifying Story State', async () => {
    const fake = await writeFakeCodex(tempRoot);
    const store = new FileStore();
    const fixture = await createStressFixture({ projectId, projectsRoot: tempRoot, chapters: 1 }, store);
    const stateBefore = await store.readJson(fixture.paths.storyState(), StoryStateSchema);
    const promptPath = path.join(tempRoot, 'prompt.md');
    const schemaPath = path.join(tempRoot, 'schema.json');
    await writeFile(promptPath, 'Return JSON for the schema only.\n', 'utf8');
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

    const result = await execCodexJson({
      codexBin: fake.codexBin,
      projectsRoot: tempRoot,
      projectId,
      promptPath,
      schemaPath
    });

    expect(result.parsedJson).toEqual({ title: 'Codex JSON', ok: true, items: ['alpha', 'beta'] });
    expect(result.safety.storyStateCommitAllowed).toBe(false);
    expect(result.safety.workspaceWriteAllowed).toBe(false);
    expect(result.safety.shellCommandsAllowed).toBe(false);
    const execArgs = (await readFile(fake.argsLogPath, 'utf8')).trim().split(/\s+/);
    const outputArgument = execArgs[execArgs.indexOf('--output-last-message') + 1];
    expect(outputArgument).toBeDefined();
    expect(path.resolve(outputArgument!)).not.toBe(fixture.paths.projectRoot);
    expect(path.resolve(outputArgument!).startsWith(`${fixture.paths.projectRoot}${path.sep}`)).toBe(false);
    await expect(store.exists(path.resolve(outputArgument!))).resolves.toBe(false);
    await expect(
      store.exists(fixture.paths.projectArtifact(result.finalOutputPath))
    ).resolves.toBe(true);
    expect(await store.readJson(fixture.paths.storyState(), StoryStateSchema)).toEqual(stateBefore);
    const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.exitCode).toBe(0);
    expect(audit.ok).toBe(true);
  });

  test('exec-json rejects a non-zero Codex exit even when an output file exists', async () => {
    const fake = await writeFakeCodex(tempRoot, 1);
    const promptPath = path.join(tempRoot, 'failed-prompt.md');
    const schemaPath = path.join(tempRoot, 'failed-schema.json');
    await writeFile(promptPath, 'Return JSON for the schema only.\n', 'utf8');
    await writeFile(schemaPath, JSON.stringify({
      type: 'object',
      required: ['title', 'ok', 'items'],
      properties: {
        title: { type: 'string' },
        ok: { type: 'boolean' },
        items: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: false
    }), 'utf8');

    await expect(execCodexJson({
      codexBin: fake.codexBin,
      projectsRoot: tempRoot,
      projectId,
      promptPath,
      schemaPath
    })).rejects.toMatchObject({ code: 'CODEX_EXEC_FAILED' });
  });
});

async function writeFakeCodex(root: string, execExitCode = 0): Promise<{ codexBin: string; argsLogPath: string }> {
  const codexBin = path.join(root, 'fake-codex.cjs');
  const argsLogPath = path.join(root, 'codex-args.log');
  await writeFile(
    codexBin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argsLogPath)}, args.join(' ') + '\\n');
if (args[0] === '--version') {
  process.stdout.write('codex-cli 9.9.9\\n');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  process.stdout.write('Logged in as local-user@example.com\\n');
  process.exit(0);
}
if (args[0] === 'doctor') {
  process.stdout.write(JSON.stringify({ ok: true, auth: { status: 'logged_in', token: 'sk-SECRET', env: 'CODEX_ACCESS_TOKEN=secret' } }) + '\\n');
  process.exit(0);
}
if (args.includes('exec')) {
  const outputIndex = args.indexOf('--output-last-message');
  const outputFile = outputIndex === -1 ? undefined : args[outputIndex + 1];
  const schemaMode = args.includes('--output-schema');
  const finalText = schemaMode ? JSON.stringify({ title: 'Codex JSON', ok: true, items: ['alpha', 'beta'] }) : 'Codex text final';
  if (outputFile) fs.writeFileSync(outputFile, finalText);
  process.stdout.write(JSON.stringify({ type: 'session.started', token: 'sk-SECRET' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'message', text: finalText }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'session.completed' }) + '\\n');
  process.exit(${JSON.stringify(execExitCode)});
}
process.stderr.write('unknown fake codex command: ' + args.join(' ') + '\\n');
process.exit(2);
`,
    'utf8'
  );
  await chmod(codexBin, 0o755);
  return { codexBin, argsLogPath };
}
