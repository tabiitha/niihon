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
        // A standard title bar above the navigation bar: it keeps the window buttons, the drag area, and full screen
        // exactly as in any Mac app, and shows the current space as the window title.
        .windowResizability(.contentMinSize)
        .defaultSize(width: 1200, height: 720)
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
