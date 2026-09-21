import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import { normalizeCodexSlimOutput } from '../providers/codex/normalizers.js';
import { DesktopSubmissionPatchProposalSchema } from '../schemas/desktopSubmissionPatchProposal.js';
import {
  CanonPatchSchema, CommitJournalSchema, CommitReportSchema, ConflictReportSchema, DesktopSubmissionApprovalSchema,
  DesktopSubmissionPreviewSchema, DesktopSubmissionSourceSchema, DesktopSubmissionTaskSchema,
  DiagnosticsContextManifestSchema, DiagnosticsReportSchema, RunManifestSchema, StateDiffReportSchema
} from '../schemas/index.js';
import type { AuditIssue, CommitJournal, DesktopSubmissionApproval, DesktopSubmissionPreview, DesktopSubmissionTask } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { assertSubmissionPreviewRun, assertSubmissionPreviewTask, readExactSubmissionText, submissionHash, submissionStore } from './desktopSubmissionSource.js';
import { summarizeChanges } from './stateDiff.js';
import { isCompletedCommitJournal } from './commitJournal.js';

/** Audit immutable evidence, never live source freshness or commit eligibility. */
export async function auditDesktopSubmissions(paths: ProjectPaths, fileStore = new FileStore()): Promise<AuditIssue[]> {
  const store = submissionStore(paths.projectRoot, fileStore);
  const issues: AuditIssue[] = [];
  const previews: { preview: DesktopSubmissionPreview; relative: string; hash: string }[] = [];
  const approvals = new Map<string, { approval: DesktopSubmissionApproval; hash: string }>();
  const journals: { journal: CommitJournal; relative: string; chapter: string; version: string }[] = [];
  const tasks = new Map<string, DesktopSubmissionTask>();
  const add = (kind: string, relative: string, message: string, severity: 'error' | 'critical' = 'error') => {
    issues.push({
      issueId: `desktop_submission_${kind}_${issues.length + 1}`,
      severity, category: `desktop_submission_${kind}`, path: relative,
      message, suggestedFix: 'Inspect and restore the recorded submission evidence; do not retry an interrupted commit.', blocking: true
    });
  };
  const exists = async (relative: string) => {
    try { return await store.exists(paths.projectArtifact(relative)); }
    catch { add('read', relative, 'Submission artifact path is unsafe or unreadable.'); return false; }
  };
  const list = async (relative: string) => {
    try {
      if (!(await store.exists(paths.projectArtifact(relative)))) return [];
      return await store.list(paths.projectArtifact(relative));
    } catch { add('read', relative, 'Submission directory is unsafe or unreadable.'); return []; }
  };
  const read = async (relative: string): Promise<string | undefined> => {
    try { return await readExactSubmissionText(store, paths.projectArtifact(relative)); }
    catch { add('read', relative, 'Submission artifact is missing, unsafe, or unreadable.'); return undefined; }
  };
  const parse = <T>(relative: string, text: string | undefined, schema: z.ZodType<T>): T | undefined => {
    if (text === undefined) return undefined;
    try { return schema.parse(JSON.parse(text)); }
    catch { add('schema', relative, 'Submission artifact failed schema validation.'); return undefined; }
  };
  const json = async <T>(relative: string, schema: z.ZodType<T>) => parse(relative, await read(relative), schema);

  for (const runId of await list('runs')) {
    if (!/^[A-Za-z0-9_-]+$/u.test(runId)) continue;
    const relative = `runs/${runId}/submission_task.json`;
    if (!(await exists(relative))) continue;
    const task = await json(relative, DesktopSubmissionTaskSchema);
    if (task === undefined) continue;
    if (task.projectId !== paths.projectId || task.runId !== runId) {
      add('scope', relative, 'Submission task does not match its project and run.');
    } else tasks.set(runId, task);
  }

  for (const chapter of await list('chapters')) {
    if (!/^chapter_\d{3,}$/u.test(chapter)) continue;
    for (const name of await list(`chapters/${chapter}`)) {
      const match = /^commit_journal_v([1-9]\d*)\.json$/u.exec(name);
      if (match === null) continue;
      const relative = `chapters/${chapter}/${name}`;
      const journal = await json(relative, CommitJournalSchema);
      if (journal?.commitKind === 'desktop_controlled_commit') journals.push({ journal, relative, chapter, version: match[1]! });
    }
    const parent = `chapters/${chapter}/submission_previews`;
    for (const version of await list(parent)) {
      if (!/^preview_v[1-9]\d*$/u.test(version)) continue;
      const root = `${parent}/${version}`;
      const relative = `${root}/manifest.json`;
      const manifestText = await exists(relative) ? await read(relative) : undefined;
      const preview = parse(relative, manifestText, DesktopSubmissionPreviewSchema);
      if (preview !== undefined) {
        const expectedRoot = `chapters/chapter_${String(preview.chapterNumber).padStart(3, '0')}/submission_previews/preview_v${preview.version}`;
        if (preview.projectId !== paths.projectId || root !== expectedRoot) {
          add('scope', relative, 'Submission manifest does not match its project, chapter, or version directory.');
          continue;
        }
        previews.push({ preview, relative, hash: submissionHash(manifestText!) });
      }
      // Partial attempts legitimately have no published manifest. Validate only files present there.
      const load = async <T>(name: string, schema: z.ZodType<T>) => {
        const target = `${root}/${name}`;
        return preview !== undefined || await exists(target) ? json(target, schema) : undefined;
      };
      const evidence = await load('source_evidence.json', DesktopSubmissionSourceSchema);
      const context = await load('diagnostics_context_manifest.json', DiagnosticsContextManifestSchema);
      const diagnostics = await load('diagnostics.json', DiagnosticsReportSchema);
      const patch = await load('normalized_patch.json', CanonPatchSchema);
      const conflict = await load('conflict_report.json', ConflictReportSchema);
      const diff = await load('state_diff.json', StateDiffReportSchema);
      const proposalPath = `${root}/patch_proposal.json`;
      // The proposal uses provider JSON; the published normalized patch has the canonical schema.
      const chapterNumber = Number(chapter.slice('chapter_'.length));
      const proposalSchema = DesktopSubmissionPatchProposalSchema.transform(proposal => {
        z.object({ chapterNumber: z.literal(chapterNumber), latestCommittedChapter: z.literal(chapterNumber).optional() }).parse(proposal);
        return CanonPatchSchema.parse(normalizeCodexSlimOutput(
          'memory.extract_canon_patch_proposal_slim', proposal, { projectId: paths.projectId, chapterNumber }
        ));
      });
      const normalizedProposal = await load('patch_proposal.json', proposalSchema);
      const approvalPath = `${root}/approval.json`;
      const approvalText = await exists(approvalPath) ? await read(approvalPath) : undefined;
      const approval = parse(approvalPath, approvalText, DesktopSubmissionApprovalSchema);
      if (approval !== undefined) approvals.set(approvalPath, { approval, hash: submissionHash(approvalText!) });
      if (preview === undefined) {
        if (approval !== undefined) add('reference', approvalPath, 'Submission approval has no valid published preview.');
        continue;
      }

      for (const ref of Object.values(preview.artifacts)) {
        const text = await read(ref.path);
        if (text !== undefined && submissionHash(text) !== ref.hash) {
          add('hash', ref.path, 'Submission artifact hash does not match its published manifest.');
        }
      }
      const runPath = `runs/${preview.runId}/run_manifest.json`;
      const run = await json(runPath, RunManifestSchema);
      if (run !== undefined) {
        if (run.projectId !== paths.projectId || run.runId !== preview.runId || !('schemaVersion' in run) || run.schemaVersion !== '2') {
          add('scope', runPath, 'Submission preview has no matching versioned run provenance.');
        } else {
          try { assertSubmissionPreviewRun(preview, run); }
          catch {
            add('scope', runPath, 'Submission preview run does not record a successful check for this project and chapter.');
          }
          for (const name of ['source_evidence.json', 'diagnostics_context_manifest.json', 'diagnostics_context_manifest.md']) {
            const target = `${root}/${name}`;
            const record = run.artifacts.find(artifact => artifact.path === target);
            if (record?.sha256 === undefined) {
              add('reference', target, 'Submission evidence has no recorded run lineage hash.');
              continue;
            }
            const text = await read(target);
            if (text !== undefined && submissionHash(text) !== record.sha256) {
              add('hash', target, 'Submission evidence hash does not match its recorded run lineage.');
            }
          }
        }
      }
      if (evidence !== undefined && !isDeepStrictEqual(evidence, preview.source)) {
        add('scope', `${root}/source_evidence.json`, 'Captured source evidence does not match the published preview.');
      }
      if (context !== undefined && (context.projectId !== paths.projectId || context.chapterNumber !== preview.chapterNumber
        || !context.includedArtifacts.some(artifact => artifact.name === 'chapter draft' && artifact.path === preview.artifacts.source.path))) {
        add('reference', `${root}/diagnostics_context_manifest.json`, 'Diagnostics context does not reference this preview source and chapter.');
      }
      if (diagnostics !== undefined && (diagnostics.chapterNumber !== preview.chapterNumber || diagnostics.draftVersion !== 1
        || !diagnostics.passed || diagnostics.hardFailures.length > 0)) {
        add('scope', `${root}/diagnostics.json`, 'Published diagnostics do not show a passed check for this chapter.');
      }
      if (patch !== undefined && (patch.chapterNumber !== preview.chapterNumber
        || (patch.latestCommittedChapter ?? patch.chapterNumber) !== preview.chapterNumber
        || patch.sourceFinalPath !== `chapters/${chapter}/final.md`)) {
        add('scope', `${root}/normalized_patch.json`, 'Normalized patch does not match the approved chapter and final path.');
      }
      if (normalizedProposal !== undefined && patch !== undefined && !isDeepStrictEqual(patch, normalizedProposal)) {
        add('reference', proposalPath, 'Proposal does not normalize to the published patch.');
      }
      if (conflict !== undefined && (conflict.projectId !== paths.projectId || conflict.chapterNumber !== preview.chapterNumber
        || conflict.sourcePatchPath !== preview.artifacts.patch.path || conflict.conflicts.some(item => item.blocking))) {
        add('reference', `${root}/conflict_report.json`, 'Conflict report is blocked or references a different patch.');
      }
      if (diff !== undefined && (diff.projectId !== paths.projectId || diff.mode !== 'patch_preview'
        || diff.patchPath !== preview.artifacts.patch.path || diff.unsafeToCommit || !isDeepStrictEqual(diff.summary, summarizeChanges(diff.changes)))) {
        add('reference', `${root}/state_diff.json`, 'State diff is unsafe, internally inconsistent, or references a different patch.');
      }
      if (approval !== undefined && (approval.projectId !== paths.projectId || approval.chapterNumber !== preview.chapterNumber
        || approval.previewId !== preview.previewId || approval.manifestHash !== submissionHash(manifestText!)
        || approval.sourceHash !== preview.source.sourceHash || approval.patchHash !== preview.artifacts.patch.hash
        || approval.diffHash !== preview.artifacts.diff.hash)) {
        add('approval', approvalPath, 'Submission approval does not match its exact published preview.');
      }
    }
  }

  for (const { preview, relative } of previews) {
    const task = tasks.get(preview.runId);
    if (task === undefined) add('reference', `runs/${preview.runId}/submission_task.json`, 'Published preview has no valid submission task.');
    else {
      try { assertSubmissionPreviewTask(preview, task); }
      catch { add('reference', relative, 'Published preview does not match its ready task.'); }
    }
  }
  for (const [runId, task] of tasks) {
    if (task.status === 'ready' && !previews.some(({ preview }) => preview.runId === runId
      && preview.previewId === task.previewId && preview.chapterNumber === task.chapterNumber)) {
      add('reference', `runs/${runId}/submission_task.json`, 'Ready submission task references a missing or invalid preview.');
    }
  }

  for (const { journal, relative, chapter, version } of journals) {
    const chapterNumber = Number(chapter.slice('chapter_'.length));
    const chapterRoot = `chapters/${chapter}`;
    const finalPath = `${chapterRoot}/final.md`;
    const patchPath = `${chapterRoot}/canon_patch.json`;
    const reportPath = `${chapterRoot}/commit_report.json`;
    const completed = isCompletedCommitJournal(journal);
    const recorded = (phase: CommitJournal['phases'][number]['phase']) => journal.phases.some(entry => entry.phase === phase && entry.status === 'completed');
    if (!completed) add('journal', relative, 'Desktop commit journal is incomplete; inspect persisted evidence before any retry.', 'critical');
    if (journal.projectId !== paths.projectId || journal.chapterNumber !== chapterNumber
      || journal.journalId !== `commit_journal_ch${chapter.slice('chapter_'.length)}_v${version}` || journal.journalPath !== relative
      || journal.storyStatePath !== 'state/story_state.json' || journal.canonicalFinalPath !== finalPath || journal.canonPatchPath !== patchPath
      || journal.latestCommittedChapterBefore !== chapterNumber - 1 || journal.latestCommittedChapterAfter !== chapterNumber
      || (journal.commitReportPath !== undefined && journal.commitReportPath !== reportPath)
      || !/^[A-Za-z0-9_-]{1,128}$/u.test(journal.runId ?? '')) {
      add('journal', relative, 'Desktop commit journal has inconsistent project, chapter, run, or canonical paths.');
    }
    // Resolve only already-validated preview paths; journal strings are never filesystem authority.
    const captured = previews.find(item => item.relative === journal.previewManifestPath);
    if (captured === undefined || captured.preview.chapterNumber !== chapterNumber) {
      add('reference', relative, 'Desktop commit journal references a missing or invalid preview in this chapter.');
      continue;
    }
    const { preview } = captured;
    const expectedApprovalPath = `${captured.relative.slice(0, -'manifest.json'.length)}approval.json`;
    if (journal.previewId !== preview.previewId || journal.previewManifestHash !== captured.hash
      || journal.sourceHash !== preview.source.sourceHash || journal.patchHash !== preview.artifacts.patch.hash
      || journal.diffHash !== preview.artifacts.diff.hash || journal.approvalRecordPath !== expectedApprovalPath) {
      add('journal', relative, 'Desktop commit journal does not bind the exact preview, approval path, and reviewed hashes.');
    }
    const approved = approvals.get(expectedApprovalPath);
    if (approved === undefined) {
      if (completed || recorded('approval_recorded')) add('reference', expectedApprovalPath, 'Desktop commit has no valid recorded approval.');
    } else {
      if (journal.approvalRecordHash !== approved.hash) {
        add('hash', expectedApprovalPath, 'Submission approval bytes do not match the commit journal.');
        add('journal', relative, 'Desktop commit journal approval hash does not match the recorded approval.');
      }
      const { approval } = approved;
      if (journal.approvalId !== approval.approvalId || journal.runId !== approval.runId
        || approval.projectId !== paths.projectId || approval.chapterNumber !== chapterNumber || approval.previewId !== journal.previewId
        || approval.sourceHash !== journal.sourceHash || approval.manifestHash !== journal.previewManifestHash
        || approval.patchHash !== journal.patchHash || approval.diffHash !== journal.diffHash) {
        add('journal', relative, 'Desktop commit journal and approval identity, run, or reviewed hashes disagree.');
      }
    }
    if (completed || recorded('canonical_final_written') || await exists(finalPath)) {
      const text = await read(finalPath);
      if (text !== undefined && submissionHash(text) !== preview.source.sourceHash) {
        add('hash', finalPath, 'Canonical final bytes do not match the reviewed submission source.');
      }
    }
    if (completed || recorded('canonical_patch_written') || await exists(patchPath)) {
      const text = await read(patchPath);
      if (text !== undefined && submissionHash(text) !== preview.artifacts.patch.hash) {
        add('hash', patchPath, 'Canonical patch bytes do not match the reviewed submission patch.');
      }
      const patch = parse(patchPath, text, CanonPatchSchema);
      if (patch !== undefined && (patch.chapterNumber !== chapterNumber || patch.sourceFinalPath !== finalPath)) {
        add('reference', patchPath, 'Canonical patch does not match the committed chapter and final path.');
      }
    }
    if (completed || recorded('commit_report_written') || await exists(reportPath)) {
      const report = await json(reportPath, CommitReportSchema);
      if (report !== undefined && (report.chapterNumber !== chapterNumber || report.canonPatchPath !== patchPath
        || report.storyStatePath !== 'state/story_state.json' || report.beforeSnapshot.snapshotId !== journal.beforeSnapshotId
        || report.afterSnapshot.snapshotId !== journal.afterSnapshotId || report.beforeSnapshot.runId !== journal.runId
        || report.afterSnapshot.runId !== journal.runId || report.appliedChanges.latestCommittedChapter.from !== journal.latestCommittedChapterBefore
        || report.appliedChanges.latestCommittedChapter.to !== journal.latestCommittedChapterAfter || report.conflicts.hard.length > 0)) {
        add('reference', reportPath, 'Commit report chapter, paths, snapshots, or state progression disagree with the desktop journal.');
      }
    }
    if (completed && /^[A-Za-z0-9_-]{1,128}$/u.test(journal.runId ?? '')) {
      const runPath = `runs/${journal.runId}/run_manifest.json`;
      const run = await json(runPath, RunManifestSchema);
      if (run !== undefined) {
        if (run.projectId !== paths.projectId || run.runId !== journal.runId || run.command !== 'desktop-submission-commit'
          || !('schemaVersion' in run) || run.schemaVersion !== '2' || run.status !== 'success') {
          add('reference', runPath, 'Completed desktop journal has no matching successful commit run.');
        } else {
          const mutations = run.stateMutations.filter(mutation => mutation.applied && mutation.chapterNumber === chapterNumber);
          const mutation = mutations[0];
          if (mutations.length !== 1 || mutation?.patchPath !== patchPath || mutation.beforeSnapshotId !== journal.beforeSnapshotId
            || mutation.afterSnapshotId !== journal.afterSnapshotId || mutation.latestCommittedChapterBefore !== chapterNumber - 1
            || mutation.latestCommittedChapterAfter !== chapterNumber || !mutation.conflictCheckPassed || !mutation.schemaValidationPassed) {
            add('reference', runPath, 'Commit run mutation does not match the desktop journal patch, snapshots, and state progression.');
          }
          if (mutation?.beforeStateHash !== journal.beforeStateHash || mutation?.afterStateHash !== journal.afterStateHash) {
            add('journal', relative, 'Desktop commit journal state hashes disagree with the recorded mutation.');
          }
        }
      }
    }
  }
  for (const [relative, { approval }] of approvals) {
    const matches = journals.filter(({ journal }) => journal.approvalRecordPath === relative
      && journal.approvalId === approval.approvalId && journal.runId === approval.runId);
    if (matches.length !== 1) add('reference', relative, 'Submission approval must have exactly one matching desktop commit journal.');
  }
  return issues;
}
