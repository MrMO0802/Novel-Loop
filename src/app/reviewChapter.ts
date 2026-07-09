import path from 'node:path';
import type { z } from 'zod';

import {
  ChapterQueueSchema,
  CommitReportSchema,
  CodexPreviewCompletenessReportSchema,
  CodexPreviewFailureReportSchema,
  ConflictRepairReportSchema,
  ConflictReportSchema,
  DiagnosticsReportSchema,
  FailureReportSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type { ConflictSeverity } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface ReviewChapterInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  conflicts?: boolean;
  diagnostics?: boolean;
  state?: boolean;
  artifacts?: boolean;
  suggestNext?: boolean;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function reviewChapter(input: ReviewChapterInput, fileStore = new FileStore()): Promise<string> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const [queue, storyState] = await Promise.all([
    fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema),
    fileStore.readJson(paths.storyState(), StoryStateSchema)
  ]);
  const queueItem = queue.chapters.find((chapter) => chapter.chapterNumber === input.chapterNumber);
  const finalPath = relativeChapterArtifact(input.chapterNumber, 'final.md');
  const lines = [
    `Project: ${paths.projectId}`,
    `Chapter: ${input.chapterNumber}`,
    `Queue status: ${queueItem?.status ?? 'missing'}`,
    `Current stage: ${queueItem?.currentStage ?? 'none'}`,
    `Latest run: ${queueItem?.latestRunId ?? 'none'}`,
    `Final path: ${finalPath}`,
    `needs_human_review: ${String(queueItem?.status === 'needs_human_review')}`,
    `failureReason: ${queueItem?.failureReason ?? 'none'}`
  ];

  if (input.diagnostics === true) {
    lines.push('', 'Diagnostics');
    const diagnostics = await readLatestDiagnostics(paths, fileStore, input.chapterNumber);
    if (diagnostics === undefined) {
      lines.push('- none');
    } else {
      lines.push(`- path: ${diagnostics.path}`);
      lines.push(`- hard failures: ${diagnostics.hardFailures}`);
      lines.push(`- soft average: ${diagnostics.softAverage.toFixed(2)}`);
    }
  }

  if (input.conflicts === true) {
    lines.push('', 'Conflicts');
    const reports = await readReports(paths, fileStore, input.chapterNumber, 'conflict_report', ConflictReportSchema);
    if (reports.length === 0) {
      lines.push('- none');
    }
    for (const report of reports) {
      const highest = highestSeverity(report.value.conflicts.map((conflict) => conflict.severity));
      lines.push(`- ${report.path}: conflict count: ${report.value.conflicts.length}; highest severity: ${highest}; repairable: ${report.value.conflicts.every((conflict) => conflict.repairable)}`);
    }
  }

  if (input.artifacts === true) {
    lines.push('', 'Artifacts');
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'conflict_report', ConflictReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'conflict_repair_report', ConflictRepairReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'commit_report', CommitReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'failure_report', FailureReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'codex_preview_completeness_report', CodexPreviewCompletenessReportSchema);
    await appendArtifactList(lines, paths, fileStore, input.chapterNumber, 'codex_preview_failure_report', CodexPreviewFailureReportSchema);
    await appendPreviewCompleteness(lines, paths, fileStore, input.chapterNumber);
  }

  if (input.state === true) {
    lines.push('', 'State Summary');
    const openDebts = storyState.narrativeDebts.filter((debt) => debt.status === 'open' || debt.status === 'escalated' || debt.status === 'partially_paid');
    lines.push(`- latestCommittedChapter: ${storyState.latestCommittedChapter}`);
    lines.push(`- open narrative debts: ${openDebts.length}`);
    for (const debt of openDebts.slice(0, 5)) {
      lines.push(`  - ${debt.id} [${debt.status}] ${debt.readerQuestion}`);
    }
    lines.push(`- reader expectations: ${storyState.readerState.readerExpectations.length}`);
    for (const expectation of storyState.readerState.readerExpectations.slice(0, 5)) {
      lines.push(`  - ${expectation}`);
    }
  }

  if (input.suggestNext === true) {
    lines.push('', 'Suggested command:');
    lines.push(suggestNextCommand(paths.projectId, input.chapterNumber, queueItem?.status));
  }

  return `${lines.join('\n')}\n`;
}

async function readLatestDiagnostics(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number) {
  const reports = await readReports(paths, fileStore, chapterNumber, 'diagnostics', DiagnosticsReportSchema);
  const latest = reports.at(-1);
  if (latest === undefined) {
    return undefined;
  }
  const hardFailures = Object.values(latest.value.hard_checks).filter((check) => !check.passed).length;
  const softScores = Object.values(latest.value.soft_scores);
  const softAverage = softScores.reduce((sum, score) => sum + score, 0) / softScores.length;
  return {
    path: latest.path,
    hardFailures,
    softAverage
  };
}

async function appendArtifactList<T>(
  lines: string[],
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string,
  schema: z.ZodType<T>
): Promise<void> {
  const reports = await readReports(paths, fileStore, chapterNumber, baseName, schema);
  if (reports.length === 0) {
    lines.push(`- ${baseName}: none`);
    return;
  }
  for (const report of reports) {
    lines.push(`- ${report.path}`);
  }
}

async function readReports<T>(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string,
  schema: z.ZodType<T>
): Promise<Array<{ path: string; value: T }>> {
  const chapterDir = paths.chapterDir(chapterNumber);
  if (!(await fileStore.exists(chapterDir))) {
    return [];
  }
  const pattern = baseName === 'commit_report' || baseName === 'failure_report' ? new RegExp(`^${baseName}\\.json$`) : new RegExp(`^${baseName}_v\\d+\\.json$`);
  const entries = (await fileStore.list(chapterDir)).filter((entry) => pattern.test(entry));
  const reports: Array<{ path: string; value: T }> = [];
  for (const entry of entries) {
    reports.push({
      path: relativeChapterArtifact(chapterNumber, entry),
      value: await fileStore.readJson(paths.chapterArtifact(chapterNumber, entry), schema)
    });
  }
  return reports.sort((left, right) => left.path.localeCompare(right.path));
}

function suggestNextCommand(projectId: string, chapterNumber: number, status: string | undefined): string {
  if (status === 'blocked' || status === 'needs_human_review') {
    return `corepack pnpm novel-loop recommit ${projectId} ${chapterNumber} --from-final --confirm`;
  }
  return `corepack pnpm novel-loop review ${projectId} ${chapterNumber} --diagnostics --state --artifacts`;
}

async function appendPreviewCompleteness(lines: string[], paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<void> {
  const reports = await readReports(paths, fileStore, chapterNumber, 'codex_preview_completeness_report', CodexPreviewCompletenessReportSchema);
  const latest = reports.at(-1);
  if (latest === undefined) return;
  lines.push('', 'Preview completeness');
  lines.push(`- path: ${latest.path}`);
  lines.push(`- complete: ${String(latest.value.complete)}`);
  lines.push(`- blockingReasons: ${latest.value.blockingReasons.join(', ') || 'none'}`);
  lines.push(`- suggestedRetryCommand: ${latest.value.suggestedRetryCommand}`);
}

function highestSeverity(severities: ConflictSeverity[]): ConflictSeverity {
  const order: ConflictSeverity[] = ['low', 'medium', 'high', 'critical'];
  return severities.reduce<ConflictSeverity>((highest, severity) => (order.indexOf(severity) > order.indexOf(highest) ? severity : highest), 'low');
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, ...segments);
}
