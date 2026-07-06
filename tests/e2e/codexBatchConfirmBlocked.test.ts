import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexMultiChapterPilot } from '../../src/app/codexMultiChapterPilot.js';
import { AppError } from '../../src/utils/AppError.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m26-batch-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M26 codex batch confirm safety gate', () => {
  test('blocks one-shot multi-chapter confirmation without preview checkpoints', async () => {
    const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');

    await expect(
      runCodexMultiChapterPilot({
        projectId: 'codex-batch',
        projectsRoot: tempRoot,
        briefPath,
        promptRoot,
        targetChapterCount: 3,
        codexBin: fake.codexBin,
        batchConfirm: true
      })
    ).rejects.toMatchObject<AppError>({
      code: 'CODEX_BATCH_CONFIRM_BLOCKED'
    });
  });
});
