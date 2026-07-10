import { runCodexDiagnosticsEvidenceAdjudication } from '../../src/app/codexDiagnosticsEvidenceAdjudication.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { adjudicationProjectId, prepareDiagnosticsAdjudicationProject } from './codexDiagnosticsAdjudicationFixtures.js';

export async function prepareTargetedRevisionProject(tempRoot: string, fileStore = new FileStore()) {
  const prepared = await prepareDiagnosticsAdjudicationProject(tempRoot, fileStore);
  const adjudication = await runCodexDiagnosticsEvidenceAdjudication({
    projectId: adjudicationProjectId,
    projectsRoot: tempRoot,
    chapterNumber: 1
  }, fileStore);
  const fake = await writeFakeCodex(tempRoot, 'codex-targeted-revision');
  return { ...prepared, adjudication, fake };
}

export { adjudicationProjectId };
