import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { FolderOpen } from '@phosphor-icons/react/FolderOpen';
import { Plus } from '@phosphor-icons/react/Plus';
import { Trash } from '@phosphor-icons/react/Trash';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import type {
  ProjectLibraryResult,
  ProjectOpenResult,
  ProjectSummary
} from '../../../../shared/projectContract';
import {
  formatMessage,
  t,
  type MessageKey
} from '../../i18n/messages.zh-CN';

type LibraryView =
  | { kind: 'loading' }
  | { kind: 'loaded'; library: ProjectLibraryResult }
  | { kind: 'failed' };

interface ProjectLibraryProps {
  onBack: () => void;
  onCreate: () => void;
  onOpenProject: (project: ProjectSummary) => void;
}

export function ProjectLibrary({
  onBack,
  onCreate,
  onOpenProject
}: ProjectLibraryProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const [view, setView] = useState<LibraryView>({ kind: 'loading' });
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [removeCandidate, setRemoveCandidate] =
    useState<ProjectSummary | null>(null);

  const loadLibrary = useCallback(async () => {
    setView({ kind: 'loading' });
    setErrorKey(null);
    try {
      const library = await window.novelLoop.projects.list();
      if (mounted.current) {
        setView({ kind: 'loaded', library });
      }
    } catch {
      if (mounted.current) {
        setView({ kind: 'failed' });
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    headingRef.current?.focus();
    void loadLibrary();
    return () => {
      mounted.current = false;
    };
  }, [loadLibrary]);

  const handleOpenResult = (result: ProjectOpenResult) => {
    if (result.outcome === 'opened' || result.outcome === 'created') {
      onOpenProject(result.project);
      return;
    }
    const messageKey = projectOutcomeMessage(result.outcome);
    if (messageKey) {
      setErrorKey(messageKey);
    }
  };

  const openExisting = async () => {
    setPendingAction('open-existing');
    setErrorKey(null);
    try {
      handleOpenResult(await window.novelLoop.projects.openExisting());
    } catch {
      setErrorKey('project.error.failed');
    } finally {
      if (mounted.current) {
        setPendingAction(null);
      }
    }
  };

  const openRecent = async (projectKey: string) => {
    setPendingAction(`open:${projectKey}`);
    setErrorKey(null);
    try {
      handleOpenResult(await window.novelLoop.projects.open(projectKey));
    } catch {
      setErrorKey('project.error.failed');
    } finally {
      if (mounted.current) {
        setPendingAction(null);
      }
    }
  };

  const removeRecent = async () => {
    if (!removeCandidate || view.kind !== 'loaded') {
      return;
    }

    setPendingAction(`remove:${removeCandidate.projectKey}`);
    setErrorKey(null);
    try {
      const library = await window.novelLoop.projects.remove(
        removeCandidate.projectKey
      );
      if (mounted.current) {
        setView({ kind: 'loaded', library });
        setRemoveCandidate(null);
      }
    } catch {
      setErrorKey('project.error.failed');
    } finally {
      if (mounted.current) {
        setPendingAction(null);
      }
    }
  };

  const library = view.kind === 'loaded' ? view.library : null;
  const projects = useMemo(() => (
    library
      ? [...library.projects].sort((left, right) => (
        right.lastOpenedAt.localeCompare(left.lastOpenedAt)
      ))
      : []
  ), [library]);

  return (
    <main className="nl-project-shell">
      <ProjectHeader onBack={onBack} />
      <div className="nl-project-content">
        <section className="nl-library-heading" aria-labelledby="library-title">
          <div>
            <p className="nl-section-label">{t('library.eyebrow')}</p>
            <h1
              className="nl-view-title"
              id="library-title"
              ref={headingRef}
              tabIndex={-1}
            >
              {t('library.title')}
            </h1>
            {library && (
              <p className="nl-library-location">
                {library.defaultLocation.configured
                  && library.defaultLocation.locationLabel
                  ? formatMessage('library.location.configured', {
                    location: library.defaultLocation.locationLabel
                  })
                  : t('library.location.unconfigured')}
              </p>
            )}
          </div>
          {view.kind === 'loaded' && (
            <div className="nl-library-commands">
              <button
                className="nl-primary-action"
                disabled={pendingAction !== null}
                onClick={onCreate}
                type="button"
              >
                <Plus aria-hidden size={18} weight="bold" />
                {t('library.create')}
              </button>
              <button
                className="nl-secondary-action"
                disabled={pendingAction !== null}
                onClick={() => void openExisting()}
                type="button"
              >
                <FolderOpen aria-hidden size={18} />
                {pendingAction === 'open-existing'
                  ? t('library.opening')
                  : t('library.openExisting')}
              </button>
            </div>
          )}
        </section>

        {view.kind === 'loading' && (
          <section className="nl-library-state" role="status">
            <CircleNotch aria-hidden className="nl-spin" size={28} />
            <p>{t('library.loading')}</p>
          </section>
        )}

        {view.kind === 'failed' && (
          <section className="nl-library-state nl-library-state--error">
            <WarningCircle aria-hidden size={28} weight="fill" />
            <p role="alert">{t('library.loadFailed')}</p>
            <button
              className="nl-secondary-action"
              onClick={() => void loadLibrary()}
              type="button"
            >
              {t('library.retry')}
            </button>
          </section>
        )}

        {library?.warning === 'registry_unavailable' && (
          <p className="nl-inline-alert nl-inline-alert--warning" role="alert">
            <WarningCircle aria-hidden size={20} weight="fill" />
            {t('library.registryWarning')}
          </p>
        )}

        {errorKey && (
          <p className="nl-inline-alert nl-inline-alert--error" role="alert">
            <WarningCircle aria-hidden size={20} weight="fill" />
            {t(errorKey)}
          </p>
        )}

        {view.kind === 'loaded' && projects.length === 0 && (
          <section
            className="nl-library-empty-state"
            aria-labelledby="empty-library-title"
          >
            <BookOpenText aria-hidden size={32} />
            <h2 id="empty-library-title">{t('library.emptyTitle')}</h2>
            <p>{t('library.emptyBody')}</p>
          </section>
        )}

        {view.kind === 'loaded' && projects.length > 0 && (
          <section
            className="nl-recent-projects"
            aria-labelledby="recent-projects-title"
          >
            <div className="nl-recent-projects__heading">
              <h2 id="recent-projects-title">{t('library.recent.title')}</h2>
              <p>{formatMessage('library.recent.count', {
                count: projects.length
              })}</p>
            </div>
            <ul aria-label={t('library.recent.ariaLabel')}>
              {projects.map((project) => (
                <ProjectItem
                  isPending={pendingAction === `open:${project.projectKey}`}
                  key={project.projectKey}
                  onOpen={() => void openRecent(project.projectKey)}
                  onRemove={() => setRemoveCandidate(project)}
                  project={project}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      {removeCandidate && (
        <RemoveProjectDialog
          isPending={
            pendingAction === `remove:${removeCandidate.projectKey}`
          }
          onCancel={() => setRemoveCandidate(null)}
          onConfirm={() => void removeRecent()}
          project={removeCandidate}
        />
      )}
    </main>
  );
}

function ProjectHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="nl-project-header">
      <div className="nl-brand">
        <BookOpenText aria-hidden size={24} weight="fill" />
        <span>{t('app.brand')}</span>
      </div>
      <button className="nl-tertiary-action" onClick={onBack} type="button">
        <ArrowLeft aria-hidden size={17} />
        {t('library.back')}
      </button>
    </header>
  );
}

function ProjectItem({
  isPending,
  onOpen,
  onRemove,
  project
}: {
  isPending: boolean;
  onOpen: () => void;
  onRemove: () => void;
  project: ProjectSummary;
}) {
  const openLabel = formatMessage('library.project.open', {
    title: project.title
  });
  const removeLabel = formatMessage('library.project.remove', {
    title: project.title
  });

  return (
    <li className="nl-project-item">
      <div className="nl-project-item__body">
        <div className="nl-project-item__title">
          <h2>{project.title}</h2>
          <ProjectHealth health={project.health} />
        </div>
        {project.briefExcerpt && (
          <p className="nl-project-item__excerpt">{project.briefExcerpt}</p>
        )}
        <div className="nl-project-item__metadata">
          <span>{chapterLabel(project.latestCommittedChapter)}</span>
          <span>{formatMessage('library.project.lastOpened', {
            date: formatLastOpened(project.lastOpenedAt)
          })}</span>
          <span>{formatMessage('library.project.location', {
            location: project.locationLabel
          })}</span>
        </div>
      </div>
      <div className="nl-project-item__actions">
        <button
          className="nl-secondary-action"
          disabled={isPending}
          onClick={onOpen}
          type="button"
        >
          <FolderOpen aria-hidden size={17} />
          {isPending ? t('library.opening') : openLabel}
        </button>
        <button
          aria-label={removeLabel}
          className="nl-icon-action"
          onClick={onRemove}
          title={removeLabel}
          type="button"
        >
          <Trash aria-hidden size={19} />
        </button>
      </div>
    </li>
  );
}

function ProjectHealth({
  health
}: {
  health: ProjectSummary['health'];
}) {
  if (health === 'ready') {
    return (
      <span className="nl-health nl-health--ready">
        <CheckCircle aria-hidden size={17} weight="fill" />
        {t('project.health.ready')}
      </span>
    );
  }

  return (
    <span className="nl-health nl-health--attention">
      <WarningCircle aria-hidden size={17} weight="fill" />
      {t('project.health.needsAttention')}
    </span>
  );
}

function RemoveProjectDialog({
  isPending,
  onCancel,
  onConfirm,
  project
}: {
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  project: ProjectSummary;
}) {
  return (
    <div className="nl-dialog-backdrop">
      <section
        aria-describedby="remove-project-description"
        aria-labelledby="remove-project-title"
        aria-modal="true"
        className="nl-confirm-dialog"
        role="dialog"
      >
        <h2 id="remove-project-title">{t('library.remove.title')}</h2>
        <p id="remove-project-description">
          {formatMessage('library.remove.body', { title: project.title })}
        </p>
        <p className="nl-confirm-dialog__assurance">
          {t('library.remove.retainsFiles')}
        </p>
        <div className="nl-confirm-dialog__actions">
          <button
            className="nl-secondary-action"
            disabled={isPending}
            onClick={onCancel}
            type="button"
          >
            {t('common.cancel')}
          </button>
          <button
            className="nl-danger-action"
            disabled={isPending}
            onClick={onConfirm}
            type="button"
          >
            {isPending
              ? t('library.remove.pending')
              : t('library.remove.confirm')}
          </button>
        </div>
      </section>
    </div>
  );
}

function chapterLabel(chapter: number): string {
  return chapter === 0
    ? t('project.chapter.none')
    : formatMessage('project.chapter.number', { chapter });
}

function formatLastOpened(timestamp: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp));
}

function projectOutcomeMessage(
  outcome: ProjectOpenResult['outcome']
): MessageKey | null {
  switch (outcome) {
    case 'invalid_project':
      return 'project.error.invalid';
    case 'location_required':
      return 'project.error.locationRequired';
    case 'location_unavailable':
      return 'project.error.locationUnavailable';
    case 'project_exists':
      return 'project.error.exists';
    case 'failed':
      return 'project.error.failed';
    case 'cancelled':
    case 'created':
    case 'opened':
      return null;
  }
}
