import { z } from 'zod';
import { DesktopSubmissionArtifactReferenceSchema, DesktopSubmissionSourceSchema, DesktopSubmissionSafeErrorCodeSchema } from './desktopSubmission.js';
import { ProjectIdSchema } from './config.js';

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Time = z.string().datetime({ offset: true });
export const DiagnosticRevisionOutputSchema = z.object({
  markdown: z.string().min(1).refine(text => text.trim().length > 0 && Buffer.byteLength(text, 'utf8') <= 2 * 1024 * 1024),
  changes: z.array(z.object({ issueIndex: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(2000) }).strict()).min(1).max(100)
}).strict();
export const DiagnosticRevisionBindingSchema = z.object({
  schemaVersion: z.literal(1), source: DesktopSubmissionSourceSchema,
  diagnosticTaskId: Id, diagnosticRunId: Id,
  diagnostics: DesktopSubmissionArtifactReferenceSchema,
  sourceEvidence: DesktopSubmissionArtifactReferenceSchema,
  capturedAt: Time
}).strict().superRefine((value, ctx) => {
  const prefix = `chapters/chapter_${String(value.source.chapterNumber).padStart(3, '0')}/submission_previews/`;
  if (!value.diagnostics.path.startsWith(prefix) || !/^preview_v[1-9]\d*\/diagnostics\.json$/u.test(value.diagnostics.path.slice(prefix.length))
    || value.sourceEvidence.path !== value.diagnostics.path.replace(/diagnostics\.json$/u, 'source_evidence.json')) {
    ctx.addIssue({ code: 'custom', message: 'Diagnostic references must share chapter and preview scope.' });
  }
});
export const DiagnosticRevisionCandidateSchema = z.object({
  schemaVersion: z.literal(1), candidateId: Id, taskId: Id, runId: Id,
  projectId: ProjectIdSchema, chapterNumber: z.number().int().positive(), version: z.number().int().positive(),
  bindingHash: Hash, sourceHash: Hash, candidateHash: Hash,
  changes: DiagnosticRevisionOutputSchema.shape.changes, createdAt: Time
}).strict();
export const DiagnosticRevisionTaskSchema = z.object({
  schemaVersion: z.literal(1), taskId: Id, projectId: ProjectIdSchema, chapterNumber: z.number().int().positive(),
  stage: z.enum(['checking_source', 'generating_revision', 'validating_candidate']),
  status: z.enum(['running', 'cancel_requested', 'cancelled', 'failed', 'blocked', 'ready', 'interrupted']),
  runId: Id, candidateId: Id.nullable(), startedAt: Time, endedAt: Time.nullable(), safeErrorCode: DesktopSubmissionSafeErrorCodeSchema.nullable(),
  ownerPid: z.number().int().positive().optional()
}).strict().superRefine((value, ctx) => {
  const active = ['running', 'cancel_requested'].includes(value.status);
  const error = ['failed', 'blocked', 'interrupted'].includes(value.status);
  if (active !== (value.endedAt === null) || (value.endedAt !== null && Date.parse(value.endedAt) < Date.parse(value.startedAt))
    || (value.status === 'ready') !== (value.candidateId !== null) || error !== (value.safeErrorCode !== null)
    || (value.status === 'ready' && value.stage !== 'validating_candidate')) ctx.addIssue({ code: 'custom', message: 'Invalid task lifecycle.' });
});
export const DiagnosticRevisionDispositionSchema = z.object({
  schemaVersion: z.literal(1), candidateId: Id,
  status: z.enum(['pending', 'adopting', 'adopted', 'rejected', 'stale']),
  sourceHash: Hash, candidateHash: Hash, authorRevisionId: Id.nullable(), decidedAt: Time.nullable()
}).strict().superRefine((value, ctx) => {
  if ((['adopting', 'adopted'].includes(value.status) && value.authorRevisionId === null)
    || (value.status === 'pending' && (value.authorRevisionId !== null || value.decidedAt !== null))
    || (['adopted', 'rejected', 'stale'].includes(value.status) && value.decidedAt === null)) ctx.addIssue({ code: 'custom', message: 'Incomplete disposition provenance.' });
});
export type DiagnosticRevisionBinding = z.infer<typeof DiagnosticRevisionBindingSchema>;
export type DiagnosticRevisionCandidate = z.infer<typeof DiagnosticRevisionCandidateSchema>;
export type DiagnosticRevisionTask = z.infer<typeof DiagnosticRevisionTaskSchema>;
export type DiagnosticRevisionDisposition = z.infer<typeof DiagnosticRevisionDispositionSchema>;
