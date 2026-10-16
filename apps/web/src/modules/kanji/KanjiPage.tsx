import { useTexts } from '../../i18n/I18n.tsx';
import { Page } from '../../shell/Page.tsx';
import { kanjiTexts } from './texts.ts';

export function KanjiPage() {
  const t = useTexts(kanjiTexts);
  return (
    <Page title={t('title')}>
      <p className="muted">{t('body')}</p>
    </Page>
  );
}
