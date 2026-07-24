import { Archive, BookOpenText } from '@phosphor-icons/react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { StatusLabel } from '../components/StatusLabel';
import { archivedProjects, projects } from '../fixtures/projects';
import type { ProjectSummary } from '../fixtures/types';
import { t } from '../i18n/t';
import '../styles/onboarding.css';

const projectDestinations: Partial<Record<string, string>> = {
  'rain-radio': '/project/rain-radio'
};

function formatWords(wordCount: number) {
  return t('library.words', { count: new Intl.NumberFormat('zh-CN').format(wordCount) });
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  const destination = projectDestinations[project.id];

  return (
    <li className="nl-project-row">
      <div className="nl-project-row__identity">
        {destination
          ? <Link to={destination}>{project.title}</Link>
          : <span className="nl-project-row__title">{project.title}</span>}
        <span>{t('library.chapter', {
          chapter: project.currentChapter,
          title: project.currentChapterTitle
        })}</span>
      </div>
      <StatusLabel status={project.status} />
      <span className="nl-project-row__metric">{formatWords(project.wordCount)}</span>
      <span className={`nl-project-row__metric${project.pendingReviewCount > 0 ? ' is-pending' : ''}`}>
        {project.pendingReviewCount > 0
          ? t('library.pendingReview', { count: project.pendingReviewCount })
          : t('library.noPendingReview')}
      </span>
      <span className="nl-project-row__updated">{t('library.updated', { time: project.updatedLabel })}</span>
    </li>
  );
}

export function ProjectLibraryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEmpty = searchParams.get('state') === 'empty';
  const currentProject = projects[0];

  if (isEmpty) {
    return (
      <div className="nl-page nl-page--library">
        <header className="nl-page__header">
          <h1>{t('library.title')}</h1>
        </header>
        <section className="nl-empty-library" aria-labelledby="empty-library-title">
          <BookOpenText aria-hidden="true" size={34} weight="regular" />
          <h2 id="empty-library-title">{t('library.empty.title')}</h2>
          <p>{t('library.empty.body')}</p>
          <Button onClick={() => navigate('/new')}>{t('library.newNovel')}</Button>
        </section>
      </div>
    );
  }

  return (
    <div className="nl-page nl-page--library">
      <header className="nl-page__header nl-page__header--actions">
        <h1>{t('library.title')}</h1>
        <Button onClick={() => navigate('/new')}>{t('library.newNovel')}</Button>
      </header>

      <section className="nl-continue-panel" aria-label={t('library.continue')}>
        <div className="nl-continue-panel__icon">
          <BookOpenText aria-hidden="true" size={22} weight="regular" />
        </div>
        <div className="nl-continue-panel__content">
          <p>{t('library.continue')}</p>
          <h2>{currentProject.title}</h2>
          <span>{t('library.continueStatus')} · {currentProject.updatedLabel}</span>
        </div>
        <Button onClick={() => navigate(`/project/${currentProject.id}/chapter/${currentProject.currentChapter}`)}>
          {t('library.reviewChapter')}
        </Button>
      </section>

      <section className="nl-library-section" aria-labelledby="project-list-title">
        <div className="nl-library-section__heading">
          <h2 id="project-list-title">{t('library.myProjects')}</h2>
          <span>{projects.length}</span>
        </div>
        <ul className="nl-project-list" aria-label={t('library.myProjects')}>
          {projects.map((project) => <ProjectRow key={project.id} project={project} />)}
        </ul>
      </section>

      <details className="nl-archive-disclosure">
        <summary>
          <Archive aria-hidden="true" size={18} weight="regular" />
          {t('library.archived', { count: archivedProjects.length })}
        </summary>
        <ul className="nl-project-list" aria-label={t('library.archived', { count: archivedProjects.length })}>
          {archivedProjects.map((project) => <ProjectRow key={project.id} project={project} />)}
        </ul>
      </details>
    </div>
  );
}
