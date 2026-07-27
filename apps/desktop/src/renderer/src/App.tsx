import { ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise';
import { ArrowRight } from '@phosphor-icons/react/ArrowRight';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { DownloadSimple } from '@phosphor-icons/react/DownloadSimple';
import { ShieldCheck } from '@phosphor-icons/react/ShieldCheck';
import { SignIn } from '@phosphor-icons/react/SignIn';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType
} from 'react';

import type { SystemReadiness } from '../../shared/systemContract';
import { t } from './i18n/messages.zh-CN';

type ReadinessView =
  | { kind: 'loading' }
  | { kind: 'loaded'; readiness: SystemReadiness }
  | { kind: 'failed'; reason: 'error' | 'timeout' };

const READINESS_UI_TIMEOUT_MS = 20_000;

type StatusIcon = ComponentType<{
  'aria-hidden'?: boolean;
  size?: number;
  weight?: 'regular' | 'fill';
}>;

interface StatusPresentation {
  action: string;
  guide?: string;
  icon: StatusIcon;
  summary: string;
  title: string;
  tone: 'ready' | 'warning' | 'blocked';
}

export function App() {
  const requestId = useRef(0);
  const [view, setView] = useState<ReadinessView>({ kind: 'loading' });
  const [libraryOpen, setLibraryOpen] = useState(false);

  const checkReadiness = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setView({ kind: 'loading' });
    const timeout = window.setTimeout(() => {
      if (currentRequest === requestId.current) {
        requestId.current += 1;
        setView({ kind: 'failed', reason: 'timeout' });
      }
    }, READINESS_UI_TIMEOUT_MS);

    try {
      const readiness = await window.novelLoop.system.getReadiness();
      if (currentRequest === requestId.current) {
        setView({ kind: 'loaded', readiness });
      }
    } catch {
      if (currentRequest === requestId.current) {
        setView({ kind: 'failed', reason: 'error' });
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void checkReadiness();
    return () => {
      requestId.current += 1;
    };
  }, [checkReadiness]);

  if (libraryOpen) {
    return <LibraryPlaceholder onBack={() => setLibraryOpen(false)} />;
  }

  return (
    <main className="nl-setup">
      <section className="nl-setup__primary" aria-labelledby="setup-title">
        <div className="nl-brand">
          <BookOpenText aria-hidden size={26} weight="fill" />
          <span>{t('app.brand')}</span>
        </div>
        <p className="nl-eyebrow">{t('setup.eyebrow')}</p>
        <ReadinessContent
          onContinue={() => setLibraryOpen(true)}
          onRetry={() => void checkReadiness()}
          view={view}
        />
      </section>

      <aside className="nl-setup__assurance" aria-label="本地使用说明">
        <AssuranceItem
          body={t('setup.localData.body')}
          icon={ShieldCheck}
          title={t('setup.localData.title')}
        />
        <AssuranceItem
          body={t('setup.safety.body')}
          icon={CheckCircle}
          title={t('setup.safety.title')}
        />
      </aside>
    </main>
  );
}

function ReadinessContent({
  onContinue,
  onRetry,
  view
}: {
  onContinue: () => void;
  onRetry: () => void;
  view: ReadinessView;
}) {
  if (view.kind === 'loading') {
    return (
      <div className="nl-readiness nl-readiness--loading">
        <CircleNotch aria-hidden className="nl-spin" size={34} />
        <h1 id="setup-title">{t('setup.loading.title')}</h1>
        <p aria-live="polite" className="nl-readiness__summary" role="status">
          {t('setup.loading.summary')}
        </p>
      </div>
    );
  }

  const presentation = view.kind === 'failed'
    ? failedPresentation(view.reason)
    : presentationFor(view.readiness);
  const Icon = presentation.icon;
  const readiness = view.kind === 'loaded' ? view.readiness : null;
  const canContinue = readiness?.codex.status === 'ready'
    || (readiness?.codex.status === 'warning'
      && readiness.codex.canRunSmoke);

  return (
    <div className={`nl-readiness nl-readiness--${presentation.tone}`}>
      <Icon aria-hidden size={34} weight="fill" />
      <h1 id="setup-title">{presentation.title}</h1>
      <p aria-live="polite" className="nl-readiness__summary">
        {presentation.summary}
      </p>
      {presentation.guide && (
        <p className="nl-readiness__guide">{presentation.guide}</p>
      )}
      {readiness?.codex.version && (
        <p className="nl-readiness__version">{readiness.codex.version}</p>
      )}
      <button
        className="nl-primary-action"
        onClick={canContinue ? onContinue : onRetry}
        type="button"
      >
        {canContinue ? (
          <ArrowRight aria-hidden size={18} />
        ) : (
          <ArrowClockwise aria-hidden size={18} />
        )}
        {presentation.action}
      </button>
    </div>
  );
}

function presentationFor(readiness: SystemReadiness): StatusPresentation {
  switch (readiness.codex.status) {
    case 'ready':
      return {
        action: t('setup.ready.action'),
        icon: CheckCircle,
        summary: t('setup.ready.summary'),
        title: t('setup.ready.title'),
        tone: 'ready'
      };
    case 'not_installed':
      return {
        action: t('setup.notInstalled.action'),
        guide: t('setup.notInstalled.guide'),
        icon: DownloadSimple,
        summary: t('setup.notInstalled.summary'),
        title: t('setup.notInstalled.title'),
        tone: 'blocked'
      };
    case 'not_logged_in':
      return {
        action: t('setup.notLoggedIn.action'),
        guide: t('setup.notLoggedIn.guide'),
        icon: SignIn,
        summary: t('setup.notLoggedIn.summary'),
        title: t('setup.notLoggedIn.title'),
        tone: 'blocked'
      };
    case 'warning':
      return {
        action: t('setup.warning.action'),
        guide: t('setup.warning.guide'),
        icon: WarningCircle,
        summary: t('setup.warning.summary'),
        title: t('setup.warning.title'),
        tone: 'warning'
      };
    case 'unavailable':
      return unavailablePresentation();
  }
}

function unavailablePresentation(): StatusPresentation {
  return {
    action: t('setup.unavailable.action'),
    icon: WarningCircle,
    summary: t('setup.unavailable.summary'),
    title: t('setup.unavailable.title'),
    tone: 'blocked'
  };
}

function failedPresentation(
  reason: 'error' | 'timeout'
): StatusPresentation {
  if (reason === 'timeout') {
    return {
      action: t('setup.unavailable.action'),
      icon: WarningCircle,
      summary: t('setup.timeout.summary'),
      title: t('setup.timeout.title'),
      tone: 'blocked'
    };
  }

  return unavailablePresentation();
}

function AssuranceItem({
  body,
  icon: Icon,
  title
}: {
  body: string;
  icon: StatusIcon;
  title: string;
}) {
  return (
    <section className="nl-assurance-item">
      <Icon aria-hidden size={24} />
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </section>
  );
}

function LibraryPlaceholder({ onBack }: { onBack: () => void }) {
  return (
    <main className="nl-library-empty">
      <div className="nl-brand">
        <BookOpenText aria-hidden size={26} weight="fill" />
        <span>{t('app.brand')}</span>
      </div>
      <p className="nl-eyebrow">{t('library.eyebrow')}</p>
      <h1>{t('library.title')}</h1>
      <section aria-labelledby="empty-library-title">
        <h2 id="empty-library-title">{t('library.emptyTitle')}</h2>
        <p>{t('library.emptyBody')}</p>
      </section>
      <button className="nl-secondary-action" onClick={onBack} type="button">
        <ArrowClockwise aria-hidden size={18} />
        {t('library.back')}
      </button>
    </main>
  );
}
