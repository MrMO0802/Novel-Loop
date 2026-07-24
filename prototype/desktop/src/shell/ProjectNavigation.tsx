import * as Dialog from '@radix-ui/react-dialog';
import { List, X } from '@phosphor-icons/react';
import { NavLink } from 'react-router-dom';
import { IconButton } from '../components/IconButton';
import { projects } from '../fixtures/projects';

interface ProjectNavigationProps {
  projectId: string;
}

interface ProjectNavigationLinksProps {
  closeOnNavigate?: boolean;
  projectId: string;
}

function ProjectNavigationLinks({ closeOnNavigate = false, projectId }: ProjectNavigationLinksProps) {
  const links = [
    { label: '项目概览', to: `/project/${projectId}` },
    { label: '第二章', to: `/project/${projectId}/chapter/2` },
    { label: '故事档案', to: `/project/${projectId}/story-record` }
  ];

  return (
    <ul className="nl-project-navigation__links">
      {links.map((link) => (
        <li key={link.to}>
          {closeOnNavigate ? (
            <Dialog.Close asChild>
              <NavLink
                className={({ isActive }) => `nl-project-navigation__link${isActive ? ' is-active' : ''}`}
                end={link.to === `/project/${projectId}`}
                to={link.to}
              >
                {link.label}
              </NavLink>
            </Dialog.Close>
          ) : (
            <NavLink
              className={({ isActive }) => `nl-project-navigation__link${isActive ? ' is-active' : ''}`}
              end={link.to === `/project/${projectId}`}
              to={link.to}
            >
              {link.label}
            </NavLink>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ProjectNavigation({ projectId }: ProjectNavigationProps) {
  const project = projects.find((item) => item.id === projectId);
  const projectTitle = project?.title ?? '当前作品';

  return (
    <>
      <nav aria-label="作品导航" className="nl-project-navigation nl-project-navigation--desktop">
        <p className="nl-project-navigation__title">{projectTitle}</p>
        <ProjectNavigationLinks projectId={projectId} />
      </nav>

      <Dialog.Root>
        <Dialog.Trigger asChild>
          <IconButton
            className="nl-project-navigation__drawer-trigger"
            icon={List}
            label="打开作品导航"
          />
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="nl-drawer__overlay" />
          <Dialog.Content aria-label="作品导航" className="nl-drawer__content">
            <div className="nl-drawer__header">
              <Dialog.Title className="nl-drawer__title">{projectTitle}</Dialog.Title>
              <Dialog.Close asChild>
                <IconButton icon={X} label="关闭作品导航" />
              </Dialog.Close>
            </div>
            <nav aria-label="作品导航">
              <ProjectNavigationLinks closeOnNavigate projectId={projectId} />
            </nav>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
