import { Info, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import type { DiagnosticFindingFixture } from '../../fixtures/diagnostics';
import { t } from '../../i18n/t';

export interface DiagnosticFindingProps {
  finding: DiagnosticFindingFixture;
}

export function DiagnosticFinding({ finding }: DiagnosticFindingProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const evidenceRef = useRef<HTMLDivElement>(null);
  const triggerWrapperRef = useRef<HTMLDivElement>(null);
  const hasOpenedEvidenceRef = useRef(false);
  const titleId = `diagnostic-${finding.id}-title`;
  const SeverityIcon = finding.severity === 'blocking' ? WarningCircle : Info;

  useEffect(() => {
    if (evidenceOpen) {
      hasOpenedEvidenceRef.current = true;
      evidenceRef.current?.focus();
    } else if (hasOpenedEvidenceRef.current) {
      triggerWrapperRef.current?.querySelector('button')?.focus();
    }
  }, [evidenceOpen]);

  return (
    <article aria-labelledby={titleId} className={`nl-diagnostic-finding nl-diagnostic-finding--${finding.severity}`}>
      <header className="nl-diagnostic-finding__header">
        <SeverityIcon aria-hidden="true" size={22} weight="regular" />
        <div>
          <p className="nl-diagnostic-finding__severity">
            {t(`diagnostics.severity.${finding.severity}`)}
          </p>
          <h2 id={titleId}>{finding.title}</h2>
        </div>
      </header>

      <p className="nl-diagnostic-finding__summary">{finding.summary}</p>

      <div
        aria-label={evidenceOpen ? t('diagnostics.evidence.region') : undefined}
        className="nl-diagnostic-evidence"
        ref={evidenceRef}
        role={evidenceOpen ? 'region' : undefined}
        tabIndex={evidenceOpen ? -1 : undefined}
      >
        <ul>
          {finding.evidence.map((evidence) => (
            <li key={evidence.paragraph}>
              <strong>{t('diagnostics.evidence.paragraph', { paragraph: evidence.paragraph })}</strong>
              <q>{evidence.excerpt}</q>
            </li>
          ))}
        </ul>
        {evidenceOpen && (
          <Button onClick={() => setEvidenceOpen(false)} variant="quiet">
            {t('diagnostics.action.return')}
          </Button>
        )}
      </div>

      <section className="nl-diagnostic-finding__importance">
        <h3>{t('diagnostics.why')}</h3>
        <p>{finding.whyItMatters}</p>
      </section>

      <div className="nl-diagnostic-finding__actions" ref={triggerWrapperRef}>
        <Button
          onClick={() => setEvidenceOpen(true)}
          variant="secondary"
        >
          {t('diagnostics.action.viewEvidence')}
        </Button>
      </div>

      <details
        className="nl-technical-details"
        onToggle={(event) => setTechnicalOpen(event.currentTarget.open)}
      >
        <summary>{t('diagnostics.technical.title')}</summary>
        {technicalOpen && (
          <dl>
            <div>
              <dt>{t('diagnostics.technical.rule')}</dt>
              <dd><code>{finding.technicalDetails.ruleName}</code></dd>
            </div>
            <div>
              <dt>{t('diagnostics.technical.reason')}</dt>
              <dd>{finding.technicalDetails.explanation}</dd>
            </div>
          </dl>
        )}
      </details>
    </article>
  );
}
