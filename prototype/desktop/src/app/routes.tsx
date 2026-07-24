import { Navigate, Route, Routes } from 'react-router-dom';
import { FirstLaunchPage } from '../pages/FirstLaunchPage';
import { ChapterWorkspacePage } from '../pages/ChapterWorkspacePage';
import { NewNovelPage } from '../pages/NewNovelPage';
import { ProjectLibraryPage } from '../pages/ProjectLibraryPage';
import { ProjectOverviewPage } from '../pages/ProjectOverviewPage';
import {
  ChapterDiagnosticsPage,
  RevisionComparisonPage
} from '../pages/RevisionComparisonPage';
import { StoryRecordPage } from '../pages/StoryRecordPage';
import { ApplicationShell } from '../shell/ApplicationShell';

interface RoutePlaceholderProps {
  title: string;
}

function RoutePlaceholder({ title }: RoutePlaceholderProps) {
  return (
    <section className="nl-route-placeholder" aria-labelledby="route-title">
      <h1 id="route-title">{title}</h1>
    </section>
  );
}

export function PrototypeRoutes() {
  return (
    <Routes>
      <Route element={<ApplicationShell />}>
        <Route path="/setup" element={<FirstLaunchPage />} />
        <Route path="/library" element={<ProjectLibraryPage />} />
        <Route path="/new" element={<NewNovelPage />} />
        <Route path="/project/rain-radio" element={<ProjectOverviewPage />} />
        <Route path="/project/rain-radio/chapter/2" element={<ChapterWorkspacePage />} />
        <Route path="/project/rain-radio/chapter/2/review" element={<ChapterDiagnosticsPage />} />
        <Route path="/project/rain-radio/chapter/2/revision" element={<RevisionComparisonPage />} />
        <Route path="/project/rain-radio/story-record" element={<StoryRecordPage />} />
        <Route path="/tasks" element={<RoutePlaceholder title="任务中心" />} />
        <Route path="/settings" element={<RoutePlaceholder title="设置" />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/library" />} />
    </Routes>
  );
}
