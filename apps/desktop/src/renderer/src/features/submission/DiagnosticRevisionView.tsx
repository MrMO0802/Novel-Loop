import { ArrowLeft, ArrowsClockwise, Check, Stop, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { DiagnosticRevisionResponse } from '../../../../shared/diagnosticRevisionContract';
import { SafeChapterMarkdown } from '../chapter/ChapterDirectionChooser';
import { t } from '../../i18n/messages.zh-CN';

type Candidate = Extract<DiagnosticRevisionResponse, { outcome: 'candidate' }>['candidate'];
type Task = Extract<DiagnosticRevisionResponse, { outcome: 'task' }>['task'];
export function DiagnosticRevisionView(props: { projectKey: string; onBack(): void; onRecheck(): void }) {
  return <RevisionSession key={props.projectKey} {...props} />;
}
function RevisionSession({ projectKey, onBack, onRecheck }: { projectKey: string; onBack(): void; onRecheck(): void }) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pollPaused, setPollPaused] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const active = task?.status === 'running' || task?.status === 'cancel_requested';
  const accept = (response: DiagnosticRevisionResponse) => {
    if (!alive.current) return;
    if (response.outcome === 'error') { setMessage(errorMessage(response.code)); return; }
    setMessage('');
    if (response.outcome === 'candidate') { setCandidate(response.candidate); setTask(null); }
    if (response.outcome === 'task') {
      setTask(response.task);
      if (response.task.safeErrorCode) setMessage(errorMessage(response.task.safeErrorCode));
      if (response.task.status === 'cancelled') setMessage(t('diagnosticRevision.cancelled'));
    }
    if (response.outcome === 'adopted') { setCandidate(previous => previous ? { ...previous, status: 'adopted', canAdopt: false } : previous); setConfirming(false); }
    if (response.outcome === 'rejected') { setCandidate(previous => previous ? { ...previous, status: 'rejected', canAdopt: false } : previous); setConfirming(false); }
  };
  async function perform(operation: () => Promise<DiagnosticRevisionResponse>) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { accept(await operation()); }
    catch { if (alive.current) setMessage(t('diagnosticRevision.unavailable')); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    void perform(() => window.novelLoop.diagnosticRevision.read({ projectKey }));
    return () => { alive.current = false; };
  }, [projectKey]);
  useEffect(() => { heading.current?.focus(); }, [confirming, candidate?.status, message]);
  useEffect(() => {
    if (!task || !active || pollPaused) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await window.novelLoop.diagnosticRevision.get({ projectKey, taskId: task.taskId });
        if (stopped) return;
        if (response.outcome === 'task' && response.task.taskId !== task.taskId) throw new Error();
        if (response.outcome === 'task' && response.task.status === 'ready' && response.task.candidateId) {
          const result = await window.novelLoop.diagnosticRevision.read({ projectKey, candidateId: response.task.candidateId });
          if (!stopped) accept(result);
        } else {
          accept(response);
          if (response.outcome === 'task' && ['running', 'cancel_requested'].includes(response.task.status)) timer = setTimeout(() => { void poll(); }, 750);
          else if (response.outcome === 'error') setPollPaused(true);
        }
      } catch { if (!stopped) { setPollPaused(true); setMessage(t('diagnosticRevision.unavailable')); } }
    };
    timer = setTimeout(() => { void poll(); }, 750);
    return () => { stopped = true; clearTimeout(timer); };
  }, [task?.taskId, active, pollPaused, projectKey]);

  return <section className="nl-submission nl-diagnostic-revision" aria-label={t('diagnosticRevision.title')}>
    <button className="nl-submission-button" type="button" disabled={busy} onClick={onBack}><ArrowLeft aria-hidden size={18} />{t('diagnosticRevision.back')}</button>
    <h1 ref={heading} tabIndex={-1}>{t('diagnosticRevision.title')}</h1>
    {message && <p className="nl-submission-alert" role="alert">{message}</p>}
    {!candidate && !active && <p>{t('diagnosticRevision.boundary')}</p>}
    {active && <div role="status"><p>{t(`diagnosticRevision.stage.${task!.stage}`)}</p><p>{t('diagnosticRevision.boundary')}</p></div>}
    {candidate && <>
      {candidate.status === 'adopted' ? <p role="status">{t('diagnosticRevision.adopted')}</p> : candidate.status === 'rejected' ? <p role="status">{t('diagnosticRevision.rejected')}</p> : <p>{t('diagnosticRevision.unverified')}</p>}
      {!candidate.canAdopt && candidate.status === 'pending' && <p role="alert">{t('diagnosticRevision.stale')}</p>}
      <div className="nl-diagnostic-revision__compare">
        <section aria-label={t('diagnosticRevision.source')}><h2>{t('diagnosticRevision.source')}</h2><SafeChapterMarkdown markdown={candidate.source} /></section>
        <section aria-label={t('diagnosticRevision.candidate')}><h2>{t('diagnosticRevision.candidate')}</h2><SafeChapterMarkdown markdown={candidate.markdown} /></section>
      </div>
      <details><summary>{t('diagnosticRevision.diff')}</summary><ParagraphChanges source={candidate.source} candidate={candidate.markdown} /></details>
      <h2>{t('diagnosticRevision.reasons')}</h2><ul>{candidate.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
    </>}
    <div className="nl-submission__actions">
      {!active && !confirming && (!candidate || ['rejected', 'stale'].includes(candidate.status)) && <button className="nl-submission-button nl-submission-button--primary" disabled={busy} onClick={() => { setCandidate(null); setPollPaused(false); void perform(() => window.novelLoop.diagnosticRevision.start({ projectKey, diagnosticTaskId: 'latest' })); }}><ArrowsClockwise aria-hidden size={18} />{t('diagnosticRevision.generate')}</button>}
      {active && <button className="nl-submission-button" disabled={busy || task?.status === 'cancel_requested'} onClick={() => { void perform(() => window.novelLoop.diagnosticRevision.cancel({ projectKey, taskId: task!.taskId })); }}><Stop aria-hidden size={18} />{t('diagnosticRevision.cancel')}</button>}
      {pollPaused && <button className="nl-submission-button" onClick={() => { setPollPaused(false); setMessage(''); }}>{t('diagnosticRevision.refresh')}</button>}
      {candidate?.status === 'pending' && !confirming && <>
        <button className="nl-submission-button nl-submission-button--primary" disabled={busy || !candidate.canAdopt} onClick={() => setConfirming(true)}><Check aria-hidden size={18} />{t('diagnosticRevision.adopt')}</button>
        <button className="nl-submission-button" disabled={busy} onClick={() => { void perform(() => window.novelLoop.diagnosticRevision.reject({ projectKey, candidateId: candidate.candidateId })); }}><X aria-hidden size={18} />{t('diagnosticRevision.reject')}</button>
      </>}
      {confirming && candidate && <section aria-label={t('diagnosticRevision.confirm')}>
        <p>{t('diagnosticRevision.confirmNote')}</p>
        <button className="nl-submission-button" disabled={busy} onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
        <button className="nl-submission-button nl-submission-button--primary" disabled={busy} onClick={() => { void perform(() => window.novelLoop.diagnosticRevision.adopt({ projectKey, candidateId: candidate.candidateId })); }}>{t('diagnosticRevision.confirm')}</button>
      </section>}
      {!active && !busy && <button className="nl-submission-button" onClick={onRecheck}>{t('diagnosticRevision.recheck')}</button>}
    </div>
  </section>;
}

// Paragraph positions are shown explicitly; inserted/deleted paragraphs remain visible.
function ParagraphChanges({ source, candidate }: { source: string; candidate: string }) {
  const before = source.split(/\r?\n\s*\r?\n/u);
  const after = candidate.split(/\r?\n\s*\r?\n/u);
  return <ol className="nl-diagnostic-revision__diff">{Array.from({ length: Math.max(before.length, after.length) }, (_, index) => before[index] === after[index] ? null : <li key={index} value={index + 1}><del>{before[index] ?? ''}</del><ins>{after[index] ?? ''}</ins></li>)}</ol>;
}
function errorMessage(code: string) {
  if (code === 'source_stale') return t('diagnosticRevision.stale');
  if (code === 'working_copy_pending') return t('submission.working_copy_pending');
  if (code === 'recovery_required') return t('submission.recovery_required');
  if (code === 'usage_limit') return t('submission.error.usage_limit');
  if (code === 'timeout') return t('submission.error.timeout');
  if (code === 'login_required') return t('submission.error.login_required');
  if (code === 'invalid_output') return t('submission.error.invalid_output');
  if (code === 'interrupted') return t('submission.error.interrupted');
  return t('diagnosticRevision.unavailable');
}
