import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { planChapterMission } from '../../src/app/chapterPlanning.js';
import { buildBible } from '../../src/app/buildBible.js';
import { initProject } from '../../src/app/initProject.js';
import { inspectProject } from '../../src/app/inspectProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { validateProject } from '../../src/app/validateProject.js';
import { resolveChapterSelector } from '../../src/cli/commands/chapter.js';
import { ChapterMissionSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

let tempRoot: string;

const projectId = 'demo-novel';
const briefPath = path.resolve('examples/brief.md');
const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m13-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('multi-chapter progression', () => {
  test('commits chapter 1, next chapter 2, and next chapter 3 using committed Story State', async () => {
    const paths = await prepareProject();
    const store = new FileStore();

    await commitChapter(1, 'chapter_001');
    await expect(resolveChapterSelector({ projectId, projectsRoot: tempRoot, selector: 'next' })).resolves.toBe(2);

    await commitChapter(2, 'chapter_002');
    await expect(resolveChapterSelector({ projectId, projectsRoot: tempRoot, selector: 'next' })).resolves.toBe(3);

    await commitChapter(3, 'chapter_003');

    const validation = await validateProject({ projectId, projectsRoot: tempRoot });
    expect(validation.ok).toBe(true);

    const inspectOutput = await inspectProject({
      projectId,
      projectsRoot: tempRoot,
      debts: true,
      reader: true,
      characters: true,
      timeline: true,
      foreshadowing: true
    });
    expect(inspectOutput).toContain('Latest committed chapter: 3');
    expect(inspectOutput).toContain('event_ch003_control_room');
    expect(inspectOutput).toContain('fs_ch002_elevator_record');

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(3);
    expect(state.canonFacts.map((fact) => fact.id)).toEqual([
      'fact_ch001_radio_purchase',
      'fact_ch001_radio_distress',
      'fact_ch002_real_address',
      'fact_ch002_elevator_record',
      'fact_ch003_control_room',
      'fact_ch003_missing_resident'
    ]);
    expect(state.timeline.map((event) => event.id)).toEqual([
      'event_ch001_market',
      'event_ch001_room',
      'event_ch002_stairwell',
      'event_ch002_elevator',
      'event_ch003_archive',
      'event_ch003_control_room'
    ]);
    expect(state.characters.find((character) => character.id === 'char_lincheng')).toMatchObject({
      currentGoal: '找到十七楼求救声背后的失踪住户',
      emotionalState: '主动追查'
    });
    expect(state.narrativeDebts.find((debt) => debt.id === 'debt_ch001_seventeenth_floor')?.status).toBe('partially_paid');
    expect(state.narrativeDebts.find((debt) => debt.id === 'debt_ch002_missing_resident')?.status).toBe('resolved');
    expect(state.foreshadowing.find((item) => item.id === 'fs_ch001_scratched_floor_number')?.status).toBe('partially_paid');
    expect(state.foreshadowing.find((item) => item.id === 'fs_ch002_elevator_record')?.status).toBe('resolved');
    expect(state.readerState.readerKnows).toContain('十七楼曾有住户在电梯监控中消失');
    expect(state.readerState.readerSuspects).toContain('旧收音机正在引导林澈重走失踪者路线');
    expect(state.readerState.readerExpectations).toContain('林澈会追查失踪住户与母亲失踪案的关系');
  });

  test('rejects repeat commit of an already committed chapter by default', async () => {
    await prepareProject();
    await commitChapter(1, 'chapter_001');

    await expect(commitChapter(1, 'chapter_001_repeat')).rejects.toMatchObject({
      code: 'CHAPTER_ALREADY_COMMITTED'
    });
  });

  test('plans chapter 2 mission from chapter 1 committed narrative debts', async () => {
    const paths = await prepareProject();
    const store = new FileStore();
    await commitChapter(1, 'chapter_001');

    const mission = await planChapterMission({
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 2,
      provider: 'mock',
      promptRoot,
      fixturesRoot
    });

    expect(mission.value.chapterNumber).toBe(2);
    expect(mission.value.debtsToPayOrAdvance).toContain('debt_ch001_seventeenth_floor');
    const writtenMission = await store.readJson(paths.chapterArtifact(2, 'mission.json'), ChapterMissionSchema);
    expect(writtenMission.readerInformationDelta.questionsToMaintain).toContain('十七楼求救声来自哪里？');
  });

  test('chapter 3 canon patch appends without overwriting chapter 1 and chapter 2 canon facts', async () => {
    const paths = await prepareProject();
    const store = new FileStore();
    await commitChapter(1, 'chapter_001');
    await commitChapter(2, 'chapter_002');
    await commitChapter(3, 'chapter_003');

    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    const factIds = state.canonFacts.map((fact) => fact.id);
    expect(new Set(factIds).size).toBe(factIds.length);
    expect(factIds).toContain('fact_ch001_radio_purchase');
    expect(factIds).toContain('fact_ch002_real_address');
    expect(factIds).toContain('fact_ch003_control_room');
  });
});

async function prepareProject(): Promise<ProjectPaths> {
  await initProject({ projectId, briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m13_build_bible' });
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_m13_plan_global' });
  return new ProjectPaths(tempRoot, projectId);
}

async function commitChapter(chapterNumber: number, runSuffix: string) {
  return runChapterFullProduction({
    projectId,
    projectsRoot: tempRoot,
    chapterNumber,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    candidates: 3,
    maxRevisions: 2,
    commit: true,
    planningRunId: `run_m13_${runSuffix}_planning`,
    draftRunId: `run_m13_${runSuffix}_draft`,
    runId: `run_m13_${runSuffix}_revision`
  });
}
