import Foundation

/// The check of what is typed, with exactly the server's rules (`UsernameRules` and `PasswordRules`, generated
/// from the contract's `x-nihon-rules`), the same way as the Web client's `rules.ts`. It only helps before
/// sending: the service still decides, and its refusals are shown the same way. `RulesTests` checks the cases of
/// the Web client, and `LiveRegistrationTests` that the service gives the same verdict for each of them.
public enum RegistrationChecks {
    /// What was typed in the three fields.
    public struct Entries: Equatable, Sendable {
        public var username: String
        public var password: String
        public var confirmation: String

        public init(username: String, password: String, confirmation: String) {
            self.username = username
            self.password = password
            self.confirmation = confirmation
        }
    }

    public static func username(_ username: String) -> AccountsText? {
        if trim(username).isEmpty {
            return .usernameRequired
        }
        let normalized = usernameForm(username)
        let length = normalized.unicodeScalars.count
        if username.utf16.count > UsernameRules.rawMaxLength
            || length < UsernameRules.minLength
            || length > UsernameRules.maxLength
            || !matchesPattern(normalized)
        {
            return .errorUsernameInvalid
        }
        return nil
    }

    public static func password(_ password: String, username: String) -> AccountsText? {
        if password.isEmpty {
            return .passwordRequired
        }
        let normalized = nfkc(password)
        let length = normalized.unicodeScalars.count
        if password.utf16.count > PasswordRules.rawMaxLength
            || length < PasswordRules.minLength
            || length > PasswordRules.maxLength
            || (PasswordRules.notBlank && trim(normalized).isEmpty)
            || (PasswordRules.noControlCharacters && normalized.unicodeScalars.contains { $0.properties.generalCategory == .control })
            || (PasswordRules.differentFromUsername && lowercase(normalized) == usernameKey(username))
        {
            return .errorPasswordInvalid
        }
        return nil
    }

    public static func confirmation(_ confirmation: String, password: String) -> AccountsText? {
        confirmation == password ? nil : .passwordsDiffer
    }

    /// The check of one field, given everything typed.
    public static func check(_ field: RegistrationField, _ entries: Entries) -> AccountsText? {
        switch field {
        case .username: username(entries.username)
        case .password: password(entries.password, username: entries.username)
        case .confirmation: confirmation(entries.confirmation, password: entries.password)
        }
    }

    // MARK: The server's operations, in Swift

    private static func nfkc(_ text: String) -> String {
        text.precomposedStringWithCompatibilityMapping
    }

    /// The username the server checks: NFKC, then trimmed.
    private static func usernameForm(_ username: String) -> String {
        let normalized = nfkc(username)
        return UsernameRules.trim ? trim(normalized) : normalized
    }

    /// The form the server compares a password with: the username's form, lowercase, NFKC again.
    private static func usernameKey(_ username: String) -> String {
        nfkc(lowercase(usernameForm(username)))
    }

    /// Unicode default lowercase mapping, independent of the locale, as JavaScript's `toLowerCase`.
    private static func lowercase(_ text: String) -> String {
        text.lowercased()
    }

    /// JavaScript's `String.prototype.trim`: white space (`Zs`, tab, vertical tab, form feed, U+FEFF) and line
    /// terminators (LF, CR, U+2028, U+2029). Foundation's white space set differs (it trims U+0085 and keeps
    /// U+FEFF), so the set is spelled out.
    private static func trim(_ text: String) -> String {
        let scalars = text.unicodeScalars
        let isSpace: (Unicode.Scalar) -> Bool = { scalar in
            [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0xFEFF, 0x2028, 0x2029].contains(scalar.value)
                || scalar.properties.generalCategory == .spaceSeparator
        }
        guard let start = scalars.firstIndex(where: { !isSpace($0) }),
              let end = scalars.lastIndex(where: { !isSpace($0) })
        else { return "" }
        return String(scalars[start...end])
    }

    /// The contract's pattern, matched on Unicode scalars as a JavaScript regular expression with the `u` flag
    /// (Swift matches grapheme clusters by default).
    private static func matchesPattern(_ text: String) -> Bool {
        guard let pattern = try? Regex(UsernameRules.pattern) else { return false }
        return (try? pattern.matchingSemantics(.unicodeScalar).wholeMatch(in: text)) != nil
    }
}
