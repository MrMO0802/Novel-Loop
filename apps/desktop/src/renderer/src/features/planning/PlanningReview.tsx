import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent
} from 'react';

import type {
  PlanningArc,
  PlanningChapter,
  PlanningDocument,
  PlanningReviewResult
} from '../../../../shared/planningContract';
import type { ProjectSummary } from '../../../../shared/projectContract';
import { formatMessage, t } from '../../i18n/messages.zh-CN';

const TABS = [
  { id: 'global', label: '全书方向' },
  { id: 'volume', label: '第一卷' },
  { id: 'arcs', label: '故事线' },
  { id: 'chapters', label: '章节计划' }
] as const;

type PlanningTab = typeof TABS[number]['id'];

interface PlanningReviewProps {
  onBack: () => void;
  project: ProjectSummary;
}

export function PlanningReview({ onBack, project }: PlanningReviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestToken = useRef(0);
  const [review, setReview] = useState<PlanningReviewResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
    const currentRequest = ++requestToken.current;
    void window.novelLoop.planning.read({ projectKey: project.projectKey })
      .then((result) => {
        if (currentRequest !== requestToken.current) return;
        setReview(result);
        setFailed(!result.available);
      })
      .catch(() => {
        if (currentRequest === requestToken.current) setFailed(true);
      });
    return () => {
      requestToken.current += 1;
    };
  }, [project.projectKey]);

  const availableReview = review?.available ? review : null;
  const selectedTab = TABS[selectedIndex] ?? TABS[0];

  const selectTab = (index: number, focus = false) => {
    setSelectedIndex(index);
    if (focus) tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    }
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      selectTab(nextIndex, true);
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
          {t('planning.review.back')}
        </button>
      </header>
      <div className="nl-project-content nl-planning-review">
        <section
          aria-labelledby="planning-review-title"
          className="nl-planning-review__header"
        >
          <p className="nl-section-label">{t('planning.review.eyebrow')}</p>
          <h1
            className="nl-view-title"
            id="planning-review-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {t('planning.review.title')}
          </h1>
          <p>{t('planning.review.stateNote')}</p>
        </section>
        {!review && !failed && (
          <section className="nl-planning-review__state" role="status">
            <CircleNotch aria-hidden className="nl-spin" size={28} />
            <p>{t('planning.review.loading')}</p>
          </section>
        )}
        {failed && (
          <p className="nl-inline-alert nl-inline-alert--error" role="alert">
            <WarningCircle aria-hidden size={20} weight="fill" />
            {t('planning.review.unavailable')}
          </p>
        )}
        {availableReview && (
          <>
            <div
              aria-label={t('planning.review.navigation')}
              className="nl-planning-tabs"
              role="tablist"
            >
              {TABS.map((tab, index) => (
                <button
                  aria-controls={`planning-panel-${tab.id}`}
                  aria-selected={selectedIndex === index}
                  id={`planning-tab-${tab.id}`}
                  key={tab.id}
                  onClick={() => selectTab(index)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  role="tab"
                  tabIndex={selectedIndex === index ? 0 : -1}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <section
              aria-labelledby={`planning-tab-${selectedTab.id}`}
              className="nl-planning-panel"
              id={`planning-panel-${selectedTab.id}`}
              role="tabpanel"
              tabIndex={0}
            >
              <PlanningTabContent
                arcs={availableReview.arcs}
                chapters={availableReview.chapters}
                documents={availableReview.documents}
                tab={selectedTab.id}
              />
            </section>
            <footer className="nl-planning-review__footer">
              <div>
                <h2>{t('planning.review.nextTitle')}</h2>
                <p id="planning-next-note">
                  {t('planning.review.nextUnavailable')}
                </p>
              </div>
              <button
                aria-describedby="planning-next-note"
                className="nl-primary-action"
                disabled
                type="button"
              >
                {t('planning.review.nextButton')}
              </button>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}

function PlanningTabContent({
  arcs,
  chapters,
  documents,
  tab
}: {
  arcs: PlanningArc[];
  chapters: PlanningChapter[];
  documents: PlanningDocument[];
  tab: PlanningTab;
}) {
  if (tab === 'global' || tab === 'volume') {
    const kind = tab === 'global' ? 'global_outline' : 'volume_outline';
    const document = documents.find((item) => item.kind === kind);
    return document
      ? <SafeMarkdown markdown={document.markdown} />
      : <EmptyPlanningContent />;
  }
  if (tab === 'arcs') return <ArcList arcs={arcs} />;
  return <ChapterList chapters={chapters} />;
}

function ArcList({ arcs }: { arcs: PlanningArc[] }) {
  if (arcs.length === 0) return <EmptyPlanningContent />;
  return (
    <ul aria-label={t('planning.review.arcs')} className="nl-planning-arcs">
      {arcs.map((arc) => (
        <li key={arc.id}>
          <div className="nl-planning-arc__heading">
            <h2 className="nl-planning-arc__title">{arc.name}</h2>
            <span>{arcTypeLabel(arc.type)}</span>
          </div>
          <p>{arc.summary}</p>
          <dl className="nl-planning-arc__details">
            <Detail
              label={t('planning.review.arcRange')}
              value={arcRange(arc)}
            />
            {arc.relatedCharacters.length > 0 && (
              <Detail
                label={t('planning.review.arcCharacters')}
                value={arc.relatedCharacters.join('、')}
              />
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function ChapterList({ chapters }: { chapters: PlanningChapter[] }) {
  if (chapters.length === 0) return <EmptyPlanningContent />;
  return (
    <ol
      aria-label={t('planning.review.chapters')}
      className="nl-planning-chapters"
    >
      {chapters.map((chapter) => (
        <li key={chapter.chapterNumber}>
          <p className="nl-planning-chapter__number">
            {formatMessage('planning.review.chapterNumber', {
              chapter: chapter.chapterNumber
            })}
          </p>
          <h2 className="nl-planning-chapter__title">
            {formatMessage('planning.review.chapterTitle', {
              chapter: chapter.chapterNumber,
              title: chapter.title
            })}
          </h2>
          <p>{chapter.summary}</p>
          <p className="nl-planning-chapter__function">
            {formatMessage('planning.review.chapterFunction', {
              purpose: chapter.primaryFunction
            })}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EmptyPlanningContent() {
  return <p className="nl-planning-empty">{t('planning.review.empty')}</p>;
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

  return (
    <article className="nl-planning-document">
      {blocks.map((block, index) => (
        block.kind === 'heading'
          ? <h2 key={`heading-${index}`}>{block.text}</h2>
          : <p key={`paragraph-${index}`}>{block.text}</p>
      ))}
    </article>
  );
}

function arcTypeLabel(type: PlanningArc['type']): string {
  switch (type) {
    case 'plot': return t('planning.review.arcType.plot');
    case 'character': return t('planning.review.arcType.character');
    case 'relationship': return t('planning.review.arcType.relationship');
    case 'world': return t('planning.review.arcType.world');
    case 'theme': return t('planning.review.arcType.theme');
  }
}

function arcRange(arc: PlanningArc): string {
  if (arc.startChapter && arc.targetEndChapter) {
    return formatMessage('planning.review.arcRangeBoth', {
      start: arc.startChapter,
      end: arc.targetEndChapter
    });
  }
  if (arc.startChapter) {
    return formatMessage('planning.review.arcRangeStart', {
      start: arc.startChapter
    });
  }
  if (arc.targetEndChapter) {
    return formatMessage('planning.review.arcRangeEnd', {
      end: arc.targetEndChapter
    });
  }
  return t('planning.review.arcRangeOngoing');
}
