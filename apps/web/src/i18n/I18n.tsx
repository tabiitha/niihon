import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { selectLanguage, type Language } from './languages.ts';
import { formatText, type ModuleTexts } from './texts.ts';

interface I18nValue {
  readonly language: Language;
  setLanguage(language: Language): void;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

/**
 * Provides the interface language. Without a signed-in profile yet, the initial language follows the
 * browser; the profile language and its persistence arrive with the profile preferences.
 */
export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => selectLanguage(undefined, navigator.languages));

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage }), [language]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useLanguage(): I18nValue {
  const value = useContext(I18nContext);
  if (value === undefined) {
    throw new Error('useLanguage must be used inside I18nProvider.');
  }
  return value;
}

/** Returns the text lookup of one module in the current language. */
export function useTexts<Key extends string>(
  moduleTexts: ModuleTexts<Key>,
): (key: Key, values?: Readonly<Record<string, string | number>>) => string {
  const { language } = useLanguage();
  const texts = moduleTexts.texts[language];
  return useCallback((key, values) => formatText(texts[key], values), [texts]);
}
