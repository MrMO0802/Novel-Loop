import path from 'node:path';

import { RunLogger } from '../logging/RunLogger.js';
import { TargetedRevisionOperationNormalizationSchema } from '../schemas/index.js';
import type { TargetedRevisionOperationNormalization } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';
import { sha256 } from './codexDiagnosticsEvidenceRules.js';
import { loadApprovedExpandedTargetRevisionSource } from './codexExpandedTargetRevisionExperiment.js';
import {
  normalizeTargetedRevisionOperations,
  renderTargetedRevisionOperationNormalization
} from './codexTargetedRevisionOperationNormalizer.js';

const DEFAULT_PROJECTS_ROOT = './projects';

export interface RunCodexTargetedRevisionContractCheckInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  inputPath: string;
  approval: string;
}

export interface RunCodexTargetedRevisionContractCheckResult {
  runId: string;
  report: TargetedRevisionOperationNormalization;
  reportPath: string;
  markdownPath: string;
  coveragePreflightPassed: boolean;
}

export async function runCodexTargetedRevisionContractCheck(
  input: RunCodexTargetedRevisionContractCheckInput,
  fileStore = new FileStore()
): Promise<RunCodexTargetedRevisionContractCheckResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const source = await loadApprovedExpandedTargetRevisionSource(paths, fileStore, input.chapterNumber, input.approval);
  const resolvedInputPath = resolveProjectInputPath(paths, input.inputPath);
  const rawProviderOutputPath = projectRelativePath(paths, resolvedInputPath);
  const rawText = await fileStore.readText(resolvedInputPath);
  const providerOutput: unknown = JSON.parse(rawText);
  const protectedBefore = await readProtected(paths, fileStore, input.chapterNumber);
  const version = await nextNormalizationVersion(paths, fileStore, input.chapterNumber);
  const reportPath = relativeChapterArtifact(input.chapterNumber, `targeted_revision_operation_normalization_v${version}.json`);
  const markdownPath = relativeChapterArtifact(input.chapterNumber, `targeted_revision_operation_normalization_v${version}.md`);
  const runId = createRunId(new Date(), `codex_targeted_revision_contract_check_ch${pad(input.chapterNumber)}`);
  const runLogger = new RunLogger(paths, fileStore);
  await runLogger.startRun({
    runId,
    command: 'codex targeted-revision-contract-check',
    args: {
      chapterNumber: input.chapterNumber,
      inputPath: rawProviderOutputPath,
      approvalRecordPath: source.approvalPath,
      coverageReportPath: source.coveragePath,
      codexInvoked: false,
      candidateGenerationAllowed: false,
      storyStateCommitAllowed: false,
      normalPreviewAllowed: false,
      queueMutationAllowed: false,
      canonicalPatchAllowed: false,
      snapshotAllowed: false
    }
  });

  try {
    const protectedArtifacts = await verifyProtected(paths, fileStore, protectedBefore);
    const result = normalizeTargetedRevisionOperations({
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      runId,
      mode: 'contract_check',
      generatedAt: new Date().toISOString(),
      rawProviderOutputPath,
      rawProviderOutputHash: sha256(rawText),
      approvalRecordPath: source.approvalPath,
      coverageReportPath: source.coveragePath,
      targetCoverageGraphPath: source.coverageGraphPath,
      targetCoverageGraphHash: sha256(source.coverageGraphText),
      providerOutput,
      approvedTargets: source.allowedTargets,
      coverageGraph: source.coverageGraph,
      protectedArtifacts,
      reportId: `targeted_revision_operation_normalization_ch${pad(input.chapterNumber)}_v${version}`,
      codexInvoked: false
    });
    await fileStore.writeJson(paths.projectArtifact(reportPath), result.report, TargetedRevisionOperationNormalizationSchema);
    await fileStore.writeText(paths.projectArtifact(markdownPath), renderTargetedRevisionOperationNormalization(result.report));
    await runLogger.recordArtifact(runId, reportPath, {
      action: 'generated',
      stage: 'revision',
      sourcePaths: [rawProviderOutputPath, source.approvalPath, source.coveragePath, source.coverageGraphPath],
      provenanceNote: 'Read-only targeted revision provider/canonical contract replay report'
    });
    await runLogger.recordArtifact(runId, markdownPath, {
      action: 'generated',
      stage: 'revision',
      sourcePaths: [reportPath]
    });
    if (result.failure !== undefined) {
      throw new AppError(result.failure.code, result.failure.message, 2);
    }
    if (!result.report.coveragePreflightPassed) {
      throw new AppError(
        'CODEX_TARGETED_REVISION_INCOMPLETE_TARGET_COVERAGE',
        result.report.warnings.join('; ') || 'Normalized operations do not cover every required approved target.',
        2
      );
    }
    await verifyProtected(paths, fileStore, protectedBefore);
    await runLogger.endRun(runId, 'success');
    return {
      runId,
      report: result.report,
      reportPath,
      markdownPath,
      coveragePreflightPassed: result.report.coveragePreflightPassed
    };
  } catch (error) {
    await verifyProtected(paths, fileStore, protectedBefore);
    await runLogger.recordError(runId, {
      code: error instanceof AppError ? error.code : 'CODEX_TARGETED_REVISION_OPERATION_CONTRACT_MISMATCH',
      message: getErrorMessage(error),
      recoverable: true
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

interface ProtectedContent {
  path: string;
  content: string;
  hash: string;
}

async function readProtected(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number
): Promise<ProtectedContent[]> {
  const relativePaths = [
    path.posix.join('state', 'story_state.json'),
    path.posix.join('planning', 'chapter_queue.json'),
    relativeChapterArtifact(chapterNumber, 'draft_v1.md')
  ];
  return Promise.all(relativePaths.map(async (relativePath) => {
    const content = await fileStore.readText(paths.projectArtifact(relativePath));
    return { path: relativePath, content, hash: sha256(content) };
  }));
}

async function verifyProtected(
  paths: ProjectPaths,
  fileStore: FileStore,
  before: ProtectedContent[]
): Promise<TargetedRevisionOperationNormalization['protectedArtifacts']> {
  return Promise.all(before.map(async (artifact) => {
    const current = await fileStore.readText(paths.projectArtifact(artifact.path));
    const currentHash = sha256(current);
    if (current !== artifact.content || currentHash !== artifact.hash) {
      throw new AppError(
        'CODEX_TARGETED_REVISION_OPERATION_CONTRACT_MISMATCH',
        `Contract replay modified protected artifact ${artifact.path}.`,
        2
      );
    }
    return {
      path: artifact.path,
      beforeSha256: artifact.hash,
      afterSha256: currentHash,
      unchanged: true as const
    };
  }));
}

async function nextNormalizationVersion(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<number> {
  const entries = await fileStore.list(paths.chapterDir(chapterNumber));
  return entries.reduce((latest, entry) => {
    const match = /^targeted_revision_operation_normalization_v(\d+)\.json$/.exec(entry);
    return match === null ? latest : Math.max(latest, Number.parseInt(match[1]!, 10));
  }, 0) + 1;
}

function resolveProjectInputPath(paths: ProjectPaths, requestedPath: string): string {
  const resolved = path.resolve(requestedPath);
  const projectRoot = path.resolve(paths.projectRoot);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('INVALID_CONTRACT_CHECK_INPUT', 'Contract replay input must be inside the selected project.', 2);
  }
  return resolved;
}

function projectRelativePath(paths: ProjectPaths, absolutePath: string): string {
  return path.relative(paths.projectRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.posix.join('chapters', `chapter_${pad(chapterNumber)}`, fileName);
}

function pad(value: number): string {
  return String(value).padStart(3, '0');
}
