import { CornersIn, Gear } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePrototypeContext } from '../app/PrototypeContext';
import { getPrototypeTaskStatus } from '../app/prototypeState';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { projects } from '../fixtures/projects';
import { CommandPalette } from './CommandPalette';
import { ProjectNavigation } from './ProjectNavigation';

function isProjectFreeRoute(pathname: string) {
  return pathname === '/library' || pathname === '/new' || pathname.startsWith('/setup');
}

function isExactCtrlShortcut(event: KeyboardEvent, key: string) {
  return event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && !event.metaKey
    && event.key.toLowerCase() === key;
}

function isExactFocusModeShortcut(event: KeyboardEvent) {
  return event.ctrlKey
    && event.shiftKey
    && !event.altKey
    && !event.metaKey
    && event.key === 'Enter';
}

export function ApplicationShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, toggleFocusMode } = usePrototypeContext();
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const activeProject = projects.find((project) => project.id === state.activeProjectId);
  const taskStatus = getPrototypeTaskStatus(state.activeTaskId);
  const showProjectContext = !isProjectFreeRoute(location.pathname);
  const showTaskButton = taskStatus === 'running' || taskStatus === 'recoverable';

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;

      const opensCommandPalette = isExactCtrlShortcut(event, 'k');
      const opensCurrentChapter = isExactCtrlShortcut(event, 'p');
      const togglesFocusMode = isExactFocusModeShortcut(event);

      if (isCommandPaletteOpen) {
        if (opensCommandPalette || opensCurrentChapter || togglesFocusMode) event.preventDefault();
        return;
      }

      if (opensCommandPalette) {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (opensCurrentChapter && state.activeProjectId) {
        event.preventDefault();
        navigate(`/project/${state.activeProjectId}/chapter/2`);
        return;
      }

      if (togglesFocusMode) {
        event.preventDefault();
        toggleFocusMode();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isCommandPaletteOpen, navigate, state.activeProjectId, toggleFocusMode]);

  return (
    <div
      aria-label="应用框架"
      className={`nl-application-shell${state.focusMode ? ' nl-application-shell--focus-mode' : ''}`}
    >
      <header className="nl-application-shell__header">
        <button className="nl-application-shell__brand" onClick={() => navigate('/library')} type="button">
          Novel Loop
        </button>
        {showProjectContext && activeProject && (
          <span className="nl-application-shell__project" aria-label="当前作品">
            {activeProject.title}
          </span>
        )}
        <div className="nl-application-shell__actions">
          {showTaskButton && (
            <Button onClick={() => navigate('/tasks')} variant="secondary">查看进行中的任务</Button>
          )}
          <CommandPalette
            onOpenChange={setCommandPaletteOpen}
            open={isCommandPaletteOpen}
            trigger={<Button variant="quiet">打开命令面板</Button>}
          />
          <IconButton
            icon={CornersIn}
            label={state.focusMode ? '退出专注模式' : '进入专注模式'}
            onClick={toggleFocusMode}
          />
          <IconButton icon={Gear} label="打开设置" onClick={() => navigate('/settings')} />
        </div>
      </header>

      <div className="nl-application-shell__workspace">
        {showProjectContext && activeProject && <ProjectNavigation projectId={activeProject.id} />}
        <main className="nl-application-shell__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
