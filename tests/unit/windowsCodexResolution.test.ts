import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

import { checkCodexStatus } from '../../src/app/codexBoundary.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

test.skipIf(process.platform !== 'win32')('finds a global npm Codex entry point without executing its cmd shim', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-windows-codex-'));
  const previousPath = process.env.PATH;
  try {
    const fake = await writeFakeCodex(root);
    const bin = path.join(root, 'bin');
    const entry = path.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    await mkdir(path.dirname(entry), { recursive: true });
    await copyFile(fake.codexBin, entry);
    process.env.PATH = bin;
    const status = await checkCodexStatus({ timeoutMs: 5000 });
    expect(status.binaryPath).toBe(entry);
    expect(status.version).toContain('codex');
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});
