import { runCodexDiagnosticsEvidenceAdjudication } from '../../src/app/codexDiagnosticsEvidenceAdjudication.js';
import { runCodexTargetedRevisionExperiment } from '../../src/app/codexTargetedRevisionExperiment.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { adjudicationProjectId, prepareDiagnosticsAdjudicationProject } from './codexDiagnosticsAdjudicationFixtures.js';

export async function prepareTargetCoverageProject(tempRoot: string, fileStore = new FileStore()) {
  const prepared = await prepareDiagnosticsAdjudicationProject(tempRoot, fileStore);
  await fileStore.writeText(prepared.paths.chapterArtifact(1, 'draft_v1.md'), expandedConflictDraft());
  const adjudication = await runCodexDiagnosticsEvidenceAdjudication({
    projectId: adjudicationProjectId,
    projectsRoot: tempRoot,
    chapterNumber: 1
  }, fileStore);
  const fake = await writeFakeCodex(tempRoot, 'codex-targeted-revision-no-improvement');
  const experiment = await runCodexTargetedRevisionExperiment({
    projectId: adjudicationProjectId,
    projectsRoot: tempRoot,
    chapterNumber: 1,
    adjudication: 'latest',
    samples: 1,
    contextMode: 'enhanced',
    codexBin: fake.codexBin
  }, fileStore);
  return { ...prepared, adjudication, experiment, fake };
}

function expandedConflictDraft(): string {
  return `# Chapter 001 Draft

午高峰的新单挤进手机，林澈确认这是白天的同一单配送。

林澈到达十六楼。

门开了，林澈把餐袋递给住户，住户接过餐。

住户提到十七楼有人失踪，又立刻收回这句话。

门关上。

十六楼的门又开了。

林澈再次把同一个餐袋递过去。

楼梯上方的安全门没有关严。

住户再次接过餐。

门又关上。

进门时间，二十三点十七分。

出门时间，二十三点二十九分。
`;
}

export { adjudicationProjectId };
