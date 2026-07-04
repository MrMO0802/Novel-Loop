import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createProgram } from '../../src/cli/program.js';
import { inspectProvider } from '../../src/providers/providerRegistry.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m25-health-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M25 Codex health gate', () => {
  test('doctor unhealthy is non-blocking when login, smoke, and json checks pass', async () => {
    const fake = await writeFakeCodex(tempRoot, 'doctor-unhealthy');

    const detail = await inspectProvider('codex-text', {
      codexBin: fake.codexBin,
      projectsRoot: tempRoot,
      projectId: 'demo-novel'
    });

    expect(detail.health).toMatchObject({
      binaryAvailable: true,
      loginAvailable: true,
      doctorHealthy: false,
      execSmokeOk: true,
      execJsonOk: true,
      providerAvailable: true,
      available: true
    });
  });

  test('codex status prints layered provider availability and non-blocking doctor warning', async () => {
    const fake = await writeFakeCodex(tempRoot, 'doctor-unhealthy');
    const output: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await createProgram().parseAsync(
        [
          'node',
          'novel-loop',
          'codex',
          'status',
          '--codex-bin',
          fake.codexBin,
          '--root',
          tempRoot,
          '--project-id',
          'demo-novel'
        ],
        { from: 'node' }
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    const text = output.join('');
    expect(text).toContain('providerAvailable: true');
    expect(text).toContain('doctorHealthy: false');
    expect(text).toContain('doctorWarning: non-blocking');
  });
});
