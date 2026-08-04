import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../../../src/app/buildBible.js';
import { initProjectFromBriefText } from '../../../../src/app/initProject.js';
import { planGlobal } from '../../../../src/app/planGlobal.js';
import { ChapterQueueSchema, StoryStateSchema } from '../../../../src/schemas/index.js';
import { FileStore } from '../../../../src/storage/FileStore.js';
import { ProjectPaths } from '../../../../src/storage/ProjectPaths.js';
import { validCharacterState } from '../../../../tests/fixtures/schemas/valid.js';
import {
  writeFakeCodex,
  type FakeCodexMode
} from '../../../../tests/helpers/fakeCodex.js';
import { EngineChapterGateway } from '../../src/main/chapter/EngineChapterGateway';
import { ProjectChapterService } from '../../src/main/chapter/ProjectChapterService';

const temporaryDirectories: string[] = [];
const store = new FileStore();

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('chapter workspace Story State protection', () => {
  test('preserves Story State bytes after successful planning and drafting', async () => {
    const context = await createChapterProject('chapter-state-success', 'valid');
    const before = await sha256(context.paths.storyState());

    try {
      await context.gateway.plan(runInput(context.paths.projectRoot));
      expect(await sha256(context.paths.storyState())).toBe(before);
      const service = chapterServiceFor(context, 'project_state_success');
      const planReview = await service.readPlan('project_state_success');
      expect(planReview).toMatchObject({
        available: true,
        mission: {
          narrativePromises: [
            'Why does the radio speak without power?'
          ],
          characterDeltas: [
            expect.stringMatching(/skeptical.*alert/i)
          ]
        }
      });
      expect(JSON.stringify(planReview)).not.toMatch(
        /char_lincheng|mission_ch001_codex|debt_[a-z0-9_-]+|plan_\d|[a-f0-9]{64}|\/home\//i
      );

      await context.gateway.draft(runInput(context.paths.projectRoot));
      expect(await sha256(context.paths.storyState())).toBe(before);
      await expect(context.gateway.readDraft(context.paths.projectRoot))
        .resolves.toMatchObject({ available: true });
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('preserves Story State bytes after an engine execution failure', async () => {
    const context = await createChapterProject(
      'chapter-state-failure',
      'missing-output'
    );
    const before = await sha256(context.paths.storyState());

    try {
      await expect(context.gateway.plan(runInput(context.paths.projectRoot)))
        .rejects.toBeDefined();
      expect(await sha256(context.paths.storyState())).toBe(before);
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('preserves Story State bytes after cancellation', async () => {
    const context = await createChapterProject('chapter-state-cancel', 'valid');
    const before = await sha256(context.paths.storyState());
    let stopRequested = false;

    try {
      await expect(context.gateway.plan({
        ...runInput(context.paths.projectRoot),
        onProgress: (event) => {
          if (event.stage === 'mission' && event.state === 'completed') {
            stopRequested = true;
          }
        },
        shouldStop: () => stopRequested
      })).rejects.toMatchObject({ code: 'CHAPTER_PLANNING_CANCELLED' });
      expect(await sha256(context.paths.storyState())).toBe(before);
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('preserves Story State bytes through invalid output and artifact recovery', async () => {
    const context = await createChapterProject(
      'chapter-state-invalid-output',
      'invalid-json'
    );
    const before = await sha256(context.paths.storyState());

    try {
      await expect(context.gateway.plan(runInput(context.paths.projectRoot)))
        .rejects.toBeDefined();
      expect(await sha256(context.paths.storyState())).toBe(before);

      await context.useCodexMode('valid');
      await context.gateway.plan(runInput(context.paths.projectRoot));
      await expect(context.gateway.readPlan(context.paths.projectRoot))
        .resolves.toMatchObject({ available: true });
      expect(await sha256(context.paths.storyState())).toBe(before);
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('preserves Story State bytes after a drafting execution failure', async () => {
    const context = await createChapterProject(
      'chapter-state-draft-failure',
      'valid'
    );
    const before = await sha256(context.paths.storyState());

    try {
      await context.gateway.plan(runInput(context.paths.projectRoot));
      expect(await sha256(context.paths.storyState())).toBe(before);
      await context.useCodexMode('missing-output');

      await expect(context.gateway.draft(runInput(context.paths.projectRoot)))
        .rejects.toBeDefined();
      expect(await sha256(context.paths.storyState())).toBe(before);
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('preserves Story State bytes after drafting cancellation', async () => {
    const context = await createChapterProject(
      'chapter-state-draft-cancel',
      'valid'
    );
    const before = await sha256(context.paths.storyState());
    let stopRequested = false;

    try {
      await context.gateway.plan(runInput(context.paths.projectRoot));
      expect(await sha256(context.paths.storyState())).toBe(before);

      await expect(context.gateway.draft({
        ...runInput(context.paths.projectRoot),
        onProgress: (event) => {
          if (event.stage === 'scene_cards' && event.state === 'completed') {
            stopRequested = true;
          }
        },
        shouldStop: () => stopRequested
      })).rejects.toMatchObject({ code: 'CHAPTER_DRAFT_CANCELLED' });
      expect(await sha256(context.paths.storyState())).toBe(before);
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('preserves Story State bytes through drafting invalid output recovery', async () => {
    const context = await createChapterProject(
      'chapter-state-draft-invalid-output',
      'valid'
    );
    const before = await sha256(context.paths.storyState());

    try {
      await context.gateway.plan(runInput(context.paths.projectRoot));
      expect(await sha256(context.paths.storyState())).toBe(before);
      await context.useCodexMode('invalid-json');

      await expect(context.gateway.draft(runInput(context.paths.projectRoot)))
        .rejects.toBeDefined();
      expect(await sha256(context.paths.storyState())).toBe(before);

      await context.useCodexMode('valid');
      await context.gateway.draft(runInput(context.paths.projectRoot));
      await expect(context.gateway.readDraft(context.paths.projectRoot))
        .resolves.toMatchObject({ available: true });
      expect(await sha256(context.paths.storyState())).toBe(before);
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('preserves Story State bytes after opaque direction selection', async () => {
    const context = await createChapterProject(
      'chapter-state-direction-selection',
      'valid'
    );
    const before = await sha256(context.paths.storyState());
    const projectKey = 'project_state_direction';
    const service = chapterServiceFor(context, projectKey);

    try {
      await context.gateway.plan(runInput(context.paths.projectRoot));
      const review = await availablePlan(service, projectKey);
      const alternative = review.directions.find(({ active }) => !active)!;

      await expect(service.selectDirection({
        projectKey,
        reviewToken: review.reviewToken,
        optionToken: alternative.optionToken
      })).resolves.toEqual({ outcome: 'adopted' });
      expect(await sha256(context.paths.storyState())).toBe(before);
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('preserves Story State bytes while saving and adopting a plan revision', async () => {
    const context = await createChapterProject(
      'chapter-state-plan-revision',
      'valid'
    );
    const before = await sha256(context.paths.storyState());
    const projectKey = 'project_state_plan_revision';
    const service = chapterServiceFor(context, projectKey);

    try {
      await context.gateway.plan(runInput(context.paths.projectRoot));
      const review = await availablePlan(service, projectKey);
      const active = review.directions.find((direction) => direction.active)!;
      const saved = await service.savePlanWorkingCopy({
        projectKey,
        reviewToken: review.reviewToken,
        optionToken: active.optionToken,
        markdown: '# Author plan\n\nThe radio answers from the old building.\n'
      });
      expect(await sha256(context.paths.storyState())).toBe(before);
      if (saved.outcome !== 'saved') throw new Error('Expected plan save.');

      await expect(service.adoptRevision({
        projectKey,
        revisionToken: saved.revisionToken,
        confirmInvalidation: true
      })).resolves.toEqual({ outcome: 'adopted' });
      expect(await sha256(context.paths.storyState())).toBe(before);
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('preserves Story State bytes while resolving and adopting a mission edit', async () => {
    const context = await createChapterProject(
      'chapter-state-mission-revision',
      'valid'
    );
    const before = await sha256(context.paths.storyState());
    const projectKey = 'project_state_mission_revision';
    const service = chapterServiceFor(context, projectKey);

    try {
      await context.gateway.plan(runInput(context.paths.projectRoot));
      const review = await availablePlan(service, projectKey);
      const saved = await service.saveMissionWorkingCopy({
        projectKey,
        reviewToken: review.reviewToken,
        mission: {
          chapterFunction: review.mission.chapterFunction,
          requiredObjectives: review.mission.objectiveItems.map((item) => ({
            itemToken: item.itemToken,
            text: item.text,
            type: item.type,
            priority: item.priority
          })),
          debtTokens: review.mission.debtItems.map(({ itemToken }) => (
            itemToken
          )),
          debtsToIntroduce: review.mission.introducedDebts,
          characterDeltas: review.mission.characterDeltaItems.map((item) => ({
            participantToken: item.participantToken,
            from: item.from,
            to: item.to,
            evidenceRequired: item.evidenceRequired
          })),
          participantTokens: review.mission.participantOptions
            .filter(({ selected }) => selected)
            .map(({ participantToken }) => participantToken),
          newParticipants: [{ name: '许薇', role: '调查搭档' }],
          readerInformation: review.mission.readerInformation,
          forbiddenMoves: review.mission.forbiddenMoves,
          targetEmotionalCurve: review.mission.targetEmotionalCurve,
          targetWordCount: review.mission.targetWordCount
        }
      });
      expect(await sha256(context.paths.storyState())).toBe(before);
      if (saved.outcome !== 'saved') throw new Error('Expected mission save.');

      await expect(service.adoptRevision({
        projectKey,
        revisionToken: saved.revisionToken,
        confirmInvalidation: true
      })).resolves.toEqual({ outcome: 'adopted' });
      expect(await sha256(context.paths.storyState())).toBe(before);
    } finally {
      context.restoreCodexBin();
    }
  }, 30_000);

  test('serializes two real chapter service instances through the shared project lease', async () => {
    const context = await createChapterProject(
      'chapter-cross-service-lease',
      'pause-on-mission'
    );
    const projectKey = 'project_shared';
    const resolver = {
      resolveProjectRoot: async (candidate: string) => (
        candidate === projectKey ? context.paths.projectRoot : null
      )
    };
    const firstService = new ProjectChapterService({
      projects: resolver,
      gateway: new EngineChapterGateway()
    });
    const secondService = new ProjectChapterService({
      projects: resolver,
      gateway: new EngineChapterGateway()
    });

    try {
      const firstTask = await firstService.startPlanning(projectKey);
      await waitForFile(context.pausePath);
      const secondTask = await secondService.startPlanning(projectKey);

      await eventually(async () => {
        await expect(secondService.get(secondTask.taskId)).resolves.toMatchObject({
          status: 'failed',
          error: { kind: 'generation_busy' }
        });
      });
      expect(await promptCallCount(
        context.statePath,
        'planning.plan_chapter_mission_slim'
      )).toBe(1);

      await writeFile(context.releasePath, 'release\n', 'utf8');
      await eventually(async () => {
        await expect(firstService.get(firstTask.taskId)).resolves.toMatchObject({
          status: 'succeeded'
        });
      });
    } finally {
      await writeFile(context.releasePath, 'release\n', 'utf8');
      context.restoreCodexBin();
    }
  }, 30_000);
});

function runInput(projectRoot: string) {
  return {
    projectRoot,
    onProgress: () => undefined,
    shouldStop: () => false
  };
}

function chapterServiceFor(
  context: { gateway: EngineChapterGateway; paths: ProjectPaths },
  projectKey: string
): ProjectChapterService {
  return new ProjectChapterService({
    projects: {
      resolveProjectRoot: async (candidate) => (
        candidate === projectKey ? context.paths.projectRoot : null
      )
    },
    gateway: context.gateway
  });
}

async function availablePlan(
  service: ProjectChapterService,
  projectKey: string
) {
  const review = await service.readPlan(projectKey);
  if (!review.available) throw new Error('Expected an available plan review.');
  return review;
}

async function createChapterProject(
  projectId: string,
  fakeMode: FakeCodexMode
): Promise<{
  gateway: EngineChapterGateway;
  paths: ProjectPaths;
  projectsRoot: string;
  useCodexMode(mode: FakeCodexMode): Promise<void>;
  pausePath: string;
  releasePath: string;
  statePath: string;
  restoreCodexBin(): void;
}> {
  const projectsRoot = await mkdtemp(
    path.join(os.tmpdir(), 'novel-loop-chapter-state-')
  );
  temporaryDirectories.push(projectsRoot);
  const paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Chapter State Protection\n\nChapter work must not mutate Story State.\n'
  });
  await buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot: path.resolve('../../prompts'),
    runId: `${projectId}_bible`
  });
  await planGlobal({
    projectId,
    projectsRoot,
    provider: 'mock',
    promptRoot: path.resolve('../../prompts'),
    runId: `${projectId}_planning`
  });
  const storyState = await store.readJson(paths.storyState(), StoryStateSchema);
  await store.writeJson(paths.storyState(), {
    ...storyState,
    characters: [validCharacterState]
  }, StoryStateSchema);
  const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
  await store.writeJson(paths.chapterQueue(), {
    ...queue,
    projectId
  }, ChapterQueueSchema);

  const fake = await writeFakeCodex(projectsRoot, fakeMode);
  const previousCodexBin = process.env.NLE_CODEX_BIN;
  process.env.NLE_CODEX_BIN = fake.codexBin;

  return {
    gateway: new EngineChapterGateway(),
    paths,
    projectsRoot,
    useCodexMode: async (mode) => {
      const nextFake = await writeFakeCodex(projectsRoot, mode);
      process.env.NLE_CODEX_BIN = nextFake.codexBin;
    },
    pausePath: fake.pausePath,
    releasePath: fake.releasePath,
    statePath: fake.statePath,
    restoreCodexBin: () => {
      if (previousCodexBin === undefined) delete process.env.NLE_CODEX_BIN;
      else process.env.NLE_CODEX_BIN = previousCodexBin;
    }
  };
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}.`);
}

async function promptCallCount(
  statePath: string,
  promptId: string
): Promise<number> {
  const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, number>;
  return state[`${promptId}:json:normal`] ?? 0;
}

async function eventually(assertion: () => void | Promise<void>): Promise<void> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}
