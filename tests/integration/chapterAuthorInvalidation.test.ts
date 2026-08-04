import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { initProjectFromBriefText } from '../../src/app/initProject.js';
import {
  AuthorEditInvalidationReportSchema,
  AuthorRevisionRecordSchema,
  ChapterMissionSchema,
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  SceneCardsSchema
} from '../../src/schemas/index.js';
import {
  adoptDesktopChapterPlanRevision,
  createDesktopChapterPlanRevision,
  selectDesktopChapterDirection
} from '../../src/desktop/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let projectsRoot: string;
let paths: ProjectPaths;
let store: FileStore;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-author-invalidation-'));
  paths = new ProjectPaths(projectsRoot, 'author-invalidation');
  await initProjectFromBriefText({
    projectId: paths.projectId,
    projectsRoot,
    brief: '# Author Invalidation\n\nAdopt revisions conservatively.\n'
  });
  store = FileStore.forProject(paths.projectRoot);
  await writeChapterFixture();
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('chapter author invalidation', () => {
  test('saves an alternative revision without activation, then adopts it with narrow invalidation', async () => {
    const stateBefore = await store.readText(paths.storyState());
    const missionBefore = await store.readText(paths.chapterArtifact(1, 'mission.json'));
    const candidatesBefore = await readCandidates();
    const rankingBefore = await store.readText(paths.chapterArtifact(1, 'ranking.json'));

    const created = await createDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_002',
      expectedReviewHash: await reviewHash(),
      markdown: '# 交通事故调查\n\n作者收紧后的计划。\n'
    });

    expect(created.record).toMatchObject({
      artifactKind: 'selected_plan',
      sourceCandidateId: 'plan_002',
      state: 'ready'
    });
    expect(await store.readText(paths.chapterArtifact(1, 'ranking.json'))).toBe(rankingBefore);
    expect(await store.readText(paths.chapterArtifact(1, 'selected_plan.md')))
      .toBe(candidateMarkdown().plan_001);
    expect(await store.readText(paths.storyState())).toBe(stateBefore);

    const adopted = await adoptDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash
    });

    expect(adopted).toMatchObject({
      revisionId: created.record.revisionId,
      invalidatedNodes: ['scene_cards', 'scene_drafts', 'draft']
    });
    expect(await store.readText(paths.chapterArtifact(1, 'selected_plan.md')))
      .toBe('# 交通事故调查\n\n作者收紧后的计划。\n');
    expect((await store.readJson(
      paths.chapterArtifact(1, 'ranking.json'),
      ChapterPlanRankingSchema
    )).selectedCandidateId).toBe('plan_002');
    expect(await store.readText(paths.chapterArtifact(1, 'mission.json'))).toBe(missionBefore);
    expect(await readCandidates()).toEqual(candidatesBefore);
    expect(await store.readText(paths.storyState())).toBe(stateBefore);

    const record = await store.readJson(
      paths.projectArtifact(created.relativeRecordPath),
      AuthorRevisionRecordSchema
    );
    expect(record).toMatchObject({
      state: 'adopted',
      invalidationReportPath: adopted.invalidationReportPath,
      storyStateMutated: false
    });
    const report = await store.readJson(
      paths.projectArtifact(adopted.invalidationReportPath),
      AuthorEditInvalidationReportSchema
    );
    expect(report).toMatchObject({
      editedNode: 'selected_plan',
      invalidatedNodes: ['scene_cards', 'scene_drafts', 'draft'],
      queueAfter: { status: 'planned_ready', stage: 'ranking' },
      storyStateMutated: false
    });
    expect(report.archivedArtifacts.map(({ sourcePath }) => sourcePath)).toEqual([
      'chapters/chapter_001/selected_plan.md',
      'chapters/chapter_001/scene_cards.json',
      'chapters/chapter_001/scenes/scene_001.md',
      'chapters/chapter_001/draft_v1.md'
    ]);
  });

  test('supersedes the previous adopted plan revision', async () => {
    const first = await createDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_001',
      expectedReviewHash: await reviewHash(),
      markdown: '# 第一版作者计划\n'
    });
    await adoptDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: first.record.revisionId,
      expectedSourceHash: first.record.sourceHash
    });
    const second = await createDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_001',
      expectedReviewHash: await reviewHash(),
      markdown: '# 第二版作者计划\n'
    });
    await adoptDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: second.record.revisionId,
      expectedSourceHash: second.record.sourceHash
    });

    expect((await store.readJson(
      paths.projectArtifact(first.relativeRecordPath),
      AuthorRevisionRecordSchema
    )).state).toBe('superseded');
    expect((await store.readJson(
      paths.projectArtifact(second.relativeRecordPath),
      AuthorRevisionRecordSchema
    )).state).toBe('adopted');
  });

  test('restores ranking, selected plan, and queue when active replacement fails', async () => {
    const rankingBefore = await store.readText(paths.chapterArtifact(1, 'ranking.json'));
    const selectedBefore = await store.readText(paths.chapterArtifact(1, 'selected_plan.md'));
    const queueBefore = await store.readText(paths.chapterQueue());
    const stateBefore = await store.readText(paths.storyState());
    const failingStore = new FailOnceFileStore(paths.chapterArtifact(1, 'selected_plan.md'));

    await expect(selectDesktopChapterDirection({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_002',
      expectedReviewHash: await reviewHash()
    }, failingStore)).rejects.toThrow('injected selected-plan write failure');

    expect(await store.readText(paths.chapterArtifact(1, 'ranking.json'))).toBe(rankingBefore);
    expect(await store.readText(paths.chapterArtifact(1, 'selected_plan.md'))).toBe(selectedBefore);
    expect(await store.readText(paths.chapterQueue())).toBe(queueBefore);
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
  });

  test('rejects a stale plan revision source before adoption writes', async () => {
    const created = await createDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_001',
      expectedReviewHash: await reviewHash(),
      markdown: '# 作者计划\n'
    });
    const rankingBefore = await store.readText(paths.chapterArtifact(1, 'ranking.json'));
    const queueBefore = await store.readText(paths.chapterQueue());
    await store.writeText(paths.chapterArtifact(1, 'selected_plan.md'), '# 并发修改\n');

    await expect(adoptDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash
    })).rejects.toMatchObject({ code: 'AUTHOR_REVISION_SOURCE_STALE' });

    expect(await store.readText(paths.chapterArtifact(1, 'ranking.json'))).toBe(rankingBefore);
    expect(await store.readText(paths.chapterQueue())).toBe(queueBefore);
    expect((await store.readJson(
      paths.projectArtifact(created.relativeRecordPath),
      AuthorRevisionRecordSchema
    )).state).toBe('ready');
    await expect(store.exists(paths.chapterArtifact(1, 'author_revisions', 'edit_invalidation_report_v1.json')))
      .resolves.toBe(false);
  });
});

class FailOnceFileStore extends FileStore {
  private failed = false;

  constructor(private readonly targetPath: string) {
    super();
  }

  override async writeText(filePath: string, content: string): Promise<void> {
    if (!this.failed && path.resolve(filePath) === path.resolve(this.targetPath)) {
      this.failed = true;
      throw new Error('injected selected-plan write failure');
    }
    await super.writeText(filePath, content);
  }
}

async function writeChapterFixture(): Promise<void> {
  await store.ensureDir(paths.planningDir());
  await store.writeJson(paths.chapterQueue(), {
    schemaVersion: '1.0',
    projectId: paths.projectId,
    chapters: [{
      chapterNumber: 1,
      status: 'draft_ready',
      currentStage: 'draft_assembly',
      completedStages: [
        'mission', 'plan_candidates', 'ranking', 'scene_cards', 'scene_drafts', 'draft_assembly'
      ]
    }]
  }, ChapterQueueSchema);
  await store.ensureDir(paths.chapterArtifact(1, 'plan_candidates'));
  await store.writeJson(paths.chapterArtifact(1, 'mission.json'), {
    id: 'mission_ch001',
    chapterNumber: 1,
    chapterFunction: '建立事故调查线。',
    requiredObjectives: [],
    debtsToPayOrAdvance: [],
    debtsToIntroduce: [],
    characterDeltas: [],
    charactersToIntroduce: [],
    readerInformationDelta: {
      newKnowledge: [],
      newSuspicions: [],
      questionsToMaintain: [],
      questionsToAnswer: []
    },
    forbiddenMoves: [],
    targetEmotionalCurve: []
  }, ChapterMissionSchema);
  for (const [candidateId, markdown] of Object.entries(candidateMarkdown())) {
    await store.writeText(paths.chapterArtifact(1, 'plan_candidates', `${candidateId}.md`), markdown);
  }
  await store.writeJson(paths.chapterArtifact(1, 'ranking.json'), {
    chapterNumber: 1,
    candidates: Object.keys(candidateMarkdown()).map((candidateId) => ({
      candidateId,
      planPath: `chapters/chapter_001/plan_candidates/${candidateId}.md`,
      scores: {
        plot_progression: 8,
        character_arc_value: 7,
        tension_potential: 8,
        continuity_risk: 2,
        reader_hook_strength: 8,
        genre_satisfaction: 7
      },
      totalScore: 8,
      strengths: [],
      risks: []
    })),
    selectedCandidateId: 'plan_001',
    selectedPlanPath: 'chapters/chapter_001/selected_plan.md',
    rationale: '模型推荐'
  }, ChapterPlanRankingSchema);
  await store.writeText(paths.chapterArtifact(1, 'selected_plan.md'), candidateMarkdown().plan_001);
  await store.writeJson(paths.chapterArtifact(1, 'scene_cards.json'), [{
    sceneId: 'scene_001',
    chapterNumber: 1,
    order: 1,
    purpose: '调查事故。',
    conflict: '证词矛盾。',
    entryPoint: '抵达现场。',
    exitPoint: '发现线索。',
    characters: ['char_001'],
    location: '现场',
    time: '夜晚',
    informationDelta: [],
    emotionalShift: '警觉',
    readerEffect: '悬念',
    constraints: []
  }], SceneCardsSchema);
  await store.ensureDir(paths.chapterArtifact(1, 'scenes'));
  await store.writeText(paths.chapterArtifact(1, 'scenes', 'scene_001.md'), '# 旧场景\n');
  await store.writeText(paths.chapterArtifact(1, 'draft_v1.md'), '# 旧草稿\n');
}

function candidateMarkdown() {
  return {
    plan_001: '# 模型方向\n\n原始方案。\n',
    plan_002: '# 交通事故方向\n\n备选方案。\n',
    plan_003: '# 电话方向\n\n另一方案。\n'
  } as const;
}

async function reviewHash(): Promise<string> {
  const ranking = await store.readJson(
    paths.chapterArtifact(1, 'ranking.json'),
    ChapterPlanRankingSchema
  );
  const candidates = await Promise.all(
    ranking.candidates
      .map(({ candidateId }) => candidateId)
      .sort()
      .map(async (candidateId) => ({
        candidateId,
        hash: sha256(await store.readText(
          paths.chapterArtifact(1, 'plan_candidates', `${candidateId}.md`)
        ))
      }))
  );
  return sha256(JSON.stringify({
    chapterNumber: 1,
    missionHash: sha256(await store.readText(paths.chapterArtifact(1, 'mission.json'))),
    candidates,
    rankingHash: sha256(await store.readText(paths.chapterArtifact(1, 'ranking.json'))),
    selectedPlanHash: sha256(await store.readText(paths.chapterArtifact(1, 'selected_plan.md'))),
    queueHash: sha256(await store.readText(paths.chapterQueue())),
    storyStateHash: sha256(await store.readText(paths.storyState()))
  }));
}

async function readCandidates(): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(
    Object.keys(candidateMarkdown()).map(async (candidateId) => [
      candidateId,
      await store.readText(paths.chapterArtifact(1, 'plan_candidates', `${candidateId}.md`))
    ] as const)
  ));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
