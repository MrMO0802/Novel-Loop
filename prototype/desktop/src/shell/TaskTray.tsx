import { CaretDown, CaretUp, CircleNotch, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { t } from '../i18n/t';

export type TaskTrayFixtureState = 'writing' | 'collecting' | 'cancelling' | 'timeout';

interface TaskTrayProps {
  initialState: TaskTrayFixtureState;
}

const stateLabels: Record<TaskTrayFixtureState, string> = {
  writing: t('chapter.task.writing'),
  collecting: t('chapter.task.collecting'),
  cancelling: t('chapter.task.cancelling'),
  timeout: t('chapter.task.timeout')
};

export function TaskTray({ initialState }: TaskTrayProps) {
  const [state, setState] = useState(initialState);
  const [expanded, setExpanded] = useState(initialState === 'timeout');
  const isRunning = state === 'writing' || state === 'collecting';
  const isTimeout = state === 'timeout';

  function cancelTask() {
    setState('cancelling');
    setExpanded(false);
  }

  function continueTask() {
    setState('writing');
    setExpanded(false);
  }

  return (
    <section
      aria-atomic="true"
      aria-label={t('chapter.task.label')}
      aria-live="polite"
      className={`nl-task-tray${expanded ? ' is-expanded' : ''}${isTimeout ? ' is-recoverable' : ''}`}
      role="status"
    >
      <div className="nl-task-tray__summary">
        {isTimeout ? (
          <WarningCircle aria-hidden="true" size={18} weight="regular" />
        ) : (
          <CircleNotch aria-hidden="true" size={18} weight="regular" />
        )}
        <span>{isTimeout ? t('chapter.task.timeoutTitle') : stateLabels[state]}</span>
        <div className="nl-task-tray__actions">
          {isRunning && <Button onClick={cancelTask} variant="quiet">{t('chapter.task.cancel')}</Button>}
          {isTimeout && (
            <>
              <Button onClick={continueTask} variant="secondary">{t('chapter.task.continue')}</Button>
              <IconButton
                icon={expanded ? CaretDown : CaretUp}
                label={expanded ? t('chapter.task.details.close') : t('chapter.task.details.open')}
                onClick={() => setExpanded((current) => !current)}
              />
            </>
          )}
        </div>
      </div>

      {isTimeout && expanded && (
        <div className="nl-task-tray__details">
          <strong>{t('chapter.task.timeoutTitle')}</strong>
          <p>{stateLabels.timeout}</p>
        </div>
      )}
    </section>
  );
}
