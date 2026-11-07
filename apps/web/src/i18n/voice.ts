import type { Language } from './languages.ts';

/**
 * Words that interface texts must not use, because Nihon speaks like a professional consumer website (see AGENTS.md):
 * nothing about how it is built (service, server, request, version, address, log, code) or deployed (the computer, the
 * Mac, the device, local, offline, installation). Placeholders such as `{username}` are removed before matching. Used by the tests of
 * every `locales` folder; diagnostics belong in the logs, not on screen.
 */
export const forbiddenWords: Readonly<Record<Language, RegExp>> = {
  // Whole words only: no letter or digit of any script may touch them (`u` flag, Unicode lookarounds), so "clé" and
  // "keyboard" are judged right. Plurals and prefixed forms (uninstall, désinstaller, réinstaller) are listed.
  en: /(?<![\p{L}\p{N}])(?:services?|servers?|logs?|requests?(?: ids?)?|idempotency|keys?|codes?|https?|apis?|localhost|providers?|address(?:es)?|versions?|computers?|mac|local(?:ly)?|offline|(?:un|re)?install\p{L}*|machines?|devices?|pcs?)(?![\p{L}\p{N}])|127\.0\.0\.1/iu,
  fr: /(?<![\p{L}\p{N}])(?:services?|serveurs?|journal|journaux|requêtes?|identifiants? de requête|idempotence|clés?|codes?|https?|api|localhost|fournisseurs?|adresses?|versions?|ordinateurs?|mac|local|locale|locales|locaux|localement|hors[- ]ligne|(?:dés|ré)?install\p{L}*|machines?|appareils?|pcs?)(?![\p{L}\p{N}])|127\.0\.0\.1/iu,
  // Japanese has no spaces between words: the words are matched anywhere, except where a longer word is fine
  // (ログイン is signing in, キーボード a keyboard); Latin words such as Mac only need Latin letters around them, since
  // a Japanese letter may follow them directly (Macで).
  ja: /サービス|サーバー|ログ(?!イン)|参照番号|リクエスト|キー(?!ボード)|コード|(?<![A-Za-z0-9])(?:https?|api|localhost|mac|pc)(?![A-Za-z0-9])|プロバイダー|アドレス|バージョン|コンピューター|コンピュータ|パソコン|ローカル|オフライン|インストール|マシン|端末|デバイス|127\.0\.0\.1/iu,
};

/** The first forbidden word of a text, or `undefined`. */
export function forbiddenWordIn(text: string, language: Language): string | undefined {
  return forbiddenWords[language].exec(text.replace(/\{[a-zA-Z]+\}/g, ''))?.[0];
}
