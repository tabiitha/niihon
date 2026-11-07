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

    @Test("judges words exactly as voice.ts does: whole words of any script, plurals included")
    func sameJudgementAsTheWeb() {
        // The cases of apps/web/src/i18n/voice.test.ts.
        let caught: [Language: [String]] = [
            .en: [
                "The account is ready on this computer.", "Two computers.", "Open Nihon on this Mac.", "Use your Mac.", "Saved locally.",
                "Saved on a local disk.", "You are offline.", "Install Nihon first.", "Uninstall Nihon.", "Reinstall it.",
                "On this machine.", "Check the server.", "All servers.", "Two services.", "Versions differ.", "Check the addresses.",
                "On this device.", "Use a PC.", "Logs.", "Request ID 4.", "Enter the key.", "Open 127.0.0.1.",
            ],
            .fr: [
                "Le compte est prêt sur cet ordinateur.", "Deux ordinateurs.", "Ouvrez Nihon sur ce Mac.", "Utilisez un Mac.",
                "Enregistré en local.", "Des fichiers locaux.", "Vous êtes hors ligne.", "Vous êtes hors-ligne.", "Après l’installation.",
                "Désinstallez Nihon.", "Réinstallez Nihon.", "Sur cette machine.", "Vérifiez le serveur.", "Les serveurs.",
                "Les adresses.", "Les versions.", "Sur cet appareil.", "Sur un PC.", "La clé.", "Entrez la clé de secours.",
                "Le journal.",
            ],
            .ja: [
                "このコンピューターに作成されました。", "パソコンで開いてください。", "このMacで開いてください。", "Macで開きます。",
                "ローカルに保存しました。", "オフラインです。", "インストールしてください。", "アンインストールしてください。",
                "サーバーを確認してください。", "この端末で開いてください。", "PCで開きます。", "キーを入力してください。",
            ],
        ]
        let allowed: [Language: [String]] = [
            .en: ["Welcome, {username}!", "Use the keyboard.", "This browser blocks the rest of the sign-up.", "Macro lessons.", "Locate a kanji.", "Catalogue.", "A quick review."],
            .fr: ["Bienvenue, {username} !", "Utilisez le clavier.", "Ce navigateur bloque la suite de l’inscription.", "Un macaron.", "La localisation.", "Les leçons de kana."],
            .ja: ["ログインしてください。", "キーボードで入力できます。", "このブラウザでは続けられません。", "マクロ", "ようこそ、{username}さん！"],
        ]
        for language in Language.allCases {
            for text in caught[language] ?? [] {
                #expect(Voice.forbiddenWord(in: text, language: language) != nil, "\(language): \(text)")
            }
            for text in allowed[language] ?? [] {
                #expect(Voice.forbiddenWord(in: text, language: language) == nil, "\(language): \(text)")
            }
        }
        // The word reported is the word itself, without the character before it, as JavaScript reports it.
        #expect(Voice.forbiddenWord(in: "La clé est prête.", language: .fr) == "clé")
        #expect(Voice.forbiddenWord(in: "Use your Mac.", language: .en) == "Mac")
        #expect(Voice.forbiddenWord(in: "Mac first.", language: .en) == "Mac")
        #expect(Voice.forbiddenWord(in: "このMacで開いてください。", language: .ja) == "Mac")
        #expect(Voice.forbiddenWord(in: "Réinstallez Nihon.", language: .fr) == "Réinstallez")
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
