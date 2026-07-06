import { describe, expect, test } from 'vitest';

import { generateCodexCallReductionReport } from '../../src/app/codexCallReduction.js';
import { CodexCallReductionReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { initProject } from '../../src/app/initProject.js';
import { briefPath, createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';

describe('M27 codex call reduction report', () => {
  test('records local deterministic tasks without lowering schema or safety checks', async () => {
    const tempRoot = await createTempRoot('novel-loop-m27-call-reduction-');
    try {
      const store = new FileStore();
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      const paths = new ProjectPaths(tempRoot, projectId);

      const result = await generateCodexCallReductionReport({ projectId, projectsRoot: tempRoot, beforeCallCount: 18, afterCallCount: 12 }, store);

      expect(result.report.afterCallCount).toBeLessThan(result.report.beforeCallCount);
      expect(result.report.localDeterministicTasks).toEqual(expect.arrayContaining(['chapter_quality_report_v2', 'cross_chapter_continuity_v2', 'chapter_summary_cache']));
      expect(result.report.schemaSafetyChecksPreserved).toBe(true);
      await expect(store.readJson(paths.auditArtifact('codex_call_reduction_report_v1.json'), CodexCallReductionReportSchema)).resolves.toMatchObject({
        projectId
      });
    } finally {
      await removeTempRoot(tempRoot);
    }
  });
});
