import { Minus, Plus } from '@phosphor-icons/react';
import type { RevisionParagraphChange } from '../../fixtures/revisions';
import { t } from '../../i18n/t';

export type ComparisonMode = 'side-by-side' | 'unified';

export interface ParagraphDiffProps {
  changes: readonly RevisionParagraphChange[];
  mode: ComparisonMode;
}

function ChangeLabel({ kind }: { kind: 'added' | 'removed' }) {
  const Icon = kind === 'removed' ? Minus : Plus;

  return (
    <span className={`nl-paragraph-diff__label nl-paragraph-diff__label--${kind}`}>
      <Icon aria-hidden="true" size={14} weight="bold" />
      {t(`revision.diff.${kind}`)}
    </span>
  );
}

function ChangedPassage({
  change,
  kind
}: {
  change: RevisionParagraphChange;
  kind: 'added' | 'removed';
}) {
  const Passage = kind === 'removed' ? 'del' : 'ins';
  const passage = kind === 'removed' ? change.original : change.candidate;

  return (
    <div className={`nl-paragraph-diff__passage nl-paragraph-diff__passage--${kind}`}>
      <ChangeLabel kind={kind} />
      <Passage>{passage}</Passage>
    </div>
  );
}

export function ParagraphDiff({ changes, mode }: ParagraphDiffProps) {
  if (mode === 'unified') {
    return (
      <section
        aria-label={t('revision.mode.unifiedRegion')}
        className="nl-paragraph-diff nl-paragraph-diff--unified"
      >
        {changes.map((change) => (
          <article className="nl-paragraph-diff__change" key={change.id}>
            <h3>{t('revision.diff.paragraph', { paragraph: change.paragraph })}</h3>
            <ChangedPassage change={change} kind="removed" />
            <ChangedPassage change={change} kind="added" />
          </article>
        ))}
      </section>
    );
  }

  return (
    <section
      aria-label={t('revision.mode.sideBySideRegion')}
      className="nl-paragraph-diff nl-paragraph-diff--side-by-side"
    >
      <header className="nl-paragraph-diff__headings">
        <h2>{t('revision.original.heading')}</h2>
        <h2>{t('revision.candidate.heading')}</h2>
      </header>
      {changes.map((change) => (
        <article className="nl-paragraph-diff__row" key={change.id}>
          <h3>{t('revision.diff.paragraph', { paragraph: change.paragraph })}</h3>
          <ChangedPassage change={change} kind="removed" />
          <ChangedPassage change={change} kind="added" />
        </article>
      ))}
    </section>
  );
}
