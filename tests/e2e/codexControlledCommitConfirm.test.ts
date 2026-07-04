import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { ApprovalRecordSchema, ChapterQueueSchema, RunEventSchema, RunManifestSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { SnapshotStore } from '../../src/storage/SnapshotStore.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m24-confirm-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('M24 codex controlled commit confirm', () => {
  test('confirmed codex controlled commit applies validated patch through local Story State logic', async () => {
    const { store, paths, codexBin } = await prepareCodexDraftProject(tempRoot);

    const input: any = {
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin,
      codexProfile: 'clean',
      codexJsonRetries: 2,
      codexJsonRepair: true,
      maxRevisions: 2,
      commit: true,
      confirmCodexCommit: true,
      runId: 'run_m24_confirm'
    };
    const result = await runChapterFullProduction(input, store) as any;

    expect(result.status).toBe('committed');
    expect(result.previewOnly).toBe(false);
    expect(result.approvalRecordPath).toBe('chapters/chapter_001/codex_approval_record_v1.json');
    expect(result.codexCommitReportPath).toBe('chapters/chapter_001/codex_commit_report_v1.json');
    expect(result.codexPatchPath).toBe('chapters/chapter_001/canon_patch_codex_proposal_v1.json');

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(1);
    expect(state.canonFacts.map((fact) => fact.id)).toContain('fact_codex_ch001_radio_signal');

    const approval = await store.readJson(paths.chapterArtifact(1, 'codex_approval_record_v1.json'), ApprovalRecordSchema);
    expect(approval).toMatchObject({
      projectId,
      chapterNumber: 1,
      provider: 'codex-text',
      action: 'codex_controlled_commit',
      confirmed: true,
      riskAcknowledged: true
    });

    const report = JSON.parse(await store.readText(paths.chapterArtifact(1, 'codex_commit_report_v1.json'))) as Record<string, unknown>;
    expect(report).toMatchObject({
      provider: 'codex-text',
      controlledCommit: true,
      confirmed: true,
      committed: true,
      conflictCheckPassed: true,
      schemaValidationPassed: true,
      latestCommittedChapterBefore: 0,
      latestCommittedChapterAfter: 1
    });

    const snapshots = await new SnapshotStore(paths, store).listSnapshots();
    expect(snapshots.some((snapshot) => snapshot.reason === 'before_chapter_001_codex_controlled_commit')).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.reason === 'after_chapter_001_codex_controlled_commit')).toBe(true);

    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    expect(queue.chapters.find((chapter) => chapter.chapterNumber === 1)?.status).toBe('committed');

    const manifest = await store.readJson(paths.runManifest('run_m24_confirm'), RunManifestSchema);
    if (!('schemaVersion' in manifest) || manifest.schemaVersion !== '2') throw new Error('expected run manifest v2');
    expect(manifest.stateMutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mutationType: 'codex_controlled_commit',
          applied: true,
          patchPath: 'chapters/chapter_001/canon_patch_codex_proposal_v1.json'
        })
      ])
    );
    expect(manifest.promptCalls.map((call) => call.promptId)).toEqual(
      expect.arrayContaining([
        'diagnostics.diagnose_chapter_slim',
        'revision.create_revision_plan_slim',
        'revision.final_chapter',
        'memory.extract_canon_patch_proposal_slim'
      ])
    );

    const events = (await store.readText(paths.runEvents('run_m24_confirm')))
      .trim()
      .split('\n')
      .map((line) => RunEventSchema.parse(JSON.parse(line)));
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['CODEX_COMMIT_APPROVAL_RECORDED', 'STATE_MUTATION_APPLIED', 'RUN_COMPLETED'])
    );
  });
});

async function prepareCodexDraftProject(root: string) {
  const fake = await writeFakeCodex(root, 'codex-controlled-valid' as any);
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: root, briefPath }, store);
  await buildBible({ projectId, projectsRoot: root, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await planGlobal({ projectId, projectsRoot: root, provider: 'codex-text', promptRoot, codexBin: fake.codexBin, codexProfile: 'clean' }, store);
  await runChapterDryRun({
    projectId,
    projectsRoot: root,
    chapterNumber: 1,
    provider: 'codex-text',
    promptRoot,
    codexBin: fake.codexBin,
    codexProfile: 'clean',
    runId: 'run_m24_confirm_dryrun'
  }, store);
  await runChapterUntilDraft({
    projectId,
    projectsRoot: root,
    chapterNumber: 1,
    provider: 'codex-text',
    promptRoot,
    codexBin: fake.codexBin,
    codexProfile: 'clean',
    runId: 'run_m24_confirm_draft'
  }, store);
  return { store, paths: new ProjectPaths(root, projectId), codexBin: fake.codexBin };
}
