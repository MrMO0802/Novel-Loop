import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { FileText } from '@phosphor-icons/react/FileText';
import { ShieldCheck } from '@phosphor-icons/react/ShieldCheck';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import { useEffect, useRef, useState } from 'react';

import type {
  ChapterDraftReviewResult,
  ChapterPlanReviewResult
} from '../../../../shared/chapterContract';
import type { ProjectSummary } from '../../../../shared/projectContract';
import { formatMessage, t } from '../../i18n/messages.zh-CN';

interface ChapterWorkspaceProps {
  onBack: () => void;
  project: ProjectSummary;
}

export function ChapterWorkspace({
  onBack,
  project
}: ChapterWorkspaceProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestToken = useRef(0);
  const [draft, setDraft] = useState<ChapterDraftReviewResult | null>(null);
  const [plan, setPlan] = useState<ChapterPlanReviewResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const currentRequest = ++requestToken.current;
    void Promise.all([
      window.novelLoop.chapter.readDraft({ projectKey: project.projectKey }),
      window.novelLoop.chapter.readPlan({ projectKey: project.projectKey })
        .catch(() => null)
    ]).then(([draftResult, planResult]) => {
      if (currentRequest !== requestToken.current) return;
      setDraft(draftResult);
      setPlan(planResult);
      setFailed(!draftResult.available);
    }).catch(() => {
      if (currentRequest === requestToken.current) setFailed(true);
    });
    return () => {
      requestToken.current += 1;
    };
  }, [project.projectKey]);

  const availableDraft = draft?.available ? draft : null;
  const availablePlan = plan?.available ? plan : null;

  useEffect(() => {
    if (availableDraft) headingRef.current?.focus();
  }, [availableDraft]);

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
      {!draft && !failed && (
        <div className="nl-project-content nl-chapter-review-loading" role="status">
          <CircleNotch aria-hidden className="nl-spin" size={28} />
          <p>{t('chapter.workspace.loading')}</p>
        </div>
      )}
      {failed && (
        <div className="nl-project-content">
          <p className="nl-inline-alert nl-inline-alert--error" role="alert">
            <WarningCircle aria-hidden size={20} weight="fill" />
            {t('chapter.workspace.unavailable')}
          </p>
        </div>
      )}
      {availableDraft && (
        <div
          className="nl-chapter-workspace"
          data-testid="chapter-workspace"
        >
          <nav
            aria-label={t('chapter.workspace.navigation')}
            className="nl-chapter-workspace__rail"
          >
            <p className="nl-section-label">{project.title}</p>
            <h2>
              {formatMessage('chapter.workspace.chapterNumber', {
                chapter: availableDraft.chapterNumber
              })}
            </h2>
            <div className="nl-draft-status">
              <FileText aria-hidden size={18} />
              <span>{t('chapter.workspace.draftStatus')}</span>
            </div>
            <p className="nl-chapter-word-count">
              {formatMessage('chapter.workspace.wordCount', {
                count: countWords(availableDraft.markdown)
              })}
            </p>
            <p className="nl-chapter-workspace__boundary">
              <ShieldCheck aria-hidden size={18} weight="fill" />
              <span>{t('chapter.workspace.stateNote')}</span>
            </p>
          </nav>

          <article className="nl-chapter-manuscript">
            <header>
              <p className="nl-section-label">
                {t('chapter.workspace.manuscriptLabel')}
              </p>
              <h1
                ref={headingRef}
                tabIndex={-1}
              >
                {formatMessage('chapter.workspace.title', {
                  chapter: availableDraft.chapterNumber,
                  title: availableDraft.title
                })}
              </h1>
            </header>
            <SafeDraftBlocks markdown={availableDraft.markdown} />
          </article>

          <aside
            aria-label={t('chapter.workspace.context')}
            className="nl-chapter-workspace__context"
          >
            {availablePlan && (
              <section>
                <p className="nl-section-label">
                  {t('chapter.workspace.mission')}
                </p>
                <h2>{availablePlan.title}</h2>
                <p>{availablePlan.mission.chapterFunction}</p>
              </section>
            )}
            <section>
              <p className="nl-section-label">
                {t('chapter.workspace.scenes')}
              </p>
              <h2>{t('chapter.workspace.sceneSummary')}</h2>
              <ol
                aria-label={t('chapter.workspace.sceneSummary')}
                className="nl-chapter-scene-list"
              >
                {availableDraft.scenes.map((scene, index) => (
                  <li key={`${index}-${scene.summary.slice(0, 24)}`}>
                    <span>{index + 1}</span>
                    <p>{scene.summary}</p>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}

function SafeDraftBlocks({ markdown }: { markdown: string }) {
  const blocks = markdown
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block, index) => !(index === 0 && /^#{1,6}\s/u.test(block)));
  return (
    <div className="nl-chapter-manuscript__body">
      {blocks.map((block, index) => (
        <p key={`${index}-${block.slice(0, 32)}`}>{block}</p>
      ))}
    </div>
  );
}

function countWords(markdown: string) {
  const withoutHeading = markdown.replace(/^#{1,6}\s+[^\n]+\n?/u, '');
  return Array.from(withoutHeading.replace(/\s/gu, '')).length;
}
