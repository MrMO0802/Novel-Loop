import { CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { Sparkle } from '@phosphor-icons/react/Sparkle';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ChapterAuthoringResult,
  ChapterTask,
  ChapterTaskStage,
  ChapterTaskStatus
} from '../../../../shared/chapterContract';
import { formatMessage, t } from '../../i18n/messages.zh-CN';
import { shouldAcceptChapterTask } from './chapterTaskOrdering';
import { ChapterRevisionCompare } from './ChapterRevisionCompare';

const POLL_INTERVAL_MS = 250;
const ACTIVE_STATUSES = new Set<ChapterTaskStatus>([
  'queued',
  'running',
  'stop_requested'
]);

interface ChapterAdjustmentPanelProps {
  artifactKind: 'mission' | 'plan';
  autoStart?: boolean;
  initialInstruction?: string;
  onAdopted: () => Promise<void>;
  onClose: () => void;
  onOutcome: (result: ChapterAuthoringResult) => void;
  optionToken?: string;
  projectKey: string;
  reviewToken: string;
  scopeTitle?: string;
  source: string;
}

export function ChapterAdjustmentPanel({
  artifactKind,
  autoStart = false,
  initialInstruction = '',
  onAdopted,
  onClose,
  onOutcome,
  optionToken,
  projectKey,
  reviewToken,
  scopeTitle,
  source
}: ChapterAdjustmentPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const autoStartIssued = useRef(false);
  const latestTask = useRef<ChapterTask | null>(null);
  const [instruction, setInstruction] = useState(initialInstruction);
  const [task, setTask] = useState<ChapterTask | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [localError, setLocalError] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  const receiveTask = useCallback((next: ChapterTask) => {
    if (!shouldAcceptChapterTask(latestTask.current, next)) return;
    latestTask.current = next;
    setTask(next);
    setStarting(false);
    setStopping(next.status === 'stop_requested');
    setLocalError(false);
  }, []);

  const start = useCallback(async () => {
    const authorInstruction = instruction.trim();
    if (starting || !authorInstruction || authorInstruction.length > 4_000) {
      return;
    }
    const generation = ++requestGeneration.current;
    latestTask.current = null;
    setTask(null);
    setStarting(true);
    setLocalError(false);
    try {
      const next = artifactKind === 'mission'
        ? await window.novelLoop.chapter.adjustMission({
          projectKey,
          reviewToken,
          authorInstruction
        })
        : await window.novelLoop.chapter.adjustPlan({
          projectKey,
          reviewToken,
          optionToken: optionToken ?? '',
          authorInstruction
        });
      if (mounted.current && generation === requestGeneration.current) {
        receiveTask(next);
      }
    } catch {
      if (mounted.current && generation === requestGeneration.current) {
        setStarting(false);
        setLocalError(true);
      }
    }
  }, [
    artifactKind,
    instruction,
    optionToken,
    projectKey,
    receiveTask,
    reviewToken,
    starting
  ]);

  useEffect(() => {
    if (!autoStart || autoStartIssued.current) return;
    autoStartIssued.current = true;
    void start();
  }, [autoStart, start]);

  useEffect(() => {
    if (!task || !ACTIVE_STATUSES.has(task.status)) return;
    let disposed = false;
    let timer: number | undefined;
    const taskId = task.taskId;
    const generation = requestGeneration.current;
    const schedule = () => {
      if (disposed || !mounted.current) return;
      timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    const poll = async () => {
      try {
        const next = await window.novelLoop.chapter.get({ taskId });
        if (
          mounted.current
          && !disposed
          && generation === requestGeneration.current
        ) {
          receiveTask(next);
          if (ACTIVE_STATUSES.has(next.status)) schedule();
        }
      } catch {
        if (
          mounted.current
          && !disposed
          && generation === requestGeneration.current
        ) {
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

  const cancel = async () => {
    if (!task?.canCancel || stopping) return;
    const generation = requestGeneration.current;
    const taskId = task.taskId;
    setStopping(true);
    try {
      const next = await window.novelLoop.chapter.cancel({ taskId });
      if (
        mounted.current
        && generation === requestGeneration.current
        && latestTask.current?.taskId === taskId
      ) {
        receiveTask(next);
      }
    } catch {
      if (mounted.current && generation === requestGeneration.current) {
        setStopping(false);
        setLocalError(true);
      }
    }
  };

  const adopt = async () => {
    const revisionToken = task?.resultRevisionToken;
    if (!revisionToken) return false;
    try {
      const result = await window.novelLoop.chapter.adoptRevision({
        projectKey,
        revisionToken,
        confirmInvalidation: true
      });
      if (result.outcome === 'adopted') {
        await onAdopted();
        return true;
      }
      onOutcome(result);
      return false;
    } catch {
      onOutcome({ outcome: 'invalid', messageKey: 'invalid_output' });
      return false;
    }
  };

  const expectedKind = artifactKind === 'mission'
    ? 'mission_adjustment'
    : 'plan_adjustment';
  const ready = task?.status === 'succeeded'
    && task.kind === expectedKind
    && task.resultCandidate?.artifactKind === artifactKind
    && task.resultRevisionToken;

  if (ready && task.resultCandidate) {
    return (
      <ChapterRevisionCompare
        artifactKind={artifactKind}
        backLabel={t('chapter.adjustment.keepCurrent')}
        candidate={task.resultCandidate.markdown}
        {...(scopeTitle === undefined ? {} : { fallbackTitle: scopeTitle })}
        onAdopt={adopt}
        onBack={onClose}
        source={source}
      />
    );
  }

  const active = starting || (task && ACTIVE_STATUSES.has(task.status));
  const heading = artifactKind === 'mission'
    ? t('chapter.adjustment.missionTitle')
    : formatMessage('chapter.adjustment.planTitle', {
      title: scopeTitle ?? t('chapter.direction.fallbackTitle')
    });

  return (
    <section
      aria-labelledby="chapter-adjustment-title"
      className="nl-chapter-adjustment"
    >
      <div className="nl-editor-heading">
        <div>
          <p className="nl-section-label">{t('chapter.adjustment.label')}</p>
          <h2 id="chapter-adjustment-title" ref={headingRef} tabIndex={-1}>
            {heading}
          </h2>
        </div>
      </div>
      <p className="nl-chapter-adjustment__scope">
        {t(artifactKind === 'mission'
          ? 'chapter.adjustment.missionScope'
          : 'chapter.adjustment.planScope')}
      </p>
      {!autoStart && (
        <label className="nl-field" htmlFor="chapter-adjustment-instruction">
          <span>{t('chapter.adjustment.instruction')}</span>
          <textarea
            disabled={Boolean(active)}
            id="chapter-adjustment-instruction"
            maxLength={4_000}
            onChange={(event) => setInstruction(event.currentTarget.value)}
            rows={5}
            value={instruction}
          />
        </label>
      )}
      {active && (
        <div className="nl-foundation-progress" role="status">
          <CircleNotch aria-hidden className="nl-spin" size={24} />
          <p className="nl-foundation-progress__stage">
            {starting
              ? t('chapter.adjustment.starting')
              : adjustmentStageLabel(task?.stage)}
          </p>
        </div>
      )}
      {(localError || task?.status === 'failed' || task?.status === 'cancelled') && (
        <p className="nl-inline-alert nl-inline-alert--error" role="alert">
          {task?.status === 'cancelled'
            ? t('chapter.adjustment.cancelled')
            : t('chapter.adjustment.failed')}
        </p>
      )}
      <div className="nl-editor-actions">
        <button
          className="nl-secondary-action"
          disabled={Boolean(active)}
          onClick={onClose}
          type="button"
        >
          {t('common.cancel')}
        </button>
        {task?.canCancel && (
          <button
            className="nl-secondary-action"
            disabled={stopping}
            onClick={() => void cancel()}
            type="button"
          >
            {t('chapter.adjustment.cancel')}
          </button>
        )}
        {!autoStart && (
          <button
            className="nl-primary-action"
            disabled={Boolean(active) || instruction.trim().length === 0}
            onClick={() => void start()}
            type="button"
          >
            <Sparkle aria-hidden size={18} weight="fill" />
            {t('chapter.adjustment.start')}
          </button>
        )}
      </div>
    </section>
  );
}

function adjustmentStageLabel(stage: ChapterTaskStage | undefined) {
  switch (stage) {
    case 'validating_adjustment':
      return t('chapter.adjustment.validating');
    case 'ready_for_review':
      return t('chapter.adjustment.ready');
    default:
      return t('chapter.adjustment.requesting');
  }
}
