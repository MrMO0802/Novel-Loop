import { z } from 'zod';
import { SubmissionSafeErrorCodeSchema } from './submissionContract';
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const DiagnosticRevisionProjectSchema = z.object({ projectKey: z.string().regex(/^project_[A-Za-z0-9_-]{1,88}$/u) }).strict();
export const DiagnosticRevisionStartSchema = DiagnosticRevisionProjectSchema.extend({ diagnosticTaskId: Id }).strict();
export const DiagnosticRevisionIdentitySchema = DiagnosticRevisionProjectSchema.extend({ candidateId: Id }).strict();
export const DiagnosticRevisionTaskRequestSchema = DiagnosticRevisionProjectSchema.extend({ taskId: Id }).strict();
export const DiagnosticRevisionPublicTaskSchema = z.object({
  taskId: Id, stage: z.enum(['checking_source', 'generating_revision', 'validating_candidate']),
  status: z.enum(['running', 'cancel_requested', 'cancelled', 'failed', 'blocked', 'ready', 'interrupted']),
  candidateId: Id.nullable(), safeErrorCode: SubmissionSafeErrorCodeSchema.nullable()
}).strict();
export const DiagnosticRevisionPublicCandidateSchema = z.object({
  candidateId: Id, source: z.string().max(2 * 1024 * 1024), markdown: z.string().max(2 * 1024 * 1024),
  reasons: z.array(z.string().max(2000)).max(100),
  status: z.enum(['pending', 'adopting', 'adopted', 'rejected', 'stale']), canAdopt: z.boolean()
}).strict();
export const DiagnosticRevisionResponseSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('task'), task: DiagnosticRevisionPublicTaskSchema }).strict(),
  z.object({ outcome: z.literal('candidate'), candidate: DiagnosticRevisionPublicCandidateSchema }).strict(),
  z.object({ outcome: z.literal('none') }).strict(),
  z.object({ outcome: z.literal('adopted') }).strict(),
  z.object({ outcome: z.literal('rejected') }).strict(),
  z.object({ outcome: z.literal('error'), code: SubmissionSafeErrorCodeSchema }).strict()
]);
export type DiagnosticRevisionResponse = z.infer<typeof DiagnosticRevisionResponseSchema>;
export type DiagnosticRevisionApi = {
  start(request: z.infer<typeof DiagnosticRevisionStartSchema>): Promise<DiagnosticRevisionResponse>;
  get(request: z.infer<typeof DiagnosticRevisionTaskRequestSchema>): Promise<DiagnosticRevisionResponse>;
  cancel(request: z.infer<typeof DiagnosticRevisionTaskRequestSchema>): Promise<DiagnosticRevisionResponse>;
  read(request: z.infer<typeof DiagnosticRevisionProjectSchema> & { candidateId?: string | undefined }): Promise<DiagnosticRevisionResponse>;
  adopt(request: z.infer<typeof DiagnosticRevisionIdentitySchema>): Promise<DiagnosticRevisionResponse>;
  reject(request: z.infer<typeof DiagnosticRevisionIdentitySchema>): Promise<DiagnosticRevisionResponse>;
};
export const DiagnosticRevisionReadSchema = DiagnosticRevisionProjectSchema.extend({ candidateId: Id.optional() }).strict();
