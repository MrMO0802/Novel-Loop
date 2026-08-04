import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { initProjectFromBriefText } from '../../src/app/initProject.js';
import {
  AuthorEditInvalidationReportSchema,
  ChapterDirectionSelectionSchema,
  ChapterMissionSchema,
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  SceneCardsSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { selectDesktopChapterDirection } from '../../src/desktop/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let projectsRoot: string;
let paths: ProjectPaths;
let store: FileStore;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-direction-selection-'));
  paths = new ProjectPaths(projectsRoot, 'direction-selection');
  await initProjectFromBriefText({
    projectId: paths.projectId,
    projectsRoot,
    brief: '# Direction Selection\n\nChoose an author-controlled chapter direction.\n'
  });
  store = FileStore.forProject(paths.projectRoot);
  await writeChapterFixture();
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('desktop chapter direction selection', () => {
  test('atomically selects a candidate, archives downstream work, and preserves Story State and candidates', async () => {
    const expectedReviewHash = await reviewHash();
    const stateBefore = await sha256File(paths.storyState());
    const candidatesBefore = await readCandidates();

    const result = await selectDesktopChapterDirection({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_002',
      expectedReviewHash
    });

    expect(result.selectedTitle).toBe('从交通事故切入');
    expect(result.invalidatedNodes).toEqual([
      'selected_plan', 'scene_cards', 'scene_drafts', 'draft'
    ]);
    expect((await store.readJson(
      paths.chapterArtifact(1, 'ranking.json'),
      ChapterPlanRankingSchema
    )).selectedCandidateId).toBe('plan_002');
    expect(await store.readText(paths.chapterArtifact(1, 'selected_plan.md')))
      .toContain('# 从交通事故切入');
    expect(await sha256File(paths.storyState())).toBe(stateBefore);
    expect(await readCandidates()).toEqual(candidatesBefore);

    const selection = await store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'direction_selection_v1.json'),
      ChapterDirectionSelectionSchema
    );
    const invalidation = await store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'edit_invalidation_report_v1.json'),
      AuthorEditInvalidationReportSchema
    );
    expect(selection).toMatchObject({
      previousCandidateId: 'plan_001',
      selectedCandidateId: 'plan_002',
      modelRecommendedCandidateId: 'plan_001',
      differsFromModelRecommendation: true,
      sourceReviewHash: expectedReviewHash,
      storyStateMutated: false
    });
    expect(invalidation).toMatchObject({
      revisionId: selection.selectionId,
      editedNode: 'ranking',
      invalidatedNodes: ['selected_plan', 'scene_cards', 'scene_drafts', 'draft'],
      queueBefore: { status: 'draft_ready', stage: 'draft_assembly' },
      queueAfter: { status: 'planned_ready', stage: 'ranking' },
      storyStateMutated: false
    });
    expect(invalidation.archivedArtifacts.map(({ sourcePath }) => sourcePath)).toEqual([
      'chapters/chapter_001/selected_plan.md',
      'chapters/chapter_001/scene_cards.json',
      'chapters/chapter_001/scenes/scene_001.md',
      'chapters/chapter_001/draft_v1.md'
    ]);
    for (const artifact of invalidation.archivedArtifacts) {
      await expect(store.exists(paths.projectArtifact(artifact.archivedPath))).resolves.toBe(true);
    }
  });

  test('preserves the first model recommendation across later author selections', async () => {
    await selectDesktopChapterDirection({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_002',
      expectedReviewHash: await reviewHash()
    });
    await selectDesktopChapterDirection({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_003',
      expectedReviewHash: await reviewHash()
    });

    const second = await store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'direction_selection_v2.json'),
      ChapterDirectionSelectionSchema
    );
    expect(second).toMatchObject({
      previousCandidateId: 'plan_002',
      selectedCandidateId: 'plan_003',
      modelRecommendedCandidateId: 'plan_001',
      differsFromModelRecommendation: true
    });
  });

  test('rejects stale, unknown, and committed selections before author-control writes', async () => {
    const staleHash = await reviewHash();
    await store.writeText(
      paths.chapterArtifact(1, 'plan_candidates', 'plan_002.md'),
      '# 已变化的候选方向\n\n来源发生变化。\n'
    );
    await expect(selectDesktopChapterDirection({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_002',
      expectedReviewHash: staleHash
    })).rejects.toMatchObject({ code: 'DESKTOP_CHAPTER_EDIT_STALE' });
    await expect(store.exists(paths.chapterArtifact(1, 'author_revisions'))).resolves.toBe(false);

    await expect(selectDesktopChapterDirection({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_999',
      expectedReviewHash: await reviewHash()
    })).rejects.toMatchObject({ code: 'DESKTOP_CHAPTER_DIRECTION_UNKNOWN' });
    await expect(store.exists(paths.chapterArtifact(1, 'author_revisions'))).resolves.toBe(false);

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    await store.writeJson(paths.storyState(), {
      ...state,
      latestCommittedChapter: 1
    }, StoryStateSchema);
    const queueBefore = await store.readText(paths.chapterQueue());
    const rankingBefore = await store.readText(paths.chapterArtifact(1, 'ranking.json'));
    await expect(selectDesktopChapterDirection({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_001',
      expectedReviewHash: await reviewHash()
    })).rejects.toMatchObject({ code: 'DESKTOP_CHAPTER_EDIT_COMMITTED' });
    expect(await store.readText(paths.chapterQueue())).toBe(queueBefore);
    expect(await store.readText(paths.chapterArtifact(1, 'ranking.json'))).toBe(rankingBefore);
    await expect(store.exists(paths.chapterArtifact(1, 'author_revisions'))).resolves.toBe(false);
  });
});

async function writeChapterFixture(): Promise<void> {
  await store.ensureDir(paths.planningDir());
  await store.writeJson(paths.chapterQueue(), {
    schemaVersion: '1.0',
    projectId: paths.projectId,
    chapters: [{
      chapterNumber: 1,
      title: '事故切口',
      status: 'draft_ready',
      currentStage: 'draft_assembly',
      completedStages: [
        'mission', 'plan_candidates', 'ranking', 'scene_cards', 'scene_drafts', 'draft_assembly'
      ],
      failureReason: 'old failure'
    }]
  }, ChapterQueueSchema);
  await store.ensureDir(paths.chapterArtifact(1, 'plan_candidates'));
  await store.writeJson(paths.chapterArtifact(1, 'mission.json'), {
    id: 'mission_ch001',
    chapterNumber: 1,
    chapterFunction: '从异常事故建立调查线。',
    requiredObjectives: [{
      id: 'obj_001',
      text: '主角取得第一条矛盾证词。',
      type: 'plot',
      priority: 'must'
    }],
    debtsToPayOrAdvance: [],
    debtsToIntroduce: [],
    characterDeltas: [],
    charactersToIntroduce: [],
    readerInformationDelta: {
      newKnowledge: ['事故并非偶然'],
      newSuspicions: ['现场记录被改写'],
      questionsToMaintain: ['谁修改了记录？'],
      questionsToAnswer: []
    },
    forbiddenMoves: ['不得揭晓幕后主使'],
    targetEmotionalCurve: ['平静', '紧张'],
    targetWordCount: 3200
  }, ChapterMissionSchema);
  const candidates = candidateMarkdown();
  for (const [candidateId, markdown] of Object.entries(candidates)) {
    await store.writeText(
      paths.chapterArtifact(1, 'plan_candidates', `${candidateId}.md`),
      markdown
    );
  }
  await store.writeJson(paths.chapterArtifact(1, 'ranking.json'), ranking('plan_001'), ChapterPlanRankingSchema);
  await store.writeText(paths.chapterArtifact(1, 'selected_plan.md'), candidates.plan_001);
  await store.writeJson(paths.chapterArtifact(1, 'scene_cards.json'), [{
    sceneId: 'scene_001',
    chapterNumber: 1,
    order: 1,
    purpose: '核对事故记录。',
    conflict: '证词互相矛盾。',
    entryPoint: '主角抵达现场。',
    exitPoint: '主角发现删改痕迹。',
    characters: ['char_001'],
    location: '事故现场',
    time: '夜晚',
    informationDelta: ['记录被修改'],
    emotionalShift: '疑惑转为警觉',
    readerEffect: '建立悬念',
    constraints: ['不揭晓幕后主使']
  }], SceneCardsSchema);
  await store.ensureDir(paths.chapterArtifact(1, 'scenes'));
  await store.writeText(paths.chapterArtifact(1, 'scenes', 'scene_001.md'), '# 事故现场\n\n旧场景。\n');
  await store.writeText(paths.chapterArtifact(1, 'draft_v1.md'), '# 第一章\n\n旧草稿。\n');
}

function candidateMarkdown(): Record<'plan_001' | 'plan_002' | 'plan_003', string> {
  return {
    plan_001: '# 从失踪记录切入\n\n模型推荐方向。\n',
    plan_002: '# 从交通事故切入\n\n作者备选方向。\n',
    plan_003: '# 从匿名电话切入\n\n另一条作者方向。\n'
  };
}

function ranking(selectedCandidateId: string) {
  return {
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
      strengths: ['切口明确'],
      risks: ['节奏风险']
    })),
    selectedCandidateId,
    selectedPlanPath: 'chapters/chapter_001/selected_plan.md',
    rationale: '模型推荐：从失踪记录切入'
  };
}

async function reviewHash(): Promise<string> {
  const rankingValue = await store.readJson(
    paths.chapterArtifact(1, 'ranking.json'),
    ChapterPlanRankingSchema
  );
  const candidates = await Promise.all(
    rankingValue.candidates
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

async function sha256File(filePath: string): Promise<string> {
  return sha256(await store.readText(filePath));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
