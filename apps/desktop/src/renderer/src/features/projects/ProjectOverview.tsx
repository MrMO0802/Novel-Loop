import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import { useEffect, useRef, type ReactNode } from 'react';

import type { ProjectSummary } from '../../../../shared/projectContract';
import { formatMessage, t } from '../../i18n/messages.zh-CN';

interface ProjectOverviewProps {
  onBack: () => void;
  project: ProjectSummary;
}

export function ProjectOverview({
  onBack,
  project
}: ProjectOverviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="nl-project-shell">
      <header className="nl-project-header">
        <div className="nl-brand">
          <BookOpenText aria-hidden size={24} weight="fill" />
          <span>{t('app.brand')}</span>
        </div>
        <button className="nl-tertiary-action" onClick={onBack} type="button">
          <ArrowLeft aria-hidden size={17} />
          {t('overview.back')}
        </button>
      </header>

      <div className="nl-project-content nl-overview">
        <section className="nl-overview__intro" aria-labelledby="overview-title">
          <p className="nl-section-label">{t('overview.eyebrow')}</p>
          <h1
            className="nl-view-title"
            id="overview-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {project.title}
          </h1>
          <p className="nl-overview__excerpt">
            {project.briefExcerpt ?? t('overview.noExcerpt')}
          </p>
        </section>

        <section
          className="nl-overview__status"
          aria-labelledby="overview-status-title"
        >
          <h2 id="overview-status-title">{t('overview.statusTitle')}</h2>
          <dl>
            <OverviewRow
              label={t('overview.chapterLabel')}
              value={project.latestCommittedChapter === 0
                ? t('overview.chapterNone')
                : formatMessage('overview.chapterNumber', {
                  chapter: project.latestCommittedChapter
                })}
            />
            <OverviewRow
              icon={project.health === 'ready'
                ? <CheckCircle aria-hidden size={18} weight="fill" />
                : <WarningCircle aria-hidden size={18} weight="fill" />}
              label={t('overview.healthLabel')}
              tone={project.health === 'ready' ? 'ready' : 'attention'}
              value={project.health === 'ready'
                ? t('project.health.ready')
                : t('project.health.needsAttention')}
            />
            <OverviewRow
              icon={project.storyBibleAvailable
                ? <CheckCircle aria-hidden size={18} weight="fill" />
                : <WarningCircle aria-hidden size={18} />}
              label={t('overview.storyBibleLabel')}
              tone={project.storyBibleAvailable ? 'ready' : 'muted'}
              value={project.storyBibleAvailable
                ? t('overview.available')
                : t('overview.unavailable')}
            />
            <OverviewRow
              icon={project.globalPlanAvailable
                ? <CheckCircle aria-hidden size={18} weight="fill" />
                : <WarningCircle aria-hidden size={18} />}
              label={t('overview.globalPlanLabel')}
              tone={project.globalPlanAvailable ? 'ready' : 'muted'}
              value={project.globalPlanAvailable
                ? t('overview.available')
                : t('overview.unavailable')}
            />
          </dl>
        </section>

        <section
          className="nl-next-action"
          aria-labelledby="next-action-title"
        >
          <div>
            <p className="nl-section-label">
              {t('overview.nextActionLabel')}
            </p>
            <h2 id="next-action-title">{t('overview.nextActionTitle')}</h2>
            <p id="next-stage-note">{t('overview.nextActionUnavailable')}</p>
          </div>
          <button
            aria-describedby="next-stage-note"
            className="nl-primary-action"
            disabled
            type="button"
          >
            {t('overview.nextAction')}
          </button>
        </section>
      </div>
    </main>
  );
}

function OverviewRow({
  icon,
  label,
  tone,
  value
}: {
  icon?: ReactNode;
  label: string;
  tone?: 'attention' | 'muted' | 'ready';
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={tone ? `nl-overview-value--${tone}` : undefined}>
        {icon}
        <span>{value}</span>
      </dd>
    </div>
  );
}
