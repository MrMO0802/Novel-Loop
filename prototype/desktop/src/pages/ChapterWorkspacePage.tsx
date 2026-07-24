import * as Dialog from '@radix-ui/react-dialog';
import { SidebarSimple, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePrototypeContext } from '../app/PrototypeContext';
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

function ChapterAssistantContent() {
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
        <Button>{workspace.nextAction}</Button>
      </section>
    </div>
  );
}

function ChapterAssistant() {
  return (
    <>
      <aside aria-label={t('chapter.assistant.label')} className="nl-chapter-assistant nl-chapter-assistant--desktop">
        <ChapterAssistantContent />
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
            <ChapterAssistantContent />
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
  const { setAutosave, state } = usePrototypeContext();
  const [searchParams] = useSearchParams();
  const workspace = rainRadio.chapterWorkspace;
  const [draft, setDraft] = useState(workspace.versions.draft);
  const [version, setVersion] = useState<ChapterWorkspaceVersion>('draft');
  const values = { ...workspace.versions, draft };

  function updateDraft(value: string) {
    setDraft(value);
    setAutosave('saving');
  }

  return (
    <div className={`nl-chapter-workspace${state.focusMode ? ' nl-chapter-workspace--focus-mode' : ''}`}>
      <div className="nl-chapter-workspace__body">
        {!state.focusMode && <ChapterNavigator />}
        <ManuscriptEditor
          autosave={state.autosave}
          chapter={workspace.chapter}
          onChange={updateDraft}
          onVersionChange={setVersion}
          title={workspace.title}
          value={values[version]}
          version={version}
        />
        {!state.focusMode && <ChapterAssistant />}
      </div>
      <TaskTray initialState={getTaskFixture(searchParams.get('task'))} />
    </div>
  );
}
