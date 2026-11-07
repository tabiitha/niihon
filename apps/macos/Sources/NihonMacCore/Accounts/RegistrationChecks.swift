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

        public func value(of field: RegistrationField) -> String {
            switch field {
            case .username: username
            case .password: password
            case .confirmation: confirmation
            }
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
        // Two refusals the length rule does not explain get their own words, as on the Web.
        if PasswordRules.notBlank && trim(normalized).isEmpty {
            return .passwordOnlySpaces
        }
        if PasswordRules.noControlCharacters && normalized.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) {
            return .passwordCharacter
        }
        let length = normalized.unicodeScalars.count
        if password.utf16.count > PasswordRules.rawMaxLength
            || length < PasswordRules.minLength
            || length > PasswordRules.maxLength
            || (PasswordRules.differentFromUsername && same(lowercase(normalized), usernameKey(username)))
        {
            return .errorPasswordInvalid
        }
        return nil
    }

    public static func confirmation(_ confirmation: String, password: String) -> AccountsText? {
        same(confirmation, password) ? nil : .passwordsDiffer
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

    /// JavaScript's `===` on strings: the same code units. Swift's `==` treats canonically equivalent strings as equal
    /// (a precomposed "é" and "e" with a combining accent), which JavaScript does not.
    public static func same(_ left: String, _ right: String) -> Bool {
        left.unicodeScalars.elementsEqual(right.unicodeScalars)
    }

    /// JavaScript's `toLowerCase`: the default full lowercase mapping, independent of the locale, with the one
    /// context rule it applies, a final capital sigma becoming "ς". Swift's `lowercased()` always gives "σ".
    public static func lowercase(_ text: String) -> String {
        let scalars = Array(text.unicodeScalars)
        var lower = String.UnicodeScalarView()
        for (index, scalar) in scalars.enumerated() {
            if scalar.value == 0x3A3, isFinalSigma(scalars, at: index) {
                lower.append("\u{3C2}")
            } else {
                lower.append(contentsOf: scalar.properties.lowercaseMapping.unicodeScalars)
            }
        }
        return String(lower)
    }

    /// The Final_Sigma condition of the Unicode standard (3.13): a cased letter before it, and none after it,
    /// case-ignorable characters being skipped on both sides.
    private static func isFinalSigma(_ scalars: [Unicode.Scalar], at index: Int) -> Bool {
        let before = scalars[..<index].reversed().first { !$0.properties.isCaseIgnorable }
        let after = scalars[(index + 1)...].first { !$0.properties.isCaseIgnorable }
        return before?.properties.isCased == true && after?.properties.isCased != true
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
