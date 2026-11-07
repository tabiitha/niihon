// Generated from the shared JSON files. Do not edit: run `bun run macos:generate`.

/// The server's username rules (`x-nihon-rules` of the contract). Lengths count Unicode code points of the
/// normalized form; `rawMaxLength` is the field's `maxLength`, in UTF-16 code units.
public enum UsernameRules {
    public static let normalization = "NFKC"
    public static let trim = true
    public static let minLength = 3
    public static let maxLength = 32
    public static let pattern = "^[\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M}_.-]*$"
    public static let rawMaxLength = 256
}

/// The server's password rules (`x-nihon-rules` of the contract). Lengths count Unicode code points of the
/// normalized form; `rawMaxLength` is the field's `maxLength`, in UTF-16 code units.
public enum PasswordRules {
    public static let normalization = "NFKC"
    public static let minLength = 8
    public static let maxLength = 128
    public static let notBlank = true
    public static let noControlCharacters = true
    public static let differentFromUsername = true
    public static let rawMaxLength = 512
}
