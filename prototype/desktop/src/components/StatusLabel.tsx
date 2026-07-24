import {
  ArrowsClockwise,
  CalendarBlank,
  CheckCircle,
  CircleNotch,
  Clock,
  Eye,
  FileMagnifyingGlass,
  HourglassMedium,
  LockKey,
  PencilSimple,
  WarningCircle,
  XCircle,
  type Icon
} from '@phosphor-icons/react';
import type { ChapterStatus, ContentStatus, TaskStatus } from '../fixtures/types';

export type Status = ContentStatus | ChapterStatus | TaskStatus;
export type StatusMessageKey =
  | 'status.content.draft'
  | 'status.content.revision_candidate'
  | 'status.content.accepted_draft'
  | 'status.content.commit_preview'
  | 'status.committed'
  | 'status.chapter.planned'
  | 'status.chapter.drafting'
  | 'status.chapter.reviewing'
  | 'status.chapter.needs_review'
  | 'status.chapter.ready_to_confirm'
  | 'status.chapter.needs_recovery'
  | 'status.chapter.needs_refresh'
  | 'status.task.waiting'
  | 'status.task.running'
  | 'status.task.cancelling'
  | 'status.task.completed'
  | 'status.task.failed'
  | 'status.task.cancelled'
  | 'status.task.recoverable';

type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

type StatusDefinition = {
  defaultLabel: string;
  icon: Icon;
  messageKey: StatusMessageKey;
  tone: StatusTone;
};

const statusDefinitions: Record<Status, StatusDefinition> = {
  draft: { defaultLabel: '草稿', icon: PencilSimple, messageKey: 'status.content.draft', tone: 'neutral' },
  revision_candidate: { defaultLabel: '修订候选', icon: ArrowsClockwise, messageKey: 'status.content.revision_candidate', tone: 'accent' },
  accepted_draft: { defaultLabel: '已采纳草稿', icon: CheckCircle, messageKey: 'status.content.accepted_draft', tone: 'accent' },
  commit_preview: { defaultLabel: '待确认', icon: Eye, messageKey: 'status.content.commit_preview', tone: 'accent' },
  committed: { defaultLabel: '已提交', icon: LockKey, messageKey: 'status.committed', tone: 'success' },
  planned: { defaultLabel: '已规划', icon: CalendarBlank, messageKey: 'status.chapter.planned', tone: 'neutral' },
  drafting: { defaultLabel: '写作中', icon: PencilSimple, messageKey: 'status.chapter.drafting', tone: 'accent' },
  reviewing: { defaultLabel: '检查中', icon: FileMagnifyingGlass, messageKey: 'status.chapter.reviewing', tone: 'accent' },
  needs_review: { defaultLabel: '待审阅', icon: WarningCircle, messageKey: 'status.chapter.needs_review', tone: 'warning' },
  ready_to_confirm: { defaultLabel: '待确认', icon: Eye, messageKey: 'status.chapter.ready_to_confirm', tone: 'accent' },
  needs_recovery: { defaultLabel: '需要恢复', icon: WarningCircle, messageKey: 'status.chapter.needs_recovery', tone: 'danger' },
  needs_refresh: { defaultLabel: '需要重新生成', icon: ArrowsClockwise, messageKey: 'status.chapter.needs_refresh', tone: 'warning' },
  waiting: { defaultLabel: '等待中', icon: Clock, messageKey: 'status.task.waiting', tone: 'neutral' },
  running: { defaultLabel: '进行中', icon: CircleNotch, messageKey: 'status.task.running', tone: 'accent' },
  cancelling: { defaultLabel: '正在取消', icon: HourglassMedium, messageKey: 'status.task.cancelling', tone: 'warning' },
  completed: { defaultLabel: '已完成', icon: CheckCircle, messageKey: 'status.task.completed', tone: 'success' },
  failed: { defaultLabel: '未完成', icon: XCircle, messageKey: 'status.task.failed', tone: 'danger' },
  cancelled: { defaultLabel: '已取消', icon: XCircle, messageKey: 'status.task.cancelled', tone: 'neutral' },
  recoverable: { defaultLabel: '可恢复', icon: WarningCircle, messageKey: 'status.task.recoverable', tone: 'warning' }
};

export interface StatusLabelProps {
  status: Status;
}

export function getStatusMessageKey(status: Status): StatusMessageKey {
  return statusDefinitions[status].messageKey;
}

export function StatusLabel({ status }: StatusLabelProps) {
  const { defaultLabel, icon: Icon, tone } = statusDefinitions[status];

  return (
    <span className={`nl-status-label nl-status-label--${tone}`}>
      <Icon aria-hidden="true" size={16} weight="regular" />
      {defaultLabel}
    </span>
  );
}
