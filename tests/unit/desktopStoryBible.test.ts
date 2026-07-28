import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import {
  buildDesktopStoryBible,
  readDesktopStoryBible
} from '../../src/desktop/storyBible.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';

const projectId = 'desktop-story-bible';
const MAX_FOUNDATION_MARKDOWN_BYTES = 2 * 1024 * 1024;
const foundationFileNames = [
  'story_bible.md',
  'genre_contract.md',
  'reader_promise.md',
  'style_guide.md'
] as const;
const fileStore = new FileStore();
let projectsRoot: string;
let paths: ProjectPaths;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-desktop-story-bible-'));
  paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Desktop Story Bible\n\n## Core Idea\n\nA safe desktop boundary.\n'
  });
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('desktop Story Bible', () => {
  test('reports unavailable until all four foundation documents exist', async () => {
    await fileStore.writeText(path.join(paths.strategyDir(), 'story_bible.md'), '# Story Bible\n');

    await expect(readDesktopStoryBible({ projectRoot: paths.projectRoot })).resolves.toEqual({ available: false });
  });

  test('returns the fixed four foundation documents after generation', async () => {
    await buildBible({
      projectId,
      projectsRoot,
      provider: 'mock',
      runId: 'run_desktop_story_bible'
    });

    await expect(readDesktopStoryBible({ projectRoot: paths.projectRoot })).resolves.toMatchObject({
      available: true,
      documents: [
        { kind: 'story_bible', title: 'Story Bible' },
        { kind: 'genre_contract', title: 'Genre Contract' },
        { kind: 'reader_promise', title: 'Reader Promise' },
        { kind: 'style_guide', title: 'Style Guide' }
      ]
    });
  });

  test('rejects an oversized foundation file before returning review content', async () => {
    await seedFoundationDocuments();
    await fileStore.writeText(
      path.join(paths.strategyDir(), 'story_bible.md'),
      'x'.repeat(MAX_FOUNDATION_MARKDOWN_BYTES + 1)
    );

    await expect(readDesktopStoryBible({
      projectRoot: paths.projectRoot
    })).rejects.toMatchObject({
      code: 'DESKTOP_STORY_BIBLE_INVALID_OUTPUT'
    });
  });

  test('rejects a non-regular foundation file before reading review content', async () => {
    await seedFoundationDocuments();
    const styleGuidePath = path.join(paths.strategyDir(), 'style_guide.md');
    await rm(styleGuidePath);
    await mkdir(styleGuidePath);

    await expect(readDesktopStoryBible({
      projectRoot: paths.projectRoot
    })).rejects.toMatchObject({
      code: 'DESKTOP_STORY_BIBLE_INVALID_OUTPUT'
    });
  });

  test('keeps an oversized generated document retryable instead of marking the set complete', async () => {
    const originalCodexBin = process.env.NLE_CODEX_BIN;
    const oversizedCodexBin = await writeOversizedFoundationCodex(projectsRoot);
    const validCodex = await writeFakeCodex(projectsRoot);

    try {
      process.env.NLE_CODEX_BIN = oversizedCodexBin;
      await expect(buildDesktopStoryBible({
        projectRoot: paths.projectRoot
      })).rejects.toMatchObject({
        code: 'BUILD_BIBLE_INVALID_OUTPUT'
      });
      await expect(Promise.all(foundationFileNames.map((fileName) => (
        fileStore.exists(path.join(paths.strategyDir(), fileName))
      )))).resolves.toEqual([true, true, true, false]);

      process.env.NLE_CODEX_BIN = validCodex.codexBin;
      await expect(buildDesktopStoryBible({
        projectRoot: paths.projectRoot,
        resumeIncomplete: true
      })).resolves.toEqual({
        artifactCount: 4,
        completed: true
      });
    } finally {
      if (originalCodexBin === undefined) {
        delete process.env.NLE_CODEX_BIN;
      } else {
        process.env.NLE_CODEX_BIN = originalCodexBin;
      }
    }
  }, 30_000);

  test('keeps canonical state and chapter artifacts untouched during generation', async () => {
    const originalCodexBin = process.env.NLE_CODEX_BIN;
    const fake = await writeFakeCodex(projectsRoot);

    try {
      process.env.NLE_CODEX_BIN = fake.codexBin;
      const before = {
        storyState: await sha256(paths.storyState())
      };

      const { buildDesktopStoryBible } = await import('../../src/desktop/storyBible.js');
      await buildDesktopStoryBible({ projectRoot: paths.projectRoot });

      expect(await sha256(paths.storyState())).toBe(before.storyState);
      expect(await fileStore.exists(paths.chapterQueue())).toBe(false);
      expect(await fileStore.exists(paths.chapterDir(1))).toBe(false);
      expect(await fileStore.list(paths.snapshotsDir())).toEqual([]);
      expect(await fileStore.list(paths.diffsDir())).toEqual([]);
      expect(await fileStore.exists(paths.chapterArtifact(1, 'canon_patch.json'))).toBe(false);
      expect(await fileStore.exists(paths.chapterArtifact(1, 'commit_report.json'))).toBe(false);
    } finally {
      if (originalCodexBin === undefined) {
        delete process.env.NLE_CODEX_BIN;
      } else {
        process.env.NLE_CODEX_BIN = originalCodexBin;
      }
    }
  });

  test('uses packaged prompt fixtures and output schemas after cwd changes', async () => {
    const originalCwd = process.cwd();
    const originalCodexBin = process.env.NLE_CODEX_BIN;
    const unrelatedCwd = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-unrelated-cwd-'));
    const fake = await writeFakeCodex(projectsRoot);

    try {
      process.chdir(unrelatedCwd);
      process.env.NLE_CODEX_BIN = fake.codexBin;
      vi.resetModules();
      const { buildDesktopStoryBible } = await import('../../src/desktop/storyBible.js');
      const { resolveCodexOutputSchema } = await import('../../src/providers/codex/schemas.js');
      await expect(buildDesktopStoryBible({ projectRoot: paths.projectRoot })).resolves.toEqual({
        artifactCount: 4,
        completed: true
      });
      expect(resolveCodexOutputSchema('strategy.build_story_bible')?.schemaPath).toMatch(/schemas[\\/]codex-output[\\/]strategy\.story_bible\.schema\.json$/);
    } finally {
      process.chdir(originalCwd);
      if (originalCodexBin === undefined) {
        delete process.env.NLE_CODEX_BIN;
      } else {
        process.env.NLE_CODEX_BIN = originalCodexBin;
      }
      await rm(unrelatedCwd, { recursive: true, force: true });
    }
  });
});

async function seedFoundationDocuments(): Promise<void> {
  await Promise.all(foundationFileNames.map((fileName) => (
    fileStore.writeText(path.join(paths.strategyDir(), fileName), `# ${fileName}\n`)
  )));
}

async function writeOversizedFoundationCodex(root: string): Promise<string> {
  const codexBin = path.join(root, 'fake-codex-oversized-foundation.cjs');
  await writeFile(codexBin, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('codex-cli 9.9.9\\n');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  process.stdout.write('Logged in\\n');
  process.exit(0);
}
if (args[0] === 'doctor') {
  process.stdout.write('{"ok":true}\\n');
  process.exit(0);
}
if (args.includes('exec')) {
  const stdin = fs.readFileSync(0, 'utf8');
  const outputIndex = args.indexOf('--output-last-message');
  const outputFile = args[outputIndex + 1];
  const promptId = (stdin.match(/PROMPT_ID:\\s*([^\\n]+)/) || [])[1] || 'unknown';
  const text = promptId === 'strategy.build_style_guide'
    ? 'x'.repeat(${MAX_FOUNDATION_MARKDOWN_BYTES + 1})
    : '# Valid Foundation\\n';
  fs.writeFileSync(outputFile, text);
  process.stdout.write('{"type":"turn.completed"}\\n');
  process.exit(0);
}
process.exit(2);
`, 'utf8');
  await chmod(codexBin, 0o755);
  return codexBin;
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}
