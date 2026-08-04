import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  adjustChapterMission,
  adjustChapterPlan
} from '../../src/app/chapterAuthorAdjustment.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import {
  adjustDesktopChapterMission,
  adjustDesktopChapterPlan
} from '../../src/desktop/index.js';
import { ProviderFactory } from '../../src/llm/ProviderFactory.js';
import {
  ChapterMissionSchema,
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import {
  validChapterMission,
  validStoryState
} from '../fixtures/schemas/valid.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

const projectId = 'chapter-author-adjustment';
const chapterNumber = 1;
const promptRoot = path.resolve('prompts');

let projectsRoot: string;
let paths: ProjectPaths;
let store: FileStore;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-adjustment-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Bounded adjustment\n\nKeep every AI edit pending until adoption.\n'
  });
  store = FileStore.forProject(paths.projectRoot);
  await writeFixture();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('bounded Codex chapter author adjustments', () => {
  test('creates a ready unadopted mission revision without changing canonical artifacts or Story State', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'valid');
    const before = await canonicalSnapshot();
    const sourceHash = sha256(before.mission);

    const result = await adjustDesktopChapterMission({
      projectRoot: paths.projectRoot,
      chapterNumber,
      expectedSourceHash: sourceHash,
      authorInstruction: '把事故现场提前，但不要新增人物。',
      promptRoot,
      providerOptions: { codexBin: fake.codexBin }
    });

    expect(result.record).toMatchObject({
      artifactKind: 'mission',
      mode: 'codex_adjustment',
      sourceHash,
      sourceCandidateId: null,
      state: 'ready',
      adoptedAt: null,
      storyStateMutated: false
    });
    await expect(store.readJson(
      paths.projectArtifact(result.relativeMarkdownPath),
      ChapterMissionSchema
    )).resolves.toMatchObject({ chapterNumber });
    expect(await canonicalSnapshot()).toEqual(before);
    expect(await fakeCallCount(fake.statePath, 'planning.adjust_chapter_mission_slim'))
      .toBe(1);
  });

  test('adjusts a trusted alternative into a ready plan revision without selecting or adopting it', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'valid');
    const before = await canonicalSnapshot();
    const sourceContent = await store.readText(
      paths.chapterArtifact(chapterNumber, 'plan_candidates', 'plan_002.md')
    );

    const result = await adjustDesktopChapterPlan({
      projectRoot: paths.projectRoot,
      chapterNumber,
      expectedSourceHash: sha256(sourceContent),
      authorInstruction: '把开场提前到事故现场，但不要新增人物。',
      sourcePlan: {
        candidateId: 'plan_002',
        content: sourceContent,
        active: false
      },
      promptRoot,
      providerOptions: { codexBin: fake.codexBin }
    });

    expect(result.record).toMatchObject({
      artifactKind: 'selected_plan',
      mode: 'codex_adjustment',
      sourceCandidateId: 'plan_002',
      state: 'ready',
      adoptedAt: null,
      storyStateMutated: false
    });
    expect(await store.readText(paths.projectArtifact(result.relativeMarkdownPath)))
      .toContain('事故现场');
    expect(await canonicalSnapshot()).toEqual(before);
    expect(await fakeCallCount(fake.statePath, 'planning.adjust_plan_candidate_slim'))
      .toBe(1);
  });

  test.each([
    ['invalid JSON', 'invalid-json' as const],
    ['schema-invalid JSON', 'schema-invalid' as const]
  ])('rejects %s without writing an author revision or canonical artifact', async (
    _label,
    mode
  ) => {
    const fake = await writeFakeCodex(projectsRoot, mode);
    const before = await canonicalSnapshot();
    const sourceContent = await store.readText(
      paths.chapterArtifact(chapterNumber, 'plan_candidates', 'plan_002.md')
    );

    await expect(adjustChapterPlan({
      projectRoot: paths.projectRoot,
      chapterNumber,
      expectedSourceHash: sha256(sourceContent),
      authorInstruction: '只调整开场顺序。',
      sourcePlan: {
        candidateId: 'plan_002',
        content: sourceContent,
        active: false
      },
      promptRoot,
      providerOptions: {
        codexBin: fake.codexBin,
        codexJsonRetries: 0,
        codexJsonRepair: false
      }
    })).rejects.toBeDefined();

    expect(await canonicalSnapshot()).toEqual(before);
    await expect(authorRevisionFiles()).resolves.toEqual([]);
  });

  test('times out without adopting or changing Story State', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'slow-timeout');
    const before = await canonicalSnapshot();

    await expect(adjustChapterMission({
      projectRoot: paths.projectRoot,
      chapterNumber,
      expectedSourceHash: sha256(before.mission),
      authorInstruction: '收紧本章目标。',
      promptRoot,
      providerOptions: {
        codexBin: fake.codexBin,
        codexTimeoutMs: 25,
        codexJsonRetries: 0,
        codexJsonRepair: false
      }
    })).rejects.toBeDefined();

    expect(await canonicalSnapshot()).toEqual(before);
    await expect(authorRevisionFiles()).resolves.toEqual([]);
  });

  test('rejects stale source and overlong instructions before spawning Codex', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'valid');
    const before = await canonicalSnapshot();

    await expect(adjustChapterMission({
      projectRoot: paths.projectRoot,
      chapterNumber,
      expectedSourceHash: '0'.repeat(64),
      authorInstruction: '收紧本章目标。',
      promptRoot,
      providerOptions: { codexBin: fake.codexBin }
    })).rejects.toMatchObject({ code: 'AUTHOR_REVISION_SOURCE_STALE' });
    await expect(adjustChapterMission({
      projectRoot: paths.projectRoot,
      chapterNumber,
      expectedSourceHash: sha256(before.mission),
      authorInstruction: '调'.repeat(4_001),
      promptRoot,
      providerOptions: { codexBin: fake.codexBin }
    })).rejects.toMatchObject({ code: 'AUTHOR_ADJUSTMENT_INSTRUCTION_INVALID' });

    expect(await canonicalSnapshot()).toEqual(before);
    await expect(fakeCallCount(fake.statePath, 'planning.adjust_chapter_mission_slim'))
      .resolves.toBe(0);
    await expect(authorRevisionFiles()).resolves.toEqual([]);
  });

  test('honors cancellation before provider spawn and after validation before revision storage', async () => {
    const beforeFake = await writeFakeCodex(projectsRoot, 'valid');
    const before = await canonicalSnapshot();

    await expect(adjustChapterMission({
      projectRoot: paths.projectRoot,
      chapterNumber,
      expectedSourceHash: sha256(before.mission),
      authorInstruction: '收紧本章目标。',
      shouldCancel: () => true,
      promptRoot,
      providerOptions: { codexBin: beforeFake.codexBin }
    })).rejects.toMatchObject({ code: 'CHAPTER_ADJUSTMENT_CANCELLED' });
    await expect(fakeCallCount(
      beforeFake.statePath,
      'planning.adjust_chapter_mission_slim'
    )).resolves.toBe(0);

    const afterFake = await writeFakeCodex(projectsRoot, 'valid');
    let cancellationChecks = 0;
    await expect(adjustChapterMission({
      projectRoot: paths.projectRoot,
      chapterNumber,
      expectedSourceHash: sha256(before.mission),
      authorInstruction: '收紧本章目标。',
      shouldCancel: () => ++cancellationChecks >= 2,
      promptRoot,
      providerOptions: { codexBin: afterFake.codexBin }
    })).rejects.toMatchObject({ code: 'CHAPTER_ADJUSTMENT_CANCELLED' });

    expect(await fakeCallCount(afterFake.statePath, 'planning.adjust_chapter_mission_slim'))
      .toBe(1);
    expect(await canonicalSnapshot()).toEqual(before);
    await expect(authorRevisionFiles()).resolves.toEqual([]);
  });

  test('contains provider failures without partial canonical mutation', async () => {
    const before = await canonicalSnapshot();
    const complete = vi.fn().mockRejectedValue(
      Object.assign(new Error('provider failed'), { code: 'CODEX_EXEC_FAILED' })
    );
    vi.spyOn(ProviderFactory, 'create').mockReturnValue({ complete });

    await expect(adjustChapterMission({
      projectRoot: paths.projectRoot,
      chapterNumber,
      expectedSourceHash: sha256(before.mission),
      authorInstruction: '收紧本章目标。',
      promptRoot
    })).rejects.toMatchObject({ code: 'CODEX_EXEC_FAILED' });

    expect(complete).toHaveBeenCalledOnce();
    expect(await canonicalSnapshot()).toEqual(before);
    await expect(authorRevisionFiles()).resolves.toEqual([]);
  });
});

async function writeFixture(): Promise<void> {
  await store.writeJson(paths.storyState(), {
    ...validStoryState,
    projectId,
    latestCommittedChapter: 0
  }, StoryStateSchema);
  await store.ensureDir(paths.planningDir());
  await store.writeJson(paths.chapterQueue(), {
    schemaVersion: '1.0',
    projectId,
    chapters: [{
      chapterNumber,
      title: '事故切口',
      status: 'planned_ready',
      currentStage: 'ranking',
      completedStages: ['mission', 'plan_candidates', 'ranking'],
      failureReason: null
    }]
  }, ChapterQueueSchema);
  await store.ensureDir(paths.chapterArtifact(chapterNumber, 'plan_candidates'));
  await store.writeJson(paths.chapterArtifact(chapterNumber, 'mission.json'), {
    ...validChapterMission,
    id: 'mission_ch001',
    chapterNumber,
    participatingCharacterIds: ['char_lincheng'],
    charactersToIntroduce: []
  }, ChapterMissionSchema);
  const candidates = {
    plan_001: '# 失踪记录\n\n从被删除的记录开始。\n',
    plan_002: '# 交通事故\n\n从重复事故开始。\n'
  };
  for (const [candidateId, markdown] of Object.entries(candidates)) {
    await store.writeText(
      paths.chapterArtifact(chapterNumber, 'plan_candidates', `${candidateId}.md`),
      markdown
    );
  }
  await store.writeJson(paths.chapterArtifact(chapterNumber, 'ranking.json'), {
    chapterNumber,
    candidates: Object.keys(candidates).map((candidateId) => ({
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
    rationale: '从失踪记录开始。'
  }, ChapterPlanRankingSchema);
  await store.writeText(
    paths.chapterArtifact(chapterNumber, 'selected_plan.md'),
    candidates.plan_001
  );
}

async function canonicalSnapshot() {
  return {
    storyState: await store.readText(paths.storyState()),
    queue: await store.readText(paths.chapterQueue()),
    mission: await store.readText(paths.chapterArtifact(chapterNumber, 'mission.json')),
    ranking: await store.readText(paths.chapterArtifact(chapterNumber, 'ranking.json')),
    selectedPlan: await store.readText(paths.chapterArtifact(chapterNumber, 'selected_plan.md')),
    planOne: await store.readText(paths.chapterArtifact(
      chapterNumber,
      'plan_candidates',
      'plan_001.md'
    )),
    planTwo: await store.readText(paths.chapterArtifact(
      chapterNumber,
      'plan_candidates',
      'plan_002.md'
    ))
  };
}

async function authorRevisionFiles(): Promise<string[]> {
  const revisionDir = paths.chapterArtifact(chapterNumber, 'author_revisions');
  return await store.exists(revisionDir) ? store.list(revisionDir) : [];
}

async function fakeCallCount(statePath: string, promptId: string): Promise<number> {
  if (!(await new FileStore().exists(statePath))) return 0;
  const state = JSON.parse(await new FileStore().readText(statePath)) as Record<
    string,
    number
  >;
  return state[`${promptId}:json:normal`] ?? 0;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
