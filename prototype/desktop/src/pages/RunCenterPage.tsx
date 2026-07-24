import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { StatusLabel } from '../components/StatusLabel';
import { RecoveryDialog } from '../features/recovery/RecoveryDialog';
import {
  currentTask,
  getRecoveryFixture,
  recentTasks
} from '../fixtures/tasks';
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
          <StatusLabel status={currentTask.status} />
        </header>
        <div className="nl-run-current__body">
          <h3>{currentTask.title}</h3>
          <strong>{currentTask.stage}</strong>
          <span>{currentTask.elapsed}</span>
          <p className="nl-run-current__safe-stage">{currentTask.lastSafeStage}</p>
          <p>{currentTask.destination}</p>
        </div>
        <div className="nl-run-current__actions">
          <Button>{t('run.action.resume')}</Button>
          <Button variant="secondary">{t('run.action.cancel')}</Button>
          {recovery && (
            <RecoveryDialog
              onOpenChange={setRecoveryOpen}
              open={recoveryOpen}
              recovery={recovery}
              triggerLabel={t('recovery.trigger', { label: recovery.shortLabel })}
            />
          )}
        </div>
      </section>

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
