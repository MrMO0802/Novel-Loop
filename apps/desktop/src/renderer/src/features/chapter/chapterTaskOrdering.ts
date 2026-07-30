import type {
  ChapterTask,
  ChapterTaskStatus
} from '../../../../shared/chapterContract';

const ACTIVE_BEFORE_STOP = new Set<ChapterTaskStatus>(['queued', 'running']);
const TERMINAL = new Set<ChapterTaskStatus>([
  'succeeded',
  'failed',
  'cancelled'
]);

export function shouldAcceptChapterTask(
  current: ChapterTask | null,
  next: ChapterTask
): boolean {
  if (current === null) return true;
  if (current.taskId !== next.taskId) return false;
  if (TERMINAL.has(current.status)) return false;
  if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) return false;
  if (
    current.status === 'stop_requested'
    && ACTIVE_BEFORE_STOP.has(next.status)
  ) {
    return false;
  }
  return true;
}
