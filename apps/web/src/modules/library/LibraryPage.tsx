import { useTexts } from '../../i18n/I18n.tsx';
import { Page } from '../../shell/Page.tsx';
import { libraryTexts } from './texts.ts';

export function LibraryPage() {
  const t = useTexts(libraryTexts);
  return (
    <Page title={t('title')}>
      <p className="muted">{t('body')}</p>
    </Page>
  );
}
