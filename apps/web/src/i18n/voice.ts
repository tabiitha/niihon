import type { Language } from './languages.ts';

/**
 * Words that interface texts must not use, because Nihon speaks like a professional consumer website (see AGENTS.md):
 * nothing about how it is built (service, server, request, version, address, log, code) or deployed (the computer, the
 * Mac, local, offline, installation). Placeholders such as `{username}` are removed before matching. Used by the tests of
 * every `locales` folder; diagnostics belong in the logs, not on screen.
 */
export const forbiddenWords: Readonly<Record<Language, RegExp>> = {
  en: /\b(service|server|log|request( id)?|idempotency|key|code|http|api|localhost|provider|address|version|computer|this mac|local(ly)?|offline|install\w*|machine)\b|127\.0\.0\.1/i,
  fr: /\b(service|serveur|journal|requête|identifiant de requête|idempotence|clé|code|http|api|localhost|fournisseur|adresse|version|ordinateur|ce mac|local(e|es|ement)?|hors[- ]ligne|install\w*|machine)\b|127\.0\.0\.1/i,
  ja: /サービス|サーバー|ログ(?!イン)|参照番号|リクエスト|キー|コード|http|API|localhost|プロバイダー|アドレス|バージョン|コンピューター|コンピュータ|パソコン|このMac|ローカル|オフライン|インストール|マシン|127\.0\.0\.1/i,
};

/** The first forbidden word of a text, or `undefined`. */
export function forbiddenWordIn(text: string, language: Language): string | undefined {
  return forbiddenWords[language].exec(text.replace(/\{[a-zA-Z]+\}/g, ''))?.[0];
}
