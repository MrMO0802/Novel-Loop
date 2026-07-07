import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

import { ChapterQueueStore } from './chapterQueue.js';
import { blockCodexTextUnsafeOperation } from './codexTextSafety.js';
import { runCodexControlledCommit } from './codexControlledCommit.js';
import { readFileMetadata } from './fileHash.js';
import { runChapterUntilDraft } from './chapterDrafting.js';
import { runChapterDryRun } from './chapterPlanning.js';
import { runChapterRevisionLoop } from './chapterRevisionLoop.js';
import type { ChapterRevisionLoopInput, ChapterRevisionLoopResult } from './chapterRevisionLoop.js';
import {
  ArchiveManifestSchema,
  CanonPatchSchema,
  ChapterMissionSchema,
  ChapterPlanRankingSchema,
  ConflictReportSchema,
  ReusePolicyReportSchema,
  SceneCardsSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type { ArchiveManifest, ArchivedArtifact, ChapterQueueStage, ReusePolicy, ReusePolicyReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError } from '../utils/AppError.js';

export interface ChapterFullProductionInput extends ChapterRevisionLoopInput {
  candidates?: number;
  planningRunId?: string;
  draftRunId?: string;
  forceRecommit?: boolean;
  reusePolicy?: ReusePolicy;
}

export type ChapterResumeInput = Omit<ChapterFullProductionInput, 'chapterNumber'>;

export interface ChapterFullProductionResult extends ChapterRevisionLoopResult {
  runIds: {
    planning?: string;
    draft?: string;
    revision: string;
  };
  stages: {
    planned: boolean;
    drafted: boolean;
  };
  regeneratedChapterNumber?: number;
  archiveManifestPath?: string;
  remainingStaleChapters?: number[];
  reusePolicyRequested?: ReusePolicy;
  reusePolicyEffective?: ReusePolicy;
  reusePolicyReportPath?: string;
  oldArtifactsArchivedCount?: number;
  previewOnly?: boolean;
  codexPatchPath?: string;
  stateDiffPath?: string;
  stateDiffMarkdownPath?: string;
  approvalRecordPath?: string;
  codexCommitReportPath?: string;
  beforeSnapshotId?: string;
  afterSnapshotId?: string;
  suggestedNextCommand?: string;
  reusedPreviewArtifacts?: boolean;
  reusedPatchPath?: string;
  reusedStateDiffPath?: string;
  normalizedPatchPath?: string;
  consistencyReportPath?: string;
  qualityReportPath?: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const PLANNING_STAGES = new Set<ChapterQueueStage>(['mission', 'plan_candidates', 'ranking']);
const DRAFT_STAGES = new Set<ChapterQueueStage>(['scene_cards', 'scene_drafts', 'draft_assembly']);

export async function runChapterFullProduction(input: ChapterFullProductionInput, fileStore = new FileStore()): Promise<ChapterFullProductionResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const queueStore = new ChapterQueueStore(paths, fileStore);
  const initialQueueItem = await queueStore.getRequiredChapter(input.chapterNumber);
  const artifacts: string[] = [];
  const generatedArtifacts: string[] = [];
  const reusedArtifacts: string[] = [];
  const runIds: ChapterFullProductionResult['runIds'] = {
    revision: ''
  };
  const forceRegeneration = input.regenerateStale === true;
  let planned = false;
  let drafted = false;
  let archiveManifestPath: string | undefined;
  let archiveManifest: ArchiveManifest | undefined;
  let reusePolicyReportPath: string | undefined;
  let reusePolicyReport: ReusePolicyReport | undefined;
  let reusePolicyRequested: ReusePolicy | undefined;
  let reusePolicyEffective: ReusePolicy | undefined;

  if (input.provider === 'codex-text' && input.commit === true) {
    if (forceRegeneration) {
      throw new AppError('CODEX_TEXT_STALE_REGEN_COMMIT_BLOCKED', 'codex-text controlled commit cannot regenerate stale chapters in M24.', 2, {
        chapterNumber: input.chapterNumber,
        stage: 'commit',
        reason: 'M24 only allows normal next uncommitted chapter controlled commits.',
        suggestedNextCommand: `corepack pnpm novel-loop chapter ${input.projectId} next --provider mock --regenerate-stale --commit`
      });
    }
    const codexResult = await runCodexControlledCommit(input, fileStore);
    return {
      ...codexResult,
      runIds: {
        revision: codexResult.runId
      },
      stages: {
        planned: false,
        drafted: false
      }
    };
  }

  blockCodexTextUnsafeOperation({
    provider: input.provider,
    projectId: input.projectId,
    chapterNumber: input.chapterNumber,
    operation: 'the post-draft chapter pipeline',
    suggestedNextCommand: `corepack pnpm novel-loop chapter ${input.projectId} ${input.chapterNumber} --provider codex-text --until draft`
  });
  await ensureForceStageAllowed(paths, fileStore, input);
  if (forceRegeneration) {
    if (initialQueueItem.status !== 'stale_due_to_history_edit') {
      throw new AppError('REGENERATE_STALE_CHAPTER_NOT_STALE', `Chapter ${input.chapterNumber} is not stale and cannot be regenerated with --regenerate-stale.`, 2, {
        chapterNumber: input.chapterNumber,
        stage: 'none',
        suggestedNextCommand: `novel-loop stale ${paths.projectId}`
      });
    }
    const invalidatedBy = await findInvalidationForStaleChapter(paths, fileStore, input.chapterNumber);
    const archive = await writeArchiveManifest(paths, fileStore, {
      chapterNumber: input.chapterNumber,
      reason: initialQueueItem.failureReason ?? 'stale regeneration',
      oldStatus: initialQueueItem.status,
      newRegenerationRunId: input.runId ?? 'pending',
      ...(invalidatedBy === undefined ? {} : { invalidatedBy })
    });
    archiveManifestPath = archive.relativePath;
    archiveManifest = archive.manifest;
    const reusePolicyReportResult = await writeReusePolicyReport(paths, fileStore, {
      chapterNumber: input.chapterNumber,
      requestedPolicy: input.reusePolicy ?? 'reference_only',
      archiveManifest
    });
    reusePolicyReportPath = reusePolicyReportResult.path;
    reusePolicyReport = reusePolicyReportResult.report;
    reusePolicyRequested = reusePolicyReportResult.report.requestedPolicy;
    reusePolicyEffective = reusePolicyReportResult.report.effectivePolicy;
  }
  if (input.commit === true && input.forceRecommit !== true) {
    await ensureCommitSequence(paths, fileStore, input.chapterNumber);
  }

  if (forceRegeneration || !(await hasPlanningArtifacts(paths, fileStore, input.chapterNumber, input.forceStage))) {
    const planning = await runChapterDryRun(
      {
        ...createStageInput(input),
        candidates: input.candidates ?? 3,
        ...(input.planningRunId === undefined ? {} : { runId: input.planningRunId })
      },
      fileStore
    );
    appendUnique(artifacts, planning.artifacts);
    appendUnique(generatedArtifacts, planning.generatedArtifacts);
    appendUnique(reusedArtifacts, planning.reusedArtifacts);
    runIds.planning = planning.runId;
    planned = true;
  }

  if (forceRegeneration || !(await hasDraftArtifacts(paths, fileStore, input.chapterNumber, input.forceStage))) {
    const draft = await runChapterUntilDraft(
      {
        ...createStageInput(input),
      ...(input.draftRunId === undefined ? {} : { runId: input.draftRunId })
      },
      fileStore
    );
    appendUnique(artifacts, draft.artifacts);
    appendUnique(generatedArtifacts, draft.generatedArtifacts);
    appendUnique(reusedArtifacts, draft.reusedArtifacts);
    runIds.draft = draft.runId;
    drafted = true;
  }

  const revision = await runChapterRevisionLoop(
    {
      ...input,
      ...(archiveManifest === undefined || archiveManifestPath === undefined
        ? {}
        : {
            archiveProvenance: {
              archiveManifestPath,
              archiveManifest
            }
          }),
      ...(reusePolicyReportPath === undefined || reusePolicyReport === undefined
        ? {}
        : {
            reusePolicyProvenance: {
              reportPath: reusePolicyReportPath,
              report: reusePolicyReport
            }
          })
    },
    fileStore
  );
  appendUnique(artifacts, revision.artifacts);
  appendUnique(generatedArtifacts, revision.generatedArtifacts);
  appendUnique(reusedArtifacts, revision.reusedArtifacts);
  runIds.revision = revision.runId;

  const remainingStaleChapters = await remainingStaleChapterNumbers(queueStore);
  return {
    ...revision,
    artifacts,
    generatedArtifacts,
    reusedArtifacts,
    previousStatus: initialQueueItem.status,
    runIds,
    stages: {
      planned,
      drafted
    },
    ...(forceRegeneration ? { regeneratedChapterNumber: input.chapterNumber } : {}),
    ...(archiveManifestPath === undefined ? {} : { archiveManifestPath }),
    ...(reusePolicyRequested === undefined ? {} : { reusePolicyRequested }),
    ...(reusePolicyEffective === undefined ? {} : { reusePolicyEffective }),
    ...(reusePolicyReportPath === undefined ? {} : { reusePolicyReportPath }),
    ...(archiveManifest === undefined ? {} : { oldArtifactsArchivedCount: archiveManifest.copiedArtifacts.length }),
    remainingStaleChapters
  };
}

export async function runChapterResume(input: ChapterResumeInput, fileStore = new FileStore()): Promise<ChapterFullProductionResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const queueStore = new ChapterQueueStore(paths, fileStore);
  const candidate = await queueStore.findResumeCandidate();
  if (candidate === undefined) {
    throw new AppError('NO_RESUMABLE_CHAPTER', 'No failed or in-progress chapter is available to resume.', 2, {
      suggestedNextCommand: `novel-loop chapter ${input.projectId} next --provider mock --commit`
    });
  }
  if (candidate.status === 'committed') {
    throw new AppError('CHAPTER_ALREADY_COMMITTED', `Chapter ${candidate.chapterNumber} is already committed and cannot be resumed.`, 2, {
      chapterNumber: candidate.chapterNumber,
      stage: 'commit',
      suggestedNextCommand: `novel-loop chapter ${input.projectId} next --provider mock --commit`
    });
  }
  if (candidate.status === 'blocked' && input.repairConflicts !== true) {
    const latestReport = await readLatestConflictReport(paths, fileStore, candidate.chapterNumber);
    throw new AppError('CANON_PATCH_CONFLICT', `Chapter ${candidate.chapterNumber} is blocked by canon patch conflict(s).`, 2, {
      chapterNumber: candidate.chapterNumber,
      stage: 'commit',
      ...(latestReport === undefined
        ? {}
        : {
            conflictCount: latestReport.report.conflicts.length,
            highestSeverity: highestSeverity(latestReport.report.conflicts.map((conflict) => conflict.severity)),
            conflictReportPath: latestReport.path,
            repairableCount: latestReport.report.conflicts.filter((conflict) => conflict.repairable).length,
            unrepairableCount: latestReport.report.conflicts.filter((conflict) => !conflict.repairable).length
          }),
      suggestedNextCommand: `corepack pnpm novel-loop chapter ${input.projectId} next --provider mock --resume --repair-conflicts --max-conflict-repairs ${input.maxConflictRepairs ?? 2} --commit`
    });
  }

  const resumeFromStage = await determineResumeStage(paths, fileStore, candidate.chapterNumber);
  return runChapterFullProduction(
    {
      ...input,
      chapterNumber: candidate.chapterNumber,
      resumeFromStage
    },
    fileStore
  );
}

async function ensureCommitSequence(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  const state = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  if (chapterNumber <= state.latestCommittedChapter) {
    throw new AppError(
      'CHAPTER_ALREADY_COMMITTED',
      `Chapter ${chapterNumber} is already committed; latestCommittedChapter is ${state.latestCommittedChapter}.`,
      2,
      {
        chapterNumber,
        stage: 'commit',
        suggestedNextCommand: `novel-loop chapter ${paths.projectId} next --provider mock --commit`
      }
    );
  }
  if (chapterNumber !== state.latestCommittedChapter + 1) {
    throw new AppError(
      'CHAPTER_SEQUENCE_GAP',
      `Chapter ${chapterNumber} cannot be committed before chapter ${state.latestCommittedChapter + 1}.`,
      2,
      {
        chapterNumber,
        stage: 'commit',
        suggestedNextCommand: `novel-loop chapter ${paths.projectId} next --provider mock --commit`
      }
    );
  }
}

async function ensureForceStageAllowed(paths: ProjectPaths, fileStore: FileStore, input: ChapterFullProductionInput): Promise<void> {
  if (input.forceStage === undefined) {
    return;
  }

  const state = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  if (input.chapterNumber <= state.latestCommittedChapter) {
    throw new AppError(
      'FORCE_STAGE_COMMITTED_CHAPTER',
      `--force-stage cannot be used on committed chapter ${input.chapterNumber}.`,
      2,
      {
        chapterNumber: input.chapterNumber,
        stage: input.forceStage,
        suggestedNextCommand: `novel-loop chapter ${input.projectId} next --provider mock --commit`
      }
    );
  }
}

function createStageInput(input: ChapterFullProductionInput) {
  return {
    projectId: input.projectId,
    chapterNumber: input.chapterNumber,
    ...(input.projectsRoot === undefined ? {} : { projectsRoot: input.projectsRoot }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.promptRoot === undefined ? {} : { promptRoot: input.promptRoot }),
    ...(input.fixturesRoot === undefined ? {} : { fixturesRoot: input.fixturesRoot }),
    ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
    ...(input.codexProfile === undefined ? {} : { codexProfile: input.codexProfile }),
    ...(input.codexJsonRetries === undefined ? {} : { codexJsonRetries: input.codexJsonRetries }),
    ...(input.codexJsonRepair === undefined ? {} : { codexJsonRepair: input.codexJsonRepair }),
    ...(input.codexJsonRepairRetries === undefined ? {} : { codexJsonRepairRetries: input.codexJsonRepairRetries }),
    ...(input.codexTimeoutMs === undefined ? {} : { codexTimeoutMs: input.codexTimeoutMs }),
    ...(input.codexContextBudgetBytes === undefined ? {} : { codexContextBudgetBytes: input.codexContextBudgetBytes }),
    ...(input.codexMaxArtifactsInContext === undefined ? {} : { codexMaxArtifactsInContext: input.codexMaxArtifactsInContext }),
    ...(input.codexContextMode === undefined ? {} : { codexContextMode: input.codexContextMode }),
    ...(input.forceStage === undefined ? {} : { forceStage: input.forceStage }),
    ...(input.failAt === undefined ? {} : { failAt: input.failAt }),
    ...(input.regenerateStale === undefined ? {} : { regenerateStale: input.regenerateStale })
  };
}

async function writeArchiveManifest(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: {
    chapterNumber: number;
    reason: string;
    oldStatus: string;
    newRegenerationRunId: string;
    invalidatedBy?: { chapterNumber: number; reportPath: string };
  }
): Promise<{ relativePath: string; manifest: ArchiveManifest }> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const archiveDirName = `history_edit_${timestamp}`;
  const archiveDir = paths.chapterArtifact(input.chapterNumber, 'archive', archiveDirName);
  const copiedArtifactsDir = path.join(archiveDir, 'copied_artifacts');
  await fileStore.ensureDir(archiveDir);
  await fileStore.ensureDir(copiedArtifactsDir);
  const existingArtifacts = await listExistingChapterArtifactFiles(paths, fileStore, input.chapterNumber);
  const copiedArtifacts: ArchivedArtifact[] = [];
  for (const artifact of existingArtifacts) {
    const archivedPath = path.join(
      'chapters',
      `chapter_${String(input.chapterNumber).padStart(3, '0')}`,
      'archive',
      archiveDirName,
      'copied_artifacts',
      artifact.relativeToChapter
    );
    const archivedAbsolutePath = paths.projectArtifact(archivedPath);
    await fileStore.ensureDir(path.dirname(archivedAbsolutePath));
    await copyFile(artifact.absolutePath, archivedAbsolutePath);
    const metadata = await readFileMetadata(archivedAbsolutePath, fileStore);
    copiedArtifacts.push({
      originalPath: artifact.projectRelativePath,
      archivedPath,
      artifactType: classifyArchivedArtifact(artifact.relativeToChapter),
      sha256: metadata.sha256,
      sizeBytes: metadata.sizeBytes
    });
  }
  const expectedArtifacts = expectedCoreArtifacts(input.chapterNumber);
  const copiedOriginals = new Set(copiedArtifacts.map((artifact) => artifact.originalPath));
  const missingArtifacts = expectedArtifacts.filter((artifact) => !copiedOriginals.has(artifact));
  const manifest: ArchiveManifest = ArchiveManifestSchema.parse({
    archiveId: `archive_chapter_${String(input.chapterNumber).padStart(3, '0')}_${archiveDirName}`,
    manifestId: `archive_manifest_ch${String(input.chapterNumber).padStart(3, '0')}_${archiveDirName}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    archiveReason: input.reason,
    reason: input.reason,
    ...(input.invalidatedBy === undefined ? {} : { invalidatedByChapter: input.invalidatedBy.chapterNumber }),
    ...(input.invalidatedBy === undefined ? {} : { invalidatedByReportPath: input.invalidatedBy.reportPath }),
    createdAt: new Date().toISOString(),
    sourceArtifactRoot: path.join('chapters', `chapter_${String(input.chapterNumber).padStart(3, '0')}`),
    copiedArtifacts,
    missingArtifacts,
    fileHashes: copiedArtifacts,
    oldStatus: input.oldStatus,
    newRegenerationRunId: input.newRegenerationRunId,
    notes: missingArtifacts.length === 0 ? [] : [`Missing ${missingArtifacts.length} expected artifact(s).`],
    oldArtifacts: copiedArtifacts.map((artifact) => artifact.originalPath),
    ...(input.invalidatedBy === undefined ? {} : { invalidationReportPath: input.invalidatedBy.reportPath })
  });
  await fileStore.writeJson(path.join(archiveDir, 'manifest.json'), manifest, ArchiveManifestSchema);
  return {
    relativePath: path.join('chapters', `chapter_${String(input.chapterNumber).padStart(3, '0')}`, 'archive', archiveDirName, 'manifest.json'),
    manifest
  };
}

async function listExistingChapterArtifactFiles(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number
): Promise<Array<{ absolutePath: string; projectRelativePath: string; relativeToChapter: string }>> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) {
    return [];
  }
  return listFilesRecursive(paths, fileStore, chapterDir, chapterDir, chapterNumber);
}

async function listFilesRecursive(
  paths: ProjectPaths,
  fileStore: FileStore,
  dir: string,
  chapterRoot: string,
  chapterNumber: number
): Promise<Array<{ absolutePath: string; projectRelativePath: string; relativeToChapter: string }>> {
  const files: Array<{ absolutePath: string; projectRelativePath: string; relativeToChapter: string }> = [];
  for (const entry of await fileStore.list(dir)) {
    if (dir === chapterRoot && entry === 'archive') {
      continue;
    }
    const absolutePath = path.join(dir, entry);
    const relativeToChapter = path.relative(chapterRoot, absolutePath);
    if (await isDirectory(fileStore, absolutePath)) {
      files.push(...(await listFilesRecursive(paths, fileStore, absolutePath, chapterRoot, chapterNumber)));
    } else {
      files.push({
        absolutePath,
        projectRelativePath: path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, relativeToChapter),
        relativeToChapter
      });
    }
  }
  return files;
}

async function isDirectory(fileStore: FileStore, targetPath: string): Promise<boolean> {
  try {
    await fileStore.list(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findInvalidationForStaleChapter(
  paths: ProjectPaths,
  fileStore: FileStore,
  staleChapterNumber: number
): Promise<{ chapterNumber: number; reportPath: string } | undefined> {
  if (!(await fileStore.exists(paths.chaptersDir()))) {
    return undefined;
  }
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    if (!/^chapter_\d{3}$/.test(chapterDirName)) {
      continue;
    }
    const chapterNumber = Number.parseInt(chapterDirName.slice('chapter_'.length), 10);
    const chapterDir = path.join(paths.chaptersDir(), chapterDirName);
    for (const fileName of await fileStore.list(chapterDir)) {
      if (/^downstream_invalidation_report_v\d+\.json$/.test(fileName)) {
        const reportPath = path.join('chapters', chapterDirName, fileName);
        const raw = JSON.parse(await fileStore.readText(paths.projectArtifact(reportPath))) as {
          invalidatedChapters?: Array<{ chapterNumber?: number }>;
        };
        if (raw.invalidatedChapters?.some((chapter) => chapter.chapterNumber === staleChapterNumber)) {
          return { chapterNumber, reportPath };
        }
      }
    }
  }
  return undefined;
}

async function writeReusePolicyReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: {
    chapterNumber: number;
    requestedPolicy: ReusePolicy;
    archiveManifest: ArchiveManifest;
  }
): Promise<{ path: string; report: ReusePolicyReport }> {
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'reuse_policy_report');
  const structureValid = false;
  const effectivePolicy =
    input.requestedPolicy === 'preserve_scene_structure_if_valid' && !structureValid ? 'reference_only' : input.requestedPolicy;
  const oldArtifactsReferenced =
    effectivePolicy === 'preserve_nothing'
      ? []
      : input.archiveManifest.copiedArtifacts
          .map((artifact) => artifact.originalPath)
          .filter((artifact) => artifact.endsWith('final.md') || artifact.endsWith('scene_cards.json'));
  const validityChecks = [
    {
      checkId: 'old_final_direct_reuse',
      passed: effectivePolicy === 'preserve_final_text_if_unaffected' ? false : false,
      message: 'Direct old final.md reuse is not allowed for stale_due_to_history_edit chapters.'
    },
    {
      checkId: 'scene_structure_validity_check',
      passed: structureValid,
      message: structureValid ? 'Old scene structure is compatible.' : 'Old scene structure may depend on invalidated history.'
    }
  ];
  const report: ReusePolicyReport = ReusePolicyReportSchema.parse({
    reportId: `reuse_policy_ch${String(input.chapterNumber).padStart(3, '0')}_v${artifact.version}`,
    projectId: paths.projectId,
    chapterNumber: input.chapterNumber,
    requestedPolicy: input.requestedPolicy,
    effectivePolicy,
    oldArtifactsReferenced,
    oldArtifactsCopiedToArchive: input.archiveManifest.copiedArtifacts.map((artifact) => artifact.archivedPath),
    validityChecks,
    ...(effectivePolicy === input.requestedPolicy ? {} : { downgradeReason: 'scene_structure_validity_check failed; downgraded to reference_only' }),
    generatedAt: new Date().toISOString()
  });
  const written = await fileStore.writeJson(artifact.absolutePath, report, ReusePolicyReportSchema);
  return { path: artifact.relativePath, report: written };
}

async function nextVersionedChapterArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string
): Promise<{ version: number; relativePath: string; absolutePath: string }> {
  for (let version = 1; version < 1000; version += 1) {
    const fileName = `${baseName}_v${version}.json`;
    const absolutePath = paths.chapterArtifact(chapterNumber, fileName);
    if (!(await fileStore.exists(absolutePath))) {
      return {
        version,
        relativePath: path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, fileName),
        absolutePath
      };
    }
  }
  throw new AppError('ARTIFACT_VERSION_EXHAUSTED', `Could not find available version for ${baseName}.`, 1);
}

function expectedCoreArtifacts(chapterNumber: number): string[] {
  const base = path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`);
  return [
    path.join(base, 'final.md'),
    path.join(base, 'canon_patch.json'),
    path.join(base, 'commit_report.json'),
    path.join(base, 'selected_plan.md'),
    path.join(base, 'scene_cards.json')
  ];
}

function classifyArchivedArtifact(relativeToChapter: string): string {
  const normalized = relativeToChapter.split(path.sep).join(path.posix.sep);
  if (normalized === 'final.md') return 'final';
  if (normalized === 'canon_patch.json') return 'canon_patch';
  if (normalized === 'commit_report.json') return 'commit_report';
  if (/^diagnostics_v\d+\.json$/.test(normalized)) return 'diagnostics';
  if (/^revision_plan_v\d+\.json$/.test(normalized)) return 'revision_plan';
  if (normalized === 'selected_plan.md') return 'selected_plan';
  if (normalized === 'scene_cards.json') return 'scene_cards';
  if (normalized.startsWith('scenes/')) return 'scene_draft';
  if (/^recommit_report_v\d+\.json$/.test(normalized)) return 'recommit_report';
  if (/^manual_review_report_v\d+\.json$/.test(normalized)) return 'manual_review_report';
  if (/^downstream_invalidation_report_v\d+\.json$/.test(normalized)) return 'downstream_invalidation_report';
  if (/^historical_recommit_report_v\d+\.json$/.test(normalized)) return 'historical_recommit_report';
  if (/^conflict_report_v\d+\.json$/.test(normalized)) return 'conflict_report';
  return 'chapter_artifact';
}

async function remainingStaleChapterNumbers(queueStore: ChapterQueueStore): Promise<number[]> {
  const queue = await queueStore.readQueue();
  return queue.chapters
    .filter((chapter) => chapter.status === 'stale_due_to_history_edit')
    .map((chapter) => chapter.chapterNumber)
    .sort((left, right) => left - right);
}

async function hasPlanningArtifacts(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  forceStage: ChapterQueueStage | undefined
): Promise<boolean> {
  if (forceStage !== undefined && PLANNING_STAGES.has(forceStage)) {
    return false;
  }

  try {
    await fileStore.readJson(paths.chapterArtifact(chapterNumber, 'mission.json'), ChapterMissionSchema);
    await fileStore.readJson(paths.chapterArtifact(chapterNumber, 'ranking.json'), ChapterPlanRankingSchema);
  } catch {
    return false;
  }

  return (
    (await fileStore.exists(paths.chapterArtifact(chapterNumber, 'ranking.json'))) &&
    (await fileStore.exists(paths.chapterArtifact(chapterNumber, 'selected_plan.md')))
  );
}

async function hasDraftArtifacts(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  forceStage: ChapterQueueStage | undefined
): Promise<boolean> {
  if (forceStage !== undefined && DRAFT_STAGES.has(forceStage)) {
    return false;
  }

  try {
    await fileStore.readJson(paths.chapterArtifact(chapterNumber, 'scene_cards.json'), SceneCardsSchema);
  } catch {
    return false;
  }

  return fileStore.exists(paths.chapterArtifact(chapterNumber, 'draft_v1.md'));
}

async function determineResumeStage(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<ChapterQueueStage> {
  if (!(await validJsonExists(fileStore, paths.chapterArtifact(chapterNumber, 'mission.json'), ChapterMissionSchema))) {
    return 'mission';
  }

  const candidateDir = paths.chapterArtifact(chapterNumber, 'plan_candidates');
  if (!(await fileStore.exists(candidateDir)) || (await fileStore.list(candidateDir)).filter((entry) => entry.endsWith('.md')).length === 0) {
    return 'plan_candidates';
  }

  if (
    !(await validJsonExists(fileStore, paths.chapterArtifact(chapterNumber, 'ranking.json'), ChapterPlanRankingSchema)) ||
    !(await fileStore.exists(paths.chapterArtifact(chapterNumber, 'selected_plan.md')))
  ) {
    return 'ranking';
  }

  const sceneCards = await readValidSceneCards(paths, fileStore, chapterNumber);
  if (sceneCards === undefined) {
    return 'scene_cards';
  }

  for (const sceneCard of sceneCards) {
    if (!(await fileStore.exists(paths.chapterArtifact(chapterNumber, 'scenes', `${sceneCard.sceneId}.md`)))) {
      return 'scene_drafts';
    }
  }

  if (!(await fileStore.exists(paths.chapterArtifact(chapterNumber, 'draft_v1.md')))) {
    return 'draft_assembly';
  }
  if (!(await fileStore.exists(paths.chapterArtifact(chapterNumber, 'final.md')))) {
    return 'diagnostics';
  }
  if (!(await validJsonExists(fileStore, paths.chapterArtifact(chapterNumber, 'canon_patch.json'), CanonPatchSchema))) {
    return 'canon_patch';
  }

  return 'commit';
}

async function validJsonExists<T>(fileStore: FileStore, filePath: string, schema: z.ZodType<T>): Promise<boolean> {
  if (!(await fileStore.exists(filePath))) {
    return false;
  }
  await fileStore.readJson(filePath, schema);
  return true;
}

async function readValidSceneCards(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number) {
  const filePath = paths.chapterArtifact(chapterNumber, 'scene_cards.json');
  if (!(await fileStore.exists(filePath))) {
    return undefined;
  }
  return fileStore.readJson(filePath, SceneCardsSchema);
}

async function readLatestConflictReport(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number) {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) {
    return undefined;
  }
  const conflictReportFiles = (await fileStore.list(chapterDir))
    .filter((entry) => /^conflict_report_v\d+\.json$/.test(entry))
    .sort((left, right) => versionFromFileName(right) - versionFromFileName(left));
  const latest = conflictReportFiles[0];
  if (latest === undefined) {
    return undefined;
  }
  const report = await fileStore.readJson(paths.chapterArtifact(chapterNumber, latest), ConflictReportSchema);
  return {
    path: pathJoinChapterArtifact(chapterNumber, latest),
    report
  };
}

function highestSeverity(severities: string[]): string {
  const order = ['low', 'medium', 'high', 'critical'];
  return severities.reduce((highest, severity) => (order.indexOf(severity) > order.indexOf(highest) ? severity : highest), 'low');
}

function versionFromFileName(fileName: string): number {
  const match = /_v(\d+)\.json$/.exec(fileName);
  return match === null ? 0 : Number.parseInt(match[1]!, 10);
}

function pathJoinChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, fileName);
}

function appendUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}
