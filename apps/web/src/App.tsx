import type { ComponentType } from 'react';

import { I18nProvider } from './i18n/I18n.tsx';
import { AdminPage } from './modules/admin/AdminPage.tsx';
import { HomePage } from './modules/home/HomePage.tsx';
import { KanjiPage } from './modules/kanji/KanjiPage.tsx';
import { LearningPage } from './modules/learning/LearningPage.tsx';
import { LibraryPage } from './modules/library/LibraryPage.tsx';
import { ReaderPage } from './modules/library/ReaderPage.tsx';
import { ProfilePage } from './modules/profile/ProfilePage.tsx';
import { RouterProvider, useRouter } from './router/Router.tsx';
import { matchRoute, type RouteId } from './router/routes.ts';
import { Layout } from './shell/Layout.tsx';
import { NotFoundPage } from './shell/NotFoundPage.tsx';
import { ServiceGate } from './shell/ServiceGate.tsx';
import { ThemeProvider } from './theme/Theme.tsx';

const pages: Readonly<Record<RouteId, ComponentType>> = {
  home: HomePage,
  learning: LearningPage,
  kanji: KanjiPage,
  library: LibraryPage,
  reader: ReaderPage,
  profile: ProfilePage,
  admin: AdminPage,
};

function CurrentPage() {
  const { location } = useRouter();
  const route = matchRoute(location.pathname);
  const Current = route === undefined ? NotFoundPage : pages[route];
  // A new key per address releases the previous page's state and cancels its pending loads.
  return <Current key={location.pathname + location.search} />;
}

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <RouterProvider>
          <Layout>
            <ServiceGate>
              <CurrentPage />
            </ServiceGate>
          </Layout>
        </RouterProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
