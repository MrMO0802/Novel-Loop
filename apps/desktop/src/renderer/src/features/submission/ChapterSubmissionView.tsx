import { ArrowLeft, CheckCircle, Stop, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type {
  SubmissionConfirmResult, SubmissionIssue, SubmissionPreviewResult,
  SubmissionSafeErrorCode, SubmissionStage, SubmissionTask
} from '../../../../shared/submissionContract';
import { formatMessage, t, type MessageKey } from '../../i18n/messages.zh-CN';
import { SubmissionChanges } from './SubmissionChanges';
import { DiagnosticRevisionView } from './DiagnosticRevisionView';
import './submission.css';

export interface ChapterSubmissionViewProps {
  projectKey: string;
  onBack: () => void;
  onCommitted: (result: Extract<SubmissionConfirmResult, { outcome: 'committed' }>) => void;
}

type ReadyPreview = Extract<SubmissionPreviewResult, { outcome: 'ready' }>;
type Committed = Extract<SubmissionConfirmResult, { outcome: 'committed' }>;
type Phase = 'loading' | 'idle' | 'starting' | 'checking' | 'review' | 'problem' | 'success';
interface ActiveCheck {
  taskId: string;
  terminal: boolean;
  stopRequested: boolean;
  stopAcknowledged: boolean;
  cancelPending: boolean;
}
const stages: SubmissionStage[] = ['checking_source', 'diagnostics', 'proposing_patch', 'validating_patch'];
const errorMessages: Record<SubmissionSafeErrorCode, MessageKey> = {
  upgrade_required: 'submission.error.upgrade_required',
  codex_unavailable: 'submission.error.codex_unavailable',
  login_required: 'submission.error.login_required', usage_limit: 'submission.error.usage_limit',
  timeout: 'submission.error.timeout', invalid_output: 'submission.error.invalid_output',
  project_unavailable: 'submission.project_unavailable', source_missing: 'submission.error.source_missing',
  source_stale: 'submission.stale', working_copy_pending: 'submission.working_copy_pending',
  plan_missing: 'submission.plan_missing', already_committed: 'submission.error.already_committed',
  diagnostics_failed: 'submission.diagnostics_failed', patch_conflict: 'submission.blocked',
  generation_busy: 'submission.busy', unsafe_path: 'submission.error.unsafe_path',
  io_error: 'submission.error.io_error', recovery_required: 'submission.recovery_required',
  interrupted: 'submission.error.interrupted', unexpected: 'submission.error.unexpected'
};
const retryableErrors: SubmissionSafeErrorCode[] = [
  'upgrade_required', 'codex_unavailable', 'login_required', 'usage_limit', 'timeout',
  'invalid_output', 'source_stale', 'interrupted', 'unexpected'
];

// A project switch must discard approvals and all responses from the previous project.
export function ChapterSubmissionView(props: ChapterSubmissionViewProps) {
  return <SubmissionSession key={props.projectKey} {...props} />;
}

function SubmissionSession({ projectKey, onBack, onCommitted }: ChapterSubmissionViewProps) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [preview, setPreview] = useState<ReadyPreview | null>(null);
  const [task, setTask] = useState<SubmissionTask | null>(null);
  const [activeCheck, setActiveCheck] = useState<ActiveCheck | null>(null);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [issues, setIssues] = useState<SubmissionIssue[]>([]);
  const [canStart, setCanStart] = useState(false);
  const [canRead, setCanRead] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pollPaused, setPollPaused] = useState(false);
  const [progressWarning, setProgressWarning] = useState<MessageKey | null>(null);
  const [result, setResult] = useState<Committed | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [now, setNow] = useState(Date.now);
  const lifetime = useRef(0);
  const currentCheck = useRef<ActiveCheck | null>(null);
  const startLock = useRef(false);
  const confirmLock = useRef(false);
  const nextLock = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const wasDialogOpen = useRef(false);
  const titleId = useId();

  const problem = useCallback((key: MessageKey, retry = false, read = false, details: SubmissionIssue[] = []) => {
    setPreview(null);
    setReviewed(false);
    setMessage(key);
    setIssues(details);
    setCanStart(retry);
    setCanRead(read);
    setPhase('problem');
  }, []);

  const readPreview = useCallback(async () => {
    const epoch = lifetime.current;
    setPhase('loading');
    setReviewed(false);
    setPreview(null);
    setMessage(null);
    setIssues([]);
    try {
      const value = await window.novelLoop.submission.readPreview({ projectKey });
      if (epoch !== lifetime.current) return;
      if (value.outcome === 'committed') {
        setResult(value);
        setPhase('success');
      } else if (value.outcome === 'ready') {
        setPreview(value);
        setPhase('review');
      } else if (value.outcome === 'not_ready' && value.messageKey === 'submission.not_ready') {
        setIssues(value.issues);
        setCanStart(true);
        setCanRead(false);
        setPhase('idle');
      } else {
        const recovery = value.messageKey === 'submission.recovery_required';
        problem(recovery ? 'submission.recovery_required' : value.outcome === 'stale' ? 'submission.stale' : value.messageKey,
          !recovery && value.outcome === 'stale', !recovery, value.issues);
      }
    } catch {
      if (epoch === lifetime.current) problem('submission.readFailed', false, true);
    }
  }, [problem, projectKey]);

  useEffect(() => {
    void readPreview();
    return () => { lifetime.current += 1; currentCheck.current = null; };
  }, [readPreview]);

  useEffect(() => {
    if (!dialogOpen) {
      if (wasDialogOpen.current && phase === 'review') submitRef.current?.focus();
      else headingRef.current?.focus();
    }
    wasDialogOpen.current = dialogOpen;
  }, [dialogOpen, phase]);

  const acceptTask = useCallback(async (value: SubmissionTask, check: ActiveCheck) => {
    if (currentCheck.current !== check || check.terminal) return;
    if (value.taskId !== check.taskId || value.projectKey !== projectKey) throw new Error('Mismatched submission task');
    if (value.status === 'cancel_requested') {
      check.stopRequested = true;
      check.stopAcknowledged = true;
    }
    const active = value.status === 'running' || value.status === 'cancel_requested';
    setTask((previous) => ({
      ...value,
      status: active && check.stopRequested ? 'cancel_requested' : value.status,
      stage: active && previous?.taskId === value.taskId && stages.indexOf(previous.stage) > stages.indexOf(value.stage)
        ? previous.stage : value.stage
    }));
    if (active) return;
    check.terminal = true;
    setCancelling(false);
    setActiveCheck(null);
    setProgressWarning(null);
    if (value.status === 'ready') await readPreview();
    else if (value.status === 'cancelled') {
      setMessage('submission.cancelled');
      setIssues(value.issues);
      setCanStart(true);
      setCanRead(false);
      setPhase('idle');
    } else {
      const code = value.safeErrorCode ?? 'unexpected';
      problem(errorMessages[code], retryableErrors.includes(code), false, value.issues);
    }
  }, [problem, projectKey, readPreview]);

  useEffect(() => {
    if (!activeCheck || pollPaused) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await window.novelLoop.submission.get({ taskId: activeCheck.taskId });
        if (stopped) return;
        await acceptTask(value, activeCheck);
        if (!stopped && !activeCheck.terminal) timer = setTimeout(() => { void poll(); }, 750);
      } catch {
        if (!stopped && !activeCheck.terminal) {
          setPollPaused(true);
          setProgressWarning('submission.pollFailed');
        }
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [acceptTask, activeCheck, pollPaused]);

  useEffect(() => {
    if (phase !== 'checking') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [phase]);

  async function startCheck() {
    if (startLock.current || !canStart) return;
    startLock.current = true;
    const epoch = lifetime.current;
    setPhase('starting');
    setPreview(null);
    setReviewed(false);
    setTask(null);
    setMessage(null);
    setIssues([]);
    setProgressWarning(null);
    setPollPaused(false);
    setCancelling(false);
    try {
      const started = await window.novelLoop.submission.startCheck({ projectKey });
      if (epoch !== lifetime.current) return;
      const check: ActiveCheck = {
        taskId: started.taskId, terminal: false, stopRequested: false,
        stopAcknowledged: false, cancelPending: false
      };
      currentCheck.current = check;
      setActiveCheck(check);
      setPhase('checking');
    } catch {
      if (epoch === lifetime.current) problem('submission.startFailed', false, true);
    } finally {
      startLock.current = false;
    }
  }

  async function cancelCheck() {
    const check = currentCheck.current;
    if (!check || check.terminal || check.stopRequested || check.cancelPending) return;
    check.cancelPending = true;
    check.stopRequested = true;
    setCancelling(true);
    setProgressWarning(null);
    const epoch = lifetime.current;
    try {
      const value = await window.novelLoop.submission.cancel({ taskId: check.taskId });
      if (epoch !== lifetime.current) return;
      await acceptTask(value, check);
    } catch {
      if (epoch === lifetime.current && currentCheck.current === check && !check.terminal && !check.stopAcknowledged) {
        check.stopRequested = false;
        setTask((previous) => previous?.status === 'cancel_requested' ? { ...previous, status: 'running' } : previous);
        setProgressWarning('submission.cancelFailed');
      }
    } finally {
      check.cancelPending = false;
      if (epoch === lifetime.current && currentCheck.current === check) setCancelling(false);
    }
  }

  async function confirmSubmission() {
    if (!preview || !reviewed || !dialogOpen || confirmLock.current) return;
    confirmLock.current = true;
    setConfirming(true);
    const epoch = lifetime.current;
    try {
      const confirmed = await window.novelLoop.submission.confirm({ projectKey, previewToken: preview.previewToken, confirm: true });
      if (epoch !== lifetime.current) return;
      if (confirmed.outcome === 'committed') {
        setResult(confirmed);
        setPreview(null);
        setPhase('success');
      } else {
        const recovery = confirmed.outcome === 'recovery_required' || confirmed.messageKey === 'submission.recovery_required';
        problem(recovery ? 'submission.recovery_required' : confirmed.outcome === 'stale' ? 'submission.stale' : confirmed.messageKey,
          !recovery && confirmed.outcome === 'stale', !recovery && confirmed.outcome !== 'stale');
      }
    } catch {
      if (epoch === lifetime.current) problem('submission.confirmUnknown', false, true);
    } finally {
      if (epoch === lifetime.current) { setDialogOpen(false); setConfirming(false); }
      confirmLock.current = false;
    }
  }

  const title = result ? formatMessage('submission.success', { chapter: result.chapterNumber })
    : preview ? formatMessage('submission.ready', { chapter: preview.chapterNumber }) : t('submission.title');
  const stopRequested = cancelling || task?.status === 'cancel_requested';
  const status = phase === 'loading' ? t('submission.loading')
    : phase === 'starting' ? t('submission.starting')
      : phase === 'checking' ? [stopRequested ? t('submission.stopping') : task ? t(`submission.stage.${task.stage}`) : t('submission.starting'), progressWarning ? t(progressWarning) : ''].join(' ')
        : phase === 'review' ? t('submission.notCommitted') : phase === 'success' ? title
          : phase === 'idle' && message ? t(message) : '';

  if (revisionOpen) return <DiagnosticRevisionView projectKey={projectKey} onBack={() => { setRevisionOpen(false); void readPreview(); }} onRecheck={() => {
    setRevisionOpen(false); setPreview(null); setTask(null); setMessage(null); setIssues([]); setCanStart(true); setCanRead(false); setPhase('idle');
  }} />;
  return (
    <section className="nl-submission" aria-labelledby={titleId}>
      <div className="nl-submission__page" inert={dialogOpen}>
        <header className="nl-submission__header">
          {phase !== 'success' && <button className="nl-submission-button" type="button" disabled={phase === 'starting'} onClick={onBack}><ArrowLeft aria-hidden size={18} />{t('submission.back')}</button>}
          <h1 id={titleId} ref={headingRef} tabIndex={-1}>{title}</h1>
          <p role="status" aria-live="polite" aria-atomic="true">{status}</p>
        </header>
        <div className="nl-submission__body" role="region" aria-label={t('submission.contents')} tabIndex={0}>
          {phase === 'problem' && message && <p className="nl-submission-alert" role="alert"><WarningCircle aria-hidden size={20} />{t(message)}</p>}
          {(phase === 'idle' || phase === 'starting') && <section className="nl-submission-intro"><p>{t('submission.intro')}</p><p>{t('submission.boundary')}</p></section>}
          {phase === 'checking' && <section>
            <ol className="nl-submission-stages" aria-label={t('submission.progress')}>
              {stages.map((stage, index) => <li key={stage} aria-current={stage === task?.stage ? 'step' : undefined}>
                <span aria-hidden>{index + 1}</span>{t(`submission.stage.${stage}`)}
                {task && index < stages.indexOf(task.stage) && <CheckCircle aria-label={t('chapter.common.stageCompleted')} size={18} />}
              </li>)}
            </ol>
            {task && <p className="nl-submission-elapsed">{formatMessage('submission.elapsed', { seconds: Math.max(0, Math.floor((now - Date.parse(task.startedAt)) / 1_000)) })}</p>}
          </section>}
          {issues.length > 0 && <section className="nl-submission-issues" aria-label={t('submission.issues')}>
            <h2>{t('submission.issues')}</h2>
            <ul>{issues.map((issue, index) => <li key={index}>
              <strong>{t(`submission.severity.${issue.severity}`)}</strong><p>{issue.message}</p>
              {issue.evidence && <blockquote aria-label={t('submission.evidence')}>{issue.evidence}</blockquote>}
            </li>)}</ul>
          </section>}
          {preview && <>
            <section className="nl-submission-source" aria-label={t('submission.source')}>
              <h2>{t('submission.source')}</h2><p>{t(`submission.draft.${preview.draft.kind}`)}</p>
              <h3>{preview.draft.label}</h3><p>{preview.draft.summary}</p>
            </section>
            {preview.warnings.length > 0 && <section className="nl-submission-warnings" aria-label={t('submission.warnings')}>
              <h2>{t('submission.warnings')}</h2><ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            </section>}
            <SubmissionChanges changes={preview.changes} />
          </>}
        </div>
        <footer className="nl-submission__actions">
          {phase === 'problem' && message === 'submission.diagnostics_failed' && <button className="nl-submission-button nl-submission-button--primary" onClick={() => setRevisionOpen(true)}>{t('diagnosticRevision.entry')}</button>}
          {((phase === 'idle' || phase === 'problem') && canStart || phase === 'starting') && <button type="button" className="nl-submission-button nl-submission-button--primary" disabled={phase === 'starting'} onClick={() => { void startCheck(); }}>{t(phase === 'idle' && !message || phase === 'starting' ? 'submission.start' : 'submission.retry')}</button>}
          {phase === 'problem' && canRead && <button type="button" className="nl-submission-button" onClick={() => { void readPreview(); }}>{t('submission.refresh')}</button>}
          {phase === 'checking' && <>
            {pollPaused && <button type="button" className="nl-submission-button" onClick={() => { setProgressWarning(null); setPollPaused(false); }}>{t('submission.refreshProgress')}</button>}
            <button type="button" className="nl-submission-button" disabled={stopRequested} onClick={() => { void cancelCheck(); }}><Stop aria-hidden size={18} />{t('submission.stop')}</button>
          </>}
          {preview && <>
            <label className="nl-submission-approval"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />{t('submission.reviewed')}</label>
            <button ref={submitRef} type="button" className="nl-submission-button nl-submission-button--primary" disabled={!reviewed} onClick={() => setDialogOpen(true)}>{formatMessage('submission.submit', { chapter: preview.chapterNumber })}</button>
          </>}
          {result && <button type="button" className="nl-submission-button nl-submission-button--primary" disabled={continuing} onClick={() => {
            if (nextLock.current) return;
            nextLock.current = true;
            setContinuing(true);
            onCommitted(result);
          }}>{t(result.hasNextChapter ? 'submission.next' : 'submission.planning')}</button>}
        </footer>
      </div>
      {dialogOpen && preview && <SubmissionConfirmation chapterNumber={preview.chapterNumber} pending={confirming} onCancel={() => setDialogOpen(false)} onConfirm={() => { void confirmSubmission(); }} />}
    </section>
  );
}

function SubmissionConfirmation({ chapterNumber, pending, onCancel, onConfirm }: {
  chapterNumber: number; pending: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const focus = () => { (pending ? dialogRef.current : cancelRef.current)?.focus(); };
    focus();
    const constrainFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) focus();
    };
    document.addEventListener('focusin', constrainFocus);
    return () => document.removeEventListener('focusin', constrainFocus);
  }, [pending]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); if (!pending) onCancel(); }
    // No implicit/default submission. Keyboard activation still works on a focused button.
    if (event.key === 'Enter' && event.target === dialogRef.current) event.preventDefault();
    if (event.key !== 'Tab') return;
    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const first = buttons?.[0];
    const last = buttons?.[buttons.length - 1];
    if (!first || !last) { event.preventDefault(); dialogRef.current?.focus(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
  }

  return <div className="nl-submission-backdrop">
    <section className="nl-submission-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={pending} tabIndex={-1} ref={dialogRef} onKeyDown={handleKeyDown}>
      <h2 id={titleId}>{formatMessage('submission.confirmTitle', { chapter: chapterNumber })}</h2>
      <p id={descriptionId}>{t('submission.confirmBody')}</p>
      {pending && <p role="status">{t('submission.committing')}</p>}
      <div className="nl-submission-dialog__actions">
        <button className="nl-submission-button" type="button" disabled={pending} ref={cancelRef} onClick={onCancel}>{t('submission.continueReview')}</button>
        <button className="nl-submission-button nl-submission-button--primary" type="button" disabled={pending} onClick={onConfirm}>{t('submission.confirm')}</button>
      </div>
    </section>
  </div>;
}
