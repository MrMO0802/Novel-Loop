export type ContentStatus =
  | 'draft'
  | 'revision_candidate'
  | 'accepted_draft'
  | 'commit_preview'
  | 'committed';

export type ChapterStatus =
  | 'planned'
  | 'drafting'
  | 'reviewing'
  | 'needs_review'
  | 'ready_to_confirm'
  | 'committed'
  | 'needs_recovery'
  | 'needs_refresh';

export type TaskStatus =
  | 'waiting'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'recoverable';

export interface ProjectSummary {
  id: string;
  title: string;
  currentChapter: number;
  currentChapterTitle: string;
  status: ChapterStatus;
  wordCount: number;
  updatedLabel: string;
  openMysteryCount: number;
  pendingReviewCount: number;
}
