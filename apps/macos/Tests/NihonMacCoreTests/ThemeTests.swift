import NihonMacCore
import Testing

@Suite("Theme tokens")
struct ThemeTests {
    @Test("include the default Sakura theme with its light and dark modes")
    func sakura() {
        let sakura = ThemeCatalog.theme(id: ThemeCatalog.defaultThemeID)
        #expect(sakura.id == "sakura")
        #expect(sakura.light.name == "Sakura Milk")
        #expect(sakura.dark.name == "Neon Sorbet")
        #expect(sakura.light[.background] == RGBColor(hex: 0xFBDCE5))
        #expect(ThemeCatalog.theme(id: "unknown").id == ThemeCatalog.themes[0].id)
    }

    @Test("define every color role in both modes", arguments: ThemeCatalog.themes.map(\.id))
    func roles(themeID: String) {
        let theme = ThemeCatalog.theme(id: themeID)
        for mode in ColorMode.allCases {
            #expect(Set(theme.mode(mode).colors.keys) == Set(ColorRole.allCases), "\(themeID) \(mode)")
        }
    }

    @Test("reach the WCAG 2.2 contrast of every declared pair in both modes", arguments: ThemeCatalog.themes.map(\.id))
    func contrast(themeID: String) {
        let theme = ThemeCatalog.theme(id: themeID)
        #expect(!theme.contrastPairs.isEmpty)
        for mode in ColorMode.allCases {
            let colors = theme.mode(mode)
            for pair in theme.contrastPairs {
                let ratio = RGBColor.contrastRatio(colors[pair.foreground], colors[pair.background])
                #expect(
                    ratio >= pair.minimum,
                    "\(themeID) \(mode): \(pair.foreground) on \(pair.background) is \(ratio), below \(pair.minimum)"
                )
            }
        }
    }

    @Test("computes WCAG contrast ratios")
    func ratio() {
        let black = RGBColor(hex: 0x000000)
        let white = RGBColor(hex: 0xFFFFFF)
        #expect(abs(RGBColor.contrastRatio(black, white) - 21) < 0.001)
        #expect(abs(RGBColor.contrastRatio(white, white) - 1) < 0.001)
        #expect(abs(RGBColor.contrastRatio(RGBColor(hex: 0x767676), white) - 4.54) < 0.01)
    }

    @Test("resolves the system mode from the operating system")
    func appearance() {
        #expect(AppearanceMode.system.resolve(systemIsDark: true) == .dark)
        #expect(AppearanceMode.system.resolve(systemIsDark: false) == .light)
        #expect(AppearanceMode.light.resolve(systemIsDark: true) == .light)
        #expect(AppearanceMode.dark.resolve(systemIsDark: false) == .dark)
    }
}
