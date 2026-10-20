import Foundation

/// Interface languages, in the order they are offered; the same as apps/web/src/i18n/languages.ts.
public enum Language: String, CaseIterable, Sendable {
    case en
    case fr
    case ja

    public static let fallback: Language = .en

    /// The language named in itself, so that a reader finds their own language in any interface language.
    public var nativeName: String {
        switch self {
        case .en: "English"
        case .fr: "Français"
        case .ja: "日本語"
        }
    }

    /// Chooses the interface language: the signed-in profile's language when it has one, otherwise the
    /// first system language that Nihon offers (`fr-CA` counts as `fr`), otherwise English.
    public static func select(profileLanguage: String?, preferredLanguages: [String]) -> Language {
        if let profileLanguage, let language = Language(rawValue: profileLanguage) {
            return language
        }
        for tag in preferredLanguages {
            let primary = tag.trimmingCharacters(in: .whitespaces).lowercased()
                .split(whereSeparator: { $0 == "-" || $0 == "_" }).first
            if let primary, let language = Language(rawValue: String(primary)) {
                return language
            }
        }
        return fallback
    }
}
