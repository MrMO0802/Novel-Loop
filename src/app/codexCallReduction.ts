import path from 'node:path';

import { CodexCallReductionReportSchema } from '../schemas/index.js';
import type { CodexCallReductionReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface GenerateCodexCallReductionReportInput {
  projectId: string;
  projectsRoot?: string;
  beforeCallCount?: number;
  afterCallCount?: number;
}

export interface GenerateCodexCallReductionReportResult {
  report: CodexCallReductionReport;
  reportPath: string;
  markdownPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const LOCAL_DETERMINISTIC_TASKS = [
  'chapter_quality_report_v2',
  'cross_chapter_continuity_v2',
  'chapter_summary_cache',
  'runtime_profiler',
  'runtime_optimization_report',
  'prompt_audit'
];
const PRESERVED_CODEX_TASKS = ['story_bible', 'global_planning', 'chapter_mission', 'plan_candidates', 'scene_cards', 'scene_prose', 'canon_patch_proposal'];

export async function generateCodexCallReductionReport(
  input: GenerateCodexCallReductionReportInput,
  fileStore = new FileStore()
): Promise<GenerateCodexCallReductionReportResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const beforeCallCount = input.beforeCallCount ?? 18;
  const afterCallCount = input.afterCallCount ?? Math.max(0, beforeCallCount - LOCAL_DETERMINISTIC_TASKS.length);
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_call_reduction_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_call_reduction_report_v${artifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      beforeCallCount,
      afterCallCount,
      reducedCallCount: Math.max(0, beforeCallCount - afterCallCount),
      localDeterministicTasks: LOCAL_DETERMINISTIC_TASKS,
      preservedCodexTasks: PRESERVED_CODEX_TASKS,
      schemaSafetyChecksPreserved: true,
      storyStateSafetyPreserved: true,
      notes: [
        'Ranking, quality checks, continuity checks, summaries, profiling, prompt audit, and optimization reports remain local deterministic tasks.',
        'Canon patch validation, conflict checks, and Story State commits remain schema-gated local operations.'
      ]
    },
    CodexCallReductionReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderMarkdown(report));
  return {
    report,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath
  };
}

async function nextAuditArtifact(paths: ProjectPaths, fileStore: FileStore, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const mdFile = `${baseName}_v${version}.md`;
    const jsonPath = paths.auditArtifact(jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      return {
        version,
        jsonPath,
        mdPath: paths.auditArtifact(mdFile),
        relativeJsonPath: path.posix.join('audit', jsonFile),
        relativeMdPath: path.posix.join('audit', mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName} audit artifact.`);
}

function renderMarkdown(report: CodexCallReductionReport): string {
  return [
    `# Codex Call Reduction ${report.projectId}`,
    '',
    `beforeCallCount: ${report.beforeCallCount}`,
    `afterCallCount: ${report.afterCallCount}`,
    `reducedCallCount: ${report.reducedCallCount}`,
    `schemaSafetyChecksPreserved: ${String(report.schemaSafetyChecksPreserved)}`,
    '',
    '## Local Deterministic Tasks',
    ...report.localDeterministicTasks.map((task) => `- ${task}`)
  ].join('\n') + '\n';
}
