import path from 'node:path';

import { ChapterQueueSchema, DownstreamInvalidationReportSchema, StoryStateSchema } from '../schemas/index.js';
import type { DownstreamInvalidationReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface ListStaleChaptersInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber?: number;
  json?: boolean;
}

export interface StaleChapterSummary {
  chapterNumber: number;
  status: 'stale_due_to_history_edit';
  reason: string;
  invalidatedBy: string;
  artifactPath: string;
  oldCommitReportPath?: string;
  oldCanonPatchPath?: string;
  oldFinalPath?: string;
  suggestedRegenerationCommand: string;
}

export interface ListStaleChaptersResult {
  projectId: string;
  staleCount: number;
  staleChapters: StaleChapterSummary[];
  suggestedRegenerationCommand: string;
  output: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function listStaleChapters(input: ListStaleChaptersInput, fileStore = new FileStore()): Promise<ListStaleChaptersResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const [queue, storyState, invalidationReports] = await Promise.all([
    fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema),
    fileStore.readJson(paths.storyState(), StoryStateSchema),
    readInvalidationReports(paths, fileStore)
  ]);
  const suggestedRegenerationCommand = `corepack pnpm novel-loop chapter ${paths.projectId} next --provider mock --regenerate-stale --max-revisions 2 --commit`;
  const staleChapters = queue.chapters
    .filter((chapter) => chapter.status === 'stale_due_to_history_edit')
    .filter((chapter) => input.chapterNumber === undefined || chapter.chapterNumber === input.chapterNumber)
    .sort((left, right) => left.chapterNumber - right.chapterNumber)
    .map((chapter) => {
      const invalidation = findInvalidationForChapter(invalidationReports, chapter.chapterNumber);
      const invalidatedChapter = invalidation?.invalidatedChapters.find((candidate) => candidate.chapterNumber === chapter.chapterNumber);
      return {
        chapterNumber: chapter.chapterNumber,
        status: 'stale_due_to_history_edit' as const,
        reason: chapter.failureReason ?? invalidatedChapter?.invalidationReason ?? 'stale because of historical recommit',
        invalidatedBy:
          invalidation === undefined
            ? 'unknown'
            : `chapter ${invalidation.editedChapterNumber} historical recommit (${invalidation.reportId})`,
        artifactPath: chapter.artifactPath,
        ...(invalidatedChapter?.oldCommitReportPath === undefined ? {} : { oldCommitReportPath: invalidatedChapter.oldCommitReportPath }),
        ...(invalidatedChapter?.oldCanonPatchPath === undefined ? {} : { oldCanonPatchPath: invalidatedChapter.oldCanonPatchPath }),
        ...(invalidatedChapter?.oldFinalPath === undefined ? {} : { oldFinalPath: invalidatedChapter.oldFinalPath }),
        suggestedRegenerationCommand
      };
    });

  const result: Omit<ListStaleChaptersResult, 'output'> = {
    projectId: paths.projectId,
    staleCount: staleChapters.length,
    staleChapters,
    suggestedRegenerationCommand
  };
  const output = input.json === true ? `${JSON.stringify(result, null, 2)}\n` : renderText(result, storyState.latestCommittedChapter);
  return {
    ...result,
    output
  };
}

async function readInvalidationReports(paths: ProjectPaths, fileStore: FileStore): Promise<DownstreamInvalidationReport[]> {
  if (!(await fileStore.exists(paths.chaptersDir()))) {
    return [];
  }
  const reports: DownstreamInvalidationReport[] = [];
  for (const chapterDirName of await fileStore.list(paths.chaptersDir())) {
    if (!/^chapter_\d{3}$/.test(chapterDirName)) {
      continue;
    }
    const chapterDir = path.join(paths.chaptersDir(), chapterDirName);
    for (const fileName of await fileStore.list(chapterDir)) {
      if (!/^downstream_invalidation_report_v\d+\.json$/.test(fileName)) {
        continue;
      }
      reports.push(await fileStore.readJson(path.join(chapterDir, fileName), DownstreamInvalidationReportSchema));
    }
  }
  return reports.sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
}

function findInvalidationForChapter(
  reports: DownstreamInvalidationReport[],
  chapterNumber: number
): DownstreamInvalidationReport | undefined {
  return [...reports]
    .reverse()
    .find((report) => report.invalidatedChapters.some((chapter) => chapter.chapterNumber === chapterNumber));
}

function renderText(result: Omit<ListStaleChaptersResult, 'output'>, latestCommittedChapter: number): string {
  const lines = [
    `staleCount: ${result.staleCount}`,
    `latestCommittedChapter: ${latestCommittedChapter}`,
    `staleChapters: ${result.staleChapters.map((chapter) => chapter.chapterNumber).join(', ') || 'none'}`,
    `suggestedRegenerationCommand: ${result.suggestedRegenerationCommand}`
  ];
  for (const chapter of result.staleChapters) {
    lines.push(
      `- chapter ${chapter.chapterNumber}: ${chapter.reason}`,
      `  invalidatedBy: ${chapter.invalidatedBy}`,
      `  artifactPath: ${chapter.artifactPath}`,
      `  suggestedCommand: ${chapter.suggestedRegenerationCommand}`,
      `  regenerationPlanCommand: corepack pnpm novel-loop regeneration-plan ${result.projectId} --from ${chapter.chapterNumber}`
    );
  }
  return `${lines.join('\n')}\n`;
}
