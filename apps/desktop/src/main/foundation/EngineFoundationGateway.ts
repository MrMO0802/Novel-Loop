import type { DesktopStoryBibleInput } from 'novel-loop-engine/desktop';

import {
  FoundationReviewResultSchema,
  type FoundationReviewResult
} from '../../shared/foundationContract';

export type BuildBibleProgressEvent = Parameters<
  NonNullable<DesktopStoryBibleInput['onProgress']>
>[0];
export type FoundationEngineProgressEvent = BuildBibleProgressEvent;

export interface FoundationEngineGateway {
  build(input: {
    projectRoot: string;
    resumeIncomplete: boolean;
    onProgress(event: BuildBibleProgressEvent): void;
    shouldStop(): boolean;
  }): Promise<void>;
  read(projectRoot: string): Promise<FoundationReviewResult>;
}

export class EngineFoundationGateway implements FoundationEngineGateway {
  async build(input: {
    projectRoot: string;
    resumeIncomplete: boolean;
    onProgress(event: BuildBibleProgressEvent): void;
    shouldStop(): boolean;
  }): Promise<void> {
    const { buildDesktopStoryBible } = await import('novel-loop-engine/desktop');
    await buildDesktopStoryBible({
      projectRoot: input.projectRoot,
      resumeIncomplete: input.resumeIncomplete,
      onProgress: input.onProgress,
      shouldStop: input.shouldStop
    });
  }

  async read(projectRoot: string): Promise<FoundationReviewResult> {
    const { readDesktopStoryBible } = await import('novel-loop-engine/desktop');
    const review = await readDesktopStoryBible({ projectRoot });
    return review.available
      ? FoundationReviewResultSchema.parse(review)
      : FoundationReviewResultSchema.parse({ available: false, reason: 'not_ready' });
  }
}
