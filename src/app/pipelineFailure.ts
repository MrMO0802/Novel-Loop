import type { ChapterQueueStage } from '../schemas/index.js';
import { AppError } from '../utils/AppError.js';

export type FailureInjectionPoint = ChapterQueueStage | 'write_scene_002' | 'extract_canon_patch';

export interface FailureInjectionInput {
  projectId?: string;
  chapterNumber?: number;
  failAt?: FailureInjectionPoint;
}

export function injectFailure(input: FailureInjectionInput, point: FailureInjectionPoint): void {
  if (input.failAt !== point) {
    return;
  }

  const suggestedProject = input.projectId ?? '<projectId>';
  throw new AppError('INJECTED_FAILURE', `Injected failure at ${point}.`, 1, {
    ...(input.chapterNumber === undefined ? {} : { chapterNumber: input.chapterNumber }),
    stage: point,
    suggestedNextCommand: `novel-loop chapter ${suggestedProject} next --provider mock --resume --commit`
  });
}
