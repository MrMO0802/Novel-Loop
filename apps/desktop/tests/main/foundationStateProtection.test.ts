import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../../../src/app/buildBible.js';
import { initProjectFromBriefText } from '../../../../src/app/initProject.js';
import { FileStore } from '../../../../src/storage/FileStore.js';
import { ProjectPaths } from '../../../../src/storage/ProjectPaths.js';

const projectId = 'foundation-state-protection';
const fileStore = new FileStore();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('Story Foundation state protection', () => {
  test('writes only strategy markdown during lifecycle-capable foundation generation', async () => {
    const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-foundation-protection-'));
    temporaryDirectories.push(projectsRoot);
    const paths = new ProjectPaths(projectsRoot, projectId);
    await initProjectFromBriefText({
      projectId,
      projectsRoot,
      brief: '# Story Foundation\n\nA foundation must not alter canonical state.\n'
    });
    await fileStore.writeText(paths.chapterQueue(), '{"protected":true}\n');
    const before = {
      storyState: await sha256(paths.storyState()),
      chapterQueue: await sha256(paths.chapterQueue())
    };

    await buildBible({
      projectId,
      projectsRoot,
      provider: 'mock',
      runId: 'run_foundation_state_protection',
      onProgress: () => undefined,
      shouldStop: () => false
    });

    expect(await sha256(paths.storyState())).toBe(before.storyState);
    expect(await sha256(paths.chapterQueue())).toBe(before.chapterQueue);
    expect(await fileStore.exists(paths.chapterDir(1))).toBe(false);
    expect(await fileStore.exists(path.join(paths.strategyDir(), 'story_bible.md')))
      .toBe(true);
    expect(await fileStore.list(paths.snapshotsDir())).toEqual([]);
    expect(await fileStore.list(paths.diffsDir())).toEqual([]);
    expect(await fileStore.exists(paths.chapterArtifact(1, 'canon_patch.json'))).toBe(false);
    expect(await fileStore.exists(paths.chapterArtifact(1, 'commit_report.json'))).toBe(false);
  });
});

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}
