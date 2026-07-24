import * as Dialog from '@radix-ui/react-dialog';
import { SidebarSimple, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePrototypeContext } from '../app/PrototypeContext';
import type { PrototypeState } from '../app/prototypeState';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { ManuscriptEditor } from '../features/editor/ManuscriptEditor';
import {
  rainRadio,
  type ChapterWorkspaceVersion
} from '../fixtures/rainRadio';
import { t } from '../i18n/t';
import { ChapterNavigator } from '../shell/ChapterNavigator';
import { TaskTray, type TaskTrayFixtureState } from '../shell/TaskTray';

interface ChapterAssistantContentProps {
  actionId?: string;
  onReview: () => void;
}

function ChapterAssistantContent({ actionId, onReview }: ChapterAssistantContentProps) {
  const workspace = rainRadio.chapterWorkspace;

  return (
    <div className="nl-chapter-assistant__content">
      <section>
        <h2>{t('chapter.assistant.goal')}</h2>
        <p>{workspace.goal}</p>
      </section>
      <section>
        <h2>{t('chapter.assistant.constraints')}</h2>
        <ul>
          {workspace.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}
        </ul>
      </section>
      <section>
        <h2>{t('chapter.assistant.review')}</h2>
        <strong>{workspace.review.result}</strong>
        <p>{workspace.review.detail}</p>
      </section>
      <section className="nl-chapter-assistant__next">
        <h2>{t('chapter.assistant.next')}</h2>
        <Button id={actionId} onClick={onReview}>{workspace.nextAction}</Button>
      </section>
    </div>
  );
}

function ChapterAssistant({ onReview }: Pick<ChapterAssistantContentProps, 'onReview'>) {
  return (
    <>
      <aside aria-label={t('chapter.assistant.label')} className="nl-chapter-assistant nl-chapter-assistant--desktop">
        <ChapterAssistantContent actionId="chapter-review-action" onReview={onReview} />
      </aside>

      <Dialog.Root>
        <Dialog.Trigger asChild>
          <IconButton
            className="nl-chapter-workspace__drawer-trigger nl-chapter-workspace__drawer-trigger--assistant"
            icon={SidebarSimple}
            label={t('chapter.assistant.open')}
          />
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="nl-drawer__overlay nl-chapter-drawer__overlay" />
          <Dialog.Content
            aria-label={t('chapter.assistant.label')}
            className="nl-drawer__content nl-chapter-drawer nl-chapter-drawer--assistant"
          >
            <div className="nl-drawer__header">
              <Dialog.Title className="nl-drawer__title">{t('chapter.assistant.label')}</Dialog.Title>
              <Dialog.Close asChild>
                <IconButton icon={X} label={t('chapter.assistant.close')} />
              </Dialog.Close>
            </div>
            <ChapterAssistantContent onReview={onReview} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function getTaskFixture(value: string | null): TaskTrayFixtureState {
  if (value === 'writing' || value === 'cancelling' || value === 'timeout') return value;
  return 'collecting';
}

export function ChapterWorkspacePage() {
  const {
    chapterDrafts,
    chapterRevisions,
    setChapterDraft,
    state
  } = usePrototypeContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const workspace = rainRadio.chapterWorkspace;
  const chapterDraftKey = `rain-radio:chapter:${workspace.chapter}`;
  const revision = chapterRevisions.get(chapterDraftKey);
  const [draft, setDraft] = useState(
    () => chapterDrafts.get(chapterDraftKey) ?? workspace.versions.draft,
  );
  const [version, setVersion] = useState<ChapterWorkspaceVersion>(
    () => revision?.disposition === 'accepted' ? 'accepted_draft' : 'draft'
  );
  const [autosave, setAutosave] = useState<PrototypeState['autosave']>('saved');
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const values = { ...workspace.versions, accepted_draft: draft, draft };
  const focusTarget = searchParams.get('focus');

  useEffect(
    () => () => {
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (focusTarget === 'review') {
      const compact = window.matchMedia?.('(max-width: 1024px)').matches ?? false;
      const focusTargetElement = compact
        ? document.querySelector<HTMLButtonElement>(
            '.nl-chapter-workspace__drawer-trigger--assistant'
          )
        : document.getElementById('chapter-review-action');

      focusTargetElement?.focus();
    }
  }, [focusTarget]);

  function updateDraft(value: string) {
    setDraft(value);
    setChapterDraft(chapterDraftKey, value);
    setAutosave('saving');

    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      setAutosave('saved');
      autosaveTimerRef.current = null;
    }, 800);
  }

  function changeVersion(nextVersion: ChapterWorkspaceVersion) {
    setVersion(nextVersion);

    if (nextVersion !== 'draft' && nextVersion !== 'accepted_draft') {
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      setAutosave('saved');
    }
  }

  return (
    <div className={`nl-chapter-workspace${state.focusMode ? ' nl-chapter-workspace--focus-mode' : ''}`}>
      <div className="nl-chapter-workspace__body">
        {!state.focusMode && <ChapterNavigator />}
        <ManuscriptEditor
          autosave={autosave}
          chapter={workspace.chapter}
          onChange={updateDraft}
          onVersionChange={changeVersion}
          showAcceptedDraft={revision?.disposition === 'accepted'}
          title={workspace.title}
          value={values[version]}
          version={version}
        />
        {!state.focusMode && (
          <ChapterAssistant
            onReview={() => navigate('/project/rain-radio/chapter/2/revision')}
          />
        )}
      </div>
      <TaskTray initialState={getTaskFixture(searchParams.get('task'))} />
    </div>
  );
}
