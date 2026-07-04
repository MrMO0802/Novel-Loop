import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { readRunDetail } from '../../src/app/runBrowser.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { preparePlannedProject } from './m19Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m19-legacy-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('legacy run compatibility', () => {
  test('browser displays legacy manifest and audit reports warning instead of crashing', async () => {
    const paths = await preparePlannedProject(tempRoot);
    const store = new FileStore();
    await store.ensureDir(paths.runDir('run_legacy_v1'));
    await store.writeText(
      path.join(paths.runDir('run_legacy_v1'), 'run_manifest.json'),
      `${JSON.stringify(
        {
          runId: 'run_legacy_v1',
          projectId: paths.projectId,
          command: 'chapter',
          args: { chapterNumber: 1, provider: 'mock' },
          status: 'completed',
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:01.000Z',
          artifacts: ['chapters/chapter_001/final.md'],
          llmCalls: [],
          errors: []
        },
        null,
        2
      )}\n`
    );

    const detail = await readRunDetail({ projectId: paths.projectId, projectsRoot: tempRoot, runId: 'run_legacy_v1' }, store);
    expect(detail.schemaVersion).toBe('legacy');
    expect(detail.events).toEqual([]);

    const audit = await auditProject({ projectId: paths.projectId, projectsRoot: tempRoot, strict: true }, store);
    expect(audit.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'run_manifest',
          severity: 'warning',
          blocking: false
        })
      ])
    );
  });
});
