import path from 'node:path';
import { DiagnosticRevisionDispositionSchema } from '../schemas/desktopDiagnosticRevision.js';
import { adoptAuthorRevision, createAuthorRevision, readAuthorRevision } from './chapterAuthorRevision.js';
import { diagnosticRevisionStore, readDiagnosticRevisionCandidate, type DiagnosticRevisionIdentity } from './desktopDiagnosticRevision.js';
import { assertDiagnosticRevisionSourceFresh } from './desktopDiagnosticRevisionSource.js';
import { SubmissionError } from './desktopSubmissionSource.js';
import { withProjectChapterOperationLease } from './projectOperationLease.js';

export async function adoptDiagnosticRevision(input: DiagnosticRevisionIdentity) {
  const scope = { projectRoot: input.projectRoot, chapterNumber: input.chapterNumber };
  return withProjectChapterOperationLease({ ...scope, operation: 'diagnostic_revision_adopt', allowStoryStateWrite: false }, async () => {
    const result = await readDiagnosticRevisionCandidate(input);
    const { store } = diagnosticRevisionStore(scope);
    const dispositionPath = path.join(result.directory, 'disposition.json');
    const instruction = `diagnostic-candidate:${result.candidate.candidateId}:${result.candidate.bindingHash}`;
    const save = async (revisionId: string) => store.writeJson(dispositionPath, {
      ...result.disposition, status: 'adopted', authorRevisionId: revisionId, decidedAt: new Date().toISOString()
    }, DiagnosticRevisionDispositionSchema);
    if (['adopting', 'adopted'].includes(result.disposition.status)) {
      // Reconcile only proven completed author adoption, never a matching text alone.
      try {
        const author = await readAuthorRevision({ ...scope, revisionId: result.disposition.authorRevisionId!, expectedSourceHash: result.candidate.sourceHash }, store);
        if (author.record.state !== 'adopted' || author.record.mode !== 'codex_adjustment' || author.record.authorInstruction !== instruction || author.content !== result.candidateText) throw new Error();
        await save(author.record.revisionId);
        return { candidateId: input.candidateId, authorRevisionId: author.record.revisionId, candidateHash: result.candidate.candidateHash, alreadyAdopted: true };
      } catch { throw new SubmissionError('recovery_required'); }
    }
    if (result.disposition.status !== 'pending' || !result.canAdopt) throw new SubmissionError('source_stale');
    await assertDiagnosticRevisionSourceFresh(scope, result.binding);
    const created = await createAuthorRevision({ ...scope, artifactKind: 'draft', mode: 'codex_adjustment', sourceArtifactPath: result.binding.source.sourcePath,
      sourceCandidateId: null, expectedSourceHash: result.candidate.sourceHash, content: result.candidateText, authorInstruction: instruction,
      onRecordPrepared: async record => {
        await store.writeJson(dispositionPath, { ...result.disposition, status: 'adopting', authorRevisionId: record.revisionId }, DiagnosticRevisionDispositionSchema);
      }
    }, store);
    await adoptAuthorRevision({ ...scope, revisionId: created.record.revisionId, expectedSourceHash: result.candidate.sourceHash }, store);
    await save(created.record.revisionId);
    return { candidateId: input.candidateId, authorRevisionId: created.record.revisionId, candidateHash: result.candidate.candidateHash, alreadyAdopted: false };
  });
}

export async function rejectDiagnosticRevision(input: DiagnosticRevisionIdentity) {
  const scope = { projectRoot: input.projectRoot, chapterNumber: input.chapterNumber };
  return withProjectChapterOperationLease({ ...scope, operation: 'diagnostic_revision_reject', allowStoryStateWrite: false }, async () => {
    const result = await readDiagnosticRevisionCandidate(input);
    if (result.disposition.status === 'rejected') return result.disposition;
    if (result.disposition.status !== 'pending') throw new SubmissionError('recovery_required');
    return diagnosticRevisionStore(scope).store.writeJson(path.join(result.directory, 'disposition.json'), { ...result.disposition, status: 'rejected', decidedAt: new Date().toISOString() }, DiagnosticRevisionDispositionSchema);
  });
}
