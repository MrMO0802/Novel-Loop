import { Info, Warning, WarningCircle, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export type NoticeTone = 'info' | 'warning' | 'danger';

const noticeIcons: Record<NoticeTone, Icon> = {
  info: Info,
  warning: Warning,
  danger: WarningCircle
};

export interface InlineNoticeProps {
  children: ReactNode;
  title?: string;
  tone?: NoticeTone;
}

export function InlineNotice({ children, title, tone = 'info' }: InlineNoticeProps) {
  const Icon = noticeIcons[tone];
  const role = tone === 'info' ? 'status' : 'alert';

  return (
    <div className={`nl-inline-notice nl-inline-notice--${tone}`} role={role}>
      <Icon aria-hidden="true" size={18} weight="regular" />
      <div className="nl-inline-notice__content">
        {title && <strong className="nl-inline-notice__title">{title}</strong>}
        {children}
      </div>
    </div>
  );
}
