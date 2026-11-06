import Foundation
import NihonMacCore
import Testing

/// The typing checks: generated from the contract, and the same verdicts as the Web client's `rules.test.ts`.
/// `LiveRegistrationTests` checks the same cases against the real service.
@Suite("Typing rules of the registration")
struct RegistrationChecksTests {
    @Test("are the rules of the contract, for a local account and for a provider registration")
    func contract() throws {
        let repository = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: repository.appending(path: "contracts/openapi.json"))
        let root = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let schemas = try #require((root["components"] as? [String: Any])?["schemas"] as? [String: Any])
        func field(_ schema: String, _ name: String) throws -> [String: Any] {
            try #require(((schemas[schema] as? [String: Any])?["properties"] as? [String: Any])?[name] as? [String: Any])
        }
        for schema in ["LocalRegistration", "OAuthRegistrationStart"] {
            let username = try field(schema, "username")
            let rules = try #require(username["x-nihon-rules"] as? [String: Any])
            #expect(rules["normalization"] as? String == UsernameRules.normalization, "\(schema)")
            #expect(rules["trim"] as? Bool == UsernameRules.trim, "\(schema)")
            #expect(rules["minLength"] as? Int == UsernameRules.minLength, "\(schema)")
            #expect(rules["maxLength"] as? Int == UsernameRules.maxLength, "\(schema)")
            #expect(rules["pattern"] as? String == UsernameRules.pattern, "\(schema)")
            #expect(rules.count == 5, "\(schema): a rule the macOS checks do not know")
            #expect(username["maxLength"] as? Int == UsernameRules.rawMaxLength, "\(schema)")
        }
        let password = try field("LocalRegistration", "password")
        let rules = try #require(password["x-nihon-rules"] as? [String: Any])
        #expect(rules["normalization"] as? String == PasswordRules.normalization)
        #expect(rules["minLength"] as? Int == PasswordRules.minLength)
        #expect(rules["maxLength"] as? Int == PasswordRules.maxLength)
        #expect(rules["notBlank"] as? Bool == PasswordRules.notBlank)
        #expect(rules["noControlCharacters"] as? Bool == PasswordRules.noControlCharacters)
        #expect(rules["differentFromUsername"] as? Bool == PasswordRules.differentFromUsername)
        #expect(rules.count == 6, "a rule the macOS checks do not know")
        #expect(password["maxLength"] as? Int == PasswordRules.rawMaxLength)
    }

    @Test("count characters after NFKC, accept letters of any script, and start with a letter or digit")
    func usernames() {
        for accepted in ["abc", "さくら", "Ｓａｋｕｒａ", "  taro  ", String(repeating: "a", count: 32), "ab_c-d.e", "1abc", "café", "cafe\u{301}"] {
            #expect(RegistrationChecks.username(accepted) == nil, "\(accepted.debugDescription)")
        }
        for refused in ["ab", String(repeating: "a", count: 33), "_abc", ".abc", "ta ro", "ta/ro", "ta\u{200D}ro", "😀😀😀", String(repeating: " ", count: 260) + "taro"] {
            #expect(RegistrationChecks.username(refused) == .errorUsernameInvalid, "\(refused.debugDescription)")
        }
        #expect(RegistrationChecks.username("") == .usernameRequired)
        #expect(RegistrationChecks.username("   ") == .usernameRequired)
    }

    @Test("want a password of 8 to 128 characters, not blank, without control characters, other than the username")
    func passwords() {
        #expect(RegistrationChecks.password("", username: "sakura") == .passwordRequired)
        for accepted in ["12345678", "パスワードです本当", String(repeating: "x", count: 128), "sakura12"] {
            #expect(RegistrationChecks.password(accepted, username: "sakura") == nil, "\(accepted)")
        }
        for refused in ["1234567", String(repeating: "x", count: 129), String(repeating: " ", count: 8), "abcd\u{7}efgh", "SAKURA_42", "ＳＡＫＵＲＡ＿４２"] {
            #expect(RegistrationChecks.password(refused, username: "Sakura_42") == .errorPasswordInvalid, "\(refused.debugDescription)")
        }
        #expect(RegistrationChecks.confirmation("a long passphrase", password: "a long passphrase") == nil)
        #expect(RegistrationChecks.confirmation("a long passphrasE", password: "a long passphrase") == .passwordsDiffer)
    }
}
