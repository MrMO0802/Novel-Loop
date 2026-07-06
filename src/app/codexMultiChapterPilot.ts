import { rm } from 'node:fs/promises';
import path from 'node:path';

import { auditProject } from './projectAudit.js';
import { buildBible } from './buildBible.js';
import { checkCodexStatus } from './codexBoundary.js';
import { evaluateCodexChapterQuality } from './codexChapterQuality.js';
import { evaluateCodexCrossChapterContinuity } from './codexCrossChapterContinuity.js';
import { initProject } from './initProject.js';
import { planGlobal } from './planGlobal.js';
import { runChapterDryRun } from './chapterPlanning.js';
import { runChapterFullProduction } from './chapterPipeline.js';
import { runChapterUntilDraft } from './chapterDrafting.js';
import { validateProject } from './validateProject.js';
import { hashJson } from '../logging/RunLogger.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import {
  ChapterQueueSchema,
  CodexBudgetReportSchema,
  CodexChapterQualityReportSchema,
  CodexCrossChapterDriftReportSchema,
  CodexMultiChapterPilotReportSchema,
  DiagnosticsReportSchema,
  RunManifestSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  CodexBudgetReport,
  CodexCrossChapterDriftIssue,
  CodexCrossChapterDriftReport,
  CodexMultiChapterPilotChapter,
  CodexMultiChapterPilotReport
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';

export interface RunCodexMultiChapterPilotInput {
  projectId?: string;
  projectsRoot?: string;
  briefPath: string;
  promptRoot?: string;
  targetChapterCount?: number;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexMaxCallsPerChapter?: number;
  codexMaxRuntimeMsPerChapter?: number;
  codexTimeoutMs?: number;
  codexContextBudgetBytes?: number;
  codexMaxArtifactsInContext?: number;
  codexContextMode?: 'compact' | 'balanced' | 'rich';
  clean?: boolean;
  resume?: boolean;
  batchConfirm?: boolean;
}

export interface RunCodexMultiChapterPilotResult {
  report: CodexMultiChapterPilotReport;
  reportPath: string;
  markdownPath: string;
}

export interface EvaluateCodexCrossChapterDriftInput {
  projectId: string;
  projectsRoot?: string;
  chapters: number[];
}

export interface EvaluateCodexCrossChapterDriftResult {
  report: CodexCrossChapterDriftReport;
  reportPath: string;
  markdownPath: string;
}

const DEFAULT_PROJECT_ID = 'codex-multi';
const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DEFAULT_TARGET_CHAPTERS = 3;
const DEFAULT_MAX_CALLS_PER_CHAPTER = 20;
const DEFAULT_MAX_RUNTIME_MS_PER_CHAPTER = 15 * 60 * 1000;
const DEFAULT_CODEX_TIMEOUT_MS = 180_000;

export async function runCodexMultiChapterPilot(
  input: RunCodexMultiChapterPilotInput,
  fileStore = new FileStore()
): Promise<RunCodexMultiChapterPilotResult> {
  if (input.batchConfirm === true) {
    throw new AppError('CODEX_BATCH_CONFIRM_BLOCKED', 'Codex multi-chapter pilot requires per-chapter preview and explicit confirm checkpoints.', 2, {
      reason: 'one-shot batch confirmation without preview is outside the M26 safety boundary'
    });
  }

  const projectId = input.projectId ?? DEFAULT_PROJECT_ID;
  const projectsRoot = input.projectsRoot ?? DEFAULT_PROJECTS_ROOT;
  const promptRoot = input.promptRoot ?? DEFAULT_PROMPT_ROOT;
  const targetChapterCount = input.targetChapterCount ?? DEFAULT_TARGET_CHAPTERS;
  const paths = new ProjectPaths(projectsRoot, projectId);
  const codexStatus = await safeCodexStatus(input, projectsRoot, projectId);
  const chapters: CodexMultiChapterPilotChapter[] = [];
  let validatePassed = false;
  let auditPassed = false;
  let crossChapterDriftReportPath: string | undefined;
  let crossChapterContinuityReportPath: string | undefined;
  let failureReportPath: string | undefined;
  let latestCommittedChapterBefore = 0;
  let latestCommittedChapterAfter = 0;
  let success = false;

  try {
    await ensureProjectBootstrapped(input, paths, fileStore);
    latestCommittedChapterBefore = (await fileStore.readJson(paths.storyState(), StoryStateSchema)).latestCommittedChapter;

    while (true) {
      const storyStateBeforeChapter = await fileStore.readJson(paths.storyState(), StoryStateSchema);
      const chapterNumber = storyStateBeforeChapter.latestCommittedChapter + 1;
      if (chapterNumber > targetChapterCount) {
        break;
      }

      const chapterStart = Date.now();
      const chapterReport: CodexMultiChapterPilotChapter = {
        chapterNumber,
        latestCommittedChapterBefore: storyStateBeforeChapter.latestCommittedChapter,
        latestCommittedChapterAfter: storyStateBeforeChapter.latestCommittedChapter,
        previewStateHash: hashJson(storyStateBeforeChapter),
        confirmedStateHash: hashJson(storyStateBeforeChapter),
        previewReusedForConfirm: false,
        qualityCriticalIssues: [],
        warnings: []
      };
      chapters.push(chapterReport);

      const preBudget = await checkChapterBudget(paths, fileStore, input, chapterNumber, chapterStart, [], 'before chapter execution');
      if (preBudget !== undefined) {
        failureReportPath = preBudget;
        chapterReport.warnings.push('Codex call budget exhausted before chapter execution.');
        break;
      }

      const chapterRunIds: string[] = [];
      try {
        const dryRun = await runChapterDryRun(
          {
            projectId,
            projectsRoot,
            chapterNumber,
            provider: 'codex-text',
            promptRoot,
            ...codexOptions(input)
          },
          fileStore
        );
        chapterRunIds.push(dryRun.runId);

        const draft = await runChapterUntilDraft(
          {
            projectId,
            projectsRoot,
            chapterNumber,
            provider: 'codex-text',
            promptRoot,
            ...codexOptions(input)
          },
          fileStore
        );
        chapterRunIds.push(draft.runId);
        chapterReport.draftRunId = draft.runId;

        const draftBudget = await checkChapterBudget(paths, fileStore, input, chapterNumber, chapterStart, chapterRunIds, 'after draft generation');
        if (draftBudget !== undefined) {
          failureReportPath = draftBudget;
          chapterReport.warnings.push('Codex chapter budget exceeded after draft generation.');
          break;
        }

        const stateBeforePreview = await fileStore.readJson(paths.storyState(), StoryStateSchema);
        chapterReport.previewStateHash = hashJson(stateBeforePreview);
        const preview = await runChapterFullProduction(
          {
            projectId,
            projectsRoot,
            chapterNumber,
            provider: 'codex-text',
            promptRoot,
            ...codexOptions(input),
            maxRevisions: 2,
            commit: true
          },
          fileStore
        );
        chapterRunIds.push(preview.runId);
        if (preview.previewOnly !== true || preview.codexPatchPath === undefined || preview.stateDiffPath === undefined) {
          throw new AppError('CODEX_COMMIT_PREVIEW_REQUIRED', `Chapter ${chapterNumber} did not produce a codex commit preview.`, 2, {
            chapterNumber,
            stage: 'commit'
          });
        }
        chapterReport.previewRunId = preview.runId;
        chapterReport.finalPath = relativeChapterArtifact(chapterNumber, 'final.md');
        chapterReport.canonPatchPath = preview.codexPatchPath;
        chapterReport.stateDiffPath = preview.stateDiffPath;
        chapterReport.qualityReportPath = preview.qualityReportPath;
        await assertStoryStateUnchanged(paths, fileStore, stateBeforePreview, `chapter ${chapterNumber} preview`);

        const previewBudget = await checkChapterBudget(paths, fileStore, input, chapterNumber, chapterStart, chapterRunIds, 'after preview generation');
        if (previewBudget !== undefined) {
          failureReportPath = previewBudget;
          chapterReport.warnings.push('Codex chapter budget exceeded after preview generation.');
          break;
        }

        const stateBeforeConfirm = await fileStore.readJson(paths.storyState(), StoryStateSchema);
        const confirmedStateHash = hashJson(stateBeforeConfirm);
        if (confirmedStateHash !== chapterReport.previewStateHash) {
          throw new AppError('CODEX_PREVIEW_CONFIRM_STATE_HASH_MISMATCH', `Chapter ${chapterNumber} preview no longer matches current Story State.`, 2, {
            chapterNumber,
            stage: 'commit'
          });
        }

        const confirm = await runChapterFullProduction(
          {
            projectId,
            projectsRoot,
            chapterNumber,
            provider: 'codex-text',
            promptRoot,
            ...codexOptions(input),
            maxRevisions: 2,
            commit: true,
            confirmCodexCommit: true
          },
          fileStore
        );
        chapterRunIds.push(confirm.runId);
        if (confirm.chapterNumber !== chapterNumber || confirm.status !== 'committed') {
          throw new AppError('CODEX_CONFIRM_CHAPTER_MISMATCH', `Confirmed chapter ${confirm.chapterNumber} did not match preview chapter ${chapterNumber}.`, 2, {
            chapterNumber,
            stage: 'commit'
          });
        }
        chapterReport.confirmedRunId = confirm.runId;
        chapterReport.canonPatchPath = confirm.codexPatchPath;
        chapterReport.stateDiffPath = confirm.stateDiffPath;
        chapterReport.approvalRecordPath = confirm.approvalRecordPath;
        chapterReport.commitReportPath = confirm.commitReportPath;
        chapterReport.beforeSnapshotId = confirm.beforeSnapshotId;
        chapterReport.afterSnapshotId = confirm.afterSnapshotId;
        chapterReport.qualityReportPath = confirm.qualityReportPath ?? chapterReport.qualityReportPath;
        chapterReport.confirmedStateHash = confirmedStateHash;
        chapterReport.previewReusedForConfirm = confirm.reusedPreviewArtifacts === true;

        const quality = await evaluateCodexChapterQuality({ projectId, projectsRoot, chapterNumber }, fileStore);
        chapterReport.qualityReportPath = quality.reportPath;
        chapterReport.qualityCriticalIssues = quality.criticalIssues;
        chapterReport.warnings.push(...quality.report.warnings);
        if (quality.blocking) {
          throw new AppError('CODEX_CHAPTER_QUALITY_BLOCKED', quality.criticalIssues.join('; '), 2, {
            chapterNumber,
            stage: 'quality',
            reason: `qualityReportPath=${quality.reportPath}`
          });
        }

        const stateAfterConfirm = await fileStore.readJson(paths.storyState(), StoryStateSchema);
        chapterReport.latestCommittedChapterAfter = stateAfterConfirm.latestCommittedChapter;
        if (stateAfterConfirm.latestCommittedChapter !== chapterNumber) {
          throw new AppError('CODEX_LATEST_COMMITTED_CHAPTER_MISMATCH', `Expected latestCommittedChapter=${chapterNumber}, got ${stateAfterConfirm.latestCommittedChapter}.`, 2, {
            chapterNumber,
            stage: 'commit'
          });
        }

        const chapterValidate = await validateProject({ projectId, projectsRoot }, fileStore);
        if (!chapterValidate.ok) {
          throw new AppError('CODEX_PILOT_VALIDATE_FAILED', chapterValidate.checks.filter((check) => !check.ok).map((check) => check.message ?? check.name).join('; '), 2, {
            chapterNumber,
            stage: 'validate'
          });
        }
      } catch (error) {
        chapterReport.warnings.push(getErrorMessage(error));
        failureReportPath = await findCodexFailurePath(paths, fileStore, chapterRunIds);
        if (failureReportPath === undefined) {
          failureReportPath = await writePilotFailureMarkdown(paths, fileStore, chapterNumber, error);
        }
        break;
      }
    }

    const drift = await evaluateCodexCrossChapterDrift(
      {
        projectId,
        projectsRoot,
        chapters: Array.from({ length: targetChapterCount }, (_, index) => index + 1)
      },
      fileStore
    );
    crossChapterDriftReportPath = drift.reportPath;
    const continuity = await evaluateCodexCrossChapterContinuity(
      {
        projectId,
        projectsRoot,
        chapters: Array.from({ length: targetChapterCount }, (_, index) => index + 1)
      },
      fileStore
    );
    crossChapterContinuityReportPath = continuity.reportPath;
    validatePassed = (await validateProject({ projectId, projectsRoot }, fileStore)).ok;
    const audit = await auditProject({ projectId, projectsRoot, strict: true, fixIndex: true }, fileStore);
    auditPassed = audit.ok;
    latestCommittedChapterAfter = (await fileStore.readJson(paths.storyState(), StoryStateSchema)).latestCommittedChapter;
    success =
      latestCommittedChapterAfter >= targetChapterCount &&
      chapters.filter((chapter) => chapter.latestCommittedChapterAfter === chapter.chapterNumber).length >= targetChapterCount &&
      validatePassed &&
      auditPassed &&
      drift.report.blockingIssues.length === 0 &&
      continuity.report.blockingIssues.length === 0 &&
      failureReportPath === undefined;
  } catch (error) {
    failureReportPath = await writePilotFailureMarkdown(paths, fileStore, 0, error);
    latestCommittedChapterAfter = (await safeLatestCommittedChapter(paths, fileStore)) ?? latestCommittedChapterAfter;
  }

  const report = await writePilotReport(paths, fileStore, {
    projectId,
    generatedAt: new Date().toISOString(),
    targetChapterCount,
    completedChapterCount: Math.min(latestCommittedChapterAfter, targetChapterCount),
    latestCommittedChapterBefore,
    latestCommittedChapterAfter,
    success,
    codexStatus,
    chapters,
    validatePassed,
    auditPassed,
    ...(crossChapterDriftReportPath === undefined ? {} : { crossChapterDriftReportPath }),
    ...(crossChapterContinuityReportPath === undefined ? {} : { crossChapterContinuityReportPath }),
    ...(failureReportPath === undefined ? {} : { failureReportPath })
  });
  return report;
}

export async function evaluateCodexCrossChapterDrift(
  input: EvaluateCodexCrossChapterDriftInput,
  fileStore = new FileStore()
): Promise<EvaluateCodexCrossChapterDriftResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const queue = await fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema);
  const blockingIssues: CodexCrossChapterDriftIssue[] = [];
  const warnings: CodexCrossChapterDriftIssue[] = [];
  const recommendations: string[] = [];
  const queueCommittedChapters = queue.chapters.filter((chapter) => chapter.status === 'committed').map((chapter) => chapter.chapterNumber);

  addBlockingIf(
    blockingIssues,
    storyState.latestCommittedChapter < Math.max(...input.chapters),
    'latest_committed_too_low',
    `latestCommittedChapter=${storyState.latestCommittedChapter} is below requested pilot chapter ${Math.max(...input.chapters)}.`,
    'state/story_state.json'
  );

  for (const chapterNumber of input.chapters) {
    const queueItem = queue.chapters.find((chapter) => chapter.chapterNumber === chapterNumber);
    addBlockingIf(
      blockingIssues,
      queueItem?.status !== 'committed',
      `queue_ch${chapterNumber}_not_committed`,
      `Chapter ${chapterNumber} queue status is ${queueItem?.status ?? 'missing'}, expected committed.`,
      'planning/chapter_queue.json',
      chapterNumber
    );
    addBlockingIf(
      blockingIssues,
      !storyState.canonFacts.some((fact) => fact.sourceChapter === chapterNumber),
      `canon_fact_ch${chapterNumber}_missing`,
      `Chapter ${chapterNumber} has no canon facts in Story State.`,
      'state/story_state.json',
      chapterNumber
    );
    addBlockingIf(
      blockingIssues,
      !storyState.timeline.some((event) => event.chapter === chapterNumber),
      `timeline_ch${chapterNumber}_missing`,
      `Chapter ${chapterNumber} has no timeline event in Story State.`,
      'state/story_state.json',
      chapterNumber
    );
    await checkFinalForPlaceholders(blockingIssues, paths, fileStore, chapterNumber);
    await collectDiagnosticsWarnings(warnings, paths, fileStore, chapterNumber);
  }

  const duplicateFactIds = duplicates(storyState.canonFacts.map((fact) => fact.id));
  for (const factId of duplicateFactIds) {
    blockingIssues.push({
      issueId: `duplicate_fact_${factId}`,
      severity: 'critical',
      message: `Duplicate canon fact id: ${factId}`,
      path: 'state/story_state.json'
    });
  }

  const timelineChapters = storyState.timeline.map((event) => event.chapter);
  for (let index = 1; index < timelineChapters.length; index += 1) {
    if ((timelineChapters[index] ?? 0) < (timelineChapters[index - 1] ?? 0)) {
      blockingIssues.push({
        issueId: `timeline_order_${index}`,
        severity: 'critical',
        message: 'Timeline chapter order inversion detected.',
        path: 'state/story_state.json'
      });
      break;
    }
  }

  if (storyState.characters.length === 0) {
    warnings.push({
      issueId: 'characters_empty',
      severity: 'warning',
      message: 'Story State has no character states after Codex pilot.',
      path: 'state/story_state.json'
    });
  }
  if (storyState.readerState.readerKnows.length === 0 || storyState.readerState.readerExpectations.length === 0) {
    warnings.push({
      issueId: 'reader_state_sparse',
      severity: 'warning',
      message: 'Reader State known facts or expectations are empty.',
      path: 'state/story_state.json'
    });
  }
  if (storyState.narrativeDebts.length === 0) {
    warnings.push({
      issueId: 'narrative_debts_empty',
      severity: 'warning',
      message: 'Narrative debts did not evolve during the pilot.',
      path: 'state/story_state.json'
    });
  }
  if (storyState.foreshadowing.length === 0) {
    warnings.push({
      issueId: 'foreshadowing_empty',
      severity: 'warning',
      message: 'Foreshadowing did not evolve during the pilot.',
      path: 'state/story_state.json'
    });
  }

  recommendations.push('Use audit --strict after the pilot and inspect drift warnings before continuing beyond chapter 3.');
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_cross_chapter_drift_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_cross_chapter_drift_report_v${artifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      chapters: input.chapters,
      latestCommittedChapter: storyState.latestCommittedChapter,
      queueCommittedChapters,
      blockingIssues,
      warnings,
      recommendations,
      storyStateMutated: false
    },
    CodexCrossChapterDriftReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderDriftMarkdown(report));
  return {
    report,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath
  };
}

async function ensureProjectBootstrapped(input: RunCodexMultiChapterPilotInput, paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (input.resume !== true && input.clean !== false) {
    await rm(paths.projectRoot, { recursive: true, force: true });
  }
  if (!(await fileStore.exists(paths.projectRoot))) {
    await initProject({ projectId: paths.projectId, projectsRoot: paths.projectsRoot, briefPath: input.briefPath }, fileStore);
    await buildBible({ projectId: paths.projectId, projectsRoot: paths.projectsRoot, provider: 'codex-text', promptRoot: input.promptRoot ?? DEFAULT_PROMPT_ROOT, ...codexOptions(input) }, fileStore);
    await planGlobal({ projectId: paths.projectId, projectsRoot: paths.projectsRoot, provider: 'codex-text', promptRoot: input.promptRoot ?? DEFAULT_PROMPT_ROOT, ...codexOptions(input) }, fileStore);
    return;
  }
  if (!(await fileStore.exists(paths.chapterQueue()))) {
    await buildBible({ projectId: paths.projectId, projectsRoot: paths.projectsRoot, provider: 'codex-text', force: true, promptRoot: input.promptRoot ?? DEFAULT_PROMPT_ROOT, ...codexOptions(input) }, fileStore);
    await planGlobal({ projectId: paths.projectId, projectsRoot: paths.projectsRoot, provider: 'codex-text', promptRoot: input.promptRoot ?? DEFAULT_PROMPT_ROOT, ...codexOptions(input) }, fileStore);
  }
}

async function checkChapterBudget(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: RunCodexMultiChapterPilotInput,
  chapterNumber: number,
  startedAtMs: number,
  runIds: string[],
  stage: string
): Promise<string | undefined> {
  const maxCalls = input.codexMaxCallsPerChapter ?? DEFAULT_MAX_CALLS_PER_CHAPTER;
  const maxRuntimeMs = input.codexMaxRuntimeMsPerChapter ?? DEFAULT_MAX_RUNTIME_MS_PER_CHAPTER;
  const callsUsed = await countPromptCalls(paths, fileStore, runIds);
  const runtimeMs = Math.max(0, Date.now() - startedAtMs);
  if (maxCalls > 0 && callsUsed <= maxCalls && runtimeMs <= maxRuntimeMs) {
    return undefined;
  }
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_budget_report');
  const report: CodexBudgetReport = CodexBudgetReportSchema.parse({
    reportId: `codex_budget_report_v${artifact.version}`,
    projectId: paths.projectId,
    chapterNumber,
    generatedAt: new Date().toISOString(),
    exceeded: true,
    reason: `Codex budget exceeded ${stage}: calls=${callsUsed}/${maxCalls}, runtimeMs=${runtimeMs}/${maxRuntimeMs}.`,
    budget: {
      maxCallsPerChapter: maxCalls,
      maxRuntimeMsPerChapter: maxRuntimeMs,
      timeoutMs: input.codexTimeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS
    },
    usage: {
      callsUsed,
      runtimeMs
    },
    storyStateMutated: false,
    suggestedRetryCommand: `corepack pnpm novel-loop codex multi-chapter-pilot --project-id ${paths.projectId} --chapters ${input.targetChapterCount ?? DEFAULT_TARGET_CHAPTERS} --resume --codex-max-calls-per-chapter ${Math.max(maxCalls, DEFAULT_MAX_CALLS_PER_CHAPTER)}`
  });
  await fileStore.writeJson(artifact.jsonPath, report, CodexBudgetReportSchema);
  await fileStore.writeText(artifact.mdPath, renderBudgetMarkdown(report));
  return artifact.relativeJsonPath;
}

async function countPromptCalls(paths: ProjectPaths, fileStore: FileStore, runIds: string[]): Promise<number> {
  let count = 0;
  for (const runId of runIds) {
    if (!(await fileStore.exists(paths.runManifest(runId)))) continue;
    const manifest = await fileStore.readJson(paths.runManifest(runId), RunManifestSchema);
    if ('schemaVersion' in manifest && manifest.schemaVersion === '2') {
      count += manifest.promptCalls.filter((call) => call.provider === 'codex-text' || call.provider === 'codex-cli').length;
    }
  }
  return count;
}

async function assertStoryStateUnchanged(paths: ProjectPaths, fileStore: FileStore, before: unknown, label: string): Promise<void> {
  const after = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  if (hashJson(before) !== hashJson(after)) {
    throw new AppError('CODEX_PREVIEW_MUTATED_STORY_STATE', `${label} mutated Story State.`, 2, {
      reason: 'Codex preview must not write canonical state.'
    });
  }
}

async function findCodexFailurePath(paths: ProjectPaths, fileStore: FileStore, runIds: string[]): Promise<string | undefined> {
  for (const runId of [...runIds].reverse()) {
    const relativePath = path.join('codex', 'failures', runId, 'codex_failure_report.json');
    if (await fileStore.exists(paths.projectArtifact(relativePath))) {
      return relativePath;
    }
  }
  return undefined;
}

async function writePilotFailureMarkdown(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, error: unknown): Promise<string> {
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_multi_chapter_failure_report');
  await fileStore.writeText(
    artifact.mdPath,
    [`# Codex Multi-Chapter Pilot Failure`, '', `chapterNumber: ${chapterNumber}`, `error: ${getErrorMessage(error)}`].join('\n') + '\n'
  );
  return artifact.relativeMdPath;
}

async function writePilotReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: Omit<CodexMultiChapterPilotReport, 'reportId'>
): Promise<RunCodexMultiChapterPilotResult> {
  await fileStore.ensureDir(paths.auditDir());
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_multi_chapter_pilot_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      ...input,
      reportId: `codex_multi_chapter_pilot_report_v${artifact.version}`
    },
    CodexMultiChapterPilotReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderPilotMarkdown(report));
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

async function safeCodexStatus(input: RunCodexMultiChapterPilotInput, projectsRoot: string, projectId: string): Promise<Record<string, unknown>> {
  try {
    return {
      ...(await checkCodexStatus({
        projectsRoot,
        projectId,
        ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
        codexProfile: input.codexProfile ?? 'clean',
        timeoutMs: input.codexTimeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}

async function safeLatestCommittedChapter(paths: ProjectPaths, fileStore: FileStore): Promise<number | undefined> {
  try {
    return (await fileStore.readJson(paths.storyState(), StoryStateSchema)).latestCommittedChapter;
  } catch {
    return undefined;
  }
}

async function checkFinalForPlaceholders(
  blockingIssues: CodexCrossChapterDriftIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number
): Promise<void> {
  const relativePath = relativeChapterArtifact(chapterNumber, 'final.md');
  const finalPath = paths.projectArtifact(relativePath);
  if (!(await fileStore.exists(finalPath))) {
    blockingIssues.push({
      issueId: `final_missing_ch${chapterNumber}`,
      chapterNumber,
      severity: 'critical',
      message: `final.md is missing for chapter ${chapterNumber}.`,
      path: relativePath
    });
    return;
  }
  const final = await fileStore.readText(finalPath);
  if (/(\{\{[^}]+}}|\bTODO\b|\bTBD\b|\bFIXME\b|\bPLACEHOLDER\b)/i.test(final)) {
    blockingIssues.push({
      issueId: `placeholder_ch${chapterNumber}`,
      chapterNumber,
      severity: 'critical',
      message: `Chapter ${chapterNumber} final.md contains unresolved placeholder text.`,
      path: relativePath
    });
  }
}

async function collectDiagnosticsWarnings(
  warnings: CodexCrossChapterDriftIssue[],
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number
): Promise<void> {
  const diagnosticsPath = paths.chapterArtifact(chapterNumber, 'diagnostics_v1.json');
  if (!(await fileStore.exists(diagnosticsPath))) return;
  const diagnostics = await fileStore.readJson(diagnosticsPath, DiagnosticsReportSchema);
  for (const warning of diagnostics.normalizationWarnings) {
    warnings.push({
      issueId: `diagnostics_normalized_ch${chapterNumber}_${warning.field}`,
      chapterNumber,
      severity: 'warning',
      message: `Codex diagnostics normalized ${warning.field} from ${warning.originalValue} to ${warning.normalizedValue}.`,
      path: warning.artifactPath
    });
  }
}

function addBlockingIf(
  issues: CodexCrossChapterDriftIssue[],
  condition: boolean,
  issueId: string,
  message: string,
  pathValue: string,
  chapterNumber?: number
): void {
  if (!condition) return;
  issues.push({
    issueId,
    ...(chapterNumber === undefined ? {} : { chapterNumber }),
    severity: 'critical',
    message,
    path: pathValue
  });
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicatesFound = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicatesFound.add(value);
    }
    seen.add(value);
  }
  return [...duplicatesFound].sort();
}

function codexOptions(input: RunCodexMultiChapterPilotInput) {
  return {
    ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
    codexProfile: input.codexProfile ?? 'clean',
    codexJsonRetries: input.codexJsonRetries ?? 2,
    codexJsonRepair: input.codexJsonRepair ?? true,
    codexJsonRepairRetries: input.codexJsonRepairRetries ?? 1,
    codexTimeoutMs: input.codexTimeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS,
    ...(input.codexContextBudgetBytes === undefined ? {} : { codexContextBudgetBytes: input.codexContextBudgetBytes }),
    ...(input.codexMaxArtifactsInContext === undefined ? {} : { codexMaxArtifactsInContext: input.codexMaxArtifactsInContext }),
    codexContextMode: input.codexContextMode ?? 'compact'
  };
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, ...segments);
}

function renderPilotMarkdown(report: CodexMultiChapterPilotReport): string {
  return [
    `# Codex Multi-Chapter Pilot ${report.projectId}`,
    '',
    `success: ${String(report.success)}`,
    `targetChapterCount: ${report.targetChapterCount}`,
    `completedChapterCount: ${report.completedChapterCount}`,
    `latestCommittedChapterBefore: ${report.latestCommittedChapterBefore}`,
    `latestCommittedChapterAfter: ${report.latestCommittedChapterAfter}`,
    `validatePassed: ${String(report.validatePassed)}`,
    `auditPassed: ${String(report.auditPassed)}`,
    `crossChapterDriftReportPath: ${report.crossChapterDriftReportPath ?? 'none'}`,
    `crossChapterContinuityReportPath: ${report.crossChapterContinuityReportPath ?? 'none'}`,
    `failureReportPath: ${report.failureReportPath ?? 'none'}`,
    '',
    '## Chapters',
    ...report.chapters.map((chapter) => `- chapter ${chapter.chapterNumber}: latest ${chapter.latestCommittedChapterBefore} -> ${chapter.latestCommittedChapterAfter}, previewReusedForConfirm=${String(chapter.previewReusedForConfirm)}`)
  ].join('\n') + '\n';
}

function renderDriftMarkdown(report: CodexCrossChapterDriftReport): string {
  return [
    `# Codex Cross-Chapter Drift ${report.projectId}`,
    '',
    `latestCommittedChapter: ${report.latestCommittedChapter}`,
    `blockingIssues: ${report.blockingIssues.length}`,
    `warnings: ${report.warnings.length}`,
    '',
    '## Blocking Issues',
    ...(report.blockingIssues.length === 0 ? ['- none'] : report.blockingIssues.map((issue) => `- ${issue.issueId}: ${issue.message}`)),
    '',
    '## Warnings',
    ...(report.warnings.length === 0 ? ['- none'] : report.warnings.map((issue) => `- ${issue.issueId}: ${issue.message}`))
  ].join('\n') + '\n';
}

function renderBudgetMarkdown(report: CodexBudgetReport): string {
  return [
    `# Codex Budget Report ${report.projectId}`,
    '',
    `chapterNumber: ${report.chapterNumber}`,
    `exceeded: ${String(report.exceeded)}`,
    `reason: ${report.reason}`,
    `storyStateMutated: ${String(report.storyStateMutated)}`,
    `suggestedRetryCommand: ${report.suggestedRetryCommand}`
  ].join('\n') + '\n';
}
