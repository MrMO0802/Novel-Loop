import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  AuthorRevisionAdoptionJournalSchema, AuthorRevisionRecordSchema, ChapterMissionSchema,
  ChapterQueueSchema, CommitJournalSchema, ConfigSchema, DesktopSubmissionSourceSchema, DesktopSubmissionTaskSchema,
  RunManifestV2Schema, StoryStateSchema
} from '../schemas/index.js';
import type { AuthorRevisionRecord, DesktopSubmissionPreview, DesktopSubmissionSafeErrorCode, DesktopSubmissionSource } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { withProjectChapterOperationLease } from './projectOperationLease.js';
import { isCompletedCommitJournal } from './commitJournal.js';

export interface SubmissionProjectInput { projectRoot: string; chapterNumber: number }

export class SubmissionError extends Error {
  constructor(readonly code: DesktopSubmissionSafeErrorCode) { super(code); }
}

export const submissionHash = (text: string): string => createHash('sha256').update(text).digest('hex');
export const submissionChapterPath = (chapterNumber: number, ...segments: string[]): string =>
  path.posix.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, ...segments);

// Immutable publication linkage, shared by live admission and historical recovery/audit.
export function assertSubmissionPreviewTask(preview: DesktopSubmissionPreview, taskInput: unknown): void {
  const task = DesktopSubmissionTaskSchema.parse(taskInput);
  if (task.projectId !== preview.projectId || task.chapterNumber !== preview.chapterNumber
    || task.runId !== preview.runId || task.status !== 'ready' || task.previewId !== preview.previewId) {
    throw new SubmissionError('source_stale');
  }
}

export function assertSubmissionPreviewRun(preview: DesktopSubmissionPreview, runInput: unknown): void {
  const run = RunManifestV2Schema.parse(runInput);
  if (run.projectId !== preview.projectId || run.runId !== preview.runId
    || run.command !== 'desktop-submission-check' || run.status !== 'success'
    || run.args.chapterNumber !== preview.chapterNumber || run.resolvedContext.projectId !== preview.projectId
    || run.resolvedContext.chapterNumber !== preview.chapterNumber
    || run.resolvedContext.resolvedChapterNumber !== preview.chapterNumber) {
    throw new SubmissionError('source_stale');
  }
}

export async function readExactSubmissionText(store: FileStore, filePath: string): Promise<string> {
  await store.assertSafePath(filePath);
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const limit = 16 * 1024 * 1024;
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new SubmissionError('source_missing');
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit - total + 1));
      const { bytesRead } = await handle.read(chunk);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limit) throw new SubmissionError('source_missing');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    await store.assertSafePath(filePath);
    try {
      // ignoreBOM means retain U+FEFF, not strip it. Fatal decoding prevents lossy hashes.
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
    } catch { throw new SubmissionError('source_missing'); }
  } finally { await handle.close(); }
}

// Keep project guards even when a trusted caller injects a store for failure testing.
export function submissionStore(projectRoot: string, injected?: FileStore): FileStore {
  const guard = FileStore.forProject(projectRoot);
  if (injected === undefined) return guard;
  return new class extends FileStore {
    override async assertSafePath(p: string) { await guard.assertSafePath(p); await injected.assertSafePath(p); }
    override async readText(p: string) { await this.assertSafePath(p); return injected.readText(p); }
    override async writeText(p: string, text: string) { await this.assertSafePath(p); await injected.writeText(p, text); await this.assertSafePath(p); }
    override async exists(p: string) { await this.assertSafePath(p); return injected.exists(p); }
    override async list(p: string) { await this.assertSafePath(p); return injected.list(p); }
    override async ensureDir(p: string) { await this.assertSafePath(p); await injected.ensureDir(p); await this.assertSafePath(p); }
  }();
}

export async function captureSubmissionSource(input: SubmissionProjectInput, fileStore?: FileStore): Promise<DesktopSubmissionSource> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = submissionStore(projectRoot, fileStore);
  await store.assertSafePath(projectRoot);
  return withProjectChapterOperationLease({ ...input, projectRoot, operation: 'desktop_submission_source', allowStoryStateWrite: false }, async () => {
    const paths = new ProjectPaths(path.dirname(projectRoot), path.basename(projectRoot));
    const chapterRoot = submissionChapterPath(input.chapterNumber);
    const state = await store.readJson(paths.storyState(), StoryStateSchema);
    const config = await store.readJson(paths.config(), ConfigSchema);
    const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
    if (state.projectId !== paths.projectId || config.projectId !== paths.projectId || queue.projectId !== paths.projectId) throw new SubmissionError('project_unavailable');
    if (input.chapterNumber !== state.latestCommittedChapter + 1) throw new SubmissionError('already_committed');
    const targets = queue.chapters.filter(item => item.chapterNumber === input.chapterNumber);
    if (targets.length !== 1) throw new SubmissionError('plan_missing');
    if (targets[0]!.status === 'stale_due_to_history_edit') throw new SubmissionError('recovery_required');
    if (['committed', 'recommitted'].includes(targets[0]!.status) || targets[0]!.committedAt !== null) throw new SubmissionError('already_committed');
    const missionPath = path.posix.join(chapterRoot, 'mission.json');
    const planPath = path.posix.join(chapterRoot, 'selected_plan.md');
    if (!(await store.exists(paths.projectArtifact(missionPath))) || !(await store.exists(paths.projectArtifact(planPath)))) throw new SubmissionError('plan_missing');
    const mission = await store.readJson(paths.projectArtifact(missionPath), ChapterMissionSchema);
    if (mission.chapterNumber !== input.chapterNumber || !(await store.readText(paths.projectArtifact(planPath))).trim()) throw new SubmissionError('plan_missing');
    // A preview never resumes a partially completed canonical commit or a historical submission.
    for (const name of await store.list(paths.chapterDir(input.chapterNumber))) {
      const match = /^commit_journal_v([1-9]\d*)\.json$/u.exec(name);
      if (match === null) continue;
      const journalPath = path.posix.join(chapterRoot, name);
      await store.assertSafePath(paths.projectArtifact(journalPath));
      let journal;
      try { journal = await store.readJson(paths.projectArtifact(journalPath), CommitJournalSchema); }
      catch { throw new SubmissionError('recovery_required'); }
      if (journal.projectId !== paths.projectId || journal.chapterNumber !== input.chapterNumber
        || journal.journalPath !== journalPath || journal.journalId !== `commit_journal_ch${String(input.chapterNumber).padStart(3, '0')}_v${match[1]}`
        || journal.storyStatePath !== path.posix.join('state', 'story_state.json') || !isCompletedCommitJournal(journal)) throw new SubmissionError('recovery_required');
      throw new SubmissionError('already_committed');
    }

    const reference = async (relative: string) => ({ path: relative, hash: submissionHash(await readExactSubmissionText(store, paths.projectArtifact(relative))) });
    const original = path.posix.join(chapterRoot, 'draft_v1.md');
    if (!(await store.exists(paths.projectArtifact(original)))) throw new SubmissionError('source_missing');
    const additionalInputs = [await reference(original)];
    const revisionRoot = path.posix.join(chapterRoot, 'author_revisions');
    const records: { record: AuthorRevisionRecord; path: string }[] = [];
    if (await store.exists(paths.projectArtifact(revisionRoot))) {
      const files = await store.list(paths.projectArtifact(revisionRoot));
      for (const name of files) {
        const relative = path.posix.join(revisionRoot, name);
        if (/^(mission|plan|draft)_revision_v[1-9]\d*\.(md|json)$/u.test(name)) {
          additionalInputs.push(await reference(relative));
          if (name.endsWith('.md')) {
            if (!files.includes(name.replace(/\.md$/u, '.json'))) throw new SubmissionError('source_missing');
            continue;
          }
          const record = await store.readJson(paths.projectArtifact(relative), AuthorRevisionRecordSchema);
          if (record.projectId !== paths.projectId || record.chapterNumber !== input.chapterNumber || record.workingCopyPath !== relative.replace(/\.json$/u, '.md')) throw new SubmissionError('source_missing');
          if (!files.includes(name.replace(/\.json$/u, '.md'))) throw new SubmissionError('source_missing');
          if (submissionHash(await readExactSubmissionText(store, paths.projectArtifact(record.workingCopyPath))) !== record.workingCopyHash) throw new SubmissionError('source_missing');
          if (['working', 'publishing', 'ready'].includes(record.state)) throw new SubmissionError('working_copy_pending');
          if (record.state === 'adopted' && record.adoptedAt === null) throw new SubmissionError('source_missing');
          records.push({ record, path: relative });
        } else if (/^(mission|plan|draft)_adoption_journal_v[1-9]\d*\.json$/u.test(name)) {
          additionalInputs.push(await reference(relative));
          const journal = await store.readJson(paths.projectArtifact(relative), AuthorRevisionAdoptionJournalSchema);
          if (journal.projectId !== paths.projectId || journal.chapterNumber !== input.chapterNumber || journal.state === 'prepared') throw new SubmissionError('recovery_required');
          for (const mutation of journal.mutations) {
            if (!(await store.exists(paths.projectArtifact(mutation.recordPath)))) throw new SubmissionError('source_missing');
          }
        }
      }
    }
    // Match readLatestAdoptedDraft ordering without its read-time journal recovery writes.
    const adopted = records.filter(item => item.record.artifactKind === 'draft' && item.record.state === 'adopted')
      .sort((left, right) => right.record.adoptedAt!.localeCompare(left.record.adoptedAt!));
    const latest = adopted[0];
    const sourcePath = latest?.record.workingCopyPath ?? original;
    const sourceText = await readExactSubmissionText(store, paths.projectArtifact(sourcePath));
    if (!sourceText.trim()) throw new SubmissionError('source_missing');
    return DesktopSubmissionSourceSchema.parse({
      projectId: paths.projectId, chapterNumber: input.chapterNumber,
      sourceKind: latest ? 'adopted' : 'generated', sourcePath, sourceHash: submissionHash(sourceText),
      revisionId: latest?.record.revisionId ?? null, revisionRecord: latest ? await reference(latest.path) : null,
      state: await reference(path.posix.join('state', 'story_state.json')), queue: await reference(path.posix.join('planning', 'chapter_queue.json')),
      mission: await reference(missionPath), selectedPlan: await reference(planPath), config: await reference('config.json'),
      additionalInputs: additionalInputs.sort((a, b) => a.path.localeCompare(b.path))
    });
  });
}

export async function assertSubmissionSourceFresh(source: DesktopSubmissionSource, projectRoot: string, fileStore?: FileStore): Promise<void> {
  const parsed = DesktopSubmissionSourceSchema.parse(source);
  try {
    const current = await captureSubmissionSource({ projectRoot, chapterNumber: parsed.chapterNumber }, fileStore);
    if (!isDeepStrictEqual(current, parsed)) throw new SubmissionError('source_stale');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'DESKTOP_PROJECT_UNSAFE_PATH') throw error;
    throw new SubmissionError('source_stale');
  }
}
