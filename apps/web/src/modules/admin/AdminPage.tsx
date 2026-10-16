import { useTexts } from '../../i18n/I18n.tsx';
import { Page } from '../../shell/Page.tsx';
import { adminTexts } from './texts.ts';

export function AdminPage() {
  const t = useTexts(adminTexts);
  return (
    <Page title={t('title')}>
      <p className="muted">{t('body')}</p>
    </Page>
  );
}
