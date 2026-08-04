import { ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise';
import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { PauseCircle } from '@phosphor-icons/react/PauseCircle';
import { PencilSimple } from '@phosphor-icons/react/PencilSimple';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

import type {
  ChapterErrorKind,
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
  'scene_cards',
  'scene_drafts',
  'draft_assembly',
  'finalizing',
  'completed'
];
const STAGE_LIST_LABELS: Partial<Record<ChapterTaskStage, string>> = {
  preparing: '读取章节方向',
  scene_cards: '安排场景',
  scene_drafts: '逐场景写作',
  draft_assembly: '组装章节',
  finalizing: '检查初稿',
  completed: '初稿完成'
};

interface ChapterDraftGenerationViewProps {
  onBack: () => void;
  onCompleted: () => void;
  onRepairParticipants: () => void;
  onReviewPlan: () => void;
  project: ProjectSummary;
}

export function ChapterDraftGenerationView({
  onBack,
  onCompleted,
  onRepairParticipants,
  onReviewPlan,
  project
}: ChapterDraftGenerationViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const requestToken = useRef(0);
  const operationGeneration = useRef(0);
  const terminalAccepted = useRef(false);
  const latestTask = useRef<ChapterTask | null>(null);
  const completionRefreshStarted = useRef(false);
  const startIssued = useRef(false);
  const [task, setTask] = useState<ChapterTask | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [localError, setLocalError] = useState<ChapterErrorKind | null>(null);
  const [participantRepairNeeded, setParticipantRepairNeeded] = useState(false);
  const [preflightUnavailable, setPreflightUnavailable] = useState(false);

  const completeDraft = useCallback(async () => {
    if (completionRefreshStarted.current) return;
    completionRefreshStarted.current = true;
    const currentRequest = ++requestToken.current;
    try {
      const inspection = await window.novelLoop.chapter.inspect({
        projectKey: project.projectKey
      });
      if (!mounted.current || currentRequest !== requestToken.current) return;
      if (inspection.available && inspection.phase === 'draft_ready') {
        onCompleted();
        return;
      }
      setLocalError('invalid_output');
    } catch {
      if (mounted.current && currentRequest === requestToken.current) {
        setLocalError('project_unavailable');
      }
    }
  }, [onCompleted, project.projectKey]);

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
      void completeDraft();
    }
  }, [completeDraft]);

  const start = useCallback(async () => {
    const generation = ++operationGeneration.current;
    latestTask.current = null;
    terminalAccepted.current = false;
    const currentRequest = ++requestToken.current;
    setLocalError(null);
    try {
      const next = await window.novelLoop.chapter.startDrafting({
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
    }
  }, [project.projectKey, receiveTask]);

  const startAfterParticipantCheck = useCallback(async () => {
    const currentRequest = ++requestToken.current;
    setPreflightUnavailable(false);
    try {
      const plan = await window.novelLoop.chapter.readPlan({
        projectKey: project.projectKey
      });
      if (!mounted.current || currentRequest !== requestToken.current) return;
      if (!plan.available) {
        setPreflightUnavailable(true);
        return;
      }
      if (
        !plan.mission.participantOptions.some(({ selected }) => selected)
      ) {
        setParticipantRepairNeeded(true);
        return;
      }
    } catch {
      if (!mounted.current || currentRequest !== requestToken.current) return;
      setPreflightUnavailable(true);
      return;
    }
    if (mounted.current && currentRequest === requestToken.current) {
      void start();
    }
  }, [project.projectKey, start]);

  useEffect(() => {
    headingRef.current?.focus();
    if (!startIssued.current) {
      startIssued.current = true;
      void startAfterParticipantCheck();
    }
    return () => {
      mounted.current = false;
      requestToken.current += 1;
    };
  }, [startAfterParticipantCheck]);

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
    completionRefreshStarted.current = false;
    setTask(null);
    setLocalError(null);
    setRefreshWarning(false);
    void start();
  };

  const chapterNumber = task?.chapterNumber
    ?? project.latestCommittedChapter + 1;
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
        <section aria-labelledby="chapter-draft-generation-title">
          <p className="nl-section-label">{t('chapter.draft.eyebrow')}</p>
          <h1
            className="nl-view-title"
            id="chapter-draft-generation-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {formatMessage('chapter.draft.title', { chapter: chapterNumber })}
          </h1>
          {participantRepairNeeded && (
            <div className="nl-authoring-recovery">
              <p className="nl-inline-alert nl-inline-alert--error" role="alert">
                <WarningCircle aria-hidden size={20} weight="fill" />
                {t('chapter.authoring.participants')}
              </p>
              <button
                className="nl-primary-action"
                onClick={onRepairParticipants}
                type="button"
              >
                <PencilSimple aria-hidden size={18} />
                {t('chapter.mission.repairParticipants')}
              </button>
            </div>
          )}
          {preflightUnavailable && (
            <div className="nl-authoring-recovery">
              <p className="nl-inline-alert nl-inline-alert--error" role="alert">
                <WarningCircle aria-hidden size={20} weight="fill" />
                {t('chapter.draft.preflightUnavailable')}
              </p>
              <button
                className="nl-primary-action"
                onClick={onReviewPlan}
                type="button"
              >
                <PencilSimple aria-hidden size={18} />
                {t('chapter.draft.backToPlan')}
              </button>
            </div>
          )}
          {!task
            && !errorKind
            && !participantRepairNeeded
            && !preflightUnavailable && (
              <div className="nl-foundation-progress" role="status">
                <CircleNotch aria-hidden className="nl-spin" size={28} />
                <div className="nl-foundation-progress__body">
                  <p className="nl-foundation-progress__stage">
                    {t('chapter.draft.starting')}
                  </p>
                </div>
              </div>
            )}
          {task && ACTIVE_STATUSES.has(task.status) && (
            <DraftProgress
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
            <div className="nl-foundation-progress" role="status">
              <CheckCircle aria-hidden size={28} weight="fill" />
              <div className="nl-foundation-progress__body">
                <p className="nl-foundation-progress__stage">
                  {t('chapter.draft.completed')}
                </p>
              </div>
            </div>
          )}
          {(task?.status === 'failed'
            || task?.status === 'cancelled'
            || errorKind) && (
            <DraftFailure
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

function DraftProgress({
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
  const currentLabel = task.stage === 'scene_drafts' && task.sceneProgress
    ? formatMessage('chapter.draft.sceneProgress', task.sceneProgress)
    : draftStageLabel(task.stage);
  return (
    <div className="nl-foundation-progress" role="status">
      <CircleNotch aria-hidden className="nl-spin" size={28} />
      <div className="nl-foundation-progress__body">
        <p className="nl-foundation-progress__stage">{currentLabel}</p>
        <ol
          aria-label={t('chapter.draft.stageList')}
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
            ? t('chapter.draft.stopRequested')
            : t('chapter.draft.stopNote')}
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

function DraftFailure({
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
          ? t('chapter.draft.error.cancelled')
          : draftError(errorKind)}
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
            {t('chapter.draft.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

function stageStateLabel(state: 'completed' | 'current' | 'pending') {
  if (state === 'completed') return t('chapter.common.stageCompleted');
  if (state === 'current') return t('chapter.common.stageCurrent');
  return t('chapter.common.stagePending');
}

function draftStageLabel(stage: ChapterTaskStage) {
  switch (stage) {
    case 'preparing': return t('chapter.draft.stage.preparing');
    case 'scene_cards': return t('chapter.draft.stage.sceneCards');
    case 'scene_drafts': return t('chapter.draft.stage.sceneDrafts');
    case 'draft_assembly': return t('chapter.draft.stage.assembly');
    case 'finalizing': return t('chapter.draft.stage.finalizing');
    case 'completed': return t('chapter.draft.completed');
    default: return t('chapter.draft.starting');
  }
}

function draftError(kind: ChapterErrorKind | null) {
  switch (kind) {
    case 'codex_unavailable': return t('chapter.error.codexUnavailable');
    case 'login_required': return t('chapter.error.loginRequired');
    case 'usage_limit': return t('chapter.error.usageLimit');
    case 'timeout': return t('chapter.draft.error.timeout');
    case 'invalid_output': return t('chapter.draft.error.invalidOutput');
    case 'plan_missing': return t('chapter.error.planMissing');
    case 'project_unavailable': return t('chapter.error.projectUnavailable');
    case 'stale_chapter': return t('chapter.error.staleChapter');
    case 'already_complete': return t('chapter.error.alreadyComplete');
    case 'generation_busy': return t('chapter.error.generationBusy');
    case 'unexpected':
    default:
      return t('chapter.draft.error.unexpected');
  }
}
