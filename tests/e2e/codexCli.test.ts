import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createProgram } from '../../src/cli/program.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m21-codex-cli-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M21 Codex CLI', () => {
  test('registers codex command group and safe subcommands', () => {
    const program = createProgram();
    const codexCommand = program.commands.find((command) => command.name() === 'codex');

    expect(program.helpInformation()).toContain('codex');
    expect(codexCommand?.helpInformation()).toContain('status');
    expect(codexCommand?.helpInformation()).toContain('smoke');
    expect(codexCommand?.helpInformation()).toContain('exec-text');
    expect(codexCommand?.helpInformation()).toContain('exec-json');
    expect(codexCommand?.helpInformation()).toContain('--codex-bin');
    const sampleStage = codexCommand?.commands.find((command) => command.name() === 'sample-stage');
    expect(sampleStage?.helpInformation()).toContain('--timeout-ms <ms>');
    expect(sampleStage?.helpInformation()).toContain('--stage <stage>');
  });

  test('exec-json command prints parsed JSON artifact path and uses fake codex binary', async () => {
    const fakeCodex = await writeFakeCodex(tempRoot);
    const promptPath = path.join(tempRoot, 'prompt.md');
    const schemaPath = path.join(tempRoot, 'schema.json');
    await writeFile(promptPath, 'Return JSON.\n', 'utf8');
    await writeFile(
      schemaPath,
      JSON.stringify({
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' }
        },
        additionalProperties: false
      }),
      'utf8'
    );
    const program = createProgram();
    const output: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await program.parseAsync(
        [
          'node',
          'novel-loop',
          'codex',
          'exec-json',
          '--codex-bin',
          fakeCodex,
          '--root',
          tempRoot,
          '--project-id',
          'demo-novel',
          '--prompt',
          promptPath,
          '--schema',
          schemaPath
        ],
        { from: 'node' }
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    const text = output.join('');
    expect(text).toContain('codexExecJson: success');
    expect(text).toContain('sandbox: read-only');
    expect(text).toContain('parsedJsonPath: codex/runs/');
  });
});

async function writeFakeCodex(root: string): Promise<string> {
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
  fs.writeFileSync(outputFile, JSON.stringify({ title: 'Codex JSON' }));
  process.stdout.write(JSON.stringify({ type: 'session.started' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'message', text: '{"title":"Codex JSON"}' }) + '\\n');
  process.exit(0);
}
process.exit(2);
`,
    'utf8'
  );
  await chmod(codexBin, 0o755);
  return codexBin;
}
