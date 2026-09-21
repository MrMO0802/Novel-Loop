import type { SubmissionChange } from '../../../../shared/submissionContract';
import { t } from '../../i18n/messages.zh-CN';
import './submission.css';

const categories: SubmissionChange['category'][] = [
  'facts', 'characters', 'timeline', 'plot_threads', 'narrative_debts',
  'foreshadowing', 'reader_information', 'relationships', 'world_rules', 'progress'
];

export function SubmissionChanges({ changes }: { changes: SubmissionChange[] }) {
  return (
    <section className="nl-submission-changes" aria-label={t('submission.changes')}>
      <h2>{t('submission.changes')}</h2>
      {changes.length === 0 && <p>{t('submission.changesEmpty')}</p>}
      {categories.map((category) => {
        const entries = changes.filter((change) => change.category === category);
        if (entries.length === 0) return null;
        return (
          <section className="nl-submission-changes__group" key={category}>
            <h3>{t(`submission.category.${category}`)}</h3>
            <ul>
              {entries.map((change, index) => (
                <li key={index} className={`nl-submission-change nl-submission-change--${change.risk}`}>
                  <span className="nl-submission-risk">{t(`submission.risk.${change.risk}`)}</span>
                  <p>{change.summary}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
