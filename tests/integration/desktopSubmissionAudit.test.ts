import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { refreshArtifactIndex } from '../../src/app/artifactIndex.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { commitChapterState } from '../../src/app/chapterCommit.js';
import { startCommitJournal } from '../../src/app/commitJournal.js';
import { checkSubmissionPreview } from '../../src/app/desktopSubmissionPreview.js';
import { auditDesktopSubmissions } from '../../src/app/desktopSubmissionAudit.js';
import { confirmSubmissionCommit } from '../../src/app/desktopSubmissionCommit.js';
import { RunLogger } from '../../src/logging/RunLogger.js';
import { DesktopSubmissionPreviewSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { createDesktopSubmissionFixture } from '../helpers/desktopSubmissionFixture.js';

const previewRoot = 'chapters/chapter_001/submission_previews/preview_v1';
const manifestPath = `${previewRoot}/manifest.json`;
const journalPath = 'chapters/chapter_001/commit_journal_v1.json';
const approvalPath = `${previewRoot}/approval.json`;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

describe('desktop submission audit', () => {
  let seed: Awaited<ReturnType<typeof createDesktopSubmissionFixture>>;
  let root: string;
  let paths: ProjectPaths;
  let store: FileStore;
  let runId: string;
  const input = () => ({ projectId: paths.projectId, projectsRoot: root, strict: true });
  const read = (relative: string) => store.readText(paths.projectArtifact(relative));
  const write = (relative: string, text: string) => store.writeText(paths.projectArtifact(relative), text);
  const audit = () => auditProject(input(), store);
  const submissionIssues = async () => (await audit()).report.issues.filter(issue => issue.category.startsWith('desktop_submission'));
  const confirmInput = async () => {
    const text = await read(manifestPath);
    const preview = DesktopSubmissionPreviewSchema.parse(JSON.parse(text));
    return { projectRoot: paths.projectRoot, chapterNumber: 1, previewId: preview.previewId,
      expectedManifestHash: hash(text), approvalId: 'audit_commit_approval', confirm: true as const };
  };
  const commit = async () => confirmSubmissionCommit(await confirmInput());

  beforeAll(async () => {
    seed = await createDesktopSubmissionFixture();
    const task = await checkSubmissionPreview({ projectRoot: seed.projectRoot, chapterNumber: 1, taskId: 'audit_fixture' }, {
      shouldCancel: () => false, onProgress: async () => {},
      client: { async complete(request) {
        const value = request.promptId.startsWith('diagnostics.') ? {
          chapterNumber: 1, draftVersion: 1, passed: true, averageScore: 8.6,
          hardChecks: ['timeline_consistency', 'character_knowledge_consistency', 'world_rule_consistency', 'no_unplanned_reveal']
            .map(checkName => ({ checkName, result: 'pass', blocking: false, evidence: '', explanation: 'No contradiction.' })),
          softScores: Object.fromEntries(['plot_progression', 'character_consistency', 'tension_curve', 'emotional_impact', 'chapter_hook', 'style_match', 'genre_satisfaction', 'reader_curiosity'].map(key => [key, 8.6])),
          diagnostics: [], revisionRequired: false
        } : {
          chapterNumber: 1, sourceFinalPath: 'chapters/chapter_001/final.md', latestCommittedChapter: 1,
          newFacts: [], characterStates: [], characterUpdates: [], timelineEvents: [],
          narrativeDebtUpdates: [], foreshadowingUpdates: [], relationshipUpdates: [],
          readerStatePatch: { addKnows: [], addSuspects: [], addQuestions: [], addMisdirections: [], removeQuestions: [] }
        };
        return { text: JSON.stringify(value), json: value };
      } }
    });
    expect(task.status).toBe('ready');
    runId = task.runId!;
  }, 60000);
  afterAll(async () => { await seed?.cleanup(); });
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'submission-audit-'));
    paths = new ProjectPaths(root, seed.projectId);
    await cp(seed.projectRoot, paths.projectRoot, { recursive: true });
    store = FileStore.forProject(paths.projectRoot);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('accepts a real isolated preview in strict project audit', async () => {
    const result = await audit();
    expect(result.report.issues.filter(issue => issue.blocking)).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  describe('review fix round 1', () => {
    it.each(['failed', 'running', 'command', 'argument_chapter', 'context_chapter', 'resolved_chapter'])('blocks contradictory preview run %s in full project audit', async change => {
      const relative = `runs/${runId}/run_manifest.json`;
      const run = JSON.parse(await read(relative));
      if (change === 'failed' || change === 'running') run.status = change;
      if (change === 'command') run.command = 'unrelated-command';
      if (change === 'argument_chapter') run.args.chapterNumber = 2;
      if (change === 'context_chapter') run.resolvedContext.chapterNumber = 2;
      if (change === 'resolved_chapter') run.resolvedContext.resolvedChapterNumber = 2;
      await write(relative, JSON.stringify(run));
      const result = await audit();
      expect(result.exitCode).toBe(2);
      expect(result.report.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: relative, category: 'desktop_submission_scope', blocking: true })
      ]));
    });

    it.each(['preview', 'commit'])('redacts invalid %s run JSON from the entire project audit', async kind => {
      if (kind === 'commit') await commit();
      const targetRunId = kind === 'preview' ? runId : JSON.parse(await read(journalPath)).runId;
      const relative = `runs/${targetRunId}/run_manifest.json`;
      await write(relative, 'sk-review-secret-payload');
      const result = await audit();
      expect(result.exitCode).toBe(2);
      expect(result.report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, blocking: true })]));
      expect(JSON.stringify(result.report)).not.toContain('sk-review');
      expect(await read(result.reportPath)).not.toContain('sk-review');
      expect(await read(result.markdownPath)).not.toContain('sk-review');
    });

    it.each([
      ['preview', 'guarded'], ['preview', 'unrestricted'], ['commit', 'guarded'], ['commit', 'unrestricted']
    ])('contains unsafe %s run manifest through performance counting with a %s store', async (kind, guard) => {
      if (kind === 'commit') await commit();
      const before = await audit();
      const targetRunId = kind === 'preview' ? runId : JSON.parse(await read(journalPath)).runId;
      const relative = `runs/${targetRunId}/run_manifest.json`;
      const original = await read(relative);
      const outside = path.join(root, 'outside-run.json');
      await writeFile(outside, original);
      await rm(paths.projectArtifact(relative));
      await symlink(outside, paths.projectArtifact(relative));
      const result = await auditProject(input(), guard === 'guarded' ? store : new FileStore());
      expect(result.exitCode).toBe(2);
      expect(result.report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, blocking: true })]));
      expect(result.report.performance.runManifestCount).toBe(before.report.performance.runManifestCount - 1);
      expect(await readFile(outside, 'utf8')).toBe(original);
      expect(JSON.stringify(result.report)).not.toContain(root);
      expect(await read(result.reportPath)).toContain('"ok": false');
    });
  });

  it('classifies isolated artifacts in both index and run lineage', async () => {
    const approval = `${previewRoot}/approval.json`;
    await write(approval, '{}');
    const expected = [
      [manifestPath, 'desktop_submission_preview', 'DesktopSubmissionPreviewSchema'],
      [`runs/${runId}/submission_task.json`, 'desktop_submission_task', 'DesktopSubmissionTaskSchema'],
      [approval, 'desktop_submission_approval', 'DesktopSubmissionApprovalSchema'],
      [`${previewRoot}/source.md`, 'desktop_submission_source', undefined],
      [`${previewRoot}/source_evidence.json`, 'desktop_submission_source', 'DesktopSubmissionSourceSchema'],
      [`${previewRoot}/diagnostics.json`, 'diagnostics', 'DiagnosticsReportSchema'],
      [`${previewRoot}/patch_proposal.json`, 'canon_patch', 'DesktopSubmissionPatchProposalSchema'],
      [`${previewRoot}/normalized_patch.json`, 'canon_patch', 'CanonPatchSchema'],
      [`${previewRoot}/conflict_report.json`, 'conflict_report', 'ConflictReportSchema'],
      [`${previewRoot}/state_diff.json`, 'state_diff', 'StateDiffReportSchema'],
      [`${previewRoot}/diagnostics_context_manifest.json`, 'diagnostics_context_manifest', 'DiagnosticsContextManifestSchema'],
      [`${previewRoot}/diagnostics_context_manifest.md`, 'diagnostics_context_manifest', undefined]
    ] as const;
    const index = (await refreshArtifactIndex(input(), store)).index;
    const logger = new RunLogger(paths, store);
    for (const [relative, artifactType, schemaName] of expected) {
      const item = index.artifacts.find(artifact => artifact.path === relative);
      expect(item?.artifactType, relative).toBe(artifactType);
      expect(item?.schemaName, relative).toBe(schemaName);
      await logger.recordArtifact(runId, relative);
    }
    const manifest = await logger.readManifestV2(runId);
    for (const [relative, artifactType, schemaName] of expected) {
      const item = manifest.artifacts.find(artifact => artifact.path === relative);
      expect(item?.artifactType, relative).toBe(artifactType);
      expect(item?.schemaName, relative).toBe(schemaName);
    }
  });

  it.each(['source.md', 'diagnostics.json', 'patch_proposal.json', 'normalized_patch.json', 'conflict_report.json', 'state_diff.json', 'source_evidence.json', 'diagnostics_context_manifest.json'])('reports missing published %s', async file => {
    const relative = `${previewRoot}/${file}`;
    await rm(paths.projectArtifact(relative));
    expect(await submissionIssues()).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, severity: 'error', blocking: true })]));
  });

  it.each(['manifest.json', 'diagnostics.json', 'patch_proposal.json', 'normalized_patch.json', 'conflict_report.json', 'state_diff.json', 'source_evidence.json', 'diagnostics_context_manifest.json'])('reports malformed %s without exposing its content', async file => {
    const relative = `${previewRoot}/${file}`;
    await write(relative, '{"secret":"sk-private-provider-payload"}');
    const issues = await submissionIssues();
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, severity: 'error' })]));
    expect(JSON.stringify(issues)).not.toContain('sk-private');
    expect(JSON.stringify(issues)).not.toContain(paths.projectRoot);
  });

  it.each(['source.md', 'diagnostics.json', 'patch_proposal.json', 'normalized_patch.json', 'conflict_report.json', 'state_diff.json'])('detects %s byte hash mismatch independently of run lineage', async file => {
    const relative = `${previewRoot}/${file}`;
    await write(relative, `${await read(relative)}\r\n`);
    expect(await submissionIssues()).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, category: 'desktop_submission_hash' })]));
  });

  it('rejects cross-version manifest references before following them', async () => {
    const preview = JSON.parse(await read(manifestPath));
    preview.artifacts.source.path = '../outside-secret.md';
    await write(manifestPath, JSON.stringify(preview));
    expect(await submissionIssues()).toEqual(expect.arrayContaining([expect.objectContaining({ path: manifestPath, category: 'desktop_submission_schema' })]));
  });

  it.each(['project', 'version', 'patch', 'diff', 'conflict', 'evidence'])('detects internally inconsistent %s scope even with matching hashes', async kind => {
    const preview = JSON.parse(await read(manifestPath));
    if (kind === 'project') { preview.projectId = 'other-project'; preview.source.projectId = 'other-project'; }
    else if (kind === 'version') {
      preview.version = 2;
      for (const ref of Object.values(preview.artifacts) as { path: string }[]) ref.path = ref.path.replace('preview_v1', 'preview_v2');
    } else {
      const relative = kind === 'evidence' ? `${previewRoot}/source_evidence.json` : preview.artifacts[kind].path;
      const artifact = JSON.parse(await read(relative));
      if (kind === 'patch' || kind === 'evidence') artifact.chapterNumber = 2;
      else if (kind === 'diff') artifact.patchPath = 'chapters/chapter_001/canon_patch.json';
      else artifact.sourcePatchPath = 'chapters/chapter_001/canon_patch.json';
      const text = JSON.stringify(artifact);
      await write(relative, text);
      if (kind !== 'evidence') preview.artifacts[kind].hash = hash(text);
    }
    await write(manifestPath, JSON.stringify(preview));
    expect((await submissionIssues()).some(issue => issue.blocking)).toBe(true);
  });

  it.each(['missing_manifest', 'invalid_task', 'wrong_run', 'wrong_preview'])('rejects ready task with %s', async kind => {
    const relative = `runs/${runId}/submission_task.json`;
    const task = JSON.parse(await read(relative));
    if (kind === 'missing_manifest') await rm(paths.projectArtifact(manifestPath));
    else if (kind === 'invalid_task') await write(relative, '{}');
    else { task[kind === 'wrong_run' ? 'runId' : 'previewId'] = 'wrong'; await write(relative, JSON.stringify(task)); }
    expect((await submissionIssues()).some(issue => issue.blocking)).toBe(true);
  });

  it('does not require ready artifacts for failed or cancelled checks', async () => {
    await rm(paths.projectArtifact(manifestPath));
    const relative = `runs/${runId}/submission_task.json`;
    const task = JSON.parse(await read(relative));
    await write(relative, JSON.stringify({ ...task, status: 'cancelled', previewId: null }));
    expect(await submissionIssues()).toEqual([]);
  });

  it('validates proposal structure even in an unpublished partial attempt', async () => {
    await rm(paths.projectArtifact(manifestPath));
    const relative = `runs/${runId}/submission_task.json`;
    const task = JSON.parse(await read(relative));
    await write(relative, JSON.stringify({ ...task, status: 'cancelled', previewId: null }));
    await write(`${previewRoot}/patch_proposal.json`, '{}');
    expect(await submissionIssues()).toEqual(expect.arrayContaining([expect.objectContaining({ path: `${previewRoot}/patch_proposal.json`, category: 'desktop_submission_schema' })]));
  });

  it.each(['source_evidence.json', 'diagnostics_context_manifest.json', 'diagnostics_context_manifest.md'])('verifies ancillary %s against immutable run lineage', async file => {
    const relative = `${previewRoot}/${file}`;
    await write(relative, `${await read(relative)}\n`);
    expect(await submissionIssues()).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, category: 'desktop_submission_hash' })]));
  });

  it('audits history without consulting live freshness or mutating artifacts', async () => {
    const { auditDesktopSubmissions } = await import('../../src/app/desktopSubmissionAudit.js');
    const previewBytes = await readFile(paths.projectArtifact(manifestPath));
    for (const relative of ['state/story_state.json', 'planning/chapter_queue.json', 'config.json', seed.adoptedDraftPath]) {
      await write(relative, 'changed after submission');
    }
    expect(await auditDesktopSubmissions(paths, store)).toEqual([]);
    expect(await readFile(paths.projectArtifact(manifestPath))).toEqual(previewBytes);
  });

  it('keeps strict audit green after a local commit advances live state and queue', async () => {
    await write('chapters/chapter_001/final.md', await read(`${previewRoot}/source.md`));
    await write('chapters/chapter_001/canon_patch.json', await read(`${previewRoot}/normalized_patch.json`));
    const result = await commitChapterState({ ...input(), chapterNumber: 1, provider: 'mock' }, store);
    expect(result.status).toBe('committed');
    const auditResult = await audit();
    expect(auditResult.report.issues.filter(issue => issue.blocking)).toEqual([]);
    expect(auditResult.exitCode).toBe(0);
    await write(`${previewRoot}/source.md`, 'history tampered');
    expect((await audit()).exitCode).toBe(2);
  });

  it('preserves the existing incomplete journal blocker without treating the preview as stale', async () => {
    await startCommitJournal({ paths, fileStore: store, chapterNumber: 1, commitKind: 'chapter_commit', provider: 'mock' });
    const result = await audit();
    expect(result.exitCode).toBe(2);
    expect(result.report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'commit_journal', severity: 'critical' })]));
    expect(result.report.issues.filter(issue => issue.category.startsWith('desktop_submission'))).toEqual([]);
  });

  it('rejects symlink references safely even with an unrestricted injected store', async () => {
    const { auditDesktopSubmissions } = await import('../../src/app/desktopSubmissionAudit.js');
    const relative = `${previewRoot}/source.md`;
    await rm(paths.projectArtifact(relative));
    const outside = path.join(root, 'outside.txt');
    await writeFile(outside, 'sk-outside-secret');
    await symlink(outside, paths.projectArtifact(relative));
    const issues = await auditDesktopSubmissions(paths, new FileStore());
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, blocking: true })]));
    expect(JSON.stringify(issues)).not.toContain('sk-outside');
    expect(JSON.stringify(issues)).not.toContain(root);
  });

  it('returns a safe project audit error for an unsafe preview lineage path', async () => {
    const relative = `${previewRoot}/source.md`;
    await rm(paths.projectArtifact(relative));
    const outside = path.join(root, 'outside.txt');
    await writeFile(outside, 'sk-outside-secret');
    await symlink(outside, paths.projectArtifact(relative));
    const result = await audit();
    expect(result.exitCode).toBe(2);
    expect(result.report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, blocking: true })]));
    expect(JSON.stringify(result.report)).not.toContain('sk-outside');
    expect(JSON.stringify(result.report)).not.toContain(root);
  });

  it('validates approvals against their exact persisted preview', async () => {
    const preview = DesktopSubmissionPreviewSchema.parse(JSON.parse(await read(manifestPath)));
    const approval = {
      schemaVersion: 1, approvalId: 'approval_test', previewId: preview.previewId,
      projectId: paths.projectId, chapterNumber: 1, sourceHash: preview.source.sourceHash,
      manifestHash: hash(await read(manifestPath)), patchHash: preview.artifacts.patch.hash,
      diffHash: preview.artifacts.diff.hash, confirmed: true, approvedAt: new Date().toISOString(), runId: 'commit_run'
    };
    await write(`${previewRoot}/approval.json`, JSON.stringify({ ...approval, patchHash: '0'.repeat(64) }));
    expect(await submissionIssues()).toEqual(expect.arrayContaining([expect.objectContaining({ path: `${previewRoot}/approval.json`, blocking: true })]));
  });

  describe('desktop commit provenance', () => {
    it('accepts an actual completed desktop commit in strict project audit', async () => {
      expect(await commit()).toMatchObject({ chapterNumber: 1, latestCommittedChapter: 1 });
      const result = await auditProject({ ...input(), fixIndex: true }, store);
      expect(result.report.issues.filter(issue => issue.blocking)).toEqual([]);
      expect(result.exitCode).toBe(0);
      expect(await auditDesktopSubmissions(paths, store)).toEqual([]);
      expect(await read('chapters/chapter_001/final.md')).toBe(seed.adoptedText);
    });

    it.each([
      ['previewId', 'wrong_preview'], ['previewManifestPath', 'chapters/chapter_001/submission_previews/preview_v2/manifest.json'],
      ['previewManifestHash', '0'.repeat(64)], ['approvalId', 'wrong_approval'],
      ['approvalRecordPath', 'chapters/chapter_001/approval.json'], ['approvalRecordHash', '0'.repeat(64)],
      ['sourceHash', '0'.repeat(64)], ['patchHash', '0'.repeat(64)], ['diffHash', '0'.repeat(64)],
      ['beforeStateHash', '0'.repeat(64)], ['afterStateHash', '0'.repeat(64)],
      ['canonicalFinalPath', 'chapters/chapter_002/final.md'], ['canonPatchPath', 'chapters/chapter_002/canon_patch.json'],
      ['commitReportPath', 'chapters/chapter_002/commit_report.json'], ['runId', 'wrong_run'],
      ['projectId', 'wrong-project'], ['chapterNumber', 2], ['journalId', 'wrong_journal'],
      ['journalPath', 'chapters/chapter_001/commit_journal_v2.json'], ['storyStatePath', 'state/other.json'],
      ['latestCommittedChapterBefore', 4], ['latestCommittedChapterAfter', 5]
    ])('rejects journal %s that disagrees with persisted commit evidence', async (field, value) => {
      await commit();
      const journal = JSON.parse(await read(journalPath));
      await write(journalPath, JSON.stringify({ ...journal, [field]: value }));
      expect(await auditDesktopSubmissions(paths, store)).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: journalPath, blocking: true })
      ]));
    });

    it.each(['approvalId', 'runId'])('rejects a changed approval %s even if the journal byte hash is updated', async field => {
      await commit();
      const approval = JSON.parse(await read(approvalPath));
      const text = JSON.stringify({ ...approval, [field]: 'different_identity' });
      await write(approvalPath, text);
      const journal = JSON.parse(await read(journalPath));
      await write(journalPath, JSON.stringify({ ...journal, approvalRecordHash: hash(text) }));
      expect((await auditDesktopSubmissions(paths, store)).some(issue => issue.blocking)).toBe(true);
    });

    it.each([approvalPath, journalPath, 'chapters/chapter_001/final.md', 'chapters/chapter_001/canon_patch.json', 'chapters/chapter_001/commit_report.json'])('rejects missing committed %s', async relative => {
      await commit();
      await rm(paths.projectArtifact(relative));
      expect((await auditDesktopSubmissions(paths, store)).some(issue => issue.blocking)).toBe(true);
      expect((await audit()).exitCode).toBe(2);
    });

    it.each([approvalPath, 'chapters/chapter_001/final.md', 'chapters/chapter_001/canon_patch.json'])('rejects changed bytes in committed %s', async relative => {
      await commit();
      await write(relative, `${await read(relative)}\r\n`);
      expect(await auditDesktopSubmissions(paths, store)).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: relative, category: 'desktop_submission_hash', blocking: true })
      ]));
      expect((await audit()).exitCode).toBe(2);
    });

    it.each([journalPath, approvalPath, 'chapters/chapter_001/canon_patch.json', 'chapters/chapter_001/commit_report.json'])('reports malformed committed %s without exposing raw content', async relative => {
      await commit();
      await write(relative, '{"secret":"sk-private-commit"}');
      const issues = await auditDesktopSubmissions(paths, store);
      expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, category: 'desktop_submission_schema', blocking: true })]));
      expect(JSON.stringify(issues)).not.toContain('sk-private');
    });

    it.each(['chapterNumber', 'canonPatchPath', 'snapshot', 'progression'])('rejects inconsistent commit report %s', async kind => {
      await commit();
      const relative = 'chapters/chapter_001/commit_report.json';
      const report = JSON.parse(await read(relative));
      if (kind === 'chapterNumber') report.chapterNumber = 2;
      if (kind === 'canonPatchPath') report.canonPatchPath = 'chapters/chapter_002/canon_patch.json';
      if (kind === 'snapshot') report.beforeSnapshot.snapshotId = 'other_snapshot';
      if (kind === 'progression') report.appliedChanges.latestCommittedChapter.to = 2;
      await write(relative, JSON.stringify(report));
      expect(await auditDesktopSubmissions(paths, store)).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, blocking: true })]));
    });

    it('rejects an orphan approval and duplicate journals', async () => {
      await commit();
      const journal = JSON.parse(await read(journalPath));
      await rm(paths.projectArtifact(journalPath));
      expect(await auditDesktopSubmissions(paths, store)).toEqual(expect.arrayContaining([expect.objectContaining({ path: approvalPath, blocking: true })]));
      await write(journalPath, JSON.stringify(journal));
      const duplicatePath = 'chapters/chapter_001/commit_journal_v2.json';
      await write(duplicatePath, JSON.stringify({ ...journal, journalId: 'commit_journal_ch001_v2', journalPath: duplicatePath }));
      expect((await auditDesktopSubmissions(paths, store)).some(issue => issue.blocking)).toBe(true);
    });

    it('reports interrupted desktop commit as incomplete without requiring unwritten outputs', async () => {
      const failingStore = new class extends FileStore {
        override async writeText(target: string, text: string) {
          if (target === paths.chapterArtifact(1, 'canon_patch.json')) throw new Error('sk-injected-write-failure');
          await store.writeText(target, text);
        }
      }();
      await expect(confirmSubmissionCommit(await confirmInput(), { fileStore: failingStore })).rejects.toMatchObject({ code: 'recovery_required' });
      const issues = await auditDesktopSubmissions(paths, store);
      expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: journalPath, category: 'desktop_submission_journal', blocking: true })]));
      expect(issues.some(issue => issue.path.endsWith('/commit_report.json'))).toBe(false);
      expect(JSON.stringify(issues)).not.toContain('sk-injected');
      expect((await audit()).exitCode).toBe(2);
    });

    it('does not revalidate mutable captured inputs after a desktop commit', async () => {
      await commit();
      for (const relative of ['state/story_state.json', 'planning/chapter_queue.json', 'config.json', seed.adoptedDraftPath]) {
        await write(relative, 'later history');
      }
      expect(await auditDesktopSubmissions(paths, store)).toEqual([]);
    });

    it.each(['missing', 'wrong_scope', 'wrong_mutation'])('rejects %s completed commit run provenance', async kind => {
      await commit();
      const journal = JSON.parse(await read(journalPath));
      const relative = `runs/${journal.runId}/run_manifest.json`;
      if (kind === 'missing') await rm(paths.projectArtifact(relative));
      else {
        const run = JSON.parse(await read(relative));
        if (kind === 'wrong_scope') run.projectId = 'other-project';
        else run.stateMutations[0].afterSnapshotId = 'other_snapshot';
        await write(relative, JSON.stringify(run));
      }
      expect(await auditDesktopSubmissions(paths, store)).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, blocking: true })]));
    });

    it.each([journalPath, 'chapters/chapter_001/canon_patch.json'])('does not expose invalid JSON content from committed %s in project audit', async relative => {
      await commit();
      await write(relative, 'sk-private-commit-payload');
      const result = await audit();
      expect(result.exitCode).toBe(2);
      expect(JSON.stringify(result.report)).not.toContain('sk-private');
    });

    it.each(['final.md', 'canon_patch.json'])('contains unsafe canonical %s as a project audit error', async file => {
      await commit();
      const relative = `chapters/chapter_001/${file}`;
      await rm(paths.projectArtifact(relative));
      const outside = path.join(root, 'outside.txt');
      await writeFile(outside, 'sk-outside-commit');
      await symlink(outside, paths.projectArtifact(relative));
      const result = await audit();
      expect(result.exitCode).toBe(2);
      expect(result.report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: relative, blocking: true })]));
      expect(JSON.stringify(result.report)).not.toContain('sk-outside');
    });
  });
});
