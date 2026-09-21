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
  PlanningErrorKind,
  PlanningStage,
  PlanningTask,
  PlanningTaskStatus
} from '../../../../shared/planningContract';
import type { ProjectSummary } from '../../../../shared/projectContract';
import { formatMessage, t } from '../../i18n/messages.zh-CN';

const POLL_INTERVAL_MS = 750;
const ACTIVE_STATUSES = new Set<PlanningTaskStatus>([
  'queued',
  'running',
  'stop_requested'
]);
const TERMINAL_STATUSES = new Set<PlanningTaskStatus>([
  'succeeded',
  'failed',
  'cancelled'
]);

const STAGE_LABELS = {
  preparing: '正在读取故事基础',
  global_outline: '正在规划全书方向',
  volume_outline: '正在组织第一卷',
  arc_map: '正在梳理故事线',
  chapter_queue: '正在安排章节计划',
  finalizing: '正在检查规划结果',
  completed: '全局规划已准备完成'
} satisfies Record<PlanningStage, string>;

const STAGE_ORDER: PlanningStage[] = [
  'preparing',
  'global_outline',
  'volume_outline',
  'arc_map',
  'chapter_queue',
  'finalizing',
  'completed'
];

const STAGE_LIST_LABELS = {
  preparing: '读取故事基础',
  global_outline: '规划全书方向',
  volume_outline: '组织第一卷',
  arc_map: '梳理故事线',
  chapter_queue: '安排章节计划',
  finalizing: '检查规划结果',
  completed: '准备完成'
} satisfies Record<PlanningStage, string>;

interface PlanningGenerationViewProps {
  onBack: () => void;
  onCompleted: (project: ProjectSummary) => void;
  project: ProjectSummary;
}

export function PlanningGenerationView({
  onBack,
  onCompleted,
  project
}: PlanningGenerationViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestToken = useRef(0);
  const mounted = useRef(true);
  const terminalTaskAccepted = useRef(false);
  const completionRefreshStarted = useRef(false);
  const [task, setTask] = useState<PlanningTask | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [startError, setStartError] = useState<PlanningErrorKind | null>(null);

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
      if (!mounted.current || currentRequest !== requestToken.current) return;
      if ((result.outcome === 'opened' || result.outcome === 'created')
        && result.project.globalPlanAvailable) {
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

  const receiveTask = useCallback((nextTask: PlanningTask) => {
    if (terminalTaskAccepted.current) return;
    if (TERMINAL_STATUSES.has(nextTask.status)) {
      terminalTaskAccepted.current = true;
    }
    setTask(nextTask);
    setRefreshWarning(false);
    setStartError(null);
    setIsStopping(nextTask.status === 'stop_requested');
    if (nextTask.status === 'succeeded'
      || nextTask.error?.kind === 'already_complete') {
      if (!completionRefreshStarted.current) {
        completionRefreshStarted.current = true;
        void completeReview();
      }
    }
  }, [completeReview]);

  const start = async () => {
    if (isStarting) return;
    const currentRequest = ++requestToken.current;
    setIsStarting(true);
    setStartError(null);
    try {
      const nextTask = await window.novelLoop.planning.start({
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
    if (!task || isStopping) return;
    setIsStopping(true);
    try {
      const nextTask = await window.novelLoop.planning.cancel({
        taskId: task.taskId
      });
      if (mounted.current) {
        receiveTask(nextTask);
      }
    } catch {
      if (mounted.current) {
        setStartError('unexpected');
      }
    } finally {
      if (mounted.current && task.status !== 'stop_requested') {
        setIsStopping(false);
      }
    }
  };

  useEffect(() => {
    if (!task || !ACTIVE_STATUSES.has(task.status)) return;
    let disposed = false;
    let timer: number | undefined;
    const taskId = task.taskId;

    const schedulePoll = () => {
      if (disposed || !mounted.current) return;
      timer = window.setTimeout(() => {
        void poll();
      }, POLL_INTERVAL_MS);
    };
    const poll = async () => {
      const currentRequest = ++requestToken.current;
      try {
        const nextTask = await window.novelLoop.planning.get({ taskId });
        if (mounted.current && currentRequest === requestToken.current) {
          receiveTask(nextTask);
          if (ACTIVE_STATUSES.has(nextTask.status)) schedulePoll();
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
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [receiveTask, task]);

  const retry = () => {
    requestToken.current += 1;
    terminalTaskAccepted.current = false;
    completionRefreshStarted.current = false;
    setTask(null);
    setStartError(null);
    setRefreshWarning(false);
    void start();
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
          {t('planning.generation.back')}
        </button>
      </header>
      <div className="nl-project-content nl-planning-generation">
        <section aria-labelledby="planning-generation-title">
          <p className="nl-section-label">{t('planning.generation.eyebrow')}</p>
          <h1
            className="nl-view-title"
            id="planning-generation-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {t('planning.generation.title')}
          </h1>
          {!task && !startError && (
            <div className="nl-foundation-confirmation">
              <p>{t('planning.generation.confirmation')}</p>
              <p className="nl-foundation-supporting-copy">
                {t('planning.generation.confirmationNote')}
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
                    ? t('planning.generation.starting')
                    : t('planning.generation.start')}
                </button>
              </div>
            </div>
          )}
          {task && ACTIVE_STATUSES.has(task.status) && (
            <>
              <PlanningProgress
                isStopping={isStopping}
                onStop={requestStop}
                task={task}
              />
              {refreshWarning && (
                <p
                  className="nl-inline-alert nl-inline-alert--warning"
                  role="status"
                >
                  <WarningCircle aria-hidden size={20} weight="fill" />
                  {t('planning.generation.refreshWarning')}
                </p>
              )}
            </>
          )}
          {task?.status === 'succeeded' && (
            <PlanningCompleted />
          )}
          {(task?.status === 'failed'
            || task?.status === 'cancelled'
            || errorKind) && (
            <PlanningFailure
              completedStages={task?.completedStages ?? []}
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

function PlanningCompleted() {
  return (
    <div className="nl-foundation-progress" role="status">
      <CheckCircle aria-hidden size={28} weight="fill" />
      <div className="nl-foundation-progress__body">
        <p className="nl-foundation-progress__stage">
          {STAGE_LABELS.completed}
        </p>
      </div>
    </div>
  );
}

function PlanningProgress({
  isStopping,
  onStop,
  task
}: {
  isStopping: boolean;
  onStop: () => void;
  task: PlanningTask;
}) {
  const stopRequested = task.status === 'stop_requested' || isStopping;
  const completedStages = new Set(task.completedStages);
  const [, setElapsedTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedTick((tick) => tick + 1);
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [task.startedAt]);

  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(task.startedAt)) / 60_000)
  );

  return (
    <div className="nl-foundation-progress" role="status">
      <CircleNotch aria-hidden className="nl-spin" size={28} />
      <div className="nl-foundation-progress__body">
        <p className="nl-foundation-progress__stage">
          {STAGE_LABELS[task.stage]}
        </p>
        <p className="nl-foundation-progress__elapsed" role="timer">
          {formatMessage('planning.generation.elapsed', {
            minutes: elapsedMinutes
          })}
        </p>
        <ol
          aria-label={t('planning.generation.stageList')}
          className="nl-foundation-progress__stages"
        >
          {STAGE_ORDER.map((stage) => {
            const state = completedStages.has(stage)
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
            ? t('planning.generation.stopRequested')
            : t('planning.generation.stopNote')}
        </p>
      </div>
      {task.canCancel && !stopRequested && (
        <button
          className="nl-secondary-action"
          onClick={() => void onStop()}
          type="button"
        >
          <PauseCircle aria-hidden size={18} />
          {t('planning.generation.stop')}
        </button>
      )}
    </div>
  );
}

function PlanningFailure({
  completedStages,
  errorKind,
  onBack,
  onRetry,
  retryable,
  wasCancelled
}: {
  completedStages: PlanningStage[];
  errorKind: PlanningErrorKind | null;
  onBack: () => void;
  onRetry: () => void;
  retryable: boolean;
  wasCancelled: boolean;
}) {
  const message = wasCancelled
    ? t('planning.error.cancelled')
    : errorKind
      ? planningErrorMessage(errorKind)
      : t('planning.error.unexpected');
  const preserved = completedArtifactNames(completedStages);

  return (
    <div className="nl-foundation-error">
      <p className="nl-inline-alert nl-inline-alert--error" role="alert">
        <WarningCircle aria-hidden size={20} weight="fill" />
        {message}
      </p>
      {preserved.length > 0 && (
        <p className="nl-foundation-supporting-copy">
          {formatMessage('planning.generation.preserved', {
            documents: preserved.join('和')
          })}
        </p>
      )}
      <p className="nl-foundation-supporting-copy">
        {t('planning.generation.stateProtection')}
      </p>
      <div className="nl-foundation-actions">
        <button className="nl-secondary-action" onClick={onBack} type="button">
          {t('planning.generation.back')}
        </button>
        {retryable && (
          <button className="nl-primary-action" onClick={onRetry} type="button">
            <ArrowClockwise aria-hidden size={18} />
            {t('planning.generation.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

function completedArtifactNames(stages: PlanningStage[]): string[] {
  const names: string[] = [];
  if (stages.includes('global_outline')) names.push('全书方向');
  if (stages.includes('volume_outline')) names.push('第一卷');
  if (stages.includes('arc_map')) names.push('故事线');
  if (stages.includes('chapter_queue')) names.push('章节计划');
  return names;
}

function stageStateLabel(
  state: 'completed' | 'current' | 'pending'
): string {
  if (state === 'completed') return t('planning.generation.stageCompleted');
  if (state === 'current') return t('planning.generation.stageCurrent');
  return t('planning.generation.stagePending');
}

function planningErrorMessage(kind: PlanningErrorKind): string {
  switch (kind) {
    case 'codex_unavailable': return t('planning.error.codexUnavailable');
    case 'upgrade_required': return t('planning.error.upgradeRequired');
    case 'login_required': return t('planning.error.loginRequired');
    case 'usage_limit': return t('planning.error.usageLimit');
    case 'timeout': return t('planning.error.timeout');
    case 'invalid_output': return t('planning.error.invalidOutput');
    case 'foundation_missing': return t('planning.error.foundationMissing');
    case 'project_unavailable': return t('planning.error.projectUnavailable');
    case 'already_complete': return t('planning.error.alreadyComplete');
    case 'generation_busy': return t('planning.error.generationBusy');
    case 'unexpected': return t('planning.error.unexpected');
  }
}
