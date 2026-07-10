import { buildBible } from '../../src/app/buildBible.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { runCodexDiagnosticsSchemaBenchmark } from '../../src/app/codexDiagnosticsSchemaCompliance.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { normalizeDiagnosticsWithReport } from '../../src/providers/codex/normalizers.js';
import { DiagnosticsReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, promptRoot } from './m16Helpers.js';

export const adjudicationProjectId = 'diagnostics-adjudication';

export async function prepareDiagnosticsAdjudicationProject(tempRoot: string, fileStore = new FileStore()) {
  await initProject({ projectId: adjudicationProjectId, projectsRoot: tempRoot, briefPath }, fileStore);
  await buildBible({ projectId: adjudicationProjectId, projectsRoot: tempRoot, provider: 'mock', promptRoot }, fileStore);
  await planGlobal({ projectId: adjudicationProjectId, projectsRoot: tempRoot, provider: 'mock', promptRoot }, fileStore);
  await runChapterDryRun({ projectId: adjudicationProjectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'mock', promptRoot }, fileStore);
  await runChapterUntilDraft({ projectId: adjudicationProjectId, projectsRoot: tempRoot, chapterNumber: 1, provider: 'mock', promptRoot }, fileStore);
  const paths = new ProjectPaths(tempRoot, adjudicationProjectId);
  await fileStore.writeText(paths.chapterArtifact(1, 'draft_v1.md'), conflictDraft());
  await fileStore.writeText(paths.chapterArtifact(1, 'selected_plan.md'), [
    '1. 白天林澈继续跑单。',
    '2. 一个新订单送往三栋十六楼。',
    '3. 住户接餐后提到十七楼失踪事件。',
    '4. 林澈离开后记录本次路线和进出时间。'
  ].join('\n'));
  await fileStore.writeJson(
    paths.chapterArtifact(1, 'diagnostics_v1.json'),
    normalizeDiagnosticsWithReport(validProviderDiagnostics(), { projectId: adjudicationProjectId, chapterNumber: 1 }).report,
    DiagnosticsReportSchema
  );
  const fake = await writeFakeCodex(tempRoot, 'codex-controlled-diagnostics-fail');
  const benchmark = await runCodexDiagnosticsSchemaBenchmark({
    projectId: adjudicationProjectId,
    projectsRoot: tempRoot,
    promptRoot,
    chapterNumber: 1,
    samples: 5,
    contextMode: 'enhanced',
    codexBin: fake.codexBin,
    codexProfile: 'clean',
    codexJsonRetries: 2,
    codexJsonRepair: true,
    codexTimeoutMs: 30_000
  }, fileStore);
  return { paths, benchmark };
}

function conflictDraft(): string {
  return `# Chapter 001 Draft

午高峰的新单挤进手机。林澈接下三栋十六楼的订单并直接出发。

十六楼的门开了，林澈把餐袋递给住户。住户接过餐，提醒他不要靠近十七楼，随后关门。

十六楼的门又开了。林澈把同一个餐袋递过去，住户再次接餐并关门。

林澈离开小区后记录刚才的路线。

进门时间，二十三点十七分。

出门时间，二十三点二十九分。
`;
}

function validProviderDiagnostics() {
  return {
    chapterNumber: 1,
    draftVersion: 1,
    passed: true,
    averageScore: 8.6,
    hardChecks: ['timeline_consistency', 'character_knowledge_consistency', 'world_rule_consistency', 'no_unplanned_reveal']
      .map((checkName) => ({ checkName, result: 'pass', blocking: false, evidence: '', explanation: 'No contradiction found.' })),
    softScores: {
      plot_progression: 8.6,
      character_consistency: 8.6,
      tension_curve: 8.6,
      emotional_impact: 8.6,
      chapter_hook: 8.6,
      style_match: 8.6,
      genre_satisfaction: 8.6,
      reader_curiosity: 8.6
    },
    diagnostics: [],
    revisionRequired: false
  };
}
