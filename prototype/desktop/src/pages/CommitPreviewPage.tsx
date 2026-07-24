import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle, WarningCircle, XCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { InlineNotice } from '../components/InlineNotice';
import { StatusLabel } from '../components/StatusLabel';
import { StoryRecordChangeGroup } from '../features/commit/StoryRecordChangeGroup';
import {
  chapterTwoCommitPreview,
  staleChapterTwoCommitPreview,
  type HighRiskDecision
} from '../fixtures/commitPreview';
import { t } from '../i18n/t';

const chapterPath = '/project/rain-radio/chapter/2';

function CommitTechnicalDetails({
  basis,
  reviewReference
}: {
  basis: string;
  reviewReference: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="nl-technical-details nl-commit-preview__technical"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>{t('commit.technical.title')}</summary>
      {open && (
        <dl>
          <div>
            <dt>{t('commit.technical.basis')}</dt>
            <dd><code>{basis}</code></dd>
          </div>
          <div>
            <dt>{t('commit.technical.review')}</dt>
            <dd><code>{reviewReference}</code></dd>
          </div>
        </dl>
      )}
    </details>
  );
}

export function CommitPreviewPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const stale = searchParams.get('state') === 'stale';
  const preview = stale ? staleChapterTwoCommitPreview : chapterTwoCommitPreview;
  const [decision, setDecision] = useState<HighRiskDecision | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const commitAvailable = !stale && decision === 'approve';
  const decisionState = stale
    ? t('commit.state.stale')
    : decision === 'approve'
      ? t('commit.state.ready')
      : decision === 'revise'
        ? t('commit.state.reviseRequired')
        : decision === 'reject'
          ? t('commit.state.rejectRequired')
          : t('commit.state.decisionRequired');

  return (
    <div className="nl-commit-preview">
      <header className="nl-commit-preview__header">
        <div>
          <StatusLabel status="commit_preview" />
          <p>{preview.sourceChapter}</p>
          <h1>{t('commit.page.title')}</h1>
          <span>{preview.acceptedDraftLabel}</span>
        </div>
        <Button onClick={() => navigate(chapterPath)} variant="secondary">
          {t('commit.action.back')}
        </Button>
      </header>

      <InlineNotice title={t('commit.unchanged.title')}>
        <p>{t('commit.unchanged.body')}</p>
      </InlineNotice>

      {stale && (
        <InlineNotice title={t('commit.stale.title')} tone="warning">
          <p>{t('commit.stale.body')}</p>
          <div className="nl-commit-preview__stale-actions">
            <Button onClick={() => setSearchParams({}, { replace: true })}>
              {t('commit.action.refresh')}
            </Button>
            <Button
              onClick={() => navigate('/project/rain-radio/story-record?view=pending')}
              variant="secondary"
            >
              {t('commit.action.inspect')}
            </Button>
          </div>
        </InlineNotice>
      )}

      <section
        aria-labelledby="commit-readiness-title"
        className="nl-commit-readiness"
      >
        <div>
          <h2 id="commit-readiness-title">{t('commit.readiness.title')}</h2>
          <p>{t('commit.readiness.body')}</p>
        </div>
        <ul>
          {preview.readiness.map((item) => {
            const ReadinessIcon = item.status === 'pass'
              ? CheckCircle
              : item.status === 'warning'
                ? WarningCircle
                : XCircle;

            return (
              <li className={`is-${item.status}`} key={item.label}>
                <ReadinessIcon
                  aria-label={t(`commit.readiness.status.${item.status}`)}
                  size={18}
                  weight="regular"
                />
                {item.label}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="nl-commit-change-list">
        {preview.groups.map((group) => (
          <StoryRecordChangeGroup group={group} key={group.kind} />
        ))}
      </div>

      <section
        aria-labelledby="commit-high-risk-title"
        className="nl-commit-high-risk"
      >
        <header>
          <WarningCircle aria-hidden="true" size={21} weight="regular" />
          <div>
            <p>{t('commit.highRisk.eyebrow')}</p>
            <h2 id="commit-high-risk-title">{t('commit.highRisk.title')}</h2>
          </div>
        </header>
        <div className="nl-commit-high-risk__change">
          <strong>{preview.highRisk.question}</strong>
          <span>{preview.highRisk.transition}</span>
          <p>{preview.highRisk.evidence}</p>
        </div>
        <fieldset>
          <legend>{t('commit.highRisk.decision')}</legend>
          <label>
            <input
              aria-label={t('commit.highRisk.approve')}
              checked={decision === 'approve'}
              name="high-risk-decision"
              onChange={() => setDecision('approve')}
              type="radio"
            />
            <span>
              <strong>{t('commit.highRisk.approve')}</strong>
              <small>{t('commit.highRisk.approveBody')}</small>
            </span>
          </label>
          <label>
            <input
              aria-label={t('commit.highRisk.revise')}
              checked={decision === 'revise'}
              name="high-risk-decision"
              onChange={() => setDecision('revise')}
              type="radio"
            />
            <span>
              <strong>{t('commit.highRisk.revise')}</strong>
              <small>{t('commit.highRisk.reviseBody')}</small>
            </span>
          </label>
          <label>
            <input
              aria-label={t('commit.highRisk.reject')}
              checked={decision === 'reject'}
              name="high-risk-decision"
              onChange={() => setDecision('reject')}
              type="radio"
            />
            <span>
              <strong>{t('commit.highRisk.reject')}</strong>
              <small>{t('commit.highRisk.rejectBody')}</small>
            </span>
          </label>
        </fieldset>
      </section>

      <CommitTechnicalDetails
        basis={preview.technical.basis}
        reviewReference={preview.technical.reviewReference}
      />

      {simulated && (
        <InlineNotice title={t('commit.simulation.title')}>
          <p>{t('commit.simulation.body')}</p>
        </InlineNotice>
      )}

      <footer className="nl-commit-preview__footer">
        <div>
          <strong>{decisionState}</strong>
          <span>{t('commit.state.readOnly')}</span>
        </div>
        <div className="nl-commit-preview__footer-actions">
          {(decision === 'revise' || decision === 'reject') && (
            <Button onClick={() => navigate(chapterPath)} variant="secondary">
              {t('commit.action.returnToEdit')}
            </Button>
          )}
          <Button
            disabled={!commitAvailable}
            id="formal-commit-trigger"
            onClick={() => setConfirmationOpen(true)}
          >
            {t('commit.action.submit')}
          </Button>
        </div>
      </footer>

      <Dialog.Root onOpenChange={setConfirmationOpen} open={confirmationOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="nl-modal-overlay" />
          <Dialog.Content
            className="nl-modal nl-commit-confirmation"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.getElementById('formal-commit-trigger')?.focus();
            }}
          >
            <Dialog.Title>{t('commit.dialog.title')}</Dialog.Title>
            <Dialog.Description>{t('commit.dialog.body')}</Dialog.Description>
            <p className="nl-commit-confirmation__restore">
              {t('commit.dialog.restorePoints')}
            </p>
            <p>{t('commit.dialog.prototype')}</p>
            <div className="nl-modal__actions">
              <Dialog.Close asChild>
                <Button variant="secondary">{t('commit.dialog.cancel')}</Button>
              </Dialog.Close>
              <Button
                onClick={() => {
                  setSimulated(true);
                  setConfirmationOpen(false);
                }}
              >
                {t('commit.dialog.confirm')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
