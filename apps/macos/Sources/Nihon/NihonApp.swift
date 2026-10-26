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
        // The navigation bar takes the place of the title bar, as the header does in the Web client; the window
        // keeps its title for the Window menu and Mission Control.
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentMinSize)
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
