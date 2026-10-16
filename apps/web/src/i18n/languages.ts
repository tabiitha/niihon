/** Interface languages, in the order they are offered. */
export const languages = ['en', 'fr', 'ja'] as const;

export type Language = (typeof languages)[number];

export const defaultLanguage: Language = 'en';

/** Each language named in itself, so that a reader can find their own language in any interface language. */
export const languageNames: Readonly<Record<Language, string>> = { en: 'English', fr: 'Français', ja: '日本語' };

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (languages as readonly string[]).includes(value);
}

/**
 * Chooses the interface language: the signed-in profile's language when it has one, otherwise the first
 * browser or system language that Nihon offers (`fr-CA` counts as `fr`), otherwise English.
 */
export function selectLanguage(profileLanguage: string | undefined, preferredLanguages: readonly string[]): Language {
  if (isLanguage(profileLanguage)) {
    return profileLanguage;
  }
  for (const tag of preferredLanguages) {
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (isLanguage(primary)) {
      return primary;
    }
  }
  return defaultLanguage;
}
