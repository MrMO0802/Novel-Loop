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
  useState,
  type KeyboardEvent as ReactKeyboardEvent
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
  const actionRequestId = useRef(0);
  const actionInFlight = useRef(false);
  const removeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shouldRestoreRemoveFocus = useRef(false);
  const [view, setView] = useState<LibraryView>({ kind: 'loading' });
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [removeErrorKey, setRemoveErrorKey] =
    useState<MessageKey | null>(null);
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
      actionInFlight.current = false;
      actionRequestId.current += 1;
    };
  }, [loadLibrary]);

  useEffect(() => {
    if (!removeCandidate && shouldRestoreRemoveFocus.current) {
      shouldRestoreRemoveFocus.current = false;
      const trigger = removeTriggerRef.current;
      removeTriggerRef.current = null;
      if (trigger?.isConnected) {
        trigger.focus();
      } else {
        headingRef.current?.focus();
      }
    }
  }, [removeCandidate]);

  const beginAction = (action: string): number | null => {
    if (actionInFlight.current) {
      return null;
    }
    actionInFlight.current = true;
    const currentRequest = ++actionRequestId.current;
    setPendingAction(action);
    setErrorKey(null);
    return currentRequest;
  };

  const isCurrentAction = (currentRequest: number): boolean => (
    mounted.current
      && actionRequestId.current === currentRequest
  );

  const finishAction = (currentRequest: number) => {
    if (actionRequestId.current !== currentRequest) {
      return;
    }
    actionInFlight.current = false;
    if (mounted.current) {
      setPendingAction(null);
    }
  };

  const handleOpenResult = (
    result: ProjectOpenResult,
    currentRequest: number
  ) => {
    if (!isCurrentAction(currentRequest)) {
      return;
    }
    if (result.outcome === 'opened' || result.outcome === 'created') {
      finishAction(currentRequest);
      onOpenProject(result.project);
      return;
    }
    const messageKey = projectOutcomeMessage(result.outcome);
    if (messageKey) {
      setErrorKey(messageKey);
    }
  };

  const openExisting = async () => {
    const currentRequest = beginAction('open-existing');
    if (currentRequest === null) {
      return;
    }
    try {
      handleOpenResult(
        await window.novelLoop.projects.openExisting(),
        currentRequest
      );
    } catch {
      if (isCurrentAction(currentRequest)) {
        setErrorKey('project.error.failed');
      }
    } finally {
      finishAction(currentRequest);
    }
  };

  const openRecent = async (projectKey: string) => {
    const currentRequest = beginAction(`open:${projectKey}`);
    if (currentRequest === null) {
      return;
    }
    try {
      handleOpenResult(
        await window.novelLoop.projects.open(projectKey),
        currentRequest
      );
    } catch {
      if (isCurrentAction(currentRequest)) {
        setErrorKey('project.error.failed');
      }
    } finally {
      finishAction(currentRequest);
    }
  };

  const removeRecent = async () => {
    if (!removeCandidate || view.kind !== 'loaded') {
      return;
    }

    const projectKey = removeCandidate.projectKey;
    const currentRequest = beginAction(`remove:${projectKey}`);
    if (currentRequest === null) {
      return;
    }
    setRemoveErrorKey(null);
    try {
      const library = await window.novelLoop.projects.remove(projectKey);
      if (isCurrentAction(currentRequest)) {
        shouldRestoreRemoveFocus.current = true;
        setView({ kind: 'loaded', library });
        setRemoveCandidate(null);
      }
    } catch {
      if (isCurrentAction(currentRequest)) {
        setRemoveErrorKey('project.error.failed');
      }
    } finally {
      finishAction(currentRequest);
    }
  };

  const openRemoveDialog = (
    project: ProjectSummary,
    trigger: HTMLButtonElement
  ) => {
    if (actionInFlight.current) {
      return;
    }
    removeTriggerRef.current = trigger;
    setRemoveErrorKey(null);
    setRemoveCandidate(project);
  };

  const closeRemoveDialog = () => {
    if (actionInFlight.current) {
      return;
    }
    shouldRestoreRemoveFocus.current = true;
    setRemoveErrorKey(null);
    setRemoveCandidate(null);
  };

  const library = view.kind === 'loaded' ? view.library : null;
  const backgroundIsInactive = removeCandidate !== null;
  const actionsDisabled = pendingAction !== null || backgroundIsInactive;
  const projects = useMemo(() => (
    library
      ? [...library.projects].sort((left, right) => (
        right.lastOpenedAt.localeCompare(left.lastOpenedAt)
      ))
      : []
  ), [library]);

  return (
    <main className="nl-project-shell">
      <ProjectHeader
        disabled={actionsDisabled}
        inert={backgroundIsInactive}
        onBack={onBack}
      />
      <div
        aria-hidden={backgroundIsInactive ? true : undefined}
        className="nl-project-content"
        inert={backgroundIsInactive}
      >
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
                disabled={actionsDisabled}
                onClick={onCreate}
                type="button"
              >
                <Plus aria-hidden size={18} weight="bold" />
                {t('library.create')}
              </button>
              <button
                className="nl-secondary-action"
                disabled={actionsDisabled}
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
                  disabled={actionsDisabled}
                  isPending={pendingAction === `open:${project.projectKey}`}
                  key={project.projectKey}
                  onOpen={() => void openRecent(project.projectKey)}
                  onRemove={(trigger) => openRemoveDialog(project, trigger)}
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
          errorKey={removeErrorKey}
          onCancel={closeRemoveDialog}
          onConfirm={() => void removeRecent()}
          project={removeCandidate}
        />
      )}
    </main>
  );
}

function ProjectHeader({
  disabled,
  inert,
  onBack
}: {
  disabled: boolean;
  inert: boolean;
  onBack: () => void;
}) {
  return (
    <header
      aria-hidden={inert ? true : undefined}
      className="nl-project-header"
      inert={inert}
    >
      <div className="nl-brand">
        <BookOpenText aria-hidden size={24} weight="fill" />
        <span>{t('app.brand')}</span>
      </div>
      <button
        className="nl-tertiary-action"
        disabled={disabled}
        onClick={onBack}
        type="button"
      >
        <ArrowLeft aria-hidden size={17} />
        {t('library.back')}
      </button>
    </header>
  );
}

function ProjectItem({
  disabled,
  isPending,
  onOpen,
  onRemove,
  project
}: {
  disabled: boolean;
  isPending: boolean;
  onOpen: () => void;
  onRemove: (trigger: HTMLButtonElement) => void;
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
          disabled={disabled}
          onClick={onOpen}
          type="button"
        >
          <FolderOpen aria-hidden size={17} />
          {isPending ? t('library.opening') : openLabel}
        </button>
        <button
          aria-label={removeLabel}
          className="nl-icon-action"
          disabled={disabled}
          onClick={(event) => onRemove(event.currentTarget)}
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
  errorKey,
  isPending,
  onCancel,
  onConfirm,
  project
}: {
  errorKey: MessageKey | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  project: ProjectSummary;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (isPending) {
      wasPending.current = true;
      dialogRef.current?.focus();
      return;
    }

    if (wasPending.current) {
      wasPending.current = false;
      confirmRef.current?.focus();
    }
  }, [isPending]);

  const handleConfirm = () => {
    dialogRef.current?.focus();
    onConfirm();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!isPending) {
        onCancel();
      }
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), '
          + 'select:not([disabled]), textarea:not([disabled]), '
          + '[tabindex]:not([tabindex="-1"])'
      )
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="nl-dialog-backdrop">
      <section
        aria-describedby="remove-project-description"
        aria-labelledby="remove-project-title"
        aria-modal="true"
        className="nl-confirm-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 id="remove-project-title">{t('library.remove.title')}</h2>
        <p id="remove-project-description">
          {formatMessage('library.remove.body', { title: project.title })}
        </p>
        <p className="nl-confirm-dialog__assurance">
          {t('library.remove.retainsFiles')}
        </p>
        {errorKey && (
          <p
            className="nl-inline-alert nl-inline-alert--error"
            id="remove-project-error"
            role="alert"
          >
            <WarningCircle aria-hidden size={20} weight="fill" />
            {t(errorKey)}
          </p>
        )}
        <div className="nl-confirm-dialog__actions">
          <button
            className="nl-secondary-action"
            disabled={isPending}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            {t('common.cancel')}
          </button>
          <button
            className="nl-danger-action"
            disabled={isPending}
            onClick={handleConfirm}
            ref={confirmRef}
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
