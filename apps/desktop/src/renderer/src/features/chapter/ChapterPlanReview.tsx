import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { BookOpenText } from '@phosphor-icons/react/BookOpenText';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { Eye } from '@phosphor-icons/react/Eye';
import { FloppyDisk } from '@phosphor-icons/react/FloppyDisk';
import { PencilSimple } from '@phosphor-icons/react/PencilSimple';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

import type {
  ChapterAuthoringMessageKey,
  ChapterAuthoringResult,
  ChapterPlanReviewResult
} from '../../../../shared/chapterContract';
import type { ProjectSummary } from '../../../../shared/projectContract';
import { formatMessage, t } from '../../i18n/messages.zh-CN';
import {
  ChapterDirectionChooser,
  SafeChapterMarkdown,
  sanitizeDirectionMarkdown,
  type ChapterDirection
} from './ChapterDirectionChooser';
import { ChapterMissionEditor } from './ChapterMissionEditor';
import { ChapterRevisionCompare } from './ChapterRevisionCompare';

type AvailablePlan = Extract<ChapterPlanReviewResult, { available: true }>;
type EditorState =
  | { kind: 'mission' }
  | { authorTitle: string; direction: ChapterDirection; kind: 'plan' }
  | null;

interface ChapterPlanReviewProps {
  initialEditor?: 'mission';
  onBack: () => void;
  onGenerateDraft: () => void;
  project: ProjectSummary;
}

export function ChapterPlanReview({
  initialEditor,
  onBack,
  onGenerateDraft,
  project
}: ChapterPlanReviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmationWasOpen = useRef(false);
  const initialEditorOpened = useRef(false);
  const requestToken = useRef(0);
  const [review, setReview] = useState<ChapterPlanReviewResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmingDraft, setConfirmingDraft] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [authoringIssue, setAuthoringIssue] = useState<{
    message: string;
    repairParticipants: boolean;
  } | null>(null);
  const [liveStatus, setLiveStatus] = useState('');

  const loadReview = useCallback(async (resetBindings = false) => {
    const currentRequest = ++requestToken.current;
    if (resetBindings) {
      setReview(null);
      setFailed(false);
      setEditor(null);
      setConfirmingDraft(false);
    }
    try {
      const result = await window.novelLoop.chapter.readPlan({
        projectKey: project.projectKey
      });
      if (currentRequest !== requestToken.current) return;
      setReview(result.available ? result : null);
      setFailed(!result.available);
      if (
        result.available
        && initialEditor === 'mission'
        && !initialEditorOpened.current
      ) {
        initialEditorOpened.current = true;
        setEditor({ kind: 'mission' });
      }
    } catch {
      if (currentRequest === requestToken.current) {
        setReview(null);
        setFailed(true);
      }
    }
  }, [initialEditor, project.projectKey]);

  useEffect(() => {
    headingRef.current?.focus();
    void loadReview();
    return () => {
      requestToken.current += 1;
    };
  }, [loadReview]);

  useEffect(() => {
    if (confirmingDraft) {
      confirmationWasOpen.current = true;
      confirmationHeadingRef.current?.focus();
      return;
    }
    if (confirmationWasOpen.current) {
      confirmationWasOpen.current = false;
      confirmationTriggerRef.current?.focus();
    }
  }, [confirmingDraft]);

  const available = review?.available ? review : null;

  const handleOutcome = (result: ChapterAuthoringResult) => {
    if (result.outcome === 'saved' || result.outcome === 'adopted') return;
    setAuthoringIssue({
      message: authoringMessage(result.messageKey),
      repairParticipants: result.messageKey === 'participant_roster_missing'
    });
  };

  const selectDirection = async (direction: ChapterDirection) => {
    if (!available) {
      return { outcome: 'invalid', messageKey: 'invalid_output' } as const;
    }
    setAuthoringIssue(null);
    const result = await window.novelLoop.chapter.selectDirection({
      projectKey: project.projectKey,
      reviewToken: available.reviewToken,
      optionToken: direction.optionToken
    });
    if (result.outcome === 'adopted') {
      setLiveStatus(t('chapter.direction.selectedStatus'));
    }
    return result;
  };

  const refreshAfterAdoption = async () => {
    setAuthoringIssue(null);
    await loadReview(true);
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

        <p aria-live="polite" className="nl-visually-hidden" role="status">
          {liveStatus}
        </p>

        {!review && !failed && (
          <div className="nl-chapter-review-loading" role="status">
            <CircleNotch aria-hidden className="nl-spin" size={28} />
            <p>{t('chapter.review.loading')}</p>
          </div>
        )}
        {failed && (
          <div className="nl-authoring-recovery">
            <p className="nl-inline-alert nl-inline-alert--error" role="alert">
              <WarningCircle aria-hidden size={20} weight="fill" />
              {t('chapter.review.refreshUnavailable')}
            </p>
            <button
              className="nl-primary-action"
              onClick={() => void loadReview(true)}
              type="button"
            >
              {t('chapter.review.retry')}
            </button>
          </div>
        )}
        {authoringIssue && (
          <div className="nl-authoring-recovery">
            <p className="nl-inline-alert nl-inline-alert--error" role="alert">
              <WarningCircle aria-hidden size={20} weight="fill" />
              {authoringIssue.message}
            </p>
            {authoringIssue.repairParticipants && (
              <button
                className="nl-primary-action"
                onClick={() => {
                  setAuthoringIssue(null);
                  setEditor({ kind: 'mission' });
                }}
                type="button"
              >
                <PencilSimple aria-hidden size={18} />
                {t('chapter.mission.repairParticipants')}
              </button>
            )}
          </div>
        )}
        {available && (
          <>
            <MissionReview
              mission={available.mission}
              onEdit={() => {
                setAuthoringIssue(null);
                setEditor({ kind: 'mission' });
              }}
              title={available.title}
            />

            <ChapterDirectionChooser
              directions={available.directions}
              onEdit={(direction, authorTitle) => {
                setAuthoringIssue(null);
                setEditor({ authorTitle, direction, kind: 'plan' });
              }}
              onOutcome={handleOutcome}
              onSelect={selectDirection}
              onSelected={refreshAfterAdoption}
            />

            {editor?.kind === 'mission' && (
              <ChapterMissionEditor
                mission={available.mission}
                onAdopted={refreshAfterAdoption}
                onClose={() => setEditor(null)}
                onOutcome={handleOutcome}
                projectKey={project.projectKey}
                reviewToken={available.reviewToken}
              />
            )}
            {editor?.kind === 'plan' && (
              <ChapterPlanEditor
                authorTitle={editor.authorTitle}
                direction={editor.direction}
                onAdopted={refreshAfterAdoption}
                onClose={() => setEditor(null)}
                onOutcome={handleOutcome}
                projectKey={project.projectKey}
                reviewToken={available.reviewToken}
              />
            )}

            <footer className="nl-chapter-review-actions">
              {!confirmingDraft ? (
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
                    onClick={() => setConfirmingDraft(true)}
                    ref={confirmationTriggerRef}
                    type="button"
                  >
                    <CheckCircle aria-hidden size={18} weight="fill" />
                    {t('chapter.review.confirmDirection')}
                  </button>
                </>
              ) : (
                <div
                  aria-labelledby="chapter-draft-confirmation-title"
                  className="nl-chapter-draft-confirmation"
                  role="region"
                >
                  <div>
                    <h2
                      id="chapter-draft-confirmation-title"
                      ref={confirmationHeadingRef}
                      tabIndex={-1}
                    >
                      {t('chapter.review.confirmationTitle')}
                    </h2>
                    <p id="chapter-draft-confirmation-note">
                      {t('chapter.review.confirmationNote')}
                    </p>
                  </div>
                  <div className="nl-foundation-actions">
                    <button
                      className="nl-secondary-action"
                      onClick={() => setConfirmingDraft(false)}
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

function MissionReview({
  mission,
  onEdit,
  title
}: {
  mission: AvailablePlan['mission'];
  onEdit: () => void;
  title: string;
}) {
  return (
    <section
      aria-labelledby="chapter-mission-title"
      className="nl-chapter-mission"
    >
      <div className="nl-chapter-section-heading">
        <div>
          <p className="nl-section-label">{title}</p>
          <h2 id="chapter-mission-title">{t('chapter.review.mission')}</h2>
        </div>
        <button className="nl-secondary-action" onClick={onEdit} type="button">
          <PencilSimple aria-hidden size={18} />
          {t('chapter.mission.edit')}
        </button>
      </div>
      <p className="nl-chapter-mission__purpose">{mission.chapterFunction}</p>
      <div className="nl-chapter-mission__sections">
        <MissionList items={mission.objectives} title={t('chapter.review.objectives')} />
        <MissionList
          items={mission.narrativePromises}
          title={t('chapter.review.narrativePromises')}
        />
        <MissionList
          items={mission.characterDeltas}
          title={t('chapter.review.characterDeltas')}
        />
        <MissionList
          items={mission.readerKnowledge}
          title={t('chapter.review.readerKnowledge')}
        />
        <MissionList
          items={mission.readerQuestions}
          title={t('chapter.review.readerQuestions')}
        />
        <MissionList
          items={mission.forbiddenMoves}
          title={t('chapter.review.forbiddenMoves')}
        />
      </div>
    </section>
  );
}

function MissionList({ items, title }: { items: string[]; title: string }) {
  return (
    <section>
      <h3>{title}</h3>
      {items.length > 0
        ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
        : <p className="nl-empty-copy">{t('chapter.mission.empty')}</p>}
    </section>
  );
}

function ChapterPlanEditor({
  authorTitle,
  direction,
  onAdopted,
  onClose,
  onOutcome,
  projectKey,
  reviewToken
}: {
  authorTitle: string;
  direction: ChapterDirection;
  onAdopted: () => Promise<void>;
  onClose: () => void;
  onOutcome: (result: ChapterAuthoringResult) => void;
  projectKey: string;
  reviewToken: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const compareTriggerRef = useRef<HTMLButtonElement>(null);
  const editGeneration = useRef(0);
  const restoreCompareFocus = useRef(false);
  const [markdown, setMarkdown] = useState(() => sanitizeDirectionMarkdown(
    direction.markdown,
    authorTitle
  ));
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [status, setStatus] = useState<'dirty' | 'saved' | 'adopted'>('dirty');
  const [saving, setSaving] = useState(false);
  const [revisionToken, setRevisionToken] = useState<string | null>(null);
  const [savedMarkdown, setSavedMarkdown] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<
    'compare' | 'confirm' | null
  >(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!compareMode && restoreCompareFocus.current) {
      restoreCompareFocus.current = false;
      compareTriggerRef.current?.focus();
    }
  }, [compareMode]);

  const save = async () => {
    if (saving) return;
    const submittedMarkdown = markdown;
    const saveGeneration = editGeneration.current;
    setSaving(true);
    try {
      const result = await window.novelLoop.chapter.savePlanWorkingCopy({
        projectKey,
        reviewToken,
        optionToken: direction.optionToken,
        markdown: submittedMarkdown
      });
      if (saveGeneration !== editGeneration.current) return;
      if (result.outcome === 'saved') {
        setRevisionToken(result.revisionToken);
        setSavedMarkdown(submittedMarkdown);
        setStatus('saved');
      } else {
        onOutcome(result);
      }
    } catch {
      if (saveGeneration === editGeneration.current) {
        onOutcome({ outcome: 'invalid', messageKey: 'invalid_output' });
      }
    } finally {
      setSaving(false);
    }
  };

  const adopt = async () => {
    if (!revisionToken) return false;
    try {
      const result = await window.novelLoop.chapter.adoptRevision({
        projectKey,
        revisionToken,
        confirmInvalidation: true
      });
      if (result.outcome === 'adopted') {
        setCompareMode(null);
        setStatus('adopted');
        await onAdopted();
        return true;
      }
      onOutcome(result);
      return false;
    } catch {
      onOutcome({ outcome: 'invalid', messageKey: 'invalid_output' });
      return false;
    }
  };

  if (compareMode && savedMarkdown !== null) {
    return (
      <ChapterRevisionCompare
        artifactKind="plan"
        candidate={savedMarkdown}
        fallbackTitle={authorTitle}
        onAdopt={adopt}
        onBack={() => {
          restoreCompareFocus.current = true;
          setCompareMode(null);
        }}
        source={sanitizeDirectionMarkdown(direction.markdown, authorTitle)}
        startConfirming={compareMode === 'confirm'}
      />
    );
  }

  return (
    <section
      aria-labelledby="chapter-plan-editor-title"
      className="nl-chapter-editor"
    >
      <div className="nl-editor-heading">
        <div>
          <p className="nl-section-label">{t('chapter.planEditor.label')}</p>
          <h2
            id="chapter-plan-editor-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {formatMessage('chapter.planEditor.title', { title: authorTitle })}
          </h2>
        </div>
        <p
          aria-live="polite"
          className={`nl-edit-status nl-edit-status--${status}`}
        >
          {editStatusLabel(status)}
        </p>
      </div>
      <div
        aria-label={t('chapter.planEditor.tabs')}
        className="nl-editor-tabs"
        role="group"
      >
        <button
          aria-pressed={tab === 'edit'}
          onClick={() => setTab('edit')}
          type="button"
        >
          <PencilSimple aria-hidden size={17} />
          {t('chapter.planEditor.editTab')}
        </button>
        <button
          aria-pressed={tab === 'preview'}
          onClick={() => setTab('preview')}
          type="button"
        >
          <Eye aria-hidden size={17} />
          {t('chapter.planEditor.previewTab')}
        </button>
      </div>
      <div
        className="nl-plan-editor__panel"
        hidden={tab !== 'edit'}
        id="chapter-plan-edit-panel"
      >
        <label htmlFor="chapter-plan-markdown">
          {t('chapter.planEditor.markdown')}
        </label>
        <textarea
          id="chapter-plan-markdown"
          onChange={(event) => {
            editGeneration.current += 1;
            setMarkdown(event.currentTarget.value);
            setStatus('dirty');
            setRevisionToken(null);
            setSavedMarkdown(null);
            setCompareMode(null);
          }}
          rows={18}
          value={markdown}
        />
      </div>
      <article
        aria-label={t('chapter.planEditor.preview')}
        className="nl-plan-editor__panel nl-plan-editor__preview"
        hidden={tab !== 'preview'}
        id="chapter-plan-preview-panel"
        role="region"
      >
        <SafeChapterMarkdown fallbackTitle={authorTitle} markdown={markdown} />
      </article>
      <p className="nl-plan-editor__word-count">
        {formatMessage('chapter.workspace.wordCount', {
          count: countAuthorCharacters(markdown)
        })}
      </p>
      <div className="nl-editor-actions">
        <button className="nl-secondary-action" onClick={onClose} type="button">
          {t('chapter.editor.discard')}
        </button>
        <button
          className="nl-secondary-action"
          disabled={!revisionToken}
          onClick={() => setCompareMode('compare')}
          ref={compareTriggerRef}
          type="button"
        >
          {t('chapter.editor.compare')}
        </button>
        <button
          className="nl-secondary-action"
          disabled={!revisionToken}
          onClick={() => setCompareMode('confirm')}
          type="button"
        >
          <CheckCircle aria-hidden size={18} />
          {t('chapter.revision.adopt')}
        </button>
        <button
          className="nl-primary-action"
          disabled={saving}
          onClick={() => void save()}
          type="button"
        >
          <FloppyDisk aria-hidden size={18} />
          {saving ? t('chapter.editor.saving') : t('chapter.editor.save')}
        </button>
      </div>
    </section>
  );
}

function authoringMessage(messageKey: ChapterAuthoringMessageKey) {
  switch (messageKey) {
    case 'stale_edit': return t('chapter.authoring.stale');
    case 'participant_roster_missing': return t('chapter.authoring.participants');
    case 'invalid_output': return t('chapter.authoring.invalid');
    case 'generation_busy': return t('chapter.authoring.busy');
    case 'project_unavailable': return t('chapter.authoring.projectUnavailable');
  }
}

function editStatusLabel(status: 'dirty' | 'saved' | 'adopted') {
  if (status === 'saved') return t('chapter.editor.saved');
  if (status === 'adopted') return t('chapter.editor.adopted');
  return t('chapter.editor.unsaved');
}

function countAuthorCharacters(markdown: string) {
  return Array.from(markdown
    .replace(/^#{1,6}[ \t]+/gmu, '')
    .replace(/\s/gu, '')).length;
}
