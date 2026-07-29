import path from 'node:path';

import { initProjectFromBriefText } from '../app/initProject.js';
import { validateProject } from '../app/validateProject.js';
import { ConfigSchema, ProjectIdSchema, StoryStateSchema } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError } from '../utils/AppError.js';

export interface DesktopProjectBriefInput {
  title: string;
  coreIdea: string;
  genre?: string;
  protagonist?: string;
  worldPremise?: string;
}

export interface CreateDesktopProjectInput {
  projectId: string;
  projectsRoot: string;
  brief: DesktopProjectBriefInput;
}

export interface InspectDesktopProjectInput {
  projectRoot: string;
}

export type DesktopProjectInspection =
  | {
      valid: true;
      projectId: string;
      title: string;
      briefExcerpt: string | null;
      latestCommittedChapter: number;
      storyBibleAvailable: boolean;
      globalPlanAvailable: boolean;
    }
  | {
      valid: false;
      reason: 'invalid_project' | 'project_data_invalid';
    };

const MAX_TITLE_LENGTH = 160;
const MAX_BRIEF_EXCERPT_LENGTH = 320;
const STORY_BIBLE_ARTIFACTS = [
  'story_bible.md',
  'genre_contract.md',
  'reader_promise.md',
  'style_guide.md'
];
const GLOBAL_PLANNING_ARTIFACTS = [
  'global_outline.md',
  'volume_01_outline.md',
  'arc_map.json',
  'chapter_queue.json'
];

export function createDesktopBriefMarkdown(input: DesktopProjectBriefInput): string {
  const title = requireBriefField(input.title);
  const coreIdea = requireBriefField(input.coreIdea);
  const optionalSections = [
    ['类型', input.genre],
    ['主角', input.protagonist],
    ['世界观前提', input.worldPremise]
  ] as const;
  const lines = [`# ${title}`, '', '## 核心创意', '', coreIdea];

  for (const [heading, value] of optionalSections) {
    const content = value?.trim();
    if (content !== undefined && content.length > 0) {
      lines.push('', `## ${heading}`, '', content);
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function createDesktopProject(input: CreateDesktopProjectInput): Promise<void> {
  try {
    const projectId = parseProjectId(input.projectId);
    await initProjectFromBriefText({
      projectId,
      projectsRoot: input.projectsRoot,
      brief: createDesktopBriefMarkdown(input.brief)
    });
  } catch (error) {
    if (hasErrorCode(error, 'PROJECT_ALREADY_EXISTS')) {
      throw new AppError(
        'PROJECT_ALREADY_EXISTS',
        'Desktop project target already exists.',
        2
      );
    }
    throw new AppError('DESKTOP_PROJECT_CREATION_FAILED', 'Unable to create the desktop project.', 2);
  }
}

export async function inspectDesktopProject(input: InspectDesktopProjectInput): Promise<DesktopProjectInspection> {
  const projectRoot = path.resolve(input.projectRoot);
  const projectIdResult = ProjectIdSchema.safeParse(path.basename(projectRoot));
  if (!projectIdResult.success) {
    return { valid: false, reason: 'invalid_project' };
  }

  const paths = new ProjectPaths(path.dirname(projectRoot), projectIdResult.data);
  const fileStore = new FileStore();

  try {
    const config = await fileStore.readJson(paths.config(), ConfigSchema);
    if (config.projectId !== paths.projectId) {
      return { valid: false, reason: 'invalid_project' };
    }

    const validation = await validateProject({
      projectId: paths.projectId,
      projectsRoot: paths.projectsRoot
    }, fileStore);
    if (!validation.ok) {
      return { valid: false, reason: 'project_data_invalid' };
    }

    const [storyState, brief, storyBibleAvailable, globalPlanAvailable] = await Promise.all([
      fileStore.readJson(paths.storyState(), StoryStateSchema),
      fileStore.readText(paths.brief()),
      hasCompleteStoryBible(paths, fileStore),
      hasCompleteGlobalPlanning(paths, fileStore)
    ]);
    const { title, briefExcerpt } = extractBriefPreview(brief, paths.projectId);

    return {
      valid: true,
      projectId: paths.projectId,
      title,
      briefExcerpt,
      latestCommittedChapter: storyState.latestCommittedChapter,
      storyBibleAvailable,
      globalPlanAvailable
    };
  } catch {
    return { valid: false, reason: 'project_data_invalid' };
  }
}

async function hasCompleteStoryBible(paths: ProjectPaths, fileStore: FileStore): Promise<boolean> {
  return (await Promise.all(STORY_BIBLE_ARTIFACTS.map((artifact) => (
    fileStore.exists(path.join(paths.strategyDir(), artifact))
  )))).every(Boolean);
}

async function hasCompleteGlobalPlanning(
  paths: ProjectPaths,
  fileStore: FileStore
): Promise<boolean> {
  return (await Promise.all(GLOBAL_PLANNING_ARTIFACTS.map((artifact) => (
    fileStore.exists(path.join(paths.planningDir(), artifact))
  )))).every(Boolean);
}

function requireBriefField(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new AppError('DESKTOP_PROJECT_BRIEF_INVALID', 'Desktop project brief is incomplete.', 2);
  }
  return normalized;
}

function parseProjectId(projectId: string): string {
  const result = ProjectIdSchema.safeParse(projectId);
  if (!result.success) {
    throw new AppError('DESKTOP_PROJECT_ID_INVALID', 'Desktop project id is invalid.', 2);
  }
  return result.data;
}

function extractBriefPreview(brief: string, fallbackTitle: string): { title: string; briefExcerpt: string | null } {
  const lines = brief.split(/\r?\n/).map((line) => line.trim());
  const title = clamp(findHeadingContent(lines, 1) ?? fallbackTitle, MAX_TITLE_LENGTH) || fallbackTitle;
  const coreIdea = findSectionContent(lines, '核心创意');
  const firstParagraph = findFirstParagraph(lines);
  const excerpt = coreIdea ?? firstParagraph;

  return {
    title,
    briefExcerpt: excerpt === undefined ? null : clamp(excerpt, MAX_BRIEF_EXCERPT_LENGTH) || null
  };
}

function findHeadingContent(lines: string[], level: number): string | undefined {
  const prefix = `${'#'.repeat(level)} `;
  return lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() || undefined;
}

function findSectionContent(lines: string[], heading: string): string | undefined {
  const headingIndex = lines.findIndex((line) => line === `## ${heading}`);
  if (headingIndex < 0) {
    return undefined;
  }

  const content: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (line.startsWith('#')) {
      break;
    }
    if (line.length > 0) {
      content.push(line);
    }
  }
  return content.join(' ').trim() || undefined;
}

function findFirstParagraph(lines: string[]): string | undefined {
  return lines.find((line) => line.length > 0 && !line.startsWith('#'));
}

function clamp(value: string, limit: number): string {
  return value.slice(0, limit).trim();
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
