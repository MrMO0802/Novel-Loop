import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { PauseCircle } from '@phosphor-icons/react/PauseCircle';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

import type {
  FoundationErrorKind,
  FoundationStage,
  FoundationTask,
  FoundationTaskStatus
} from '../../../../shared/foundationContract';
import type { ProjectSummary } from '../../../../shared/projectContract';
import { t } from '../../i18n/messages.zh-CN';

const POLL_INTERVAL_MS = 750;
const ACTIVE_STATUSES = new Set<FoundationTaskStatus>([
  'queued',
  'running',
  'stop_requested'
]);

const STAGE_LABELS = {
  preparing: '正在读取创意与项目资料',
  story_bible: '正在构建故事核心',
  genre_contract: '正在整理类型边界',
  reader_promise: '正在明确读者期待',
  style_guide: '正在形成写作风格',
  finalizing: '正在检查生成结果',
  completed: '故事基础已准备完成'
} satisfies Record<FoundationStage, string>;

interface FoundationGenerationViewProps {
  onBack: () => void;
  onCompleted: (project: ProjectSummary) => void;
  project: ProjectSummary;
}

export function FoundationGenerationView({
  onBack,
  onCompleted,
  project
}: FoundationGenerationViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestToken = useRef(0);
  const mounted = useRef(true);
  const [task, setTask] = useState<FoundationTask | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [startError, setStartError] = useState<FoundationErrorKind | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
    return () => {
      mounted.current = false;
      requestToken.current += 1;
    };
  }, []);

  const completeReview = useCallback(async () => {
    const currentRequest = ++requestToken.current;
    try {
      const result = await window.novelLoop.projects.open(project.projectKey);
      if (!mounted.current || currentRequest !== requestToken.current) {
        return;
      }
      if (result.outcome === 'opened' || result.outcome === 'created') {
        onCompleted(result.project);
        return;
      }
      setStartError('project_unavailable');
    } catch {
      if (mounted.current && currentRequest === requestToken.current) {
        setStartError('project_unavailable');
      }
    }
  }, [onCompleted, project.projectKey]);

  const receiveTask = useCallback((nextTask: FoundationTask) => {
    setTask(nextTask);
    setRefreshWarning(false);
    setStartError(null);
    if (nextTask.status === 'succeeded') {
      void completeReview();
    }
  }, [completeReview]);

  const start = async () => {
    if (isStarting) {
      return;
    }
    const currentRequest = ++requestToken.current;
    setIsStarting(true);
    setStartError(null);
    try {
      const nextTask = await window.novelLoop.foundation.start({
        projectKey: project.projectKey
      });
      if (mounted.current && currentRequest === requestToken.current) {
        receiveTask(nextTask);
      }
    } catch {
      if (mounted.current && currentRequest === requestToken.current) {
        setStartError('unexpected');
      }
    } finally {
      if (mounted.current && currentRequest === requestToken.current) {
        setIsStarting(false);
      }
    }
  };

  const requestStop = async () => {
    if (!task || isStopping) {
      return;
    }
    const currentRequest = ++requestToken.current;
    setIsStopping(true);
    try {
      const nextTask = await window.novelLoop.foundation.cancel({
        taskId: task.taskId
      });
      if (mounted.current && currentRequest === requestToken.current) {
        receiveTask(nextTask);
      }
    } catch {
      if (mounted.current && currentRequest === requestToken.current) {
        setStartError('unexpected');
      }
    } finally {
      if (mounted.current && currentRequest === requestToken.current) {
        setIsStopping(false);
      }
    }
  };

  useEffect(() => {
    if (!task || !ACTIVE_STATUSES.has(task.status)) {
      return;
    }
    let disposed = false;
    const taskId = task.taskId;
    let timer: number | undefined;
    const schedulePoll = () => {
      if (disposed || !mounted.current) {
        return;
      }
      timer = window.setTimeout(() => {
        void poll();
      }, POLL_INTERVAL_MS);
    };
    const poll = async () => {
      const currentRequest = ++requestToken.current;
      try {
        const nextTask = await window.novelLoop.foundation.get({ taskId });
        if (mounted.current && currentRequest === requestToken.current) {
          receiveTask(nextTask);
          if (ACTIVE_STATUSES.has(nextTask.status)) {
            schedulePoll();
          }
        }
      } catch {
        if (mounted.current && currentRequest === requestToken.current) {
          setRefreshWarning(true);
          schedulePoll();
        }
      }
    };
    schedulePoll();
    return () => {
      disposed = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [receiveTask, task]);

  const retry = () => {
    requestToken.current += 1;
    setTask(null);
    setStartError(null);
  };
  const errorKind = startError ?? task?.error?.kind ?? null;

  return (
    <main className="nl-project-shell">
      <header className="nl-project-header">
        <div className="nl-brand">
          <BookOpenText aria-hidden size={24} weight="fill" />
          <span>{t('app.brand')}</span>
        </div>
        <button className="nl-tertiary-action" onClick={onBack} type="button">
          <ArrowLeft aria-hidden size={17} />
          {t('foundation.generation.back')}
        </button>
      </header>
      <div className="nl-project-content nl-foundation-generation">
        <section aria-labelledby="foundation-generation-title">
          <p className="nl-section-label">{t('foundation.generation.eyebrow')}</p>
          <h1
            className="nl-view-title"
            id="foundation-generation-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {t('foundation.generation.title')}
          </h1>
          {!task && !startError && (
            <div className="nl-foundation-confirmation">
              <p>{t('foundation.generation.confirmation')}</p>
              <p className="nl-foundation-supporting-copy">
                {t('foundation.generation.confirmationNote')}
              </p>
              <div className="nl-foundation-actions">
                <button className="nl-secondary-action" onClick={onBack} type="button">
                  {t('common.cancel')}
                </button>
                <button
                  className="nl-primary-action"
                  disabled={isStarting}
                  onClick={() => void start()}
                  type="button"
                >
                  {isStarting && <CircleNotch aria-hidden className="nl-spin" size={18} />}
                  {isStarting ? t('foundation.generation.starting') : t('foundation.generation.start')}
                </button>
              </div>
            </div>
          )}
          {task && ACTIVE_STATUSES.has(task.status) && (
            <>
              <GenerationProgress
                isStopping={isStopping}
                onStop={requestStop}
                task={task}
              />
              {refreshWarning && (
                <p className="nl-inline-alert nl-inline-alert--warning" role="status">
                  <WarningCircle aria-hidden size={20} weight="fill" />
                  {t('foundation.generation.refreshWarning')}
                </p>
              )}
            </>
          )}
          {task?.status === 'succeeded' && (
            <div className="nl-foundation-progress" role="status">
              <CheckCircle aria-hidden size={28} weight="fill" />
              <p>{STAGE_LABELS.completed}</p>
            </div>
          )}
          {(task?.status === 'failed' || task?.status === 'cancelled' || errorKind) && (
            <GenerationFailure
              errorKind={errorKind}
              onBack={onBack}
              onRetry={retry}
              retryable={task?.canRetry ?? errorKind !== 'project_unavailable'}
              wasCancelled={task?.status === 'cancelled'}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function GenerationProgress({
  isStopping,
  onStop,
  task
}: {
  isStopping: boolean;
  onStop: () => void;
  task: FoundationTask;
}) {
  const stopRequested = task.status === 'stop_requested';
  return (
    <div className="nl-foundation-progress" role="status">
      <CircleNotch aria-hidden className="nl-spin" size={28} />
      <div>
        <p className="nl-foundation-progress__stage">{STAGE_LABELS[task.stage]}</p>
        <p className="nl-foundation-supporting-copy">
          {stopRequested ? t('foundation.generation.stopRequested') : t('foundation.generation.stopNote')}
        </p>
      </div>
      {task.canCancel && !stopRequested && (
        <button
          className="nl-secondary-action"
          disabled={isStopping}
          onClick={() => void onStop()}
          type="button"
        >
          <PauseCircle aria-hidden size={18} />
          {isStopping ? t('foundation.generation.stopping') : t('foundation.generation.stop')}
        </button>
      )}
    </div>
  );
}

function GenerationFailure({
  errorKind,
  onBack,
  onRetry,
  retryable,
  wasCancelled
}: {
  errorKind: FoundationErrorKind | null;
  onBack: () => void;
  onRetry: () => void;
  retryable: boolean;
  wasCancelled: boolean;
}) {
  const message = wasCancelled
    ? t('foundation.error.cancelled')
    : errorKind ? foundationErrorMessage(errorKind) : t('foundation.error.unexpected');
  return (
    <div className="nl-foundation-error">
      <p className="nl-inline-alert nl-inline-alert--error" role="alert">
        <WarningCircle aria-hidden size={20} weight="fill" />
        {message}
      </p>
      <div className="nl-foundation-actions">
        <button className="nl-secondary-action" onClick={onBack} type="button">
          {t('foundation.generation.back')}
        </button>
        {retryable && (
          <button className="nl-primary-action" onClick={onRetry} type="button">
            <ArrowClockwise aria-hidden size={18} />
            {t('foundation.generation.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

function foundationErrorMessage(kind: FoundationErrorKind): string {
  switch (kind) {
    case 'codex_unavailable': return t('foundation.error.codexUnavailable');
    case 'login_required': return t('foundation.error.loginRequired');
    case 'usage_limit': return t('foundation.error.usageLimit');
    case 'timeout': return t('foundation.error.timeout');
    case 'invalid_output': return t('foundation.error.invalidOutput');
    case 'project_unavailable': return t('foundation.error.projectUnavailable');
    case 'already_complete': return t('foundation.error.alreadyComplete');
    case 'unexpected': return t('foundation.error.unexpected');
  }
}
