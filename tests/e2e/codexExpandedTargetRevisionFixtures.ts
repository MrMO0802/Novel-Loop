import { approveCodexTargetExpansion, runCodexDiagnosticsTargetCoverage } from '../../src/app/codexTargetCoverage.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { adjudicationProjectId, prepareTargetCoverageProject } from './codexTargetCoverageFixtures.js';

export async function prepareApprovedExpandedTargetRevisionProject(
  tempRoot: string,
  fileStore = new FileStore(),
  fakeMode:
    | 'codex-expanded-target-revision'
    | 'codex-expanded-target-incomplete'
    | 'codex-expanded-target-residual-time'
    | 'codex-expanded-target-residual-duplicate'
    | 'codex-expanded-target-quality-regression' = 'codex-expanded-target-revision'
) {
  const prepared = await prepareTargetCoverageProject(tempRoot, fileStore);
  const coverage = await runCodexDiagnosticsTargetCoverage({
    projectId: adjudicationProjectId,
    projectsRoot: tempRoot,
    chapterNumber: 1
  }, fileStore);
  const approval = await approveCodexTargetExpansion({
    projectId: adjudicationProjectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    report: 'latest',
    confirm: true,
    operator: 'm27.12d2-test'
  }, fileStore);
  const fake = await writeFakeCodex(tempRoot, fakeMode);
  return { ...prepared, coverage, approval, fake };
}

export { adjudicationProjectId };
