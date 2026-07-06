import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { auditCodexPrompts } from '../../src/app/codexPromptAudit.js';
import { CodexPromptAuditReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27 codex prompt audit', () => {
  test('accepts codex-text prompt pack metadata and rejects overlong prompts without metadata', async () => {
    const store = new FileStore();
    const good = await auditCodexPrompts({ promptRoot: path.join(promptRoot, 'codex-text') }, store);
    expect(good.report.ok).toBe(true);
    expect(CodexPromptAuditReportSchema.parse(good.report).promptCount).toBeGreaterThan(0);

    const tempRoot = await createTempRoot('novel-loop-m27-prompt-audit-');
    try {
      const badRoot = path.join(tempRoot, 'codex-text');
      await mkdir(path.join(badRoot, 'planning'), { recursive: true });
      await writeFile(path.join(badRoot, 'planning', 'bad.md'), `${'x'.repeat(20_000)} auth token secret`, 'utf8');
      const bad = await auditCodexPrompts({ promptRoot: badRoot, maxPromptBytes: 4_000 }, store);
      expect(bad.report.ok).toBe(false);
      expect(bad.report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['PROMPT_METADATA_MISSING', 'PROMPT_TOO_LONG', 'PROMPT_SECRET_TERM']));
    } finally {
      await removeTempRoot(tempRoot);
    }
  });
});
