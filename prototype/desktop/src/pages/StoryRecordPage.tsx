import { useSearchParams } from 'react-router-dom';
import { StoryRecordViews } from '../features/story-record/StoryRecordViews';
import { rainRadio } from '../fixtures/rainRadio';
import { t } from '../i18n/t';

export function StoryRecordPage() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('view') === 'pending' ? 'pending' : 'characters';

  return (
    <div className="nl-page nl-story-record-page">
      <header className="nl-page__header nl-project-page-header">
        <div>
          <p>{rainRadio.title}</p>
          <h1>{t('record.title')}</h1>
        </div>
        <span>{t('record.description')}</span>
      </header>
      <StoryRecordViews initialTab={initialTab} project={rainRadio} />
    </div>
  );
}
