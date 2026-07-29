import type { DesktopGlobalPlanningInput } from 'novel-loop-engine/desktop';

import {
  PlanningReviewResultSchema,
  type PlanningReviewResult
} from '../../shared/planningContract';

export type PlanningEngineProgressEvent = Parameters<
  NonNullable<DesktopGlobalPlanningInput['onProgress']>
>[0];

export interface PlanningEngineGateway {
  build(input: {
    projectRoot: string;
    resumeIncomplete: boolean;
    onProgress(event: PlanningEngineProgressEvent): void;
    shouldStop(): boolean;
  }): Promise<void>;
  read(projectRoot: string): Promise<PlanningReviewResult>;
}

export class EnginePlanningGateway implements PlanningEngineGateway {
  async build(input: {
    projectRoot: string;
    resumeIncomplete: boolean;
    onProgress(event: PlanningEngineProgressEvent): void;
    shouldStop(): boolean;
  }): Promise<void> {
    const { planDesktopGlobal } = await import('novel-loop-engine/desktop');
    await planDesktopGlobal({
      projectRoot: input.projectRoot,
      resumeIncomplete: input.resumeIncomplete,
      onProgress: input.onProgress,
      shouldStop: input.shouldStop
    });
  }

  async read(projectRoot: string): Promise<PlanningReviewResult> {
    const { readDesktopGlobalPlanning } = await import('novel-loop-engine/desktop');
    const review = await readDesktopGlobalPlanning({ projectRoot });
    return review.available
      ? PlanningReviewResultSchema.parse(review)
      : PlanningReviewResultSchema.parse({ available: false, reason: 'not_ready' });
  }
}
