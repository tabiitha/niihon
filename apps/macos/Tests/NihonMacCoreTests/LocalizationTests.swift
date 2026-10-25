import Foundation
import NihonMacCore
import Testing

@Suite("Interface languages and texts")
struct LocalizationTests {
    @Test("prefers the profile language, then the first offered system language, then English")
    func selection() {
        #expect(Language.select(profileLanguage: "ja", preferredLanguages: ["fr-FR"]) == .ja)
        #expect(Language.select(profileLanguage: nil, preferredLanguages: ["de-DE", "fr-CA", "ja"]) == .fr)
        #expect(Language.select(profileLanguage: "de", preferredLanguages: ["ja-JP"]) == .ja)
        #expect(Language.select(profileLanguage: nil, preferredLanguages: ["zh-Hans_CN"]) == .en)
        #expect(Language.select(profileLanguage: nil, preferredLanguages: []) == .en)
    }

    @Test("replaces known placeholders and keeps unknown ones visible")
    func placeholders() {
        #expect(formatText("{page} · Nihon", ["page": "Kanji"]) == "Kanji · Nihon")
        #expect(formatText("{a} and {b}", ["a": "1"]) == "1 and {b}")
        #expect(Language.fr.text(ShellText.errorReference, ["requestId": "abc"]).hasSuffix("abc"))
    }

    @Test("every module has a non-empty text for every key in every language", arguments: [
        ShellText.self, MacShellText.self, HomeText.self, LearningText.self, KanjiText.self,
        LibraryText.self, ProfileText.self, AdminText.self, AccountsText.self, MacAccountsText.self,
    ] as [any TextKey.Type])
    func completeness(module: any TextKey.Type) {
        assertComplete(module)
    }

    @Test("reads the shared Web texts and the native shell texts")
    func sources() {
        #expect(ShellText.source == "apps/web/src/shell/locales")
        #expect(MacShellText.source == "apps/macos/Sources/NihonMacCore/Shell/locales")
        #expect(AccountsText.source == "apps/web/src/modules/accounts/locales")
        #expect(MacAccountsText.source == "apps/macos/Sources/NihonMacCore/Accounts/locales")
        #expect(Language.ja.text(ShellText.navKanji) == "漢字")
        #expect(Language.fr.text(ShellText.retry) == "Réessayer")
    }

    @Test("names every space in every language")
    func spaces() {
        for language in Language.allCases {
            #expect(Set(Space.allCases.map { language.text($0.label) }).count == Space.allCases.count)
        }
        #expect(Space.primary + Space.account == Space.allCases)
    }
}

private func assertComplete<Key: TextKey>(_ module: Key.Type) {
    for language in Language.allCases {
        let texts = Key.table[language] ?? [:]
        #expect(texts.count == Key.allCases.count, "\(Key.source): \(language) has \(texts.count) of \(Key.allCases.count) texts")
        for key in Key.allCases {
            let text = texts[key]?.trimmingCharacters(in: .whitespaces) ?? ""
            #expect(!text.isEmpty, "\(Key.source): \(language) \(key.rawValue) is empty")
        }
    }
}
