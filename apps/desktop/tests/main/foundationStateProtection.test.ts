import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { initProjectFromBriefText } from '../../../../src/app/initProject.js';
import { RunManifestSchema } from '../../../../src/schemas/index.js';
import { FileStore } from '../../../../src/storage/FileStore.js';
import { ProjectPaths } from '../../../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../../../../tests/helpers/fakeCodex.js';
import { EngineFoundationGateway } from '../../src/main/foundation/EngineFoundationGateway';
import {
  ProjectFoundationService,
  type ProjectRootResolver
} from '../../src/main/foundation/ProjectFoundationService';

const projectId = 'foundation-state-protection';
const projectKey = 'project_0123456789abcdef01234567';
const fileStore = new FileStore();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('Story Foundation state protection', () => {
  test('preserves canonical files through the real desktop service and gateway', async () => {
    const { paths, restoreCodexBin, service } = await createDesktopFoundation();

    try {
      const chapterArtifacts = [
        paths.chapterArtifact(1, 'final.md'),
        paths.chapterArtifact(1, 'canon_patch.json'),
        paths.chapterArtifact(1, 'commit_report.json')
      ];
      const before = {
        storyState: await sha256(paths.storyState()),
        chapterQueue: await sha256(paths.chapterQueue()),
        chapterArtifacts: await Promise.all(chapterArtifacts.map(sha256))
      };
      const task = await service.start(projectKey);
      await eventually(async () => {
        await expect(service.get(task.taskId)).resolves.toMatchObject({ status: 'succeeded' });
      });

      expect(await sha256(paths.storyState())).toBe(before.storyState);
      expect(await sha256(paths.chapterQueue())).toBe(before.chapterQueue);
      expect(await Promise.all(chapterArtifacts.map(sha256))).toEqual(before.chapterArtifacts);
      expect(await fileStore.exists(path.join(paths.strategyDir(), 'story_bible.md')))
        .toBe(true);
      expect(await fileStore.list(paths.snapshotsDir())).toEqual([]);
      expect(await fileStore.list(paths.diffsDir())).toEqual([]);
    } finally {
      restoreCodexBin();
    }
  }, 30_000);

  test('keeps distinct retry provenance and cannot overwrite a completed foundation', async () => {
    const { gateway, paths, restoreCodexBin, service } = await createDesktopFoundation();

    try {
      const cancelled = await service.start(projectKey);
      await service.cancel(cancelled.taskId);
      await eventually(async () => {
        await expect(service.get(cancelled.taskId)).resolves.toMatchObject({ status: 'cancelled' });
      });

      const retry = await service.start(projectKey);
      await eventually(async () => {
        await expect(service.get(retry.taskId)).resolves.toMatchObject({ status: 'succeeded' });
      });

      const runIds = await fileStore.list(paths.runsDir());
      const manifests = await Promise.all(runIds.map(async (runId) => ({
        runId,
        manifest: await fileStore.readJson(paths.runManifest(runId), RunManifestSchema)
      })));
      const foundationRuns = manifests.filter(({ manifest }) => manifest.command === 'build-bible');
      const strategyPaths = [
        'story_bible.md',
        'genre_contract.md',
        'reader_promise.md',
        'style_guide.md'
      ].map((fileName) => path.join(paths.strategyDir(), fileName));
      const completeHashes = await Promise.all(strategyPaths.map(sha256));

      expect(foundationRuns).toHaveLength(2);
      expect(new Set(foundationRuns.map(({ runId }) => runId)).size).toBe(2);
      expect(foundationRuns.map(({ manifest }) => manifest.status).sort()).toEqual(['cancelled', 'success']);
      await expect(gateway.build({
        projectRoot: paths.projectRoot,
        resumeIncomplete: true,
        onProgress: () => undefined,
        shouldStop: () => false
      })).rejects.toMatchObject({ code: 'ARTIFACT_ALREADY_EXISTS' });
      await expect(Promise.all(strategyPaths.map(sha256))).resolves.toEqual(completeHashes);
    } finally {
      restoreCodexBin();
    }
  }, 30_000);

  test('allows only one independent desktop service to build a project at a time', async () => {
    const { paths, restoreCodexBin, service: firstService } = await createDesktopFoundation();
    const secondService = new ProjectFoundationService({
      gateway: new EngineFoundationGateway(),
      projects: new StaticProjectRootResolver(paths.projectRoot)
    });

    try {
      const [firstTask, secondTask] = await Promise.all([
        firstService.start(projectKey),
        secondService.start(projectKey)
      ]);
      await eventually(async () => {
        const tasks = await Promise.all([
          firstService.get(firstTask.taskId),
          secondService.get(secondTask.taskId)
        ]);
        expect(tasks.every((task) => ['succeeded', 'failed'].includes(task.status))).toBe(true);
      });

      const tasks = await Promise.all([
        firstService.get(firstTask.taskId),
        secondService.get(secondTask.taskId)
      ]);
      expect(tasks.map((task) => task.status).sort()).toEqual(['failed', 'succeeded']);
      expect(tasks.find((task) => task.status === 'failed')).toMatchObject({
        canRetry: true,
        error: { kind: 'generation_busy' }
      });
      await expect(new EngineFoundationGateway().read(paths.projectRoot)).resolves.toMatchObject({
        available: true
      });
    } finally {
      restoreCodexBin();
    }
  }, 30_000);

  test.each([
    {
      mode: 'binary-missing',
      classification: 'unavailable',
      kind: 'codex_unavailable'
    },
    {
      mode: 'login-required',
      classification: 'login_required',
      kind: 'login_required'
    },
    {
      mode: 'usage-limit',
      classification: 'usage_limit',
      kind: 'usage_limit'
    },
    {
      mode: 'exec-unavailable',
      classification: 'unavailable',
      kind: 'codex_unavailable'
    },
    {
      mode: 'output-missing',
      classification: 'invalid_output',
      kind: 'invalid_output'
    }
  ] as const)(
    'maps real fake-Codex $mode behavior through the engine gateway',
    async ({ classification, kind, mode }) => {
      const context = await createFailingDesktopFoundation(mode);
      const gateway = new EngineFoundationGateway();

      try {
        await expect(gateway.build({
          projectRoot: context.paths.projectRoot,
          resumeIncomplete: true,
          onProgress: () => undefined,
          shouldStop: () => false
        })).rejects.toMatchObject({
          classification,
          provider: 'codex-text'
        });

        const service = new ProjectFoundationService({
          gateway: new EngineFoundationGateway(),
          projects: new StaticProjectRootResolver(context.paths.projectRoot)
        });
        const task = await service.start(projectKey);
        await eventually(async () => {
          await expect(service.get(task.taskId)).resolves.toMatchObject({
            status: 'failed',
            canRetry: true,
            error: { kind }
          });
        });
        const terminal = await service.get(task.taskId);
        expect(terminal.error?.message).not.toMatch(/sk-SECRET|auth\.json|home\/private/i);
      } finally {
        context.restoreCodexBin();
      }
    },
    30_000
  );

  test('maps an oversized completed foundation to invalid_output before building', async () => {
    const projectsRoot = await mkdtemp(path.join(
      os.tmpdir(),
      'novel-loop-foundation-oversized-review-'
    ));
    temporaryDirectories.push(projectsRoot);
    const paths = new ProjectPaths(projectsRoot, projectId);
    await initProjectFromBriefText({
      projectId,
      projectsRoot,
      brief: '# Story Foundation\n\nOversized review content must be rejected.\n'
    });
    await Promise.all([
      fileStore.writeText(
        path.join(paths.strategyDir(), 'story_bible.md'),
        'x'.repeat(2 * 1024 * 1024 + 1)
      ),
      fileStore.writeText(path.join(paths.strategyDir(), 'genre_contract.md'), '# Genre\n'),
      fileStore.writeText(path.join(paths.strategyDir(), 'reader_promise.md'), '# Promise\n'),
      fileStore.writeText(path.join(paths.strategyDir(), 'style_guide.md'), '# Style\n')
    ]);
    const gateway = new EngineFoundationGateway();

    await expect(gateway.read(paths.projectRoot)).rejects.toMatchObject({
      code: 'DESKTOP_STORY_BIBLE_INVALID_OUTPUT'
    });

    const service = new ProjectFoundationService({
      gateway,
      projects: new StaticProjectRootResolver(paths.projectRoot)
    });
    await expect(service.start(projectKey)).resolves.toMatchObject({
      status: 'failed',
      canRetry: true,
      error: { kind: 'invalid_output' }
    });
  });
});

async function createDesktopFoundation(): Promise<{
  gateway: EngineFoundationGateway;
  paths: ProjectPaths;
  restoreCodexBin(): void;
  service: ProjectFoundationService;
}> {
  const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-foundation-protection-'));
  temporaryDirectories.push(projectsRoot);
  const paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Story Foundation\n\nA foundation must not alter canonical state.\n'
  });
  await fileStore.writeText(paths.chapterQueue(), '{"protected":true}\n');
  await Promise.all([
    fileStore.writeText(paths.chapterArtifact(1, 'final.md'), '# Protected final chapter\n'),
    fileStore.writeText(
      paths.chapterArtifact(1, 'canon_patch.json'),
      '{"protected":"canon patch"}\n'
    ),
    fileStore.writeText(
      paths.chapterArtifact(1, 'commit_report.json'),
      '{"protected":"commit report"}\n'
    )
  ]);
  const fake = await writeFakeCodex(projectsRoot);
  const originalCodexBin = process.env.NLE_CODEX_BIN;
  process.env.NLE_CODEX_BIN = fake.codexBin;
  const gateway = new EngineFoundationGateway();
  const service = new ProjectFoundationService({
    gateway,
    projects: new StaticProjectRootResolver(paths.projectRoot)
  });

  return {
    gateway,
    paths,
    service,
    restoreCodexBin: () => {
      if (originalCodexBin === undefined) {
        delete process.env.NLE_CODEX_BIN;
      } else {
        process.env.NLE_CODEX_BIN = originalCodexBin;
      }
    }
  };
}

class StaticProjectRootResolver implements ProjectRootResolver {
  constructor(private readonly projectRoot: string) {}

  async resolveProjectRoot(key: string): Promise<string | null> {
    return key === projectKey ? this.projectRoot : null;
  }
}

async function createFailingDesktopFoundation(
  mode: 'binary-missing' | 'login-required' | 'usage-limit' | 'exec-unavailable' | 'output-missing'
): Promise<{
  paths: ProjectPaths;
  restoreCodexBin(): void;
}> {
  const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-foundation-failure-'));
  temporaryDirectories.push(projectsRoot);
  const paths = new ProjectPaths(projectsRoot, projectId);
  await initProjectFromBriefText({
    projectId,
    projectsRoot,
    brief: '# Story Foundation\n\nProvider failures stay author-safe.\n'
  });
  const originalCodexBin = process.env.NLE_CODEX_BIN;

  if (mode === 'binary-missing') {
    process.env.NLE_CODEX_BIN = path.join(projectsRoot, 'missing-codex');
  } else {
    const codexBin = path.join(projectsRoot, `fake-codex-${mode}.cjs`);
    const stderr = {
      'login-required': 'Not logged in. Run codex login. token sk-SECRET /home/private/.codex/auth.json',
      'usage-limit': 'You have reached your usage limit. Try again later. token sk-SECRET',
      'exec-unavailable': 'Codex service is unavailable. connection refused at /home/private/socket',
      'output-missing': ''
    }[mode];
    await writeFile(codexBin, `#!/usr/bin/env node
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
  ${mode === 'output-missing'
    ? "process.exit(0);"
    : `process.stderr.write(${JSON.stringify(stderr)} + '\\n'); process.exit(1);`}
}
process.exit(2);
`, 'utf8');
    await chmod(codexBin, 0o755);
    process.env.NLE_CODEX_BIN = codexBin;
  }

  return {
    paths,
    restoreCodexBin: () => {
      if (originalCodexBin === undefined) {
        delete process.env.NLE_CODEX_BIN;
      } else {
        process.env.NLE_CODEX_BIN = originalCodexBin;
      }
    }
  };
}

async function eventually(assertion: () => Promise<void> | void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
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
