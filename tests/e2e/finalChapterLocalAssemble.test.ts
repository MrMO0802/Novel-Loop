import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { FinalAssemblyReportSchema, RunManifestV2Schema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, createTempRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.5 final chapter local assemble', () => {
  test('assembles final.md locally and still runs quality, patch, approval, snapshot, and commit safety chain', async () => {
    const tempRoot = await createTempRoot('novel-loop-m275-final-assemble-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'codex-controlled-valid');
      const store = new FileStore();
      const projectId = 'codex-final-assemble';
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
      await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      await runChapterDryRun({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean', runId: 'run_local_assemble_dry' }, store);
      await runChapterUntilDraft({ projectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean', runId: 'run_local_assemble_draft' }, store);

      const preview = await runChapterFullProduction(
        {
          projectId,
          projectsRoot: tempRoot,
          chapterNumber: 1,
          provider: 'codex-text',
          promptRoot,
          codexBin: fake.codexBin,
          codexProfile: 'clean',
          maxRevisions: 2,
          commit: true,
          codexFinalMode: 'local-assemble',
          runId: 'run_local_assemble_preview'
        },
        store
      );

      expect(preview.status).toBe('codex_commit_preview');
      expect(preview.qualityReportPath).toMatch(/^chapters\/chapter_001\/codex_chapter_quality_report_v\d+\.json$/);
      expect(preview.codexPatchPath).toMatch(/^chapters\/chapter_001\/canon_patch_codex_proposal_v\d+\.json$/);
      expect(preview.stateDiffPath).toMatch(/^diffs\/state_diff_.+\.json$/);
      const previewManifest = await store.readJson(paths.runManifest(preview.runId), RunManifestV2Schema);
      expect(previewManifest.promptCalls.map((call) => call.promptId)).not.toContain('revision.final_chapter');
      expect(previewManifest.promptCalls.map((call) => call.promptId)).toContain('memory.extract_canon_patch_proposal_slim');

      const report = await store.readJson(paths.chapterArtifact(1, 'final_assembly_report_v1.json'), FinalAssemblyReportSchema);
      expect(report).toMatchObject({
        projectId,
        chapterNumber: 1,
        mode: 'local-assemble',
        outputFinalPath: 'chapters/chapter_001/final.md',
        sceneCount: 2
      });
      expect(report.sourceScenePaths).toEqual([
        'chapters/chapter_001/scenes/scene_001.md',
        'chapters/chapter_001/scenes/scene_002.md'
      ]);
      const finalText = await store.readText(paths.chapterArtifact(1, 'final.md'));
      expect(finalText).toContain('# Chapter 001');
      expect(finalText).toContain('Codex scene draft for chapter 1');

      const confirm = await runChapterFullProduction(
        {
          projectId,
          projectsRoot: tempRoot,
          chapterNumber: 1,
          provider: 'codex-text',
          promptRoot,
          codexBin: fake.codexBin,
          codexProfile: 'clean',
          maxRevisions: 2,
          commit: true,
          confirmCodexCommit: true,
          codexFinalMode: 'local-assemble',
          runId: 'run_local_assemble_confirm'
        },
        store
      );

      expect(confirm.status).toBe('committed');
      expect(confirm.commitReportPath).toBe('chapters/chapter_001/commit_report.json');
      expect(confirm.approvalRecordPath).toMatch(/^chapters\/chapter_001\/codex_approval_record_v\d+\.json$/);
      expect(confirm.beforeSnapshotId).toBeDefined();
      expect(confirm.afterSnapshotId).toBeDefined();
      const state = await store.readJson(paths.storyState(), StoryStateSchema);
      expect(state.latestCommittedChapter).toBe(1);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 40_000);
});
