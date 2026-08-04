import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import {
  draftDesktopNextChapter,
  inspectDesktopNextChapter,
  planDesktopNextChapter,
  readDesktopChapterDraft,
  readDesktopChapterPlan
} from '../../src/desktop/chapterWorkspace.js';
import { ChapterMissionSchema, ChapterQueueSchema, RunManifestV2Schema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { validCharacterState } from '../fixtures/schemas/valid.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

const projectId = 'desktop-chapter-workspace';
const promptRoot = path.resolve('prompts');
const MAX_REVIEW_MARKDOWN_BYTES = 2 * 1024 * 1024;
const store = new FileStore();
let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-desktop-chapter-workspace-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Desktop Chapter Workspace\n\n## Core Idea\n\nA filtered next chapter boundary.\n'
  });
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('desktop chapter workspace', () => {
  test('inspects only the Story State next chapter and derives public phases from valid artifacts', async () => {
    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).resolves.toEqual({
      available: false,
      reason: 'global_plan_missing'
    });

    await prepareGlobalPlan();
    const storyState = await store.readJson(paths.storyState(), StoryStateSchema);
    const inspection = await inspectDesktopNextChapter({ projectRoot: paths.projectRoot });
    expect(inspection).toMatchObject({ available: true, phase: 'not_started' });
    if (!inspection.available) throw new Error('Next chapter unexpectedly unavailable.');
    expect(inspection.chapterNumber).toBe(storyState.latestCommittedChapter + 1);

    await store.writeText(paths.chapterArtifact(1, 'mission.json'), '{"invalid":true}\n');
    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  });

  test('pins planning and drafting to codex-text while preserving Story State bytes', async () => {
    await prepareGlobalPlan();
    const fake = await writeFakeCodex(projectsRoot);
    const previousCodexBin = process.env.NLE_CODEX_BIN;
    process.env.NLE_CODEX_BIN = fake.codexBin;
    const beforeStateHash = await sha256(paths.storyState());

    try {
      await expect(planDesktopNextChapter({ projectRoot: paths.projectRoot })).resolves.toEqual({
        chapterNumber: 1,
        completed: true
      });
      const planningManifest = await store.readJson(await findChapterRunManifest(), RunManifestV2Schema);
      const capturedProvider = planningManifest.provider;
      expect(capturedProvider).toBe('codex-text');

      await expect(draftDesktopNextChapter({ projectRoot: paths.projectRoot })).resolves.toEqual({
        chapterNumber: 1,
        completed: true
      });
      expect(await sha256(paths.storyState())).toBe(beforeStateHash);
    } finally {
      if (previousCodexBin === undefined) delete process.env.NLE_CODEX_BIN;
      else process.env.NLE_CODEX_BIN = previousCodexBin;
    }
  }, 30_000);

  test('recovers the last valid public phase after interrupted planning and drafting', async () => {
    await prepareGlobalPlan();
    const fake = await writeFakeCodex(projectsRoot);
    const previousCodexBin = process.env.NLE_CODEX_BIN;
    process.env.NLE_CODEX_BIN = fake.codexBin;
    let stopPlanning = false;

    try {
      await expect(planDesktopNextChapter({
        projectRoot: paths.projectRoot,
        shouldStop: () => stopPlanning,
        onProgress: (event) => {
          if (event.stage === 'mission' && event.state === 'completed') stopPlanning = true;
        }
      })).rejects.toMatchObject({ code: 'CHAPTER_PLANNING_CANCELLED' });
      await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
        available: true,
        phase: 'planning_partial'
      });

      await planDesktopNextChapter({ projectRoot: paths.projectRoot });
      let stopDrafting = false;
      await expect(draftDesktopNextChapter({
        projectRoot: paths.projectRoot,
        shouldStop: () => stopDrafting,
        onProgress: (event) => {
          if (event.stage === 'scene_cards' && event.state === 'completed') stopDrafting = true;
        }
      })).rejects.toMatchObject({ code: 'CHAPTER_DRAFT_CANCELLED' });
      await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
        available: true,
        phase: 'drafting_partial'
      });
    } finally {
      if (previousCodexBin === undefined) delete process.env.NLE_CODEX_BIN;
      else process.env.NLE_CODEX_BIN = previousCodexBin;
    }
  }, 30_000);

  test.each([
    ['planning artifacts exist without the mission', async () => {
      await rm(paths.chapterArtifact(1, 'mission.json'));
    }],
    ['drafting artifacts exist without the selected plan', async () => {
      await rm(paths.chapterArtifact(1, 'selected_plan.md'));
    }],
    ['the draft exists without the scenes directory', async () => {
      await rm(paths.chapterArtifact(1, 'scenes'), { recursive: true, force: true });
    }],
    ['the draft exists with a missing scene file', async () => {
      await rm(paths.chapterArtifact(1, 'scenes', 'scene_001.md'));
    }]
  ])('rejects later artifacts when %s', async (_label, mutate) => {
    await prepareGeneratedChapter();
    await mutate();
    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  }, 30_000);

  test.each([
    ['an unranked Markdown file', async () => {
      await store.writeText(paths.chapterArtifact(1, 'plan_candidates', 'unranked.md'), '# Unranked\n\nNot ranked.\n');
    }],
    ['a nested directory', async () => {
      await mkdir(paths.chapterArtifact(1, 'plan_candidates', 'nested'));
    }],
    ['a symlink', async () => {
      await symlink(
        paths.chapterArtifact(1, 'plan_candidates', 'plan_001.md'),
        paths.chapterArtifact(1, 'plan_candidates', 'linked.md')
      );
    }]
  ])('rejects a complete plan candidate directory containing %s', async (_label, mutate) => {
    await prepareGeneratedChapter();
    await mutate();
    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  }, 30_000);

  test.each([
    [
      'an extra deterministic candidate',
      [
        ['plan_001.md', '# Plan 001'],
        ['plan_002.md', '# Plan 002'],
        ['plan_003.md', '# Plan 003'],
        ['plan_004.md', '# Plan 004']
      ]
    ],
    [
      'aggregate bytes above the desktop budget',
      [
        ['plan_001.md', `# Plan 001\n\n${'a'.repeat(220 * 1024)}`],
        ['plan_002.md', `# Plan 002\n\n${'b'.repeat(220 * 1024)}`],
        ['plan_003.md', `# Plan 003\n\n${'c'.repeat(220 * 1024)}`]
      ]
    ]
  ] as const)('rejects a partial plan candidate directory containing %s', async (_label, files) => {
    await prepareGlobalPlan();
    const fake = await writeFakeCodex(projectsRoot);
    const previousCodexBin = process.env.NLE_CODEX_BIN;
    process.env.NLE_CODEX_BIN = fake.codexBin;
    let stopPlanning = false;
    try {
      await expect(planDesktopNextChapter({
        projectRoot: paths.projectRoot,
        shouldStop: () => stopPlanning,
        onProgress: (event) => {
          if (event.stage === 'mission' && event.state === 'completed') stopPlanning = true;
        }
      })).rejects.toMatchObject({ code: 'CHAPTER_PLANNING_CANCELLED' });
      await store.ensureDir(paths.chapterArtifact(1, 'plan_candidates'));
      for (const [fileName, content] of files) {
        await store.writeText(
          paths.chapterArtifact(1, 'plan_candidates', fileName),
          content
        );
      }

      await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
        code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
      });
    } finally {
      if (previousCodexBin === undefined) delete process.env.NLE_CODEX_BIN;
      else process.env.NLE_CODEX_BIN = previousCodexBin;
    }
  }, 30_000);

  test('rejects a Story State copied from a different project identity', async () => {
    await prepareGlobalPlan();
    await store.writeJson(paths.storyState(), {
      ...(await store.readJson(paths.storyState(), StoryStateSchema)),
      projectId: 'another-project'
    }, StoryStateSchema);

    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  });

  test('rejects a chapter queue copied from a different project identity', async () => {
    await prepareGlobalPlan();
    await updateQueue((queue) => {
      queue.projectId = 'another-project';
    });

    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  });

  test('returns bounded author-facing plan and draft reviews without internal artifacts or identifiers', async () => {
    await prepareGeneratedChapter();
    const chapterTitle = (await readQueue()).chapters[0].title;

    const planReview = await readDesktopChapterPlan({ projectRoot: paths.projectRoot });
    expect(planReview).toMatchObject({
      available: true,
      chapterNumber: 1,
      title: chapterTitle,
      mission: {
        narrativePromises: expect.arrayContaining([
          'Why does the radio speak without power?'
        ]),
        characterDeltas: expect.arrayContaining([
          expect.stringMatching(/skeptical.*alert/i)
        ])
      },
      selectedPlan: { title: 'Continuity First' },
      alternatives: expect.arrayContaining([
        { title: 'Building First', excerpt: expect.any(String), strengths: expect.any(Array), risks: expect.any(Array) }
      ])
    });
    expect(JSON.stringify(planReview)).not.toMatch(
      /artifactPath|runId|latestRunId|selectedPlanPath|plan_candidates|story_state|candidateId|totalScore|scores|char_lincheng|mission_ch001_codex|debt_[a-z0-9_-]+/i
    );

    const draftReview = await readDesktopChapterDraft({ projectRoot: paths.projectRoot });
    expect(draftReview).toMatchObject({
      available: true,
      chapterNumber: 1,
      title: chapterTitle,
      markdown: expect.any(String),
      scenes: expect.arrayContaining([{ summary: expect.any(String) }])
    });
    expect(JSON.stringify(draftReview)).not.toMatch(
      /artifactPath|runId|contextManifest|scene_cards\.json|draft_v1\.md|story_state/i
    );
  }, 30_000);

  test('uses localized ordinal titles for legacy heading-free directions', async () => {
    await prepareGeneratedChapter();
    await Promise.all([
      store.writeText(paths.chapterArtifact(1, 'selected_plan.md'), '选定方向正文。\n'),
      store.writeText(paths.chapterArtifact(1, 'plan_candidates', 'plan_001.md'), '方向一正文。\n'),
      store.writeText(paths.chapterArtifact(1, 'plan_candidates', 'plan_002.md'), '方向二正文。\n'),
      store.writeText(paths.chapterArtifact(1, 'plan_candidates', 'plan_003.md'), '方向三正文。\n')
    ]);

    const review = await readDesktopChapterPlan({ projectRoot: paths.projectRoot });

    expect(review.available && review.selectedPlan.title).toBe('方案一');
    expect(review.available && review.alternatives.map(({ title }) => title))
      .toEqual(['方案二', '方案三']);
    expect(JSON.stringify(review)).not.toContain('Untitled Plan');
  }, 30_000);

  test('rejects an impossible mission debt reference instead of showing an author-facing fallback', async () => {
    await prepareGeneratedChapter();
    const mission = await store.readJson(
      paths.chapterArtifact(1, 'mission.json'),
      ChapterMissionSchema
    );
    await store.writeJson(paths.chapterArtifact(1, 'mission.json'), {
      ...mission,
      debtsToPayOrAdvance: ['debt_impossible']
    }, ChapterMissionSchema);

    await expect(readDesktopChapterPlan({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  }, 30_000);

  test('fails closed for stale, already committed, sequence-gap, and missing target queue states', async () => {
    await prepareGlobalPlan();

    await updateQueue((queue) => {
      queue.chapters[0].status = 'stale_due_to_history_edit';
    });
    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_STALE'
    });

    await updateQueue((queue) => {
      queue.chapters[0].status = 'committed';
    });
    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: expect.stringMatching(/^DESKTOP_CHAPTER_/)
    });

    await updateQueue((queue) => {
      queue.chapters = queue.chapters.filter((chapter) => chapter.chapterNumber !== 1);
    });
    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: expect.stringMatching(/^DESKTOP_CHAPTER_/)
    });

    await updateQueue((queue) => {
      queue.chapters = [];
    });
    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).resolves.toEqual({
      available: false,
      reason: 'chapter_missing'
    });
  });

  test('accepts recommitted canonical history and selects the next planned chapter', async () => {
    await prepareGlobalPlan();
    await updateStoryState((storyState) => {
      storyState.latestCommittedChapter = 1;
    });
    await updateQueue((queue) => {
      queue.chapters[0].status = 'recommitted';
      queue.chapters[1].status = 'planned';
    });

    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
      available: true,
      chapterNumber: 2,
      phase: 'not_started'
    });
  });

  test('rejects a missing canonical queue row before the next chapter', async () => {
    await prepareGlobalPlan();
    await updateStoryState((storyState) => {
      storyState.latestCommittedChapter = 1;
    });
    await updateQueue((queue) => {
      queue.chapters = queue.chapters.filter((chapter) => chapter.chapterNumber !== 1);
    });

    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  });

  test.each([
    'diagnosing',
    'revision_required',
    'revising',
    'final_ready',
    'patch_extracted',
    'conflict_detected',
    'conflict_repairing',
    'conflict_repaired',
    'under_review',
    'manually_edited',
    'recommit_ready',
    'recommitting',
    'committing',
    'needs_human_review',
    'blocked'
  ] as const)('rejects desktop target status %s', async (status) => {
    await prepareGlobalPlan();
    await updateQueue((queue) => {
      queue.chapters[0].status = status;
    });

    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  });

  test('rejects a queue status that disagrees with the inspected artifact phase', async () => {
    await prepareGeneratedChapter();
    await updateQueue((queue) => {
      queue.chapters[0].status = 'planned';
    });

    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  }, 30_000);

  test('rejects a failed desktop target whose queue stage belongs to diagnostics', async () => {
    await prepareGeneratedChapter();
    await updateQueue((queue) => {
      queue.chapters[0].status = 'failed';
      queue.chapters[0].currentStage = 'diagnostics';
    });

    await expect(inspectDesktopNextChapter({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  }, 30_000);

  test('fails closed for non-file, oversized Markdown, and invalid JSON review artifacts', async () => {
    await prepareGeneratedChapter();
    const selectedPlanPath = paths.chapterArtifact(1, 'selected_plan.md');
    await rm(selectedPlanPath);
    await mkdir(selectedPlanPath);
    await expect(readDesktopChapterPlan({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });

    await rm(selectedPlanPath, { recursive: true, force: true });
    await store.writeText(selectedPlanPath, 'x'.repeat(MAX_REVIEW_MARKDOWN_BYTES + 1));
    await expect(readDesktopChapterPlan({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });

    await store.writeText(selectedPlanPath, '# Selected\n\nA valid selected plan.\n');
    await store.writeText(paths.chapterArtifact(1, 'ranking.json'), '{"invalid":true}\n');
    await expect(readDesktopChapterPlan({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });

    await store.writeText(paths.chapterArtifact(1, 'scene_cards.json'), '{"invalid":true}\n');
    await expect(readDesktopChapterDraft({ projectRoot: paths.projectRoot })).rejects.toMatchObject({
      code: 'DESKTOP_CHAPTER_INVALID_OUTPUT'
    });
  }, 30_000);
});

async function prepareGlobalPlan(): Promise<void> {
  await buildBible({ projectId, projectsRoot, provider: 'mock', promptRoot, runId: 'desktop_chapter_bible' });
  await planGlobal({ projectId, projectsRoot, provider: 'mock', promptRoot, runId: 'desktop_chapter_global_plan' });
  const storyState = await store.readJson(paths.storyState(), StoryStateSchema);
  await store.writeJson(paths.storyState(), {
    ...storyState,
    characters: [validCharacterState]
  }, StoryStateSchema);
  await updateQueue((queue) => {
    queue.projectId = projectId;
  });
}

async function prepareGeneratedChapter(): Promise<void> {
  await prepareGlobalPlan();
  const fake = await writeFakeCodex(projectsRoot);
  const previousCodexBin = process.env.NLE_CODEX_BIN;
  process.env.NLE_CODEX_BIN = fake.codexBin;
  try {
    await planDesktopNextChapter({ projectRoot: paths.projectRoot });
    await draftDesktopNextChapter({ projectRoot: paths.projectRoot });
  } finally {
    if (previousCodexBin === undefined) delete process.env.NLE_CODEX_BIN;
    else process.env.NLE_CODEX_BIN = previousCodexBin;
  }
}

async function updateQueue(mutator: (queue: Awaited<ReturnType<typeof readQueue>>) => void): Promise<void> {
  const queue = await readQueue();
  mutator(queue);
  await store.writeJson(paths.chapterQueue(), queue, ChapterQueueSchema);
}

async function readQueue() {
  return store.readJson(paths.chapterQueue(), ChapterQueueSchema);
}

async function updateStoryState(
  mutator: (storyState: Awaited<ReturnType<typeof readStoryState>>) => void
): Promise<void> {
  const storyState = await readStoryState();
  mutator(storyState);
  await store.writeJson(paths.storyState(), storyState, StoryStateSchema);
}

async function readStoryState() {
  return store.readJson(paths.storyState(), StoryStateSchema);
}

async function findChapterRunManifest(): Promise<string> {
  const runIds = await readdir(paths.runsDir());
  for (const runId of runIds) {
    const manifestPath = paths.runManifest(runId);
    try {
      const manifest = await store.readJson(manifestPath, RunManifestV2Schema);
      if (manifest.command === 'chapter') return manifestPath;
    } catch {
      // Ignore unrelated or incomplete run directories.
    }
  }
  throw new Error('Expected a chapter run manifest.');
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}
