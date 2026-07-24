import { CheckCircle, HardDrive, ShieldCheck } from '@phosphor-icons/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { InlineNotice } from '../components/InlineNotice';
import { t, type MessageKey } from '../i18n/t';
import '../styles/onboarding.css';

type ReadinessState = 'ready' | 'missing' | 'login' | 'warning';

const pageTitleKeys: Record<ReadinessState, MessageKey> = {
  ready: 'setup.page.ready',
  missing: 'setup.page.missing',
  login: 'setup.page.login',
  warning: 'setup.page.warning'
};

const readinessTitleKeys: Record<ReadinessState, MessageKey> = {
  ready: 'setup.\u0063odex.ready',
  missing: 'setup.\u0063odex.missing',
  login: 'setup.readiness.login',
  warning: 'setup.readiness.warning'
};

const readinessBodyKeys: Record<ReadinessState, MessageKey> = {
  ready: 'setup.readiness.readyBody',
  missing: 'setup.readiness.missingBody',
  login: 'setup.readiness.loginBody',
  warning: 'setup.readiness.warningBody'
};

const checkKeys: MessageKey[] = [
  'setup.check.installed',
  'setup.check.signedIn',
  'setup.check.writing',
  'setup.check.structured'
];

function ReadyChecklist() {
  return (
    <ul className="nl-readiness-list">
      {checkKeys.map((key) => (
        <li key={key}>
          <span>{t(key)}</span>
          <span className="nl-readiness-list__status">
            <CheckCircle aria-hidden="true" size={17} weight="fill" />
            {t('setup.check.available')}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FirstLaunchPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedState = searchParams.get('state');
  const state: ReadinessState = requestedState === 'missing'
    || requestedState === 'login'
    || requestedState === 'warning'
    ? requestedState
    : 'ready';
  const canContinue = state === 'ready' || state === 'warning';

  return (
    <div className="nl-page nl-page--setup">
      <header className="nl-page__header">
        <h1>{t(pageTitleKeys[state])}</h1>
      </header>

      <section className="nl-local-data" aria-labelledby="local-data-title">
        <ShieldCheck aria-hidden="true" size={28} weight="regular" />
        <div>
          <h2 id="local-data-title">{t('setup.localData.title')}</h2>
          <p>{t('setup.localData.body')}</p>
        </div>
      </section>

      <section className="nl-setup-section" aria-labelledby="readiness-title">
        <p className="nl-section-label">{t('setup.readiness.heading')}</p>
        <h2 id="readiness-title">{t(readinessTitleKeys[state])}</h2>
        <p className="nl-setup-section__body">{t(readinessBodyKeys[state])}</p>

        {canContinue && <ReadyChecklist />}

        {state === 'missing' && (
          <ol className="nl-guidance-list">
            <li>{t('setup.missing.first')}</li>
            <li>{t('setup.missing.second')}</li>
            <li>{t('setup.missing.third')}</li>
          </ol>
        )}

        {state === 'warning' && (
          <InlineNotice tone="warning">
            {t('setup.readiness.warningNotice')}
          </InlineNotice>
        )}

        <div className="nl-setup-section__actions">
          {state === 'missing' && (
            <>
              <Button variant="secondary">{t('setup.action.openGuide')}</Button>
              <Button>{t('setup.action.checkAgain')}</Button>
            </>
          )}
          {state === 'login' && (
            <>
              <Button variant="secondary">{t('setup.action.loginGuide')}</Button>
              <Button>{t('setup.action.checkAgain')}</Button>
            </>
          )}
          {state === 'warning' && (
            <>
              <Button variant="secondary">{t('setup.action.viewGuidance')}</Button>
              <Button variant="quiet">{t('setup.action.checkAgain')}</Button>
            </>
          )}
        </div>
      </section>

      <section className="nl-setup-section" aria-labelledby="storage-title">
        <div className="nl-section-heading">
          <HardDrive aria-hidden="true" size={20} weight="regular" />
          <h2 id="storage-title">{t('setup.storage.heading')}</h2>
        </div>
        <dl className="nl-preference-list">
          <div>
            <dt>{t('setup.storage.location')}</dt>
            <dd>{t('setup.storage.locationValue')}</dd>
          </div>
          <div>
            <dt>{t('setup.storage.backup')}</dt>
            <dd>{t('setup.storage.backupValue')}</dd>
          </div>
        </dl>
      </section>

      <footer className="nl-page__footer">
        {!canContinue && (
          <Button onClick={() => navigate('/library')} variant="quiet">
            {t('setup.action.continueManual')}
          </Button>
        )}
        {canContinue && (
          <Button onClick={() => navigate('/library')}>
            {t('setup.action.continue')}
          </Button>
        )}
      </footer>
    </div>
  );
}
