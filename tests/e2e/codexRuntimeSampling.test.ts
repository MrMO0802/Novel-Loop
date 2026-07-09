import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runCodexRuntimeStageSampling } from '../../src/app/codexRuntimeSampling.js';
import { initProject } from '../../src/app/initProject.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { CodexRuntimeSamplingReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.8B Codex runtime sampling', () => {
  test('sample-stage writes a schema-valid sampling report and sample artifacts without mutating Story State', async () => {
    const tempRoot = await createTempRoot('novel-loop-m278b-sampling-');
    try {
      const store = new FileStore();
      const projectId = 'codex-sampling';
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      await prepareProject(projectId, tempRoot, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      const storyStateBefore = await store.readText(paths.storyState());

      const result = await runCodexRuntimeStageSampling(
        {
          projectId,
          projectsRoot: tempRoot,
          promptRoot,
          chapterNumber: 2,
          stage: 'chapter_mission',
          samples: 3,
          codexBin: fake.codexBin,
          codexProfile: 'clean',
          codexJsonRetries: 2,
          codexJsonRepair: true
        },
        store
      );

      expect(CodexRuntimeSamplingReportSchema.parse(result.report)).toMatchObject({
        reportId: 'codex_runtime_sampling_report_v1',
        projectId,
        chapterNumber: 2,
        stage: 'chapter_mission',
        promptId: 'planning.plan_chapter_mission_slim',
        sampleCount: 3,
        successCount: 3,
        failureCount: 0,
        schemaValidRate: 1,
        timeoutRate: 0
      });
      expect(result.report.samples).toHaveLength(3);
      expect(result.report.samples.every((sample) => sample.stateMutated === false)).toBe(true);
      expect(result.report.samples.every((sample) => sample.jsonParsed === true && sample.schemaValid === true)).toBe(true);
      expect(result.report.samples.every((sample) => sample.artifactPaths.length > 0)).toBe(true);
      for (const sample of result.report.samples) {
        for (const artifactPath of sample.artifactPaths) {
          await expect(store.exists(paths.projectArtifact(artifactPath))).resolves.toBe(true);
        }
        await expect(store.exists(paths.runManifest(sample.runId))).resolves.toBe(true);
        const events = await store.readText(paths.runEvents(sample.runId));
        expect(events).toContain('CODEX_PROCESS_SPAWN_STARTED');
      }
      await expect(store.readJson(paths.auditArtifact('codex_runtime_sampling_report_v1.json'), CodexRuntimeSamplingReportSchema)).resolves.toMatchObject({
        sampleCount: 3,
        successCount: 3
      });
      expect(await store.readText(paths.storyState())).toBe(storyStateBefore);

      const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
      expect(audit.ok).toBe(true);
      expect(audit.report.issues.filter((issue) => issue.category === 'codex_runtime_sampling')).toHaveLength(0);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 60_000);
});

async function prepareProject(projectId: string, tempRoot: string, store: FileStore): Promise<void> {
  await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build` }, store);
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan` }, store);
  await store.ensureDir(path.join(tempRoot, projectId, 'audit'));
}
