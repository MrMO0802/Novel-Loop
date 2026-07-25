import * as Dialog from '@radix-ui/react-dialog';
import { ListNumbers, X } from '@phosphor-icons/react';
import { NavLink } from 'react-router-dom';
import { IconButton } from '../components/IconButton';
import { t } from '../i18n/t';

interface ChapterNavigationContentProps {
  closeOnNavigate?: boolean;
}

function NavigationLink({
  children,
  closeOnNavigate = false,
  className,
  to
}: {
  children: string;
  closeOnNavigate?: boolean;
  className?: string;
  to: string;
}) {
  const link = (
    <NavLink
      className={({ isActive }) => [
        'nl-chapter-navigator__link',
        className,
        isActive ? 'is-active' : ''
      ].filter(Boolean).join(' ')}
      to={to}
    >
      {children}
    </NavLink>
  );

  return closeOnNavigate ? <Dialog.Close asChild>{link}</Dialog.Close> : link;
}

function UnavailableChapter({ children }: { children: string }) {
  return (
    <span
      aria-disabled="true"
      className="nl-chapter-navigator__link nl-chapter-navigator__link--unavailable"
    >
      {children}
    </span>
  );
}

function ChapterNavigationContent({ closeOnNavigate = false }: ChapterNavigationContentProps) {
  return (
    <div className="nl-chapter-navigator__content">
      <section aria-labelledby={closeOnNavigate ? 'drawer-volume-title' : 'desktop-volume-title'}>
        <h2 id={closeOnNavigate ? 'drawer-volume-title' : 'desktop-volume-title'}>
          {t('chapter.navigation.volume')}
        </h2>
        <ol className="nl-chapter-navigator__chapters">
          <li>
            <UnavailableChapter>
              {t('chapter.navigation.one')}
            </UnavailableChapter>
            <span>{t('chapter.navigation.committed')}</span>
          </li>
          <li>
            <NavigationLink closeOnNavigate={closeOnNavigate} to="/project/rain-radio/chapter/2">
              {t('chapter.navigation.two')}
            </NavigationLink>
            <span className="is-current">{t('chapter.navigation.current')}</span>
          </li>
          <li>
            <UnavailableChapter>
              {t('chapter.navigation.three')}
            </UnavailableChapter>
            <span>{t('chapter.navigation.planned')}</span>
          </li>
        </ol>
      </section>

      <section aria-labelledby={closeOnNavigate ? 'drawer-record-title' : 'desktop-record-title'}>
        <h2 id={closeOnNavigate ? 'drawer-record-title' : 'desktop-record-title'}>
          {t('chapter.navigation.record')}
        </h2>
        <ul className="nl-chapter-navigator__record-links">
          <li>
            <NavigationLink closeOnNavigate={closeOnNavigate} to="/project/rain-radio/story-record">
              {t('chapter.navigation.characters')}
            </NavigationLink>
          </li>
          <li>
            <NavigationLink closeOnNavigate={closeOnNavigate} to="/project/rain-radio/story-record?view=timeline">
              {t('chapter.navigation.timeline')}
            </NavigationLink>
          </li>
          <li>
            <NavigationLink closeOnNavigate={closeOnNavigate} to="/project/rain-radio/story-record?view=mysteries">
              {t('chapter.navigation.mysteries')}
            </NavigationLink>
          </li>
        </ul>
      </section>
    </div>
  );
}

export function ChapterNavigator() {
  return (
    <>
      <nav aria-label={t('chapter.navigation')} className="nl-chapter-navigator nl-chapter-navigator--desktop">
        <ChapterNavigationContent />
      </nav>

      <Dialog.Root>
        <Dialog.Trigger asChild>
          <IconButton
            className="nl-chapter-workspace__drawer-trigger nl-chapter-workspace__drawer-trigger--chapters"
            icon={ListNumbers}
            label={t('chapter.navigation.open')}
          />
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="nl-drawer__overlay nl-chapter-drawer__overlay" />
          <Dialog.Content aria-label={t('chapter.navigation')} className="nl-drawer__content nl-chapter-drawer">
            <div className="nl-drawer__header">
              <Dialog.Title className="nl-drawer__title">{t('chapter.navigation')}</Dialog.Title>
              <Dialog.Close asChild>
                <IconButton icon={X} label={t('chapter.navigation.close')} />
              </Dialog.Close>
            </div>
            <nav aria-label={t('chapter.navigation')}>
              <ChapterNavigationContent closeOnNavigate />
            </nav>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
