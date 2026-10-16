import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { defaultThemeId, findTheme, resolveColorMode, themeVariables, type AppearanceMode } from './themes.ts';

interface ThemeValue {
  readonly themeId: string;
  readonly mode: AppearanceMode;
  setThemeId(themeId: string): void;
  setMode(mode: AppearanceMode): void;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);
const darkQuery = '(prefers-color-scheme: dark)';

/**
 * Applies the selected theme's tokens as CSS variables on the document. The style and mode are kept for
 * this page only; storing them in the profile belongs to the appearance preference (#81).
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [themeId, setThemeId] = useState(defaultThemeId);
  const [mode, setMode] = useState<AppearanceMode>('system');
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => matchMedia(darkQuery).matches);

  useEffect(() => {
    const query = matchMedia(darkQuery);
    const update = () => setSystemPrefersDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const colorMode = resolveColorMode(mode, systemPrefersDark);
    const root = document.documentElement;
    for (const [name, value] of Object.entries(themeVariables(findTheme(themeId), colorMode))) {
      root.style.setProperty(name, value);
    }
    root.style.colorScheme = colorMode;
    root.dataset['theme'] = themeId;
    root.dataset['colorMode'] = colorMode;
  }, [themeId, mode, systemPrefersDark]);

  const value = useMemo(() => ({ themeId, mode, setThemeId, setMode }), [themeId, mode]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === undefined) {
    throw new Error('useTheme must be used inside ThemeProvider.');
  }
  return value;
}
