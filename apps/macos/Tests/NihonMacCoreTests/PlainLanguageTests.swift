import Foundation
import NihonMacCore
import Testing

/// Words that only a developer needs. They stay in the logs; the interface never shows them.
private func technical(_ language: Language) -> Regex<AnyRegexOutput> {
    let words: [Language: Regex<AnyRegexOutput>] = [
    .en: try! Regex(#"(?i)\b(service|server|log|request|api|version|code|http|https|localhost|url|address|loopback|key|idempotency|provider)\b|127\.0\.0\.1|NihonServiceURL"#),
    .fr: try! Regex(#"(?i)\b(service|serveur|journal|requête|api|version|code|http|https|localhost|url|adresse|bouclage|clé|idempotence|fournisseur)\b|127\.0\.0\.1|NihonServiceURL"#),
    .ja: try! Regex(#"サービス|サーバー|ログ(?!イン)|参照番号|リクエスト|API|バージョン|コード|http|URL|アドレス|ループバック|キー|プロバイダー|127\.0\.0\.1|NihonServiceURL"#),
    ]
    return words[language]!
}

/// Placeholders that would put an address, a version, or a request identifier on screen.
private func technicalPlaceholders() -> Regex<(Substring, Substring)> {
    /\{(address|serverVersion|clientVersion|requestId|code|status)\}/
}

private func assertPlain<Key: TextKey>(_ module: Key.Type) {
    for language in Language.allCases {
        for key in Key.allCases {
            let text = Key.table[language]?[key] ?? ""
            #expect(!text.isEmpty, "\(Key.source) \(language).\(key.rawValue) is missing")
            #expect(text.firstMatch(of: technicalPlaceholders()) == nil, "\(Key.source) \(language).\(key.rawValue): \(text)")
            // Other placeholders (a provider's or a person's name) are filled with ordinary words.
            let words = text.replacing(/\{[a-zA-Z]+\}/, with: "")
            #expect(words.firstMatch(of: technical(language)) == nil, "\(Key.source) \(language).\(key.rawValue): \(text)")
        }
    }
}

private func source(_ path: String) throws -> String {
    let repository = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    return try String(contentsOf: repository.appending(path: path), encoding: .utf8)
}

@Suite("What an ordinary person sees")
struct PlainLanguageTests {
    @Test("the macOS shell texts use no technical words and no technical placeholder")
    func shellTexts() {
        assertPlain(MacShellText.self)
    }

    @Test("the macOS account texts use no technical words and no technical placeholder")
    func accountTexts() {
        assertPlain(MacAccountsText.self)
    }

    @Test("the shared Web shell texts that macOS shows use no technical words and no technical placeholder")
    func sharedShellTexts() {
        assertPlain(ShellText.self)
    }

    @Test("the shared Web account texts that macOS shows use no technical words and no technical placeholder")
    func sharedAccountTexts() {
        assertPlain(AccountsText.self)
    }

    @Test("names Google and GitHub, and never shows the raw identifier of another provider")
    func providerNames() {
        for language in Language.allCases {
            #expect(ProviderText.continueWith("github", in: language).contains(language.text(AccountsText.providerGithub)))
            #expect(ProviderText.starting("google", in: language).contains(language.text(AccountsText.providerGoogle)))
            #expect(ProviderText.waiting(for: "google", in: language).contains(language.text(AccountsText.providerGoogle)))
            let unknown = [
                ProviderText.continueWith("oidc_corp-sso", in: language),
                ProviderText.starting("oidc_corp-sso", in: language),
                ProviderText.waiting(for: "oidc_corp-sso", in: language),
            ]
            #expect(unknown == [
                language.text(MacAccountsText.continueWithExistingAccount),
                language.text(MacAccountsText.startingExistingAccount),
                language.text(MacAccountsText.waitingForExistingAccount),
            ])
            #expect(unknown.allSatisfy { !$0.contains("oidc") && !$0.contains("{") }, "\(language)")
        }
    }

    @Test("the removed technical texts stay removed")
    func removedKeys() {
        let shell = Set(MacShellText.allCases.map(\.rawValue))
        #expect(!shell.contains("serviceAddress") && !shell.contains("incompatibleVersions"))
        #expect(!Set(ShellText.allCases.map(\.rawValue)).contains("errorReference"))
        #expect(!Set(AccountsText.allCases.map(\.rawValue)).contains("errorReference"))
    }

    @Test("no screen shows a request identifier, a service address, or a version")
    func screens() throws {
        for path in ["apps/macos/Sources/Nihon/StatusView.swift", "apps/macos/Sources/Nihon/RegistrationView.swift"] {
            let code = try source(path)
            #expect(code.firstMatch(of: /requestID|requestId|serviceAddress|incompatibleVersions|NihonAPIVersion|connection\.address/) == nil, "\(path)")
        }
        #expect(try source("apps/macos/Sources/Nihon/ShellView.swift").firstMatch(of: /StatusView\([^)]*address/) == nil)
    }

    @Test("says plainly that registration is not available when the service has no registration yet")
    func notFound() {
        let problem = RegistrationProblem.describe(.error(status: 404, code: "not_found", requestID: "r", fields: []))
        #expect(problem.message == .shared(.errorNotAvailable))
        #expect(problem.retry == .new, "no immediate Try again")
    }
}
