import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { FoundationDocument } from '../../../../shared/foundationContract';
import type { ProjectSummary } from '../../../../shared/projectContract';
import { t } from '../../i18n/messages.zh-CN';

const DOCUMENTS = [
  { kind: 'story_bible', label: '故事核心' },
  { kind: 'genre_contract', label: '类型边界' },
  { kind: 'reader_promise', label: '读者期待' },
  { kind: 'style_guide', label: '写作风格' }
] as const;

interface FoundationReviewProps {
  onBack: () => void;
  onPreparePlanning: () => void;
  project: ProjectSummary;
}

export function FoundationReview({
  onBack,
  onPreparePlanning,
  project
}: FoundationReviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestToken = useRef(0);
  const [documents, setDocuments] = useState<FoundationDocument[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
    const currentRequest = ++requestToken.current;
    void window.novelLoop.foundation.read({ projectKey: project.projectKey })
      .then((result) => {
        if (currentRequest !== requestToken.current) return;
        if (result.available) {
          setDocuments(result.documents);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (currentRequest === requestToken.current) setFailed(true);
      });
    return () => {
      requestToken.current += 1;
    };
  }, [project.projectKey]);

  const orderedDocuments = documents && DOCUMENTS.map(({ kind }) => (
    documents.find((document) => document.kind === kind)
  )).filter((document): document is FoundationDocument => document !== undefined);
  const selectedDocument = orderedDocuments?.[selectedIndex] ?? null;

  const selectDocument = (index: number, focus = false) => {
    setSelectedIndex(index);
    if (focus) navRefs.current[index]?.focus();
  };
  const handleDocumentKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (index + 1) % DOCUMENTS.length;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (index - 1 + DOCUMENTS.length) % DOCUMENTS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = DOCUMENTS.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      selectDocument(nextIndex, true);
    }
  };

  return (
    <main className="nl-project-shell">
      <header className="nl-project-header">
        <div className="nl-brand">
          <BookOpenText aria-hidden size={24} weight="fill" />
          <span>{t('app.brand')}</span>
        </div>
        <button className="nl-tertiary-action" onClick={onBack} type="button">
          <ArrowLeft aria-hidden size={17} />
          {t('foundation.review.back')}
        </button>
      </header>
      <div className="nl-project-content nl-foundation-review">
        <section className="nl-foundation-review__header" aria-labelledby="foundation-review-title">
          <p className="nl-section-label">{t('foundation.review.eyebrow')}</p>
          <h1 className="nl-view-title" id="foundation-review-title" ref={headingRef} tabIndex={-1}>
            {t('foundation.review.title')}
          </h1>
          <p>{t('foundation.review.draftNote')}</p>
        </section>
        {!documents && !failed && (
          <section className="nl-foundation-review__state" role="status">
            <CircleNotch aria-hidden className="nl-spin" size={28} />
            <p>{t('foundation.review.loading')}</p>
          </section>
        )}
        {failed && (
          <p className="nl-inline-alert nl-inline-alert--error" role="alert">
            <WarningCircle aria-hidden size={20} weight="fill" />
            {t('foundation.review.unavailable')}
          </p>
        )}
        {orderedDocuments && selectedDocument && (
          <>
            <div className="nl-foundation-reading-layout">
              <nav aria-label={t('foundation.review.documentNavigation')} className="nl-foundation-document-nav">
                {DOCUMENTS.map(({ label }, index) => (
                  <button
                    aria-current={selectedIndex === index ? 'page' : undefined}
                    key={label}
                    onClick={() => selectDocument(index)}
                    onKeyDown={(event) => handleDocumentKeyDown(event, index)}
                    ref={(element) => { navRefs.current[index] = element; }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <article aria-live="polite" className="nl-foundation-document" tabIndex={-1}>
                <SafeMarkdown markdown={selectedDocument.markdown} />
              </article>
            </div>
            <footer className="nl-foundation-review__footer">
              <div>
                <h2>{t('foundation.review.planningTitle')}</h2>
                <p>{t('foundation.review.planningNote')}</p>
              </div>
              <button
                className="nl-primary-action"
                onClick={onPreparePlanning}
                type="button"
              >
                {t('foundation.review.preparePlanning')}
              </button>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}

function SafeMarkdown({ markdown }: { markdown: string }) {
  const blocks: Array<{ kind: 'heading' | 'paragraph'; text: string }> = [];
  let paragraphLines: string[] = [];
  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') });
      paragraphLines = [];
    }
  };

  for (const line of markdown.split('\n')) {
    const heading = /^(#{1,6})[ \t]+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: heading[2] ?? '' });
    } else if (line.trim() === '') {
      flushParagraph();
    } else {
      paragraphLines.push(line);
    }
  }
  flushParagraph();

  return blocks.map((block, index) => {
    if (block.kind === 'heading') {
      return <h2 key={`heading-${index}`}>{block.text}</h2>;
    }
    return <p key={`paragraph-${index}`}>{block.text}</p>;
  });
}
