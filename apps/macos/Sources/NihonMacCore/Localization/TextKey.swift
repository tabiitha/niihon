/// The keys of one module's texts, generated from its `locales/<language>.json` files into
/// Generated/ModuleTexts.swift. The generator refuses a missing language, key, or placeholder, so every key has a
/// text in every language.
public protocol TextKey: RawRepresentable, CaseIterable, Hashable, Sendable where RawValue == String {
    /// The `locales` folder the texts come from, relative to the repository root.
    static var source: String { get }
    static var table: [Language: [Self: String]] { get }
}

extension Language {
    /// The text of `key` in this language, with its `{name}` placeholders replaced by `values`.
    public func text<Key: TextKey>(_ key: Key, _ values: [String: String] = [:]) -> String {
        formatText(Key.table[self]?[key] ?? key.rawValue, values)
    }
}

/// Replaces `{name}` placeholders with their values; unknown placeholders stay visible.
public func formatText(_ template: String, _ values: [String: String] = [:]) -> String {
    template.replacing(/\{(\w+)\}/) { match in
        values[String(match.output.1)] ?? String(match.output.0)
    }
}
