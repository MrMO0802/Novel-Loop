import path from 'node:path';

import { CanonPatchSchema, ChapterContextSummarySchema, StoryStateSchema } from '../schemas/index.js';
import type { CanonPatch, ChapterContextSummary, StoryState } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface GenerateChapterContextSummaryInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
}

export interface GenerateChapterContextSummaryResult {
  summary: ChapterContextSummary;
  jsonPath: string;
  markdownPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function generateChapterContextSummary(
  input: GenerateChapterContextSummaryInput,
  fileStore = new FileStore()
): Promise<GenerateChapterContextSummaryResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const finalPath = paths.chapterArtifact(input.chapterNumber, 'final.md');
  const finalText = (await fileStore.exists(finalPath)) ? await fileStore.readText(finalPath) : '';
  const patch = await readChapterPatch(paths, fileStore, input.chapterNumber);
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const title = titleFromFinal(finalText, input.chapterNumber);
  const summary = ChapterContextSummarySchema.parse({
    chapterNumber: input.chapterNumber,
    title,
    shortSummary: shortSummaryFrom(finalText, patch),
    keyEvents: keyEventsFrom(storyState, patch, input.chapterNumber),
    characterStateChanges: characterStateChangesFrom(patch),
    readerKnowledgeChanges: readerKnowledgeChangesFrom(patch),
    debtsAdvanced: patch.narrativeDebtUpdates.map((update) => `${update.debtId ?? 'new debt'}: ${update.action}`),
    foreshadowingAddedOrUpdated: patch.foreshadowingUpdates.map((update) => `${update.foreshadowingId ?? 'new foreshadowing'}: ${update.action}`),
    nextChapterHooks: nextChapterHooksFrom(finalText, patch),
    canonFactIds: storyState.canonFacts.filter((fact) => fact.sourceChapter === input.chapterNumber).map((fact) => fact.id),
    timelineEventIds: storyState.timeline.filter((event) => event.chapter === input.chapterNumber).map((event) => event.id),
    generatedAt: new Date().toISOString()
  });

  const jsonRelativePath = relativeChapterArtifact(input.chapterNumber, 'chapter_summary_for_context.json');
  const markdownRelativePath = relativeChapterArtifact(input.chapterNumber, 'chapter_summary_for_context.md');
  await fileStore.writeJson(paths.projectArtifact(jsonRelativePath), summary, ChapterContextSummarySchema);
  await fileStore.writeText(paths.projectArtifact(markdownRelativePath), renderSummaryMarkdown(summary));
  return {
    summary,
    jsonPath: jsonRelativePath,
    markdownPath: markdownRelativePath
  };
}

async function readChapterPatch(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<CanonPatch> {
  for (const fileName of ['canon_patch.json', 'canon_patch_codex_normalized_v1.json', 'canon_patch_codex_proposal_v1.json']) {
    const absolutePath = paths.chapterArtifact(chapterNumber, fileName);
    if (await fileStore.exists(absolutePath)) {
      return fileStore.readJson(absolutePath, CanonPatchSchema);
    }
  }
  return CanonPatchSchema.parse({
    chapterNumber,
    sourceFinalPath: relativeChapterArtifact(chapterNumber, 'final.md'),
    newFacts: [],
    characterStates: [],
    characterUpdates: [],
    timelineEvents: [],
    narrativeDebtUpdates: [],
    foreshadowingUpdates: [],
    readerStatePatch: {},
    relationshipUpdates: [],
    revealScheduleUpdates: []
  });
}

function titleFromFinal(finalText: string, chapterNumber: number): string {
  const match = /^#\s+(.+)$/m.exec(finalText);
  return match?.[1]?.trim() ?? `Chapter ${chapterNumber}`;
}

function shortSummaryFrom(finalText: string, patch: CanonPatch): string {
  const firstParagraph =
    finalText
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find((part) => part.length > 0 && !part.startsWith('#')) ?? '';
  const factSummary = patch.newFacts.map((fact) => fact.text).join(' ');
  return summarize(firstParagraph || factSummary || `Chapter ${patch.chapterNumber} committed.`);
}

function keyEventsFrom(storyState: StoryState, patch: CanonPatch, chapterNumber: number): string[] {
  const stateEvents = storyState.timeline.filter((event) => event.chapter === chapterNumber).map((event) => event.summary);
  const patchEvents = patch.timelineEvents.map((event) => event.summary);
  return unique([...stateEvents, ...patchEvents]).slice(0, 8);
}

function characterStateChangesFrom(patch: CanonPatch): string[] {
  return [
    ...patch.characterStates.map((character) => `${character.name}: ${character.currentGoal}; ${character.emotionalState}`),
    ...patch.characterUpdates.map((update) => `${update.characterId}.${update.field}: ${update.reason}`)
  ].slice(0, 8);
}

function readerKnowledgeChangesFrom(patch: CanonPatch): string[] {
  return unique([
    ...patch.readerStatePatch.addKnows,
    ...patch.readerStatePatch.addSuspects.map((item) => `suspects: ${item}`),
    ...patch.readerStatePatch.addQuestions.map((item) => `question: ${item}`),
    ...patch.readerStatePatch.addExpectations.map((item) => `expects: ${item}`)
  ]).slice(0, 10);
}

function nextChapterHooksFrom(finalText: string, patch: CanonPatch): string[] {
  const lastParagraph =
    finalText
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && !part.startsWith('#'))
      .at(-1) ?? '';
  return unique([
    ...(lastParagraph.length > 0 ? [summarize(lastParagraph, 220)] : []),
    ...patch.readerStatePatch.addQuestions,
    ...patch.readerStatePatch.addExpectations
  ]).slice(0, 6);
}

function renderSummaryMarkdown(summary: ChapterContextSummary): string {
  return [
    `# Chapter ${summary.chapterNumber} Context Summary`,
    '',
    `title: ${summary.title}`,
    `shortSummary: ${summary.shortSummary}`,
    '',
    '## Key Events',
    ...list(summary.keyEvents),
    '',
    '## Character State Changes',
    ...list(summary.characterStateChanges),
    '',
    '## Reader Knowledge Changes',
    ...list(summary.readerKnowledgeChanges),
    '',
    '## Next Chapter Hooks',
    ...list(summary.nextChapterHooks)
  ].join('\n') + '\n';
}

function list(values: string[]): string[] {
  return values.length === 0 ? ['- none'] : values.map((value) => `- ${value}`);
}

function summarize(text: string, maxLength = 500): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, ...segments);
}
