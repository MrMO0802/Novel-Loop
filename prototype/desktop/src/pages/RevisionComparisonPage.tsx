import { CheckCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  usePrototypeContext,
  type ChapterRevisionDisposition
} from '../app/PrototypeContext';
import { Button } from '../components/Button';
import { InlineNotice } from '../components/InlineNotice';
import { StatusLabel } from '../components/StatusLabel';
import { DiagnosticFinding } from '../features/diagnostics/DiagnosticFinding';
import { ParagraphDiff, type ComparisonMode } from '../features/revisions/ParagraphDiff';
import { chapterTwoDiagnostics } from '../fixtures/diagnostics';
import { rainRadio } from '../fixtures/rainRadio';
import { chapterTwoRevision } from '../fixtures/revisions';
import { t } from '../i18n/t';

const chapterPath = '/project/rain-radio/chapter/2';
const reviewPath = `${chapterPath}/review`;
const revisionPath = `${chapterPath}/revision`;

type CandidateDecision = ChapterRevisionDisposition | null;

export function ChapterDiagnosticsPage() {
  const navigate = useNavigate();

  return (
    <div className="nl-review-page">
      <header className="nl-review-page__header">
        <div>
          <p>{t('diagnostics.page.context')}</p>
          <h1>{t('diagnostics.page.title')}</h1>
          <span>{chapterTwoDiagnostics.overview}</span>
        </div>
        <Button onClick={() => navigate(`${chapterPath}?focus=review`)} variant="secondary">
          {t('revision.action.backChapter')}
        </Button>
      </header>

      <InlineNotice title={t('diagnostics.record.title')}>
        <p>{t('diagnostics.record.body')}</p>
      </InlineNotice>

      <div className="nl-diagnostic-list">
        {chapterTwoDiagnostics.findings.map((finding) => (
          <DiagnosticFinding finding={finding} key={finding.id} />
        ))}
      </div>

      <footer className="nl-review-page__footer">
        <div>
          <strong>{t('diagnostics.next.title')}</strong>
          <span>{t('diagnostics.next.body')}</span>
        </div>
        <Button onClick={() => navigate(revisionPath)}>
          {t('diagnostics.action.compare')}
        </Button>
      </footer>
    </div>
  );
}

function DecisionNotice({ decision }: { decision: Exclude<CandidateDecision, null> }) {
  if (decision === 'accepted') {
    return (
      <div className="nl-revision-decision nl-revision-decision--accepted">
        <InlineNotice title={t('revision.decision.acceptedTitle')}>
          <p>{t('revision.decision.acceptedBody')}</p>
        </InlineNotice>
      </div>
    );
  }

  if (decision === 'rejected') {
    return (
      <div className="nl-revision-decision">
        <InlineNotice title={t('revision.decision.rejectedTitle')} tone="warning">
          <p>{t('revision.decision.rejectedCurrent')}</p>
          <p>{t('revision.decision.rejectedBody')}</p>
        </InlineNotice>
      </div>
    );
  }

  return (
    <div className="nl-revision-decision">
      <InlineNotice title={t('revision.decision.alternateTitle')}>
        <p>{t('revision.decision.alternateCurrent')}</p>
        <p>{t('revision.decision.alternateCandidate')}</p>
      </InlineNotice>
    </div>
  );
}

export function RevisionComparisonPage() {
  const {
    chapterDrafts,
    chapterRevisions,
    decideChapterRevision,
    updateAcceptedChapterDraft
  } = usePrototypeContext();
  const navigate = useNavigate();
  const chapterDraftKey = 'rain-radio:chapter:2';
  const revision = chapterRevisions.get(chapterDraftKey);
  const decision = revision?.disposition ?? null;
  const currentSourceDraft = chapterDrafts.get(chapterDraftKey)
    ?? rainRadio.chapterWorkspace.versions.draft;
  const candidateIsFresh = currentSourceDraft === chapterTwoRevision.sourceDraft;
  const [mode, setMode] = useState<ComparisonMode>('side-by-side');
  const acceptedDraft = revision?.acceptedDraft ?? chapterTwoRevision.candidateDraft;

  function decide(disposition: ChapterRevisionDisposition) {
    if (
      !candidateIsFresh
      && (disposition === 'accepted' || disposition === 'alternate')
    ) {
      return;
    }

    decideChapterRevision(
      chapterDraftKey,
      disposition,
      currentSourceDraft,
      chapterTwoRevision.candidateDraft
    );
  }

  function updateAcceptedDraft(draft: string) {
    updateAcceptedChapterDraft(chapterDraftKey, draft);
  }

  return (
    <div className="nl-review-page nl-revision-page">
      <header className="nl-review-page__header nl-revision-page__header">
        <div>
          <StatusLabel status="revision_candidate" />
          <h1>{t('revision.page.title')}</h1>
          <span>{t('revision.page.description')}</span>
        </div>
        <div className="nl-revision-page__header-actions">
          <Button onClick={() => navigate(reviewPath)} variant="quiet">
            {t('revision.action.viewReview')}
          </Button>
          <Button onClick={() => navigate(`${chapterPath}?focus=review`)} variant="secondary">
            {t('revision.action.backChapter')}
          </Button>
        </div>
      </header>

      {!candidateIsFresh && (
        <InlineNotice title={t('revision.stale.title')} tone="warning">
          <p>{t('revision.stale.body')}</p>
        </InlineNotice>
      )}

      {decision && <DecisionNotice decision={decision} />}

      {decision === 'accepted' && (
        <section className="nl-accepted-draft" aria-labelledby="accepted-draft-title">
          <h2 id="accepted-draft-title">{t('revision.accepted.editorTitle')}</h2>
          <textarea
            aria-label={t('revision.accepted.editorLabel')}
            onChange={(event) => updateAcceptedDraft(event.currentTarget.value)}
            spellCheck="false"
            value={acceptedDraft}
          />
        </section>
      )}

      <div className="nl-revision-toolbar">
        <div aria-label={t('revision.mode.label')} className="nl-revision-mode" role="group">
          <Button
            aria-pressed={mode === 'side-by-side'}
            onClick={() => setMode('side-by-side')}
            variant="quiet"
          >
            {t('revision.mode.sideBySide')}
          </Button>
          <Button
            aria-pressed={mode === 'unified'}
            onClick={() => setMode('unified')}
            variant="quiet"
          >
            {t('revision.mode.unified')}
          </Button>
        </div>
        <span>{t('revision.mode.hint')}</span>
      </div>

      <ParagraphDiff changes={chapterTwoRevision.changes} mode={mode} />

      <section className="nl-revision-reason" aria-labelledby="revision-reason-title">
        <h2 id="revision-reason-title">{t('revision.reason.title')}</h2>
        <p>{chapterTwoRevision.changeReason}</p>
      </section>

      <div className="nl-revision-outcome">
        <section aria-labelledby="resolved-issues-title">
          <h2 id="resolved-issues-title">{t('revision.resolved.title')}</h2>
          <ul>
            {chapterTwoRevision.resolvedIssues.map((issue) => (
              <li key={issue}>
                <CheckCircle aria-hidden="true" size={18} weight="regular" />
                {issue}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="new-issues-title">
          <h2 id="new-issues-title">{t('revision.newIssues.title')}</h2>
          <p>
            <CheckCircle aria-hidden="true" size={18} weight="regular" />
            {chapterTwoRevision.newIssueSummary}
          </p>
        </section>
      </div>

      <InlineNotice title={t('revision.record.title')}>
        <p>{t('revision.record.body')}</p>
      </InlineNotice>

      <footer className="nl-revision-actions">
        <Button
          disabled={decision !== null}
          onClick={() => decide('rejected')}
          variant="quiet"
        >
          {t('revision.action.reject')}
        </Button>
        <Button
          disabled={decision !== null || !candidateIsFresh}
          onClick={() => decide('alternate')}
          variant="secondary"
        >
          {t('revision.action.keepAlternate')}
        </Button>
        <Button
          disabled={decision !== null || !candidateIsFresh}
          onClick={() => decide('accepted')}
        >
          {t('revision.action.accept')}
        </Button>
      </footer>
    </div>
  );
}
