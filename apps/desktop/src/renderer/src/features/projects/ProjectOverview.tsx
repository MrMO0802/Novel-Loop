import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';

import type { ChapterInspection } from '../../../../shared/chapterContract';
import type { ProjectSummary } from '../../../../shared/projectContract';
import { formatMessage, t } from '../../i18n/messages.zh-CN';

interface ProjectOverviewProps {
  onBack: () => void;
  onOpenChapterDraft: () => void;
  onPrepareChapter: () => void;
  onPrepareFoundation: () => void;
  onPreparePlanning: () => void;
  onResumeChapterDraft: () => void;
  onReviewChapterPlan: () => void;
  onReviewFoundation: () => void;
  onReviewPlanning: () => void;
  project: ProjectSummary;
}

type ChapterInspectionState =
  | { kind: 'not_needed' }
  | { kind: 'loading' }
  | { kind: 'loaded'; inspection: ChapterInspection }
  | { kind: 'failed' };

export function ProjectOverview({
  onBack,
  onOpenChapterDraft,
  onPrepareChapter,
  onPrepareFoundation,
  onPreparePlanning,
  onResumeChapterDraft,
  onReviewChapterPlan,
  onReviewFoundation,
  onReviewPlanning,
  project
}: ProjectOverviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestToken = useRef(0);
  const [chapterInspection, setChapterInspection] =
    useState<ChapterInspectionState>(
      project.globalPlanAvailable ? { kind: 'loading' } : { kind: 'not_needed' }
    );

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!project.globalPlanAvailable) {
      setChapterInspection({ kind: 'not_needed' });
      return;
    }
    setChapterInspection({ kind: 'loading' });
    const currentRequest = ++requestToken.current;
    void window.novelLoop.chapter.inspect({ projectKey: project.projectKey })
      .then((inspection) => {
        if (currentRequest === requestToken.current) {
          setChapterInspection({ kind: 'loaded', inspection });
        }
      })
      .catch(() => {
        if (currentRequest === requestToken.current) {
          setChapterInspection({ kind: 'failed' });
        }
      });
    return () => {
      requestToken.current += 1;
    };
  }, [project.globalPlanAvailable, project.projectKey]);

  const nextAction = project.globalPlanAvailable
    ? chapterInspection.kind === 'loading'
      ? {
        action: t('overview.chapter.inspectingAction'),
        disabled: true,
        note: t('overview.chapter.inspectingNote'),
        onClick: () => undefined,
        title: t('overview.chapter.inspectingTitle')
      }
      : chapterInspection.kind === 'loaded'
        ? chapterAction(chapterInspection.inspection, {
          onOpenChapterDraft,
          onPrepareChapter,
          onResumeChapterDraft,
          onReviewChapterPlan
        }) ?? planningReviewAction(onReviewPlanning)
        : planningReviewAction(onReviewPlanning)
    : project.storyBibleAvailable
      ? {
        action: t('overview.planningAction'),
        note: t('overview.planningActionNote'),
        onClick: onPreparePlanning,
        title: t('overview.planningActionTitle')
      }
      : {
        action: t('overview.nextAction'),
        note: t('overview.nextActionAvailable'),
        onClick: onPrepareFoundation,
        title: t('overview.nextActionTitle')
      };

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
            <h2 id="next-action-title">{nextAction.title}</h2>
            <p id="next-stage-note">{nextAction.note}</p>
          </div>
          <button
            aria-describedby="next-stage-note"
            className="nl-primary-action"
            disabled={'disabled' in nextAction && nextAction.disabled}
            onClick={nextAction.onClick}
            type="button"
          >
            {nextAction.action}
          </button>
        </section>
        {project.storyBibleAvailable && (
          <button
            className="nl-tertiary-action nl-overview__foundation-link"
            onClick={onReviewFoundation}
            type="button"
          >
            {t('overview.reviewAction')}
          </button>
        )}
      </div>
    </main>
  );
}

function planningReviewAction(onClick: () => void) {
  return {
    action: t('overview.planningReviewAction'),
    note: t('overview.planningReviewActionNote'),
    onClick,
    title: t('overview.planningReviewActionTitle')
  };
}

function chapterAction(
  inspection: ChapterInspection | null,
  actions: {
    onOpenChapterDraft: () => void;
    onPrepareChapter: () => void;
    onResumeChapterDraft: () => void;
    onReviewChapterPlan: () => void;
  }
) {
  if (!inspection?.available) return null;
  const chapter = inspection.chapterNumber;
  switch (inspection.phase) {
    case 'not_started':
      return {
        action: formatMessage('overview.chapter.createAction', { chapter }),
        note: t('overview.chapter.createNote'),
        onClick: actions.onPrepareChapter,
        title: formatMessage('overview.chapter.createTitle', { chapter })
      };
    case 'planning_partial':
      return {
        action: formatMessage('overview.chapter.resumePlanningAction', {
          chapter
        }),
        note: t('overview.chapter.resumePlanningNote'),
        onClick: actions.onPrepareChapter,
        title: formatMessage('overview.chapter.resumePlanningTitle', {
          chapter
        })
      };
    case 'plan_ready':
      return {
        action: formatMessage('overview.chapter.reviewPlanAction', { chapter }),
        note: t('overview.chapter.reviewPlanNote'),
        onClick: actions.onReviewChapterPlan,
        title: formatMessage('overview.chapter.reviewPlanTitle', { chapter })
      };
    case 'drafting_partial':
      return {
        action: formatMessage('overview.chapter.resumeDraftAction', { chapter }),
        note: t('overview.chapter.resumeDraftNote'),
        onClick: actions.onResumeChapterDraft,
        title: formatMessage('overview.chapter.resumeDraftTitle', { chapter })
      };
    case 'draft_ready':
      return {
        action: formatMessage('overview.chapter.openDraftAction', { chapter }),
        note: t('overview.chapter.openDraftNote'),
        onClick: actions.onOpenChapterDraft,
        title: formatMessage('overview.chapter.openDraftTitle', { chapter })
      };
  }
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
