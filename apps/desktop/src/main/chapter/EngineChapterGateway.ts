import type {
  DesktopChapterDraftingInput,
  DesktopChapterPlanningInput
} from 'novel-loop-engine/desktop';

import {
  ChapterDraftReviewResultSchema,
  ChapterInspectionSchema,
  ChapterPlanReviewResultSchema,
  type ChapterDraftReviewResult,
  type ChapterInspection,
  type ChapterPlanReviewResult
} from '../../shared/chapterContract';

type PlanningProgressEvent = Parameters<
  NonNullable<DesktopChapterPlanningInput['onProgress']>
>[0];
type DraftingProgressEvent = Parameters<
  NonNullable<DesktopChapterDraftingInput['onProgress']>
>[0];

export type ChapterEngineProgressEvent =
  | PlanningProgressEvent
  | DraftingProgressEvent;

export interface RunChapterInput {
  projectRoot: string;
  onProgress(event: ChapterEngineProgressEvent): void;
  shouldStop(): boolean;
}

export interface ChapterEngineGateway {
  inspect(projectRoot: string): Promise<ChapterInspection>;
  plan(input: RunChapterInput): Promise<void>;
  draft(input: RunChapterInput): Promise<void>;
  readPlan(projectRoot: string): Promise<ChapterPlanReviewResult>;
  readDraft(projectRoot: string): Promise<ChapterDraftReviewResult>;
}

export class EngineChapterGateway implements ChapterEngineGateway {
  async inspect(projectRoot: string): Promise<ChapterInspection> {
    const { inspectDesktopNextChapter } = await import(
      'novel-loop-engine/desktop'
    );
    return ChapterInspectionSchema.parse(
      await inspectDesktopNextChapter({ projectRoot })
    );
  }

  async plan(input: RunChapterInput): Promise<void> {
    const { planDesktopNextChapter } = await import(
      'novel-loop-engine/desktop'
    );
    await planDesktopNextChapter({
      projectRoot: input.projectRoot,
      onProgress: input.onProgress,
      shouldStop: input.shouldStop
    });
  }

  async draft(input: RunChapterInput): Promise<void> {
    const { draftDesktopNextChapter } = await import(
      'novel-loop-engine/desktop'
    );
    await draftDesktopNextChapter({
      projectRoot: input.projectRoot,
      onProgress: input.onProgress,
      shouldStop: input.shouldStop
    });
  }

  async readPlan(projectRoot: string): Promise<ChapterPlanReviewResult> {
    const { readDesktopChapterPlan } = await import(
      'novel-loop-engine/desktop'
    );
    const review = await readDesktopChapterPlan({ projectRoot });
    return ChapterPlanReviewResultSchema.parse(
      review.available
        ? review
        : { available: false, reason: 'not_ready' }
    );
  }

  async readDraft(projectRoot: string): Promise<ChapterDraftReviewResult> {
    const { readDesktopChapterDraft } = await import(
      'novel-loop-engine/desktop'
    );
    const review = await readDesktopChapterDraft({ projectRoot });
    return ChapterDraftReviewResultSchema.parse(
      review.available
        ? review
        : { available: false, reason: 'not_ready' }
    );
  }
}
