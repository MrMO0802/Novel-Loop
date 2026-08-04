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
  DiagnosticsReportSchema,
  SceneCardsSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import {
  adoptDesktopMissionRevision,
  createDesktopMissionRevision
} from '../../src/desktop/index.js';
import { inspectDesktopNextChapter } from '../../src/desktop/chapterWorkspace.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { validDiagnosticsReport } from '../fixtures/schemas/valid.js';

const projectId = 'desktop-mission-adoption';

let projectsRoot: string;
let paths: ProjectPaths;
let store: FileStore;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-mission-adoption-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Mission Adoption\n\nRepair the missing chapter-one participant.\n'
  });
  store = FileStore.forProject(paths.projectRoot);
  await writeChapterFixture();
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('desktop mission authoring', () => {
  test('creates a ready revision with an engine-owned deterministic provisional character ID', async () => {
    const stateBefore = await sha256File(paths.storyState());
    const activeBefore = await activeArtifactBytes();
    const sourceMissionHash = await sha256File(paths.chapterArtifact(1, 'mission.json'));

    const revision = await createDesktopMissionRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      edit: missionEdit(sourceMissionHash)
    });

    const expectedCharacterId = `char_provisional_${createHash('sha256')
      .update(`${projectId}\0${1}\0林默`)
      .digest('hex')
      .slice(0, 16)}`;
    expect(revision.record).toMatchObject({
      artifactKind: 'mission',
      sourceCandidateId: null,
      sourceHash: sourceMissionHash,
      state: 'ready',
      storyStateMutated: false
    });
    expect(revision.mission.requiredObjectives[0]?.id).toBe('obj_source');
    expect(revision.mission.requiredObjectives[1]?.id).toBe(
      `obj_author_${createHash('sha256')
        .update(`${projectId}\0${1}\0补充一条作者目标。`)
        .digest('hex')
        .slice(0, 16)}`
    );
    expect(revision.mission.charactersToIntroduce[0]).toMatchObject({
      characterId: expectedCharacterId,
      name: '林默',
      role: '调查者'
    });
    expect(revision.mission.charactersToIntroduce[0]?.characterId)
      .toMatch(/^char_provisional_[a-f0-9]{16}$/u);
    expect(revision.mission.participatingCharacterIds).toEqual([
      expectedCharacterId
    ]);
    expect(await store.readJson(
      paths.projectArtifact(revision.relativeMarkdownPath),
      ChapterMissionSchema
    )).toEqual(revision.mission);
    expect(await activeArtifactBytes()).toEqual(activeBefore);
    expect(await sha256File(paths.storyState())).toBe(stateBefore);
  });

  test('adopts the mission by archiving all generated planning and drafting artifacts', async () => {
    const stateBefore = await sha256File(paths.storyState());
    const sourceMission = await store.readText(paths.chapterArtifact(1, 'mission.json'));
    const sourceDiagnostics = await store.readText(
      paths.chapterArtifact(1, 'diagnostics_v1.json')
    );
    const revision = await createDesktopMissionRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      edit: missionEdit(sha256(sourceMission))
    });

    const adopted = await adoptDesktopMissionRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: revision.record.revisionId,
      expectedSourceHash: revision.record.sourceHash
    });

    expect(adopted).toMatchObject({
      chapterNumber: 1,
      revisionId: revision.record.revisionId,
      invalidatedNodes: [
        'plan_candidates',
        'ranking',
        'selected_plan',
        'scene_cards',
        'scene_drafts',
        'draft',
        'future_diagnostics'
      ],
      storyStateMutated: false
    });
    expect(await store.readJson(
      paths.chapterArtifact(1, 'mission.json'),
      ChapterMissionSchema
    )).toEqual(revision.mission);
    await expectMissionDownstream(false);
    expect(await store.readJson(paths.chapterQueue(), ChapterQueueSchema))
      .toMatchObject({
        chapters: [{
          chapterNumber: 1,
          status: 'planning',
          currentStage: 'mission',
          completedStages: [],
          failureReason: null
        }]
      });
    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot }))
      .resolves.toMatchObject({ available: true, phase: 'planning_partial' });
    expect(await sha256File(paths.storyState())).toBe(stateBefore);

    const report = await store.readJson(
      paths.projectArtifact(adopted.invalidationReportPath),
      AuthorEditInvalidationReportSchema
    );
    expect(report).toMatchObject({
      editedNode: 'mission',
      invalidatedNodes: adopted.invalidatedNodes,
      queueBefore: { status: 'draft_ready', stage: 'draft_assembly' },
      queueAfter: { status: 'planning', stage: 'mission' },
      storyStateMutated: false
    });
    expect(report.archivedArtifacts.map(({ sourcePath }) => sourcePath))
      .toEqual(expect.arrayContaining([
        'chapters/chapter_001/mission.json',
        'chapters/chapter_001/plan_candidates/plan_001.md',
        'chapters/chapter_001/plan_candidates/plan_002.md',
        'chapters/chapter_001/plan_candidates/plan_003.md',
        'chapters/chapter_001/ranking.json',
        'chapters/chapter_001/selected_plan.md',
        'chapters/chapter_001/scene_cards.json',
        'chapters/chapter_001/scenes/scene_001.md',
        'chapters/chapter_001/draft_v1.md',
        'chapters/chapter_001/diagnostics_v1.json'
      ]));
    const archivedMission = report.archivedArtifacts.find(
      ({ sourcePath }) => sourcePath === 'chapters/chapter_001/mission.json'
    );
    expect(archivedMission).toBeDefined();
    expect(await store.readText(paths.projectArtifact(archivedMission!.archivedPath)))
      .toBe(sourceMission);
    expect(archivedMission!.hash).toBe(sha256(sourceMission));
    const archivedDiagnostics = report.archivedArtifacts.find(
      ({ sourcePath }) => sourcePath === 'chapters/chapter_001/diagnostics_v1.json'
    );
    expect(archivedDiagnostics).toBeDefined();
    expect(await store.readText(paths.projectArtifact(archivedDiagnostics!.archivedPath)))
      .toBe(sourceDiagnostics);
    expect(archivedDiagnostics!.hash).toBe(sha256(sourceDiagnostics));

    const adoptedRecord = await store.readJson(
      paths.projectArtifact(revision.relativeRecordPath),
      AuthorRevisionRecordSchema
    );
    expect(adoptedRecord).toMatchObject({
      state: 'adopted',
      sourceArtifactPath: archivedMission!.archivedPath,
      invalidationReportPath: adopted.invalidationReportPath,
      storyStateMutated: false
    });
  });

  test('restores mission, generated artifacts, queue, and revision metadata when replacement fails', async () => {
    const revision = await createDesktopMissionRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      edit: missionEdit(await sha256File(paths.chapterArtifact(1, 'mission.json')))
    });
    const before = await activeArtifactBytes();
    const stateBefore = await store.readText(paths.storyState());
    const recordBefore = await store.readText(paths.projectArtifact(revision.relativeRecordPath));
    const failingStore = new FailOnceFileStore(paths.chapterArtifact(1, 'mission.json'));

    await expect(adoptDesktopMissionRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: revision.record.revisionId,
      expectedSourceHash: revision.record.sourceHash
    }, failingStore)).rejects.toThrow('injected mission write failure');

    expect(await activeArtifactBytes()).toEqual(before);
    expect(await store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json')))
      .toBe(before['diagnostics_v1.json']);
    expect(await store.readText(paths.storyState())).toBe(stateBefore);
    expect(await store.readText(paths.projectArtifact(revision.relativeRecordPath)))
      .toBe(recordBefore);
    await expect(store.exists(paths.chapterArtifact(
      1,
      'author_revisions',
      'edit_invalidation_report_v1.json'
    ))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(
      1,
      'author_revisions',
      'archive',
      revision.record.revisionId
    ))).resolves.toBe(false);
  });

  test('rejects invalid diagnostics before changing active mission artifacts', async () => {
    const revision = await createDesktopMissionRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      edit: missionEdit(await sha256File(paths.chapterArtifact(1, 'mission.json')))
    });
    await store.writeText(
      paths.chapterArtifact(1, 'diagnostics_v1.json'),
      '{"chapterNumber":1,"draftVersion":1}\n'
    );
    const before = await activeArtifactBytes();

    await expect(adoptDesktopMissionRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      revisionId: revision.record.revisionId,
      expectedSourceHash: revision.record.sourceHash
    })).rejects.toMatchObject({ name: 'ZodError' });

    expect(await activeArtifactBytes()).toEqual(before);
    await expect(store.exists(paths.chapterArtifact(
      1,
      'author_revisions',
      'archive',
      revision.record.revisionId
    ))).resolves.toBe(false);
  });

  test('rejects duplicate normalized participant names before writing a revision', async () => {
    const sourceMissionHash = await sha256File(paths.chapterArtifact(1, 'mission.json'));

    await expect(createDesktopMissionRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      edit: {
        ...missionEdit(sourceMissionHash),
        newCharacters: [
          { name: '林  默', role: '调查者' },
          { name: ' 林   默 ', role: '证人' }
        ]
      }
    })).rejects.toMatchObject({ code: 'DESKTOP_CHAPTER_EDIT_INVALID' });

    await expect(store.exists(paths.chapterArtifact(1, 'author_revisions')))
      .resolves.toBe(false);
  });

  test('rejects a generated participant ID collision with a source provisional ID', async () => {
    const normalizedName = '周谨';
    const collidingId = `char_provisional_${createHash('sha256')
      .update(`${projectId}\0${1}\0${normalizedName}`)
      .digest('hex')
      .slice(0, 16)}`;
    const sourceMission = await store.readJson(
      paths.chapterArtifact(1, 'mission.json'),
      ChapterMissionSchema
    );
    await store.writeJson(paths.chapterArtifact(1, 'mission.json'), {
      ...sourceMission,
      charactersToIntroduce: [{
        characterId: collidingId,
        name: '被移除的旧参与者',
        role: '旧角色'
      }]
    }, ChapterMissionSchema);
    const sourceMissionHash = await sha256File(paths.chapterArtifact(1, 'mission.json'));

    await expect(createDesktopMissionRevision({
      projectRoot: paths.projectRoot,
      chapterNumber: 1,
      edit: {
        ...missionEdit(sourceMissionHash),
        newCharacters: [{ name: normalizedName, role: '调查者' }]
      }
    })).rejects.toMatchObject({ code: 'DESKTOP_CHAPTER_EDIT_INVALID' });

    await expect(store.exists(paths.chapterArtifact(1, 'author_revisions')))
      .resolves.toBe(false);
  });
});

function missionEdit(sourceMissionHash: string) {
  return {
    sourceMissionHash,
    chapterFunction: '由林默调查被篡改的事故记录。',
    requiredObjectives: [
      {
        sourceObjectiveId: 'obj_source',
        text: '林默确认事故记录存在矛盾。',
        type: 'plot' as const,
        priority: 'must' as const
      },
      {
        sourceObjectiveId: null,
        text: '补充一条作者目标。',
        type: 'reader' as const,
        priority: 'should' as const
      }
    ],
    debtsToPayOrAdvance: [],
    debtsToIntroduce: [{
      type: 'mystery',
      promise: '是谁篡改了事故记录？',
      importance: 8
    }],
    characterDeltas: [],
    participatingCharacterIds: [],
    newCharacters: [{ name: '林默', role: '调查者' }],
    readerInformationDelta: {
      newKnowledge: ['事故记录被人修改过。'],
      newSuspicions: ['修改者接近调查部门。'],
      questionsToMaintain: ['谁修改了记录？'],
      questionsToAnswer: []
    },
    forbiddenMoves: ['不得揭晓幕后主使。'],
    targetEmotionalCurve: ['平静', '警觉'],
    targetWordCount: 3200
  };
}

async function writeChapterFixture(): Promise<void> {
  const storyState = await store.readJson(paths.storyState(), StoryStateSchema);
  await store.writeJson(paths.storyState(), {
    ...storyState,
    characters: []
  }, StoryStateSchema);
  await store.ensureDir(paths.planningDir());
  await store.writeJson(paths.chapterQueue(), {
    schemaVersion: '1.0',
    projectId,
    chapters: [{
      chapterNumber: 1,
      title: '事故记录',
      status: 'draft_ready',
      currentStage: 'draft_assembly',
      completedStages: [
        'mission',
        'plan_candidates',
        'ranking',
        'scene_cards',
        'scene_drafts',
        'draft_assembly'
      ],
      failureReason: 'old failure'
    }]
  }, ChapterQueueSchema);
  await store.ensureDir(paths.chapterArtifact(1, 'plan_candidates'));
  await store.writeJson(paths.chapterArtifact(1, 'mission.json'), {
    id: 'mission_ch001_generated',
    chapterNumber: 1,
    chapterFunction: '建立事故调查线。',
    requiredObjectives: [{
      id: 'obj_source',
      text: '取得第一条事故证词。',
      type: 'plot',
      priority: 'must'
    }],
    debtsToPayOrAdvance: [],
    debtsToIntroduce: [],
    characterDeltas: [],
    participatingCharacterIds: [],
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
    await store.writeText(
      paths.chapterArtifact(1, 'plan_candidates', `${candidateId}.md`),
      markdown
    );
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
  await store.writeText(
    paths.chapterArtifact(1, 'selected_plan.md'),
    candidateMarkdown().plan_001
  );
  await store.writeJson(paths.chapterArtifact(1, 'scene_cards.json'), [{
    sceneId: 'scene_001',
    chapterNumber: 1,
    order: 1,
    purpose: '调查事故。',
    conflict: '证词矛盾。',
    entryPoint: '抵达现场。',
    exitPoint: '发现线索。',
    characters: ['char_old'],
    location: '现场',
    time: '夜晚',
    informationDelta: [],
    emotionalShift: '警觉',
    readerEffect: '悬念',
    constraints: []
  }], SceneCardsSchema);
  await store.ensureDir(paths.chapterArtifact(1, 'scenes'));
  await store.writeText(
    paths.chapterArtifact(1, 'scenes', 'scene_001.md'),
    '# 旧场景\n'
  );
  await store.writeText(paths.chapterArtifact(1, 'draft_v1.md'), '# 旧草稿\n');
  await store.writeJson(paths.chapterArtifact(1, 'diagnostics_v1.json'), {
    ...validDiagnosticsReport,
    chapterNumber: 1,
    draftVersion: 1
  }, DiagnosticsReportSchema);
}

async function expectMissionDownstream(expected: boolean): Promise<void> {
  for (const artifactPath of [
    paths.chapterArtifact(1, 'plan_candidates'),
    paths.chapterArtifact(1, 'ranking.json'),
    paths.chapterArtifact(1, 'selected_plan.md'),
    paths.chapterArtifact(1, 'scene_cards.json'),
    paths.chapterArtifact(1, 'scenes'),
    paths.chapterArtifact(1, 'draft_v1.md'),
    paths.chapterArtifact(1, 'diagnostics_v1.json')
  ]) {
    await expect(store.exists(artifactPath)).resolves.toBe(expected);
  }
}

async function activeArtifactBytes(): Promise<Record<string, string>> {
  const relativePaths = [
    'mission.json',
    'plan_candidates/plan_001.md',
    'plan_candidates/plan_002.md',
    'plan_candidates/plan_003.md',
    'ranking.json',
    'selected_plan.md',
    'scene_cards.json',
    'scenes/scene_001.md',
    'draft_v1.md',
    'diagnostics_v1.json'
  ];
  const entries = await Promise.all(relativePaths.map(async (relativePath) => [
    relativePath,
    await store.readText(paths.chapterArtifact(1, relativePath))
  ] as const));
  entries.push(['planning/chapter_queue.json', await store.readText(paths.chapterQueue())]);
  return Object.fromEntries(entries);
}

function candidateMarkdown() {
  return {
    plan_001: '# 事故现场切入\n\n模型方向。\n',
    plan_002: '# 证词切入\n\n备选方向。\n',
    plan_003: '# 档案切入\n\n另一方向。\n'
  } as const;
}

async function sha256File(filePath: string): Promise<string> {
  return sha256(await store.readText(filePath));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

class FailOnceFileStore extends FileStore {
  private failed = false;

  constructor(private readonly targetPath: string) {
    super();
  }

  override async writeText(filePath: string, content: string): Promise<void> {
    if (!this.failed && path.resolve(filePath) === path.resolve(this.targetPath)) {
      this.failed = true;
      throw new Error('injected mission write failure');
    }
    await super.writeText(filePath, content);
  }
}
