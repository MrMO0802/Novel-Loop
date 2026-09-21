import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as desktop from '../../src/desktop/index.js';
import { auditDesktopSubmissions } from '../../src/app/desktopSubmissionAudit.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { submissionHash } from '../../src/app/desktopSubmissionSource.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { DraftWorkingCopyStore } from '../../apps/desktop/src/main/chapter/DraftWorkingCopyStore.js';
import { EngineSubmissionGateway } from '../../apps/desktop/src/main/submission/EngineSubmissionGateway.js';
import { ProjectSubmissionGuard } from '../../apps/desktop/src/main/submission/ProjectSubmissionGuard.js';
import { ProjectSubmissionService } from '../../apps/desktop/src/main/submission/ProjectSubmissionService.js';
import { createDesktopSubmissionFixture } from '../helpers/desktopSubmissionFixture.js';

// Resolve the production gateway's lazy facade to current source, not stale dist output.
vi.mock('novel-loop-engine/desktop', async () => import('../../src/desktop/index.js'));

const manifest = 'chapters/chapter_001/submission_previews/preview_v1/manifest.json';
const projectKey = 'project_publication';

describe('durable desktop submission publication', () => {
  let seed: Awaited<ReturnType<typeof createDesktopSubmissionFixture>>;
  let root: string;
  let paths: ProjectPaths;
  let store: FileStore;
  const input = () => ({ projectRoot: paths.projectRoot, chapterNumber: 1, taskId: 'publication_check' });
  const check = (fileStore = store) => desktop.checkDesktopChapterSubmission(input(), {
    fileStore, shouldCancel: () => false, onProgress: async () => {}
  });
  const service = () => new ProjectSubmissionService({
    projects: {
      resolveProjectRoot: async () => (await desktop.inspectDesktopProject({ projectRoot: paths.projectRoot })).valid ? paths.projectRoot : null,
      resolveRegisteredRootForRecovery: async () => paths.projectRoot,
      list: async () => ({ projects: [{ projectKey }] })
    },
    gateway: new EngineSubmissionGateway(),
    workingCopies: new DraftWorkingCopyStore(path.join(root, 'user-data')),
    guard: new ProjectSubmissionGuard()
  });
  const confirmInput = async () => ({
    projectRoot: paths.projectRoot, chapterNumber: 1, previewId: 'submission_ch001_v1',
    expectedManifestHash: await store.exists(paths.projectArtifact(manifest))
      ? submissionHash(await store.readText(paths.projectArtifact(manifest))) : '0'.repeat(64),
    approvalId: 'publication_approval', confirm: true as const
  });
  async function snapshot(directory = paths.projectRoot, relative = ''): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.novel-loop-')) continue;
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) Object.assign(result, await snapshot(path.join(directory, entry.name), name));
      else result[name] = (await readFile(path.join(directory, entry.name))).toString('base64');
    }
    return result;
  }
  beforeAll(async () => {
    seed = await createDesktopSubmissionFixture();
    vi.stubEnv('NLE_CODEX_BIN', seed.codexBin);
  }, 60000);
  afterAll(async () => { vi.unstubAllEnvs(); await seed?.cleanup(); });
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'submission-publication-'));
    paths = new ProjectPaths(root, seed.projectId);
    await cp(seed.projectRoot, paths.projectRoot, { recursive: true });
    store = FileStore.forProject(paths.projectRoot);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it.each([
    ['clean', 'none', true],
    ['manifest', 'before', false], ['manifest', 'after', false],
    ['ready_task', 'before', false], ['ready_task', 'after', true]
  ] as const)('%s write / %s failure never permits unauditable confirmation', async (target, when, published) => {
    const canonicalBefore = await snapshot();
    let injected = false;
    const failing = new class extends FileStore {
      override async writeText(file: string, text: string) {
        const selected = !injected && (target === 'manifest' ? file === paths.projectArtifact(manifest)
          : target === 'ready_task' && file.endsWith('/submission_task.json') && JSON.parse(text).status === 'ready');
        if (selected) injected = true;
        if (selected && when === 'before') throw Object.assign(new Error('publication fault'), { code: 'EIO' });
        await store.writeText(file, text);
        if (selected && when === 'after') throw Object.assign(new Error('publication fault'), { code: 'EIO' });
      }
    }();
    const result = await check(failing).then(task => ({ task }), error => ({ error }));
    expect(injected).toBe(target !== 'clean');
    if (target === 'clean') expect(result).toMatchObject({ task: { status: 'ready' } });
    const afterCheck = await snapshot();
    for (const [file, bytes] of Object.entries(canonicalBefore)) expect(afterCheck[file], file).toBe(bytes);
    for (const file of Object.keys(afterCheck).filter(file => !(file in canonicalBefore))) {
      expect(file.startsWith('runs/') || file.startsWith('codex/runs/') || file.startsWith('chapters/chapter_001/submission_previews/'), file).toBe(true);
    }
    const calls = await readFile(`${seed.codexBin}.stdin.ndjson`);
    const main = service();
    const admitted = await main.readPreview({ projectKey });
    const preview = await desktop.readDesktopSubmissionPreview(input()).catch(() => null);
    expect(admitted.outcome === 'ready').toBe(published);
    expect(preview !== null).toBe(published);
    const issues = await auditDesktopSubmissions(paths);
    if (published) {
      expect(issues).toEqual([]);
      expect(admitted.outcome).toBe('ready');
      if (admitted.outcome !== 'ready') throw new Error('expected token');
      await expect(main.confirm({ projectKey, previewToken: admitted.previewToken, confirm: true })).resolves.toMatchObject({ outcome: 'committed' });
      await expect(desktop.readDesktopSubmissionRecovery({ projectRoot: paths.projectRoot })).resolves.toMatchObject({ outcome: 'committed' });
      expect(await readFile(paths.chapterArtifact(1, 'final.md'))).toEqual(Buffer.from(seed.adoptedText));
      expect(await auditDesktopSubmissions(paths)).toEqual([]);
      const strict = await auditProject({ projectId: paths.projectId, projectsRoot: root, strict: true, fixIndex: true });
      expect(strict.exitCode).toBe(0);
    } else {
      await expect(desktop.confirmDesktopChapterSubmission(await confirmInput())).rejects.toBeDefined();
      await expect(desktop.readDesktopSubmissionRecovery({ projectRoot: paths.projectRoot })).resolves.toEqual({ outcome: 'none' });
      expect(await snapshot()).toEqual(afterCheck);
      if (await store.exists(paths.projectArtifact(manifest))) expect(issues.some(issue => issue.blocking)).toBe(true);
    }
    expect(await readFile(`${seed.codexBin}.stdin.ndjson`)).toEqual(calls);
  });

  const corruptions = ['task_missing', 'task_running', 'task_project', 'task_run', 'task_chapter', 'task_preview',
    'run_missing', 'run_failed', 'run_project', 'run_id', 'run_command', 'run_argument', 'run_context', 'run_resolved'] as const;
  async function corrupt(kind: typeof corruptions[number], runId: string) {
    const task = kind.startsWith('task_');
    const file = paths.projectArtifact(`runs/${runId}/${task ? 'submission_task' : 'run_manifest'}.json`);
    if (kind.endsWith('_missing')) { await rm(file); return; }
    const value = JSON.parse(await store.readText(file));
    if (kind === 'task_running') Object.assign(value, { status: 'running', previewId: null, endedAt: null });
    if (kind.endsWith('_project')) value.projectId = 'other_project';
    if (kind === 'task_run' || kind === 'run_id') value.runId = 'other_run';
    if (kind === 'task_chapter') value.chapterNumber = 2;
    if (kind === 'task_preview') value.previewId = 'other_preview';
    if (kind === 'run_failed') value.status = 'failed';
    if (kind === 'run_command') value.command = 'other-command';
    if (kind === 'run_argument') value.args.chapterNumber = 2;
    if (kind === 'run_context') value.resolvedContext.chapterNumber = 2;
    if (kind === 'run_resolved') value.resolvedContext.resolvedChapterNumber = 2;
    await store.writeText(file, JSON.stringify(value));
  }

  it.each(corruptions)('rejects %s before admission and direct confirmation without healing evidence', async kind => {
    const task = await check();
    expect(task.status).toBe('ready');
    const preview = (await desktop.readDesktopSubmissionPreview(input()))!;
    const main = service();
    const admitted = await main.readPreview({ projectKey });
    expect(admitted.outcome).toBe('ready');
    await corrupt(kind, task.runId!);
    const before = await snapshot();
    await expect(desktop.verifyDesktopSubmissionPreviewIntegrity(preview, paths.projectRoot)).rejects.toBeDefined();
    await expect(desktop.readDesktopSubmissionPreview(input())).rejects.toBeDefined();
    expect((await service().readPreview({ projectKey })).outcome).not.toBe('ready');
    if (admitted.outcome !== 'ready') throw new Error('expected token');
    expect((await main.confirm({ projectKey, previewToken: admitted.previewToken, confirm: true })).outcome).not.toBe('committed');
    await expect(desktop.confirmDesktopChapterSubmission(await confirmInput())).rejects.toBeDefined();
    expect((await auditDesktopSubmissions(paths)).some(issue => issue.blocking)).toBe(true);
    expect(await snapshot()).toEqual(before);
  });

  it.each(corruptions)('rejects completed recovery with %s instead of contradicting audit', async kind => {
    const task = await check();
    expect(task.status).toBe('ready');
    await desktop.confirmDesktopChapterSubmission(await confirmInput());
    await expect(desktop.readDesktopSubmissionRecovery({ projectRoot: paths.projectRoot })).resolves.toMatchObject({ outcome: 'committed' });
    await corrupt(kind, task.runId!);
    const before = await snapshot();
    const calls = await readFile(`${seed.codexBin}.stdin.ndjson`);
    await expect(desktop.readDesktopSubmissionRecovery({ projectRoot: paths.projectRoot })).resolves.toEqual({ outcome: 'recovery_required' });
    expect((await auditDesktopSubmissions(paths)).some(issue => issue.blocking)).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(await readFile(`${seed.codexBin}.stdin.ndjson`)).toEqual(calls);
  });
});
