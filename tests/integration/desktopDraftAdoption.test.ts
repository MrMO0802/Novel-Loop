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
    if (process.platform === 'win32') {
      expect(exit.signal).toBeNull();
      expect(exit.code).not.toBe(0);
    } else {
      expect(exit).toEqual({ code: null, signal: 'SIGKILL' });
    }

    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .resolves.toMatchObject({
        available: true,
        versionKind: 'author_adopted',
        markdown: expect.stringContaining('第一版。')
      });
    const revisionDir = paths.chapterArtifact(1, 'author_revisions');
    const journalNames = (await store.list(
      path.join(revisionDir, 'adoption_journal_archive')
    ))
      .filter((name) => /^draft_adoption_journal_v\d+\.json$/u.test(name));
    expect(journalNames).toHaveLength(2);
    await expect(store.readJson(
      path.join(revisionDir, 'adoption_journal_archive', journalNames[1]!),
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

  test('rejects a forged journal before it can overwrite canonical or unrelated files', async () => {
    const store = new FileStore();
    const revisionDir = paths.chapterArtifact(1, 'author_revisions');
    await store.ensureDir(revisionDir);
    const unrelatedPath = path.join(paths.projectRoot, 'notes', 'operator-note.json');
    await store.writeText(unrelatedPath, '{"kept":true}\n');
    const stateBefore = await readFile(paths.storyState());
    const queueBefore = await readFile(paths.chapterQueue());
    const generatedBefore = await readFile(paths.chapterArtifact(1, 'draft_v1.md'));
    const unrelatedBefore = await readFile(unrelatedPath);
    const createdAt = '2026-08-04T02:00:00.000Z';
    const target = forgedDraftRevision({
      revisionId: 'author_revision_ch001_draft_v999',
      workingCopyPath: 'planning/chapter_queue.md',
      state: 'ready',
      adoptedAt: null,
      createdAt
    });
    const unrelated = forgedDraftRevision({
      revisionId: 'author_revision_ch001_draft_v998',
      workingCopyPath: 'notes/operator-note.md',
      state: 'adopted',
      adoptedAt: createdAt,
      createdAt
    });
    await writeFile(
      path.join(revisionDir, 'draft_adoption_journal_v999.json'),
      `${JSON.stringify({
        schemaVersion: '1.0',
        journalId: 'author_adoption_ch001_draft_v999',
        projectId,
        chapterNumber: 1,
        artifactKind: 'draft',
        targetRevisionId: target.revisionId,
        invalidationReportPath: null,
        state: 'prepared',
        mutations: [{
          recordPath: 'planning/chapter_queue.json',
          beforeRecord: target,
          intendedRecord: { ...target, state: 'adopted', adoptedAt: createdAt }
        }, {
          recordPath: 'notes/operator-note.json',
          beforeRecord: unrelated,
          intendedRecord: { ...unrelated, state: 'superseded' }
        }],
        createdAt,
        updatedAt: createdAt,
        recoveryReason: null,
        storyStateMutated: false
      }, null, 2)}\n`,
      'utf8'
    );

    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .rejects.toBeDefined();
    expect(await readFile(paths.storyState())).toEqual(stateBefore);
    expect(await readFile(paths.chapterQueue())).toEqual(queueBefore);
    expect(await readFile(paths.chapterArtifact(1, 'draft_v1.md')))
      .toEqual(generatedBefore);
    expect(await readFile(unrelatedPath)).toEqual(unrelatedBefore);
  }, 30_000);

  test('fails closed when a prepared journal record is neither before nor intended', async () => {
    const store = new FileStore();
    const second = await prepareSecondDraftRevision(store);
    const firstRecordPath = paths.chapterArtifact(
      1,
      'author_revisions',
      'draft_revision_v1.json'
    );
    const secondRecordPath = paths.projectArtifact(second.relativeRecordPath);
    const firstBefore = await store.readJson(
      firstRecordPath,
      AuthorRevisionRecordSchema
    );
    const firstIntended = AuthorRevisionRecordSchema.parse({
      ...firstBefore,
      state: 'superseded'
    });
    const adoptedAt = '2026-08-04T03:00:00.000Z';
    const secondIntended = AuthorRevisionRecordSchema.parse({
      ...second.record,
      state: 'adopted',
      adoptedAt
    });
    const secondTampered = AuthorRevisionRecordSchema.parse({
      ...second.record,
      state: 'rejected'
    });
    await store.writeJson(firstRecordPath, firstIntended, AuthorRevisionRecordSchema);
    await store.writeJson(secondRecordPath, secondTampered, AuthorRevisionRecordSchema);
    const journal = AuthorRevisionAdoptionJournalSchema.parse({
      schemaVersion: '1.0',
      journalId: 'author_adoption_ch001_draft_v2',
      projectId,
      chapterNumber: 1,
      artifactKind: 'draft',
      targetRevisionId: second.record.revisionId,
      invalidationReportPath: null,
      state: 'prepared',
      mutations: [{
        recordPath: 'chapters/chapter_001/author_revisions/draft_revision_v1.json',
        beforeRecord: firstBefore,
        intendedRecord: firstIntended
      }, {
        recordPath: second.relativeRecordPath,
        beforeRecord: second.record,
        intendedRecord: secondIntended
      }],
      createdAt: adoptedAt,
      updatedAt: adoptedAt,
      recoveryReason: null,
      storyStateMutated: false
    });
    await store.writeJson(
      paths.chapterArtifact(1, 'author_revisions', 'draft_adoption_journal_v2.json'),
      journal,
      AuthorRevisionAdoptionJournalSchema
    );
    const stateBefore = await readFile(paths.storyState());
    const queueBefore = await readFile(paths.chapterQueue());
    const generatedBefore = await readFile(paths.chapterArtifact(1, 'draft_v1.md'));

    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .rejects.toMatchObject({ code: 'AUTHOR_REVISION_RECOVERY_FAILED' });
    await expect(store.readJson(firstRecordPath, AuthorRevisionRecordSchema))
      .resolves.toEqual(firstIntended);
    await expect(store.readJson(secondRecordPath, AuthorRevisionRecordSchema))
      .resolves.toEqual(secondTampered);
    expect(await readFile(paths.storyState())).toEqual(stateBefore);
    expect(await readFile(paths.chapterQueue())).toEqual(queueBefore);
    expect(await readFile(paths.chapterArtifact(1, 'draft_v1.md')))
      .toEqual(generatedBefore);
  }, 30_000);

  test('does not compensate a transaction after its committed marker persisted and then threw', async () => {
    const store = new FileStore();
    const second = await prepareSecondDraftRevision(store);
    const writeJson = store.writeJson.bind(store);
    let terminalPersisted = false;
    let compensationAttempts = 0;
    store.writeJson = async (filePath, value, schema) => {
      const state = recordState(value);
      if (
        !terminalPersisted
        && filePath.includes('_adoption_journal_')
        && state === 'committed'
      ) {
        terminalPersisted = true;
        await writeJson(filePath, value, schema);
        throw new Error('forced directory sync failure after committed marker');
      }
      if (terminalPersisted && filePath.includes('_revision_') && state !== null) {
        compensationAttempts += 1;
      }
      return writeJson(filePath, value, schema);
    };

    await expect(adoptAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: second.record.revisionId,
      expectedSourceHash: second.record.sourceHash
    }, store)).rejects.toMatchObject({
      code: 'AUTHOR_REVISION_COMMIT_DURABILITY_UNCERTAIN'
    });
    expect(compensationAttempts).toBe(0);
    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .resolves.toMatchObject({
        available: true,
        versionKind: 'author_adopted',
        markdown: expect.stringContaining('第二版。')
      });
  }, 30_000);

  test('keeps committed recovery deterministic even when compensation would fail', async () => {
    const store = new FileStore();
    const second = await prepareSecondDraftRevision(store);
    const writeJson = store.writeJson.bind(store);
    let terminalPersisted = false;
    let compensationAttempts = 0;
    store.writeJson = async (filePath, value, schema) => {
      const state = recordState(value);
      if (
        !terminalPersisted
        && filePath.includes('_adoption_journal_')
        && state === 'committed'
      ) {
        terminalPersisted = true;
        await writeJson(filePath, value, schema);
        throw new Error('forced directory sync failure after committed marker');
      }
      if (terminalPersisted && filePath.includes('_revision_') && state !== null) {
        compensationAttempts += 1;
        throw new Error('forced compensation failure');
      }
      return writeJson(filePath, value, schema);
    };

    await expect(adoptAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: second.record.revisionId,
      expectedSourceHash: second.record.sourceHash
    }, store)).rejects.toMatchObject({
      code: 'AUTHOR_REVISION_COMMIT_DURABILITY_UNCERTAIN'
    });
    expect(compensationAttempts).toBe(0);
    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .resolves.toMatchObject({
        available: true,
        versionKind: 'author_adopted',
        markdown: expect.stringContaining('第二版。')
      });
  }, 30_000);

  test('classifies terminal archive failure after commit without compensating records', async () => {
    const store = new FileStore();
    const second = await prepareSecondDraftRevision(store);
    const writeJson = store.writeJson.bind(store);
    let committedPersisted = false;
    let compensationAttempts = 0;
    store.writeJson = async (filePath, value, schema) => {
      const state = recordState(value);
      if (filePath.includes('adoption_journal_archive') && state === 'committed') {
        throw new Error('forced terminal archive failure');
      }
      if (
        !filePath.includes('adoption_journal_archive')
        && filePath.includes('_adoption_journal_')
        && state === 'committed'
      ) {
        await writeJson(filePath, value, schema);
        committedPersisted = true;
        return;
      }
      if (committedPersisted && filePath.includes('_revision_') && state !== null) {
        compensationAttempts += 1;
      }
      return writeJson(filePath, value, schema);
    };

    await expect(adoptAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: second.record.revisionId,
      expectedSourceHash: second.record.sourceHash
    }, store)).rejects.toMatchObject({
      code: 'AUTHOR_REVISION_COMMIT_DURABILITY_UNCERTAIN'
    });
    expect(compensationAttempts).toBe(0);
    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .resolves.toMatchObject({
        available: true,
        versionKind: 'author_adopted',
        markdown: expect.stringContaining('第二版。')
      });
  }, 30_000);

  test('archives terminal journals, bounds retention, and ignores damaged history', async () => {
    const store = new FileStore();
    for (let version = 1; version <= 11; version += 1) {
      const current = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
      if (!current.available) throw new Error('Expected an available draft.');
      await adoptDesktopChapterDraft({
        projectRoot: paths.projectRoot,
        markdown: `${current.markdown}\n\n作者版本 ${version}。\n`,
        expectedSourceHash: current.sourceHash
      }, store);
    }
    const revisionDir = paths.chapterArtifact(1, 'author_revisions');
    const archiveDir = path.join(revisionDir, 'adoption_journal_archive');
    const archived = (await store.list(archiveDir))
      .filter((name) => /^draft_adoption_journal_v\d+\.json$/u.test(name));
    expect(archived.length).toBeGreaterThan(0);
    expect(archived.length).toBeLessThanOrEqual(8);
    expect((await store.list(revisionDir)).filter(
      (name) => /^draft_adoption_journal_v\d+\.json$/u.test(name)
    )).toEqual([]);

    await writeFile(path.join(archiveDir, archived[0]!), '{damaged terminal', 'utf8');
    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .resolves.toMatchObject({
        available: true,
        versionKind: 'author_adopted',
        markdown: expect.stringContaining('作者版本 11。')
      });
  }, 30_000);

  test.each([
    {
      state: 'committed' as const,
      recoveryReason: null,
      expectedRecordState: 'intended' as const
    },
    {
      state: 'recovered_rolled_back' as const,
      recoveryReason: 'read_time_recovery' as const,
      expectedRecordState: 'before' as const
    }
  ])(
    'retains a $state terminal journal when current records do not all match $expectedRecordState',
    async ({ state, recoveryReason }) => {
      const store = new FileStore();
      const second = await prepareSecondDraftRevision(store);
      const revisionDir = paths.chapterArtifact(1, 'author_revisions');
      const firstPath = path.join(revisionDir, 'draft_revision_v1.json');
      const firstBefore = await store.readJson(firstPath, AuthorRevisionRecordSchema);
      const adoptedAt = '2026-08-05T01:00:00.000Z';
      const firstIntended = AuthorRevisionRecordSchema.parse({
        ...firstBefore,
        state: 'superseded'
      });
      const secondIntended = AuthorRevisionRecordSchema.parse({
        ...second.record,
        state: 'adopted',
        adoptedAt
      });
      await store.writeJson(firstPath, firstIntended, AuthorRevisionRecordSchema);
      await store.writeJson(
        paths.projectArtifact(second.relativeRecordPath),
        second.record,
        AuthorRevisionRecordSchema
      );
      const journalPath = path.join(revisionDir, 'draft_adoption_journal_v2.json');
      const journal = AuthorRevisionAdoptionJournalSchema.parse({
        schemaVersion: '1.0',
        journalId: 'author_adoption_ch001_draft_v2',
        projectId,
        chapterNumber: 1,
        artifactKind: 'draft',
        targetRevisionId: second.record.revisionId,
        invalidationReportPath: null,
        state,
        mutations: [{
          recordPath: 'chapters/chapter_001/author_revisions/draft_revision_v1.json',
          beforeRecord: firstBefore,
          intendedRecord: firstIntended
        }, {
          recordPath: second.relativeRecordPath,
          beforeRecord: second.record,
          intendedRecord: secondIntended
        }],
        createdAt: adoptedAt,
        updatedAt: adoptedAt,
        recoveryReason,
        storyStateMutated: false
      });
      await store.writeJson(journalPath, journal, AuthorRevisionAdoptionJournalSchema);

      await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
        .rejects.toMatchObject({ code: 'AUTHOR_REVISION_RECOVERY_FAILED' });
      await expect(store.exists(journalPath)).resolves.toBe(true);
      await expect(store.exists(path.join(
        revisionDir,
        'adoption_journal_archive',
        'draft_adoption_journal_v2.json'
      ))).resolves.toBe(false);
    },
    30_000
  );

  test('ignores unsafe historical version filenames without blocking future draft adoption', async () => {
    const store = new FileStore();
    const current = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    if (!current.available) throw new Error('Expected a generated draft.');
    const revisionDir = paths.chapterArtifact(1, 'author_revisions');
    const archiveDir = path.join(revisionDir, 'adoption_journal_archive');
    await store.ensureDir(archiveDir);
    const unsafeNames = [
      'draft_revision_v9007199254740991.json',
      'draft_revision_v9007199254740992.json',
      `draft_revision_v${'9'.repeat(128)}.json`,
      'draft_revision_v1e3.json',
      'draft_adoption_journal_v9007199254740991.json',
      'draft_adoption_journal_v9007199254740992.json',
      `draft_adoption_journal_v${'9'.repeat(128)}.json`,
      'draft_adoption_journal_v1e3.json'
    ];
    const unsafePaths = unsafeNames.flatMap((fileName) => (
      fileName.includes('_adoption_journal_')
        ? [path.join(revisionDir, fileName), path.join(archiveDir, fileName)]
        : [path.join(revisionDir, fileName)]
    ));
    for (const unsafePath of unsafePaths) {
      await writeFile(unsafePath, `unsafe:${path.relative(revisionDir, unsafePath)}\n`, 'utf8');
    }

    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .resolves.toMatchObject({ available: true, versionKind: 'generated' });
    await adoptDesktopChapterDraft({
      projectRoot: paths.projectRoot,
      markdown: `${current.markdown}\n\n安全版本编号后的作者正文。\n`,
      expectedSourceHash: current.sourceHash
    }, store);
    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .resolves.toMatchObject({
        available: true,
        versionKind: 'author_adopted',
        markdown: expect.stringContaining('安全版本编号后的作者正文。')
      });
    await expect(store.exists(path.join(
      revisionDir,
      'draft_revision_v1.json'
    ))).resolves.toBe(true);
    for (const unsafePath of unsafePaths) {
      await expect(readFile(unsafePath, 'utf8'))
        .resolves.toBe(`unsafe:${path.relative(revisionDir, unsafePath)}\n`);
    }
  }, 30_000);

  test('keeps a corrupt active nonterminal journal fail-closed', async () => {
    const store = new FileStore();
    const revisionDir = paths.chapterArtifact(1, 'author_revisions');
    await store.ensureDir(revisionDir);
    await writeFile(
      path.join(revisionDir, 'draft_adoption_journal_v1.json'),
      '{not a terminal journal',
      'utf8'
    );

    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot }))
      .rejects.toBeDefined();
  }, 30_000);
});

function forgedDraftRevision(input: {
  revisionId: string;
  workingCopyPath: string;
  state: 'ready' | 'adopted';
  adoptedAt: string | null;
  createdAt: string;
}) {
  return {
    schemaVersion: '1.0',
    revisionId: input.revisionId,
    projectId,
    chapterNumber: 1,
    artifactKind: 'draft',
    mode: 'direct_edit',
    sourceArtifactPath: 'chapters/chapter_001/draft_v1.md',
    sourceCandidateId: null,
    sourceHash: 'a'.repeat(64),
    workingCopyPath: input.workingCopyPath,
    workingCopyHash: 'b'.repeat(64),
    state: input.state,
    authorInstruction: null,
    createdAt: input.createdAt,
    adoptedAt: input.adoptedAt,
    invalidationReportPath: null,
    storyStateMutated: false
  };
}

async function prepareSecondDraftRevision(store: FileStore) {
  const initial = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
  if (!initial.available) throw new Error('Expected a generated draft.');
  await adoptDesktopChapterDraft({
    projectRoot: paths.projectRoot,
    markdown: `${initial.markdown}\n\n第一版。\n`,
    expectedSourceHash: initial.sourceHash
  }, store);
  const active = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
  if (!active.available) throw new Error('Expected an adopted draft.');
  return createAuthorRevision({
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
}

function recordState(value: unknown): string | null {
  return typeof value === 'object'
    && value !== null
    && 'state' in value
    && typeof value.state === 'string'
    ? value.state
    : null;
}
