import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { useEffect, useRef, useState } from 'react';

import { t } from '../../i18n/messages.zh-CN';
import { SafeChapterMarkdown } from './ChapterDirectionChooser';

interface ChapterRevisionCompareProps {
  candidate: string;
  onAdopt: () => Promise<boolean>;
  onBack: () => void;
  source: string;
  startConfirming?: boolean;
}

export function ChapterRevisionCompare({
  candidate,
  onAdopt,
  onBack,
  source,
  startConfirming = false
}: ChapterRevisionCompareProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const adoptTriggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(startConfirming);
  const [adopting, setAdopting] = useState(false);

  useEffect(() => {
    if (confirming) confirmationHeadingRef.current?.focus();
    else headingRef.current?.focus();
  }, [confirming]);

  const cancelConfirmation = () => {
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
          {t('chapter.revision.back')}
        </button>
      </div>
      <div className="nl-revision-compare__columns">
        <section aria-label={t('chapter.revision.source')}>
          <h3>{t('chapter.revision.source')}</h3>
          <SafeChapterMarkdown markdown={source} />
        </section>
        <section aria-label={t('chapter.revision.candidate')}>
          <h3>{t('chapter.revision.candidate')}</h3>
          <SafeChapterMarkdown markdown={candidate} />
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
              {t('chapter.revision.confirmTitle')}
            </h3>
            <p>{t('chapter.invalidation.note')}</p>
            <p className="nl-invalidation-list">
              {t('chapter.invalidation.nodes')}
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
                : t('chapter.revision.confirm')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
