import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { useEffect, useRef, useState } from 'react';

import { t } from '../../i18n/messages.zh-CN';
import { SafeChapterMarkdown } from './ChapterDirectionChooser';

interface ChapterRevisionCompareProps {
  artifactKind: 'mission' | 'plan';
  backLabel?: string;
  candidate: string;
  fallbackTitle?: string;
  onAdopt: () => Promise<boolean>;
  onBack: () => void;
  onCancelConfirmation?: () => void;
  source: string;
  startConfirming?: boolean;
}

export function ChapterRevisionCompare({
  artifactKind,
  backLabel,
  candidate,
  fallbackTitle,
  onAdopt,
  onBack,
  onCancelConfirmation,
  source,
  startConfirming = false
}: ChapterRevisionCompareProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const adoptTriggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(startConfirming);
  const [adopting, setAdopting] = useState(false);
  const sourceLabel = t(artifactKind === 'mission'
    ? 'chapter.revision.missionSource'
    : 'chapter.revision.planSource');
  const candidateLabel = t(artifactKind === 'mission'
    ? 'chapter.revision.missionCandidate'
    : 'chapter.revision.planCandidate');
  const confirmTitle = t(artifactKind === 'mission'
    ? 'chapter.revision.missionConfirmTitle'
    : 'chapter.revision.planConfirmTitle');
  const confirmNote = t(artifactKind === 'mission'
    ? 'chapter.revision.missionConfirmNote'
    : 'chapter.revision.planConfirmNote');

  useEffect(() => {
    if (confirming) confirmationHeadingRef.current?.focus();
    else headingRef.current?.focus();
  }, [confirming]);

  const cancelConfirmation = () => {
    if (onCancelConfirmation) {
      onCancelConfirmation();
      return;
    }
    setConfirming(false);
    window.setTimeout(() => adoptTriggerRef.current?.focus(), 0);
  };

  const adopt = async () => {
    if (adopting) return;
    setAdopting(true);
    try {
      const adopted = await onAdopt();
      if (!adopted) setConfirming(false);
    } finally {
      setAdopting(false);
    }
  };

  return (
    <section
      aria-labelledby="chapter-revision-compare-title"
      className="nl-revision-compare"
    >
      <div className="nl-editor-heading">
        <div>
          <p className="nl-section-label">{t('chapter.revision.label')}</p>
          <h2
            id="chapter-revision-compare-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {t('chapter.revision.title')}
          </h2>
        </div>
        <button className="nl-tertiary-action" onClick={onBack} type="button">
          <ArrowLeft aria-hidden size={17} />
          {backLabel ?? t('chapter.revision.back')}
        </button>
      </div>
      <div className="nl-revision-compare__columns">
        <section aria-label={sourceLabel}>
          <h3>{sourceLabel}</h3>
          <SafeChapterMarkdown
            {...(fallbackTitle === undefined ? {} : { fallbackTitle })}
            markdown={source}
          />
        </section>
        <section aria-label={candidateLabel}>
          <h3>{candidateLabel}</h3>
          <SafeChapterMarkdown
            {...(fallbackTitle === undefined ? {} : { fallbackTitle })}
            markdown={candidate}
          />
        </section>
      </div>
      {!confirming ? (
        <div className="nl-editor-actions">
          <button
            className="nl-primary-action"
            onClick={() => setConfirming(true)}
            ref={adoptTriggerRef}
            type="button"
          >
            <CheckCircle aria-hidden size={18} />
            {t('chapter.revision.adopt')}
          </button>
        </div>
      ) : (
        <div
          aria-labelledby="chapter-adopt-confirmation-title"
          className="nl-chapter-invalidation"
          role="region"
        >
          <div>
            <h3
              id="chapter-adopt-confirmation-title"
              ref={confirmationHeadingRef}
              tabIndex={-1}
            >
              {confirmTitle}
            </h3>
            <p>{confirmNote}</p>
            <p className="nl-invalidation-list">
              {artifactKind === 'mission'
                ? t('chapter.invalidation.missionNodes')
                : t('chapter.invalidation.planNodes')}
            </p>
          </div>
          <div className="nl-foundation-actions">
            <button
              className="nl-secondary-action"
              disabled={adopting}
              onClick={cancelConfirmation}
              type="button"
            >
              {t('common.cancel')}
            </button>
            <button
              className="nl-primary-action"
              disabled={adopting}
              onClick={() => void adopt()}
              type="button"
            >
              {adopting
                ? t('chapter.revision.adopting')
                : confirmTitle}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
