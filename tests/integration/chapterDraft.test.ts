import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { initProject } from '../../src/app/initProject.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { runChapterUntilDraft, type ChapterDraftProgressEvent } from '../../src/app/chapterDrafting.js';
import { RunManifestSchema, SceneCardsSchema, StoryStateSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { validCharacterState } from '../fixtures/schemas/valid.js';

let tempRoot: string;
let briefPath: string;

const promptRoot = path.resolve('prompts');
const fixturesRoot = path.resolve('fixtures/llm');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m7-'));
  briefPath = path.join(tempRoot, 'brief.md');
  await writeFile(briefPath, '# Demo Brief\n\nA controlled test brief.\n', 'utf8');
  await initProject({ projectId: 'demo-novel', briefPath, projectsRoot: tempRoot });
  await buildBible({ projectId: 'demo-novel', projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_build_bible_test' });
  await planGlobal({ projectId: 'demo-novel', projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: 'run_plan_global_test' });
  const paths = new ProjectPaths(tempRoot, 'demo-novel');
  const store = new FileStore();
  const initialState = await store.readJson(paths.storyState(), StoryStateSchema);
  await store.writeJson(paths.storyState(), {
    ...initialState,
    characters: [validCharacterState]
  }, StoryStateSchema);
  await runChapterDryRun({
    projectId: 'demo-novel',
    projectsRoot: tempRoot,
    chapterNumber: 1,
    candidates: 3,
    provider: 'mock',
    promptRoot,
    fixturesRoot,
    runId: 'run_chapter_dry_run_test'
  });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('chapter draft generation', () => {
  test('reports scene draft progress through every scene and leaves Story State unchanged', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();
    const beforeStateHash = sha256(await store.readText(paths.storyState()));
    const events: ChapterDraftProgressEvent[] = [];

    await runChapterUntilDraft({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_chapter_draft_lifecycle_test',
      onProgress: (event) => events.push(event)
    });

    expect(events.map((event) => `${event.stage}:${event.state}`)).toEqual([
      'preparing:started',
      'preparing:completed',
      'scene_cards:started',
      'scene_cards:completed',
      'scene_drafts:started',
      'scene_drafts:progress',
      'scene_drafts:progress',
      'scene_drafts:completed',
      'draft_assembly:started',
      'draft_assembly:completed',
      'finalizing:started',
      'finalizing:completed',
      'completed:completed'
    ]);
    expect(events.filter((event) => event.stage === 'scene_drafts' && event.state === 'progress')).toEqual([
      { stage: 'scene_drafts', state: 'progress', current: 1, total: 2 },
      { stage: 'scene_drafts', state: 'progress', current: 2, total: 2 }
    ]);
    expect(sha256(await store.readText(paths.storyState()))).toBe(beforeStateHash);
    await expect(store.exists(paths.chapterArtifact(1, 'final.md'))).resolves.toBe(false);
  });

  test('creates scene cards, scene drafts, and draft_v1 without committing state', async () => {
    const paths = new ProjectPaths(tempRoot, 'demo-novel');
    const store = new FileStore();

    const result = await runChapterUntilDraft({
      projectId: 'demo-novel',
      projectsRoot: tempRoot,
      chapterNumber: 1,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      runId: 'run_chapter_draft_test'
    });

    expect(result.artifacts).toEqual([
      'chapters/chapter_001/scene_cards.json',
      'chapters/chapter_001/scenes/scene_001.md',
      'chapters/chapter_001/scenes/scene_002.md',
      'chapters/chapter_001/draft_v1.md'
    ]);

    const sceneCards = await store.readJson(paths.chapterArtifact(1, 'scene_cards.json'), SceneCardsSchema);
    expect(sceneCards).toHaveLength(2);
    expect(sceneCards[0]).toMatchObject({
      sceneId: 'scene_001',
      purpose: '让林澈从日常疲惫进入旧收音机异常事件。',
      conflict: '林澈只想快速回家，摊主却急着把旧收音机脱手。',
      entryPoint: '林澈在旧货市场绕路避雨。',
      exitPoint: '他带走旧收音机，并发现它在没有电池时短暂亮灯。',
      characters: ['char_lincheng'],
      location: '旧货市场',
      time: '第一章傍晚',
      informationDelta: ['旧收音机来源可疑', '旋钮上有被刮掉的楼层数字'],
      emotionalShift: '疲惫克制 -> 隐约不安',
      readerEffect: '建立核心物件与低烈度悬疑。',
      constraints: ['不要解释旧收音机来源', '不要揭示母亲失踪案']
    });

    const sceneOne = await store.readText(paths.chapterArtifact(1, 'scenes', 'scene_001.md'));
    const sceneTwo = await store.readText(paths.chapterArtifact(1, 'scenes', 'scene_002.md'));
    expect(sceneOne).toContain('旧货市场的雨棚');
    expect(sceneTwo).toContain('没有电池的收音机');

    const draft = await store.readText(paths.chapterArtifact(1, 'draft_v1.md'));
    expect(draft).toContain('# Chapter 001 Draft');
    expect(draft).toContain(sceneOne.trim());
    expect(draft).toContain(sceneTwo.trim());

    await expect(store.exists(paths.chapterArtifact(1, 'final.md'))).resolves.toBe(false);
    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    expect(state.latestCommittedChapter).toBe(0);

    const manifest = await store.readJson(paths.runManifest('run_chapter_draft_test'), RunManifestSchema);
    expect(manifest.command).toBe('chapter');
    expect(manifest.status).toBe('success');
    expect(JSON.stringify(manifest.artifacts)).toContain('chapters/chapter_001/draft_v1.md');
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
