// Generated from the shared JSON files. Do not edit: run `bun run macos:generate`.

/// The words the interface must not use, from `forbiddenWords` in apps/web/src/i18n/voice.ts (JavaScript, `u`
/// flag). Swift Regex has no lookbehind, so each `(?<![…])` is written `(?:^|(?<lbN>[^…]))`: the same texts
/// match, and `Voice` leaves the captured preceding character out of the word it reports.
public enum ForbiddenWords {
    public static let patterns: [Language: (pattern: String, ignoresCase: Bool)] = [
        .en: ("(?:^|(?<lb0>[^\\p{L}\\p{N}]))(?:services?|servers?|logs?|requests?(?: ids?)?|idempotency|keys?|codes?|https?|apis?|localhost|providers?|address(?:es)?|versions?|computers?|mac|local(?:ly)?|offline|(?:un|re)?install\\p{L}*|machines?|devices?|pcs?)(?![\\p{L}\\p{N}])|127\\.0\\.0\\.1", true),
        .fr: ("(?:^|(?<lb0>[^\\p{L}\\p{N}]))(?:services?|serveurs?|journal|journaux|requêtes?|identifiants? de requête|idempotence|clés?|codes?|https?|api|localhost|fournisseurs?|adresses?|versions?|ordinateurs?|mac|local|locale|locales|locaux|localement|hors[- ]ligne|(?:dés|ré)?install\\p{L}*|machines?|appareils?|pcs?)(?![\\p{L}\\p{N}])|127\\.0\\.0\\.1", true),
        .ja: ("サービス|サーバー|ログ(?!イン)|参照番号|リクエスト|キー(?!ボード)|コード|(?:^|(?<lb0>[^A-Za-z0-9]))(?:https?|api|localhost|mac|pc)(?![A-Za-z0-9])|プロバイダー|アドレス|バージョン|コンピューター|コンピュータ|パソコン|ローカル|オフライン|インストール|マシン|端末|デバイス|127\\.0\\.0\\.1", true),
    ]

    public static let brandKeys: Set<String> = ["providerGoogle", "providerGithub"]
}
