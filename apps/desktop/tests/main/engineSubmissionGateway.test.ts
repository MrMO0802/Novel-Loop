import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { DesktopSubmissionPreview, DesktopSubmissionVerifiedPreview } from 'novel-loop-engine/desktop';
import { EngineSubmissionGateway, type SubmissionLocalFacade } from '../../src/main/submission/EngineSubmissionGateway';
import { diffPatchPreview } from '../../../../src/app/stateDiff';
import { createInitialStoryState } from '../../../../src/app/initProject';
import { CanonPatchSchema, CharacterStateSchema, DiagnosticsReportSchema, DesktopSubmissionTaskSchema } from '../../../../src/schemas/index';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'submission-gateway-'));
  roots.push(temporary);
  const root = path.join(temporary, 'gateway-project');
  await mkdir(root);
  const base = 'chapters/chapter_001/submission_previews/preview_v1';
  const sourceText = 'Reviewed draft.';
  const state = createInitialStoryState(path.basename(root));
  state.characters = ['Alice', 'Bob'].map(name => CharacterStateSchema.parse({ id: `char_${name.toLowerCase()}`, name, role: 'supporting', publicDescription: '城中的居民。' }));
  const patch = CanonPatchSchema.parse({ chapterNumber: 1, sourceFinalPath: 'chapters/chapter_001/final.md', newFacts: [{ id: 'fact_one', text: '信件已经送达。', sourceChapter: 1, type: 'event', visibility: { reader: true }, createdAt: '2026-09-21T00:00:00Z' }] });
  const stateText = JSON.stringify(state);
  const ref = (name: string) => ({ path: `${base}/${name}`, hash: 'a'.repeat(64) });
  const preview: DesktopSubmissionPreview = {
    schemaVersion: 1, previewId: 'submission_ch001_v1', version: 1, projectId: path.basename(root), chapterNumber: 1,
    createdAt: '2026-09-21T00:00:00Z', runId: 'run_fixture', gatePassed: true,
    source: { projectId: path.basename(root), chapterNumber: 1, sourceKind: 'generated', sourcePath: 'chapters/chapter_001/draft_v1.md', sourceHash: hash(sourceText), revisionId: null, revisionRecord: null,
      state: { path: 'state/story_state.json', hash: hash(stateText) }, queue: ref('queue'), mission: ref('mission'), selectedPlan: ref('plan'), config: ref('config'), additionalInputs: [] },
    artifacts: { source: { path: `${base}/source.md`, hash: hash(sourceText) }, diagnostics: ref('diagnostics.json'), patch: ref('normalized_patch.json'), patchProposal: ref('patch_proposal.json'), conflict: ref('conflict_report.json'), diff: ref('state_diff.json') }
  };
  const manifest = path.join(root, base, 'manifest.json');
  const manifestText = `${JSON.stringify(preview, null, 2)}\n`;
  await mkdir(path.dirname(manifest), { recursive: true });
  await writeFile(manifest, manifestText);
  await mkdir(path.join(root, 'state'));
  await writeFile(path.join(root, 'state/story_state.json'), stateText);
  const changes = diffPatchPreview(state, patch);
  const verified = { sourceText, patch, diff: { changes } } as DesktopSubmissionVerifiedPreview;
  const facade = {
    readDesktopSubmissionPreview: vi.fn(async () => preview as DesktopSubmissionPreview | null),
    verifyDesktopSubmissionPreviewIntegrity: vi.fn(async () => verified),
    checkDesktopChapterSubmission: vi.fn()
  };
  const local = {
    confirm: vi.fn<SubmissionLocalFacade['confirm']>(), readTasks: vi.fn<SubmissionLocalFacade['readTasks']>(async () => []),
    readDiagnostics: vi.fn<SubmissionLocalFacade['readDiagnostics']>(async () => null),
    readRecovery: vi.fn<SubmissionLocalFacade['readRecovery']>(async () => ({ outcome: 'none' }))
  };
  const gateway = new EngineSubmissionGateway(local, async () => facade);
  return { root, gateway, local, facade, preview, verified, manifest, manifestText, changes, state, patch };
}

test('binds raw persisted manifest hash rather than a reserialized or UI-derived hash', async () => {
  const f = await fixture();
  const result = await f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 });
  expect(result).toMatchObject({ manifestHash: hash(f.manifestText), chapterNumber: 1 });
  expect(result?.manifestHash).not.toBe(hash(JSON.stringify(f.preview)));
  expect(f.facade.verifyDesktopSubmissionPreviewIntegrity).toHaveBeenCalledWith(f.preview, f.root);
  expect(f.local.confirm).not.toHaveBeenCalled();
});

test('rejects manifest changes before and during independent integrity verification', async () => {
  const f = await fixture();
  await writeFile(f.manifest, JSON.stringify({ ...f.preview, previewId: 'changed' }));
  await expect(f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 })).rejects.toMatchObject({ code: 'source_stale' });
  await writeFile(f.manifest, f.manifestText);
  f.facade.verifyDesktopSubmissionPreviewIntegrity.mockImplementation(async () => {
    await writeFile(f.manifest, `${f.manifestText}\n`); return f.verified;
  });
  await expect(f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 })).rejects.toMatchObject({ code: 'source_stale' });
});

test('does not issue a review after source freshness, schema or hash validation failure', async () => {
  const f = await fixture();
  f.facade.verifyDesktopSubmissionPreviewIntegrity.mockRejectedValue(Object.assign(new Error('sensitive'), { code: 'source_stale' }));
  await expect(f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 })).rejects.toMatchObject({ code: 'source_stale' });
});

test('does not follow a substituted manifest symlink', async () => {
  const f = await fixture(); const outside = path.join(f.root, 'outside.json');
  await writeFile(outside, f.manifestText); await rm(f.manifest); await symlink(outside, f.manifest);
  await expect(f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 })).rejects.toMatchObject({ code: 'unsafe_path' });
});

test('maps every diff including chapter advancement and critical risk without hiding an entry', async () => {
  const f = await fixture();
  f.changes.at(-1)!.riskLevel = 'critical';
  const result = await f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 });
  expect(result?.changes).toHaveLength(f.changes.length);
  expect(result?.changes.at(-1)).toMatchObject({ category: 'progress', risk: 'high', summary: expect.stringContaining('1') });
  expect(JSON.stringify(result)).not.toMatch(/latestCommittedChapter|changeType|added:|modified:|sourceChapter|readerKnows/u);
});

test('relationship review preserves both actor identities using names, not internal identifiers', async () => {
  const f = await fixture();
  f.patch.relationshipUpdates.push({ fromCharacterId: 'char_alice', toCharacterId: 'char_bob', change: '信任加深。', evidence: '两人一起读信。' });
  f.verified.diff.changes = diffPatchPreview(f.state, f.patch);
  const result = await f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 });
  const relationship = result?.changes.find(change => change.category === 'relationships');
  expect(relationship?.summary).toContain('Alice');
  expect(relationship?.summary).toContain('Bob');
  expect(JSON.stringify(result)).not.toContain('char_');
  expect(JSON.stringify(result)).not.toMatch(/fromCharacterId|toCharacterId|evidence:|change:/u);
});

test('real debt and character mutations retain identity, translated states and every before/after detail', async () => {
  const f = await fixture();
  f.patch.characterUpdates.push({ characterId: 'char_alice', field: 'emotionalState', newValue: '不安', reason: '收到陌生人的来信。' });
  f.patch.narrativeDebtUpdates.push({ action: 'create', payload: { id: 'debt_letter', type: 'mystery', promise: '揭开寄信人的身份', readerQuestion: '谁寄出了信？', introducedInChapter: 1, status: 'open', importance: 8, urgency: 5 } });
  f.verified.diff.changes = diffPatchPreview(f.state, f.patch);
  const result = await f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 });
  expect(result?.changes).toHaveLength(f.verified.diff.changes.length);
  const text = result?.changes.map(change => change.summary).join('\n');
  expect(text).toContain('Alice'); expect(text).toContain('情绪'); expect(text).toContain('不安');
  expect(text).toContain('揭开寄信人的身份'); expect(text).toContain('未解决');
  expect(text).not.toMatch(/emotionalState|payload|introducedInChapter|\bopen\b|\bcreate\b/u);
});

test.each([false, true])('cumulative reader history does not block a small patch (empty=%s)', async empty => {
  const f = await fixture();
  f.state.readerState.readerKnows = Array.from({ length: 70 }, (_, index) => `历史信息${index}：${'此前章节已经讲述的往事。'.repeat(10)}`);
  f.state.readerState.readerQuestions = ['信是谁寄出的？'];
  if (!empty) {
    f.patch.readerStatePatch.addKnows = ['寄信人住在河边。'];
    f.patch.readerStatePatch.removeQuestions = ['信是谁寄出的？'];
  }
  const stateText = JSON.stringify(f.state);
  f.preview.source.state.hash = hash(stateText);
  await writeFile(path.join(f.root, 'state/story_state.json'), stateText);
  await writeFile(f.manifest, JSON.stringify(f.preview));
  f.verified.diff.changes = diffPatchPreview(f.state, f.patch);
  const result = await f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 });
  const reader = result?.changes.filter(change => change.category === 'reader_information');
  expect(reader?.length).toBeGreaterThan(0);
  expect(reader?.every(change => change.summary.length <= 4000)).toBe(true);
  expect(reader?.map(change => change.summary).join('')).not.toContain('此前章节');
  if (!empty) {
    expect(reader?.map(change => change.summary).join('')).toContain('寄信人住在河边。');
    expect(reader?.map(change => change.summary).join('')).toContain('信是谁寄出的？');
  }
});

test('large actual reader additions are split completely into bounded changes without truncation', async () => {
  const f = await fixture();
  f.patch.readerStatePatch.addKnows = Array.from({ length: 12 }, (_, index) => `新增事实${index}：${'新的故事事实。'.repeat(70)}`);
  f.verified.diff.changes = diffPatchPreview(f.state, f.patch);
  const result = await f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 });
  const reader = result?.changes.filter(change => change.category === 'reader_information') ?? [];
  const combined = reader.map(change => change.summary).join('\n');
  expect(reader.every(change => change.summary.length <= 4000)).toBe(true);
  for (const fact of f.patch.readerStatePatch.addKnows) expect(combined).toContain(fact);
});

test('a single long new fact remains complete and simultaneous added/removed questions are not net changes', async () => {
  const f = await fixture();
  const text = '新的事实。'.repeat(1000);
  f.patch.readerStatePatch.addKnows = [text];
  f.patch.readerStatePatch.addQuestions = ['已经当场解答的问题。'];
  f.patch.readerStatePatch.removeQuestions = ['已经当场解答的问题。'];
  f.verified.diff.changes = diffPatchPreview(f.state, f.patch);
  const result = await f.gateway.readPreview({ projectRoot: f.root, chapterNumber: 1 });
  const reader = result?.changes.filter(change => change.category === 'reader_information') ?? [];
  expect(reader).toHaveLength(2);
  expect(reader.map(change => change.summary.slice(change.summary.indexOf('：') + 1)).join('')).toBe(text);
  expect(reader.every(change => change.summary.length <= 4000)).toBe(true);
});

test('local confirmation forwards only the planned trusted input and never invokes provider facade', async () => {
  const f = await fixture();
  f.local.confirm.mockResolvedValue({ chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: false, commitReportPath: 'report' });
  const input = { projectRoot: f.root, chapterNumber: 1, previewId: f.preview.previewId, expectedManifestHash: hash(f.manifestText), approvalId: 'approval_test', confirm: true as const };
  await f.gateway.confirm(input);
  expect(f.local.confirm).toHaveBeenCalledWith(input);
  expect(f.facade.checkDesktopChapterSubmission).not.toHaveBeenCalled();
  expect(f.facade.readDesktopSubmissionPreview).not.toHaveBeenCalled();
});

test('default gateway is wired to real read-only task and recovery facade exports', async () => {
  const f = await fixture();
  const gateway = new EngineSubmissionGateway();
  expect(await gateway.readTasks(f.root)).toEqual([]);
  // This deliberately incomplete temporary project has no queue. It must not look complete.
  expect(await gateway.readRecovery(f.root)).toEqual({ outcome: 'recovery_required' });
});

async function diagnosticFixture() {
  const f = await fixture();
  const task = DesktopSubmissionTaskSchema.parse({ schemaVersion: 1, taskId: 'task_diagnostics', projectId: path.basename(f.root),
    chapterNumber: 1, stage: 'diagnostics', status: 'blocked', runId: 'run_diagnostics', previewId: null,
    startedAt: '2026-09-21T00:00:00Z', endedAt: '2026-09-21T00:00:01Z', safeErrorCode: 'diagnostics_failed' });
  const diagnostics = DiagnosticsReportSchema.parse(JSON.parse(await readFile('../../fixtures/llm/diagnostics.diagnose_chapter.v1.json', 'utf8')));
  const sourceText = '他尚未打开信封，却已经说出了信中的秘密。';
  diagnostics.hardFailures = [{ code: 'knowledge', severity: 'high', message: '人物提前得知了尚未读到的内容。', evidence: sourceText }];
  diagnostics.hard_checks.no_unplanned_reveal = { passed: true, message: '未提前揭晓。' };
  diagnostics.issues = [];
  f.local.readDiagnostics.mockResolvedValue({ task, diagnostics, sourceText });
  return { ...f, task, diagnostics, sourceText };
}

test('failed diagnostics retain concrete Chinese problems and captured source evidence', async () => {
  const f = await diagnosticFixture();
  expect(await f.gateway.readIssues(f.root, f.task)).toEqual([{ severity: 'error', message: '人物提前得知了尚未读到的内容。', evidence: f.sourceText }]);
  expect(f.local.readDiagnostics).toHaveBeenCalledWith({ projectRoot: f.root, taskId: f.task.taskId });
});

test.each(['/private/secret.json', 'Bearer secret-token', 'sk-secret', 'char_private'])('unsafe diagnostic text is withheld without leaking %s', async unsafe => {
  const f = await diagnosticFixture();
  f.diagnostics.hardFailures[0]!.message = unsafe;
  f.diagnostics.hardFailures[0]!.evidence = unsafe;
  f.local.readDiagnostics.mockResolvedValue({ task: f.task, diagnostics: f.diagnostics, sourceText: unsafe });
  const issues = await f.gateway.readIssues(f.root, f.task);
  expect(issues).toHaveLength(1);
  expect(issues[0]?.evidence).toBeNull();
  expect(JSON.stringify(issues)).not.toContain(unsafe);
});

test('ungrounded evidence is not presented as a source quotation and cross-task diagnostics fail closed', async () => {
  const f = await diagnosticFixture();
  f.diagnostics.hardFailures[0]!.evidence = '正文并没有这句话。';
  expect((await f.gateway.readIssues(f.root, f.task))[0]?.evidence).toBeNull();
  f.local.readDiagnostics.mockResolvedValue({ task: { ...f.task, taskId: 'task_other' }, diagnostics: f.diagnostics, sourceText: f.sourceText });
  await expect(f.gateway.readIssues(f.root, f.task)).rejects.toMatchObject({ code: 'invalid_output' });
});

test('long diagnostics and evidence stay bounded, preserving messages and all kinds of reported problems', async () => {
  const f = await diagnosticFixture();
  const message = '人物尚未获得这些信息。'.repeat(250);
  const evidence = '他没有打开信封。'.repeat(150);
  f.diagnostics.hardFailures[0]!.message = message;
  f.diagnostics.hardFailures[0]!.evidence = evidence;
  f.diagnostics.hard_checks.timeline_consistency = { passed: false, message: '时间前后矛盾。', evidence };
  f.diagnostics.missionSatisfaction.objectiveResults = [{ objectiveId: 'obj_private', satisfied: false, issue: '本章没有完成调查目标。', evidence }];
  f.diagnostics.issues = [{ type: 'pacing', severity: 'low', message: '节奏偏慢。', locationHint: evidence, recommendation: '压缩重复描述。' }];
  f.local.readDiagnostics.mockResolvedValue({ task: f.task, diagnostics: f.diagnostics, sourceText: evidence });
  const issues = await f.gateway.readIssues(f.root, f.task);
  expect(issues.map(issue => issue.message).join('')).toContain(message);
  expect(issues.map(issue => issue.message).join('')).toContain('时间前后矛盾。');
  expect(issues.map(issue => issue.message).join('')).toContain('本章没有完成调查目标。');
  expect(issues.map(issue => issue.message).join('')).toContain('压缩重复描述。');
  expect(issues.every(issue => issue.message.length <= 2000 && issue.evidence!.length <= 1000)).toBe(true);
  expect(JSON.stringify(issues)).not.toMatch(/obj_private|normalizationWarnings|locationHint/u);
});
