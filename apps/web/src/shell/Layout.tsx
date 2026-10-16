import { useEffect, useRef, type ReactNode } from 'react';

import { useTexts } from '../i18n/I18n.tsx';
import { Link, useRouter } from '../router/Router.tsx';
import { matchRoute, routes, type RouteId } from '../router/routes.ts';
import { AdminIcon, HomeIcon, KanjiIcon, LearnIcon, LibraryIcon, ProfileIcon, SakuraLogo } from './icons.tsx';
import { shellTexts } from './texts.ts';

type ShellTextKey = keyof typeof shellTexts.texts.en;

interface NavigationEntry {
  readonly route: RouteId;
  readonly label: ShellTextKey;
  readonly icon: () => ReactNode;
  /** Other routes that belong to this space, such as the reader in the library. */
  readonly includes?: readonly RouteId[];
}

const primaryNavigation: readonly NavigationEntry[] = [
  { route: 'home', label: 'navHome', icon: HomeIcon },
  { route: 'learning', label: 'navLearning', icon: LearnIcon },
  { route: 'kanji', label: 'navKanji', icon: KanjiIcon },
  { route: 'library', label: 'navLibrary', icon: LibraryIcon, includes: ['reader'] },
];

// The administration entry is shown to everyone until accounts and roles exist (#7, #77): no
// administration feature exists yet, and the server alone will decide who may use one.
const accountNavigation: readonly NavigationEntry[] = [
  { route: 'profile', label: 'navProfile', icon: ProfileIcon },
  { route: 'admin', label: 'navAdmin', icon: AdminIcon },
];

export function Layout({ children }: { readonly children: ReactNode }) {
  const t = useTexts(shellTexts);
  const { location } = useRouter();
  const current = matchRoute(location.pathname);
  const main = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // After a page change, move keyboard and screen-reader focus to the new content.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    main.current?.focus();
  }, [location.pathname, location.search]);

  const renderEntries = (entries: readonly NavigationEntry[]) => (
    <ul>
      {entries.map(({ route, label, icon: Icon, includes = [] }) => {
        const active = current === route || (current !== undefined && includes.includes(current));
        return (
          <li key={route}>
            <Link to={routes[route]} className="nav-link" aria-current={active ? 'page' : undefined}>
              <Icon />
              <span>{t(label)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <a className="skip-link" href="#main">
        {t('skipToContent')}
      </a>
      <header className="header">
        <Link to={routes.home} className="brand">
          <SakuraLogo />
          <span>Niihon</span>
        </Link>
        <nav className="nav-primary" aria-label={t('navigationLabel')}>
          {renderEntries(primaryNavigation)}
        </nav>
        <nav className="nav-account" aria-label={t('accountNavigationLabel')}>
          {renderEntries(accountNavigation)}
        </nav>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
