import NihonMacCore
import SwiftUI

@main
struct NihonApp: App {
    @State private var settings = AppSettings()

    var body: some Scene {
        WindowGroup(id: ShellView.windowID) {
            ShellView()
                .environment(settings)
        }
        .defaultSize(width: 1040, height: 700)
        .commands {
            ShellCommands(language: settings.language)
        }
    }
}

/// Display choices of the running app. They apply until the app quits: storing them in the profile belongs
/// to the language and appearance preferences (#80, #81).
@MainActor
@Observable
final class AppSettings {
    /// The first system language Nihon offers, which includes the per-app language of System Settings.
    var language = Language.select(profileLanguage: nil, preferredLanguages: Locale.preferredLanguages)
    var themeID = ThemeCatalog.defaultThemeID
    var appearance = AppearanceMode.system
}
