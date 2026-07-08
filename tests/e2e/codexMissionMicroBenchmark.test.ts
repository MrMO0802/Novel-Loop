import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { runCodexMissionMicroBenchmark } from '../../src/app/codexMissionMicroBenchmark.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { CodexMissionMicroBenchmarkReportSchema, CodexMissionRetryReportSchema, MissionSchemaDiagnosticsReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.7 Codex mission micro benchmark', () => {
  test('runs only chapter mission through Codex, records retry diagnostics, and does not mutate Story State', async () => {
    const tempRoot = await createTempRoot('novel-loop-m277-mission-benchmark-');
    try {
      const store = new FileStore();
      const projectId = 'codex-mission-benchmark';
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build` }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan` }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      const storyStateBefore = await store.readText(paths.storyState());

      const result = await runCodexMissionMicroBenchmark(
        {
          projectId,
          projectsRoot: tempRoot,
          promptRoot,
          chapterNumber: 2,
          codexBin: fake.codexBin,
          codexProfile: 'clean',
          codexJsonRetries: 2,
          codexJsonRepair: true
        },
        store
      );

      expect(result.report).toMatchObject({
        reportId: 'codex_mission_micro_benchmark_v1',
        projectId,
        chapterNumber: 2,
        promptId: 'planning.plan_chapter_mission_slim',
        retryCount: 0,
        repairCount: 0,
        schemaValid: true,
        success: true,
        storyStateMutated: false
      });
      expect(result.retryReport).toMatchObject({
        reportId: 'codex_mission_retry_report_v1',
        projectId,
        chapterNumber: 2,
        previousRetryCount: 1,
        currentRetryCount: 0,
        repairUsed: false,
        success: true,
        promptChanges: expect.arrayContaining([expect.stringContaining('deterministic')]),
        schemaChanges: expect.arrayContaining([expect.stringContaining('strict')]),
        normalizerChanges: expect.arrayContaining([expect.stringContaining('schema diagnostics')])
      });
      expect(result.schemaDiagnostics).toMatchObject({
        reportId: 'mission_schema_diagnostics_v1',
        projectId,
        chapterNumber: 2,
        promptId: 'planning.plan_chapter_mission_slim',
        schemaValid: true,
        errorTypes: []
      });
      expect(await store.readText(paths.storyState())).toBe(storyStateBefore);
      await expect(store.readJson(paths.auditArtifact('codex_mission_micro_benchmark_v1.json'), CodexMissionMicroBenchmarkReportSchema)).resolves.toMatchObject({ success: true });
      await expect(store.readJson(paths.auditArtifact('codex_mission_retry_report_v1.json'), CodexMissionRetryReportSchema)).resolves.toMatchObject({ currentRetryCount: 0 });
      await expect(store.readJson(paths.auditArtifact('mission_schema_diagnostics_v1.json'), MissionSchemaDiagnosticsReportSchema)).resolves.toMatchObject({ schemaValid: true });

      const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
      expect(audit.ok).toBe(true);
      expect(audit.report.issues.filter((issue) => issue.category === 'codex_mission_benchmark')).toHaveLength(0);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});
