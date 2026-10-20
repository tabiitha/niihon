import NihonMacCore
import SwiftUI

/// The colors of the selected theme and mode. Views only use these roles, never literal colors.
struct Palette {
    let mode: ThemeMode

    subscript(role: ColorRole) -> Color {
        let color = mode[role]
        return Color(.sRGB, red: Double(color.red) / 255, green: Double(color.green) / 255, blue: Double(color.blue) / 255)
    }
}

extension EnvironmentValues {
    @Entry var palette = Palette(mode: ThemeCatalog.theme(id: ThemeCatalog.defaultThemeID).light)
}

/// The page background: a gradient between the two background roles, flat when they are equal.
struct ThemeBackground: View {
    @Environment(\.palette) private var palette

    var body: some View {
        LinearGradient(
            colors: [palette[.background], palette[.backgroundAccent]],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}

/// The primary action: a rounded accent button, as on the approved home page.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title3.weight(.semibold))
            .foregroundStyle(palette[.onAccent])
            .padding(.vertical, 12)
            .padding(.horizontal, 28)
            .frame(minHeight: 44)
            .background(palette[.accent].opacity(configuration.isPressed ? 0.85 : 1), in: Capsule())
            .contentShape(Capsule())
    }
}

/// A secondary text action whose icon uses the accent text color.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title3.weight(.semibold))
            .foregroundStyle(palette[.text])
            .labelStyle(AccentIconLabelStyle())
            .padding(.vertical, 8)
            .frame(minHeight: 44)
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Rectangle())
    }
}

private struct AccentIconLabelStyle: LabelStyle {
    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 10) {
            configuration.icon.foregroundStyle(palette[.accentText])
            configuration.title
        }
    }
}
