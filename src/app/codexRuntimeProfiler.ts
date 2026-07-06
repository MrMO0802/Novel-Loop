import path from 'node:path';

import { CodexRuntimeBenchmarkReportSchema, CodexStageRuntimeProfileReportSchema, RunManifestSchema } from '../schemas/index.js';
import type { CodexRuntimeBenchmarkReport, CodexStageRuntimeProfileReport, RunManifest } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface ProfileCodexRuntimeInput {
  projectId: string;
  projectsRoot?: string;
}

export interface ProfileCodexRuntimeResult {
  report: CodexStageRuntimeProfileReport;
  reportPath: string;
  markdownPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const M27_STAGES = [
  'build_bible',
  'plan_global_outline',
  'plan_volume_outline',
  'plan_arc_map',
  'plan_chapter_queue',
  'chapter_mission',
  'plan_candidates',
  'ranking',
  'scene_cards',
  'write_scene',
  'diagnostics',
  'revision_plan',
  'final_chapter',
  'canon_patch_proposal',
  'state_diff',
  'confirm_apply'
];

export async function profileCodexRuntime(input: ProfileCodexRuntimeInput, fileStore = new FileStore()): Promise<ProfileCodexRuntimeResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const durationByStage = emptyStageMap();
  const codexCallsByStage = emptyStageMap();
  const retriesByStage = emptyStageMap();
  const repairsByStage = emptyStageMap();
  const timeoutByStage = emptyStageMap();
  const promptBytesByStage = emptyStageMap();
  const outputBytesByStage = emptyStageMap();
  const schemaBytesByStage = emptyStageMap();
  const durationByChapter: Record<string, number> = {};
  let sourceRunCount = 0;
  let totalDurationMs = 0;

  for (const manifest of await readRunManifests(paths, fileStore)) {
    sourceRunCount += 1;
    if (!('schemaVersion' in manifest) || manifest.schemaVersion !== '2') continue;
    for (const call of manifest.promptCalls) {
      if (call.provider !== 'codex-text' && call.provider !== 'codex-cli') continue;
      const stage = stageForPromptId(call.promptId);
      durationByStage[stage] = (durationByStage[stage] ?? 0) + Math.round(call.latencyMs);
      codexCallsByStage[stage] = (codexCallsByStage[stage] ?? 0) + 1;
      retriesByStage[stage] = (retriesByStage[stage] ?? 0) + (call.retryCount ?? 0);
      repairsByStage[stage] = (repairsByStage[stage] ?? 0) + (call.finishReason === 'repaired' || call.promptId.includes('repair') ? 1 : 0);
      timeoutByStage[stage] = (timeoutByStage[stage] ?? 0) + (call.errorType === 'CODEX_TIMEOUT' ? 1 : 0);
      promptBytesByStage[stage] = (promptBytesByStage[stage] ?? 0) + (call.promptInputBytes ?? 0);
      outputBytesByStage[stage] = (outputBytesByStage[stage] ?? 0) + (call.outputBytes ?? 0);
      schemaBytesByStage[stage] = (schemaBytesByStage[stage] ?? 0) + (call.schemaBytes ?? 0);
      totalDurationMs += Math.round(call.latencyMs);
      const chapterKey = chapterKeyForPrompt(manifest, call.promptId);
      if (chapterKey !== undefined) {
        durationByChapter[chapterKey] = (durationByChapter[chapterKey] ?? 0) + Math.round(call.latencyMs);
      }
    }
  }

  const sourceBenchmarkReportPaths: string[] = [];
  for (const benchmark of await readBenchmarkReports(paths, fileStore)) {
    sourceBenchmarkReportPaths.push(benchmark.relativePath);
    if (totalDurationMs === 0) {
      totalDurationMs += benchmark.report.totalDurationMs;
    }
    for (const stage of benchmark.report.stages) {
      const mappedStage = stageForBenchmarkStage(stage.stageName);
      if ((codexCallsByStage[mappedStage] ?? 0) === 0) {
        durationByStage[mappedStage] = (durationByStage[mappedStage] ?? 0) + stage.durationMs;
        codexCallsByStage[mappedStage] = (codexCallsByStage[mappedStage] ?? 0) + stage.codexCallCount;
        retriesByStage[mappedStage] = (retriesByStage[mappedStage] ?? 0) + stage.retryCount;
        repairsByStage[mappedStage] = (repairsByStage[mappedStage] ?? 0) + stage.repairCount;
        timeoutByStage[mappedStage] = (timeoutByStage[mappedStage] ?? 0) + stage.timeoutCount;
        promptBytesByStage[mappedStage] = (promptBytesByStage[mappedStage] ?? 0) + stage.promptInputBytes;
        outputBytesByStage[mappedStage] = (outputBytesByStage[mappedStage] ?? 0) + stage.outputBytes;
        schemaBytesByStage[mappedStage] = (schemaBytesByStage[mappedStage] ?? 0) + stage.schemaBytes;
      }
      const chapterKey = chapterKeyForStageName(stage.stageName);
      if (chapterKey !== undefined) {
        durationByChapter[chapterKey] = (durationByChapter[chapterKey] ?? 0) + stage.durationMs;
      }
    }
  }

  const slowestStages = Object.entries(durationByStage)
    .map(([stage, durationMs]) => ({ stage, durationMs, codexCallCount: codexCallsByStage[stage] ?? 0 }))
    .filter((stage) => stage.durationMs > 0 || stage.codexCallCount > 0)
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 8);
  const optimizationCandidates = slowestStages.map((stage) => ({
    stage: stage.stage,
    reason: candidateReason(stage.stage, promptBytesByStage[stage.stage] ?? 0, codexCallsByStage[stage.stage] ?? 0),
    suggestedAction: suggestedActionForStage(stage.stage),
    estimatedImpact: stage.durationMs > 120_000 || stage.codexCallCount > 4 ? 'high' as const : stage.durationMs > 30_000 ? 'medium' as const : 'low' as const
  }));
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_stage_runtime_profile');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_stage_runtime_profile_v${artifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      sourceRunCount,
      sourceBenchmarkReportPaths,
      totalDurationMs,
      durationByChapter,
      durationByStage,
      codexCallsByStage,
      retriesByStage,
      repairsByStage,
      timeoutByStage,
      promptBytesByStage,
      outputBytesByStage,
      schemaBytesByStage,
      slowestStages,
      optimizationCandidates,
      storyStateMutated: false
    },
    CodexStageRuntimeProfileReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderProfileMarkdown(report));
  return {
    report,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath
  };
}

async function readRunManifests(paths: ProjectPaths, fileStore: FileStore): Promise<RunManifest[]> {
  if (!(await fileStore.exists(paths.runsDir()))) return [];
  const manifests: RunManifest[] = [];
  for (const entry of await fileStore.list(paths.runsDir())) {
    const manifestPath = paths.runManifest(entry);
    if (!(await fileStore.exists(manifestPath))) continue;
    try {
      manifests.push(await fileStore.readJson(manifestPath, RunManifestSchema));
    } catch {
      // Profiler is read-only and best-effort; audit handles invalid manifests strictly.
    }
  }
  return manifests;
}

async function readBenchmarkReports(
  paths: ProjectPaths,
  fileStore: FileStore
): Promise<Array<{ relativePath: string; report: CodexRuntimeBenchmarkReport }>> {
  if (!(await fileStore.exists(paths.auditDir()))) return [];
  const reports: Array<{ relativePath: string; report: CodexRuntimeBenchmarkReport }> = [];
  for (const entry of await fileStore.list(paths.auditDir())) {
    if (!/^codex_runtime_benchmark_report_v\d+\.json$/.test(entry)) continue;
    const relativePath = path.join('audit', entry);
    try {
      reports.push({
        relativePath,
        report: await fileStore.readJson(paths.projectArtifact(relativePath), CodexRuntimeBenchmarkReportSchema)
      });
    } catch {
      // audit --strict reports invalid benchmark artifacts.
    }
  }
  return reports;
}

function emptyStageMap(): Record<string, number> {
  return Object.fromEntries(M27_STAGES.map((stage) => [stage, 0]));
}

function stageForPromptId(promptId: string): string {
  if (promptId.startsWith('strategy.')) return 'build_bible';
  if (promptId.includes('generate_global_outline') || promptId.includes('plan_global_outline')) return 'plan_global_outline';
  if (promptId.includes('generate_volume_outline') || promptId.includes('plan_volume_outline')) return 'plan_volume_outline';
  if (promptId.includes('arc_map')) return 'plan_arc_map';
  if (promptId.includes('chapter_queue')) return 'plan_chapter_queue';
  if (promptId.includes('plan_chapter_mission')) return 'chapter_mission';
  if (promptId.includes('generate_plan_candidates')) return 'plan_candidates';
  if (promptId.includes('rank_plan_candidates')) return 'ranking';
  if (promptId.includes('scene_cards')) return 'scene_cards';
  if (promptId.includes('write_scene')) return 'write_scene';
  if (promptId.includes('diagnostics') || promptId.includes('diagnose')) return 'diagnostics';
  if (promptId.includes('revision_plan') || promptId.includes('create_revision')) return 'revision_plan';
  if (promptId.includes('final_chapter') || promptId.includes('rewrite_chapter')) return 'final_chapter';
  if (promptId.includes('canon_patch')) return 'canon_patch_proposal';
  if (promptId.includes('state_diff')) return 'state_diff';
  return 'confirm_apply';
}

function stageForBenchmarkStage(stageName: string): string {
  if (stageName === 'build-bible') return 'build_bible';
  if (stageName === 'plan-global') return 'plan_global_outline';
  if (stageName.includes('dry-run')) return 'chapter_mission';
  if (stageName.includes('draft')) return 'write_scene';
  if (stageName.includes('preview')) return 'canon_patch_proposal';
  if (stageName.includes('confirm')) return 'confirm_apply';
  return 'confirm_apply';
}

function chapterKeyForPrompt(manifest: RunManifest, promptId: string): string | undefined {
  void promptId;
  if ('schemaVersion' in manifest && manifest.schemaVersion === '2') {
    const chapterNumber = manifest.resolvedContext.chapterNumber ?? manifest.resolvedContext.resolvedChapterNumber;
    return chapterNumber === undefined ? undefined : `chapter_${String(chapterNumber).padStart(3, '0')}`;
  }
  return undefined;
}

function chapterKeyForStageName(stageName: string): string | undefined {
  const match = /chapter-(\d{3})/.exec(stageName);
  return match === null ? undefined : `chapter_${match[1]}`;
}

function candidateReason(stage: string, promptBytes: number, calls: number): string {
  if (promptBytes > 24_000) return `${stage} sends large prompt context (${promptBytes} bytes).`;
  if (calls > 3) return `${stage} uses ${calls} Codex calls.`;
  return `${stage} is among the slowest observed stages.`;
}

function suggestedActionForStage(stage: string): string {
  if (stage === 'ranking') return 'Keep ranking deterministic/local when candidate scores are already structured.';
  if (stage === 'diagnostics') return 'Prefer local hard checks and reserve Codex for prose-sensitive revision guidance.';
  if (stage === 'write_scene') return 'Use compact chapter summaries and capped scene count.';
  if (stage === 'canon_patch_proposal') return 'Keep patch prompt schema minimal and reuse preview for confirm.';
  return 'Reduce prompt context with chapter summaries and context budget manifests.';
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
        relativeJsonPath: path.join('audit', jsonFile),
        relativeMdPath: path.join('audit', mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName} audit artifact.`);
}

function renderProfileMarkdown(report: CodexStageRuntimeProfileReport): string {
  return [
    `# Codex Stage Runtime Profile ${report.projectId}`,
    '',
    `totalDurationMs: ${report.totalDurationMs}`,
    `sourceRunCount: ${report.sourceRunCount}`,
    '',
    '## Slowest Stages',
    ...(report.slowestStages.length === 0
      ? ['- none']
      : report.slowestStages.map((stage) => `- ${stage.stage}: ${stage.durationMs}ms, calls=${stage.codexCallCount}`)),
    '',
    '## Optimization Candidates',
    ...(report.optimizationCandidates.length === 0
      ? ['- none']
      : report.optimizationCandidates.map((item) => `- ${item.stage}: ${item.suggestedAction} (${item.estimatedImpact})`))
  ].join('\n') + '\n';
}
