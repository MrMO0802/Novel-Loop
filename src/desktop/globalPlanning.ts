import { lstat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { planGlobal, type PlanGlobalProgressEvent } from '../app/planGlobal.js';
import { ArcMapSchema, ChapterQueueSchema, ProjectIdSchema } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError } from '../utils/AppError.js';

const PLANNING_DOCUMENTS = [
  { kind: 'global_outline', title: 'Global Outline', artifact: 'planning/global_outline.md' },
  { kind: 'volume_outline', title: 'Volume 01 Outline', artifact: 'planning/volume_01_outline.md' }
] as const;
const PLANNING_JSON_ARTIFACTS = ['planning/arc_map.json', 'planning/chapter_queue.json'] as const;
const MAX_PLANNING_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_PLANNING_TOTAL_BYTES = 4 * 1024 * 1024;

const DesktopGlobalPlanningResultSchema = z.object({ artifactCount: z.literal(4), completed: z.literal(true) }).strict();
const DesktopGlobalPlanningDocumentSchema = z.object({
  kind: z.enum(['global_outline', 'volume_outline']), title: z.string().min(1), markdown: z.string()
}).strict();
const DesktopArcSchema = z.object({
  id: z.string(), name: z.string(), type: z.enum(['plot', 'character', 'relationship', 'world', 'theme']), summary: z.string(),
  startChapter: z.number().int().positive().optional(), targetEndChapter: z.number().int().positive().optional(), relatedCharacters: z.array(z.string())
}).strict();
const DesktopChapterSchema = z.object({
  chapterNumber: z.number().int().positive(), title: z.string(), status: z.string(), summary: z.string(), primaryFunction: z.string()
}).strict();
const DesktopGlobalPlanningReviewSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(false) }).strict(),
  z.object({ available: z.literal(true), documents: z.array(DesktopGlobalPlanningDocumentSchema).length(2), arcs: z.array(DesktopArcSchema), chapters: z.array(DesktopChapterSchema) }).strict()
]);

export interface DesktopGlobalPlanningInput {
  projectRoot: string;
  onProgress?: (event: PlanGlobalProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
  resumeIncomplete?: boolean;
}

export interface ReadDesktopGlobalPlanningInput { projectRoot: string; }
export type DesktopGlobalPlanningReview = z.infer<typeof DesktopGlobalPlanningReviewSchema>;

export async function planDesktopGlobal(input: DesktopGlobalPlanningInput): Promise<{ artifactCount: 4; completed: true }> {
  const projectRoot = path.resolve(input.projectRoot);
  const projectId = ProjectIdSchema.parse(path.basename(projectRoot));
  const result = await planGlobal({
    projectId,
    projectsRoot: path.dirname(projectRoot),
    provider: 'codex-text',
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    ...(input.shouldStop === undefined ? {} : { shouldStop: input.shouldStop }),
    ...(input.resumeIncomplete === undefined ? {} : { resumeIncomplete: input.resumeIncomplete })
  });
  const artifactCount = result.artifacts.filter((artifact) => [
    'planning/global_outline.md', 'planning/volume_01_outline.md', 'planning/arc_map.json', 'planning/chapter_queue.json'
  ].includes(artifact)).length;
  if (artifactCount !== 4) {
    throw new AppError('DESKTOP_GLOBAL_PLANNING_INCOMPLETE', 'Global planning did not produce all required artifacts.', 2);
  }
  return DesktopGlobalPlanningResultSchema.parse({ artifactCount: 4, completed: true });
}

export async function readDesktopGlobalPlanning(input: ReadDesktopGlobalPlanningInput): Promise<DesktopGlobalPlanningReview> {
  const projectRoot = path.resolve(input.projectRoot);
  const projectId = ProjectIdSchema.parse(path.basename(projectRoot));
  const paths = new ProjectPaths(path.dirname(projectRoot), projectId);
  const fileStore = new FileStore();
  const markdownPaths = PLANNING_DOCUMENTS.map((document) => paths.projectArtifact(document.artifact));
  const jsonPaths = PLANNING_JSON_ARTIFACTS.map((artifact) => paths.projectArtifact(artifact));
  const allPaths = [...markdownPaths, ...jsonPaths];
  const stats = await Promise.all(allPaths.map(readOptionalStat));
  if (stats.some((stat) => stat === undefined)) return DesktopGlobalPlanningReviewSchema.parse({ available: false });
  if (stats.some((stat) => !stat?.isFile())) throw invalidPlanningOutput('A global planning artifact is not a regular file.');
  const markdownStats = stats.slice(0, markdownPaths.length);
  if (markdownStats.some((stat) => (stat?.size ?? 0) > MAX_PLANNING_DOCUMENT_BYTES)
    || markdownStats.reduce((total, stat) => total + (stat?.size ?? 0), 0) > MAX_PLANNING_TOTAL_BYTES) {
    throw invalidPlanningOutput('Global planning Markdown exceeds the review size limit.');
  }
  try {
    const markdown = await Promise.all(markdownPaths.map((artifact) => fileStore.readText(artifact)));
    const byteSizes = markdown.map((value) => Buffer.byteLength(value, 'utf8'));
    if (byteSizes.some((size) => size > MAX_PLANNING_DOCUMENT_BYTES)
      || byteSizes.reduce((total, size) => total + size, 0) > MAX_PLANNING_TOTAL_BYTES) {
      throw invalidPlanningOutput('Global planning Markdown changed while it was being read.');
    }
    const [arcMap, chapterQueue] = await Promise.all([
      fileStore.readJson(paths.projectArtifact('planning/arc_map.json'), ArcMapSchema),
      fileStore.readJson(paths.projectArtifact('planning/chapter_queue.json'), ChapterQueueSchema)
    ]);
    return DesktopGlobalPlanningReviewSchema.parse({
      available: true,
      documents: PLANNING_DOCUMENTS.map((document, index) => ({ kind: document.kind, title: document.title, markdown: markdown[index] })),
      arcs: arcMap.arcs.map(({ id, name, type, summary, startChapter, targetEndChapter, relatedCharacters }) => ({ id, name, type, summary, startChapter, targetEndChapter, relatedCharacters })),
      chapters: chapterQueue.chapters.map(({ chapterNumber, title, status, summary, primaryFunction }) => ({ chapterNumber, title, status, summary, primaryFunction }))
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidPlanningOutput('A global planning JSON artifact is invalid.');
  }
}

async function readOptionalStat(filePath: string) {
  try { return await lstat(filePath); } catch (error) { if (isNotFoundError(error)) return undefined; throw error; }
}

function invalidPlanningOutput(message: string): AppError {
  return new AppError('DESKTOP_GLOBAL_PLANNING_INVALID_OUTPUT', message, 2);
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
