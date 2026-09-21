import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { readDesktopSubmissionDiagnostics } from '../../src/desktop/chapterSubmission.js';
import { RunLogger } from '../../src/logging/RunLogger.js';
import { submissionHash } from '../../src/app/desktopSubmissionSource.js';
import { DesktopSubmissionTaskSchema, DiagnosticsReportSchema, RunManifestV2Schema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'submission-diagnostics-')); roots.push(parent);
  const paths = new ProjectPaths(parent, 'diagnostic-fixture');
  await mkdir(paths.projectRoot);
  const store = FileStore.forProject(paths.projectRoot);
  const runId = 'run_diagnostics';
  const logger = new RunLogger(paths, store);
  await logger.startRun({ runId, command: 'desktop-submission-check', args: { chapterNumber: 1 } });
  const task = DesktopSubmissionTaskSchema.parse({ schemaVersion: 1, taskId: 'task_diagnostics', projectId: paths.projectId,
    chapterNumber: 1, stage: 'diagnostics', status: 'blocked', runId, previewId: null,
    startedAt: '2026-09-21T00:00:00Z', endedAt: '2026-09-21T00:00:01Z', safeErrorCode: 'diagnostics_failed' });
  const diagnostics = DiagnosticsReportSchema.parse(JSON.parse(await readFile('fixtures/llm/diagnostics.diagnose_chapter.v1.json', 'utf8')));
  diagnostics.passed = false;
  const sourceText = '他尚未打开信封，却已经说出了信中的秘密。';
  diagnostics.hardFailures[0]!.message = '人物提前得知了尚未读到的内容。';
  diagnostics.hardFailures[0]!.evidence = sourceText;
  const base = 'chapters/chapter_001/submission_previews/preview_v1';
  await store.writeText(paths.projectArtifact(`${base}/source.md`), sourceText);
  await store.writeJson(paths.projectArtifact(`${base}/diagnostics.json`), diagnostics, DiagnosticsReportSchema);
  await logger.recordArtifact(runId, `${base}/source.md`, { stage: 'checking_source' });
  await logger.recordArtifact(runId, `${base}/diagnostics.json`, { stage: 'diagnostics' });
  const run = await logger.readManifestV2(runId);
  run.status = 'blocked'; run.endedAt = task.endedAt!;
  await store.writeJson(paths.runManifest(runId), run, RunManifestV2Schema);
  const taskPath = path.join(paths.runDir(runId), 'submission_task.json');
  await store.writeJson(taskPath, task, DesktopSubmissionTaskSchema);
  return { paths, store, run, task, taskPath, diagnostics, sourceText, base, input: { projectRoot: paths.projectRoot, taskId: task.taskId } };
}

test('reads failed diagnostic evidence without a ready manifest or live project and makes no writes', async () => {
  const f = await fixture();
  const before = await Promise.all([f.taskPath, f.paths.runManifest(f.run.runId)].map(file => readFile(file, 'utf8')));
  expect(await readDesktopSubmissionDiagnostics(f.input)).toEqual({ task: f.task, diagnostics: f.diagnostics, sourceText: f.sourceText });
  expect(await Promise.all([f.taskPath, f.paths.runManifest(f.run.runId)].map(file => readFile(file, 'utf8')))).toEqual(before);
  expect(await f.store.exists(f.paths.projectArtifact(`${f.base}/manifest.json`))).toBe(false);
  expect(await readDesktopSubmissionDiagnostics({ ...f.input, taskId: 'task_absent' })).toBeNull();
});

test.each(['diagnostics.json', 'source.md'])('rejects changed recorded %s bytes', async name => {
  const f = await fixture();
  await writeFile(f.paths.projectArtifact(`${f.base}/${name}`), 'changed');
  await expect(readDesktopSubmissionDiagnostics(f.input)).rejects.toMatchObject({ code: 'invalid_output' });
});

test.each(['run', 'project', 'command', 'chapter', 'status', 'artifact-run', 'artifact-chapter', 'scope', 'duplicate', 'missing-source'])('rejects mismatched %s provenance', async kind => {
  const f = await fixture();
  if (kind === 'run') f.run.runId = 'run_other';
  if (kind === 'project') f.run.projectId = 'other-project';
  if (kind === 'command') f.run.command = 'chapter-draft';
  if (kind === 'chapter') f.run.args.chapterNumber = 2;
  if (kind === 'status') f.run.status = 'success';
  if (kind === 'artifact-run') f.run.artifacts[1]!.runId = 'run_other';
  if (kind === 'artifact-chapter') f.run.artifacts[1]!.chapterNumber = 2;
  if (kind === 'scope') f.run.artifacts[1]!.path = 'chapters/chapter_002/submission_previews/preview_v1/diagnostics.json';
  if (kind === 'duplicate') f.run.artifacts.push(f.run.artifacts[1]!);
  if (kind === 'missing-source') f.run.artifacts.shift();
  await f.store.writeJson(f.paths.runManifest('run_diagnostics'), f.run, RunManifestV2Schema);
  await expect(readDesktopSubmissionDiagnostics(f.input)).rejects.toMatchObject({ code: 'invalid_output' });
});

test.each(['wrong-chapter', 'malformed'])('rejects %s diagnostics even with matching recorded bytes', async kind => {
  const f = await fixture();
  const text = JSON.stringify(kind === 'malformed' ? { chapterNumber: 1 } : { ...f.diagnostics, chapterNumber: 2 });
  await writeFile(f.paths.projectArtifact(`${f.base}/diagnostics.json`), text);
  f.run.artifacts[1]!.sha256 = submissionHash(text);
  f.run.artifacts[1]!.sizeBytes = Buffer.byteLength(text);
  await f.store.writeJson(f.paths.runManifest(f.run.runId), f.run, RunManifestV2Schema);
  await expect(readDesktopSubmissionDiagnostics(f.input)).rejects.toMatchObject({ code: 'invalid_output' });
});

test('rejects symlink evidence and unsafe request fields', async () => {
  const f = await fixture();
  const source = f.paths.projectArtifact(`${f.base}/source.md`);
  const other = path.join(path.dirname(f.paths.projectRoot), 'outside.md');
  await writeFile(other, f.sourceText); await rm(source); await symlink(other, source);
  await expect(readDesktopSubmissionDiagnostics(f.input)).rejects.toMatchObject({ code: 'invalid_output' });
  await expect(readDesktopSubmissionDiagnostics({ ...f.input, taskId: '../outside' })).rejects.toMatchObject({ code: 'invalid_output' });
  await expect(readDesktopSubmissionDiagnostics({ ...f.input, path: other } as never)).rejects.toMatchObject({ code: 'invalid_output' });
});
