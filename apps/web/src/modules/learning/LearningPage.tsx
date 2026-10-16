import { useTexts } from '../../i18n/I18n.tsx';
import { Page } from '../../shell/Page.tsx';
import { learningTexts } from './texts.ts';

export function LearningPage() {
  const t = useTexts(learningTexts);
  return (
    <Page title={t('title')}>
      <p className="muted">{t('body')}</p>
    </Page>
  );
}
