import Foundation

/// An sRGB color of a theme token, such as `#FBDCE5`.
public struct RGBColor: Hashable, Sendable {
    public let red: UInt8
    public let green: UInt8
    public let blue: UInt8

    public init(hex: UInt32) {
        red = UInt8((hex >> 16) & 0xFF)
        green = UInt8((hex >> 8) & 0xFF)
        blue = UInt8(hex & 0xFF)
    }

    /// Relative luminance, as defined by WCAG 2.2.
    public var relativeLuminance: Double {
        func linear(_ channel: UInt8) -> Double {
            let value = Double(channel) / 255
            return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    /// WCAG 2.2 contrast ratio between two colors, from 1 to 21.
    public static func contrastRatio(_ first: RGBColor, _ second: RGBColor) -> Double {
        let luminances = [first.relativeLuminance, second.relativeLuminance].sorted(by: >)
        return (luminances[0] + 0.05) / (luminances[1] + 0.05)
    }
}

public enum ColorMode: String, CaseIterable, Sendable {
    case light
    case dark
}

/// `system` follows the operating system's light or dark setting.
public enum AppearanceMode: String, CaseIterable, Sendable {
    case system
    case light
    case dark

    public func resolve(systemIsDark: Bool) -> ColorMode {
        switch self {
        case .system: systemIsDark ? .dark : .light
        case .light: .light
        case .dark: .dark
        }
    }
}

/// One mode of a theme: its name, such as Sakura Milk, and a color for every role.
public struct ThemeMode: Sendable {
    public let name: String
    public let colors: [ColorRole: RGBColor]

    public init(name: String, colors: [ColorRole: RGBColor]) {
        self.name = name
        self.colors = colors
    }

    /// The color of `role`. The generator only produces themes that define every role in both modes.
    public subscript(role: ColorRole) -> RGBColor {
        guard let color = colors[role] else {
            preconditionFailure("Theme mode \(name) has no \(role.rawValue) color.")
        }
        return color
    }
}

/// A foreground and background role whose WCAG contrast must reach `minimum` in both modes.
public struct ContrastPair: Sendable {
    public let foreground: ColorRole
    public let background: ColorRole
    public let minimum: Double

    public init(foreground: ColorRole, background: ColorRole, minimum: Double) {
        self.foreground = foreground
        self.background = background
        self.minimum = minimum
    }
}

/// A theme of `resources/themes/<id>/tokens.json`, shared with the Web client. Layout, components,
/// typography, and behavior are the same for every theme; only these tokens differ.
public struct ThemeTokens: Identifiable, Sendable {
    public let id: String
    public let name: String
    public let light: ThemeMode
    public let dark: ThemeMode
    public let contrastPairs: [ContrastPair]

    public init(id: String, name: String, light: ThemeMode, dark: ThemeMode, contrastPairs: [ContrastPair]) {
        self.id = id
        self.name = name
        self.light = light
        self.dark = dark
        self.contrastPairs = contrastPairs
    }

    public func mode(_ mode: ColorMode) -> ThemeMode {
        mode == .light ? light : dark
    }
}

extension ThemeCatalog {
    public static let defaultThemeID = "sakura"

    /// The theme with this identifier, or the first theme when none has it.
    public static func theme(id: String) -> ThemeTokens {
        themes.first { $0.id == id } ?? themes[0]
    }
}
