import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { rainRadio } from '../fixtures/rainRadio';
import { t } from '../i18n/t';

export function ProjectOverviewPage() {
  const navigate = useNavigate();
  const attentionCount = rainRadio.mysteries.filter((mystery) => mystery.status === 'attention').length;

  return (
    <div className="nl-page nl-project-overview">
      <header className="nl-page__header nl-project-page-header">
        <div>
          <p>{t('overview.label')}</p>
          <h1>{rainRadio.title}</h1>
        </div>
        <span>{t('overview.volumeProgress', {
          current: rainRadio.volume.currentChapter,
          total: rainRadio.volume.plannedChapters,
          volume: rainRadio.volume.name
        })}</span>
      </header>

      <div className="nl-project-overview__body">
        <div className="nl-project-overview__briefing">
          <section className="nl-overview-section nl-overview-section--volume" aria-labelledby="volume-progress-title">
            <div className="nl-overview-section__heading">
              <h2 id="volume-progress-title">{rainRadio.volume.name}</h2>
              <p>{rainRadio.volume.direction}</p>
            </div>
            <ol className="nl-chapter-sequence" aria-label="当前章节进度">
              <li className="is-committed">
                <span>第一章</span>
                <strong>已正式提交</strong>
              </li>
              <li className="is-current">
                <span>第二章</span>
                <strong>等待审阅变更</strong>
              </li>
              <li>
                <span>第三章</span>
                <strong>已规划</strong>
              </li>
              <li>
                <span>其余 27 章</span>
                <strong>按卷纲推进</strong>
              </li>
            </ol>
          </section>

          <section className="nl-overview-section" aria-labelledby="latest-chapter-title">
            <div className="nl-overview-section__heading">
              <h2 id="latest-chapter-title">{t('overview.latestChapter')}</h2>
              <span>{rainRadio.latestChapter.status}</span>
            </div>
            <h3>{t('overview.chapterTitle', {
              chapter: '二',
              title: rainRadio.latestChapter.title
            })}</h3>
            <p className="nl-overview-section__summary">{rainRadio.latestChapter.summary}</p>
          </section>

          <section className="nl-overview-section" aria-labelledby="main-characters-title">
            <div className="nl-overview-section__heading">
              <h2 id="main-characters-title">{t('overview.mainCharacters')}</h2>
            </div>
            <ul className="nl-overview-character-list">
              {rainRadio.characters.map((character) => (
                <li key={character.key}>
                  <div>
                    <strong>{character.name}</strong>
                    <span>{character.role}</span>
                  </div>
                  <p>{character.currentState}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="nl-overview-section" aria-labelledby="open-mysteries-title">
            <div className="nl-overview-section__heading">
              <h2 id="open-mysteries-title">{t('overview.openMysteries')}</h2>
              <span>{t('overview.openMysterySummary', {
                attention: attentionCount,
                count: rainRadio.mysteries.length
              })}</span>
            </div>
            <ul className="nl-overview-mystery-list">
              {rainRadio.mysteries.slice(0, 2).map((mystery) => (
                <li key={mystery.key}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{mystery.question}</strong>
                    <p>{mystery.writingQuestion}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="nl-overview-section" aria-labelledby="recent-activity-title">
            <div className="nl-overview-section__heading">
              <h2 id="recent-activity-title">{t('overview.recentActivity')}</h2>
            </div>
            <ol className="nl-activity-list">
              {rainRadio.recentActivity.map((activity) => (
                <li key={activity.key}>
                  <time>{activity.when}</time>
                  <div>
                    <strong>{activity.title}</strong>
                    <p>{activity.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="nl-recommended-action" aria-label={t('overview.recommended')}>
          <p>{t('overview.recommended')}</p>
          <h2>{t('overview.recommendedTitle')}</h2>
          <span>{t('overview.recommendedBody')}</span>
          <Button onClick={() => navigate('/project/rain-radio/story-record')}>
            {t('overview.recommendedAction')}
          </Button>
        </aside>
      </div>
    </div>
  );
}
