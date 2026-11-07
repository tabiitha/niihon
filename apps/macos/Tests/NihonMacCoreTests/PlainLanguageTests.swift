import Foundation
import NihonMacCore
import Testing

/// Placeholders that would put an address, a version, or a request identifier on screen.
private func technicalPlaceholders() -> Regex<(Substring, Substring)> {
    /\{(address|serverVersion|clientVersion|requestId|code|status)\}/
}

/// Checks every text of a module with the words of `voice.ts` (generated as `ForbiddenWords`), except brand names.
private func assertPlain<Key: TextKey>(_ module: Key.Type) {
    for language in Language.allCases {
        for key in Key.allCases where !ForbiddenWords.brandKeys.contains(key.rawValue) {
            let text = Key.table[language]?[key] ?? ""
            #expect(!text.isEmpty, "\(Key.source) \(language).\(key.rawValue) is missing")
            #expect(text.firstMatch(of: technicalPlaceholders()) == nil, "\(Key.source) \(language).\(key.rawValue): \(text)")
            let word = Voice.forbiddenWord(in: text, language: language)
            #expect(word == nil, "\(Key.source) \(language).\(key.rawValue) uses \"\(word ?? "")\": \(text)")
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

    @Test("the other shared Web texts that macOS shows use no forbidden word")
    func otherSharedTexts() {
        assertPlain(HomeText.self)
        assertPlain(LearningText.self)
        assertPlain(KanjiText.self)
        assertPlain(LibraryText.self)
        assertPlain(ProfileText.self)
        assertPlain(AdminText.self)
    }

    @Test("judges words exactly as voice.ts does, with JavaScript's ASCII word boundaries")
    func sameJudgementAsTheWeb() {
        // The examples of apps/web/src/i18n/voice.test.ts.
        let caught: [(String, Language)] = [
            ("The account is ready on this computer.", .en), ("Open Nihon on this Mac.", .en), ("Saved locally.", .en),
            ("You are offline.", .en), ("Install Nihon first.", .en), ("On this machine.", .en), ("Check the server.", .en),
            ("Le compte est prêt sur cet ordinateur.", .fr), ("Ouvrez Nihon sur ce Mac.", .fr), ("Enregistré en local.", .fr),
            ("Vous êtes hors ligne.", .fr), ("Vous êtes hors-ligne.", .fr), ("Après l’installation.", .fr),
            ("Sur cette machine.", .fr), ("Vérifiez le serveur.", .fr),
            ("このコンピューターに作成されました。", .ja), ("パソコンで開いてください。", .ja), ("このMacで開いてください。", .ja),
            ("ローカルに保存しました。", .ja), ("オフラインです。", .ja), ("インストールしてください。", .ja),
            ("サーバーを確認してください。", .ja),
        ]
        for (text, language) in caught {
            #expect(Voice.forbiddenWord(in: text, language: language) != nil, "\(language): \(text)")
        }
        #expect(Voice.forbiddenWord(in: "ログインしてください。", language: .ja) == nil, "logging in is not a log")
        #expect(Voice.forbiddenWord(in: "Welcome, {username}!", language: .en) == nil)
        // JavaScript without the `u` flag sees "é" as a boundary: "Réinstallez" is caught, as on the Web.
        #expect(Voice.forbiddenWord(in: "Réinstallez l’application.", language: .fr) == "installez")
        // The same judgement, gaps included: with ASCII boundaries "clé" before a space is not a word for voice.ts.
        #expect(Voice.forbiddenWord(in: "La clé est prête.", language: .fr) == nil)
        #expect(Voice.forbiddenWord(in: "Un Mac local.", language: .fr) == "local")
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
