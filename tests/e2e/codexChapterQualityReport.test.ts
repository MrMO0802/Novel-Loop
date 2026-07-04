import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { evaluateCodexChapterQuality } from '../../src/app/codexChapterQuality.js';
import { CanonPatchSchema, CodexChapterQualityReportSchema, DiagnosticsReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { validCanonPatch, validDiagnosticsReport } from '../fixtures/schemas/valid.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m25-quality-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M25 codex chapter quality report', () => {
  test('generates deterministic local quality report without mutating Story State', async () => {
    const { store, paths } = await writeQualityFixture('# 旧收音机\n\n林澈在旧货市场买到一台会在夜晚发出求救声的旧收音机。它没有电池，却在深夜说出十七楼的地址。林澈决定去调查，不知道是谁在等他？\n');

    const result = await evaluateCodexChapterQuality({ projectId: 'demo-novel', projectsRoot: tempRoot, chapterNumber: 1 }, store);

    expect(result.blocking).toBe(false);
    expect(result.reportPath).toBe('chapters/chapter_001/codex_chapter_quality_report_v1.json');
    const report = await store.readJson(paths.chapterArtifact(1, 'codex_chapter_quality_report_v1.json'), CodexChapterQualityReportSchema);
    expect(report).toMatchObject({
      provider: 'codex-text',
      hasTitle: true,
      protagonistPresent: true,
      jsonArtifactsConsistent: true,
      canonPatchMatchesFinal: true,
      diagnosticsHardChecksPassed: true,
      storyStateMutated: false,
      blocking: false
    });
    await expect(store.exists(paths.storyState())).resolves.toBe(false);
  });

  test('flags unresolved placeholders as critical blocking issues', async () => {
    const { store, paths } = await writeQualityFixture('# 旧收音机\n\n{{TODO_WRITE_FINAL}}\n');

    const result = await evaluateCodexChapterQuality({ projectId: 'demo-novel', projectsRoot: tempRoot, chapterNumber: 1 }, store);

    expect(result.blocking).toBe(true);
    expect(result.criticalIssues.some((issue) => issue.includes('unresolved placeholder'))).toBe(true);
    const report = await store.readJson(paths.chapterArtifact(1, 'codex_chapter_quality_report_v1.json'), CodexChapterQualityReportSchema);
    expect(report.blocking).toBe(true);
  });
});

async function writeQualityFixture(finalText: string) {
  const store = new FileStore();
  const paths = new ProjectPaths(tempRoot, 'demo-novel');
  await store.writeText(paths.chapterArtifact(1, 'final.md'), finalText);
  await store.writeJson(paths.chapterArtifact(1, 'diagnostics_v1.json'), validDiagnosticsReport, DiagnosticsReportSchema);
  await store.writeJson(paths.chapterArtifact(1, 'canon_patch_codex_normalized_v1.json'), validCanonPatch, CanonPatchSchema);
  return { store, paths };
}
