import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as desktop from '../../src/desktop/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProviderError } from '../../src/providers/codexTextProvider.js';
import type { LLMClient, LLMRequest } from '../../src/llm/LLMClient.js';
import { createDesktopSubmissionFixture } from '../helpers/desktopSubmissionFixture.js';
import { startCommitJournal } from '../../src/app/commitJournal.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { createHash } from 'node:crypto';
import { captureSubmissionSource, readExactSubmissionText } from '../../src/app/desktopSubmissionSource.js';
import { adoptAuthorRevision, createAuthorRevision } from '../../src/app/chapterAuthorRevision.js';
import { AuthorRevisionRecordSchema } from '../../src/schemas/index.js';

const chapter = 'chapters/chapter_001';
const previews = `${chapter}/submission_previews`;
const diagnostic = () => ({
  chapterNumber: 1, draftVersion: 1, passed: true, averageScore: 8.6,
  hardChecks: ['timeline_consistency', 'character_knowledge_consistency', 'world_rule_consistency', 'no_unplanned_reveal']
    .map(checkName => ({ checkName, result: 'pass', blocking: false, evidence: '', explanation: 'No contradiction.' })),
  softScores: Object.fromEntries(['plot_progression', 'character_consistency', 'tension_curve', 'emotional_impact', 'chapter_hook', 'style_match', 'genre_satisfaction', 'reader_curiosity'].map(key => [key, 8.6])),
  diagnostics: [], revisionRequired: false
});
const proposal = () => ({
  chapterNumber: 1, sourceFinalPath: `${chapter}/final.md`, latestCommittedChapter: 1,
  newFacts: [], characterStates: [], characterUpdates: [], timelineEvents: [],
  narrativeDebtUpdates: [], foreshadowingUpdates: [], relationshipUpdates: [],
  readerStatePatch: { addKnows: [], addSuspects: [], addQuestions: [], addMisdirections: [], removeQuestions: [] }
});

it.skipIf(process.platform === 'win32')('rejects a FIFO in a bounded isolated reader process', async () => {
  const fifo = process.env.SUBMISSION_FIFO_TEST_PATH;
  if (fifo !== undefined) {
    await expect(readExactSubmissionText(FileStore.forProject(path.dirname(fifo)), fifo)).rejects.toMatchObject({ code: 'source_missing' });
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'submission-fifo-'));
  try {
    const target = path.join(root, 'source.md');
    const created = spawnSync('mkfifo', [target], { timeout: 2000, encoding: 'utf8' });
    expect(created.error).toBeUndefined();
    expect(created.status).toBe(0);
    const vitest = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
    const result = spawnSync(process.execPath, [vitest, 'run', fileURLToPath(import.meta.url), '-t', 'rejects a FIFO in a bounded isolated reader process', '--pool=threads', '--maxWorkers=1'], {
      env: { ...process.env, SUBMISSION_FIFO_TEST_PATH: target }, timeout: 8000, killSignal: 'SIGKILL', encoding: 'utf8'
    });
    expect(result.error, result.stdout + result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);

describe('isolated desktop submission', () => {
  let seed: Awaited<ReturnType<typeof createDesktopSubmissionFixture>>;
  let root: string;
  let projectRoot: string;
  let store: FileStore;
  let requests: LLMRequest[];
  let before: Record<string, string>;
  const input = () => ({ projectRoot, chapterNumber: 1, taskId: 'submission_test' });
  const client = (hook?: (request: LLMRequest, value: ReturnType<typeof diagnostic> | ReturnType<typeof proposal>) => Promise<unknown> | unknown): LLMClient => ({
    async complete(request) {
      requests.push(request);
      const value = request.promptId.startsWith('diagnostics.') ? diagnostic() : proposal();
      const result = hook ? await hook(request, value) : value;
      return { text: JSON.stringify(result), json: result };
    }
  });
  const check = (llm = client(), shouldCancel = () => false, onProgress = async () => {}) => desktop.checkDesktopChapterSubmission(input(), { client: llm, shouldCancel, onProgress });
  async function snapshot(dir: string, relative = ''): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (name === 'runs' || name === 'codex/runs' || name === previews || entry.name.startsWith('.novel-loop-')) continue;
      if (entry.isDirectory()) Object.assign(result, await snapshot(path.join(dir, entry.name), name));
      else result[name] = (await readFile(path.join(dir, entry.name))).toString('base64');
    }
    return result;
  }
  async function noManifest() {
    const dir = path.join(projectRoot, previews);
    if (!(await store.exists(dir))) return;
    for (const name of await store.list(dir)) expect(await store.exists(path.join(dir, name, 'manifest.json'))).toBe(false);
  }
  beforeAll(async () => { seed = await createDesktopSubmissionFixture(); }, 60000);
  afterAll(async () => { await seed?.cleanup(); });
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'submission-case-'));
    projectRoot = path.join(root, seed.projectId);
    await cp(seed.projectRoot, projectRoot, { recursive: true });
    store = FileStore.forProject(projectRoot);
    requests = [];
    before = await snapshot(projectRoot);
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

  it('passes exact adopted B to both stages and publishes only isolated artifacts', async () => {
    expect(typeof desktop.checkDesktopChapterSubmission).toBe('function');
    const task = await check();
    expect(task.status).toBe('ready');
    expect(requests).toHaveLength(2);
    for (const request of requests) expect(request.user).toContain(seed.adoptedText);
    const preview = await desktop.readDesktopSubmissionPreview(input());
    expect(preview?.source.sourceKind).toBe('adopted');
    expect(await store.readText(path.join(projectRoot, preview!.artifacts.source.path))).toBe(seed.adoptedText);
    expect(await readFile(path.join(projectRoot, preview!.artifacts.source.path))).toEqual(await readFile(path.join(projectRoot, seed.adoptedDraftPath)));
    expect(await snapshot(projectRoot)).toEqual(before);
    const run = JSON.parse(await store.readText(path.join(projectRoot, 'runs', task.runId!, 'run_manifest.json')));
    expect(run.promptCalls).toHaveLength(2);
    expect(run.status).toBe('success');
    expect(JSON.parse(await store.readText(path.join(projectRoot, preview!.artifacts.patchProposal.path)))).toEqual(proposal());
    expect(run.artifacts.find((item: { path: string }) => item.path === preview!.artifacts.patchProposal.path).provenanceNote).toContain('DesktopSubmissionPatchProposalSchema');
    const again = await check();
    expect(again.previewId).not.toBe(task.previewId);
    expect((await desktop.readDesktopSubmissionPreview(input()))?.version).toBe(2);
  });

  it('sends adopted bytes through the real fake Codex process', async () => {
    vi.stubEnv('NLE_CODEX_BIN', seed.codexBin);
    const task = await desktop.checkDesktopChapterSubmission(input(), { shouldCancel: () => false, onProgress: async () => {} });
    expect(task.status).toBe('ready');
    const log = await readFile(`${seed.codexBin}.stdin.ndjson`, 'utf8');
    const calls = log.trim().split('\n').map(line => JSON.parse(line) as string);
    for (const id of ['diagnostics.diagnose_chapter_slim', 'memory.extract_canon_patch_proposal_slim']) {
      expect(calls.filter(value => value.includes(`PROMPT_ID: ${id}`)).at(-1)).toContain(seed.adoptedText);
    }
    expect(await snapshot(projectRoot)).toEqual(before);
    const run = JSON.parse(await store.readText(path.join(projectRoot, 'runs', task.runId!, 'run_manifest.json')));
    expect(run.promptCalls).toHaveLength(2);
    const preview = (await desktop.readDesktopSubmissionPreview(input()))!;
    const rawProposal = JSON.parse(await store.readText(path.join(projectRoot, preview.artifacts.patchProposal.path)));
    expect(rawProposal.characterStates[0]).toHaveProperty('characterId', 'char_lincheng');
    expect(rawProposal.characterStates[0]).not.toHaveProperty('id');
  });

  it('does not block independent draft reads while the model is running', async () => {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const running = check(client(async (_request, value) => { entered(); await released; return value; }));
    await waiting;
    try {
      await expect(desktop.readDesktopChapterDraft({ projectRoot })).resolves.toBeDefined();
    } finally { release(); await running; }
  });

  it.each(['config.json', 'state/story_state.json', 'planning/chapter_queue.json', `${chapter}/mission.json`, `${chapter}/selected_plan.md`, `${chapter}/draft_v1.md`])('rejects stale %s after a provider boundary', async file => {
    const task = await check(client(async (_request, value) => {
      await writeFile(path.join(projectRoot, file), `${await store.readText(path.join(projectRoot, file))}\n`);
      return value;
    }));
    expect(task).toMatchObject({ status: 'blocked', safeErrorCode: 'source_stale' });
    expect(requests).toHaveLength(1);
    await noManifest();
  });

  it.each(['missing_text', 'changed_text', 'missing_record', 'invalid_record'])('never falls back for %s adoption', async scenario => {
    const target = path.join(projectRoot, scenario.includes('record') ? seed.revisionRecordPath : seed.adoptedDraftPath);
    if (scenario.startsWith('missing')) await rm(target);
    else await writeFile(target, 'corrupted');
    const task = await check();
    expect(task.status).toBe('blocked');
    expect(requests).toHaveLength(0);
    await noManifest();
  });

  it.each(['hard', 'score', 'schema', 'conflict', 'patch_schema'])('blocks %s without canonical writes', async scenario => {
    const task = await check(client((request, value) => {
      if (scenario === 'schema' || (scenario === 'patch_schema' && request.promptId.startsWith('memory.'))) return { unexpected: true };
      if (request.promptId.startsWith('diagnostics.')) {
        const diagnostics = value as ReturnType<typeof diagnostic>;
        if (scenario === 'hard') { diagnostics.passed = false; diagnostics.revisionRequired = true; diagnostics.hardChecks[0]!.result = 'fail'; diagnostics.hardChecks[0]!.blocking = true; }
        if (scenario === 'score') diagnostics.softScores.plot_progression = 0;
      } else if (scenario === 'conflict') (value as ReturnType<typeof proposal>).latestCommittedChapter = 2;
      return value;
    }));
    expect(['blocked', 'failed']).toContain(task.status);
    if (scenario === 'hard' || scenario === 'score') expect(task.safeErrorCode).toBe('diagnostics_failed');
    expect(requests).toHaveLength(['conflict', 'patch_schema'].includes(scenario) ? 2 : 1);
    expect(await snapshot(projectRoot)).toEqual(before);
    await noManifest();
    if (scenario === 'patch_schema') {
      expect(await store.exists(path.join(projectRoot, previews, 'preview_v1', 'patch_proposal.json'))).toBe(false);
      const run = JSON.parse(await store.readText(path.join(projectRoot, 'runs', task.runId!, 'run_manifest.json')));
      expect(run.status).toBe('failed');
      expect(run.promptCalls).toHaveLength(2);
      expect(run.artifacts.some((item: { path: string }) => item.path.endsWith('/patch_proposal.json'))).toBe(false);
      expect(await store.exists(path.join(projectRoot, 'runs', task.runId!, 'prompts', 'memory_extract_canon_patch_proposal_slim_response.md'))).toBe(true);
    }
  });

  it.each([0, 1, 2])('cancels at provider boundary %s without ready publication', async count => {
    const task = await check(client(), () => requests.length >= count);
    expect(task.status).toBe('cancelled');
    expect(requests).toHaveLength(count);
    expect(await snapshot(projectRoot)).toEqual(before);
    await noManifest();
  });

  it.each(['source', 'output'])('rejects %s symlinks even with an injected unrestricted store', async scenario => {
    const target = path.join(projectRoot, scenario === 'source' ? seed.adoptedDraftPath : previews);
    if (scenario === 'source') await rm(target);
    await symlink(scenario === 'source' ? path.join(seed.projectRoot, seed.adoptedDraftPath) : root, target);
    const task = await desktop.checkDesktopChapterSubmission(input(), { fileStore: new FileStore(), client: client(), shouldCancel: () => false, onProgress: async () => {} });
    expect(task).toMatchObject({ status: 'blocked', safeErrorCode: 'unsafe_path' });
    expect(requests).toHaveLength(0);
  });

  it('invalidates a persisted preview after changes and detects artifact tampering', async () => {
    await check();
    const preview = (await desktop.readDesktopSubmissionPreview(input()))!;
    await writeFile(path.join(projectRoot, preview.artifacts.source.path), 'tampered');
    await expect(desktop.readDesktopSubmissionPreview(input())).rejects.toThrow();
  });

  it('allows the last planned chapter but rejects missing current planning', async () => {
    const queuePath = path.join(projectRoot, 'planning/chapter_queue.json');
    const queue = JSON.parse(await store.readText(queuePath));
    queue.chapters = queue.chapters.filter((item: { chapterNumber: number }) => item.chapterNumber === 1);
    await writeFile(queuePath, JSON.stringify(queue));
    expect((await check()).status).toBe('ready');
    await rm(path.join(projectRoot, chapter, 'mission.json'));
    expect((await check()).safeErrorCode).toBe('plan_missing');
  });

  it.each(['incomplete', 'invalid', 'wrong_scope', 'false_completed'])('rejects %s versioned commit journals without recovery writes', async scenario => {
    const journal = await startCommitJournal({ paths: new ProjectPaths(root, seed.projectId), fileStore: store, chapterNumber: 1, commitKind: 'chapter_commit', provider: 'mock' });
    if (scenario === 'invalid') await writeFile(journal.absolutePath, '{');
    if (scenario === 'wrong_scope') await writeFile(journal.absolutePath, JSON.stringify({ ...journal.journal, projectId: 'wrong' }));
    if (scenario === 'false_completed') await writeFile(journal.absolutePath, JSON.stringify({ ...journal.journal, status: 'completed' }));
    const expected = await snapshot(projectRoot);
    expect(await check()).toMatchObject({ status: 'blocked', safeErrorCode: 'recovery_required' });
    expect(requests).toHaveLength(0);
    expect(await snapshot(projectRoot)).toEqual(expected);
  });

  it.each(['stale_due_to_history_edit', 'recommitted', 'committed'])('rejects queue status %s', async status => {
    const queuePath = path.join(projectRoot, 'planning/chapter_queue.json');
    const queue = JSON.parse(await store.readText(queuePath));
    queue.chapters[0].status = status;
    await writeFile(queuePath, JSON.stringify(queue));
    expect((await check()).status).toBe('blocked');
    expect(requests).toHaveLength(0);
    await noManifest();
  });

  it('matches the editor latest adopted identity even with multiple dated adopted records', async () => {
    const original = JSON.parse(await store.readText(path.join(projectRoot, seed.revisionRecordPath)));
    const recordPath = `${chapter}/author_revisions/draft_revision_v2.json`;
    const draftPath = `${chapter}/author_revisions/draft_revision_v2.md`;
    const text = 'LATEST_ADOPTED_C\r\n';
    await writeFile(path.join(projectRoot, draftPath), text);
    await writeFile(path.join(projectRoot, recordPath), JSON.stringify({ ...original, revisionId: 'author_revision_ch001_draft_v2', workingCopyPath: draftPath, workingCopyHash: createHash('sha256').update(text).digest('hex'), adoptedAt: '2099-01-01T00:00:00.000Z' }));
    const editor = await desktop.readDesktopChapterDraft(input());
    const source = await captureSubmissionSource(input(), store);
    expect(source.revisionId).toBe('author_revision_ch001_draft_v2');
    expect(JSON.stringify(editor)).toContain('LATEST_ADOPTED_C');
    expect(source.sourcePath).toBe(draftPath);
  });

  async function revision(artifactKind: 'mission' | 'selected_plan' | 'draft') {
    const filename = { mission: 'mission.json', selected_plan: 'selected_plan.md', draft: 'draft_v1.md' }[artifactKind];
    const sourceArtifactPath = path.join(projectRoot, chapter, filename);
    return createAuthorRevision({
      projectRoot, chapterNumber: 1, artifactKind, mode: 'direct_edit',
      sourceArtifactPath, sourceCandidateId: artifactKind === 'selected_plan' ? 'plan_fixture' : null,
      content: await store.readText(sourceArtifactPath), authorInstruction: null
    }, store);
  }

  it.each(['mission', 'selected_plan', 'draft'] as const)('keeps older ready %s alternatives as evidence after a later revision is adopted', async kind => {
    const old = await revision(kind);
    const chosen = await revision(kind);
    await adoptAuthorRevision({ projectRoot, chapterNumber: 1, revisionId: chosen.record.revisionId }, store);
    const unchanged = await snapshot(projectRoot);
    expect((await check()).status).toBe('ready');
    const preview = (await desktop.readDesktopSubmissionPreview(input()))!;
    const verified = await desktop.verifyDesktopSubmissionPreviewIntegrity(preview, projectRoot);
    expect(verified.sourceText).toBe(kind === 'draft' ? seed.originalText : seed.adoptedText);
    expect(preview.source.additionalInputs.map(item => item.path)).toContain(old.relativeRecordPath);
    expect(await snapshot(projectRoot)).toEqual(unchanged);
    expect((await store.readJson(path.join(projectRoot, old.relativeRecordPath), AuthorRevisionRecordSchema)).state).toBe('ready');
  });

  it.each(['working', 'publishing', 'ready'] as const)('still blocks a newer %s revision after adoption', async state => {
    const chosen = await revision('mission');
    await adoptAuthorRevision({ projectRoot, chapterNumber: 1, revisionId: chosen.record.revisionId }, store);
    const pending = await revision('mission');
    await store.writeJson(path.join(projectRoot, pending.relativeRecordPath), { ...pending.record, state, mode: 'codex_adjustment', authorInstruction: 'Adjust the mission.' }, AuthorRevisionRecordSchema);
    expect(await check()).toMatchObject({ status: 'blocked', safeErrorCode: 'working_copy_pending' });
    expect(requests).toHaveLength(0);
    await noManifest();
  });

  it.each(['working', 'publishing'] as const)('does not hide an older incomplete %s revision behind a later adoption', async state => {
    const pending = await revision('mission');
    const chosen = await revision('mission');
    await adoptAuthorRevision({ projectRoot, chapterNumber: 1, revisionId: chosen.record.revisionId }, store);
    await store.writeJson(path.join(projectRoot, pending.relativeRecordPath), { ...pending.record, state, mode: 'codex_adjustment', authorInstruction: 'Adjust the mission.' }, AuthorRevisionRecordSchema);
    expect(await check()).toMatchObject({ status: 'blocked', safeErrorCode: 'working_copy_pending' });
    expect(requests).toHaveLength(0);
  });

  it('does not use a draft adoption to dismiss a pending mission revision', async () => {
    await revision('mission');
    expect(await check()).toMatchObject({ status: 'blocked', safeErrorCode: 'working_copy_pending' });
    expect(requests).toHaveLength(0);
  });

  it('still verifies the content hash of an older ready alternative', async () => {
    const old = await revision('mission');
    const chosen = await revision('mission');
    await adoptAuthorRevision({ projectRoot, chapterNumber: 1, revisionId: chosen.record.revisionId }, store);
    await store.writeText(path.join(projectRoot, old.relativeMarkdownPath), 'Tampered old alternative');
    expect(await check()).toMatchObject({ status: 'blocked', safeErrorCode: 'source_missing' });
    expect(requests).toHaveLength(0);
  });

  it.each(['usage_limit', 'login_required', 'upgrade_required', 'unavailable', 'invalid_output'] as const)('preserves provider classification %s and terminal provenance', async classification => {
    const task = await check({ async complete() { throw new ProviderError('CODEX_EXEC_FAILED', 'sk-secret credential must not escape', true, classification); } });
    expect(task.safeErrorCode).toBe(classification === 'unavailable' ? 'codex_unavailable' : classification);
    const text = await store.readText(path.join(projectRoot, 'runs', task.runId!, 'run_manifest.json'));
    expect(text).not.toContain('sk-secret');
    const run = JSON.parse(text);
    expect(run.promptCalls).toHaveLength(1);
    expect(run.status).not.toBe('running');
    await noManifest();
  });

  it('returns stale with terminal provenance when state becomes malformed during a call', async () => {
    const task = await check(client(async (_request, value) => { await writeFile(path.join(projectRoot, 'state/story_state.json'), '{'); return value; }));
    expect(task.safeErrorCode).toBe('source_stale');
    const run = JSON.parse(await store.readText(path.join(projectRoot, 'runs', task.runId!, 'run_manifest.json')));
    expect(run.status).toBe('blocked');
    await noManifest();
  });

  it('uses generated text only when there is no adoption record or orphaned adoption evidence', async () => {
    await rm(path.join(projectRoot, chapter, 'author_revisions'), { recursive: true });
    const task = await check();
    expect(task.status).toBe('ready');
    const preview = (await desktop.readDesktopSubmissionPreview(input()))!;
    const verified = await desktop.verifyDesktopSubmissionPreviewIntegrity(preview, projectRoot);
    expect(preview.source.sourceKind).toBe('generated');
    expect(verified.sourceText).toBe(seed.originalText);
    expect(verified.patch.sourceFinalPath).toBe(`${chapter}/final.md`);
  });

  it('keeps the entire adopted text beyond the context budget and preserves CRLF bytes', async () => {
    const text = `# Exact Title\r\n${'long text '.repeat(4000)}\r\nEND_OF_ADOPTED_TEXT\r\n`;
    const recordPath = path.join(projectRoot, seed.revisionRecordPath);
    const record = JSON.parse(await store.readText(recordPath));
    await writeFile(path.join(projectRoot, seed.adoptedDraftPath), text);
    await writeFile(recordPath, JSON.stringify({ ...record, workingCopyHash: createHash('sha256').update(text).digest('hex') }));
    expect((await check()).status).toBe('ready');
    for (const request of requests) expect(request.user).toContain(text);
    const preview = (await desktop.readDesktopSubmissionPreview(input()))!;
    expect(await readFile(path.join(projectRoot, preview.artifacts.source.path))).toEqual(Buffer.from(text));
  });

  it.each(['bom', 'malformed'])('preserves exact bytes or rejects %s UTF8 without fallback', async kind => {
    const bytes = kind === 'bom' ? Buffer.from('\uFEFF# Adopted BOM\r\nExact bytes.\r\n') : Buffer.from([0x23, 0x20, 0xc3, 0x28]);
    const recordPath = path.join(projectRoot, seed.revisionRecordPath);
    const record = JSON.parse(await store.readText(recordPath));
    await writeFile(path.join(projectRoot, seed.adoptedDraftPath), bytes);
    // A lossy hash could otherwise match readText's replacement-character output.
    await writeFile(recordPath, JSON.stringify({ ...record, workingCopyHash: createHash('sha256').update(bytes.toString('utf8')).digest('hex') }));
    const task = await check();
    if (kind === 'malformed') {
      expect(task.status).toBe('blocked');
      expect(requests).toHaveLength(0);
      await noManifest();
    } else {
      expect(task.status).toBe('ready');
      const preview = (await desktop.readDesktopSubmissionPreview(input()))!;
      expect(await readFile(path.join(projectRoot, preview.artifacts.source.path))).toEqual(bytes);
      expect(preview.source.sourceHash).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });
});
