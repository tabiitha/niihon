import { useId } from 'react';

import { useLanguage, useTexts } from '../../i18n/I18n.tsx';
import { isLanguage, languageNames, languages } from '../../i18n/languages.ts';
import { Page } from '../../shell/Page.tsx';
import { useTheme } from '../../theme/Theme.tsx';
import { appearanceModes, themes, type AppearanceMode } from '../../theme/themes.ts';
import { profileTexts } from './texts.ts';

const modeLabels = { system: 'modeSystem', light: 'modeLight', dark: 'modeDark' } as const;

export function ProfilePage() {
  const t = useTexts(profileTexts);
  const { language, setLanguage } = useLanguage();
  const { themeId, mode, setThemeId, setMode } = useTheme();
  const ids = { language: useId(), style: useId(), mode: useId() };

  return (
    <Page title={t('title')}>
      <p className="muted">{t('body')}</p>
      <section className="panel" aria-labelledby="display-title">
        <h2 id="display-title">{t('displayTitle')}</h2>
        <p className="muted">{t('displayNote')}</p>
        <div className="field">
          <label htmlFor={ids.language}>{t('language')}</label>
          <select
            id={ids.language}
            value={language}
            onChange={(event) => {
              if (isLanguage(event.target.value)) {
                setLanguage(event.target.value);
              }
            }}
          >
            {languages.map((code) => (
              <option key={code} value={code} lang={code}>
                {languageNames[code]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.style}>{t('style')}</label>
          <select id={ids.style} value={themeId} onChange={(event) => setThemeId(event.target.value)}>
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.mode}>{t('mode')}</label>
          <select id={ids.mode} value={mode} onChange={(event) => setMode(event.target.value as AppearanceMode)}>
            {appearanceModes.map((value) => (
              <option key={value} value={value}>
                {t(modeLabels[value])}
              </option>
            ))}
          </select>
        </div>
      </section>
    </Page>
  );
}
