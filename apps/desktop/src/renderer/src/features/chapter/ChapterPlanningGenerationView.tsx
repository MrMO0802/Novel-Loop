import { ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise';
import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
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
  ChapterErrorKind,
  ChapterInspection,
  ChapterTask,
  ChapterTaskStage,
  ChapterTaskStatus
} from '../../../../shared/chapterContract';
import type { ProjectSummary } from '../../../../shared/projectContract';
import { formatMessage, t } from '../../i18n/messages.zh-CN';
import { shouldAcceptChapterTask } from './chapterTaskOrdering';

const POLL_INTERVAL_MS = 250;
const ACTIVE_STATUSES = new Set<ChapterTaskStatus>([
  'queued',
  'running',
  'stop_requested'
]);
const TERMINAL_STATUSES = new Set<ChapterTaskStatus>([
  'succeeded',
  'failed',
  'cancelled'
]);
const STAGE_ORDER: ChapterTaskStage[] = [
  'preparing',
  'mission',
  'plan_candidates',
  'ranking',
  'finalizing',
  'completed'
];
const STAGE_LABELS: Partial<Record<ChapterTaskStage, string>> = {
  preparing: '正在读取本章需要承接的故事状态',
  mission: '正在确定本章任务',
  plan_candidates: '正在比较不同章节方案',
  ranking: '正在选择最合适的方向',
  finalizing: '正在准备审阅内容',
  completed: '章节方向已准备好'
};
const STAGE_LIST_LABELS: Partial<Record<ChapterTaskStage, string>> = {
  preparing: '读取章节背景',
  mission: '确定本章任务',
  plan_candidates: '比较章节方案',
  ranking: '选择章节方向',
  finalizing: '准备审阅内容',
  completed: '准备完成'
};

interface ChapterPlanningGenerationViewProps {
  onBack: () => void;
  onDraftingPartial: () => void;
  onDraftReady: () => void;
  onPlanReady: () => void;
  project: ProjectSummary;
}

export function ChapterPlanningGenerationView({
  onBack,
  onDraftingPartial,
  onDraftReady,
  onPlanReady,
  project
}: ChapterPlanningGenerationViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const requestToken = useRef(0);
  const operationGeneration = useRef(0);
  const terminalAccepted = useRef(false);
  const latestTask = useRef<ChapterTask | null>(null);
  const inspectionRefreshStarted = useRef(false);
  const [inspection, setInspection] = useState<ChapterInspection | null>(null);
  const [task, setTask] = useState<ChapterTask | null>(null);
  const [isInspecting, setIsInspecting] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [localError, setLocalError] = useState<ChapterErrorKind | null>(null);

  const routeFromInspection = useCallback((next: ChapterInspection) => {
    if (!next.available) return false;
    if (next.phase === 'plan_ready') {
      onPlanReady();
      return true;
    }
    if (next.phase === 'drafting_partial') {
      onDraftingPartial();
      return true;
    }
    if (next.phase === 'draft_ready') {
      onDraftReady();
      return true;
    }
    setInspection(next);
    return false;
  }, [onDraftingPartial, onDraftReady, onPlanReady]);

  const inspect = useCallback(async () => {
    const currentRequest = ++requestToken.current;
    try {
      const next = await window.novelLoop.chapter.inspect({
        projectKey: project.projectKey
      });
      if (!mounted.current || currentRequest !== requestToken.current) return;
      if (!routeFromInspection(next)) {
        setLocalError(next.available ? null : inspectionError(next.reason));
      }
    } catch {
      if (mounted.current && currentRequest === requestToken.current) {
        setLocalError('project_unavailable');
      }
    } finally {
      if (mounted.current && currentRequest === requestToken.current) {
        setIsInspecting(false);
      }
    }
  }, [project.projectKey, routeFromInspection]);

  useEffect(() => {
    mounted.current = true;
    headingRef.current?.focus();
    void inspect();
    return () => {
      mounted.current = false;
      requestToken.current += 1;
    };
  }, [inspect]);

  const refreshAfterSuccess = useCallback(() => {
    if (inspectionRefreshStarted.current) return;
    inspectionRefreshStarted.current = true;
    void inspect();
  }, [inspect]);

  const receiveTask = useCallback((next: ChapterTask) => {
    if (terminalAccepted.current) return;
    if (!shouldAcceptChapterTask(latestTask.current, next)) return;
    latestTask.current = next;
    if (TERMINAL_STATUSES.has(next.status)) {
      terminalAccepted.current = true;
    }
    setTask(next);
    setRefreshWarning(false);
    setLocalError(null);
    setIsStopping(next.status === 'stop_requested');
    if (next.status === 'succeeded'
      || next.error?.kind === 'already_complete') {
      refreshAfterSuccess();
    }
  }, [refreshAfterSuccess]);

  const start = async () => {
    if (isStarting) return;
    const generation = ++operationGeneration.current;
    latestTask.current = null;
    terminalAccepted.current = false;
    const currentRequest = ++requestToken.current;
    setIsStarting(true);
    setLocalError(null);
    try {
      const next = await window.novelLoop.chapter.startPlanning({
        projectKey: project.projectKey
      });
      if (
        mounted.current
        && generation === operationGeneration.current
        && currentRequest === requestToken.current
      ) {
        receiveTask(next);
      }
    } catch {
      if (mounted.current && currentRequest === requestToken.current) {
        setLocalError('unexpected');
      }
    } finally {
      if (mounted.current && currentRequest === requestToken.current) {
        setIsStarting(false);
      }
    }
  };

  const requestStop = async () => {
    if (!task || isStopping) return;
    const generation = operationGeneration.current;
    const taskId = task.taskId;
    setIsStopping(true);
    try {
      const next = await window.novelLoop.chapter.cancel({
        taskId
      });
      if (
        mounted.current
        && generation === operationGeneration.current
        && latestTask.current?.taskId === taskId
      ) {
        receiveTask(next);
      }
    } catch {
      if (
        mounted.current
        && generation === operationGeneration.current
        && latestTask.current?.taskId === taskId
      ) {
        setRefreshWarning(true);
      }
    } finally {
      if (
        mounted.current
        && generation === operationGeneration.current
        && latestTask.current?.taskId === taskId
        && task.status !== 'stop_requested'
      ) {
        setIsStopping(false);
      }
    }
  };

  useEffect(() => {
    if (!task || !ACTIVE_STATUSES.has(task.status)) return;
    let disposed = false;
    let timer: number | undefined;
    const taskId = task.taskId;
    const generation = operationGeneration.current;
    const schedule = () => {
      if (disposed || !mounted.current) return;
      timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    const poll = async () => {
      const currentRequest = ++requestToken.current;
      try {
        const next = await window.novelLoop.chapter.get({ taskId });
        if (
          mounted.current
          && generation === operationGeneration.current
          && currentRequest === requestToken.current
        ) {
          receiveTask(next);
          if (ACTIVE_STATUSES.has(next.status)) schedule();
        }
      } catch {
        if (
          mounted.current
          && generation === operationGeneration.current
          && currentRequest === requestToken.current
        ) {
          setRefreshWarning(true);
          schedule();
        }
      }
    };
    schedule();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [receiveTask, task]);

  const retry = () => {
    requestToken.current += 1;
    inspectionRefreshStarted.current = false;
    setTask(null);
    setLocalError(null);
    setRefreshWarning(false);
    void start();
  };

  const chapterNumber = inspection?.available
    ? inspection.chapterNumber
    : project.latestCommittedChapter + 1;
  const errorKind = localError ?? task?.error?.kind ?? null;

  return (
    <main className="nl-project-shell">
      <header className="nl-project-header">
        <div className="nl-brand">
          <BookOpenText aria-hidden size={24} weight="fill" />
          <span>{t('app.brand')}</span>
        </div>
        <button className="nl-tertiary-action" onClick={onBack} type="button">
          <ArrowLeft aria-hidden size={17} />
          {t('chapter.common.back')}
        </button>
      </header>
      <div className="nl-project-content nl-chapter-task">
        <section aria-labelledby="chapter-planning-title">
          <p className="nl-section-label">{t('chapter.planning.eyebrow')}</p>
          <h1
            className="nl-view-title"
            id="chapter-planning-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {formatMessage('chapter.planning.title', {
              chapter: chapterNumber
            })}
          </h1>
          {isInspecting && !task && (
            <TaskLoading text={t('chapter.planning.inspecting')} />
          )}
          {!isInspecting && inspection?.available && !task && !localError && (
            <div className="nl-chapter-confirmation">
              <p>{t('chapter.planning.confirmation')}</p>
              <p className="nl-foundation-supporting-copy">
                {t('chapter.planning.confirmationNote')}
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
                  {isStarting && (
                    <CircleNotch aria-hidden className="nl-spin" size={18} />
                  )}
                  {isStarting
                    ? t('chapter.planning.starting')
                    : t('chapter.planning.start')}
                </button>
              </div>
            </div>
          )}
          {task && ACTIVE_STATUSES.has(task.status) && (
            <ChapterTaskProgress
              isStopping={isStopping}
              onStop={requestStop}
              task={task}
            />
          )}
          {refreshWarning && (
            <p className="nl-inline-alert nl-inline-alert--warning" role="status">
              <WarningCircle aria-hidden size={20} weight="fill" />
              {t('chapter.common.refreshWarning')}
            </p>
          )}
          {task?.status === 'succeeded' && (
            <TaskLoading
              completed
              text={t('chapter.planning.completed')}
            />
          )}
          {(task?.status === 'failed'
            || task?.status === 'cancelled'
            || errorKind) && (
            <ChapterTaskFailure
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

function ChapterTaskProgress({
  isStopping,
  onStop,
  task
}: {
  isStopping: boolean;
  onStop: () => void;
  task: ChapterTask;
}) {
  const completed = new Set(task.completedStages);
  const stopRequested = task.status === 'stop_requested' || isStopping;
  return (
    <div className="nl-foundation-progress" role="status">
      <CircleNotch aria-hidden className="nl-spin" size={28} />
      <div className="nl-foundation-progress__body">
        <p className="nl-foundation-progress__stage">
          {STAGE_LABELS[task.stage] ?? t('chapter.planning.inProgress')}
        </p>
        <ol
          aria-label={t('chapter.planning.stageList')}
          className="nl-foundation-progress__stages"
        >
          {STAGE_ORDER.map((stage) => {
            const state = completed.has(stage)
              ? 'completed'
              : task.stage === stage ? 'current' : 'pending';
            return (
              <li
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={`${STAGE_LIST_LABELS[stage]}，${stageStateLabel(state)}`}
                className={`nl-foundation-progress__stage-item nl-foundation-progress__stage-item--${state}`}
                key={stage}
              >
                {state === 'completed' && (
                  <CheckCircle aria-hidden size={17} weight="fill" />
                )}
                {state === 'current' && (
                  <CircleNotch aria-hidden className="nl-spin" size={17} />
                )}
                {state === 'pending' && (
                  <span
                    aria-hidden
                    className="nl-foundation-progress__pending-marker"
                  />
                )}
                <span>{STAGE_LIST_LABELS[stage]}</span>
              </li>
            );
          })}
        </ol>
        <p className="nl-foundation-supporting-copy">
          {stopRequested
            ? t('chapter.planning.stopRequested')
            : t('chapter.planning.stopNote')}
        </p>
      </div>
      {task.canCancel && !stopRequested && (
        <button
          className="nl-secondary-action"
          onClick={() => void onStop()}
          type="button"
        >
          <PauseCircle aria-hidden size={18} />
          {t('chapter.common.stop')}
        </button>
      )}
    </div>
  );
}

function ChapterTaskFailure({
  errorKind,
  onBack,
  onRetry,
  retryable,
  wasCancelled
}: {
  errorKind: ChapterErrorKind | null;
  onBack: () => void;
  onRetry: () => void;
  retryable: boolean;
  wasCancelled: boolean;
}) {
  return (
    <div className="nl-foundation-error">
      <p className="nl-inline-alert nl-inline-alert--error" role="alert">
        <WarningCircle aria-hidden size={20} weight="fill" />
        {wasCancelled
          ? t('chapter.planning.error.cancelled')
          : chapterPlanningError(errorKind)}
      </p>
      <p className="nl-foundation-supporting-copy">
        {t('chapter.common.stateProtection')}
      </p>
      <div className="nl-foundation-actions">
        <button className="nl-secondary-action" onClick={onBack} type="button">
          {t('chapter.common.back')}
        </button>
        {retryable && (
          <button className="nl-primary-action" onClick={onRetry} type="button">
            <ArrowClockwise aria-hidden size={18} />
            {t('chapter.planning.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

function TaskLoading({
  completed = false,
  text
}: {
  completed?: boolean;
  text: string;
}) {
  return (
    <div className="nl-foundation-progress" role="status">
      {completed
        ? <CheckCircle aria-hidden size={28} weight="fill" />
        : <CircleNotch aria-hidden className="nl-spin" size={28} />}
      <div className="nl-foundation-progress__body">
        <p className="nl-foundation-progress__stage">{text}</p>
      </div>
    </div>
  );
}

function stageStateLabel(state: 'completed' | 'current' | 'pending') {
  if (state === 'completed') return t('chapter.common.stageCompleted');
  if (state === 'current') return t('chapter.common.stageCurrent');
  return t('chapter.common.stagePending');
}

function inspectionError(
  reason: Extract<ChapterInspection, { available: false }>['reason']
): ChapterErrorKind {
  if (reason === 'stale_chapter') return 'stale_chapter';
  if (reason === 'invalid_output') return 'invalid_output';
  return 'project_unavailable';
}

function chapterPlanningError(kind: ChapterErrorKind | null): string {
  switch (kind) {
    case 'codex_unavailable': return t('chapter.error.codexUnavailable');
    case 'login_required': return t('chapter.error.loginRequired');
    case 'usage_limit': return t('chapter.error.usageLimit');
    case 'timeout': return t('chapter.planning.error.timeout');
    case 'invalid_output': return t('chapter.planning.error.invalidOutput');
    case 'plan_missing': return t('chapter.error.planMissing');
    case 'project_unavailable': return t('chapter.error.projectUnavailable');
    case 'stale_chapter': return t('chapter.error.staleChapter');
    case 'already_complete': return t('chapter.error.alreadyComplete');
    case 'generation_busy': return t('chapter.error.generationBusy');
    case 'unexpected':
    default:
      return t('chapter.planning.error.unexpected');
  }
}
