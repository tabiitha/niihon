import { useTexts } from '../../i18n/I18n.tsx';
import { Link, useRouter } from '../../router/Router.tsx';
import { readMediaId, routes } from '../../router/routes.ts';
import { Page } from '../../shell/Page.tsx';
import { libraryTexts } from './texts.ts';

/**
 * The fixed page for media created after the build: the media is named by `?media=<id>`, so a direct load
 * or reload of the address shows the same media. Loading the media itself belongs to the media features.
 */
export function ReaderPage() {
  const t = useTexts(libraryTexts);
  const { location } = useRouter();
  const mediaId = readMediaId(location.search);

  return (
    <Page title={t('readerTitle')}>
      {mediaId === undefined ? (
        <p role="alert">{t('readerMissing')}</p>
      ) : (
        <>
          <h2 className="media-title">{t('readerMedia', { mediaId })}</h2>
          <p className="muted">{t('readerPending')}</p>
        </>
      )}
      <p>
        <Link to={routes.library}>{t('backToLibrary')}</Link>
      </p>
    </Page>
  );
}
