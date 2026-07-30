import path from 'node:path';

import { ChapterQueueSchema, StoryStateSchema } from '../schemas/index.js';
import type { ChapterQueue, ChapterQueueItem, ChapterQueueStage, ChapterQueueStatus, StoryState } from '../schemas/index.js';
import { RunLogger } from '../logging/RunLogger.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';

const RESUMABLE_STATUSES = new Set<ChapterQueueStatus>([
  'failed',
  'planning',
  'planned_ready',
  'drafting',
  'draft_ready',
  'diagnosing',
  'revision_required',
  'revising',
  'final_ready',
  'patch_extracted',
  'blocked',
  'conflict_detected',
  'conflict_repairing',
  'conflict_repaired',
  'under_review',
  'manually_edited',
  'recommit_ready',
  'recommitting'
]);

export class ChapterQueueStore {
  constructor(
    private readonly paths: ProjectPaths,
    private readonly fileStore = new FileStore()
  ) {}

  async exists(): Promise<boolean> {
    return this.fileStore.exists(this.queuePath());
  }

  async readQueue(): Promise<ChapterQueue> {
    return this.fileStore.readJson(this.queuePath(), ChapterQueueSchema);
  }

  async writeQueue(queue: ChapterQueue): Promise<ChapterQueue> {
    return this.fileStore.writeJson(this.queuePath(), queue, ChapterQueueSchema);
  }

  async getChapter(chapterNumber: number): Promise<ChapterQueueItem | undefined> {
    const queue = await this.readQueue();
    return queue.chapters.find((chapter) => chapter.chapterNumber === chapterNumber);
  }

  async getRequiredChapter(chapterNumber: number): Promise<ChapterQueueItem> {
    const chapter = await this.getChapter(chapterNumber);
    if (chapter === undefined) {
      throw new AppError('CHAPTER_QUEUE_ITEM_NOT_FOUND', `Chapter ${chapterNumber} is not present in chapter_queue.json.`, 2);
    }
    return chapter;
  }

  async markStageStart(
    chapterNumber: number,
    status: ChapterQueueStatus,
    currentStage: ChapterQueueStage,
    runId: string | undefined,
    expectedStatuses?: readonly ChapterQueueStatus[],
    expectedStages?: readonly ChapterQueueStage[]
  ): Promise<ChapterQueueItem> {
    return this.updateChapter(chapterNumber, (chapter, now) => ({
      ...chapter,
      status,
      currentStage,
      latestRunId: runId ?? chapter.latestRunId,
      startedAt: chapter.startedAt ?? now,
      updatedAt: now,
      failureReason: null
    }), expectedStatuses, expectedStages);
  }

  async markStageComplete(
    chapterNumber: number,
    status: ChapterQueueStatus,
    completedStage: ChapterQueueStage,
    runId: string | undefined,
    expectedStatuses?: readonly ChapterQueueStatus[],
    expectedStages?: readonly ChapterQueueStage[]
  ): Promise<ChapterQueueItem> {
    return this.updateChapter(chapterNumber, (chapter, now) => ({
      ...chapter,
      status,
      currentStage: completedStage,
      latestRunId: runId ?? chapter.latestRunId,
      updatedAt: now,
      completedStages: chapter.completedStages.includes(completedStage)
        ? chapter.completedStages
        : [...chapter.completedStages, completedStage]
    }), expectedStatuses, expectedStages);
  }

  async markFailed(
    chapterNumber: number,
    currentStage: ChapterQueueStage,
    runId: string | undefined,
    error: unknown,
    expectedStatuses?: readonly ChapterQueueStatus[],
    expectedStages?: readonly ChapterQueueStage[]
  ): Promise<ChapterQueueItem> {
    return this.updateChapter(chapterNumber, (chapter, now) => ({
      ...chapter,
      status: 'failed',
      currentStage,
      latestRunId: runId ?? chapter.latestRunId,
      updatedAt: now,
      failureReason: getErrorMessage(error)
    }), expectedStatuses, expectedStages);
  }

  async markNeedsHumanReview(chapterNumber: number, currentStage: ChapterQueueStage, runId: string | undefined): Promise<ChapterQueueItem> {
    return this.updateChapter(chapterNumber, (chapter, now) => ({
      ...chapter,
      status: 'needs_human_review',
      currentStage,
      latestRunId: runId ?? chapter.latestRunId,
      updatedAt: now
    }));
  }

  async markBlocked(
    chapterNumber: number,
    currentStage: ChapterQueueStage,
    runId: string | undefined,
    failureReason: string
  ): Promise<ChapterQueueItem> {
    return this.updateChapter(chapterNumber, (chapter, now) => ({
      ...chapter,
      status: 'blocked',
      currentStage,
      latestRunId: runId ?? chapter.latestRunId,
      updatedAt: now,
      failureReason
    }));
  }

  async markCommitted(chapterNumber: number, runId: string | undefined): Promise<ChapterQueueItem> {
    return this.updateChapter(chapterNumber, (chapter, now) => ({
      ...chapter,
      status: 'committed',
      currentStage: 'commit',
      latestRunId: runId ?? chapter.latestRunId,
      updatedAt: now,
      committedAt: now,
      failureReason: null,
      completedStages: chapter.completedStages.includes('commit') ? chapter.completedStages : [...chapter.completedStages, 'commit']
    }));
  }

  async markRecommitting(chapterNumber: number, runId: string | undefined): Promise<ChapterQueueItem> {
    return this.updateChapter(chapterNumber, (chapter, now) => ({
      ...chapter,
      status: 'recommitting',
      currentStage: 'commit',
      latestRunId: runId ?? chapter.latestRunId,
      updatedAt: now,
      failureReason: null
    }));
  }

  async markRecommitted(chapterNumber: number, runId: string | undefined): Promise<ChapterQueueItem> {
    return this.updateChapter(chapterNumber, (chapter, now) => ({
      ...chapter,
      status: 'recommitted',
      currentStage: 'commit',
      latestRunId: runId ?? chapter.latestRunId,
      updatedAt: now,
      committedAt: now,
      failureReason: null,
      completedStages: chapter.completedStages.includes('commit') ? chapter.completedStages : [...chapter.completedStages, 'commit']
    }));
  }

  async markDownstreamStale(
    editedChapterNumber: number,
    oldLatestCommittedChapter: number,
    failureReason: string,
    runId?: string
  ): Promise<ChapterQueueItem[]> {
    const queue = await this.readQueue();
    const now = new Date().toISOString();
    const updatedChapters: Array<{ before: ChapterQueueItem; after: ChapterQueueItem }> = [];
    const nextQueue: ChapterQueue = {
      ...queue,
      chapters: queue.chapters.map((chapter) => {
        if (chapter.chapterNumber <= editedChapterNumber || chapter.chapterNumber > oldLatestCommittedChapter) {
          return chapter;
        }
        const updated: ChapterQueueItem = {
          ...chapter,
          status: 'stale_due_to_history_edit',
          currentStage: 'none',
          updatedAt: now,
          failureReason
        };
        updatedChapters.push({ before: chapter, after: updated });
        return updated;
      })
    };
    await this.writeQueue(nextQueue);
    for (const transition of updatedChapters) {
      await this.recordTransition(transition.before, transition.after, runId, failureReason);
    }
    return updatedChapters.map((transition) => transition.after);
  }

  async findEarliestStaleChapter(): Promise<ChapterQueueItem | undefined> {
    const queue = await this.readQueue();
    return [...queue.chapters]
      .filter((chapter) => chapter.status === 'stale_due_to_history_edit')
      .sort((left, right) => left.chapterNumber - right.chapterNumber)[0];
  }

  async findResumeCandidate(): Promise<ChapterQueueItem | undefined> {
    const queue = await this.readQueue();
    return [...queue.chapters]
      .sort((left, right) => left.chapterNumber - right.chapterNumber)
      .find((chapter) => RESUMABLE_STATUSES.has(chapter.status));
  }

  async validateAgainstStoryState(): Promise<string[]> {
    const [queue, storyState] = await Promise.all([
      this.readQueue(),
      this.fileStore.readJson(this.paths.storyState(), StoryStateSchema)
    ]);
    return validateChapterQueueConsistency(queue, storyState);
  }

  private async updateChapter(
    chapterNumber: number,
    updater: (chapter: ChapterQueueItem, now: string) => ChapterQueueItem,
    expectedStatuses?: readonly ChapterQueueStatus[],
    expectedStages?: readonly ChapterQueueStage[]
  ): Promise<ChapterQueueItem> {
    const queue = await this.readQueue();
    const chapterIndex = queue.chapters.findIndex((chapter) => chapter.chapterNumber === chapterNumber);
    if (chapterIndex === -1) {
      throw new AppError('CHAPTER_QUEUE_ITEM_NOT_FOUND', `Chapter ${chapterNumber} is not present in chapter_queue.json.`, 2);
    }

    const beforeChapter = queue.chapters[chapterIndex]!;
    if (
      (expectedStatuses !== undefined && !expectedStatuses.includes(beforeChapter.status))
      || (expectedStages !== undefined && !expectedStages.includes(beforeChapter.currentStage))
    ) {
      throw new AppError(
        'CHAPTER_QUEUE_TRANSITION_INVALID',
        `Chapter ${chapterNumber} cannot transition from queue state ${beforeChapter.status}/${beforeChapter.currentStage}.`,
        2
      );
    }
    const updatedChapter = updater(beforeChapter, new Date().toISOString());
    const nextQueue: ChapterQueue = {
      ...queue,
      chapters: queue.chapters.map((chapter, index) => (index === chapterIndex ? updatedChapter : chapter))
    };
    const written = await this.writeQueue(nextQueue);
    await this.recordTransition(
      beforeChapter,
      written.chapters[chapterIndex]!,
      written.chapters[chapterIndex]!.latestRunId ?? undefined,
      transitionReason(beforeChapter, written.chapters[chapterIndex]!)
    );
    return written.chapters[chapterIndex]!;
  }

  private queuePath(): string {
    return path.join(this.paths.planningDir(), 'chapter_queue.json');
  }

  private async recordTransition(before: ChapterQueueItem, after: ChapterQueueItem, runId: string | undefined, reason: string): Promise<void> {
    if (runId === undefined || (before.status === after.status && before.currentStage === after.currentStage)) {
      return;
    }
    try {
      await new RunLogger(this.paths, this.fileStore).recordQueueTransition(runId, {
        chapterNumber: after.chapterNumber,
        beforeStatus: before.status,
        afterStatus: after.status,
        beforeStage: before.currentStage,
        afterStage: after.currentStage,
        reason,
        ...(relatedArtifactPath(after) === undefined ? {} : { relatedArtifactPath: relatedArtifactPath(after) })
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}

function transitionReason(before: ChapterQueueItem, after: ChapterQueueItem): string {
  if (after.status === 'committed') return 'chapter committed';
  if (after.status === 'recommitted') return 'chapter recommitted';
  if (before.currentStage !== after.currentStage) return `${after.currentStage} stage transition`;
  return `${before.status} -> ${after.status}`;
}

function relatedArtifactPath(chapter: ChapterQueueItem): string | undefined {
  if (chapter.status === 'committed' || chapter.status === 'recommitted') {
    return path.join('chapters', `chapter_${String(chapter.chapterNumber).padStart(3, '0')}`, 'commit_report.json');
  }
  return undefined;
}

export function validateChapterQueueConsistency(queue: ChapterQueue, storyState: StoryState): string[] {
  const issues: string[] = [];
  const acceptedCommittedStatuses = new Set<ChapterQueueStatus>(['committed', 'recommitted']);
  const chapterCounts = new Map<number, number>();
  const hasStale = queue.chapters.some((chapter) => chapter.status === 'stale_due_to_history_edit');
  const staleChapters = queue.chapters.filter((chapter) => chapter.status === 'stale_due_to_history_edit');
  const staleChapterNumbers = new Set(staleChapters.map((chapter) => chapter.chapterNumber));

  for (const chapter of queue.chapters) {
    chapterCounts.set(chapter.chapterNumber, (chapterCounts.get(chapter.chapterNumber) ?? 0) + 1);
    if (chapter.chapterNumber <= storyState.latestCommittedChapter && !acceptedCommittedStatuses.has(chapter.status)) {
      issues.push(
        `Chapter ${chapter.chapterNumber} is <= latestCommittedChapter ${storyState.latestCommittedChapter}, but queue status is ${chapter.status}.`
      );
    }
    if (chapter.chapterNumber <= storyState.latestCommittedChapter && chapter.status === 'stale_due_to_history_edit') {
      issues.push(`Chapter ${chapter.chapterNumber} is stale but is not downstream of latestCommittedChapter ${storyState.latestCommittedChapter}.`);
    }
    if (chapter.chapterNumber > storyState.latestCommittedChapter && acceptedCommittedStatuses.has(chapter.status)) {
      issues.push(
        `Chapter ${chapter.chapterNumber} is marked committed, but latestCommittedChapter is ${storyState.latestCommittedChapter}.`
      );
    }
  }

  for (const [chapterNumber, count] of chapterCounts) {
    if (count > 1) {
      issues.push(`Chapter queue contains ${count} entries for Chapter ${chapterNumber}.`);
    }
  }
  for (let chapterNumber = 1; chapterNumber <= storyState.latestCommittedChapter; chapterNumber += 1) {
    if (!chapterCounts.has(chapterNumber)) {
      issues.push(
        `Chapter ${chapterNumber} is missing from canonical queue history through latestCommittedChapter ${storyState.latestCommittedChapter}.`
      );
    }
  }
  const nextChapterNumber = storyState.latestCommittedChapter + 1;
  if (
    !chapterCounts.has(nextChapterNumber)
    && queue.chapters.some((chapter) => chapter.chapterNumber > nextChapterNumber)
  ) {
    issues.push(`Chapter queue has a gap before next Chapter ${nextChapterNumber}.`);
  }

  if (!hasStale) {
    for (const chapter of queue.chapters) {
      if (chapter.chapterNumber > storyState.latestCommittedChapter && (chapter.status === 'committed' || chapter.status === 'recommitted')) {
        issues.push(`Chapter ${chapter.chapterNumber} cannot be canonical without a downstream invalidation report.`);
      }
    }
  }

  for (const chapter of staleChapters) {
    if (chapter.chapterNumber <= storyState.latestCommittedChapter) {
      issues.push(`Stale chapter ${chapter.chapterNumber} must be greater than latestCommittedChapter ${storyState.latestCommittedChapter}.`);
    }
  }

  for (const fact of storyState.canonFacts) {
    if (staleChapterNumbers.has(fact.sourceChapter)) {
      issues.push(`Story State contains canon fact ${fact.id} from stale chapter ${fact.sourceChapter}.`);
    }
  }
  for (const event of storyState.timeline) {
    if (staleChapterNumbers.has(event.chapter)) {
      issues.push(`Story State contains timeline event ${event.id} from stale chapter ${event.chapter}.`);
    }
  }

  return issues;
}
