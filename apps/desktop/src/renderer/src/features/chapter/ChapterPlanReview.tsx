import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent
} from 'react';

import type {
  ChapterPlanReviewResult
} from '../../../../shared/chapterContract';
import type { ProjectSummary } from '../../../../shared/projectContract';
import { formatMessage, t } from '../../i18n/messages.zh-CN';

interface ChapterPlanReviewProps {
  onBack: () => void;
  onGenerateDraft: () => void;
  project: ProjectSummary;
}

export function ChapterPlanReview({
  onBack,
  onGenerateDraft,
  project
}: ChapterPlanReviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestToken = useRef(0);
  const [review, setReview] = useState<ChapterPlanReviewResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
    const currentRequest = ++requestToken.current;
    void window.novelLoop.chapter.readPlan({
      projectKey: project.projectKey
    }).then((result) => {
      if (currentRequest !== requestToken.current) return;
      setReview(result);
      setFailed(!result.available);
    }).catch(() => {
      if (currentRequest === requestToken.current) setFailed(true);
    });
    return () => {
      requestToken.current += 1;
    };
  }, [project.projectKey]);

  const available = review?.available ? review : null;

  return (
    <main className="nl-project-shell">
      <header className="nl-project-header">
        <div className="nl-brand">
          <BookOpenText aria-hidden size={24} weight="fill" />
          <span>{t('app.brand')}</span>
        </div>
        <button className="nl-tertiary-action" onClick={onBack} type="button">
          <ArrowLeft aria-hidden size={17} />
          {t('chapter.common.back')}
        </button>
      </header>
      <div className="nl-project-content nl-chapter-plan-review">
        <section
          aria-labelledby="chapter-plan-review-title"
          className="nl-chapter-plan-review__header"
        >
          <p className="nl-section-label">{t('chapter.review.eyebrow')}</p>
          <h1
            className="nl-view-title"
            id="chapter-plan-review-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {formatMessage('chapter.review.title', {
              chapter: available?.chapterNumber
                ?? project.latestCommittedChapter + 1
            })}
          </h1>
          <p>{t('chapter.review.stateNote')}</p>
        </section>

        {!review && !failed && (
          <div className="nl-chapter-review-loading" role="status">
            <CircleNotch aria-hidden className="nl-spin" size={28} />
            <p>{t('chapter.review.loading')}</p>
          </div>
        )}
        {failed && (
          <p className="nl-inline-alert nl-inline-alert--error" role="alert">
            <WarningCircle aria-hidden size={20} weight="fill" />
            {t('chapter.review.unavailable')}
          </p>
        )}
        {available && (
          <>
            <section
              aria-labelledby="chapter-mission-title"
              className="nl-chapter-mission"
            >
              <p className="nl-section-label">{available.title}</p>
              <h2 id="chapter-mission-title">{t('chapter.review.mission')}</h2>
              <p className="nl-chapter-mission__purpose">
                {available.mission.chapterFunction}
              </p>
              <div className="nl-chapter-mission__sections">
                <MissionList
                  items={available.mission.objectives}
                  title={t('chapter.review.objectives')}
                />
                <MissionList
                  items={available.mission.readerKnowledge}
                  title={t('chapter.review.readerKnowledge')}
                />
                <MissionList
                  items={available.mission.readerQuestions}
                  title={t('chapter.review.readerQuestions')}
                />
                <MissionList
                  items={available.mission.forbiddenMoves}
                  title={t('chapter.review.forbiddenMoves')}
                />
              </div>
            </section>

            <section
              aria-labelledby="selected-plan-title"
              className="nl-selected-plan"
            >
              <p className="nl-section-label">
                {t('chapter.review.selectedLabel')}
              </p>
              <h2 id="selected-plan-title">
                {formatMessage('chapter.review.selectedTitle', {
                  title: available.selectedPlan.title
                })}
              </h2>
              <SafeTextBlocks markdown={available.selectedPlan.markdown} />
            </section>

            {available.alternatives.length > 0 && (
              <section
                aria-label={t('chapter.review.alternatives')}
                className="nl-chapter-alternatives"
                role="group"
              >
                <h2>{t('chapter.review.alternatives')}</h2>
                <p>{t('chapter.review.alternativesNote')}</p>
                {available.alternatives.map((alternative) => (
                  <details key={alternative.title}>
                    <summary onKeyDown={toggleDetailsWithKeyboard}>
                      {alternative.title}
                    </summary>
                    <div className="nl-chapter-alternative__body">
                      <p>{alternative.excerpt}</p>
                      <AlternativeList
                        items={alternative.strengths}
                        title={t('chapter.review.strengths')}
                      />
                      <AlternativeList
                        items={alternative.risks}
                        title={t('chapter.review.risks')}
                      />
                    </div>
                  </details>
                ))}
              </section>
            )}

            <footer className="nl-chapter-review-actions">
              {!confirming ? (
                <>
                  <div>
                    <h2>{t('chapter.review.nextTitle')}</h2>
                    <p id="chapter-draft-note">
                      {t('chapter.review.nextNote')}
                    </p>
                  </div>
                  <button
                    aria-describedby="chapter-draft-note"
                    className="nl-primary-action"
                    onClick={() => setConfirming(true)}
                    type="button"
                  >
                    <CheckCircle aria-hidden size={18} weight="fill" />
                    {t('chapter.review.confirmDirection')}
                  </button>
                </>
              ) : (
                <div className="nl-chapter-draft-confirmation">
                  <div>
                    <h2>{t('chapter.review.confirmationTitle')}</h2>
                    <p id="chapter-draft-confirmation-note">
                      {t('chapter.review.confirmationNote')}
                    </p>
                  </div>
                  <div className="nl-foundation-actions">
                    <button
                      className="nl-secondary-action"
                      onClick={() => setConfirming(false)}
                      type="button"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      aria-describedby="chapter-draft-confirmation-note"
                      className="nl-primary-action"
                      onClick={onGenerateDraft}
                      type="button"
                    >
                      {t('chapter.review.startDraft')}
                    </button>
                  </div>
                </div>
              )}
            </footer>
          </>
        )}
      </div>
    </main>
  );
}

function MissionList({ items, title }: { items: string[]; title: string }) {
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}

function AlternativeList({
  items,
  title
}: {
  items: string[];
  title: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function SafeTextBlocks({ markdown }: { markdown: string }) {
  const blocks = markdown
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
  return (
    <div className="nl-safe-manuscript">
      {blocks.map((block, index) => (
        <p key={`${index}-${block.slice(0, 24)}`}>{block}</p>
      ))}
    </div>
  );
}

function toggleDetailsWithKeyboard(
  event: KeyboardEvent<HTMLElement>
) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  const details = event.currentTarget.closest('details');
  if (details) details.open = !details.open;
}
