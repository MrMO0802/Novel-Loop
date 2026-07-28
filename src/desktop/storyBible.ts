import path from 'node:path';

import { z } from 'zod';

import { buildBible, type BuildBibleProgressEvent } from '../app/buildBible.js';
import { ProjectIdSchema } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError } from '../utils/AppError.js';

const FOUNDATION_DOCUMENTS = [
  {
    kind: 'story_bible',
    title: 'Story Bible',
    artifact: 'strategy/story_bible.md'
  },
  {
    kind: 'genre_contract',
    title: 'Genre Contract',
    artifact: 'strategy/genre_contract.md'
  },
  {
    kind: 'reader_promise',
    title: 'Reader Promise',
    artifact: 'strategy/reader_promise.md'
  },
  {
    kind: 'style_guide',
    title: 'Style Guide',
    artifact: 'strategy/style_guide.md'
  }
] as const;

const FOUNDATION_ARTIFACTS: readonly string[] = FOUNDATION_DOCUMENTS.map((document) => document.artifact);

const DesktopStoryBibleResultSchema = z.object({
  artifactCount: z.literal(4),
  completed: z.literal(true)
}).strict();

const DesktopStoryBibleDocumentSchema = z.object({
  kind: z.enum(['story_bible', 'genre_contract', 'reader_promise', 'style_guide']),
  title: z.string().min(1),
  markdown: z.string()
}).strict();

const DesktopStoryBibleReviewSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(false) }).strict(),
  z.object({
    available: z.literal(true),
    documents: z.array(DesktopStoryBibleDocumentSchema).length(4)
  }).strict()
]);

export interface DesktopStoryBibleInput {
  projectRoot: string;
  onProgress?: (event: BuildBibleProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
  resumeIncomplete?: boolean;
}

export interface DesktopStoryBibleResult {
  artifactCount: 4;
  completed: true;
}

export interface ReadDesktopStoryBibleInput {
  projectRoot: string;
}

export type DesktopStoryBibleDocument = z.infer<typeof DesktopStoryBibleDocumentSchema>;
export type DesktopStoryBibleReview = z.infer<typeof DesktopStoryBibleReviewSchema>;

export async function buildDesktopStoryBible(
  input: DesktopStoryBibleInput
): Promise<DesktopStoryBibleResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const projectId = ProjectIdSchema.parse(path.basename(projectRoot));
  const result = await buildBible({
    projectId,
    projectsRoot: path.dirname(projectRoot),
    provider: 'codex-text',
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    ...(input.shouldStop === undefined ? {} : { shouldStop: input.shouldStop }),
    ...(input.resumeIncomplete === undefined ? {} : { resumeIncomplete: input.resumeIncomplete })
  });
  const completedArtifactCount = result.artifacts
    .filter((artifact) => FOUNDATION_ARTIFACTS.includes(artifact))
    .length;
  if (completedArtifactCount !== 4) {
    throw new AppError(
      'DESKTOP_STORY_BIBLE_INCOMPLETE',
      'Story Foundation generation did not produce all required documents.',
      2
    );
  }
  return DesktopStoryBibleResultSchema.parse({
    artifactCount: 4,
    completed: true
  });
}

export async function readDesktopStoryBible(
  input: ReadDesktopStoryBibleInput
): Promise<DesktopStoryBibleReview> {
  const projectRoot = path.resolve(input.projectRoot);
  const projectId = ProjectIdSchema.parse(path.basename(projectRoot));
  const paths = new ProjectPaths(path.dirname(projectRoot), projectId);
  const fileStore = new FileStore();
  const artifactPaths = FOUNDATION_DOCUMENTS.map((document) => paths.projectArtifact(document.artifact));

  if (!(await Promise.all(artifactPaths.map((artifactPath) => fileStore.exists(artifactPath)))).every(Boolean)) {
    return DesktopStoryBibleReviewSchema.parse({ available: false });
  }

  const markdown = await Promise.all(artifactPaths.map((artifactPath) => fileStore.readText(artifactPath)));
  return DesktopStoryBibleReviewSchema.parse({
    available: true,
    documents: FOUNDATION_DOCUMENTS.map((document, index) => ({
      kind: document.kind,
      title: document.title,
      markdown: markdown[index]
    }))
  });
}
