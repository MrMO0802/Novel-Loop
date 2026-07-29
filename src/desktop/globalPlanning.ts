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
  kind: z.enum(['global_outline', 'volume_outline']),
  title: z.string().trim().min(1).max(160),
  markdown: z.string().refine(
    (value) => Buffer.byteLength(value, 'utf8') <= MAX_PLANNING_DOCUMENT_BYTES,
    { message: 'Planning Markdown exceeds the review size limit.' }
  )
}).strict();
const DesktopArcSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(240),
  type: z.enum(['plot', 'character', 'relationship', 'world', 'theme']),
  summary: z.string().trim().min(1).max(8_000),
  startChapter: z.number().int().positive().optional(),
  targetEndChapter: z.number().int().positive().optional(),
  relatedCharacters: z.array(z.string().trim().min(1).max(160)).max(100)
}).strict();
const DesktopChapterSchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  status: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(8_000),
  primaryFunction: z.string().trim().min(1).max(2_000)
}).strict();
const DesktopGlobalPlanningReviewSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(false) }).strict(),
  z.object({
    available: z.literal(true),
    documents: z.array(DesktopGlobalPlanningDocumentSchema).length(2).refine(
      (documents) => new Set(documents.map((document) => document.kind)).size === 2,
      { message: 'Planning review must contain one document of each kind.' }
    ),
    arcs: z.array(DesktopArcSchema).max(500).refine(
      (arcs) => new Set(arcs.map((arc) => arc.id)).size === arcs.length,
      { message: 'Planning review must not contain duplicate arcs.' }
    ),
    chapters: z.array(DesktopChapterSchema).max(2_000).refine(
      (chapters) => new Set(chapters.map((chapter) => chapter.chapterNumber)).size === chapters.length,
      { message: 'Planning review must not contain duplicate chapters.' }
    )
  }).strict().superRefine((review, context) => {
    if (Buffer.byteLength(JSON.stringify(review), 'utf8') > MAX_PLANNING_TOTAL_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Planning review exceeds the total payload size limit.'
      });
    }
  })
]);

export interface DesktopGlobalPlanningInput {
  projectRoot: string;
  onProgress?: (event: PlanGlobalProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
  resumeIncomplete?: boolean;
  replaceInvalidComplete?: boolean;
}

export interface ReadDesktopGlobalPlanningInput { projectRoot: string; }
export type DesktopGlobalPlanningReview = z.infer<typeof DesktopGlobalPlanningReviewSchema>;

export async function planDesktopGlobal(input: DesktopGlobalPlanningInput): Promise<{ artifactCount: 4; completed: true }> {
  const projectRoot = path.resolve(input.projectRoot);
  const projectId = ProjectIdSchema.parse(path.basename(projectRoot));
  if (input.replaceInvalidComplete === true) {
    await requireInvalidCompletePlanning(projectRoot);
  }
  const result = await planGlobal({
    projectId,
    projectsRoot: path.dirname(projectRoot),
    provider: 'codex-text',
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    ...(input.shouldStop === undefined ? {} : { shouldStop: input.shouldStop }),
    ...(input.resumeIncomplete === undefined ? {} : { resumeIncomplete: input.resumeIncomplete }),
    ...(input.replaceInvalidComplete === undefined
      ? {}
      : { replaceInvalidComplete: input.replaceInvalidComplete })
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

async function requireInvalidCompletePlanning(projectRoot: string): Promise<void> {
  try {
    const review = await readDesktopGlobalPlanning({ projectRoot });
    if (review.available) {
      throw new AppError(
        'ARTIFACT_ALREADY_EXISTS',
        'A valid complete global plan already exists.',
        2
      );
    }
    throw new AppError(
      'PLAN_GLOBAL_REPLACE_REQUIRES_COMPLETE',
      'Invalid planning replacement requires all four existing planning artifacts.',
      2
    );
  } catch (error) {
    if (error instanceof AppError
      && error.code === 'DESKTOP_GLOBAL_PLANNING_INVALID_OUTPUT') {
      return;
    }
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
