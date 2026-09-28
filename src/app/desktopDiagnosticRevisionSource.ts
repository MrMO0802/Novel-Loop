import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DiagnosticRevisionBindingSchema, type DiagnosticRevisionBinding } from '../schemas/desktopDiagnosticRevision.js';
import { readDesktopSubmissionDiagnostics } from './desktopSubmissionDiagnostics.js';
import { assertSubmissionSourceFresh, SubmissionError } from './desktopSubmissionSource.js';

export const DiagnosticRevisionScopeSchema = z.object({ projectRoot: z.string().min(1), chapterNumber: z.number().int().positive() }).strict();
export type DiagnosticRevisionScope = z.infer<typeof DiagnosticRevisionScopeSchema>;
export const DiagnosticRevisionSourceInputSchema = DiagnosticRevisionScopeSchema.extend({ diagnosticTaskId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u) }).strict();
export type DiagnosticRevisionSourceInput = z.infer<typeof DiagnosticRevisionSourceInputSchema>;

export async function captureDiagnosticRevisionSource(value: DiagnosticRevisionSourceInput): Promise<DiagnosticRevisionBinding> {
  const input = DiagnosticRevisionSourceInputSchema.parse(value);
  const evidence = await readDesktopSubmissionDiagnostics({ projectRoot: input.projectRoot, taskId: input.diagnosticTaskId });
  if (!evidence?.revisionBinding || evidence.task.chapterNumber !== input.chapterNumber) throw new SubmissionError('source_stale');
  const binding = DiagnosticRevisionBindingSchema.parse(evidence.revisionBinding);
  await assertSubmissionSourceFresh(binding.source, input.projectRoot);
  return binding;
}

export async function assertDiagnosticRevisionSourceFresh(input: DiagnosticRevisionScope, binding: DiagnosticRevisionBinding): Promise<void> {
  const captured = await captureDiagnosticRevisionSource({ ...DiagnosticRevisionScopeSchema.parse(input), diagnosticTaskId: binding.diagnosticTaskId });
  if (!isDeepStrictEqual(captured, DiagnosticRevisionBindingSchema.parse(binding))) throw new SubmissionError('source_stale');
}
