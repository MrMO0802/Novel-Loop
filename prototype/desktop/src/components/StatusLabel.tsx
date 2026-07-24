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
type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

type StatusDefinition = {
  icon: Icon;
  label: string;
  tone: StatusTone;
};

const statusDefinitions: Record<Status, StatusDefinition> = {
  draft: { icon: PencilSimple, label: '草稿', tone: 'neutral' },
  revision_candidate: { icon: ArrowsClockwise, label: '修订候选', tone: 'accent' },
  accepted_draft: { icon: CheckCircle, label: '已采纳草稿', tone: 'accent' },
  commit_preview: { icon: Eye, label: '待确认', tone: 'accent' },
  committed: { icon: LockKey, label: '已提交', tone: 'success' },
  planned: { icon: CalendarBlank, label: '已规划', tone: 'neutral' },
  drafting: { icon: PencilSimple, label: '写作中', tone: 'accent' },
  reviewing: { icon: FileMagnifyingGlass, label: '检查中', tone: 'accent' },
  needs_review: { icon: WarningCircle, label: '待审阅', tone: 'warning' },
  ready_to_confirm: { icon: Eye, label: '待确认', tone: 'accent' },
  needs_recovery: { icon: WarningCircle, label: '需要恢复', tone: 'danger' },
  needs_refresh: { icon: ArrowsClockwise, label: '需要重新生成', tone: 'warning' },
  waiting: { icon: Clock, label: '等待中', tone: 'neutral' },
  running: { icon: CircleNotch, label: '进行中', tone: 'accent' },
  cancelling: { icon: HourglassMedium, label: '正在取消', tone: 'warning' },
  completed: { icon: CheckCircle, label: '已完成', tone: 'success' },
  failed: { icon: XCircle, label: '未完成', tone: 'danger' },
  cancelled: { icon: XCircle, label: '已取消', tone: 'neutral' },
  recoverable: { icon: WarningCircle, label: '可恢复', tone: 'warning' }
};

export interface StatusLabelProps {
  status: Status;
}

export function StatusLabel({ status }: StatusLabelProps) {
  const { icon: Icon, label, tone } = statusDefinitions[status];

  return (
    <span className={`nl-status-label nl-status-label--${tone}`}>
      <Icon aria-hidden="true" size={16} weight="regular" />
      {label}
    </span>
  );
}
