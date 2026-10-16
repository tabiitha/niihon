import type { Language } from './languages.ts';

export type Texts<Key extends string> = Readonly<Record<Key, string>>;

/** One module's texts in every interface language, read from its `locales/<language>.json` files. */
export interface ModuleTexts<Key extends string> {
  readonly module: string;
  readonly texts: Readonly<Record<Language, Texts<Key>>>;
}

/**
 * Declares a module's texts. English defines the keys; the type checker then requires the same keys in
 * French and Japanese, and the locale test also rejects extra keys and mismatched placeholders.
 */
export function defineTexts<Key extends string>(
  module: string,
  texts: { readonly en: Texts<Key>; readonly fr: Texts<Key>; readonly ja: Texts<Key> },
): ModuleTexts<Key> {
  return { module, texts };
}

/** Replaces `{name}` placeholders with their values; unknown placeholders stay visible. */
export function formatText(template: string, values: Readonly<Record<string, string | number>> = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in values ? String(values[name]) : placeholder,
  );
}
