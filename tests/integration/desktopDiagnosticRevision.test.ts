import { cp, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { auditDesktopDiagnosticRevisions } from '../../src/app/desktopDiagnosticRevisionAudit.js';
import { createDesktopSubmissionFixture } from '../helpers/desktopSubmissionFixture.js';
import { checkSubmissionPreview } from '../../src/app/desktopSubmissionPreview.js';
import { captureDiagnosticRevisionSource } from '../../src/app/desktopDiagnosticRevisionSource.js';
import { generateDiagnosticRevision, readDiagnosticRevisionCandidate, recoverInterruptedDiagnosticRevisionTask } from '../../src/app/desktopDiagnosticRevision.js';
import { adoptDiagnosticRevision, rejectDiagnosticRevision } from '../../src/app/desktopDiagnosticRevisionAdoption.js';
import { createAuthorRevision, adoptAuthorRevision } from '../../src/app/chapterAuthorRevision.js';

let seed: Awaited<ReturnType<typeof createDesktopSubmissionFixture>>;
let root: string;
let projectRoot: string;
const input = () => ({ projectRoot, chapterNumber: 1, diagnosticTaskId: 'diagnostic_failed' });
beforeAll(async () => { seed = await createDesktopSubmissionFixture(); }, 60000);
afterAll(async () => seed?.cleanup());
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'diagnostic-revision-'));
  projectRoot = path.join(root, seed.projectId);
  await cp(seed.projectRoot, projectRoot, { recursive: true });
  const json = {
    chapterNumber: 1, draftVersion: 1, passed: false, averageScore: 8,
    hardChecks: ['timeline_consistency', 'character_knowledge_consistency', 'world_rule_consistency', 'no_unplanned_reveal'].map((checkName, index) => ({ checkName, result: index === 0 ? 'fail' : 'pass', blocking: index === 0, evidence: '重复事故', explanation: index === 0 ? '细节不一致' : '一致' })),
    softScores: Object.fromEntries(['plot_progression', 'character_consistency', 'tension_curve', 'emotional_impact', 'chapter_hook', 'style_match', 'genre_satisfaction', 'reader_curiosity'].map(key => [key, 8])),
    diagnostics: [], revisionRequired: true
  };
  const task = await checkSubmissionPreview({ projectRoot, chapterNumber: 1, taskId: 'diagnostic_failed' }, {
    client: { async complete() { return { json, text: JSON.stringify(json) }; } }, shouldCancel: () => false, onProgress: async () => {}
  });
  expect(task.safeErrorCode).toBe('diagnostics_failed');
});
afterEach(async () => { vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); });

test('binds current failed diagnostics and rejects subsequent context changes', async () => {
  const binding = await captureDiagnosticRevisionSource(input());
  expect(binding.source.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
  await writeFile(path.join(projectRoot, 'chapters/chapter_001/selected_plan.md'), 'different plan');
  await expect(captureDiagnosticRevisionSource(input())).rejects.toMatchObject({ code: 'source_stale' });
});

test('generates isolated schema-valid candidate without altering original or state', async () => {
  const protectedPaths = ['state/story_state.json', 'planning/chapter_queue.json', 'chapters/chapter_001/draft_v1.md', seed.adoptedDraftPath];
  const before = await Promise.all(protectedPaths.map(p => readFile(path.join(projectRoot, p), 'utf8')));
  const markdown = `${seed.adoptedText}\n修订后的细节。\n`;
  const task = await generateDiagnosticRevision({ ...input(), taskId: 'dr_task_valid' }, {
    client: { async complete(request) {
      expect(request.user).toContain(seed.adoptedText);
      const json = { markdown, changes: [{ issueIndex: 0, reason: '统一细节' }] };
      return { json, text: JSON.stringify(json) };
    } }, shouldCancel: () => false, onProgress: async () => {}
  });
  expect(task.status).toBe('ready');
  const result = await readDiagnosticRevisionCandidate({ projectRoot, chapterNumber: 1, candidateId: task.candidateId! });
  expect(result.candidateText).toBe(markdown);
  expect(result.canAdopt).toBe(true);
  expect(await Promise.all(protectedPaths.map(p => readFile(path.join(projectRoot, p), 'utf8')))).toEqual(before);
});

test.each(['invalid', 'cancelled', 'changed', 'bad-index'])('does not publish %s response', async kind => {
  let cancelled = false;
  const task = await generateDiagnosticRevision({ ...input(), taskId: `dr_task_${kind}` }, {
    client: { async complete() {
      if (kind === 'cancelled') cancelled = true;
      if (kind === 'changed') await writeFile(path.join(projectRoot, 'chapters/chapter_001/selected_plan.md'), 'changed');
      const json = kind === 'invalid' ? {} : { markdown: seed.adoptedText, changes: [{ issueIndex: kind === 'bad-index' ? 100000 : 0, reason: '统一' }] };
      return { json, text: JSON.stringify(json) };
    } }, shouldCancel: () => cancelled, onProgress: async () => {}
  });
  expect(task.status).not.toBe('ready');
  expect(task.candidateId).toBeNull();
  if (kind === 'cancelled') expect(task.status).toBe('cancelled');
});

test.each(['adopt', 'reject'])('explicit %s preserves state and never calls the provider again', async decision => {
  const state = await readFile(path.join(projectRoot, 'state/story_state.json'), 'utf8');
  let calls = 0;
  const task = await generateDiagnosticRevision({ ...input(), taskId: 'dr_task_decision' }, {
    client: { async complete() { calls++; const json = { markdown: `${seed.adoptedText}\n新的局部细节。`, changes: [{ issueIndex: 0, reason: '修正重复事件' }] }; return { json, text: JSON.stringify(json) }; } }, shouldCancel: () => false, onProgress: async () => {}
  });
  expect(task.status).toBe('ready');
  const identity = { projectRoot, chapterNumber: 1, candidateId: task.candidateId! };
  if (decision === 'adopt') {
    const first = await adoptDiagnosticRevision(identity);
    expect(first.alreadyAdopted).toBe(false);
    const again = await adoptDiagnosticRevision(identity);
    expect(again.authorRevisionId).toBe(first.authorRevisionId);
    expect(again.alreadyAdopted).toBe(true);
    expect((await readDiagnosticRevisionCandidate(identity)).disposition.status).toBe('adopted');
  } else {
    expect((await rejectDiagnosticRevision(identity)).status).toBe('rejected');
    expect((await readDiagnosticRevisionCandidate(identity)).canAdopt).toBe(false);
    await expect(adoptDiagnosticRevision(identity)).rejects.toBeTruthy();
  }
  expect(calls).toBe(1);
  expect(await readFile(path.join(projectRoot, 'state/story_state.json'), 'utf8')).toBe(state);
});

test.each(['state/story_state.json', 'planning/chapter_queue.json', 'config.json', 'chapters/chapter_001/mission.json', 'chapters/chapter_001/author_revisions/draft_revision_v1.md'])('rejects changed %s before a provider is invoked', async relative => {
  const full = path.join(projectRoot, relative);
  await writeFile(full, `${await readFile(full, 'utf8')}\n`);
  const complete = vi.fn();
  const result = await generateDiagnosticRevision({ ...input(), taskId: 'dr_task_stale' }, { client: { complete }, shouldCancel: () => false, onProgress: async () => {} });
  expect(result.status).not.toBe('ready');
  expect(complete).not.toHaveBeenCalled();
});

test('detects archived candidate tampering in audit and blocks adoption', async () => {
  const task = await readyCandidate();
  const identity = { projectRoot, chapterNumber: 1, candidateId: task.candidateId! };
  const value = await readDiagnosticRevisionCandidate(identity);
  const paths = new ProjectPaths(root, seed.projectId);
  expect(await auditDesktopDiagnosticRevisions(paths, FileStore.forProject(projectRoot))).toEqual([]);
  await writeFile(path.join(value.directory, 'candidate.md'), 'tampered');
  expect(await auditDesktopDiagnosticRevisions(paths, FileStore.forProject(projectRoot))).toEqual([expect.objectContaining({ severity: 'error' })]);
  await expect(adoptDiagnosticRevision(identity)).rejects.toBeTruthy();
});

test('reconciles crash after completed adoption without producing another author version', async () => {
  const task = await readyCandidate();
  const identity = { projectRoot, chapterNumber: 1, candidateId: task.candidateId! };
  const write = FileStore.prototype.writeJson;
  let fail = true;
  vi.spyOn(FileStore.prototype, 'writeJson').mockImplementation(async function (this: FileStore, file, value, schema) {
    if (fail && file.endsWith('disposition.json') && typeof value === 'object' && value !== null && 'status' in value && value.status === 'adopted') {
      fail = false; throw new Error('simulated power loss');
    }
    return write.call(this, file, value, schema);
  });
  await expect(adoptDiagnosticRevision(identity)).rejects.toThrow('simulated power loss');
  const result = await adoptDiagnosticRevision(identity);
  expect(result.alreadyAdopted).toBe(true);
  expect((await readDiagnosticRevisionCandidate(identity)).disposition.authorRevisionId).toBe(result.authorRevisionId);
});

async function readyCandidate() {
  return generateDiagnosticRevision({ ...input(), taskId: 'dr_task_ready' }, {
    client: { async complete() { const json = { markdown: `${seed.adoptedText}\n新的细节。`, changes: [{ issueIndex: 0, reason: '修正细节' }] }; return { json, text: JSON.stringify(json) }; } },
    shouldCancel: () => false, onProgress: async () => {}
  });
}

test('audit also validates partial failed candidate JSON artifacts', async () => {
  const task = await generateDiagnosticRevision({ ...input(), taskId: 'dr_task_invalid' }, { client: { async complete() { return { json: {}, text: '{}' }; } }, shouldCancel: () => false, onProgress: async () => {} });
  expect(task.status).toBe('failed');
  await writeFile(path.join(projectRoot, 'chapters/chapter_001/diagnostic_revisions/revision_v1/candidate.json'), '{}');
  expect(await auditDesktopDiagnosticRevisions(new ProjectPaths(root, seed.projectId), FileStore.forProject(projectRoot))).toEqual([expect.objectContaining({ severity: 'error' })]);
});

test('audit rejects candidate evidence whose publication task was deleted', async () => {
  await readyCandidate();
  await rm(path.join(projectRoot, 'chapters/chapter_001/diagnostic_revisions/revision_v1/task.json'));
  expect(await auditDesktopDiagnosticRevisions(new ProjectPaths(root, seed.projectId), FileStore.forProject(projectRoot))).toEqual([expect.objectContaining({ severity: 'error' })]);
});

test('identical text adopted as a new revision invalidates previous diagnostics', async () => {
  const binding = await captureDiagnosticRevisionSource(input());
  const revision = await createAuthorRevision({ projectRoot, chapterNumber: 1, artifactKind: 'draft', mode: 'direct_edit',
    sourceArtifactPath: binding.source.sourcePath, sourceCandidateId: null, expectedSourceHash: binding.source.sourceHash, content: seed.adoptedText, authorInstruction: 'New author decision' });
  await adoptAuthorRevision({ projectRoot, chapterNumber: 1, revisionId: revision.record.revisionId, expectedSourceHash: binding.source.sourceHash });
  await expect(captureDiagnosticRevisionSource(input())).rejects.toMatchObject({ code: 'source_stale' });
});

test('source symlink substitution blocks generation without calling provider', async () => {
  const binding = await captureDiagnosticRevisionSource(input());
  const file = path.join(projectRoot, binding.source.sourcePath);
  const outside = path.join(root, 'outside.md');
  await writeFile(outside, await readFile(file));
  await rm(file); await symlink(outside, file);
  const complete = vi.fn();
  const task = await generateDiagnosticRevision({ ...input(), taskId: 'dr_symlink' }, { client: { complete }, shouldCancel: () => false, onProgress: async () => {} });
  expect(task.status).toBe('failed'); expect(complete).not.toHaveBeenCalled();
});

test('persisted interrupted tasks recover without restarting provider work', async () => {
  const task = await readyCandidate();
  const file = path.join(projectRoot, 'chapters/chapter_001/diagnostic_revisions/revision_v1/task.json');
  const { ownerPid: _owner, ...persisted } = task;
  await writeFile(file, JSON.stringify({ ...persisted, status: 'running', candidateId: null, endedAt: null }));
  const recovered = await recoverInterruptedDiagnosticRevisionTask({ projectRoot, chapterNumber: 1, taskId: task.taskId });
  expect(recovered).toMatchObject({ status: 'interrupted', candidateId: null });
  await expect(readDiagnosticRevisionCandidate({ projectRoot, chapterNumber: 1, candidateId: task.candidateId! })).rejects.toBeTruthy();
});

test('cancellation before invocation and concurrent start never produce a late candidate', async () => {
  const complete = vi.fn();
  const cancelled = await generateDiagnosticRevision({ ...input(), taskId: 'dr_cancel_early' }, { client: { complete }, shouldCancel: () => true, onProgress: async () => {} });
  expect(cancelled.status).toBe('cancelled'); expect(complete).not.toHaveBeenCalled();
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const began = new Promise<void>(resolve => { entered = resolve; });
  let cancel = false;
  const first = generateDiagnosticRevision({ ...input(), taskId: 'dr_first' }, {
    client: { async complete() { entered(); await held; const json = { markdown: seed.adoptedText, changes: [{ issueIndex: 0, reason: 'fix' }] }; return { json, text: JSON.stringify(json) }; } },
    shouldCancel: () => cancel, onProgress: async () => {}
  });
  await began;
  try {
    const second = await generateDiagnosticRevision({ ...input(), taskId: 'dr_second' }, { client: { complete }, shouldCancel: () => false, onProgress: async () => {} });
    expect(second.status).toBe('failed'); expect(complete).not.toHaveBeenCalled();
  } finally { cancel = true; release(); }
  expect(await first).toMatchObject({ status: 'cancelled', candidateId: null });
});
