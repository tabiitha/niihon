import { useTexts } from '../i18n/I18n.tsx';
import { Link } from '../router/Router.tsx';
import { routes } from '../router/routes.ts';
import { Page } from './Page.tsx';
import { shellTexts } from './texts.ts';

export function NotFoundPage() {
  const t = useTexts(shellTexts);
  return (
    <Page title={t('notFoundTitle')}>
      <p className="muted">{t('notFoundBody')}</p>
      <p>
        <Link to={routes.home}>{t('backHome')}</Link>
      </p>
    </Page>
  );
}
