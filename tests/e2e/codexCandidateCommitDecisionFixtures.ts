import { reviewCodexCandidateCommit } from '../../src/app/codexCandidateCommitReview.js';
import { runCodexCandidatePreview } from '../../src/app/codexCandidatePreview.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { prepareAdoptedRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';

export async function prepareCandidateCommitDecisionProject(tempRoot: string, store = new FileStore()) {
  const prepared = await prepareAdoptedRevisionCandidateProject(tempRoot, store);
  const fake = await writeFakeCodex(tempRoot, 'codex-candidate-commit-decisions');
  await runCodexCandidatePreview({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    draft: 'draft_v2',
    approval: 'latest',
    codexBin: fake.codexBin
  }, store);
  const review = await reviewCodexCandidateCommit({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    preview: 'latest'
  }, store);
  return { ...prepared, review };
}
