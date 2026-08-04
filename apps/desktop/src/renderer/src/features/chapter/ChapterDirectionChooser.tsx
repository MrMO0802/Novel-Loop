import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { PencilSimple } from '@phosphor-icons/react/PencilSimple';
import { Sparkle } from '@phosphor-icons/react/Sparkle';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react';

import type {
  ChapterAuthoringResult,
  ChapterPlanReviewResult
} from '../../../../shared/chapterContract';
import { t } from '../../i18n/messages.zh-CN';

type AvailablePlan = Extract<ChapterPlanReviewResult, { available: true }>;
export type ChapterDirection = AvailablePlan['directions'][number];

interface ChapterDirectionChooserProps {
  directions: ChapterDirection[];
  onAdjust: (
    direction: ChapterDirection,
    authorTitle: string,
    trigger: HTMLButtonElement
  ) => void;
  onEdit: (direction: ChapterDirection, authorTitle: string) => void;
  onOutcome: (result: ChapterAuthoringResult) => void;
  onSelect: (direction: ChapterDirection) => Promise<ChapterAuthoringResult>;
  onSelected: () => Promise<void>;
}

export function ChapterDirectionChooser({
  directions,
  onAdjust,
  onEdit,
  onOutcome,
  onSelect,
  onSelected
}: ChapterDirectionChooserProps) {
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const radioRefs = useRef<Array<HTMLDivElement | null>>([]);
  const triggerRef = useRef<HTMLElement | null>(null);
  const confirmationWasOpen = useRef(false);
  const [pending, setPending] = useState<ChapterDirection | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(() => {
    const activeIndex = directions.findIndex(({ active }) => active);
    return activeIndex >= 0 ? activeIndex : 0;
  });

  useEffect(() => {
    if (pending) {
      confirmationWasOpen.current = true;
      confirmationHeadingRef.current?.focus();
      return;
    }
    if (confirmationWasOpen.current) {
      confirmationWasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [pending]);

  const cancelSelection = () => {
    setPending(null);
  };

  const requestSelection = (
    direction: ChapterDirection,
    trigger: HTMLElement
  ) => {
    if (direction.active) return;
    triggerRef.current = trigger;
    setPending(direction);
  };

  const handleRadioKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    direction: ChapterDirection,
    index: number
  ) => {
    const lastIndex = directions.length - 1;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = index === lastIndex ? 0 : index + 1;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = index === 0 ? lastIndex : index - 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = lastIndex;
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      requestSelection(direction, event.currentTarget);
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    setFocusedIndex(nextIndex);
    radioRefs.current[nextIndex]?.focus();
  };

  const confirmSelection = async () => {
    if (!pending || selecting) return;
    setSelecting(true);
    try {
      const result = await onSelect(pending);
      if (result.outcome === 'adopted') {
        setPending(null);
        await onSelected();
      } else {
        onOutcome(result);
        setPending(null);
      }
    } catch {
      onOutcome({ outcome: 'invalid', messageKey: 'invalid_output' });
      setPending(null);
    } finally {
      setSelecting(false);
    }
  };

  return (
    <section
      aria-labelledby="chapter-directions-title"
      className="nl-chapter-directions"
    >
      <div className="nl-chapter-section-heading">
        <div>
          <p className="nl-section-label">{t('chapter.direction.label')}</p>
          <h2 id="chapter-directions-title">{t('chapter.direction.title')}</h2>
        </div>
        <p>{t('chapter.direction.note')}</p>
      </div>
      <div
        aria-label={t('chapter.direction.groupLabel')}
        className="nl-direction-list"
        role="radiogroup"
      >
        {directions.map((direction, index) => {
          const title = authorDirectionTitle(direction.title, index);
          const titleId = `chapter-direction-title-${index}`;
          const recommendationId = `chapter-direction-recommendation-${index}`;
          const activeId = `chapter-direction-active-${index}`;
          const descriptionIds = [
            direction.aiRecommended ? recommendationId : null,
            direction.active ? activeId : null
          ].filter((id): id is string => id !== null);
          return (
            <article
              className={`nl-direction-option${direction.active
                ? ' nl-direction-option--active'
                : ''}`}
              key={direction.optionToken}
            >
              <div
                aria-checked={direction.active}
                aria-describedby={descriptionIds.length > 0
                  ? descriptionIds.join(' ')
                  : undefined}
                aria-labelledby={titleId}
                className="nl-direction-option__radio"
                onClick={(event) => requestSelection(
                  direction,
                  event.currentTarget
                )}
                onFocus={() => setFocusedIndex(index)}
                onKeyDown={(event) => handleRadioKeyDown(
                  event,
                  direction,
                  index
                )}
                ref={(node) => {
                  radioRefs.current[index] = node;
                }}
                role="radio"
                tabIndex={focusedIndex === index ? 0 : -1}
              >
                <header className="nl-direction-option__header">
                  <div>
                    <p className="nl-direction-option__number">
                      {`方向 ${index + 1}`}
                    </p>
                    <h3 id={titleId}>{title}</h3>
                  </div>
                  <div className="nl-direction-option__badges">
                    {direction.aiRecommended && (
                      <span className="nl-direction-badge" id={recommendationId}>
                        <Sparkle aria-hidden size={15} weight="fill" />
                        {t('chapter.direction.aiRecommended')}
                      </span>
                    )}
                    {direction.active && (
                      <span
                        className="nl-direction-badge nl-direction-badge--active"
                        id={activeId}
                      >
                        <CheckCircle aria-hidden size={15} weight="fill" />
                        {t('chapter.direction.active')}
                      </span>
                    )}
                  </div>
                </header>
                <SafeChapterMarkdown
                  fallbackTitle={title}
                  markdown={direction.markdown}
                />
                <div className="nl-direction-option__assessment">
                  <DirectionList
                    items={direction.strengths}
                    title={t('chapter.review.strengths')}
                  />
                  <DirectionList
                    items={direction.risks}
                    title={t('chapter.review.risks')}
                  />
                </div>
              </div>
              <div className="nl-direction-option__actions">
                {!direction.active && (
                  <button
                    className="nl-primary-action"
                    onClick={(event) => {
                      requestSelection(direction, event.currentTarget);
                    }}
                    type="button"
                  >
                    <CheckCircle aria-hidden size={18} />
                    {t('chapter.direction.select')}
                  </button>
                )}
                <button
                  className="nl-secondary-action"
                  onClick={() => onEdit(direction, title)}
                  type="button"
                >
                  <PencilSimple aria-hidden size={18} />
                  {t('chapter.direction.edit')}
                </button>
                <button
                  className="nl-secondary-action"
                  onClick={(event) => onAdjust(
                    direction,
                    title,
                    event.currentTarget
                  )}
                  type="button"
                >
                  <Sparkle aria-hidden size={18} />
                  {t('chapter.direction.adjust')}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {pending && (
        <div
          aria-labelledby="direction-confirmation-title"
          className="nl-chapter-invalidation"
          role="region"
        >
          <div>
            <h3
              id="direction-confirmation-title"
              ref={confirmationHeadingRef}
              tabIndex={-1}
            >
              {t('chapter.direction.confirmTitle')}
            </h3>
            <p>{t('chapter.invalidation.note')}</p>
            <p className="nl-invalidation-list">
              {t('chapter.invalidation.nodes')}
            </p>
          </div>
          <div className="nl-foundation-actions">
            <button
              className="nl-secondary-action"
              disabled={selecting}
              onClick={cancelSelection}
              type="button"
            >
              {t('common.cancel')}
            </button>
            <button
              className="nl-primary-action"
              disabled={selecting}
              onClick={() => void confirmSelection()}
              type="button"
            >
              {selecting
                ? t('chapter.direction.selecting')
                : t('chapter.direction.confirm')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function SafeChapterMarkdown({
  fallbackTitle,
  markdown
}: {
  fallbackTitle?: string;
  markdown: string;
}) {
  const blocks: Array<{ kind: 'heading' | 'paragraph'; text: string }> = [];
  let paragraphLines: string[] = [];
  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') });
    paragraphLines = [];
  };
  for (const line of markdown.split('\n')) {
    const heading = /^(#{1,6})[ \t]+(.*)$/u.exec(line);
    if (heading) {
      flushParagraph();
      const text = isUntitled(heading[2] ?? '')
        ? fallbackTitle ?? t('chapter.direction.fallbackTitle')
        : heading[2] ?? '';
      blocks.push({ kind: 'heading', text });
    } else if (line.trim() === '') {
      flushParagraph();
    } else {
      paragraphLines.push(line);
    }
  }
  flushParagraph();
  return (
    <div className="nl-safe-manuscript">
      {blocks.map((block, index) => block.kind === 'heading'
        ? <h4 key={`heading-${index}`}>{block.text}</h4>
        : <p key={`paragraph-${index}`}>{block.text}</p>)}
    </div>
  );
}

export function sanitizeDirectionMarkdown(
  markdown: string,
  fallbackTitle: string
): string {
  return markdown.split('\n').map((line) => {
    const heading = /^(#{1,6})([ \t]+)(.*)$/u.exec(line);
    if (!heading || !isUntitled(heading[3] ?? '')) return line;
    return `${heading[1]}${heading[2]}${fallbackTitle}`;
  }).join('\n');
}

function DirectionList({ items, title }: { items: string[]; title: string }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={`${index}-${item.slice(0, 20)}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function authorDirectionTitle(title: string, index: number) {
  return isUntitled(title) ? `方向 ${index + 1}` : title;
}

function isUntitled(title: ReactNode): boolean {
  return typeof title === 'string' && /^untitled plan$/iu.test(title.trim());
}
