// Generated from the shared JSON files. Do not edit: run `bun run macos:generate`.

/// Color roles every theme of `resources/themes` defines for both modes.
public enum ColorRole: String, CaseIterable, Sendable {
    case background
    case backgroundAccent
    case surface
    case onSurface
    case text
    case textMuted
    case accent
    case onAccent
    case accentText
    case border
    case focus
}

/// Every theme of `resources/themes`, in folder order.
public enum ThemeCatalog {
    public static let themes: [ThemeTokens] = [
        ThemeTokens(
            id: "sakura",
            name: "Sakura",
            light: ThemeMode(
                name: "Sakura Milk",
                colors: [
                    .background: RGBColor(hex: 0xFBDCE5),
                    .backgroundAccent: RGBColor(hex: 0xFBDCE5),
                    .surface: RGBColor(hex: 0xFFF5F8),
                    .onSurface: RGBColor(hex: 0x2A0F2E),
                    .text: RGBColor(hex: 0x2A0F2E),
                    .textMuted: RGBColor(hex: 0xA3346F),
                    .accent: RGBColor(hex: 0xD81B60),
                    .onAccent: RGBColor(hex: 0xFFFFFF),
                    .accentText: RGBColor(hex: 0xB0175A),
                    .border: RGBColor(hex: 0xE8A7BE),
                    .focus: RGBColor(hex: 0x2A0F2E),
                ]
            ),
            dark: ThemeMode(
                name: "Neon Sorbet",
                colors: [
                    .background: RGBColor(hex: 0x24103F),
                    .backgroundAccent: RGBColor(hex: 0x7A1E6C),
                    .surface: RGBColor(hex: 0xFCE4F0),
                    .onSurface: RGBColor(hex: 0x2A0F2E),
                    .text: RGBColor(hex: 0xFFFFFF),
                    .textMuted: RGBColor(hex: 0xFFB3E6),
                    .accent: RGBColor(hex: 0xD3165A),
                    .onAccent: RGBColor(hex: 0xFFFFFF),
                    .accentText: RGBColor(hex: 0xFFB3E6),
                    .border: RGBColor(hex: 0x8C4A9E),
                    .focus: RGBColor(hex: 0xFFFFFF),
                ]
            ),
            contrastPairs: [
                ContrastPair(foreground: .text, background: .background, minimum: 4.5),
                ContrastPair(foreground: .text, background: .backgroundAccent, minimum: 4.5),
                ContrastPair(foreground: .textMuted, background: .background, minimum: 4.5),
                ContrastPair(foreground: .textMuted, background: .backgroundAccent, minimum: 4.5),
                ContrastPair(foreground: .accentText, background: .background, minimum: 4.5),
                ContrastPair(foreground: .accentText, background: .backgroundAccent, minimum: 4.5),
                ContrastPair(foreground: .onAccent, background: .accent, minimum: 4.5),
                ContrastPair(foreground: .onSurface, background: .surface, minimum: 4.5),
                ContrastPair(foreground: .focus, background: .background, minimum: 3.0),
                ContrastPair(foreground: .focus, background: .backgroundAccent, minimum: 3.0),
            ]
        ),
    ]
}
