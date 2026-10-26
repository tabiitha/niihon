import Foundation
import NihonMacCore
import Testing

@Suite("Navigation bar")
struct NavigationTests {
    @Test("shows the learning spaces first, then the account spaces, as the Web client's header")
    func order() {
        #expect(NavigationGroup.primary.spaces == [.home, .learning, .kanji, .library])
        #expect(NavigationGroup.account.spaces == [.profile, .admin])
        #expect(NavigationGroup.primary.spaces + NavigationGroup.account.spaces == Space.allCases)
    }

    @Test("puts every space in exactly one group", arguments: Space.allCases)
    func groups(space: Space) {
        let groups = [NavigationGroup.primary, .account].filter { $0.spaces.contains(space) }
        #expect(groups.count == 1)
        #expect(groups.first == space.group)
    }

    @Test("numbers the Go menu shortcuts from left to right, from 1 to 6")
    func shortcuts() {
        #expect(Space.allCases.map(\.shortcutNumber) == [1, 2, 3, 4, 5, 6])
    }

    @Test("names the two groups in every language, with the Web client's texts")
    func groupLabels() {
        for language in Language.allCases {
            let names = [NavigationGroup.primary, .account].map { language.text($0.label) }
            #expect(Set(names).count == 2, "\(language)")
            #expect(names.allSatisfy { !$0.isEmpty })
        }
        #expect(Language.en.text(NavigationGroup.primary.label) == "Main navigation")
    }

    @Test("keeps the text readable on the hover tint, which the Web client draws as 12% of the accent",
          arguments: ThemeCatalog.themes.map(\.id))
    func hoverContrast(themeID: String) {
        let theme = ThemeCatalog.theme(id: themeID)
        for mode in ColorMode.allCases {
            let colors = theme.mode(mode)
            for background in [ColorRole.background, .backgroundAccent] {
                let tinted = RGBColor.blend(colors[.accent], over: colors[background], opacity: 0.12)
                let ratio = RGBColor.contrastRatio(colors[.text], tinted)
                #expect(ratio >= 4.5, "\(themeID) \(mode): text on the hover tint over \(background) is \(ratio)")
            }
        }
    }
}

private extension RGBColor {
    /// `foreground` painted over `background` at `opacity`, as the screen composites it.
    static func blend(_ foreground: RGBColor, over background: RGBColor, opacity: Double) -> RGBColor {
        func channel(_ top: UInt8, _ bottom: UInt8) -> UInt32 {
            UInt32((Double(top) * opacity + Double(bottom) * (1 - opacity)).rounded())
        }
        return RGBColor(hex: channel(foreground.red, background.red) << 16
            | channel(foreground.green, background.green) << 8
            | channel(foreground.blue, background.blue))
    }
}
