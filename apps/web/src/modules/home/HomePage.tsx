import { useTexts } from '../../i18n/I18n.tsx';
import { Link } from '../../router/Router.tsx';
import { routes } from '../../router/routes.ts';
import { ArrowIcon, PlusIcon } from '../../shell/icons.tsx';
import { Page } from '../../shell/Page.tsx';
import { homeTexts } from './texts.ts';

export function HomePage() {
  const t = useTexts(homeTexts);
  return (
    <Page title={t('title')} titleHidden>
      <section className="practice" aria-labelledby="practice-title">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h2 id="practice-title" className="display-title">
          {t('practiceTitle')}
        </h2>
        <p className="muted">{t('practiceBody')}</p>
        <div className="actions">
          <Link to={routes.learning} className="button-primary">
            <span>{t('startReview')}</span>
            <ArrowIcon />
          </Link>
          <Link to={routes.learning} className="button-secondary">
            <PlusIcon />
            <span>{t('discoverKana')}</span>
          </Link>
        </div>
      </section>
    </Page>
  );
}
