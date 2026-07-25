import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  StoryRecordViews,
  type StoryRecordTab
} from '../features/story-record/StoryRecordViews';
import { rainRadio } from '../fixtures/rainRadio';
import { t } from '../i18n/t';

export function StoryRecordPage() {
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const requestedTab: StoryRecordTab = requestedView === 'timeline'
    || requestedView === 'mysteries'
    || requestedView === 'pending'
    ? requestedView
    : 'characters';
  const [activeTab, setActiveTab] = useState<StoryRecordTab>(requestedTab);

  useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab]);

  return (
    <div className="nl-page nl-story-record-page">
      <header className="nl-page__header nl-project-page-header">
        <div>
          <p>{rainRadio.title}</p>
          <h1>{t('record.title')}</h1>
        </div>
        <span>
          {activeTab === 'pending'
            ? t('record.pending.pageDescription')
            : t('record.description')}
        </span>
      </header>
      <StoryRecordViews
        activeTab={activeTab}
        onTabChange={setActiveTab}
        project={rainRadio}
      />
    </div>
  );
}
