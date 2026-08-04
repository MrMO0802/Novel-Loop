import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { adoptAuthorRevision, createAuthorRevision } from '../../src/app/chapterAuthorRevision.js';
import {
  adoptDesktopChapterDraft,
  readDesktopChapterDraft
} from '../../src/desktop/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import {
  AuthorRevisionAdoptionJournalSchema,
  AuthorEditInvalidationReportSchema,
  AuthorRevisionRecordSchema
} from '../../src/schemas/index.js';

const projectId = 'demo-novel';
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');
let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-desktop-draft-adoption-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  const briefPath = path.join(projectsRoot, 'brief.md');
  await writeFile(briefPath, '# Draft adoption\n\nA recoverable author draft.\n', 'utf8');
  await initProject({ projectId, projectsRoot, briefPath });
  await buildBible({ projectId, projectsRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'build_bible' });
  await planGlobal({ projectId, projectsRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'plan_global' });
  await runChapterDryRun({ projectId, projectsRoot, chapterNumber: 1, candidates: 3, provider: 'mock', promptRoot, fixturesRoot, runId: 'plan_chapter' });
  await runChapterUntilDraft({ projectId, projectsRoot, chapterNumber: 1, provider: 'mock', promptRoot, fixturesRoot, runId: 'draft_chapter' });
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('desktop draft adoption', () => {
  test('creates and activates an author draft revision without changing generated draft or Story State', async () => {
    const store = new FileStore();
    const generatedBefore = await readFile(paths.chapterArtifact(1, 'draft_v1.md'));
    const stateBefore = await readFile(paths.storyState());
    const queueBefore = await readFile(paths.chapterQueue());
    const current = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!current.available) throw new Error('Expected a generated draft.');

    await adoptDesktopChapterDraft({
      projectRoot: paths.projectRoot,
      markdown: `${current.markdown}\n\n作者采用的结尾。\n`,
      expectedSourceHash: createHash('sha256').update(current.markdown).digest('hex')
    });

    expect(await readFile(paths.chapterArtifact(1, 'draft_v1.md'))).toEqual(generatedBefore);
    expect(await readFile(paths.storyState())).toEqual(stateBefore);
    expect(await readFile(paths.chapterQueue())).toEqual(queueBefore);
    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
      available: true,
      versionKind: 'author_adopted',
      markdown: expect.stringContaining('作者采用的结尾。')
    });
    await expect(store.exists(paths.chapterArtifact(1, 'author_revisions', 'draft_revision_v1.md'))).resolves.toBe(true);
    const reportPath = paths.chapterArtifact(
      1,
      'author_revisions',
      'edit_invalidation_report_v1.json'
    );
    await expect(store.readJson(reportPath, AuthorEditInvalidationReportSchema))
      .resolves.toMatchObject({
        editedNode: 'draft',
        invalidatedNodes: ['future_diagnostics'],
        queueBefore: { status: 'draft_ready', stage: 'draft_assembly' },
        queueAfter: { status: 'draft_ready', stage: 'draft_assembly' },
        storyStateMutated: false
      });
    await expect(store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'draft_revision_v1.json'),
      AuthorRevisionRecordSchema
    )).resolves.toMatchObject({
      invalidationReportPath: 'chapters/chapter_001/author_revisions/edit_invalidation_report_v1.json'
    });
    await expect(store.exists(paths.chapterArtifact(1, 'diagnostics_v1.json')))
      .resolves.toBe(false);
  }, 30_000);

  test('rolls back the older adopted revision when the second adoption record write fails', async () => {
    const store = new FileStore();
    const initial = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!initial.available) throw new Error('Expected a generated draft.');
    await adoptDesktopChapterDraft({
      projectRoot: paths.projectRoot,
      markdown: `${initial.markdown}\n\n第一版。\n`,
      expectedSourceHash: initial.sourceHash
    }, store);
    const active = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!active.available) throw new Error('Expected an adopted draft.');
    const second = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'draft',
      mode: 'direct_edit',
      sourceArtifactPath: 'chapters/chapter_001/author_revisions/draft_revision_v1.md',
      sourceCandidateId: null,
      expectedSourceHash: active.sourceHash,
      content: `${active.markdown}\n\n第二版。\n`,
      authorInstruction: null
    }, store);
    const writeJson = store.writeJson.bind(store);
    let failed = false;
    store.writeJson = async (filePath, value, schema) => {
      if (!failed && filePath.endsWith('draft_revision_v2.json')) {
        failed = true;
        await writeJson(filePath, value, schema);
        throw new Error('forced post-write target failure');
      }
      return writeJson(filePath, value, schema);
    };

    await expect(adoptAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: second.record.revisionId,
      expectedSourceHash: active.sourceHash
    }, store)).rejects.toThrow('forced post-write target failure');
    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
      versionKind: 'author_adopted',
      markdown: expect.stringContaining('第一版。')
    });
    await expect(store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'draft_revision_v1.json'),
      AuthorRevisionRecordSchema
    )).resolves.toMatchObject({ state: 'adopted' });
    await expect(store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'draft_revision_v2.json'),
      AuthorRevisionRecordSchema
    )).resolves.toMatchObject({ state: 'ready', adoptedAt: null });
  }, 30_000);

  test('keeps the older adopted revision active when superseding it fails', async () => {
    const store = new FileStore();
    const initial = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!initial.available) throw new Error('Expected a generated draft.');
    await adoptDesktopChapterDraft({
      projectRoot: paths.projectRoot,
      markdown: `${initial.markdown}\n\n第一版。\n`,
      expectedSourceHash: initial.sourceHash
    }, store);
    const active = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!active.available) throw new Error('Expected an adopted draft.');
    const second = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'draft',
      mode: 'direct_edit',
      sourceArtifactPath: 'chapters/chapter_001/author_revisions/draft_revision_v1.md',
      sourceCandidateId: null,
      expectedSourceHash: active.sourceHash,
      content: `${active.markdown}\n\n第二版。\n`,
      authorInstruction: null
    }, store);
    const writeJson = store.writeJson.bind(store);
    let failed = false;
    store.writeJson = async (filePath, value, schema) => {
      if (!failed && filePath.endsWith('draft_revision_v1.json')) {
        failed = true;
        throw new Error('forced supersede failure');
      }
      return writeJson(filePath, value, schema);
    };

    await expect(adoptAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: second.record.revisionId,
      expectedSourceHash: active.sourceHash
    }, store)).rejects.toThrow('forced supersede failure');
    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .resolves.toMatchObject({
        versionKind: 'author_adopted',
        markdown: expect.stringContaining('第一版。')
      });
  }, 30_000);

  test('restores a superseded revision when its write persists and then throws', async () => {
    const store = new FileStore();
    const initial = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!initial.available) throw new Error('Expected a generated draft.');
    await adoptDesktopChapterDraft({
      projectRoot: paths.projectRoot,
      markdown: `${initial.markdown}\n\n第一版。\n`,
      expectedSourceHash: initial.sourceHash
    }, store);
    const active = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!active.available) throw new Error('Expected an adopted draft.');
    const second = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'draft',
      mode: 'direct_edit',
      sourceArtifactPath: 'chapters/chapter_001/author_revisions/draft_revision_v1.md',
      sourceCandidateId: null,
      expectedSourceHash: active.sourceHash,
      content: `${active.markdown}\n\n第二版。\n`,
      authorInstruction: null
    }, store);
    const writeJson = store.writeJson.bind(store);
    let failed = false;
    store.writeJson = async (filePath, value, schema) => {
      if (!failed && filePath.endsWith('draft_revision_v1.json')) {
        failed = true;
        await writeJson(filePath, value, schema);
        throw new Error('forced post-write supersede failure');
      }
      return writeJson(filePath, value, schema);
    };

    await expect(adoptAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: second.record.revisionId,
      expectedSourceHash: active.sourceHash
    }, store)).rejects.toThrow('forced post-write supersede failure');
    await expect(store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'draft_revision_v1.json'),
      AuthorRevisionRecordSchema
    )).resolves.toMatchObject({ state: 'adopted' });
    await expect(store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'draft_revision_v2.json'),
      AuthorRevisionRecordSchema
    )).resolves.toMatchObject({ state: 'ready', adoptedAt: null });
  }, 30_000);

  test('retains recovery provenance when adoption and its compensation both fail', async () => {
    const store = new FileStore();
    const initial = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!initial.available) throw new Error('Expected a generated draft.');
    await adoptDesktopChapterDraft({
      projectRoot: paths.projectRoot,
      markdown: `${initial.markdown}\n\n第一版。\n`,
      expectedSourceHash: initial.sourceHash
    }, store);
    const active = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!active.available) throw new Error('Expected an adopted draft.');
    const writeJson = store.writeJson.bind(store);
    let adoptedTargetWrites = 0;
    store.writeJson = async (filePath, value, schema) => {
      const recordState = typeof value === 'object'
        && value !== null
        && 'state' in value
        && typeof value.state === 'string'
        ? value.state
        : null;
      if (
        filePath.endsWith('draft_revision_v2.json')
        && (recordState === 'adopted' || adoptedTargetWrites > 0)
      ) {
        adoptedTargetWrites += 1;
        if (adoptedTargetWrites === 1) {
          await writeJson(filePath, value, schema);
          throw new Error('forced post-write adoption failure');
        }
        if (adoptedTargetWrites === 2) {
          throw new Error('forced target compensation failure');
        }
      }
      return writeJson(filePath, value, schema);
    };

    await expect(adoptDesktopChapterDraft({
      projectRoot: paths.projectRoot,
      markdown: `${active.markdown}\n\n第二版。\n`,
      expectedSourceHash: active.sourceHash
    }, store)).rejects.toMatchObject({ code: 'AUTHOR_REVISION_ROLLBACK_FAILED' });

    const target = await store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'draft_revision_v2.json'),
      AuthorRevisionRecordSchema
    );
    expect(target).toMatchObject({
      state: 'adopted',
      invalidationReportPath: 'chapters/chapter_001/author_revisions/edit_invalidation_report_v2.json'
    });
    await expect(store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'draft_revision_v1.json'),
      AuthorRevisionRecordSchema
    )).resolves.toMatchObject({ state: 'adopted' });
    await expect(store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'edit_invalidation_report_v2.json'),
      AuthorEditInvalidationReportSchema
    )).resolves.toMatchObject({
      revisionId: target.revisionId,
      invalidatedNodes: ['future_diagnostics'],
      storyStateMutated: false
    });
  }, 30_000);

  test('recovers a prepared adoption journal after a subprocess dies after superseding the active revision', async () => {
    const store = new FileStore();
    const generatedBefore = await readFile(paths.chapterArtifact(1, 'draft_v1.md'));
    const stateBefore = await readFile(paths.storyState());
    const queueBefore = await readFile(paths.chapterQueue());
    const initial = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!initial.available) throw new Error('Expected a generated draft.');
    await adoptDesktopChapterDraft({
      projectRoot: paths.projectRoot,
      markdown: `${initial.markdown}\n\n第一版。\n`,
      expectedSourceHash: initial.sourceHash
    });
    const active = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!active.available) throw new Error('Expected an adopted draft.');
    const payloadPath = path.join(projectsRoot, 'crash-adoption-payload.json');
    await writeFile(payloadPath, JSON.stringify({
      markdown: `${active.markdown}\n\n第二版。\n`,
      expectedSourceHash: active.sourceHash
    }), 'utf8');

    const child = spawn(process.execPath, [
      path.resolve('tests/fixtures/crash-draft-adoption.mjs'),
      paths.projectRoot,
      payloadPath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      }
    );
    expect(exit).toEqual({ code: null, signal: 'SIGKILL' });

    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .resolves.toMatchObject({
        available: true,
        versionKind: 'author_adopted',
        markdown: expect.stringContaining('第一版。')
      });
    const revisionDir = paths.chapterArtifact(1, 'author_revisions');
    const journalNames = (await store.list(revisionDir))
      .filter((name) => /^draft_adoption_journal_v\d+\.json$/u.test(name));
    expect(journalNames).toHaveLength(2);
    await expect(store.readJson(
      path.join(revisionDir, journalNames[1]!),
      AuthorRevisionAdoptionJournalSchema
    )).resolves.toMatchObject({
      state: 'recovered_rolled_back',
      recoveryReason: 'read_time_recovery',
      invalidationReportPath: 'chapters/chapter_001/author_revisions/edit_invalidation_report_v2.json',
      storyStateMutated: false
    });
    expect(await readFile(paths.chapterArtifact(1, 'draft_v1.md'))).toEqual(generatedBefore);
    expect(await readFile(paths.storyState())).toEqual(stateBefore);
    expect(await readFile(paths.chapterQueue())).toEqual(queueBefore);
  }, 30_000);
});
