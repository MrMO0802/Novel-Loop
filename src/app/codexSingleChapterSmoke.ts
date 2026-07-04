import { rm } from 'node:fs/promises';
import path from 'node:path';

import { auditProject } from './projectAudit.js';
import { buildBible } from './buildBible.js';
import { checkCodexStatus } from './codexBoundary.js';
import { evaluateCodexChapterQuality } from './codexChapterQuality.js';
import { inspectProject } from './inspectProject.js';
import { initProject } from './initProject.js';
import { planGlobal } from './planGlobal.js';
import { runChapterUntilDraft } from './chapterDrafting.js';
import { runChapterDryRun } from './chapterPlanning.js';
import { runChapterFullProduction } from './chapterPipeline.js';
import { validateProject } from './validateProject.js';
import { CodexSingleChapterSmokeReportSchema, StoryStateSchema } from '../schemas/index.js';
import type { CodexSingleChapterSmokeReport, CodexSingleChapterSmokeStage } from '../schemas/index.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { getErrorMessage } from '../utils/AppError.js';

export interface RunCodexSingleChapterSmokeInput {
  projectId?: string;
  projectsRoot?: string;
  briefPath: string;
  promptRoot?: string;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  clean?: boolean;
}

export interface RunCodexSingleChapterSmokeResult {
  report: CodexSingleChapterSmokeReport;
  reportPath: string;
  markdownPath: string;
}

const DEFAULT_PROJECT_ID = 'codex-single';
const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';

export async function runCodexSingleChapterSmoke(
  input: RunCodexSingleChapterSmokeInput,
  fileStore = new FileStore()
): Promise<RunCodexSingleChapterSmokeResult> {
  const projectId = input.projectId ?? DEFAULT_PROJECT_ID;
  const projectsRoot = input.projectsRoot ?? DEFAULT_PROJECTS_ROOT;
  const promptRoot = input.promptRoot ?? DEFAULT_PROMPT_ROOT;
  const paths = new ProjectPaths(projectsRoot, projectId);
  if (input.clean !== false) {
    await rm(paths.projectRoot, { recursive: true, force: true });
  }
  const stages: CodexSingleChapterSmokeStage[] = [];
  const codexStatus = await safeCodexStatus(input, projectsRoot, projectId);
  let previewRunId: string | undefined;
  let confirmedRunId: string | undefined;
  let finalChapterPath: string | undefined;
  let canonPatchPath: string | undefined;
  let stateDiffPath: string | undefined;
  let approvalRecordPath: string | undefined;
  let commitReportPath: string | undefined;
  let beforeSnapshotId: string | undefined;
  let afterSnapshotId: string | undefined;
  let latestCommittedChapterBefore = 0;
  let latestCommittedChapterAfter = 0;
  let validatePassed = false;
  let auditPassed = false;
  let qualityReportPath: string | undefined;
  let failureReportPath: string | undefined;
  let success = false;

  try {
    await runStage(stages, 'init', `init ${projectId} --brief ${input.briefPath}`, async () => {
      const result = await initProject({ projectId, projectsRoot, briefPath: input.briefPath }, fileStore);
      return { artifacts: result.created.map((created) => path.relative(paths.projectRoot, created).split(path.sep).join(path.posix.sep)) };
    });

    await runStage(stages, 'build-bible', `build-bible ${projectId} --provider codex-text`, async () => {
      const result = await buildBible({ projectId, projectsRoot, provider: 'codex-text', promptRoot, ...codexOptions(input) }, fileStore);
      return { runId: result.runId, artifacts: result.artifacts };
    });

    await runStage(stages, 'plan-global', `plan-global ${projectId} --provider codex-text`, async () => {
      const result = await planGlobal({ projectId, projectsRoot, provider: 'codex-text', promptRoot, ...codexOptions(input) }, fileStore);
      return { runId: result.runId, artifacts: result.artifacts };
    });

    await runStage(stages, 'chapter-dry-run', `chapter ${projectId} 1 --provider codex-text --dry-run`, async () => {
      const result = await runChapterDryRun({ projectId, projectsRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, ...codexOptions(input) }, fileStore);
      return { runId: result.runId, artifacts: result.artifacts };
    });

    await runStage(stages, 'chapter-draft', `chapter ${projectId} 1 --provider codex-text --until draft`, async () => {
      const result = await runChapterUntilDraft({ projectId, projectsRoot, chapterNumber: 1, provider: 'codex-text', promptRoot, ...codexOptions(input) }, fileStore);
      return { runId: result.runId, artifacts: result.artifacts };
    });

    const stateBeforePreview = await fileStore.readJson(paths.storyState(), StoryStateSchema);
    latestCommittedChapterBefore = stateBeforePreview.latestCommittedChapter;
    await runStage(stages, 'chapter-commit-preview', `chapter ${projectId} 1 --provider codex-text --commit`, async () => {
      const result = await runChapterFullProduction(
        {
          projectId,
          projectsRoot,
          chapterNumber: 1,
          provider: 'codex-text',
          promptRoot,
          ...codexOptions(input),
          maxRevisions: 2,
          commit: true
        },
        fileStore
      );
      if (result.status !== 'codex_commit_preview' || result.previewOnly !== true || result.codexPatchPath === undefined || result.stateDiffPath === undefined) {
        throw new Error(`Codex commit preview did not produce complete preview artifacts: status=${result.status}.`);
      }
      previewRunId = result.runId;
      finalChapterPath = 'chapters/chapter_001/final.md';
      canonPatchPath = result.codexPatchPath;
      stateDiffPath = result.stateDiffPath;
      qualityReportPath = result.qualityReportPath;
      return { runId: result.runId, artifacts: result.artifacts };
    });
    const stateAfterPreview = await fileStore.readJson(paths.storyState(), StoryStateSchema);
    if (JSON.stringify(stateAfterPreview) !== JSON.stringify(stateBeforePreview)) {
      throw new Error('Preview-only Codex commit mutated Story State.');
    }

    await runStage(stages, 'chapter-commit-confirm', `chapter ${projectId} 1 --provider codex-text --commit --confirm-codex-commit`, async () => {
      const result = await runChapterFullProduction(
        {
          projectId,
          projectsRoot,
          chapterNumber: 1,
          provider: 'codex-text',
          promptRoot,
          ...codexOptions(input),
          maxRevisions: 2,
          commit: true,
          confirmCodexCommit: true
        },
        fileStore
      );
      confirmedRunId = result.runId;
      canonPatchPath = result.codexPatchPath;
      stateDiffPath = result.stateDiffPath;
      approvalRecordPath = result.approvalRecordPath;
      commitReportPath = result.commitReportPath;
      beforeSnapshotId = result.beforeSnapshotId;
      afterSnapshotId = result.afterSnapshotId;
      qualityReportPath = result.qualityReportPath;
      return { runId: result.runId, artifacts: result.artifacts };
    });
    const stateAfterConfirm = await fileStore.readJson(paths.storyState(), StoryStateSchema);
    latestCommittedChapterAfter = stateAfterConfirm.latestCommittedChapter;
    if (latestCommittedChapterAfter !== 1) {
      throw new Error(`Confirmed Codex commit expected latestCommittedChapter=1, got ${latestCommittedChapterAfter}.`);
    }

    await runStage(stages, 'evaluate-chapter', `evaluate-chapter ${projectId} 1`, async () => {
      const result = await evaluateCodexChapterQuality({ projectId, projectsRoot, chapterNumber: 1 }, fileStore);
      qualityReportPath = result.reportPath;
      if (result.blocking) {
        throw new Error(`Quality report blocked smoke: ${result.criticalIssues.join('; ')}`);
      }
      return { runId: result.runId, artifacts: [result.reportPath, result.markdownPath] };
    });

    await runStage(stages, 'validate', `validate ${projectId}`, async () => {
      const result = await validateProject({ projectId, projectsRoot }, fileStore);
      validatePassed = result.ok;
      if (!result.ok) throw new Error(result.checks.filter((check) => !check.ok).map((check) => check.message ?? check.name).join('; '));
      return { artifacts: [] };
    });

    await runStage(stages, 'audit', `audit ${projectId} --strict --fix-index`, async () => {
      const result = await auditProject({ projectId, projectsRoot, strict: true, fixIndex: true }, fileStore);
      auditPassed = result.ok;
      if (!result.ok) throw new Error(result.report.issues.map((issue) => issue.message).join('; '));
      return { artifacts: [result.reportPath, result.markdownPath] };
    });

    await runStage(stages, 'inspect', `inspect ${projectId} --characters --debts --reader`, async () => {
      await inspectProject({ projectId, projectsRoot, characters: true, debts: true, reader: true }, fileStore);
      return { artifacts: [] };
    });
    success = true;
  } catch (error) {
    failureReportPath = await findFailureReportPath(paths, fileStore, stages);
    stages.push({
      stageName: 'smoke-failure',
      command: 'codex single chapter smoke',
      status: 'failed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      artifacts: [],
      errorCode: error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'SMOKE_FAILED',
      ...(failureReportPath === undefined ? {} : { failureReportPath })
    });
  }

  const report = await writeSmokeReport(paths, fileStore, {
    projectId,
    generatedAt: new Date().toISOString(),
    codexStatus,
    stages,
    ...(previewRunId === undefined ? {} : { previewRunId }),
    ...(confirmedRunId === undefined ? {} : { confirmedRunId }),
    ...(finalChapterPath === undefined ? {} : { finalChapterPath }),
    ...(canonPatchPath === undefined ? {} : { canonPatchPath }),
    ...(stateDiffPath === undefined ? {} : { stateDiffPath }),
    ...(approvalRecordPath === undefined ? {} : { approvalRecordPath }),
    ...(commitReportPath === undefined ? {} : { commitReportPath }),
    ...(beforeSnapshotId === undefined ? {} : { beforeSnapshotId }),
    ...(afterSnapshotId === undefined ? {} : { afterSnapshotId }),
    latestCommittedChapterBefore,
    latestCommittedChapterAfter,
    validatePassed,
    auditPassed,
    ...(qualityReportPath === undefined ? {} : { qualityReportPath }),
    ...(failureReportPath === undefined ? {} : { failureReportPath }),
    success
  });
  return report;
}

async function runStage(
  stages: CodexSingleChapterSmokeStage[],
  stageName: string,
  command: string,
  action: () => Promise<{ runId?: string; artifacts: string[] }>
): Promise<void> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    const result = await action();
    stages.push({
      stageName,
      command,
      status: 'success',
      ...(result.runId === undefined ? {} : { runId: result.runId }),
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      artifacts: result.artifacts
    });
  } catch (error) {
    stages.push({
      stageName,
      command,
      status: 'failed',
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      artifacts: [],
      errorCode: error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : getErrorMessage(error).slice(0, 160)
    });
    throw error;
  }
}

async function writeSmokeReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: Omit<CodexSingleChapterSmokeReport, 'reportId'>
): Promise<RunCodexSingleChapterSmokeResult> {
  await fileStore.ensureDir(paths.auditDir());
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_single_chapter_smoke_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      ...input,
      reportId: `codex_single_chapter_smoke_report_v${artifact.version}`
    },
    CodexSingleChapterSmokeReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderSmokeMarkdown(report));
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
        relativeJsonPath: path.join('audit', jsonFile),
        relativeMdPath: path.join('audit', mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName} audit artifact.`);
}

function renderSmokeMarkdown(report: CodexSingleChapterSmokeReport): string {
  return [
    `# Codex Single-Chapter Smoke ${report.projectId}`,
    '',
    `success: ${String(report.success)}`,
    `latestCommittedChapterBefore: ${report.latestCommittedChapterBefore}`,
    `latestCommittedChapterAfter: ${report.latestCommittedChapterAfter}`,
    `validatePassed: ${String(report.validatePassed)}`,
    `auditPassed: ${String(report.auditPassed)}`,
    `previewRunId: ${report.previewRunId ?? 'none'}`,
    `confirmedRunId: ${report.confirmedRunId ?? 'none'}`,
    '',
    '## Stages',
    ...report.stages.map((stage) => `- ${stage.stageName}: ${stage.status}${stage.errorCode === undefined ? '' : ` (${stage.errorCode})`}`)
  ].join('\n') + '\n';
}

async function safeCodexStatus(input: RunCodexSingleChapterSmokeInput, projectsRoot: string, projectId: string): Promise<Record<string, unknown>> {
  try {
    return { ...(await checkCodexStatus({
      projectsRoot,
      projectId,
      ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin })
    })) };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}

function codexOptions(input: RunCodexSingleChapterSmokeInput) {
  return {
    ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
    codexProfile: input.codexProfile ?? 'clean',
    codexJsonRetries: input.codexJsonRetries ?? 2,
    codexJsonRepair: input.codexJsonRepair ?? true
  };
}

async function findFailureReportPath(
  paths: ProjectPaths,
  fileStore: FileStore,
  stages: CodexSingleChapterSmokeStage[]
): Promise<string | undefined> {
  const failedRunId = [...stages].reverse().find((stage) => stage.runId !== undefined)?.runId;
  if (failedRunId !== undefined) {
    const providerFailurePath = path.join('codex', 'failures', failedRunId, 'codex_failure_report.json');
    if (await fileStore.exists(paths.projectArtifact(providerFailurePath))) {
      return providerFailurePath;
    }
  }
  const chapterDir = paths.chapterDir(1);
  if (!(await fileStore.exists(chapterDir))) return undefined;
  const reports = (await fileStore.list(chapterDir)).filter((entry) => /^codex_patch_failure_report_v\d+\.json$/.test(entry));
  const latest = reports.at(-1);
  return latest === undefined ? undefined : path.join('chapters', 'chapter_001', latest);
}
