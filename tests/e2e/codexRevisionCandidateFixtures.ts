import { runCodexExpandedTargetRevisionExperiment } from '../../src/app/codexExpandedTargetRevisionExperiment.js';
import {
  adoptCodexRevisionCandidate,
  approveCodexRevisionCandidate,
  reviewCodexRevisionCandidate
} from '../../src/app/codexRevisionCandidateAdoption.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { prepareApprovedExpandedTargetRevisionProject } from './codexExpandedTargetRevisionFixtures.js';

export async function prepareRevisionCandidateProject(
  tempRoot: string,
  fileStore = new FileStore(),
  fakeMode: 'codex-expanded-target-revision' | 'codex-expanded-target-quality-regression' = 'codex-expanded-target-revision'
) {
  const prepared = await prepareApprovedExpandedTargetRevisionProject(tempRoot, fileStore, fakeMode);
  const experiment = await runCodexExpandedTargetRevisionExperiment({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    approval: 'latest',
    revisionRound: 2,
    samples: 1,
    contextMode: 'enhanced',
    codexBin: prepared.fake.codexBin
  }, fileStore);
  return { ...prepared, experiment };
}

export async function prepareAdoptedRevisionCandidateProject(tempRoot: string, fileStore = new FileStore()) {
  const prepared = await prepareRevisionCandidateProject(tempRoot, fileStore);
  const review = await reviewCodexRevisionCandidate({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    candidate: 'latest'
  }, fileStore);
  const approval = await approveCodexRevisionCandidate({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    candidate: 'latest',
    confirm: true,
    operator: 'd3-test'
  }, fileStore);
  const adoption = await adoptCodexRevisionCandidate({
    projectId: prepared.paths.projectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    candidate: 'latest',
    approval: 'latest'
  }, fileStore);
  return { ...prepared, review, approval, adoption };
}
