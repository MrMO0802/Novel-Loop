import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../../../src/app/buildBible.js';
import { initProjectFromBriefText } from '../../../../src/app/initProject.js';
import { planGlobal } from '../../../../src/app/planGlobal.js';
import { ChapterQueueSchema } from '../../../../src/schemas/index.js';
import { FileStore } from '../../../../src/storage/FileStore.js';
import { ProjectPaths } from '../../../../src/storage/ProjectPaths.js';
import {
  writeFakeCodex,
  type FakeCodexMode
} from '../../../../tests/helpers/fakeCodex.js';
import { EngineChapterGateway } from '../../src/main/chapter/EngineChapterGateway';

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
      const planReview = await context.gateway.readPlan(
        context.paths.projectRoot
      );
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
        /char_lincheng|mission_ch001_codex|debt_[a-z0-9_-]+/i
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
});

function runInput(projectRoot: string) {
  return {
    projectRoot,
    onProgress: () => undefined,
    shouldStop: () => false
  };
}

async function createChapterProject(
  projectId: string,
  fakeMode: FakeCodexMode
): Promise<{
  gateway: EngineChapterGateway;
  paths: ProjectPaths;
  projectsRoot: string;
  useCodexMode(mode: FakeCodexMode): Promise<void>;
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
    restoreCodexBin: () => {
      if (previousCodexBin === undefined) delete process.env.NLE_CODEX_BIN;
      else process.env.NLE_CODEX_BIN = previousCodexBin;
    }
  };
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}
