import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import {
  AuthorEditInvalidationReportSchema,
  AuthorRevisionRecordSchema,
  ChapterDirectionSelectionSchema,
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
import { inspectDesktopNextChapter } from '../../src/desktop/chapterWorkspace.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let projectsRoot: string;
let paths: ProjectPaths;
let store: FileStore;
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

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
    await expectActiveDownstreamArtifacts(false);
    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
      available: true,
      phase: 'plan_ready'
    });
  });

  test('regenerates plan-adoption downstream artifacts instead of reusing archived outputs', async () => {
    await prepareGeneratedChapter();
    const rankingValue = await store.readJson(
      paths.chapterArtifact(1, 'ranking.json'),
      ChapterPlanRankingSchema
    );
    const alternative = rankingValue.candidates.find(
      ({ candidateId }) => candidateId !== rankingValue.selectedCandidateId
    )!;
    const stateBefore = await store.readText(paths.storyState());
    const revision = await createDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: alternative.candidateId,
      expectedReviewHash: await reviewHash(),
      markdown: '# 作者采用的替代方向\n\n重新生成下游。\n'
    });

    await adoptDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: revision.record.revisionId,
      expectedSourceHash: revision.record.sourceHash
    });

    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
      available: true,
      phase: 'plan_ready'
    });
    await expectActiveDownstreamArtifacts(false);
    const regenerated = await runChapterUntilDraft({
      projectId: paths.projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_plan_adoption_regenerated',
      enforceDesktopQueueTransitions: true
    });

    expect(regenerated.reusedArtifacts.some(isChapterDownstreamArtifact)).toBe(false);
    expect(regenerated.generatedArtifacts).toEqual(expect.arrayContaining([
      'chapters/chapter_001/scene_cards.json',
      'chapters/chapter_001/draft_v1.md'
    ]));
    await expectActiveDownstreamArtifacts(true);
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
  }, 30_000);

  test('records the original model recommendation before the first alternative revision switch', async () => {
    const created = await createDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_002',
      expectedReviewHash: await reviewHash(),
      markdown: '# 交通事故调查\n'
    });
    await adoptDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash
    });

    const adoptionSelection = await store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'direction_selection_v1.json'),
      ChapterDirectionSelectionSchema
    );
    expect(adoptionSelection).toMatchObject({
      previousCandidateId: 'plan_001',
      selectedCandidateId: 'plan_002',
      modelRecommendedCandidateId: 'plan_001'
    });

    await selectDesktopChapterDirection({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_003',
      expectedReviewHash: await reviewHash()
    });
    const laterSelection = await store.readJson(
      paths.chapterArtifact(1, 'author_revisions', 'direction_selection_v2.json'),
      ChapterDirectionSelectionSchema
    );
    expect(laterSelection.modelRecommendedCandidateId).toBe('plan_001');
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

  test('rejects repeated adoption before touching the immutable archive', async () => {
    const created = await createDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_001',
      expectedReviewHash: await reviewHash(),
      markdown: '# 已采用作者计划\n'
    });
    await adoptDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash
    });
    const record = await store.readJson(
      paths.projectArtifact(created.relativeRecordPath),
      AuthorRevisionRecordSchema
    );
    const archivedSourcePath = paths.projectArtifact(record.sourceArtifactPath);
    const archiveBefore = await store.readText(archivedSourcePath);
    const archiveHashBefore = sha256(archiveBefore);
    const archiveEntriesBefore = await store.list(path.dirname(archivedSourcePath));

    await expect(adoptDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: created.record.revisionId,
      expectedSourceHash: created.record.sourceHash
    })).rejects.toMatchObject({ code: 'DESKTOP_CHAPTER_REVISION_ALREADY_ADOPTED' });

    expect(await store.readText(archivedSourcePath)).toBe(archiveBefore);
    expect(sha256(await store.readText(archivedSourcePath))).toBe(archiveHashBefore);
    expect(await store.list(path.dirname(archivedSourcePath))).toEqual(archiveEntriesBefore);
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

  test('restores revision metadata and adoption provenance when the target record write fails', async () => {
    const first = await createDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_001',
      expectedReviewHash: await reviewHash(),
      markdown: '# 第一版已采用计划\n'
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
      candidateId: 'plan_002',
      expectedReviewHash: await reviewHash(),
      markdown: '# 第二版替代计划\n'
    });
    const firstRecordPath = paths.projectArtifact(first.relativeRecordPath);
    const secondRecordPath = paths.projectArtifact(second.relativeRecordPath);
    const before = {
      firstRecord: await store.readText(firstRecordPath),
      secondRecord: await store.readText(secondRecordPath),
      ranking: await store.readText(paths.chapterArtifact(1, 'ranking.json')),
      selectedPlan: await store.readText(paths.chapterArtifact(1, 'selected_plan.md')),
      queue: await store.readText(paths.chapterQueue()),
      storyState: await store.readText(paths.storyState())
    };
    const failingStore = new FailOnceFileStore(secondRecordPath);

    await expect(adoptDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: second.record.revisionId,
      expectedSourceHash: second.record.sourceHash
    }, failingStore)).rejects.toThrow('injected selected-plan write failure');

    expect(await store.readText(firstRecordPath)).toBe(before.firstRecord);
    expect(await store.readText(secondRecordPath)).toBe(before.secondRecord);
    expect(await store.readText(paths.chapterArtifact(1, 'ranking.json'))).toBe(before.ranking);
    expect(await store.readText(paths.chapterArtifact(1, 'selected_plan.md'))).toBe(before.selectedPlan);
    expect(await store.readText(paths.chapterQueue())).toBe(before.queue);
    expect(await store.readText(paths.storyState())).toBe(before.storyState);
    await expect(store.exists(paths.chapterArtifact(1, 'author_revisions', 'direction_selection_v1.json')))
      .resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'author_revisions', 'edit_invalidation_report_v2.json')))
      .resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(
      1,
      'author_revisions',
      'archive',
      second.record.revisionId
    ))).resolves.toBe(false);
  });

  test('retains recovery provenance and archive when rollback restoration fails', async () => {
    const first = await createDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      candidateId: 'plan_001',
      expectedReviewHash: await reviewHash(),
      markdown: '# First adopted author plan\n'
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
      candidateId: 'plan_002',
      expectedReviewHash: await reviewHash(),
      markdown: '# Alternative author plan\n'
    });
    const archiveDir = paths.chapterArtifact(
      1,
      'author_revisions',
      'archive',
      second.record.revisionId
    );
    const directionSelectionPath = paths.chapterArtifact(
      1,
      'author_revisions',
      'direction_selection_v1.json'
    );
    const invalidationReportPath = paths.chapterArtifact(
      1,
      'author_revisions',
      'edit_invalidation_report_v2.json'
    );
    const stateBefore = await store.readText(paths.storyState());
    const failingStore = new RollbackRestoreFailingFileStore(
      paths.projectArtifact(second.relativeRecordPath),
      paths.chapterArtifact(1, 'ranking.json')
    );

    await expect(adoptDesktopChapterPlanRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: second.record.revisionId,
      expectedSourceHash: second.record.sourceHash
    }, failingStore)).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_EDIT_ROLLBACK_FAILED',
      message: expect.stringMatching(
        /injected target revision write failure.*injected ranking restore failure/u
      )
    });

    await expect(store.exists(archiveDir)).resolves.toBe(true);
    await expect(store.exists(directionSelectionPath)).resolves.toBe(true);
    await expect(store.exists(invalidationReportPath)).resolves.toBe(true);
    const report = await store.readJson(
      invalidationReportPath,
      AuthorEditInvalidationReportSchema
    );
    const archivedSelectedPlan = report.archivedArtifacts.find(
      ({ node }) => node === 'selected_plan'
    )!;
    expect(sha256(await store.readText(
      paths.projectArtifact(archivedSelectedPlan.archivedPath)
    ))).toBe(archivedSelectedPlan.hash);
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
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

class RollbackRestoreFailingFileStore extends FileStore {
  private operationFailed = false;
  private restorePathWrites = 0;

  constructor(
    private readonly operationFailurePath: string,
    private readonly restoreFailurePath: string
  ) {
    super();
  }

  override async writeText(filePath: string, content: string): Promise<void> {
    if (
      !this.operationFailed
      && path.resolve(filePath) === path.resolve(this.operationFailurePath)
    ) {
      this.operationFailed = true;
      throw new Error('injected target revision write failure');
    }
    if (path.resolve(filePath) === path.resolve(this.restoreFailurePath)) {
      this.restorePathWrites += 1;
      if (this.restorePathWrites === 2) {
        throw new Error('injected ranking restore failure');
      }
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

async function prepareGeneratedChapter(): Promise<void> {
  await rm(paths.projectRoot, { recursive: true, force: true });
  await initProjectFromBriefText({
    projectId: paths.projectId,
    projectsRoot,
    brief: '# Author Invalidation\n\nAdopt revisions conservatively.\n'
  });
  store = FileStore.forProject(paths.projectRoot);
  await buildBible({
    projectId: paths.projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    runId: 'run_adoption_bible'
  });
  await planGlobal({
    projectId: paths.projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    runId: 'run_adoption_global'
  });
  const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
  await store.writeJson(paths.chapterQueue(), {
    ...queue,
    projectId: paths.projectId
  }, ChapterQueueSchema);
  await runChapterDryRun({
    projectId: paths.projectId,
    projectsRoot,
    chapterNumber: 1,
    candidates: 3,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    runId: 'run_adoption_planning',
    enforceDesktopQueueTransitions: true
  });
  await runChapterUntilDraft({
    projectId: paths.projectId,
    projectsRoot,
    chapterNumber: 1,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    runId: 'run_adoption_initial_draft',
    enforceDesktopQueueTransitions: true
  });
}

async function expectActiveDownstreamArtifacts(expected: boolean): Promise<void> {
  for (const artifactPath of [
    paths.chapterArtifact(1, 'scene_cards.json'),
    paths.chapterArtifact(1, 'scenes'),
    paths.chapterArtifact(1, 'draft_v1.md')
  ]) {
    await expect(store.exists(artifactPath)).resolves.toBe(expected);
  }
}

function isChapterDownstreamArtifact(artifactPath: string): boolean {
  return artifactPath === 'chapters/chapter_001/scene_cards.json'
    || artifactPath.startsWith('chapters/chapter_001/scenes/')
    || artifactPath === 'chapters/chapter_001/draft_v1.md';
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
