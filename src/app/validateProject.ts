import path from 'node:path';

import { ZodError, type z } from 'zod';

import { ChapterQueueSchema, ConfigSchema, DownstreamInvalidationReportSchema, StoryStateSchema } from '../schemas/index.js';
import { validateChapterQueueConsistency } from './chapterQueue.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { getErrorMessage } from '../utils/AppError.js';

export interface ValidateProjectInput {
  projectId: string;
  projectsRoot?: string;
}

export interface ValidationCheck {
  name: string;
  ok: boolean;
  message?: string;
}

export interface ValidateProjectResult {
  projectId: string;
  projectRoot: string;
  ok: boolean;
  checks: ValidationCheck[];
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function validateProject(input: ValidateProjectInput, fileStore = new FileStore()): Promise<ValidateProjectResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const checks: ValidationCheck[] = [];

  checks.push(await checkExists(fileStore, 'project directory', paths.projectRoot));
  checks.push(await checkExists(fileStore, 'brief.md', paths.brief()));
  checks.push(await checkJson(fileStore, 'config.json', paths.config(), ConfigSchema));
  checks.push(await checkJson(fileStore, 'state/story_state.json', paths.storyState(), StoryStateSchema));
  checks.push(await checkExists(fileStore, 'strategy directory', paths.strategyDir()));
  checks.push(await checkExists(fileStore, 'planning directory', paths.planningDir()));
  checks.push(await checkExists(fileStore, 'chapters directory', paths.chaptersDir()));
  checks.push(await checkExists(fileStore, 'runs directory', paths.runsDir()));
  checks.push(await checkExists(fileStore, 'snapshots directory', paths.snapshotsDir()));
  checks.push(await checkExists(fileStore, 'diffs directory', paths.diffsDir()));
  const chapterQueuePath = paths.chapterQueue();
  if (await fileStore.exists(chapterQueuePath)) {
    checks.push(await checkJson(fileStore, 'planning/chapter_queue.json', chapterQueuePath, ChapterQueueSchema));
    checks.push(await checkChapterQueueConsistency(fileStore, paths));
    checks.push(await checkDownstreamInvalidationReports(fileStore, paths));
  }

  return {
    projectId: paths.projectId,
    projectRoot: paths.projectRoot,
    ok: checks.every((check) => check.ok),
    checks
  };
}

async function checkDownstreamInvalidationReports(fileStore: FileStore, paths: ProjectPaths): Promise<ValidationCheck> {
  try {
    const queue = await fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema);
    const staleChapters = queue.chapters.filter((chapter) => chapter.status === 'stale_due_to_history_edit');
    if (staleChapters.length === 0) {
      return { name: 'downstream invalidation reports', ok: true };
    }

    for (const chapter of queue.chapters) {
      const chapterDir = paths.chapterDir(chapter.chapterNumber);
      if (!(await fileStore.exists(chapterDir))) {
        continue;
      }
      for (const entry of await fileStore.list(chapterDir)) {
        if (!/^downstream_invalidation_report_v\d+\.json$/.test(entry)) {
          continue;
        }
        const report = await fileStore.readJson(path.join(chapterDir, entry), DownstreamInvalidationReportSchema);
        const reportedStale = new Set(report.invalidatedChapters.map((invalidated) => invalidated.chapterNumber));
        if (staleChapters.every((stale) => reportedStale.has(stale.chapterNumber))) {
          return { name: 'downstream invalidation reports', ok: true };
        }
      }
    }
    return {
      name: 'downstream invalidation reports',
      ok: false,
      message: 'Stale chapters require a downstream_invalidation_report_vN.json artifact.'
    };
  } catch (error) {
    return {
      name: 'downstream invalidation reports',
      ok: false,
      message: getErrorMessage(error)
    };
  }
}

async function checkChapterQueueConsistency(fileStore: FileStore, paths: ProjectPaths): Promise<ValidationCheck> {
  try {
    const [queue, storyState] = await Promise.all([
      fileStore.readJson(path.join(paths.planningDir(), 'chapter_queue.json'), ChapterQueueSchema),
      fileStore.readJson(paths.storyState(), StoryStateSchema)
    ]);
    const issues = validateChapterQueueConsistency(queue, storyState);
    return issues.length === 0
      ? { name: 'planning/chapter_queue.json consistency', ok: true }
      : { name: 'planning/chapter_queue.json consistency', ok: false, message: issues.join('; ') };
  } catch (error) {
    return {
      name: 'planning/chapter_queue.json consistency',
      ok: false,
      message: getErrorMessage(error)
    };
  }
}

async function checkExists(fileStore: FileStore, name: string, filePath: string): Promise<ValidationCheck> {
  const ok = await fileStore.exists(filePath);
  return ok ? { name, ok } : { name, ok, message: `Missing: ${filePath}` };
}

async function checkJson<T>(fileStore: FileStore, name: string, filePath: string, schema: z.ZodType<T>): Promise<ValidationCheck> {
  try {
    await fileStore.readJson(filePath, schema);
    return { name, ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        name,
        ok: false,
        message: error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
      };
    }

    return {
      name,
      ok: false,
      message: getErrorMessage(error)
    };
  }
}
