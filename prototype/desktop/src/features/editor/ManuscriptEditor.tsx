import {
  ArrowsClockwise,
  CheckCircle,
  Eye,
  LockKey,
  PencilSimple,
  WarningCircle,
  type Icon
} from '@phosphor-icons/react';
import type { PrototypeState } from '../../app/prototypeState';
import type { ChapterWorkspaceVersion } from '../../fixtures/rainRadio';
import { t } from '../../i18n/t';

interface VersionDefinition {
  icon: Icon;
  option: ReturnType<typeof t>;
  status: ReturnType<typeof t>;
  tone: 'draft' | 'candidate' | 'preview' | 'committed';
}

const versionDefinitions: Record<ChapterWorkspaceVersion, VersionDefinition> = {
  draft: {
    icon: PencilSimple,
    option: t('chapter.version.draftOption'),
    status: t('chapter.version.draft'),
    tone: 'draft'
  },
  accepted_draft: {
    icon: PencilSimple,
    option: t('chapter.version.acceptedOption'),
    status: t('chapter.version.accepted'),
    tone: 'draft'
  },
  revision_candidate: {
    icon: ArrowsClockwise,
    option: t('chapter.version.candidateOption'),
    status: t('chapter.version.candidate'),
    tone: 'candidate'
  },
  commit_preview: {
    icon: Eye,
    option: t('chapter.version.previewOption'),
    status: t('chapter.version.preview'),
    tone: 'preview'
  },
  committed: {
    icon: LockKey,
    option: t('chapter.version.committedOption'),
    status: t('chapter.version.committed'),
    tone: 'committed'
  }
};

const autosaveDefinitions: Record<PrototypeState['autosave'], {
  icon: Icon;
  label: string;
  tone: string;
}> = {
  saved: { icon: CheckCircle, label: t('chapter.autosave.saved'), tone: 'saved' },
  saving: { icon: ArrowsClockwise, label: t('chapter.autosave.saving'), tone: 'saving' },
  failed: { icon: WarningCircle, label: t('chapter.autosave.failed'), tone: 'failed' }
};

export interface ManuscriptEditorProps {
  autosave: PrototypeState['autosave'];
  chapter: number;
  onChange: (value: string) => void;
  onVersionChange: (version: ChapterWorkspaceVersion) => void;
  showAcceptedDraft?: boolean;
  title: string;
  value: string;
  version: ChapterWorkspaceVersion;
}

function countCharacters(value: string) {
  return Array.from(value.replace(/\s/g, '')).length;
}

export function ManuscriptEditor({
  autosave,
  chapter,
  onChange,
  onVersionChange,
  showAcceptedDraft = false,
  title,
  value,
  version
}: ManuscriptEditorProps) {
  const versionDefinition = versionDefinitions[version];
  const autosaveDefinition = autosaveDefinitions[autosave];
  const VersionIcon = versionDefinition.icon;
  const AutosaveIcon = autosaveDefinition.icon;
  const isReadOnly = version !== 'draft' && version !== 'accepted_draft';

  return (
    <section className="nl-manuscript-editor" aria-labelledby="chapter-editor-title">
      <header className="nl-manuscript-editor__header">
        <div className="nl-manuscript-editor__title">
          <p
            aria-atomic="true"
            aria-label={t('chapter.version.statusLabel', { status: versionDefinition.status })}
            aria-live="polite"
            className={`nl-manuscript-editor__version nl-manuscript-editor__version--${versionDefinition.tone}`}
            id="chapter-version-status"
            role="status"
          >
            <VersionIcon aria-hidden="true" size={16} weight="regular" />
            <span>{versionDefinition.status}</span>
          </p>
          <h1 id="chapter-editor-title">{t('chapter.title', {
            chapter: chapter === 2 ? t('chapter.number.two') : chapter,
            title
          })}</h1>
        </div>

        <div className="nl-manuscript-editor__controls">
          <label className="nl-manuscript-editor__selector">
            <span>{t('chapter.version.label')}</span>
            <select
              aria-describedby="chapter-version-status"
              aria-label={t('chapter.version.label')}
              onChange={(event) => onVersionChange(event.currentTarget.value as ChapterWorkspaceVersion)}
              value={version}
            >
              {(Object.entries(versionDefinitions) as [ChapterWorkspaceVersion, VersionDefinition][])
                .filter(([key]) => key !== 'accepted_draft' || showAcceptedDraft)
                .map(([key, definition]) => (
                  <option key={key} value={key}>{definition.option}</option>
                ))}
            </select>
          </label>
          <span
            className={`nl-manuscript-editor__autosave nl-manuscript-editor__autosave--${autosaveDefinition.tone}`}
          >
            <AutosaveIcon aria-hidden="true" size={16} weight="regular" />
            {autosaveDefinition.label}
          </span>
          <span className="nl-manuscript-editor__word-count">
            {t('chapter.wordCount', { count: countCharacters(value) })}
          </span>
        </div>
      </header>

      <div className="nl-manuscript-editor__page">
        <textarea
          aria-label={t('chapter.editor.label')}
          className="nl-manuscript-editor__textarea"
          onChange={(event) => onChange(event.currentTarget.value)}
          readOnly={isReadOnly}
          spellCheck="false"
          value={value}
        />
      </div>
    </section>
  );
}
