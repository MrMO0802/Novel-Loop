import { describe, expect, test } from 'vitest';

import { runCodexRuntimeBenchmark } from '../../src/app/codexRuntimeBenchmark.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.9 codex preview failure classification', () => {
  test('benchmark classifies diagnostics hard failure as CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL', async () => {
    const tempRoot = await createTempRoot('novel-loop-m279-preview-classification-');
    try {
      const store = new FileStore();
      const projectId = 'codex-preview-classification';
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-diagnostics-fail');

      const result = await runCodexRuntimeBenchmark(
        {
          projectId,
          projectsRoot: tempRoot,
          briefPath,
          promptRoot,
          codexBin: fake.codexBin,
          level: 'preview',
          codexProfile: 'clean',
          codexStageTimeoutMs: 10_000
        },
        store
      );

      expect(result.report.success).toBe(false);
      expect(result.report.failedLevel).toBe('preview');
      expect(result.report.stages.at(-1)).toMatchObject({
        stageName: 'chapter-001-preview',
        status: 'failed',
        errorCode: 'CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL',
        stateMutationApplied: false
      });
      expect(result.report.failureReportPath).toMatch(/^audit\/codex_runtime_failure_report_v\d+\.json$/);

      const paths = new ProjectPaths(tempRoot, projectId);
      const runtimeFailure = JSON.parse(await store.readText(paths.auditArtifact('codex_runtime_failure_report_v1.json'))) as {
        errorType: string;
        previewCompletenessReportPath?: string;
        previewFailureReportPath?: string;
      };
      expect(runtimeFailure.errorType).toBe('CODEX_PREVIEW_DIAGNOSTICS_HARD_FAIL');
      expect(runtimeFailure.previewCompletenessReportPath).toBe('chapters/chapter_001/codex_preview_completeness_report_v1.json');
      expect(runtimeFailure.previewFailureReportPath).toBe('chapters/chapter_001/codex_preview_failure_report_v1.json');
    } finally {
      await removeTempRoot(tempRoot);
    }
  });
});
