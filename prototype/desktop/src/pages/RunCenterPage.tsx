import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { StatusLabel } from '../components/StatusLabel';
import { RecoveryDialog } from '../features/recovery/RecoveryDialog';
import {
  currentTask,
  getRecoveryFixture,
  getRecoveryCopyKey,
  recentTasks
} from '../fixtures/tasks';
import type { TaskStatus } from '../fixtures/types';
import { t } from '../i18n/t';

function RunTechnicalDetails() {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="nl-technical-details nl-run-center__technical"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>{t('run.technical')}</summary>
      {open && (
        <dl>
          <div>
            <dt>{t('run.technical.current')}</dt>
            <dd><code>{currentTask.technicalReference}</code></dd>
          </div>
        </dl>
      )}
    </details>
  );
}

export function RunCenterPage() {
  const [searchParams] = useSearchParams();
  const recovery = getRecoveryFixture(searchParams.get('recovery'));
  const [recoveryOpen, setRecoveryOpen] = useState(() => recovery !== null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(currentTask.status);
  const [taskResult, setTaskResult] = useState<string | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<string | null>(null);
  const taskStage = taskStatus === 'running'
    ? t('run.current.stage.running')
    : taskStatus === 'cancelling'
      ? t('run.current.stage.cancelling')
      : currentTask.stage;

  useEffect(() => {
    setRecoveryOpen(recovery !== null);
  }, [recovery]);

  return (
    <div className="nl-run-center">
      <header className="nl-run-center__header">
        <div>
          <p>{t('run.page.eyebrow')}</p>
          <h1>{t('run.page.title')}</h1>
          <span>{t('run.page.description')}</span>
        </div>
      </header>

      <section
        aria-labelledby="run-current-title"
        className="nl-run-current"
      >
        <header>
          <div>
            <p>{t('run.current.eyebrow')}</p>
            <h2 id="run-current-title">{t('run.current.title')}</h2>
          </div>
          <StatusLabel status={taskStatus} />
        </header>
        <div className="nl-run-current__body">
          <h3>{currentTask.title}</h3>
          <strong>{taskStage}</strong>
          <span>{currentTask.elapsed}</span>
          <p className="nl-run-current__safe-stage">{currentTask.lastSafeStage}</p>
          <p>{currentTask.destination}</p>
        </div>
        {taskResult && (
          <p className="nl-run-current__result" role="status">
            {taskResult}
          </p>
        )}
        <div className="nl-run-current__actions">
          {taskStatus === 'recoverable' && (
            <Button
              onClick={() => {
                setTaskStatus('running');
                setTaskResult(t('run.current.result.resume'));
              }}
            >
              {t('run.action.resume')}
            </Button>
          )}
          <Button
            disabled={taskStatus === 'cancelling'}
            onClick={() => {
              setTaskStatus('cancelling');
              setTaskResult(t('run.current.result.cancel'));
            }}
            variant="secondary"
          >
            {t('run.action.cancel')}
          </Button>
          {recovery && (
            <RecoveryDialog
              onActionComplete={(actionLabel, destructive) => {
                setRecoveryResult(
                  destructive
                    ? t('recovery.result.destructive', { action: actionLabel })
                    : t('recovery.result.safe', { action: actionLabel })
                );
              }}
              onOpenChange={setRecoveryOpen}
              open={recoveryOpen}
              recovery={recovery}
              triggerLabel={t('recovery.trigger', {
                label: t(getRecoveryCopyKey(recovery.key, 'short'))
              })}
            />
          )}
        </div>
      </section>

      {recoveryResult && (
        <div
          aria-label={t('recovery.result.label')}
          className="nl-recovery-result"
          role="status"
        >
          <strong>{t('recovery.result.label')}</strong>
          <p>{recoveryResult}</p>
        </div>
      )}

      <section
        aria-labelledby="run-recent-title"
        className="nl-run-recent"
      >
        <header>
          <h2 id="run-recent-title">{t('run.recent.title')}</h2>
          <span>{t('run.recent.description')}</span>
        </header>
        <ol>
          {recentTasks.map((task) => (
            <li key={task.title}>
              <strong>{task.title}</strong>
              <StatusLabel status={task.status} />
              <span>{task.elapsed}</span>
            </li>
          ))}
        </ol>
      </section>

      <RunTechnicalDetails />
    </div>
  );
}
