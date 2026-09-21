import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DesktopSubmissionTaskSchema, DiagnosticsReportSchema, RunManifestV2Schema } from '../schemas/index.js';
import type { DesktopSubmissionTask, DiagnosticsReport } from '../schemas/index.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { readDesktopSubmissionTasks } from './desktopSubmissionRecovery.js';
import { readExactSubmissionText, submissionChapterPath, submissionHash, submissionStore, SubmissionError } from './desktopSubmissionSource.js';

const InputSchema = z.object({ projectRoot: z.string().min(1), taskId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u) }).strict();
export type SubmissionDiagnosticsInput = z.infer<typeof InputSchema>;
export interface DesktopSubmissionDiagnostics {
  task: DesktopSubmissionTask;
  diagnostics: DiagnosticsReport;
  sourceText: string;
}

/** Historical, captured evidence only. This reader never authorizes a preview or checks live freshness. */
export async function readDesktopSubmissionDiagnostics(value: SubmissionDiagnosticsInput): Promise<DesktopSubmissionDiagnostics | null> {
  try {
    const input = InputSchema.parse(value);
    const root = path.resolve(input.projectRoot);
    const paths = new ProjectPaths(path.dirname(root), path.basename(root));
    const store = submissionStore(root);
    const matching = (await readDesktopSubmissionTasks({ projectRoot: root })).filter(task => task.taskId === input.taskId);
    requireEvidence(matching.length <= 1);
    const task = matching[0];
    if (task === undefined || task.safeErrorCode !== 'diagnostics_failed') return null;
    requireEvidence(task.runId !== null && (task.status === 'blocked' || task.status === 'failed'));
    const files = new Map<string, string>();
    const read = async (relative: string) => {
      const text = await readExactSubmissionText(store, paths.projectArtifact(relative));
      files.set(relative, text);
      return text;
    };
    const persisted = DesktopSubmissionTaskSchema.parse(JSON.parse(await read(`runs/${task.runId}/submission_task.json`)));
    requireEvidence(isDeepStrictEqual(persisted, task));
    const run = RunManifestV2Schema.parse(JSON.parse(await read(`runs/${task.runId}/run_manifest.json`)));
    requireEvidence(run.runId === task.runId && run.projectId === task.projectId && task.projectId === paths.projectId
      && run.command === 'desktop-submission-check' && run.args.chapterNumber === task.chapterNumber
      && run.status === task.status && run.endedAt !== undefined && run.stateMutations.length === 0);
    const prefix = `${submissionChapterPath(task.chapterNumber)}/submission_previews/`;
    const candidates = run.artifacts.filter(artifact => artifact.path.endsWith('/diagnostics.json'));
    requireEvidence(candidates.length === 1);
    const diagnosticRef = candidates[0]!;
    requireEvidence(diagnosticRef.path.startsWith(prefix)
      && /^preview_v[1-9]\d*\/diagnostics\.json$/u.test(diagnosticRef.path.slice(prefix.length)));
    const base = path.posix.dirname(diagnosticRef.path);
    const reference = async (relative: string) => {
      const refs = run.artifacts.filter(artifact => artifact.path === relative);
      requireEvidence(refs.length === 1);
      const ref = refs[0]!;
      requireEvidence(ref.runId === task.runId && ref.chapterNumber === task.chapterNumber
        && ref.action === 'generated' && ref.status === 'active' && typeof ref.sha256 === 'string');
      const text = await read(relative);
      requireEvidence(submissionHash(text) === ref.sha256 && Buffer.byteLength(text, 'utf8') === ref.sizeBytes);
      return text;
    };
    const diagnostics = DiagnosticsReportSchema.parse(JSON.parse(await reference(diagnosticRef.path)));
    const sourceText = await reference(`${base}/source.md`);
    requireEvidence(diagnostics.chapterNumber === task.chapterNumber && diagnostics.draftVersion === 1 && diagnostics.passed === false);
    for (const [relative, text] of files) {
      requireEvidence(await readExactSubmissionText(store, paths.projectArtifact(relative)) === text);
    }
    return { task, diagnostics, sourceText };
  } catch { throw new SubmissionError('invalid_output'); }
}

function requireEvidence(condition: boolean): asserts condition {
  if (!condition) throw new SubmissionError('invalid_output');
}
