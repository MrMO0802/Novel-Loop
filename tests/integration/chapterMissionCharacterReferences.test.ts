import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { planChapterMission } from '../../src/app/chapterPlanning.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { validCharacterState } from '../fixtures/schemas/valid.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

const projectId = 'mission-character-references';
const promptRoot = path.resolve('prompts');
const store = new FileStore();

let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-mission-character-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Mission Character References\n\nMara traces an impossible broadcast.\n'
  });
  await buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    runId: 'mission_character_bible'
  });
  await planGlobal({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot,
    runId: 'mission_character_global_plan'
  });
  const storyState = await store.readJson(paths.storyState(), StoryStateSchema);
  await store.writeJson(paths.storyState(), {
    ...storyState,
    characters: [{
      ...validCharacterState,
      id: 'char_mara',
      name: 'Mara Vale',
      currentGoal: 'Trace the source of the impossible broadcast.',
      emotionalState: 'Wary but determined',
      arc: {
        ...validCharacterState.arc,
        currentStage: 'Testing the first credible lead'
      },
      lastUpdatedChapter: 0
    }]
  }, StoryStateSchema);
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('Codex chapter mission character references', () => {
  test('supplies bounded non-default character context and accepts its returned reference', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'codex-mission-non-default-character');
    const runId = 'mission_non_default_character';

    const result = await planChapterMission({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId
    });

    expect(result.value.characterDeltas).toEqual([
      expect.objectContaining({ characterId: 'char_mara' })
    ]);
    const request = await store.readText(path.join(
      paths.runDir(runId),
      'prompts',
      'planning_plan_chapter_mission_slim_request.md'
    ));
    expect(request).toContain('"id": "char_mara"');
    expect(request).toContain('"name": "Mara Vale"');
    expect(request).toContain('"currentState":');
    expect(request).toContain('"currentGoal": "Trace the source of the impossible broadcast."');
    expect(request).not.toContain('char_lincheng');
  }, 30_000);

  test('rejects an unknown returned character ID before mission.json is written', async () => {
    const fake = await writeFakeCodex(projectsRoot, 'codex-mission-unknown-character');

    await expect(planChapterMission({
      projectId,
      projectsRoot,
      chapterNumber: 1,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'mission_unknown_character'
    })).rejects.toMatchObject({
      code: 'CHAPTER_MISSION_INVALID_PROVIDER_OUTPUT'
    });

    await expect(store.exists(paths.chapterArtifact(1, 'mission.json'))).resolves.toBe(false);
  }, 30_000);
});
