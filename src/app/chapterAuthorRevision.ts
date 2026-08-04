import { createHash } from 'node:crypto';
import path from 'node:path';

import { withProjectChapterOperationLease } from './projectOperationLease.js';
import {
  AuthorRevisionRecordSchema,
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  DiagnosticsReportSchema,
  SceneCardsSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  AuthorArchivedArtifactReference,
  AuthorInvalidatedNode,
  AuthorRevisionArtifactKind,
  AuthorRevisionMode,
  AuthorRevisionRecord
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError } from '../utils/AppError.js';

const MAX_REVISION_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_AUTHOR_INSTRUCTION_CHARACTERS = 4_000;

const REVISION_FILE_PATTERN = /^(mission|plan|draft)_revision_v([1-9]\d*)\.json$/u;

const ARCHIVED_JSON_SCHEMAS = {
  'ranking.json': ChapterPlanRankingSchema,
  'scene_cards.json': SceneCardsSchema,
  'diagnostics_v1.json': DiagnosticsReportSchema
};

const ARCHIVE_ALLOWLIST: Record<AuthorInvalidatedNode, readonly string[]> = {
  plan_candidates: [
    'plan_candidates',
    'ranking.json',
    'selected_plan.md',
    'scene_cards.json',
    'scenes',
    'draft_v1.md',
    'diagnostics_v1.json'
  ],
  ranking: [
    'ranking.json',
    'selected_plan.md',
    'scene_cards.json',
    'scenes',
    'draft_v1.md',
    'diagnostics_v1.json'
  ],
  selected_plan: [
    'scene_cards.json',
    'scenes',
    'draft_v1.md',
    'diagnostics_v1.json'
  ],
  scene_cards: ['scenes', 'draft_v1.md', 'diagnostics_v1.json'],
  scene_drafts: ['draft_v1.md', 'diagnostics_v1.json'],
  draft: ['diagnostics_v1.json'],
  future_diagnostics: []
};

export interface CreateAuthorRevisionInput {
  projectRoot: string;
  chapterNumber: number;
  artifactKind: AuthorRevisionArtifactKind;
  mode: AuthorRevisionMode;
  sourceArtifactPath: string;
  sourceCandidateId: string | null;
  content: string;
  authorInstruction: string | null;
}

export interface CreateAuthorRevisionResult {
  record: AuthorRevisionRecord;
  relativeRecordPath: string;
  relativeMarkdownPath: string;
}

export interface AdoptAuthorRevisionInput {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  expectedSourceHash?: string;
  invalidationReportPath?: string;
  sourceArtifactPathOverride?: string;
}

export interface ReadAuthorRevisionInput {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  expectedSourceHash: string;
}

export interface ReadAuthorRevisionResult extends CreateAuthorRevisionResult {
  content: string;
}

export interface ArchiveInvalidatedChapterArtifactsInput {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  editedNode: AuthorInvalidatedNode;
}

export interface ArchiveInvalidatedChapterArtifactsResult {
  relativeArchiveDir: string;
  archivedArtifacts: AuthorArchivedArtifactReference[];
  missingArtifactPaths: string[];
}

export interface ArchiveAuthorChapterArtifactsInput {
  projectRoot: string;
  chapterNumber: number;
  archiveId: string;
  nodes: Array<Extract<
    AuthorInvalidatedNode,
    'selected_plan' | 'scene_cards' | 'scene_drafts' | 'draft'
  >>;
}

export interface ReadLatestAdoptedDraftInput {
  projectRoot: string;
  chapterNumber: number;
}

export interface LatestAdoptedDraft {
  record: AuthorRevisionRecord;
  relativeMarkdownPath: string;
  content: string;
}

interface RevisionEntry {
  fileName: string;
  absoluteRecordPath: string;
  relativeRecordPath: string;
  record: AuthorRevisionRecord;
}

interface ProjectContext {
  projectRoot: string;
  paths: ProjectPaths;
  store: FileStore;
  latestCommittedChapter: number;
}

export async function createAuthorRevision(
  input: CreateAuthorRevisionInput,
  fileStore?: FileStore
): Promise<CreateAuthorRevisionResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'chapter_author_revision_create',
    allowStoryStateWrite: false
  }, async () => {
    const context = await readProjectContext(projectRoot, input.chapterNumber, store);
    rejectCommittedChapter(input.chapterNumber, context.latestCommittedChapter);
    validateCreateInput(input);

    const sourcePath = resolveProjectPath(projectRoot, input.sourceArtifactPath);
    await assertSafePath(projectRoot, sourcePath);
    const sourceText = await store.readText(sourcePath);
    const revisionDir = context.paths.chapterArtifact(input.chapterNumber, 'author_revisions');
    await assertSafePath(projectRoot, revisionDir);
    await store.ensureDir(revisionDir);

    const version = await nextRevisionVersion(
      context,
      input.chapterNumber,
      input.artifactKind
    );
    const artifactLabel = revisionArtifactLabel(input.artifactKind);
    const markdownFileName = `${artifactLabel}_revision_v${version}.md`;
    const recordFileName = `${artifactLabel}_revision_v${version}.json`;
    const markdownPath = path.join(revisionDir, markdownFileName);
    const recordPath = path.join(revisionDir, recordFileName);
    const relativeMarkdownPath = toProjectRelativePath(projectRoot, markdownPath);
    const relativeRecordPath = toProjectRelativePath(projectRoot, recordPath);
    const record: AuthorRevisionRecord = AuthorRevisionRecordSchema.parse({
      schemaVersion: '1.0',
      revisionId: `author_revision_ch${String(input.chapterNumber).padStart(3, '0')}_${artifactLabel}_v${version}`,
      projectId: context.paths.projectId,
      chapterNumber: input.chapterNumber,
      artifactKind: input.artifactKind,
      mode: input.mode,
      sourceArtifactPath: toProjectRelativePath(projectRoot, sourcePath),
      sourceCandidateId: input.sourceCandidateId,
      sourceHash: sha256(sourceText),
      workingCopyPath: relativeMarkdownPath,
      workingCopyHash: sha256(input.content),
      state: 'ready',
      authorInstruction: input.authorInstruction,
      createdAt: new Date().toISOString(),
      adoptedAt: null,
      invalidationReportPath: null,
      storyStateMutated: false
    });

    await store.writeText(markdownPath, input.content);
    await store.writeJson(recordPath, record, AuthorRevisionRecordSchema);
    return { record, relativeRecordPath, relativeMarkdownPath };
  });
}

export async function adoptAuthorRevision(
  input: AdoptAuthorRevisionInput,
  fileStore?: FileStore
): Promise<AuthorRevisionRecord> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'chapter_author_revision_adopt',
    allowStoryStateWrite: false
  }, async () => {
    const context = await readProjectContext(projectRoot, input.chapterNumber, store);
    rejectCommittedChapter(input.chapterNumber, context.latestCommittedChapter);
    const revisions = await readRevisionEntries(context, input.chapterNumber);
    const target = revisions.find((entry) => entry.record.revisionId === input.revisionId);
    if (target === undefined) {
      throw new AppError('AUTHOR_REVISION_NOT_FOUND', `Author revision not found: ${input.revisionId}`, 2);
    }
    if (target.record.state !== 'ready' && target.record.state !== 'adopted') {
      throw new AppError('AUTHOR_REVISION_NOT_ADOPTABLE', `Author revision is not ready: ${input.revisionId}`, 2);
    }
    if (
      input.expectedSourceHash !== undefined
      && input.expectedSourceHash !== target.record.sourceHash
    ) {
      throw new AppError('AUTHOR_REVISION_SOURCE_STALE', `Source artifact hash does not match: ${input.revisionId}`, 2);
    }
    const sourceRecord = input.sourceArtifactPathOverride === undefined
      ? target.record
      : AuthorRevisionRecordSchema.parse({
          ...target.record,
          sourceArtifactPath: toProjectRelativePath(
            projectRoot,
            resolveProjectPath(projectRoot, input.sourceArtifactPathOverride)
          )
        });
    await readVerifiedSourceArtifact(projectRoot, store, sourceRecord);
    await readVerifiedWorkingCopy(projectRoot, store, target.record);

    for (const entry of revisions) {
      if (
        entry.record.revisionId !== target.record.revisionId
        && entry.record.artifactKind === target.record.artifactKind
        && entry.record.state === 'adopted'
      ) {
        await store.writeJson(entry.absoluteRecordPath, {
          ...entry.record,
          state: 'superseded'
        }, AuthorRevisionRecordSchema);
      }
    }

    if (target.record.state === 'adopted') return target.record;
    const adopted = AuthorRevisionRecordSchema.parse({
      ...sourceRecord,
      state: 'adopted',
      adoptedAt: new Date().toISOString(),
      invalidationReportPath: input.invalidationReportPath
        ?? target.record.invalidationReportPath
    });
    await store.writeJson(target.absoluteRecordPath, adopted, AuthorRevisionRecordSchema);
    return adopted;
  });
}

export async function readAuthorRevision(
  input: ReadAuthorRevisionInput,
  fileStore?: FileStore
): Promise<ReadAuthorRevisionResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'chapter_author_revision_read',
    allowStoryStateWrite: false
  }, async () => {
    const context = await readProjectContext(projectRoot, input.chapterNumber, store);
    rejectCommittedChapter(input.chapterNumber, context.latestCommittedChapter);
    const target = await findRevision(context, input.chapterNumber, input.revisionId);
    if (target.record.state !== 'ready' && target.record.state !== 'adopted') {
      throw new AppError('AUTHOR_REVISION_NOT_ADOPTABLE', `Author revision is not ready: ${input.revisionId}`, 2);
    }
    if (target.record.sourceHash !== input.expectedSourceHash) {
      throw new AppError('AUTHOR_REVISION_SOURCE_STALE', `Source artifact hash does not match: ${input.revisionId}`, 2);
    }
    await readVerifiedSourceArtifact(projectRoot, store, target.record);
    return {
      record: target.record,
      relativeRecordPath: target.relativeRecordPath,
      relativeMarkdownPath: target.record.workingCopyPath,
      content: await readVerifiedWorkingCopy(projectRoot, store, target.record)
    };
  });
}

export async function archiveAuthorChapterArtifacts(
  input: ArchiveAuthorChapterArtifactsInput,
  fileStore?: FileStore
): Promise<ArchiveInvalidatedChapterArtifactsResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'chapter_author_revision_archive',
    allowStoryStateWrite: false
  }, async () => {
    const context = await readProjectContext(projectRoot, input.chapterNumber, store);
    rejectCommittedChapter(input.chapterNumber, context.latestCommittedChapter);
    if (!/^[A-Za-z0-9_-]+$/u.test(input.archiveId)) {
      throw new AppError('AUTHOR_REVISION_ARCHIVE_ID_INVALID', 'Author archive ID is invalid.', 2);
    }
    const archiveDir = context.paths.chapterArtifact(
      input.chapterNumber,
      'author_revisions',
      'archive',
      input.archiveId
    );
    const chapterDir = context.paths.chapterDir(input.chapterNumber);
    const archivedArtifacts: AuthorArchivedArtifactReference[] = [];
    const missingArtifactPaths: string[] = [];

    await store.ensureDir(archiveDir);
    for (const node of input.nodes) {
      await archiveOptionalPath({
        projectRoot,
        store,
        chapterDir,
        archiveDir,
        sourcePath: path.join(chapterDir, archivePathForNode(node)),
        node,
        archivedArtifacts,
        missingArtifactPaths
      });
    }
    return {
      relativeArchiveDir: toProjectRelativePath(projectRoot, archiveDir),
      archivedArtifacts,
      missingArtifactPaths
    };
  });
}

export async function archiveInvalidatedChapterArtifacts(
  input: ArchiveInvalidatedChapterArtifactsInput,
  fileStore?: FileStore
): Promise<ArchiveInvalidatedChapterArtifactsResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);

  return withProjectChapterOperationLease({
    projectRoot,
    chapterNumber: input.chapterNumber,
    operation: 'chapter_author_revision_archive',
    allowStoryStateWrite: false
  }, async () => {
    const context = await readProjectContext(projectRoot, input.chapterNumber, store);
    rejectCommittedChapter(input.chapterNumber, context.latestCommittedChapter);
    const revision = await findRevision(context, input.chapterNumber, input.revisionId);
    const chapterDir = context.paths.chapterDir(input.chapterNumber);
    const archiveDir = context.paths.chapterArtifact(
      input.chapterNumber,
      'author_revisions',
      'archive',
      revision.record.revisionId
    );
    const archivedArtifacts: AuthorArchivedArtifactReference[] = [];
    const missingArtifactPaths: string[] = [];

    await store.ensureDir(archiveDir);
    for (const allowedPath of ARCHIVE_ALLOWLIST[input.editedNode]) {
      await archiveOptionalPath({
        projectRoot,
        store,
        chapterDir,
        archiveDir,
        sourcePath: path.join(chapterDir, allowedPath),
        node: archiveNodeForPath(input.editedNode, allowedPath),
        archivedArtifacts,
        missingArtifactPaths
      });
    }

    return {
      relativeArchiveDir: toProjectRelativePath(projectRoot, archiveDir),
      archivedArtifacts,
      missingArtifactPaths
    };
  });
}

export async function readLatestAdoptedDraft(
  input: ReadLatestAdoptedDraftInput,
  fileStore?: FileStore
): Promise<LatestAdoptedDraft | null> {
  const projectRoot = path.resolve(input.projectRoot);
  const store = fileStore ?? FileStore.forProject(projectRoot);
  await FileStore.forProject(projectRoot).assertSafePath(projectRoot);
  const context = await readProjectContext(projectRoot, input.chapterNumber, store);
  const drafts = (await readRevisionEntries(context, input.chapterNumber))
    .filter((entry) => entry.record.artifactKind === 'draft' && entry.record.state === 'adopted')
    .filter((entry) => entry.record.adoptedAt !== null)
    .sort((left, right) => right.record.adoptedAt!.localeCompare(left.record.adoptedAt!));
  const latest = drafts[0];
  if (latest === undefined) return null;

  return {
    record: latest.record,
    relativeMarkdownPath: latest.record.workingCopyPath,
    content: await readVerifiedWorkingCopy(projectRoot, store, latest.record)
  };
}

async function readProjectContext(
  projectRoot: string,
  chapterNumber: number,
  store: FileStore
): Promise<ProjectContext> {
  const storyStatePath = path.join(projectRoot, 'state', 'story_state.json');
  await assertSafePath(projectRoot, storyStatePath);
  const storyState = await store.readJson(storyStatePath, StoryStateSchema);
  const paths = new ProjectPaths(path.dirname(projectRoot), storyState.projectId);
  if (paths.projectRoot !== projectRoot) {
    throw new AppError('AUTHOR_REVISION_PROJECT_ROOT_INVALID', 'Project root does not match Story State project ID.', 2);
  }
  const queue = await store.readJson(paths.chapterQueue(), ChapterQueueSchema);
  const matchingChapters = queue.chapters.filter((chapter) => chapter.chapterNumber === chapterNumber);
  if (matchingChapters.length !== 1) {
    throw new AppError('AUTHOR_REVISION_CHAPTER_INVALID', `Chapter ${chapterNumber} is not a unique queue target.`, 2);
  }
  return { projectRoot, paths, store, latestCommittedChapter: storyState.latestCommittedChapter };
}

async function nextRevisionVersion(
  context: ProjectContext,
  chapterNumber: number,
  artifactKind: AuthorRevisionArtifactKind
): Promise<number> {
  const entries = await readRevisionEntries(context, chapterNumber);
  return entries
    .filter((entry) => entry.record.artifactKind === artifactKind)
    .reduce((highest, entry) => Math.max(highest, revisionVersion(entry.fileName)), 0) + 1;
}

async function findRevision(
  context: ProjectContext,
  chapterNumber: number,
  revisionId: string
): Promise<RevisionEntry> {
  const revision = (await readRevisionEntries(context, chapterNumber))
    .find((entry) => entry.record.revisionId === revisionId);
  if (revision === undefined) {
    throw new AppError('AUTHOR_REVISION_NOT_FOUND', `Author revision not found: ${revisionId}`, 2);
  }
  return revision;
}

async function readRevisionEntries(
  context: ProjectContext,
  chapterNumber: number
): Promise<RevisionEntry[]> {
  const revisionDir = context.paths.chapterArtifact(chapterNumber, 'author_revisions');
  if (!(await context.store.exists(revisionDir))) return [];
  const entries: RevisionEntry[] = [];
  for (const fileName of await context.store.list(revisionDir)) {
    const match = REVISION_FILE_PATTERN.exec(fileName);
    if (match === null) continue;
    const absoluteRecordPath = path.join(revisionDir, fileName);
    const record = await context.store.readJson(absoluteRecordPath, AuthorRevisionRecordSchema);
    const label = match[1]!;
    const version = Number(match[2]);
    const expectedKind = artifactKindForLabel(label);
    const expectedRevisionId = `author_revision_ch${String(chapterNumber).padStart(3, '0')}_${label}_v${version}`;
    const expectedMarkdownPath = toProjectRelativePath(
      context.projectRoot,
      path.join(revisionDir, `${label}_revision_v${version}.md`)
    );
    if (
      record.projectId !== context.paths.projectId
      || record.chapterNumber !== chapterNumber
      || record.artifactKind !== expectedKind
      || record.revisionId !== expectedRevisionId
      || record.workingCopyPath !== expectedMarkdownPath
    ) {
      throw new AppError('AUTHOR_REVISION_RECORD_INVALID', `Invalid author revision record: ${fileName}`, 2);
    }
    entries.push({
      fileName,
      absoluteRecordPath,
      relativeRecordPath: toProjectRelativePath(context.projectRoot, absoluteRecordPath),
      record
    });
  }
  return entries;
}

async function archiveOptionalPath(input: {
  projectRoot: string;
  store: FileStore;
  chapterDir: string;
  archiveDir: string;
  sourcePath: string;
  node: AuthorInvalidatedNode;
  archivedArtifacts: AuthorArchivedArtifactReference[];
  missingArtifactPaths: string[];
}): Promise<void> {
  if (!(await input.store.exists(input.sourcePath))) {
    input.missingArtifactPaths.push(toProjectRelativePath(input.projectRoot, input.sourcePath));
    return;
  }

  try {
    const children = await input.store.list(input.sourcePath);
    for (const child of children) {
      await archiveOptionalPath({
        ...input,
        sourcePath: path.join(input.sourcePath, child)
      });
    }
    return;
  } catch (error) {
    if (!hasCode(error, 'ENOTDIR')) throw error;
  }

  const content = await input.store.readText(input.sourcePath);
  validateArchivedJson(input.sourcePath, content);
  const relativeToChapter = path.relative(input.chapterDir, input.sourcePath);
  const archivedPath = path.join(input.archiveDir, relativeToChapter);
  await input.store.ensureDir(path.dirname(archivedPath));
  await input.store.writeText(archivedPath, content);
  input.archivedArtifacts.push({
    node: input.node,
    sourcePath: toProjectRelativePath(input.projectRoot, input.sourcePath),
    archivedPath: toProjectRelativePath(input.projectRoot, archivedPath),
    hash: sha256(content),
    byteSize: Buffer.byteLength(content, 'utf8')
  });
}

async function readVerifiedWorkingCopy(
  projectRoot: string,
  store: FileStore,
  record: AuthorRevisionRecord
): Promise<string> {
  const workingCopyPath = resolveProjectPath(projectRoot, record.workingCopyPath);
  await assertSafePath(projectRoot, workingCopyPath);
  const content = await store.readText(workingCopyPath);
  if (sha256(content) !== record.workingCopyHash) {
    throw new AppError('AUTHOR_REVISION_WORKING_COPY_INVALID', `Working copy hash does not match: ${record.revisionId}`, 2);
  }
  return content;
}

async function readVerifiedSourceArtifact(
  projectRoot: string,
  store: FileStore,
  record: AuthorRevisionRecord
): Promise<void> {
  const sourceArtifactPath = resolveProjectPath(projectRoot, record.sourceArtifactPath);
  await assertSafePath(projectRoot, sourceArtifactPath);
  const content = await store.readText(sourceArtifactPath);
  if (sha256(content) !== record.sourceHash) {
    throw new AppError('AUTHOR_REVISION_SOURCE_STALE', `Source artifact hash does not match: ${record.revisionId}`, 2);
  }
}

function validateCreateInput(input: CreateAuthorRevisionInput): void {
  if (!Number.isInteger(input.chapterNumber) || input.chapterNumber <= 0) {
    throw new AppError('AUTHOR_REVISION_CHAPTER_INVALID', 'Chapter number must be a positive integer.', 2);
  }
  if (Buffer.byteLength(input.content, 'utf8') > MAX_REVISION_MARKDOWN_BYTES) {
    throw new AppError('AUTHOR_REVISION_CONTENT_TOO_LARGE', 'Author revision Markdown exceeds 2 MiB.', 2);
  }
  if (
    input.authorInstruction !== null
    && Array.from(input.authorInstruction).length > MAX_AUTHOR_INSTRUCTION_CHARACTERS
  ) {
    throw new AppError('AUTHOR_REVISION_INSTRUCTION_TOO_LARGE', 'Author instruction exceeds 4,000 characters.', 2);
  }
  if ((input.artifactKind === 'selected_plan') !== (input.sourceCandidateId !== null)) {
    throw new AppError('AUTHOR_REVISION_SOURCE_CANDIDATE_INVALID', 'Only selected plan revisions require a source candidate.', 2);
  }
}

function rejectCommittedChapter(chapterNumber: number, latestCommittedChapter: number): void {
  if (chapterNumber <= latestCommittedChapter) {
    throw new AppError('AUTHOR_REVISION_COMMITTED_CHAPTER', `Cannot revise committed chapter ${chapterNumber}.`, 2);
  }
}

function resolveProjectPath(projectRoot: string, value: string): string {
  const resolved = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(projectRoot, value);
  return pathIsWithin(projectRoot, resolved)
    ? resolved
    : throwPathEscape(value);
}

function throwPathEscape(value: string): never {
  throw new AppError('AUTHOR_REVISION_PATH_ESCAPE', `Path escapes project root: ${value}`, 2);
}

async function assertSafePath(projectRoot: string, filePath: string): Promise<void> {
  if (!pathIsWithin(projectRoot, filePath)) throwPathEscape(filePath);
  await FileStore.forProject(projectRoot).assertSafePath(filePath);
}

function toProjectRelativePath(projectRoot: string, filePath: string): string {
  const relative = path.relative(projectRoot, path.resolve(filePath));
  if (relative === '' || !pathIsWithin(projectRoot, filePath)) throwPathEscape(filePath);
  return relative.split(path.sep).join('/');
}

function pathIsWithin(projectRoot: string, filePath: string): boolean {
  const relative = path.relative(projectRoot, path.resolve(filePath));
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function revisionArtifactLabel(artifactKind: AuthorRevisionArtifactKind): 'mission' | 'plan' | 'draft' {
  return artifactKind === 'selected_plan' ? 'plan' : artifactKind;
}

function artifactKindForLabel(label: string): AuthorRevisionArtifactKind {
  if (label === 'plan') return 'selected_plan';
  if (label === 'mission' || label === 'draft') return label;
  throw new AppError('AUTHOR_REVISION_RECORD_INVALID', `Unsupported revision label: ${label}`, 2);
}

function revisionVersion(fileName: string): number {
  const match = REVISION_FILE_PATTERN.exec(fileName);
  if (match === null) throw new AppError('AUTHOR_REVISION_RECORD_INVALID', `Invalid revision file name: ${fileName}`, 2);
  return Number(match[2]);
}

function archiveNodeForPath(editedNode: AuthorInvalidatedNode, allowedPath: string): AuthorInvalidatedNode {
  if (allowedPath === 'ranking.json') return 'ranking';
  if (allowedPath === 'selected_plan.md') return 'selected_plan';
  if (allowedPath === 'scene_cards.json') return 'scene_cards';
  if (allowedPath === 'scenes') return 'scene_drafts';
  if (allowedPath === 'draft_v1.md') return 'draft';
  if (allowedPath === 'diagnostics_v1.json') return 'future_diagnostics';
  return editedNode;
}

function archivePathForNode(
  node: ArchiveAuthorChapterArtifactsInput['nodes'][number]
): string {
  if (node === 'selected_plan') return 'selected_plan.md';
  if (node === 'scene_cards') return 'scene_cards.json';
  if (node === 'scene_drafts') return 'scenes';
  return 'draft_v1.md';
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function validateArchivedJson(filePath: string, content: string): void {
  if (path.extname(filePath) !== '.json') return;
  const fileName = path.basename(filePath) as keyof typeof ARCHIVED_JSON_SCHEMAS;
  const schema = ARCHIVED_JSON_SCHEMAS[fileName];
  if (schema === undefined) {
    throw new AppError('AUTHOR_REVISION_ARCHIVE_JSON_UNSUPPORTED', `No schema is registered for archived JSON: ${fileName}`, 2);
  }
  schema.parse(JSON.parse(content) as unknown);
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
