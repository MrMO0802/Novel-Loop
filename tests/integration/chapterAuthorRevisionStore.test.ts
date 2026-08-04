import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  adoptAuthorRevision,
  archiveInvalidatedChapterArtifacts,
  bindAuthorRevisionPublication,
  createAuthorRevision,
  discardReadyAuthorRevision,
  promoteAuthorRevisionPublication,
  readAuthorRevision,
  readLatestAdoptedDraft
} from '../../src/app/chapterAuthorRevision.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { AuthorRevisionRecordSchema, ChapterQueueSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let projectsRoot: string;
let paths: ProjectPaths;
let store: FileStore;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-author-revision-'));
  paths = new ProjectPaths(projectsRoot, 'demo-novel');
  await initProjectFromBriefText({
    projectId: paths.projectId,
    projectsRoot,
    brief: '# Demo Brief\n\nA bounded author revision test.\n'
  });
  store = FileStore.forProject(paths.projectRoot);
  await store.ensureDir(paths.planningDir());
  await store.writeJson(paths.chapterQueue(), {
    schemaVersion: '1.0',
    projectId: paths.projectId,
    chapters: [{
      chapterNumber: 1,
      status: 'planned_ready',
      currentStage: 'ranking'
    }]
  }, ChapterQueueSchema);
  await store.ensureDir(paths.chapterDir(1));
  await store.writeText(paths.chapterArtifact(1, 'selected_plan.md'), '# 原始方向\n\n保留来源。\n');
  await store.writeText(paths.chapterArtifact(1, 'draft_v1.md'), '# 原始正文\n\n保留来源。\n');
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('chapter author revision storage', () => {
  test('checks the expected source hash in the record source read before writing', async () => {
    const sourcePath = paths.chapterArtifact(1, 'selected_plan.md');
    const sourceBefore = await store.readText(sourcePath);
    await store.writeText(sourcePath, '# Mutated source\n\nNewer bytes.\n');

    await expect(createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'codex_adjustment',
      sourceArtifactPath: sourcePath,
      sourceCandidateId: 'plan_001',
      expectedSourceHash: hashText(sourceBefore),
      content: '# Stale adjustment\n',
      authorInstruction: 'Adjust the old source.'
    })).rejects.toMatchObject({ code: 'AUTHOR_REVISION_SOURCE_STALE' });

    await expect(authorRevisionFiles()).resolves.toEqual([]);
  });

  test('removes an uncommitted working copy when the revision record write fails', async () => {
    const sourcePath = paths.chapterArtifact(1, 'selected_plan.md');
    const source = await store.readText(sourcePath);
    vi.spyOn(store, 'writeJson').mockRejectedValueOnce(new Error('record write failed'));

    await expect(createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'codex_adjustment',
      sourceArtifactPath: sourcePath,
      sourceCandidateId: 'plan_001',
      expectedSourceHash: hashText(source),
      content: '# Candidate\n',
      authorInstruction: 'Adjust safely.'
    }, store)).rejects.toThrow('record write failed');

    await expect(authorRevisionFiles()).resolves.toEqual([]);
  });

  test('discards both files for a matching ready adjustment revision', async () => {
    const sourcePath = paths.chapterArtifact(1, 'selected_plan.md');
    const source = await store.readText(sourcePath);
    const created = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'codex_adjustment',
      sourceArtifactPath: sourcePath,
      sourceCandidateId: 'plan_001',
      expectedSourceHash: hashText(source),
      content: '# Candidate\n',
      authorInstruction: 'Adjust safely.'
    });

    await discardReadyAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash
    });

    await expect(store.exists(paths.projectArtifact(created.relativeRecordPath))).resolves.toBe(false);
    await expect(store.exists(paths.projectArtifact(created.relativeMarkdownPath))).resolves.toBe(false);
  });

  test('keeps an adjustment non-adoptable until durable publication binding is promoted', async () => {
    const sourcePath = paths.chapterArtifact(1, 'selected_plan.md');
    const source = await store.readText(sourcePath);
    const created = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'codex_adjustment',
      initialState: 'publishing',
      sourceArtifactPath: sourcePath,
      sourceCandidateId: 'plan_001',
      expectedSourceHash: hashText(source),
      content: '# Publishing candidate\n',
      authorInstruction: 'Adjust safely.'
    });

    expect(created.record).toMatchObject({
      state: 'publishing',
      publication: null
    });
    await expect(adoptAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId
    })).rejects.toMatchObject({ code: 'AUTHOR_REVISION_NOT_ADOPTABLE' });
    await expect(readAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash
    })).rejects.toMatchObject({ code: 'AUTHOR_REVISION_NOT_ADOPTABLE' });

    const bound = await bindAuthorRevisionPublication({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash,
      revisionToken: `chapter_revision_${'7'.repeat(48)}`,
      projectKey: 'project_radio',
      latestCommittedChapter: 0,
      purpose: 'plan'
    });
    expect(bound).toMatchObject({
      state: 'publishing',
      publication: {
        revisionToken: `chapter_revision_${'7'.repeat(48)}`,
        projectKey: 'project_radio',
        purpose: 'plan'
      }
    });
    await expect(adoptAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId
    })).rejects.toMatchObject({ code: 'AUTHOR_REVISION_NOT_ADOPTABLE' });

    const ready = await promoteAuthorRevisionPublication({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash,
      revisionToken: `chapter_revision_${'7'.repeat(48)}`
    });
    expect(ready.state).toBe('ready');
    await expect(readAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash
    })).resolves.toMatchObject({ record: { state: 'ready' } });
  });

  test('leaves schema-valid publishing records across bind, promotion, and cleanup failures', async () => {
    const sourcePath = paths.chapterArtifact(1, 'selected_plan.md');
    const source = await store.readText(sourcePath);
    const created = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'codex_adjustment',
      initialState: 'publishing',
      sourceArtifactPath: sourcePath,
      sourceCandidateId: 'plan_001',
      expectedSourceHash: hashText(source),
      content: '# Publishing candidate\n',
      authorInstruction: 'Adjust safely.'
    });
    const recordPath = paths.projectArtifact(created.relativeRecordPath);
    const originalWriteJson = store.writeJson.bind(store);
    vi.spyOn(store, 'writeJson').mockRejectedValueOnce(new Error('bind failed'));
    await expect(bindAuthorRevisionPublication({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash,
      revisionToken: `chapter_revision_${'8'.repeat(48)}`,
      projectKey: 'project_radio',
      latestCommittedChapter: 0,
      purpose: 'plan'
    }, store)).rejects.toThrow('bind failed');
    await expect(store.readJson(recordPath, AuthorRevisionRecordSchema)).resolves
      .toMatchObject({ state: 'publishing', publication: null });

    vi.mocked(store.writeJson).mockImplementation(originalWriteJson);
    await bindAuthorRevisionPublication({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash,
      revisionToken: `chapter_revision_${'8'.repeat(48)}`,
      projectKey: 'project_radio',
      latestCommittedChapter: 0,
      purpose: 'plan'
    }, store);
    vi.mocked(store.writeJson).mockRejectedValueOnce(new Error('promotion failed'));
    await expect(promoteAuthorRevisionPublication({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash,
      revisionToken: `chapter_revision_${'8'.repeat(48)}`
    }, store)).rejects.toThrow('promotion failed');
    await expect(store.readJson(recordPath, AuthorRevisionRecordSchema)).resolves
      .toMatchObject({
        state: 'publishing',
        publication: { revisionToken: `chapter_revision_${'8'.repeat(48)}` }
      });

    vi.spyOn(store, 'removePath').mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(discardReadyAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash
    }, store)).rejects.toThrow('cleanup failed');
    await expect(store.readJson(recordPath, AuthorRevisionRecordSchema)).resolves
      .toMatchObject({ state: 'publishing' });
  });

  test('creates sequential selected-plan revisions without changing Story State or generated sources', async () => {
    const stateBefore = await sha256(paths.storyState());
    const sourceBefore = await store.readText(paths.chapterArtifact(1, 'selected_plan.md'));
    const first = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'direct_edit',
      sourceArtifactPath: paths.chapterArtifact(1, 'selected_plan.md'),
      sourceCandidateId: 'plan_001',
      content: '# 新方向\n\n只改变章节计划。\n',
      authorInstruction: null
    });
    const second = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'codex_adjustment',
      sourceArtifactPath: paths.chapterArtifact(1, 'selected_plan.md'),
      sourceCandidateId: 'plan_001',
      content: '# 新方向二\n\n保留第一版。\n',
      authorInstruction: '压缩冲突，但不新增设定。'
    });

    expect(first.record.state).toBe('ready');
    expect(first.relativeMarkdownPath).toBe(
      'chapters/chapter_001/author_revisions/plan_revision_v1.md'
    );
    expect(second.relativeMarkdownPath).toBe(
      'chapters/chapter_001/author_revisions/plan_revision_v2.md'
    );
    expect(await store.readText(paths.projectArtifact(first.relativeMarkdownPath))).toBe('# 新方向\n\n只改变章节计划。\n');
    expect(await store.readText(paths.projectArtifact(second.relativeMarkdownPath))).toBe('# 新方向二\n\n保留第一版。\n');
    await expect(store.readJson(
      paths.projectArtifact(first.relativeRecordPath),
      AuthorRevisionRecordSchema
    )).resolves.toEqual(first.record);
    expect(await store.readText(paths.chapterArtifact(1, 'selected_plan.md'))).toBe(sourceBefore);
    expect(await sha256(paths.storyState())).toBe(stateBefore);
  });

  test('rejects a source outside the project root and rejects committed chapters', async () => {
    await expect(createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'direct_edit',
      sourceArtifactPath: path.join(paths.projectRoot, '..', 'outside.md'),
      sourceCandidateId: 'plan_001',
      content: '# 新方向\n',
      authorInstruction: null
    })).rejects.toThrow();

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    await store.writeJson(paths.storyState(), {
      ...state,
      latestCommittedChapter: 1
    }, StoryStateSchema);
    await expect(createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'direct_edit',
      sourceArtifactPath: paths.chapterArtifact(1, 'selected_plan.md'),
      sourceCandidateId: 'plan_001',
      content: '# 新方向\n',
      authorInstruction: null
    })).rejects.toThrow(/committed/u);
  });

  test('archives only selected-plan downstream artifacts and records missing optional files', async () => {
    const created = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'direct_edit',
      sourceArtifactPath: paths.chapterArtifact(1, 'selected_plan.md'),
      sourceCandidateId: 'plan_001',
      content: '# 新方向\n',
      authorInstruction: null
    });
    await store.writeText(paths.chapterArtifact(1, 'scene_cards.json'), validSceneCardsJson());
    await store.ensureDir(paths.chapterArtifact(1, 'scenes'));
    await store.writeText(paths.chapterArtifact(1, 'scenes', 'scene_001.md'), '# 场景\n');
    await store.writeText(paths.chapterArtifact(1, 'unrelated.md'), 'do not archive\n');

    const archived = await archiveInvalidatedChapterArtifacts({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      editedNode: 'selected_plan'
    });

    expect(archived.archivedArtifacts.map((artifact) => artifact.sourcePath)).toEqual([
      'chapters/chapter_001/scene_cards.json',
      'chapters/chapter_001/scenes/scene_001.md',
      'chapters/chapter_001/draft_v1.md'
    ]);
    expect(archived.missingArtifactPaths).toContain('chapters/chapter_001/diagnostics_v1.json');
    expect(await store.readText(paths.projectArtifact(
      'chapters/chapter_001/author_revisions/archive/author_revision_ch001_plan_v1/scenes/scene_001.md'
    ))).toBe('# 场景\n');
    await expect(store.exists(paths.projectArtifact(
      'chapters/chapter_001/author_revisions/archive/author_revision_ch001_plan_v1/unrelated.md'
    ))).resolves.toBe(false);
  });

  test('rejects malformed JSON before archiving an allowlisted artifact', async () => {
    const created = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'direct_edit',
      sourceArtifactPath: paths.chapterArtifact(1, 'selected_plan.md'),
      sourceCandidateId: 'plan_001',
      content: '# 新方向\n',
      authorInstruction: null
    });
    await store.writeText(paths.chapterArtifact(1, 'scene_cards.json'), '{"cards":[]}\n');

    await expect(archiveInvalidatedChapterArtifacts({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      editedNode: 'selected_plan'
    })).rejects.toThrow();
    await expect(store.exists(paths.projectArtifact(
      'chapters/chapter_001/author_revisions/archive/author_revision_ch001_plan_v1/scene_cards.json'
    ))).resolves.toBe(false);
  });

  test('adopts a draft revision and reads its validated latest working copy', async () => {
    const created = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'draft',
      mode: 'direct_edit',
      sourceArtifactPath: paths.chapterArtifact(1, 'draft_v1.md'),
      sourceCandidateId: null,
      content: '# 作者正文\n\n采用这份稿件。\n',
      authorInstruction: null
    });

    const adopted = await adoptAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId
    });
    const latest = await readLatestAdoptedDraft({
      projectRoot: paths.projectRoot,
      chapterNumber: 1
    });

    expect(adopted.state).toBe('adopted');
    expect(latest).toMatchObject({
      record: { revisionId: created.record.revisionId, state: 'adopted' },
      content: '# 作者正文\n\n采用这份稿件。\n'
    });
  });

  test('rejects a stale source before modifying the ready revision or protected state', async () => {
    const created = await createAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      mode: 'direct_edit',
      sourceArtifactPath: paths.chapterArtifact(1, 'selected_plan.md'),
      sourceCandidateId: 'plan_001',
      content: '# 作者方向\n\n基于原始来源。\n',
      authorInstruction: null
    });
    const recordPath = paths.projectArtifact(created.relativeRecordPath);
    const workingCopyPath = paths.projectArtifact(created.relativeMarkdownPath);
    const recordBefore = await store.readText(recordPath);
    const workingCopyBefore = await store.readText(workingCopyPath);
    const storyStateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());

    await store.writeText(paths.chapterArtifact(1, 'selected_plan.md'), '# 已变更来源\n\n不再匹配。\n');

    await expect(adoptAuthorRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId
    })).rejects.toMatchObject({ code: 'AUTHOR_REVISION_SOURCE_STALE' });

    expect(await store.readText(recordPath)).toBe(recordBefore);
    expect((await store.readJson(recordPath, AuthorRevisionRecordSchema)).state).toBe('ready');
    expect(await store.readText(workingCopyPath)).toBe(workingCopyBefore);
    expect(await store.readText(paths.storyState())).toBe(storyStateBefore);
    expect(await store.readText(paths.chapterQueue())).toBe(queueBefore);
  });
});

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await store.readText(filePath)).digest('hex');
}

function validSceneCardsJson(): string {
  return `${JSON.stringify([{
    sceneId: 'scene_001',
    chapterNumber: 1,
    order: 1,
    purpose: '推进调查。',
    conflict: '证词互相矛盾。',
    entryPoint: '主角抵达现场。',
    exitPoint: '主角发现线索。',
    characters: ['character_001'],
    location: '档案室',
    time: '夜晚',
    informationDelta: ['发现线索'],
    emotionalShift: '怀疑加深',
    readerEffect: '制造悬念',
    constraints: ['不得揭晓真相']
  }] as const)}\n`;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function authorRevisionFiles(): Promise<string[]> {
  const revisionDir = paths.chapterArtifact(1, 'author_revisions');
  return await store.exists(revisionDir) ? store.list(revisionDir) : [];
}
