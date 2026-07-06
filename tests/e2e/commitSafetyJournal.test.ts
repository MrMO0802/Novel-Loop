import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { buildBible } from '../../src/app/buildBible.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { CommitJournalSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-commit-journal-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('commit safety journal', () => {
  test('normal mock commit writes a completed commit journal', async () => {
    const { store, paths } = await prepareProject();

    const result = await runChapterFullProduction(
      {
        projectId,
        projectsRoot: tempRoot,
        chapterNumber: 1,
        provider: 'mock',
        promptRoot,
        fixturesRoot,
        candidates: 3,
        maxRevisions: 2,
        commit: true,
        runId: 'run_commit_journal_success'
      },
      store
    );

    expect(result.status).toBe('committed');
    expect(result.artifacts).toContain('chapters/chapter_001/commit_journal_v1.json');

    const journal = await store.readJson(paths.chapterArtifact(1, 'commit_journal_v1.json'), CommitJournalSchema);
    expect(journal).toMatchObject({
      projectId,
      chapterNumber: 1,
      commitKind: 'chapter_commit',
      provider: 'mock',
      status: 'completed',
      stateWriteCompleted: true,
      queueCommitted: true,
      commitReportPath: 'chapters/chapter_001/commit_report.json',
      latestCommittedChapterBefore: 0,
      latestCommittedChapterAfter: 1
    });
    expect(journal.beforeSnapshotId).toMatch(/^snapshot_/);
    expect(journal.afterSnapshotId).toMatch(/^snapshot_/);
    expect(journal.phases.map((phase) => phase.phase)).toEqual(
      expect.arrayContaining([
        'prepared',
        'before_snapshot_created',
        'story_state_written',
        'after_snapshot_created',
        'state_mutation_recorded',
        'commit_report_written',
        'queue_committed',
        'completed'
      ])
    );
  });

  test('post-state failure leaves an incomplete journal that audit reports', async () => {
    const { store, paths } = await prepareProject();

    await expect(
      runChapterFullProduction(
        {
          projectId,
          projectsRoot: tempRoot,
          chapterNumber: 1,
          provider: 'mock',
          promptRoot,
          fixturesRoot,
          candidates: 3,
          maxRevisions: 2,
          commit: true,
          runId: 'run_commit_journal_post_state_failure',
          failAt: 'post_state_write'
        },
        store
      )
    ).rejects.toMatchObject({ code: 'INJECTED_FAILURE' });

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(1);

    const journal = await store.readJson(paths.chapterArtifact(1, 'commit_journal_v1.json'), CommitJournalSchema);
    expect(journal).toMatchObject({
      status: 'failed',
      stateWriteCompleted: true,
      queueCommitted: false
    });
    expect(journal.afterSnapshotId).toBeUndefined();
    expect(journal.phases.map((phase) => phase.phase)).toContain('failed');

    const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true }, store);
    expect(audit.exitCode).toBe(2);
    expect(audit.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'commit_journal',
          severity: 'critical',
          path: 'chapters/chapter_001/commit_journal_v1.json'
        })
      ])
    );
  });
});

async function prepareProject(): Promise<{ store: FileStore; paths: ProjectPaths }> {
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_commit_journal_build_bible' }, store);
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_commit_journal_plan_global' }, store);
  return { store, paths: new ProjectPaths(tempRoot, projectId) };
}

