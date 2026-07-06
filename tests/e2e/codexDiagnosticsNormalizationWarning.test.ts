import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexMultiChapterPilot } from '../../src/app/codexMultiChapterPilot.js';
import { CodexChapterQualityReportSchema, DiagnosticsReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m26-normalization-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M26 codex diagnostics normalization warnings', () => {
  test('records score normalization instead of silently upscaling diagnostics', async () => {
    const fake = await writeFakeCodex(tempRoot, 'codex-controlled-normalization-warning');
    const store = new FileStore();

    const result = await runCodexMultiChapterPilot(
      {
        projectId: 'codex-normalization',
        projectsRoot: tempRoot,
        briefPath,
        promptRoot,
        targetChapterCount: 1,
        codexBin: fake.codexBin,
        codexProfile: 'clean',
        codexJsonRetries: 2,
        codexJsonRepair: true
      },
      store
    );

    expect(result.report.success).toBe(true);
    expect(result.report.chapters[0]?.warnings.some((warning) => warning.includes('normalized diagnostics score'))).toBe(true);

    const paths = new ProjectPaths(tempRoot, 'codex-normalization');
    const diagnostics = await store.readJson(paths.chapterArtifact(1, 'diagnostics_v1.json'), DiagnosticsReportSchema);
    expect(diagnostics.normalizationWarnings).toEqual([
      expect.objectContaining({
        field: 'averageScore',
        originalValue: 4.2,
        normalizedValue: 8.5,
        promptId: 'diagnostics.diagnose_chapter_slim',
        artifactPath: 'chapters/chapter_001/diagnostics_v1.json'
      })
    ]);

    const quality = await store.readJson(paths.chapterArtifact(1, 'codex_chapter_quality_report_v1.json'), CodexChapterQualityReportSchema);
    expect(quality.normalizationWarnings).toEqual(diagnostics.normalizationWarnings);
  });
});
