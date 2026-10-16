import sakura from '../../../../resources/themes/sakura/tokens.json' with { type: 'json' };

/**
 * Color roles every theme defines for both modes. The tokens live in `resources/themes/<id>/tokens.json`,
 * the single source shared with the SwiftUI client; components only use the CSS variables derived from them.
 */
export const colorRoles = [
  'background',
  'backgroundAccent',
  'surface',
  'onSurface',
  'text',
  'textMuted',
  'accent',
  'onAccent',
  'accentText',
  'border',
  'focus',
] as const;

export type ColorRole = (typeof colorRoles)[number];
export type ColorMode = 'light' | 'dark';
/** `system` follows the operating system's light or dark setting. */
export type AppearanceMode = ColorMode | 'system';

export const appearanceModes: readonly AppearanceMode[] = ['system', 'light', 'dark'];

export interface ThemeTokens {
  readonly id: string;
  readonly name: string;
  readonly modes: Readonly<Record<ColorMode, { readonly name: string; readonly colors: Readonly<Record<ColorRole, string>> }>>;
  /** Foreground and background roles whose WCAG contrast must reach `minimum` in both modes. */
  readonly contrastPairs: readonly { readonly foreground: ColorRole; readonly background: ColorRole; readonly minimum: number }[];
}

/** Every theme compiled into the client. Adding a style adds its folder under `resources/themes` and one entry here. */
export const themes: readonly ThemeTokens[] = [sakura as ThemeTokens];

export const defaultThemeId = 'sakura';

export function findTheme(id: string): ThemeTokens {
  return themes.find((theme) => theme.id === id) ?? (themes[0] as ThemeTokens);
}

export function resolveColorMode(mode: AppearanceMode, systemPrefersDark: boolean): ColorMode {
  return mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode;
}

/** CSS custom properties for one theme and mode, such as `--color-background`. */
export function themeVariables(theme: ThemeTokens, mode: ColorMode): Readonly<Record<string, string>> {
  const { colors } = theme.modes[mode];
  return Object.fromEntries(
    colorRoles.map((role) => [`--color-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, colors[role]]),
  );
}
