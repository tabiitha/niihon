// Generated from the shared JSON files. Do not edit: run `bun run macos:generate`.

/// The words the interface must not use, copied from `forbiddenWords` in apps/web/src/i18n/voice.ts: JavaScript
/// regular expressions without the `u` flag, so `\b` and `\w` are ASCII (see `Voice`).
public enum ForbiddenWords {
    public static let patterns: [Language: (pattern: String, ignoresCase: Bool)] = [
        .en: ("\\b(service|server|log|request( id)?|idempotency|key|code|http|api|localhost|provider|address|version|computer|this mac|local(ly)?|offline|install\\w*|machine)\\b|127\\.0\\.0\\.1", true),
        .fr: ("\\b(service|serveur|journal|requête|identifiant de requête|idempotence|clé|code|http|api|localhost|fournisseur|adresse|version|ordinateur|ce mac|local(e|es|ement)?|hors[- ]ligne|install\\w*|machine)\\b|127\\.0\\.0\\.1", true),
        .ja: ("サービス|サーバー|ログ(?!イン)|参照番号|リクエスト|キー|コード|http|API|localhost|プロバイダー|アドレス|バージョン|コンピューター|コンピュータ|パソコン|このMac|ローカル|オフライン|インストール|マシン|127\\.0\\.0\\.1", true),
    ]

    public static let brandKeys: Set<String> = ["providerGoogle", "providerGithub"]
}
