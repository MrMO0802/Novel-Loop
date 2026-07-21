import { checkPatchConflicts } from '../../src/app/chapterCommit.js';
import { sha256 } from '../../src/app/codexDiagnosticsEvidenceRules.js';
import {
  analyzeCandidatePatchNoops,
  decideCandidateCommitChange,
  finalizeCandidateCommitReview
} from '../../src/app/codexCandidateCommitDecision.js';
import { reviewCodexCandidateCommit } from '../../src/app/codexCandidateCommitReview.js';
import { runCodexCandidatePreview } from '../../src/app/codexCandidatePreview.js';
import { writePatchPreviewDiff } from '../../src/app/stateDiff.js';
import {
  CanonPatchSchema,
  DraftAdoptionManifestSchema,
  RevisionCandidateAdoptionApprovalSchema,
  StateDiffReportSchema,
  StoryStateSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { prepareAdoptedRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';

export async function prepareCandidatePatchRefinementProject(tempRoot: string, store = new FileStore()) {
  const prepared = await prepareAdoptedRevisionCandidateProject(tempRoot, store);
  const initialState = await store.readJson(prepared.paths.storyState(), StoryStateSchema);
  initialState.narrativeDebts.push({
    id: 'refinement_debt_001',
    type: 'mystery',
    promise: 'A fixture mystery remains open.',
    readerQuestion: 'What does the fixture mystery mean?',
    introducedInChapter: 1,
    status: 'open',
    importance: 5,
    urgency: 5,
    relatedCharacters: [],
    relatedThreads: [],
    payoffHistory: []
  });
  await store.writeJson(prepared.paths.storyState(), initialState, StoryStateSchema);
  const stateHash = sha256(await store.readText(prepared.paths.storyState()));
  const approvalPath = prepared.paths.chapterArtifact(1, 'revision_candidate_adoption_approval_v1.json');
  const approval = await store.readJson(approvalPath, RevisionCandidateAdoptionApprovalSchema);
  approval.sourceStateHash = stateHash;
  await store.writeJson(approvalPath, approval, RevisionCandidateAdoptionApprovalSchema);
  const manifestPath = prepared.paths.chapterArtifact(1, 'draft_adoption_manifest_v1.json');
  const manifest = await store.readJson(manifestPath, DraftAdoptionManifestSchema);
  manifest.sourceStateHash = stateHash;
  manifest.approvalHash = sha256(await store.readText(approvalPath));
  await store.writeJson(manifestPath, manifest, DraftAdoptionManifestSchema);
  const fake = await writeFakeCodex(tempRoot, 'codex-candidate-patch-refinement');
  const preview = await runCodexCandidatePreview({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    draft: 'draft_v2',
    approval: 'latest',
    codexBin: fake.codexBin
  }, store);
  const state = await store.readJson(prepared.paths.storyState(), StoryStateSchema);
  const debtId = state.narrativeDebts[0]?.id;
  if (debtId === undefined) throw new Error('refinement fixture requires one narrative debt');
  const patchPath = preview.report.normalizedPatchPath!;
  const proposalPath = preview.report.patchProposalPath!;
  const patch = await store.readJson(prepared.paths.projectArtifact(patchPath), CanonPatchSchema);
  patch.narrativeDebtUpdates.push({ debtId, action: 'maintain', payload: { text: 'Unconsumed no-op fixture payload.' } });
  await store.writeJson(prepared.paths.projectArtifact(patchPath), patch, CanonPatchSchema);
  await store.writeJson(prepared.paths.projectArtifact(proposalPath), patch, CanonPatchSchema);
  const conflicts = checkPatchConflicts(state, patch);
  const generated = await writePatchPreviewDiff({
    projectId: prepared.paths.projectId,
    paths: prepared.paths,
    patch,
    patchPath,
    unsafeToCommit: conflicts.hard.length > 0,
    baseStoryState: state
  }, store);
  await store.writeJson(prepared.paths.projectArtifact(preview.report.stateDiffPath!), generated.report, StateDiffReportSchema);

  const review = await reviewCodexCandidateCommit({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    preview: preview.reportPath
  }, store);
  const noop = await analyzeCandidatePatchNoops({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    review: review.reviewPath
  }, store);
  const noOpMutation = noop.report.mutations.find((mutation) => mutation.semanticNoop);
  if (noOpMutation === undefined) throw new Error('refinement fixture did not create a semantic no-op');
  for (const change of review.report.changes) {
    await decideCandidateCommitChange({
      projectId: prepared.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      review: review.reviewPath,
      mutationId: change.mutationId,
      decision: change.mutationId === noOpMutation.mutationId
        ? 'modify-required'
        : change.statePath === '/latestCommittedChapter' ? 'conditional-approve' : 'approve',
      note: change.mutationId === noOpMutation.mutationId
        ? 'Remove the confirmed semantic no-op from the derived patch.'
        : `Approve unchanged fixture mutation ${change.statePath}.`
    }, store);
  }
  const finalized = await finalizeCandidateCommitReview({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    review: review.reviewPath
  }, store);
  return { ...prepared, preview, review, noop, noOpMutation, finalized };
}
